"use strict";
/**
 * Phase 680 — Terminal Strategy Orchestration
 *
 * Safer command sequencing, dependency-aware shell flows, validation checkpoints,
 * runtime-state-aware execution, replay-linked command coordination.
 * Explainable. Bounded retries. Operator visibility.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/terminal-strategy.json");
const MAX_PLANS   = 50;
const TTL_MS      = 12 * 60 * 60 * 1000;
const MAX_RETRIES = 2;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { plans: [], executions: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.plans      = (db.plans      || []).filter(p => p.ts > cutoff).slice(0, MAX_PLANS);
    db.executions = (db.executions || []).slice(-200);
}

// ── Safer command sequence building ──────────────────────────────────────────

function buildSafeCommandSequence(commands = [], { replayId = null, requireCheckpoints = true } = {}) {
    if (!commands.length) return { ok: false, error: "No commands provided" };

    const planId = crypto.randomUUID();
    const steps  = commands.map((cmd, i) => {
        const safe = _classifyCommandSafety(cmd);
        return {
            index:          i,
            command:        cmd,
            safety:         safe.level,
            requiresApproval: safe.requiresApproval,
            checkpoint:     requireCheckpoints && i > 0,
            maxRetries:     MAX_RETRIES,
            retryCount:     0,
            status:         "pending",
        };
    });

    const db = _load(); _prune(db);
    db.plans.unshift({ planId, replayId, steps, status: "pending", currentStep: 0, ts: Date.now() });
    _save(db);

    return {
        ok:       true,
        planId,
        replayId,
        steps,
        requiresApproval: steps.some(s => s.requiresApproval),
        explainer: `Command sequence: ${steps.length} commands — ${steps.filter(s => s.requiresApproval).length} require approval`,
    };
}

function _classifyCommandSafety(cmd = "") {
    const c = cmd.toLowerCase().trim();
    if (/rm\s+-rf|:\s*>\s*\/|mkfs|dd\s+if=/.test(c))           return { level: "destructive", requiresApproval: true  };
    if (/sudo|chmod\s+777|chown|iptables|systemctl/.test(c))    return { level: "elevated",    requiresApproval: true  };
    if (/npm\s+publish|git\s+push|deploy|kubectl\s+apply/.test(c)) return { level: "publish",  requiresApproval: true  };
    if (/curl|wget|fetch/.test(c))                               return { level: "network",     requiresApproval: false };
    return { level: "safe", requiresApproval: false };
}

// ── Dependency-aware shell flow ───────────────────────────────────────────────

function buildDependencyAwareShellFlow(steps = [], deps = {}) {
    const dae = _tryRequire("./dependencyAwareExecution.cjs");
    let order  = steps.map(s => s.id || s);

    if (dae && Object.keys(deps).length > 0) {
        try {
            const graphName = `shell-flow-${Date.now()}`;
            dae.registerDependencyGraph(graphName, deps);
            const execOrder = dae.getExecutionOrder(graphName);
            if (execOrder.ok && !execOrder.hasCycle) order = execOrder.order;
        } catch {}
    }

    return {
        ok:    true,
        order,
        deps,
        hasDeps: Object.keys(deps).length > 0,
        explainer: `Shell flow: ${order.length} steps in dependency order`,
    };
}

// ── Validation checkpoint insertion ──────────────────────────────────────────

function insertValidationCheckpoints(planId) {
    const db  = _load(); _prune(db);
    const idx = db.plans.findIndex(p => p.planId === planId);
    if (idx === -1) return { ok: false, error: "Plan not found" };

    const plan = db.plans[idx];
    let added  = 0;
    plan.steps.forEach((step, i) => {
        if (i > 0 && !step.checkpoint) { step.checkpoint = true; added++; }
    });

    db.plans[idx] = plan;
    _save(db);
    return { ok: true, planId, checkpointsAdded: added };
}

// ── Runtime-state-aware execution ────────────────────────────────────────────

function shouldExecuteCommand(command = "") {
    const esi = _tryRequire("./executionStateIntelligence.cjs");
    if (esi) {
        try {
            const state  = esi.executionStateSummary();
            const safety = _classifyCommandSafety(command);
            if (!state.stable && safety.level !== "safe") {
                return { ok: false, blocked: true, reason: `Runtime unstable — blocking ${safety.level} command`, requiresApproval: true };
            }
        } catch {}
    }

    const otl = _tryRequire("./operationalTrustLayer.cjs");
    if (otl) {
        try {
            const gate = otl.gateOperation("terminal-exec");
            if (!gate.allowed) return { ok: false, blocked: true, reason: `Trust gate blocked: score=${gate.score}`, requiresApproval: true };
        } catch {}
    }

    return { ok: true, blocked: false, command };
}

// ── Replay-linked command coordination ───────────────────────────────────────

function coordinateReplayLinkedCommands(replayId = "", commands = []) {
    if (!replayId) return { ok: false, error: "replayId required" };

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    let isDup  = false;
    if (lhec) { try { isDup = lhec.isDuplicateRecovery(`term-replay:${replayId}`); } catch {} }
    if (isDup) return { ok: false, duplicate: true, error: "Duplicate replay command execution blocked" };

    const tei = _tryRequire("./terminalExecutionIntelligence.cjs");
    let checkpoint = null;
    if (tei) { try { checkpoint = tei.getLastCheckpoint(replayId); } catch {} }

    const startFrom = checkpoint?.step || 0;
    const remaining = commands.slice(startFrom);

    return {
        ok:         true,
        replayId,
        startFrom,
        checkpoint,
        remaining,
        total:      commands.length,
        explainer:  `Replay coordination: resuming from step ${startFrom}, ${remaining.length} commands remaining`,
    };
}

// ── Plan list ─────────────────────────────────────────────────────────────────

function listTerminalPlans({ limit = 10 } = {}) {
    const db = _load(); _prune(db);
    return db.plans.slice(0, limit).map(p => ({
        planId: p.planId,
        status: p.status,
        stepCount: p.steps.length,
        currentStep: p.currentStep,
        replayId: p.replayId,
        ageMs: Date.now() - p.ts,
    }));
}

module.exports = { buildSafeCommandSequence, buildDependencyAwareShellFlow, insertValidationCheckpoints, shouldExecuteCommand, coordinateReplayLinkedCommands, listTerminalPlans };
