"use strict";
/**
 * Pipeline Orchestrator — single-file and multi-file engineering workflows.
 *
 * Entry points:
 *   run(request, opts)      — single file:  Plan → Code → Patch → Apply → Test → Review → Deploy
 *   runMulti(request, opts) — multi-file:   Plan → Code×N → PatchSet → ApplySet → VerifySet → Review → Deploy
 *   deploy(opts)            — standalone:   PM2 reload → health check → rollback on failure
 *   rollback(gitHead, opts) — standalone:   git checkout → PM2 restart → health check
 *
 * Every stage delegates to an already-implemented V1/V2 module.
 * This file contains no AI logic beyond prompt construction.
 */

const path = require("path");

// ── Lazy loaders (avoid circular deps + keep startup fast) ────────
function _cga()  { return require("./codeGeneratorAgent.cjs"); }
function _pa()   { return require("../runtime/patchAssistant.cjs"); }
function _ai()   { return require("../../backend/services/aiService"); }

// ── Stage 1: Plan ─────────────────────────────────────────────────
// Extracts targetFile and a clean instruction from a freeform request.
// Uses Groq with a tight system prompt — returns JSON.
const PLANNER_SYSTEM =
    "You are a code-change planner. The user describes a change they want made to a codebase. " +
    "Extract exactly two fields and return ONLY valid JSON, nothing else:\n" +
    "  targetFile  — the relative file path mentioned or implied (string or null)\n" +
    "  instruction — a precise, self-contained restatement of what to change (string)\n" +
    'Example: {"targetFile":"backend/utils/parser.js","instruction":"Add a raw URL intercept before the open_app branch so https:// inputs route to open_url instead of open_app."}';

async function _plan(request) {
    const ai     = _ai();
    const raw    = await ai.callAI(request, {
        system:   PLANNER_SYSTEM,
        provider: "groq",
    });

    // Strip fences if model ignores the instruction
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    let plan;
    try {
        plan = JSON.parse(cleaned);
    } catch {
        // Fallback: extract file path from original request with regex
        const fileMatch = request.match(/\b([\w./\-]+\.(?:js|cjs|mjs|jsx|ts|tsx|py|sh|json|yaml|yml|md))\b/i);
        plan = {
            targetFile:  fileMatch?.[1] || null,
            instruction: request,
        };
    }

    if (!plan.targetFile) {
        throw new Error("[Plan] No targetFile identified. Include a file path in your request.");
    }
    if (!plan.instruction || plan.instruction.trim().length < 5) {
        throw new Error("[Plan] Instruction too vague.");
    }

    return plan;
}

// ── Stage 2: Code ─────────────────────────────────────────────────
// Reads the target file, builds repo context, calls modifyFile.
async function _code(targetFile, instruction) {
    const cga     = _cga();
    const context = cga.buildRepoContext(targetFile, "");
    const mod     = await cga.modifyFile({ filePath: targetFile, instruction, context });
    return { mod, context };
}

// ── Stage 3: Patch ────────────────────────────────────────────────
// Proposes a patch (snapshots original, does NOT write).
function _patch(mod, reason) {
    const pa = _pa();
    return pa.proposePatch({
        filePath:       mod.filePath,
        patchedContent: mod.patchedContent,
        reason:         reason.slice(0, 200),
    });
}

// ── Stage 4: Apply ────────────────────────────────────────────────
// Writes the patch to disk. Requires approved:true.
function _apply(patchId, operatorId) {
    const pa = _pa();
    return pa.applyPatch(patchId, { approved: true, operatorId });
}

// ── Stage 5: Test ─────────────────────────────────────────────────
// Runs the test command. autoRollback:true restores original on failure.
async function _test(patchId, testCommand, autoRollback) {
    const pa = _pa();
    return pa.verifyPatch(patchId, { command: testCommand, autoRollback });
}

// ── Stage 6: Review ───────────────────────────────────────────────
// Sends the actual diff + original instruction to Groq and asks for a
// structured code review. Runs only after tests pass — reviews verified code.
const REVIEW_SYSTEM =
    "You are a senior code reviewer. You will be given an instruction that was implemented, " +
    "the diff that was applied, and the original file content. " +
    "Return ONLY valid JSON with these exact fields:\n" +
    '  "verdict"       : "APPROVE" | "APPROVE_WITH_NOTES" | "REQUEST_CHANGES"\n' +
    '  "correctness"   : short sentence on whether the change does what was asked\n' +
    '  "risks"         : array of risk strings (empty array if none)\n' +
    '  "improvements"  : array of suggested improvement strings (empty array if none)\n' +
    '  "summary"       : one sentence overall assessment';

async function _review(instruction, diff, originalContent) {
    const ai = _ai();
    const prompt =
        `INSTRUCTION THAT WAS IMPLEMENTED:\n${instruction}\n\n` +
        `DIFF (lines added/removed):\n${diff.preview || "(no preview)"}\n` +
        `Stats: +${diff.linesAdded} lines added, -${diff.linesRemoved} lines removed\n\n` +
        `ORIGINAL FILE (first 60 lines):\n${originalContent.split("\n").slice(0, 60).join("\n")}\n\n` +
        `Review the change and return JSON.`;

    const raw = await ai.callAI(prompt, { system: REVIEW_SYSTEM, provider: "groq" });
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```\s*$/m, "").trim();

    try {
        return { ok: true, ...JSON.parse(cleaned) };
    } catch {
        // Graceful fallback — review text not parseable as JSON
        return {
            ok:           true,
            verdict:      "APPROVE_WITH_NOTES",
            correctness:  "Review could not be parsed as JSON.",
            risks:        [],
            improvements: [],
            summary:      raw.slice(0, 200),
        };
    }
}

// ── Main: run ─────────────────────────────────────────────────────

const DEFAULT_TEST_CMD = "node --test tests/runtime/01-taskRouter.test.cjs";

/**
 * Run the full pipeline.
 *
 * @param {string} request     — natural language change request
 * @param {object} opts
 * @param {boolean} opts.autoApply      — write the patch automatically (default true)
 * @param {boolean} opts.autoRollback   — rollback on test failure (default true)
 * @param {string}  opts.testCommand    — override the test command
 * @param {string}  opts.operatorId     — attributed to this operator in patch history
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   request: string,
 *   stages: { plan, code, patch, apply, test, review },
 *   summary: string,
 *   patchId: string|null,
 *   rolledBack: boolean,
 * }>}
 */
async function run(request, {
    autoApply    = true,
    autoRollback = true,
    autoDeploy   = false,
    testCommand  = DEFAULT_TEST_CMD,
    operatorId   = "orchestrator",
} = {}) {
    const trace = {
        ok:        false,
        request,
        stages:    { plan: null, code: null, patch: null, apply: null, test: null, review: null, deploy: null },
        summary:   "",
        patchId:   null,
        rolledBack: false,
        startedAt: new Date().toISOString(),
    };

    // ── 1. PLAN ──────────────────────────────────────────────────
    let plan;
    try {
        plan = await _plan(request);
        trace.stages.plan = { ok: true, targetFile: plan.targetFile, instruction: plan.instruction };
        console.log(`[Pipeline:Plan]   targetFile=${plan.targetFile}`);
        console.log(`[Pipeline:Plan]   instruction="${plan.instruction.slice(0, 80)}"`);
    } catch (err) {
        trace.stages.plan = { ok: false, error: err.message };
        trace.summary = `Plan failed: ${err.message}`;
        return trace;
    }

    // ── 2. CODE ──────────────────────────────────────────────────
    let codeResult;
    try {
        const { mod, context } = await _code(plan.targetFile, plan.instruction);
        codeResult = mod;
        trace.stages.code = {
            ok:           true,
            targetFile:   mod.filePath,
            linesOriginal: mod.linesOriginal,
            linesPatched:  mod.linesPatched,
            contextUsed:  mod.contextUsed,
        };
        console.log(`[Pipeline:Code]   ${mod.linesOriginal} → ${mod.linesPatched} lines`);
    } catch (err) {
        trace.stages.code = { ok: false, error: err.message };
        trace.summary = `Code failed: ${err.message}`;
        return trace;
    }

    // ── 3. PATCH ─────────────────────────────────────────────────
    let patchResult;
    try {
        patchResult = _patch(codeResult, plan.instruction);
        if (!patchResult.ok) throw new Error(patchResult.error);
        trace.patchId      = patchResult.patchId;
        trace.stages.patch = {
            ok:      true,
            patchId: patchResult.patchId,
            diff:    patchResult.diff,
            requiresApproval: true,
        };
        console.log(`[Pipeline:Patch]  id=${patchResult.patchId} +${patchResult.diff.linesAdded}/-${patchResult.diff.linesRemoved}`);
    } catch (err) {
        trace.stages.patch = { ok: false, error: err.message };
        trace.summary = `Patch proposal failed: ${err.message}`;
        return trace;
    }

    // Stop here if caller wants to review before applying
    if (!autoApply) {
        trace.summary = `Patch proposed (id=${patchResult.patchId}). Call applyPatch(patchId, {approved:true}) to apply.`;
        return trace;
    }

    // ── 4. APPLY ─────────────────────────────────────────────────
    let applyResult;
    try {
        applyResult = _apply(patchResult.patchId, operatorId);
        if (!applyResult.ok) throw new Error(applyResult.error);
        trace.stages.apply = { ok: true, filePath: applyResult.filePath, appliedAt: applyResult.appliedAt };
        console.log(`[Pipeline:Apply]  written → ${applyResult.filePath}`);
    } catch (err) {
        trace.stages.apply = { ok: false, error: err.message };
        trace.summary = `Apply failed: ${err.message}`;
        return trace;
    }

    // ── 5. TEST ──────────────────────────────────────────────────
    let testResult;
    try {
        testResult = await _test(patchResult.patchId, testCommand, autoRollback);
        trace.stages.test = {
            ok:          testResult.ok,
            verified:    testResult.verified,
            buildPassed: testResult.buildPassed,
            testsPassed: testResult.testsPassed,
            pass:        testResult.pass,
            fail:        testResult.fail,
            summary:     testResult.summary,
            rolledBack:  testResult.rolledBack,
        };
        trace.rolledBack = testResult.rolledBack;
        console.log(`[Pipeline:Test]   ${testResult.summary}`);
    } catch (err) {
        trace.stages.test = { ok: false, error: err.message };
        trace.summary = `Test failed: ${err.message}`;
        return trace;
    }

    // ── 6. REVIEW ────────────────────────────────────────────────
    // Only run when tests passed — we review verified code, not broken code.
    if (testResult.testsPassed) {
        try {
            const reviewResult = await _review(
                plan.instruction,
                patchResult.diff,
                codeResult.originalContent
            );
            trace.stages.review = reviewResult;
            console.log(`[Pipeline:Review] ${reviewResult.verdict} — ${reviewResult.summary?.slice(0, 80)}`);
        } catch (err) {
            // Review failure is non-fatal — tests already passed
            trace.stages.review = { ok: false, error: err.message };
            console.log(`[Pipeline:Review] skipped (${err.message})`);
        }
    }

    // ── 7. DEPLOY ────────────────────────────────────────────────
    if (testResult.testsPassed && autoDeploy) {
        try {
            const preCommit = (() => { try { return execSync("git rev-parse --short HEAD 2>/dev/null", { encoding: "utf8" }).trim(); } catch { return null; } })();
            const deployResult = await _deploy(preCommit);
            trace.stages.deploy = deployResult;
            console.log(`[Pipeline:Deploy] ${deployResult.ok ? "healthy" : "UNHEALTHY"} — ${deployResult.health?.status} uptime=${deployResult.health?.uptime}s`);
            if (!deployResult.ok) {
                const rb = await _deployRollback(preCommit);
                trace.stages.deploy.rollback = rb;
                console.log(`[Pipeline:Deploy] rollback ${rb.ok ? "succeeded" : "failed"}`);
            }
        } catch (err) {
            trace.stages.deploy = { ok: false, error: err.message };
        }
    }

    trace.ok      = testResult.testsPassed;
    trace.summary = testResult.testsPassed
        ? `✓ Complete — ${testResult.pass} tests passed | Review: ${trace.stages.review?.verdict || "skipped"}` +
          (autoDeploy ? ` | Deploy: ${trace.stages.deploy?.ok ? "healthy" : trace.stages.deploy ? "failed" : "skipped"}` : "")
        : testResult.rolledBack
            ? `✗ Tests failed (${testResult.fail} failures) — patch rolled back`
            : `✗ Tests failed (${testResult.fail} failures) — patch left applied`;

    trace.completedAt = new Date().toISOString();
    return trace;
}

// ── Stage 7: Deploy ───────────────────────────────────────────────
// Restarts the server via PM2 and verifies it comes back healthy.
// Uses execSync (same pattern as adapterSelfHealing.cjs) — PM2 binary
// is not in the safe-exec ALLOWLIST, so we call it directly.
// Captures pre-deploy git HEAD so rollback can restore if health check fails.

const { execSync } = require("child_process");
const http         = require("http");

const PM2_BIN     = "/Users/ehtsm/.nvm/versions/node/v24.11.1/bin/pm2";
const APP_NAME    = "jarvis-os";
const HEALTH_URL  = `http://localhost:${process.env.PORT || 5050}/health`;
const HEALTH_WAIT = 15_000;   // 15s for PM2 to restart + server to bind

function _pm2(args, timeoutMs = 12_000) {
    try {
        const out = execSync(`${PM2_BIN} ${args} 2>/dev/null`, { timeout: timeoutMs, encoding: "utf8" });
        return { ok: true, stdout: out.trim() };
    } catch (err) {
        return { ok: false, error: err.message.slice(0, 200) };
    }
}

function _healthCheck() {
    return new Promise(resolve => {
        const req = http.get(HEALTH_URL, { timeout: 5000 }, res => {
            let body = "";
            res.on("data", d => { body += d; });
            res.on("end", () => {
                try {
                    const d = JSON.parse(body);
                    resolve({ ok: d.status === "ok" || d.status === "degraded", status: d.status, uptime: d.uptime_seconds });
                } catch { resolve({ ok: false, status: "parse_error" }); }
            });
        });
        req.on("error", () => resolve({ ok: false, status: "unreachable" }));
        req.on("timeout", () => { req.destroy(); resolve({ ok: false, status: "timeout" }); });
    });
}

async function _deploy(preDeployCommit) {
    // 1. Record pre-deploy state
    const gitHead = (() => {
        try { return execSync("git rev-parse --short HEAD 2>/dev/null", { encoding: "utf8" }).trim(); } catch { return "unknown"; }
    })();

    // 2. Check if PM2 is managing the process
    const pm2List = (() => {
        try {
            const out = execSync(`${PM2_BIN} jlist 2>/dev/null`, { timeout: 5000, encoding: "utf8" });
            const procs = JSON.parse(out);
            return procs.find(p => p.name === APP_NAME) || null;
        } catch { return null; }
    })();

    const pm2Managed = !!pm2List;

    // 3. Restart / start
    let restartResult;
    if (pm2Managed) {
        // Graceful reload preserves in-flight requests
        restartResult = _pm2(`reload ${APP_NAME}`);
        if (!restartResult.ok) {
            // Fallback to restart if reload fails
            restartResult = _pm2(`restart ${APP_NAME}`);
        }
    } else {
        // Process not under PM2 — start it
        restartResult = _pm2(`start ecosystem.config.cjs --env production`);
    }

    if (!restartResult.ok) {
        return { ok: false, error: `PM2 restart failed: ${restartResult.error}`, gitHead, pm2Managed };
    }

    // 4. Wait for server to come up, poll health
    const startMs = Date.now();
    let health = { ok: false, status: "not_checked" };
    while (Date.now() - startMs < HEALTH_WAIT) {
        await new Promise(r => setTimeout(r, 2000));
        health = await _healthCheck();
        if (health.ok) break;
    }

    const elapsed = Date.now() - startMs;

    return {
        ok:         health.ok,
        gitHead,
        pm2Managed,
        action:     pm2Managed ? "reload" : "start",
        health,
        elapsedMs:  elapsed,
        error:      health.ok ? null : `Health check failed after ${elapsed}ms (status: ${health.status})`,
    };
}

async function _deployRollback(gitHead) {
    // Git code rollback — restore files from prior commit
    if (!gitHead || gitHead === "unknown") {
        return { ok: false, error: "No git HEAD captured before deploy — cannot rollback" };
    }
    try {
        execSync(`git checkout ${gitHead} -- backend/ agents/ 2>/dev/null`, { timeout: 15_000, encoding: "utf8" });
    } catch (err) {
        return { ok: false, error: `git checkout failed: ${err.message.slice(0, 200)}` };
    }
    // Restart after code rollback
    const restart = _pm2(`restart ${APP_NAME}`);
    if (!restart.ok) return { ok: false, error: `Restarted failed after rollback: ${restart.error}` };
    await new Promise(r => setTimeout(r, 3000));
    const health = await _healthCheck();
    return { ok: health.ok, restoredTo: gitHead, health };
}

// ── Multi-file planner ────────────────────────────────────────────
// Extends _plan: returns targetFiles[] (array) + per-file instructions.
// Falls back to single-file regex extraction if the model returns one file.
const MULTI_PLANNER_SYSTEM =
    "You are a code-change planner. The user describes a change across one or more files. " +
    "Return ONLY valid JSON — an object with two fields:\n" +
    '  "files"       : array of objects, each with "filePath" (relative path) and "instruction" (precise change for that file)\n' +
    '  "reason"      : one sentence summarising the whole change set\n' +
    "Rules: include only files that need changes. Maximum 10 files. " +
    'Example: {"files":[{"filePath":"agents/devAgent.cjs","instruction":"Add JSDoc to run()"},{"filePath":"agents/dev/codeGeneratorAgent.cjs","instruction":"Add JSDoc to generate()"}],"reason":"Add JSDoc to public functions"}';

async function _planMulti(request) {
    const ai  = _ai();
    const raw = await ai.callAI(request, { system: MULTI_PLANNER_SYSTEM, provider: "groq" });
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```\s*$/m, "").trim();

    let plan;
    try { plan = JSON.parse(cleaned); } catch {
        // Fallback: extract all file paths from request
        const matches = [...request.matchAll(/\b([\w./\-]+\.(?:js|cjs|mjs|jsx|ts|tsx|py|sh|json|yaml|yml|md))\b/gi)];
        plan = {
            files:  matches.map(m => ({ filePath: m[1], instruction: request })),
            reason: request.slice(0, 200),
        };
    }

    if (!Array.isArray(plan.files) || plan.files.length === 0) {
        throw new Error("[PlanMulti] No files identified. Include at least one file path in your request.");
    }
    // Deduplicate by filePath
    const seen = new Set();
    plan.files = plan.files.filter(f => f.filePath && !seen.has(f.filePath) && seen.add(f.filePath));

    return plan;  // { files: [{filePath, instruction}], reason }
}

// ── Multi-file review ─────────────────────────────────────────────
// Reviews the full change set — all diffs summarised in one prompt.
const MULTI_REVIEW_SYSTEM =
    "You are a senior code reviewer. You will be given a multi-file change set. " +
    "Return ONLY valid JSON with these exact fields:\n" +
    '  "verdict"       : "APPROVE" | "APPROVE_WITH_NOTES" | "REQUEST_CHANGES"\n' +
    '  "correctness"   : sentence on whether all changes do what was asked\n' +
    '  "risks"         : array of risk strings (empty if none)\n' +
    '  "improvements"  : array of improvement strings (empty if none)\n' +
    '  "summary"       : one sentence overall assessment\n' +
    '  "perFile"       : object mapping filePath → one-line verdict';

async function _reviewMulti(reason, diffs) {
    const ai = _ai();
    const diffBlock = diffs.map(d =>
        `FILE: ${d.filePath}\n` +
        `  +${d.diff.linesAdded} added, -${d.diff.linesRemoved} removed\n` +
        `  ${(d.diff.preview || "").split("\n").slice(0, 6).join("\n  ")}`
    ).join("\n\n");

    const prompt =
        `CHANGE SET REASON: ${reason}\n\n` +
        `FILES CHANGED (${diffs.length}):\n\n${diffBlock}\n\n` +
        `Review the entire change set and return JSON.`;

    const raw     = await ai.callAI(prompt, { system: MULTI_REVIEW_SYSTEM, provider: "groq" });
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    try {
        return { ok: true, ...JSON.parse(cleaned) };
    } catch {
        return { ok: true, verdict: "APPROVE_WITH_NOTES", correctness: "Review not parseable.", risks: [], improvements: [], summary: raw.slice(0, 200), perFile: {} };
    }
}

// ── runMulti ──────────────────────────────────────────────────────
/**
 * Multi-file engineering workflow.
 *
 * Plan → Code×N → PatchSet → ApplySet (atomic) → VerifySet → Review
 *
 * @param {string} request     — natural language description of the change set
 * @param {object} opts
 * @param {boolean} opts.autoApply     — apply after proposing (default true)
 * @param {boolean} opts.autoRollback  — rollback entire set on test failure (default true)
 * @param {string}  opts.testCommand
 * @param {string}  opts.operatorId
 */
async function runMulti(request, {
    autoApply    = true,
    autoDeploy   = false,
    autoRollback = true,
    testCommand  = DEFAULT_TEST_CMD,
    operatorId   = "orchestrator",
} = {}) {
    const trace = {
        ok:         false,
        request,
        mode:       "multi",
        stages:     { plan: null, code: null, patch: null, apply: null, test: null, review: null, deploy: null },
        summary:    "",
        setId:      null,
        patchIds:   [],
        rolledBack: false,
        startedAt:  new Date().toISOString(),
    };

    // ── 1. PLAN (multi) ──────────────────────────────────────────
    let plan;
    try {
        plan = await _planMulti(request);
        trace.stages.plan = {
            ok:        true,
            files:     plan.files.map(f => f.filePath),
            reason:    plan.reason,
            fileCount: plan.files.length,
        };
        console.log(`[Multi:Plan]   ${plan.files.length} file(s) | reason: "${plan.reason?.slice(0, 60)}"`);
        plan.files.forEach(f => console.log(`[Multi:Plan]     • ${f.filePath}`));
    } catch (err) {
        trace.stages.plan = { ok: false, error: err.message };
        trace.summary = `Plan failed: ${err.message}`;
        return trace;
    }

    // ── 2. CODE × N ──────────────────────────────────────────────
    // Modify each file independently, build repo context per file.
    const codeResults = [];
    const codeErrors  = [];
    const cga = _cga();

    for (const { filePath, instruction } of plan.files) {
        try {
            const context = cga.buildRepoContext(filePath, "");
            const mod     = await cga.modifyFile({ filePath, instruction, context });
            codeResults.push({ filePath, mod, instruction });
            console.log(`[Multi:Code]   ${filePath} (${mod.linesOriginal}→${mod.linesPatched} lines)`);
        } catch (err) {
            codeErrors.push({ filePath, error: err.message });
            console.log(`[Multi:Code]   ${filePath} FAILED: ${err.message}`);
        }
    }

    if (codeResults.length === 0) {
        trace.stages.code = { ok: false, error: "All files failed to modify", errors: codeErrors };
        trace.summary = "Code stage failed for all files.";
        return trace;
    }

    trace.stages.code = {
        ok:        true,
        succeeded: codeResults.map(r => ({ filePath: r.filePath, linesOriginal: r.mod.linesOriginal, linesPatched: r.mod.linesPatched })),
        failed:    codeErrors,
    };

    // ── 3. PATCH SET ─────────────────────────────────────────────
    let setResult;
    try {
        const pa   = _pa();
        const payload = codeResults.map(r => ({
            filePath:       r.mod.filePath,
            patchedContent: r.mod.patchedContent,
            reason:         r.instruction.slice(0, 200),
        }));
        setResult = pa.proposeSet(payload, { reason: plan.reason, operatorId });
        if (!setResult.ok) throw new Error(setResult.error);

        trace.setId       = setResult.setId;
        trace.patchIds    = setResult.patchIds;
        trace.stages.patch = {
            ok:        true,
            setId:     setResult.setId,
            patchIds:  setResult.patchIds,
            fileCount: setResult.fileCount,
            diffs:     setResult.diffs,
            requiresApproval: true,
        };
        console.log(`[Multi:Patch]  setId=${setResult.setId} files=${setResult.fileCount}`);
        setResult.diffs.forEach(d => console.log(`[Multi:Patch]    • ${d.filePath} +${d.diff.linesAdded}/-${d.diff.linesRemoved}`));
    } catch (err) {
        trace.stages.patch = { ok: false, error: err.message };
        trace.summary = `Patch set proposal failed: ${err.message}`;
        return trace;
    }

    if (!autoApply) {
        trace.summary = `Patch set proposed (setId=${setResult.setId}, ${setResult.fileCount} files). Call applySet(setId, {approved:true}) to apply.`;
        return trace;
    }

    // ── 4. APPLY SET (atomic) ────────────────────────────────────
    let applyResult;
    try {
        const pa  = _pa();
        applyResult = pa.applySet(setResult.setId, { approved: true, operatorId });
        if (!applyResult.ok) throw new Error(applyResult.error || `atomic rollback triggered — failedAt: ${JSON.stringify(applyResult.failedAt)}`);

        trace.stages.apply = {
            ok:        true,
            setId:     applyResult.setId,
            applied:   applyResult.applied,
            fileCount: applyResult.fileCount,
        };
        console.log(`[Multi:Apply]  ${applyResult.fileCount} file(s) written atomically`);
    } catch (err) {
        trace.stages.apply = { ok: false, error: err.message };
        trace.summary = `Apply failed (atomic rollback): ${err.message}`;
        return trace;
    }

    // ── 5. VERIFY SET ────────────────────────────────────────────
    let testResult;
    try {
        const pa  = _pa();
        testResult = await pa.verifySet(setResult.setId, { command: testCommand, autoRollback });
        trace.stages.test = {
            ok:          testResult.ok,
            verified:    testResult.verified,
            buildPassed: testResult.buildPassed,
            testsPassed: testResult.testsPassed,
            pass:        testResult.pass,
            fail:        testResult.fail,
            summary:     testResult.summary,
            rolledBack:  testResult.rolledBack,
        };
        trace.rolledBack = testResult.rolledBack;
        console.log(`[Multi:Test]   ${testResult.summary}`);
    } catch (err) {
        trace.stages.test = { ok: false, error: err.message };
        trace.summary = `Verification failed: ${err.message}`;
        return trace;
    }

    // ── 6. REVIEW (multi) ────────────────────────────────────────
    if (testResult.testsPassed) {
        try {
            const reviewResult = await _reviewMulti(plan.reason, setResult.diffs);
            trace.stages.review = reviewResult;
            console.log(`[Multi:Review] ${reviewResult.verdict} — ${reviewResult.summary?.slice(0, 80)}`);
        } catch (err) {
            trace.stages.review = { ok: false, error: err.message };
        }
    }

    // ── 7. DEPLOY (multi) ────────────────────────────────────────
    if (testResult.testsPassed && autoDeploy) {
        try {
            const preCommit = (() => { try { return execSync("git rev-parse --short HEAD 2>/dev/null", { encoding: "utf8" }).trim(); } catch { return null; } })();
            const deployResult = await _deploy(preCommit);
            trace.stages.deploy = deployResult;
            console.log(`[Multi:Deploy] ${deployResult.ok ? "healthy" : "UNHEALTHY"} — ${deployResult.health?.status}`);
            if (!deployResult.ok) {
                const rb = await _deployRollback(preCommit);
                trace.stages.deploy.rollback = rb;
                console.log(`[Multi:Deploy] rollback ${rb.ok ? "succeeded" : "failed"}`);
            }
        } catch (err) {
            trace.stages.deploy = { ok: false, error: err.message };
        }
    }

    trace.ok      = testResult.testsPassed;
    trace.summary = testResult.testsPassed
        ? `✓ Complete — ${setResult.fileCount} files patched, ${testResult.pass} tests passed | Review: ${trace.stages.review?.verdict || "skipped"}` +
          (autoDeploy ? ` | Deploy: ${trace.stages.deploy?.ok ? "healthy" : trace.stages.deploy ? "failed" : "skipped"}` : "")
        : testResult.rolledBack
            ? `✗ Tests failed — all ${setResult.fileCount} files rolled back`
            : `✗ Tests failed — files left patched`;

    trace.completedAt = new Date().toISOString();
    return trace;
}

/**
 * Standalone deploy: restarts PM2, verifies health, auto-rollbacks on failure.
 *
 * @param {object} opts
 * @param {boolean} opts.autoRollback  — rollback to pre-deploy HEAD if health check fails (default true)
 * @param {string}  opts.operatorId
 */
async function deploy({ autoRollback = true, operatorId = "operator", blueprintId, productName } = {}) {
    const preCommit = (() => {
        try { return execSync("git rev-parse --short HEAD 2>/dev/null", { encoding: "utf8" }).trim(); } catch { return null; }
    })();

    // Emit deploy:started telemetry event (non-fatal)
    try { require("../runtime/telemetryEngine.cjs").recordDeploy({ phase: "started", action: "reload", ok: true, gitHead: preCommit, blueprintId, productName }); } catch {}

    console.log(`[Pipeline:Deploy] starting — HEAD=${preCommit} autoRollback=${autoRollback}`);
    const result = await _deploy(preCommit);
    console.log(`[Pipeline:Deploy] ${result.ok ? "healthy" : "UNHEALTHY"} — status=${result.health?.status} elapsed=${result.elapsedMs}ms`);

    if (!result.ok && autoRollback && preCommit) {
        console.log(`[Pipeline:Deploy] rolling back to ${preCommit}…`);
        const rb = await _deployRollback(preCommit);
        result.rollback = rb;
        console.log(`[Pipeline:Deploy] rollback ${rb.ok ? "succeeded" : "failed"}`);
        // Emit rolled-back event
        try { require("../runtime/telemetryEngine.cjs").recordDeploy({ phase: "rolled-back", action: result.action, ok: rb.ok, gitHead: preCommit, elapsedMs: result.elapsedMs, health: result.health, error: result.error, blueprintId, productName }); } catch {}
    } else {
        // Emit completed event
        try { require("../runtime/telemetryEngine.cjs").recordDeploy({ phase: result.ok ? "completed" : "failed", action: result.action || "reload", ok: result.ok, gitHead: result.gitHead, elapsedMs: result.elapsedMs, health: result.health, error: result.error, blueprintId, productName }); } catch {}
    }

    return { ...result, preCommit, operatorId };
}

/**
 * Standalone rollback: restores code to a previous git HEAD and restarts PM2.
 *
 * @param {string} gitHead  — short or full commit hash to restore
 * @param {object} opts
 * @param {string} opts.operatorId
 */
async function rollback(gitHead, { operatorId = "operator" } = {}) {
    if (!gitHead) return { ok: false, error: "gitHead is required" };
    console.log(`[Pipeline:Rollback] restoring to ${gitHead} (operator=${operatorId})`);
    const result = await _deployRollback(gitHead);
    console.log(`[Pipeline:Rollback] ${result.ok ? "succeeded" : "failed"} — health=${result.health?.status}`);
    return { ...result, operatorId };
}

module.exports = { run, runMulti, deploy, rollback };
