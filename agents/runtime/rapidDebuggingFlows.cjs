"use strict";
/**
 * Phase 707 — Rapid Debugging Flows
 *
 * One-click debug initialization, dependency verification, replay-linked debugging,
 * runtime-health checks, validation-first recovery.
 * Reduces: debugging setup friction, repetitive recovery steps, workflow clutter.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/rapid-debug-flows.json");
const TTL_MS     = 24 * 60 * 60 * 1000;
const MAX_FLOWS  = 30;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { flows: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cut = Date.now() - TTL_MS;
    db.flows = (db.flows || []).filter(f => f.ts > cut).slice(0, MAX_FLOWS);
}

// ── One-click debug initialization ───────────────────────────────────────────

function initializeDebuggingSession(errorContext = "", { env = "vscode", replayId = null } = {}) {
    const flowId = crypto.randomUUID();

    // Step 1: validation-first — check runtime health
    let runtimeOk = true;
    const checks  = [];

    const cee = _tryRequire("./crossEnvironmentExecution.cjs");
    if (cee) {
        try {
            const summary = cee.crossEnvSummary();
            checks.push({ check: "cross-env-state", ok: summary.interrupted === 0, detail: `interrupted=${summary.interrupted}` });
            if (summary.interrupted > 0) runtimeOk = false;
        } catch { checks.push({ check: "cross-env-state", ok: true, skipped: true }); }
    }

    const odc = _tryRequire("./operationalDecisionCoordination.cjs");
    if (odc) {
        try {
            const unstable = odc.detectUnstableCoordinationStates();
            checks.push({ check: "coordination-stable", ok: unstable.stable, detail: `issues=${unstable.issues.length}` });
        } catch {}
    }

    // Step 2: build validation-first debug plan
    const sdp = _tryRequire("./strategicDebugPlanning.cjs");
    let plan = null;
    if (sdp && errorContext) {
        try { plan = sdp.buildValidationFirstPlan(errorContext, { env, replayId }); } catch {}
    }

    // Step 3: check replay linkage
    let replayLinked = false;
    if (replayId) {
        const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
        if (lhwc) {
            try {
                const sess = lhwc.listWorkspaceSessions({ limit: 20 });
                replayLinked = sess.some(s => s.sessionId === replayId);
            } catch {}
        }
    }

    const db = _load(); _prune(db);
    db.flows.unshift({ flowId, type: "debug-init", errorContext: errorContext.slice(0, 200), env, replayId, status: "initialized", ts: Date.now() });
    _save(db);

    return {
        ok:          true,
        flowId,
        runtimeOk,
        checks,
        plan:        plan ? { depth: plan.depth, phases: plan.phases?.length, replayLinked: plan.replayLinked } : null,
        replayLinked,
        readyToDebug: runtimeOk,
        detail:      `Debug session initialized: env=${env} runtime=${runtimeOk ? "ok" : "degraded"} replay=${replayLinked}`,
    };
}

// ── Dependency verification ───────────────────────────────────────────────────

function verifyDebuggingDependencies(target = "") {
    const results = [];

    const tci = _tryRequire("./terminalCoordinationIntelligence.cjs");
    if (tci) {
        try {
            const conflicts = tci.checkProcessConflicts([]);
            results.push({ dep: "terminal-processes", ok: (conflicts.conflicts?.length || 0) === 0, detail: `conflicts=${conflicts.conflicts?.length || 0}` });
        } catch { results.push({ dep: "terminal-processes", ok: true, skipped: true }); }
    }

    const vei = _tryRequire("./vsCodeExecutionIntelligence.cjs");
    if (vei) {
        try {
            const stale = vei.detectStaleFiles();
            results.push({ dep: "vscode-files", ok: stale.staleCount === 0, detail: `stale=${stale.staleCount}` });
        } catch { results.push({ dep: "vscode-files", ok: true, skipped: true }); }
    }

    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    if (dec) {
        try {
            const trust = dec.deploymentTrustIndicator("");
            results.push({ dep: "deployment-trust", ok: trust.indicator !== "red", detail: `trust=${trust.indicator}` });
        } catch {}
    }

    const allOk = results.every(r => r.ok !== false);
    return { ok: allOk, results, target, detail: `Deps: ${results.filter(r => r.ok !== false).length}/${results.length} satisfied` };
}

// ── Replay-linked debugging ───────────────────────────────────────────────────

function buildReplayLinkedDebugFlow(replayId, errorContext = "") {
    if (!replayId) return { ok: false, error: "replayId required" };

    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    let replayContext = null;
    if (lhwc) {
        try {
            const restored = lhwc.restoreWorkspaceSession(replayId, { force: false });
            if (restored.ok) replayContext = { goal: restored.record?.goal, progress: restored.record?.progress, env: restored.record?.env };
        } catch {}
    }

    const sdp = _tryRequire("./strategicDebugPlanning.cjs");
    let plan = null;
    if (sdp) {
        try { plan = sdp.buildReplayLinkedDebugPlan(errorContext, replayId); } catch {}
    }

    return {
        ok:           true,
        replayId,
        replayContext,
        plan:         plan ? { ok: plan.ok, replayLinked: plan.replayLinked } : null,
        errorContext: errorContext.slice(0, 200),
        detail:       `Replay-linked debug: replayId=${replayId} context=${replayContext ? "found" : "not found"}`,
    };
}

// ── Runtime health quick-check ────────────────────────────────────────────────

function debugRuntimeHealthCheck() {
    const results = [];

    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (lhwc) {
        try {
            const health = lhwc.workspaceContinuityHealth();
            results.push({ check: "workspace-continuity", ok: health.ok, detail: health.summary });
        } catch {}
    }

    const odc = _tryRequire("./operationalDecisionCoordination.cjs");
    if (odc) {
        try {
            const unstable = odc.detectUnstableCoordinationStates();
            results.push({ check: "coordination-stability", ok: unstable.stable, detail: unstable.recommendation });
        } catch {}
    }

    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    if (arc) {
        try {
            const r = arc.chooseRecoveryPath("runtime-health-check");
            results.push({ check: "recovery-path", ok: r.ok, detail: r.chosen?.path || "unavailable" });
        } catch {}
    }

    const allOk = results.every(r => r.ok !== false);
    return { ok: allOk, results, readyForDebugging: allOk, detail: `Runtime health: ${results.filter(r => r.ok !== false).length}/${results.length} healthy` };
}

// ── Validation-first recovery ─────────────────────────────────────────────────

function validationFirstRecovery(errorContext = "", { trustScore = 65 } = {}) {
    const phases = [];

    // 1. Validate
    const health = debugRuntimeHealthCheck();
    phases.push({ phase: "validate", ok: health.ok, detail: health.detail });

    // 2. Diagnose
    const sdp = _tryRequire("./strategicDebugPlanning.cjs");
    let roots = null;
    if (sdp && errorContext) {
        try { roots = sdp.prioritizeRootCauses(errorContext); phases.push({ phase: "diagnose", ok: roots.ok, count: roots.causes?.length }); } catch {}
    }

    // 3. Plan recovery
    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    let recovery = null;
    if (arc) {
        try { recovery = arc.chooseRecoveryPath(errorContext); phases.push({ phase: "plan", ok: recovery.ok, path: recovery.chosen?.path }); } catch {}
    }

    // 4. Check approval requirement
    const needsApproval = recovery?.chosen?.requiresApproval || trustScore < 50;
    phases.push({ phase: "execute", requiresApproval: needsApproval, autonomous: !needsApproval });

    // 5. Verify
    phases.push({ phase: "verify", action: "re-run validation after fix" });

    return {
        ok:              true,
        phases,
        approvalRequired: needsApproval,
        trustScore,
        recoveryPath:    recovery?.chosen?.path || null,
        detail:          `Validation-first recovery: ${phases.length} phases, approval=${needsApproval}`,
    };
}

// ── Suppress repetitive debug noise ───────────────────────────────────────────

function suppressRepetitiveDebugNoise(signals = []) {
    const seen = new Map();
    const filtered = [];

    signals.forEach(s => {
        const key = `${s.type}:${s.message}`.slice(0, 100);
        const count = seen.get(key) || 0;
        seen.set(key, count + 1);
        if (count < 1) filtered.push({ ...s, suppressed: false });
    });

    const suppressed = signals.length - filtered.length;
    return { ok: true, filtered, suppressed, original: signals.length, detail: `Suppressed ${suppressed}/${signals.length} duplicate signals` };
}

module.exports = { initializeDebuggingSession, verifyDebuggingDependencies, buildReplayLinkedDebugFlow, debugRuntimeHealthCheck, validationFirstRecovery, suppressRepetitiveDebugNoise };
