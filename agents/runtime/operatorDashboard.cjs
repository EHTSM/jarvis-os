"use strict";
/**
 * Phase 485 — Engineering Session Dashboard
 *
 * Single-call snapshot of operator-relevant runtime state:
 * active sessions, blocked workflows, degraded runtime,
 * recovery pressure, deployment readiness, adapter health.
 *
 * Designed for calm, low-noise, operationally useful rendering.
 * All reads — no state mutation.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Section builders ──────────────────────────────────────────────────────────

function _sessions() {
    const sm = _tryRequire("./engineeringSession.cjs");
    if (!sm) return { available: false };
    const all     = sm.list({ limit: 20 });
    const active  = all.filter(s => s.state === "active");
    const blocked = all.filter(s => s.state === "blocked");
    const paused  = all.filter(s => s.state === "paused");
    return {
        available:    true,
        total:        all.length,
        active:       active.length,
        blocked:      blocked.length,
        paused:       paused.length,
        activeSessions: active.slice(0, 5).map(s => ({
            id:        s.id,
            goal:      s.goal.slice(0, 60),
            state:     s.state,
            updatedAt: s.updatedAt,
        })),
        blockedSessions: blocked.slice(0, 3).map(s => ({
            id:    s.id,
            goal:  s.goal.slice(0, 60),
            state: s.state,
        })),
        alert: blocked.length > 0 ? `${blocked.length} blocked session(s) require attention` : null,
    };
}

function _pressure() {
    const pm = _tryRequire("./runtimePressureMonitor.cjs");
    if (!pm) return { available: false };
    const p = pm.computePressure();
    return {
        available:    true,
        score:        p.score,
        level:        p.level,
        factors:      p.factors || [],
        alert:        ["high", "critical"].includes(p.level) ? `Pressure ${p.level.toUpperCase()} — consider safe-mode` : null,
    };
}

function _adapters() {
    const bridge = _tryRequire("./adapterContextBridge.cjs");
    if (!bridge) return { available: false };
    try {
        const snap = bridge.snapshot ? bridge.snapshot() : null;
        if (!snap) return { available: true, degraded: 0, total: 0, alert: null };
        const adapters  = snap.adapters || [];
        const degraded  = adapters.filter(a => a.degraded);
        return {
            available:        true,
            total:            adapters.length,
            degraded:         degraded.length,
            degradedAdapters: degraded.map(a => a.name || a.id),
            alert:            degraded.length > 0 ? `${degraded.length} adapter(s) degraded` : null,
        };
    } catch {
        return { available: true, degraded: 0, total: 0, alert: null };
    }
}

function _deployments() {
    const dp = _tryRequire("./deploymentPipeline.cjs");
    if (!dp) return { available: false };
    const runs         = dp.listRuns({ limit: 10 });
    const awaitingApproval = runs.filter(r => r.state === "awaiting-approval");
    const running      = runs.filter(r => r.state === "running");
    const failed       = runs.filter(r => r.state === "failed");
    const recent       = runs.slice(0, 5).map(r => ({
        id:       r.id,
        pipeline: r.pipeline,
        state:    r.state,
        dryRun:   r.dryRun,
    }));
    return {
        available:          true,
        totalRecent:        runs.length,
        awaitingApproval:   awaitingApproval.length,
        running:            running.length,
        failed:             failed.length,
        recentRuns:         recent,
        alert:              awaitingApproval.length > 0 ? `${awaitingApproval.length} deployment(s) awaiting approval` : null,
    };
}

function _mode() {
    const modes = _tryRequire("./runtimeModes.cjs");
    if (!modes) return { available: false };
    const m = modes.getActiveMode();
    return {
        available:    true,
        name:         m.name,
        label:        m.label,
        isSafeMode:   m.name === "safe-mode",
        isDiagnostics: m.name === "diagnostics",
        config: {
            maxBurst:      m.config?.maxBurst,
            maxConcurrency: m.config?.maxConcurrency,
            autoRetry:     m.config?.autoRetry,
            probeRequired: m.config?.probeRequired,
        },
        alert: m.name === "safe-mode" ? "Safe-mode active — execution rate limited" : null,
    };
}

function _workspace() {
    const ws = _tryRequire("./projectWorkspace.cjs");
    if (!ws) return { available: false };
    const active = ws.getActiveWorkspace();
    const list   = ws.listWorkspaces();
    return {
        available:  true,
        active:     active.name,
        label:      active.label,
        total:      list.length,
        profile:    active.profile,
    };
}

function _memory() {
    const heapMb = Math.round(process.memoryUsage().heapUsed / 1_048_576);
    return {
        heapMb,
        alert: heapMb > 300 ? `Heap ${heapMb}MB — approaching limit` : null,
    };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Full operator dashboard snapshot.
 * Returns a structured object ready for UI rendering.
 */
function getDashboard() {
    const sessions    = _sessions();
    const pressure    = _pressure();
    const adapters    = _adapters();
    const deployments = _deployments();
    const mode        = _mode();
    const workspace   = _workspace();
    const memory      = _memory();

    // Collect all alerts — these are the only things an operator needs to act on
    const alerts = [
        sessions.alert,
        pressure.alert,
        adapters.alert,
        deployments.alert,
        mode.alert,
        memory.alert,
    ].filter(Boolean);

    // Derive overall health signal
    const healthLevel =
        alerts.some(a => a.toLowerCase().includes("critical")) ? "critical" :
        pressure.level === "high" || adapters.degraded > 0 || sessions.blocked > 0 ? "degraded" :
        alerts.length > 0 ? "attention" : "healthy";

    return {
        health:      healthLevel,
        alerts,
        sessions,
        pressure,
        adapters,
        deployments,
        mode,
        workspace,
        memory,
        ts:          new Date().toISOString(),
    };
}

/**
 * Compact summary string for quick status lines.
 */
function getSummaryLine() {
    const d = getDashboard();
    const parts = [
        `health=${d.health}`,
        `pressure=${d.pressure.level || "?"}(${d.pressure.score ?? "?"})`,
        `sessions=${d.sessions.active ?? "?"}active/${d.sessions.blocked ?? "?"}blocked`,
        `mode=${d.mode.name || "?"}`,
        `heap=${d.memory.heapMb}MB`,
    ];
    if (d.alerts.length) parts.push(`alerts=${d.alerts.length}`);
    return parts.join(" | ");
}

module.exports = { getDashboard, getSummaryLine };
