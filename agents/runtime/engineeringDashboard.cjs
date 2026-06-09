"use strict";
/**
 * Phase 550 — Engineering Operations Dashboard
 *
 * Unified operational dashboard: active workflows, runtime pressure,
 * adapter health, deployment readiness, recovery state, replay continuity.
 *
 * Calm UI, low-noise, operational clarity.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Full dashboard ────────────────────────────────────────────────────────────

function getDashboard() {
    const pressure  = _tryRequire("./runtimePressureMonitor.cjs");
    const modes     = _tryRequire("./runtimeModes.cjs");
    const session   = _tryRequire("./engineeringSession.cjs");
    const deployCC  = _tryRequire("./deploymentCommandCenter.cjs");
    const recovery  = _tryRequire("./recoveryCenter.cjs");
    const analytics = _tryRequire("./operatorAnalytics.cjs");
    const stability = _tryRequire("./stabilityLayer.cjs");
    const intel     = _tryRequire("./failureIntelligenceEngine.cjs");
    const adapters  = _tryRequire("./adapterHealth.cjs");

    // ── Runtime
    const pres   = pressure ? pressure.computePressure()  : { level: "nominal", score: 0 };
    const mode   = modes    ? modes.getActiveMode().name  : "unknown";
    const drift  = stability ? stability.detectDrift()    : { ok: true, issues: [] };

    // ── Sessions
    let activeSessions = 0, blockedSessions = 0;
    if (session) {
        try {
            const all    = session.listSessions ? session.listSessions() : [];
            activeSessions  = all.filter(s => s.state === "active").length;
            blockedSessions = all.filter(s => s.state === "blocked").length;
        } catch {}
    }

    // ── Deployment
    const deploySnap = deployCC ? deployCC.snapshot() : null;

    // ── Recovery
    const recSnap   = recovery ? recovery.recoverySnapshot() : null;
    const activeRec = recSnap  ? recSnap.activeRecovery : null;

    // ── Analytics
    let analyticsSnap = null;
    if (analytics) {
        try { analyticsSnap = analytics.summary(); } catch {}
    }

    // ── Failure intelligence
    let unstableWorkflows = [];
    if (intel) {
        try {
            const uw = intel.detectUnstableWorkflows();
            if (uw.available) unstableWorkflows = uw.unstable.slice(0, 3);
        } catch {}
    }

    // ── Adapter health
    let adapterSummary = null;
    if (adapters) {
        try { adapterSummary = adapters.healthSummary ? adapters.healthSummary() : null; } catch {}
    }

    // ── Signal
    const criticalIssues = [];
    if (pres.level === "critical")          criticalIssues.push("Runtime pressure: CRITICAL");
    if (!drift.ok)                          criticalIssues.push("Runtime drift detected");
    if (blockedSessions > 0)                criticalIssues.push(`${blockedSessions} blocked session(s)`);
    if (deploySnap && deploySnap.failed > 0) criticalIssues.push(`${deploySnap.runs.failed} failed deployment(s)`);
    if (recSnap && recSnap.urgentIssues.length > 0) criticalIssues.push(`${recSnap.urgentIssues.length} urgent recovery issue(s)`);

    const signal =
        criticalIssues.length > 2 ? "critical" :
        criticalIssues.length > 0 ? "attention" :
        pres.level === "high"     ? "elevated" : "healthy";

    return {
        signal,
        criticalIssues,
        runtime: {
            mode,
            pressureLevel: pres.level,
            pressureScore: pres.score,
            driftOk:       drift.ok,
            driftIssues:   (drift.issues || []).length,
            heapMB:        Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        },
        sessions: {
            active:  activeSessions,
            blocked: blockedSessions,
        },
        deployment: deploySnap ? {
            trust:            deploySnap.trust,
            trustLabel:       deploySnap.trustLabel,
            active:           deploySnap.runs.active,
            failed:           deploySnap.runs.failed,
            awaitingApproval: deploySnap.runs.awaitingApproval,
            pressureLevel:    deploySnap.pressureLevel,
        } : { available: false },
        recovery: {
            activeRecovery:  activeRec ? activeRec.name : null,
            urgentIssues:    recSnap ? recSnap.urgentIssues.length : 0,
        },
        workflows: {
            unstable: unstableWorkflows.map(w => ({ name: w.chainName, successRate: w.successRate })),
            fatigue:  analyticsSnap ? analyticsSnap.fatigue.level : null,
        },
        adapters:  adapterSummary,
        ts:        new Date().toISOString(),
    };
}

// ── Compact status line ───────────────────────────────────────────────────────

function statusLine() {
    const d = getDashboard();
    const parts = [
        `signal=${d.signal}`,
        `pressure=${d.runtime.pressureLevel}(${d.runtime.pressureScore})`,
        `sessions=${d.sessions.active}active/${d.sessions.blocked}blocked`,
        `deploy-trust=${d.deployment.trust ?? "?"}`,
        `heap=${d.runtime.heapMB}MB`,
        `mode=${d.runtime.mode}`,
    ];
    if (d.recovery.urgentIssues > 0) parts.push(`recovery-issues=${d.recovery.urgentIssues}`);
    if (d.workflows.unstable.length > 0) parts.push(`unstable-workflows=${d.workflows.unstable.length}`);
    return parts.join(" | ");
}

// ── Focus view — only actionable items ───────────────────────────────────────

function focusDashboard() {
    const d = getDashboard();
    const items = [];

    if (d.criticalIssues.length > 0) items.push(...d.criticalIssues.map(i => ({ priority: "high", item: i })));
    if (d.deployment.awaitingApproval > 0) items.push({ priority: "high", item: `${d.deployment.awaitingApproval} deployment(s) await approval` });
    if (d.deployment.failed > 0) items.push({ priority: "high", item: `${d.deployment.failed} failed deployment(s) need rollback` });
    if (d.runtime.driftIssues > 0) items.push({ priority: "medium", item: `${d.runtime.driftIssues} drift issue(s) detected` });
    if (d.workflows.unstable.length > 0) items.push({ priority: "medium", item: `${d.workflows.unstable.length} unstable workflow(s): ${d.workflows.unstable.map(w => w.name).join(", ")}` });

    return {
        signal:   d.signal,
        items,
        count:    items.length,
        allClear: items.length === 0,
        ts:       d.ts,
    };
}

module.exports = { getDashboard, statusLine, focusDashboard };
