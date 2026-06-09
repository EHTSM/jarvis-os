"use strict";
/**
 * Phase 607 — Daily Productivity Dashboard
 *
 * Single-call morning briefing: active sessions, pending deployments,
 * trust score, workflow health, today's metrics, suggested next actions.
 * Read-only aggregation — no side effects.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Morning briefing ──────────────────────────────────────────────────────────

function morningBriefing(sessionId = null) {
    const now     = new Date();
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

    // Gather all subsystem data
    const dwe  = _tryRequire("./debugWorkflowEngine.cjs");
    const dplw = _tryRequire("./deployWorkflowEngine.cjs");
    const dv   = _tryRequire("./dailyEngineeringValidation.cjs");
    const tl   = _tryRequire("./operationalTrustLayer.cjs");
    const bwm  = _tryRequire("./browserWorkflowMaturity.cjs");
    const ws   = _tryRequire("./workflowSurvivability.cjs");
    const dpm  = _tryRequire("./dailyProductivityMode.cjs");
    const ec   = _tryRequire("./executionConfidence.cjs");

    let debugSessions = null, deployments = null, todayMetrics = null;
    let trustScore = null, browserHealth = null, survivability = null;
    let briefing = null, confidence = null;

    if (dwe)  try { debugSessions = dwe.activeSessions(); } catch {}
    if (dplw) try { deployments   = dplw.listDeployments({ status: "open" }); } catch {}
    if (dv)   try { todayMetrics  = dv.todayReport(); } catch {}
    if (tl)   try { trustScore    = tl.getTrustScore(); } catch {}
    if (bwm)  try { browserHealth = bwm.maturityReport(); } catch {}
    if (ws)   try { survivability = ws.survivabilityScore(); } catch {}
    if (dpm && sessionId) try { briefing = dpm.dailyBriefing(sessionId); } catch {}
    if (ec)   try { confidence    = ec.confidenceSummary({ priorSuccesses: todayMetrics?.deploys || 0, priorFailures: 0 }); } catch {}

    // Suggested actions
    const actions = _suggestActions({ debugSessions, deployments, todayMetrics, trustScore, survivability });

    return {
        ok:          true,
        timestamp:   `${dateStr} ${timeStr}`,
        sessionId,

        // Active work
        activeDebugSessions:  debugSessions?.length ?? 0,
        openDeployments:      deployments?.length ?? 0,

        // Health
        trustScore:     trustScore ? { score: trustScore.score, grade: trustScore.grade } : null,
        browserHealth:  browserHealth?.health || null,
        survivability:  survivability ? { score: survivability.score, grade: survivability.grade } : null,
        confidence:     confidence || null,

        // Today's metrics
        todayMetrics,

        // Suggested next actions
        suggestedActions: actions,

        // Extended briefing from dailyProductivityMode
        extendedBriefing: briefing || null,

        summary: _buildSummary({ debugSessions, deployments, trustScore, todayMetrics }),
    };
}

function _suggestActions({ debugSessions, deployments, todayMetrics, trustScore, survivability }) {
    const actions = [];

    if (debugSessions?.length > 0) {
        actions.push({ priority: "high", action: `Resume ${debugSessions.length} open debug session(s)`, type: "debug" });
    }
    if (deployments?.length > 0) {
        actions.push({ priority: "high", action: `Review ${deployments.length} pending deployment(s)`, type: "deploy" });
    }
    if (trustScore && trustScore.score < 55) {
        actions.push({ priority: "medium", action: "Trust score low — review recent failures before deploying", type: "trust" });
    }
    if (survivability && survivability.stale > 0) {
        actions.push({ priority: "medium", action: `${survivability.stale} stale workflow(s) — cleanup or resume`, type: "survivability" });
    }
    if (todayMetrics?.debugSessions === 0 && todayMetrics?.patches === 0) {
        actions.push({ priority: "low", action: "Fresh start — run env-bootstrap-full chain to validate environment", type: "bootstrap" });
    }

    if (actions.length === 0) {
        actions.push({ priority: "low", action: "Platform healthy — proceed with planned work", type: "nominal" });
    }
    return actions;
}

function _buildSummary({ debugSessions, deployments, trustScore, todayMetrics }) {
    const parts = [];
    if (debugSessions?.length)  parts.push(`${debugSessions.length} debug open`);
    if (deployments?.length)    parts.push(`${deployments.length} deploy pending`);
    if (trustScore)             parts.push(`Trust: ${trustScore.score}`);
    if (todayMetrics)           parts.push(`Today: ${todayMetrics.debugSessions || 0}d/${todayMetrics.deploys || 0}p`);
    return parts.length > 0 ? parts.join(" | ") : "Platform nominal";
}

// ── Quick status ──────────────────────────────────────────────────────────────

function quickStatus() {
    const tl  = _tryRequire("./operationalTrustLayer.cjs");
    const dv  = _tryRequire("./dailyEngineeringValidation.cjs");
    const dwe = _tryRequire("./debugWorkflowEngine.cjs");

    const trust   = tl  ? (tl.getTrustScore().score)                    : null;
    const today   = dv  ? (dv.todayReport().overallTrust)               : null;
    const debug   = dwe ? (dwe.activeSessions().length)                  : null;

    return {
        trust,
        todayTrust: today,
        activeDebugSessions: debug,
        ts: Date.now(),
    };
}

// ── Workflow suggestions ──────────────────────────────────────────────────────

function suggestWorkflows(goal = "") {
    const dpm = _tryRequire("./dailyProductivityMode.cjs");
    if (dpm) {
        try { return dpm.discoverWorkflows(goal); } catch {}
    }

    const g = goal.toLowerCase();
    if (/debug|error|crash|fail/i.test(g))      return { chain: "full-debug-session",    reason: "Goal suggests debugging" };
    if (/deploy|release|ship|push/i.test(g))    return { chain: "deploy-preflight-full", reason: "Goal suggests deployment" };
    if (/dep|package|install|module/i.test(g))  return { chain: "dep-repair-full",       reason: "Goal suggests dependency work" };
    if (/recover|restart|heal|down/i.test(g))   return { chain: "runtime-recovery-full", reason: "Goal suggests recovery" };
    return { chain: "env-bootstrap-full", reason: "Default: bootstrap and validate environment" };
}

module.exports = { morningBriefing, quickStatus, suggestWorkflows };
