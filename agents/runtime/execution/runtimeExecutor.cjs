"use strict";
/**
 * runtimeExecutor — real controlled plan execution engine.
 *
 * execute(plan, strategy, context?, opts?)
 *   → Promise<ExecutionResult>
 *
 * cancel(executionId)   — graceful cancellation
 * reset()
 *
 * Strategies: direct, staged, dry_run, sandbox, rollback_first
 *
 * ExecutionResult:
 *   { executionId, success, state, strategy, steps[], stepsPlanned[], stepsExecuted[],
 *     totalDurationMs, rollbackTriggered, cancelled, error, completedAt,
 *     mode, dryRun, isolated, rollbackReady, checkpointed, simulatedOnly }
 */

const { spawn } = require("child_process");

const esm  = require("./executionStateMachine.cjs");
const tele = require("./executionTelemetry.cjs");
const pers = require("./executionPersistence.cjs");
const ret  = require("./retryEngine.cjs");
const canc = require("./cancellationManager.cjs");
const rbm  = require("./rollbackManager.cjs");
const sand = require("./executionSandbox.cjs");

let _seq = 0;
function _genId(taskId) { return `run-${taskId ?? "task"}-${++_seq}`; }

// ── parseCommand ──────────────────────────────────────────────────────
// Tokenise "cmd arg1 'quoted arg'" → ["cmd","arg1","quoted arg"]

function parseCommand(cmd) {
    const tokens = [];
    let cur = "", inQ = false, qc = "";
    for (const c of cmd) {
        if (inQ)  { c === qc ? (inQ = false) : (cur += c); }
        else if (c === '"' || c === "'") { inQ = true; qc = c; }
        else if (c === " " || c === "\t") { if (cur) { tokens.push(cur); cur = ""; } }
        else { cur += c; }
    }
    if (cur) tokens.push(cur);
    return tokens;
}

// ── spawnStep ─────────────────────────────────────────────────────────

function spawnStep(command, spawnOpts = {}, cancId = null) {
    const [cmd, ...args] = parseCommand(command);
    return new Promise((resolve, reject) => {
        let stdout = "", stderr = "";
        let proc;
        try {
            proc = spawn(cmd, args, {
                cwd:   spawnOpts.cwd ?? process.cwd(),
                env:   spawnOpts.env ?? process.env,
                stdio: ["ignore", "pipe", "pipe"],
            });
        } catch (err) { return reject(err); }

        if (cancId) canc.setProcess(cancId, proc);

        proc.stdout.on("data", d => { stdout += d.toString(); });
        proc.stderr.on("data", d => { stderr += d.toString(); });

        let timer = null;
        if (spawnOpts.timeoutMs) {
            timer = setTimeout(() => {
                try { proc.kill("SIGTERM"); } catch (_) {}
                const err = Object.assign(new Error("step_timeout"), { isTimeout: true });
                reject(err);
            }, spawnOpts.timeoutMs);
            if (timer.unref) timer.unref();
        }

        proc.on("close", code => {
            if (timer) clearTimeout(timer);
            resolve({ exitCode: code ?? 0, stdout, stderr });
        });
        proc.on("error", err => {
            if (timer) clearTimeout(timer);
            reject(err);
        });
    });
}

// ── _buildResult ──────────────────────────────────────────────────────

function _buildResult(executionId, finalState, stepResults, plan, strategy, startMs, rollback, cancelled, err) {
    const completedAt = new Date().toISOString();
    return {
        executionId,
        success:          finalState === "completed",
        state:            finalState,
        strategy,
        steps:            stepResults,
        // backward-compatible fields (matches executionPipeline's _simulateExecution shape)
        stepsPlanned:     plan.executionOrder ?? [],
        stepsExecuted:    stepResults.filter(s => s.state === "completed" || s.state === "skipped").map(s => s.id),
        totalDurationMs:  Date.now() - startMs,
        rollbackTriggered: rollback,
        cancelled,
        error:            err?.message ?? null,
        completedAt,
        mode:             strategy,
        dryRun:           strategy === "dry_run",
        isolated:         strategy === "sandbox",
        rollbackReady:    strategy === "rollback_first",
        checkpointed:     strategy === "staged" || strategy === "rollback_first",
        simulatedOnly:    strategy === "dry_run",
    };
}

// ── execute ───────────────────────────────────────────────────────────

async function execute(plan, strategy, context = {}, opts = {}) {
    const executionId = opts.executionId ?? _genId(plan.taskId ?? plan.id ?? "task");
    const startMs     = Date.now();

    esm.create(executionId);
    canc.register(executionId);
    pers.save(executionId, {
        currentStep:   null,
        exitCodes:     {},
        stdoutSummaries: {},
        stderrSummaries: {},
        runtimeMs:     0,
        retryCounts:   {},
        rollbackState: { triggered: false },
    });

    const executionOrder = plan.executionOrder ?? [];
    const stepResults    = [];

    // ── Dry-run: no real execution ─────────────────────────────────────
    if (strategy === "dry_run") {
        esm.transition(executionId, "prepare");
        esm.transition(executionId, "execute");
        for (const stepId of executionOrder) {
            const step = plan.steps?.find(s => s.id === stepId);
            stepResults.push({ id: stepId, name: step?.name ?? stepId, exitCode: 0, stdout: "", stderr: "", durationMs: 0, attempts: 0, state: "simulated" });
        }
        esm.transition(executionId, "complete");
        pers.update(executionId, { runtimeMs: Date.now() - startMs });
        return _buildResult(executionId, "completed", stepResults, plan, strategy, startMs, false, false, null);
    }

    // ── Prepare ────────────────────────────────────────────────────────
    esm.transition(executionId, "prepare");

    let spawnEnv = process.env;
    let spawnCwd = opts.cwd ?? process.cwd();

    if (strategy === "sandbox") {
        spawnEnv = sand.createSandboxEnv(process.env, context.allowedEnvVars ?? []);
        spawnCwd = sand.createSandboxCwd(executionId);
    }

    if (strategy === "rollback_first") {
        rbm.snapshot(executionId, "__initial__", { executionOrder, completedSteps: [] });
    }

    const stepTimeoutMs = opts.stepTimeoutMs ?? 30_000;
    const retryPolicy   = { maxRetries: 0, ...opts.retryPolicy };
    const secPolicy     = strategy === "sandbox" ? "strict" : "default";

    esm.transition(executionId, "execute");

    // ── Step loop ──────────────────────────────────────────────────────
    for (const stepId of executionOrder) {
        // Cancellation check before each step
        if (canc.isCancelled(executionId)) {
            tele.emit("execution_cancelled", { executionId, atStep: stepId });
            esm.transition(executionId, "cancel");
            pers.update(executionId, { runtimeMs: Date.now() - startMs });
            await canc.runCleanupHooks(executionId);
            if (strategy === "sandbox") sand.cleanup(executionId);
            return _buildResult(executionId, "cancelled", stepResults, plan, strategy, startMs, false, true, null);
        }

        const step = plan.steps?.find(s => s.id === stepId);
        if (!step?.command) {
            stepResults.push({ id: stepId, name: step?.name ?? stepId, exitCode: 0, stdout: "", stderr: "", durationMs: 0, attempts: 0, state: "skipped" });
            continue;
        }

        // Security validation
        const sec = sand.validateCommand(step.command, secPolicy);
        if (!sec.allowed) {
            tele.emit("step_failed", { executionId, stepId, reason: sec.reason, blocked: true });
            esm.transition(executionId, "fail");
            pers.update(executionId, { runtimeMs: Date.now() - startMs });
            if (strategy === "sandbox") sand.cleanup(executionId);
            return _buildResult(executionId, "failed", stepResults, plan, strategy, startMs, false, false,
                new Error(`Step "${stepId}" blocked by security policy: ${sec.reason}`));
        }

        pers.update(executionId, { currentStep: stepId });
        tele.emit("step_started", { executionId, stepId, command: step.command });
        const stepStart = Date.now();

        // Execute with retry
        const retResult = await ret.executeWithRetry(
            (attempt) => {
                const cur = pers.get(executionId);
                pers.update(executionId, { retryCounts: { ...cur?.retryCounts, [stepId]: attempt } });
                return spawnStep(step.command, { cwd: spawnCwd, env: spawnEnv, timeoutMs: stepTimeoutMs }, executionId);
            },
            retryPolicy
        );

        const stepMs   = Date.now() - stepStart;
        const exitCode = retResult.exitCode ?? -1;

        // Persist step output
        const cur = pers.get(executionId);
        pers.update(executionId, {
            exitCodes:        { ...cur?.exitCodes,        [stepId]: exitCode },
            stdoutSummaries:  { ...cur?.stdoutSummaries,  [stepId]: (retResult.result?.stdout ?? "").slice(0, 500) },
            stderrSummaries:  { ...cur?.stderrSummaries,  [stepId]: (retResult.result?.stderr ?? "").slice(0, 500) },
            retryCounts:      { ...cur?.retryCounts,      [stepId]: retResult.attempts - 1 },
        });

        if (retResult.success) {
            tele.emit("step_completed", { executionId, stepId, exitCode, durationMs: stepMs });
            stepResults.push({ id: stepId, name: step.name, exitCode: 0, stdout: retResult.result?.stdout ?? "", stderr: retResult.result?.stderr ?? "", durationMs: stepMs, attempts: retResult.attempts, state: "completed" });

            // Checkpoint for staged / rollback_first
            if (strategy === "staged" || strategy === "rollback_first") {
                esm.transition(executionId, "checkpoint");
                rbm.snapshot(executionId, stepId, { completedSteps: stepResults.map(r => r.id), exitCodes: pers.get(executionId)?.exitCodes ?? {} });
                esm.transition(executionId, "execute");
            }
        } else {
            tele.emit("step_failed", { executionId, stepId, exitCode, durationMs: stepMs, attempts: retResult.attempts });
            stepResults.push({ id: stepId, name: step.name, exitCode, stdout: retResult.result?.stdout ?? "", stderr: retResult.result?.stderr ?? "", durationMs: stepMs, attempts: retResult.attempts, state: "failed" });

            esm.transition(executionId, "fail");

            if (rbm.canRollback(executionId)) {
                tele.emit("rollback_started",   { executionId, atStep: stepId });
                rbm.rollback(executionId);
                tele.emit("rollback_completed", { executionId });
                esm.transition(executionId, "rollback");
                pers.update(executionId, { rollbackState: { triggered: true, completedAt: new Date().toISOString() }, runtimeMs: Date.now() - startMs });
                if (strategy === "sandbox") sand.cleanup(executionId);
                return _buildResult(executionId, "rolled_back", stepResults, plan, strategy, startMs, true, false, null);
            }

            pers.update(executionId, { runtimeMs: Date.now() - startMs });
            if (strategy === "sandbox") sand.cleanup(executionId);
            return _buildResult(executionId, "failed", stepResults, plan, strategy, startMs, false, false,
                new Error(`Step "${stepId}" failed with exit code ${exitCode}`));
        }
    }

    // All steps completed
    esm.transition(executionId, "complete");
    pers.update(executionId, { runtimeMs: Date.now() - startMs, currentStep: null });
    if (strategy === "sandbox") sand.cleanup(executionId);
    return _buildResult(executionId, "completed", stepResults, plan, strategy, startMs, false, false, null);
}

// ── cancel ────────────────────────────────────────────────────────────

function cancel(executionId, opts = {}) {
    return canc.cancel(executionId, opts);
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _seq = 0;
    esm.reset();
    tele.reset();
    pers.reset();
    canc.reset();
    rbm.reset();
}

module.exports = { execute, cancel, parseCommand, reset };
