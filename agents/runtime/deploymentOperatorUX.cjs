"use strict";
/**
 * Phase 487 — Deployment Operator Experience
 *
 * Preflight summaries, rollback previews, environment warnings,
 * deployment confidence scoring, runtime readiness indicators.
 *
 * Pure read — no execution, no state mutation.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Preflight summary ─────────────────────────────────────────────────────────

/**
 * Generate a preflight summary before launching a pipeline.
 * @param {string} pipelineName
 * @returns {{ ok, warnings, blockers, confidence, summary }}
 */
function preflightSummary(pipelineName) {
    const pipeline   = _tryRequire("./deploymentPipeline.cjs");
    const pressure   = _tryRequire("./runtimePressureMonitor.cjs");
    const modes      = _tryRequire("./runtimeModes.cjs");
    const adapters   = _tryRequire("./adapterContextBridge.cjs");

    const warnings  = [];
    const blockers  = [];
    let   confidence = 100;

    // Pipeline exists?
    const p = pipeline ? pipeline.getPipeline(pipelineName) : null;
    if (!p) return { ok: false, error: `Pipeline "${pipelineName}" not found` };

    // Runtime pressure
    const pres = pressure ? pressure.computePressure() : null;
    if (pres) {
        if (pres.level === "critical") { blockers.push(`Runtime pressure is CRITICAL (score=${pres.score})`); confidence -= 40; }
        else if (pres.level === "high") { warnings.push(`Runtime pressure is HIGH (score=${pres.score}) — consider waiting`); confidence -= 20; }
        else if (pres.level === "elevated") { warnings.push(`Runtime pressure elevated (score=${pres.score})`); confidence -= 10; }
    }

    // Runtime mode
    const mode = modes ? modes.getActiveMode() : null;
    if (mode) {
        if (mode.name === "safe-mode") { warnings.push("Safe-mode is active — deployment execution will be rate-limited"); confidence -= 10; }
        if (mode.name === "diagnostics") { warnings.push("Diagnostics mode active — not recommended for production deployment"); confidence -= 15; }
    }

    // Adapter health
    if (adapters) {
        try {
            const snap = adapters.snapshot ? adapters.snapshot() : null;
            if (snap && snap.adapters) {
                const degraded = snap.adapters.filter(a => a.degraded);
                if (degraded.length > 0) {
                    warnings.push(`${degraded.length} adapter(s) degraded: ${degraded.map(a => a.name || a.id).join(", ")}`);
                    confidence -= degraded.length * 10;
                }
            }
        } catch {}
    }

    // Requires approval?
    if (p.requiresApproval) {
        warnings.push(`Pipeline "${pipelineName}" requires explicit approval before execution`);
    }

    // CRITICAL stages
    const critStages = p.stages.filter(s => s.approvalLevel === "CRITICAL");
    if (critStages.length > 0) {
        warnings.push(`${critStages.length} CRITICAL stage(s): ${critStages.map(s => s.name).join(", ")}`);
        confidence -= critStages.length * 5;
    }

    confidence = Math.max(0, Math.min(100, confidence));

    const label =
        confidence >= 80 ? "READY"         :
        confidence >= 60 ? "CAUTION"        :
        confidence >= 40 ? "HIGH_RISK"      : "BLOCKED";

    return {
        ok:           blockers.length === 0,
        pipeline:     pipelineName,
        label,
        confidence,
        stages:       p.stages.map(s => ({ name: s.name, approvalLevel: s.approvalLevel, rollbackSafe: s.rollbackSafe })),
        rollbackChain: p.rollbackChain,
        warnings,
        blockers,
        requiresApproval: p.requiresApproval,
        summary: `${label} (confidence=${confidence}%) — ${blockers.length} blocker(s), ${warnings.length} warning(s)`,
    };
}

// ── Rollback preview ──────────────────────────────────────────────────────────

/**
 * Preview what rollback would do for a given pipeline run.
 * Does NOT execute rollback — pure informational.
 */
function rollbackPreview(runId) {
    const pipeline = _tryRequire("./deploymentPipeline.cjs");
    if (!pipeline) return { ok: false, error: "deploymentPipeline unavailable" };

    const run = pipeline.getRun(runId);
    if (!run) return { ok: false, error: `Run ${runId} not found` };

    const pDef = pipeline.getPipeline(run.pipeline);
    const rollbackChain = pDef ? pDef.rollbackChain : null;

    const completedStages = run.stages.filter(s => s.state === "passed" || s.state === "running");
    const safeToRollback  = completedStages.every(s => {
        const stagedef = pDef ? pDef.stages.find(sd => sd.name === s.name) : null;
        return stagedef ? stagedef.rollbackSafe : false;
    });

    return {
        ok:              true,
        runId,
        pipeline:        run.pipeline,
        currentState:    run.state,
        alreadyRolledBack: run.rollbackTriggered,
        rollbackChain,
        completedStages: completedStages.map(s => s.name),
        safeToRollback,
        warning:         !safeToRollback ? "Some completed stages are not rollback-safe — manual intervention may be required" : null,
        action:          run.rollbackTriggered
            ? "Already rolled back"
            : rollbackChain
            ? `Execute chain: ${rollbackChain}`
            : "No rollback chain defined — manual rollback required",
    };
}

// ── Environment warnings ──────────────────────────────────────────────────────

/**
 * Check environment for deployment risks before proceeding.
 */
function environmentWarnings() {
    const pressure = _tryRequire("./runtimePressureMonitor.cjs");
    const modes    = _tryRequire("./runtimeModes.cjs");
    const session  = _tryRequire("./engineeringSession.cjs");
    const dlq      = _tryRequire("./deadLetterQueue.cjs");

    const warnings = [];

    if (pressure) {
        const p = pressure.computePressure();
        if (p.level !== "normal" && p.level !== "low") {
            warnings.push({ severity: p.level === "critical" ? "blocker" : "warning", message: `Runtime pressure: ${p.level} (score=${p.score})` });
        }
    }

    if (modes) {
        const m = modes.getActiveMode();
        if (m.name !== "development" && m.name !== "deployment") {
            warnings.push({ severity: "warning", message: `Non-deployment runtime mode active: ${m.name}` });
        }
    }

    if (session) {
        const blocked = session.list({ limit: 20 }).filter(s => s.state === "blocked");
        if (blocked.length > 0) {
            warnings.push({ severity: "warning", message: `${blocked.length} blocked session(s) in runtime — investigate before deploying` });
        }
    }

    if (dlq) {
        try {
            const q = dlq.list ? dlq.list({ limit: 5 }) : [];
            if (q.length >= 50) {
                warnings.push({ severity: "warning", message: `Dead letter queue has ${q.length}+ entries — runtime may be unstable` });
            }
        } catch {}
    }

    const heapMb = Math.round(process.memoryUsage().heapUsed / 1_048_576);
    if (heapMb > 300) {
        warnings.push({ severity: "warning", message: `Heap at ${heapMb}MB — memory pressure before deployment` });
    }

    return {
        clear:    warnings.length === 0,
        warnings,
        blockers: warnings.filter(w => w.severity === "blocker").length,
        summary:  warnings.length === 0 ? "Environment clear for deployment" : `${warnings.length} warning(s) — review before proceeding`,
    };
}

// ── Deployment readiness indicator ────────────────────────────────────────────

/**
 * Top-level deployment readiness for operator UI header.
 */
function readinessIndicator(pipelineName) {
    const env      = environmentWarnings();
    const preflight = pipelineName ? preflightSummary(pipelineName) : null;

    const ready = env.clear && (!preflight || preflight.ok);
    const confidence = preflight ? preflight.confidence : (env.clear ? 100 : 60);

    return {
        ready,
        confidence,
        environmentClear: env.clear,
        environmentWarnings: env.warnings.length,
        preflightLabel:   preflight ? preflight.label : null,
        preflightBlockers: preflight ? preflight.blockers.length : 0,
        summary: ready ? `Deployment ready (${confidence}% confidence)` : `Deployment blocked — ${env.blockers} env blocker(s)`,
    };
}

module.exports = { preflightSummary, rollbackPreview, environmentWarnings, readinessIndicator };
