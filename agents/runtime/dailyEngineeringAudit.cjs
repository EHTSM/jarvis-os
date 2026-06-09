"use strict";
/**
 * Phase 614 — Daily Engineering Audit
 *
 * End-of-day automated audit: session closure rate, deployment outcomes,
 * trust score trends, survivability health, outstanding debug sessions,
 * actionable recommendations for next session.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Audit checks ──────────────────────────────────────────────────────────────

function _checkOpenSessions() {
    const dwe = _tryRequire("./debugWorkflowEngine.cjs");
    if (!dwe) return { name: "open-debug-sessions", ok: true, detail: "module unavailable", value: null };

    const open = dwe.activeSessions();
    const ok   = open.length <= 2; // 0-2 open is fine
    return { name: "open-debug-sessions", ok, value: open.length, detail: ok ? null : `${open.length} debug sessions left open — consider closing or recording state` };
}

function _checkOpenDeployments() {
    const dwe = _tryRequire("./deployWorkflowEngine.cjs");
    if (!dwe) return { name: "open-deployments", ok: true, detail: "module unavailable", value: null };

    const open = dwe.listDeployments({ status: "open" });
    const stalled = open.filter(d => d.phase === "executing" && Date.now() - d.startedAt > 60 * 60 * 1000);
    const ok = stalled.length === 0;
    return { name: "open-deployments", ok, value: open.length, stalledCount: stalled.length, detail: ok ? null : `${stalled.length} deployment(s) stalled >1h` };
}

function _checkTrustScore() {
    const otl = _tryRequire("./operationalTrustLayer.cjs");
    if (!otl) return { name: "trust-score", ok: true, detail: "module unavailable", value: null };

    const trust = otl.getTrustScore();
    const ok    = trust.score >= 50;
    return { name: "trust-score", ok, value: trust.score, grade: trust.grade, detail: ok ? null : `Trust score ${trust.score} below threshold — review recent failures` };
}

function _checkSurvivability() {
    const ws = _tryRequire("./workflowSurvivability.cjs");
    if (!ws) return { name: "workflow-survivability", ok: true, detail: "module unavailable", value: null };

    const score = ws.survivabilityScore();
    const ok    = score.score >= 50;
    return { name: "workflow-survivability", ok, value: score.score, detail: ok ? null : `Survivability score ${score.score} — workflows not recovering from interrupts` };
}

function _checkDailyMetrics() {
    const dv = _tryRequire("./dailyEngineeringValidation.cjs");
    if (!dv) return { name: "daily-metrics", ok: true, detail: "module unavailable", value: null };

    const report = dv.todayReport();
    const ok = report.overallTrust >= 60;
    return { name: "daily-metrics", ok, value: report.overallTrust, detail: ok ? null : `Daily trust ${report.overallTrust}% — below healthy threshold of 60%`, metrics: report };
}

function _checkEnvironment() {
    const eeh = _tryRequire("./engineeringEnvironmentHealth.cjs");
    if (!eeh) return { name: "environment-health", ok: true, detail: "module unavailable", value: null };

    const env = eeh.scanEnvironment();
    return { name: "environment-health", ok: env.ok, value: env.score, detail: env.ok ? null : `Environment: ${env.warnings.join("; ")}` };
}

function _checkStaleWorkflows() {
    const ws = _tryRequire("./workflowSurvivability.cjs");
    if (!ws) return { name: "stale-workflows", ok: true, detail: "module unavailable", value: null };

    const stale = ws.detectStaleWorkflows();
    const ok    = stale.staleCount === 0;
    return { name: "stale-workflows", ok, value: stale.staleCount, detail: ok ? null : `${stale.staleCount} stale workflow(s) detected — cleanup recommended` };
}

// ── Recommendations ───────────────────────────────────────────────────────────

function _buildRecommendations(checks) {
    const failed = checks.filter(c => !c.ok && c.detail);
    const recs   = [];

    failed.forEach(c => {
        switch (c.name) {
            case "open-debug-sessions":
                recs.push({ priority: "medium", action: "Close or save state for open debug sessions", detail: c.detail });
                break;
            case "open-deployments":
                recs.push({ priority: "high", action: "Resolve stalled deployments — consider rollback", detail: c.detail });
                break;
            case "trust-score":
                recs.push({ priority: "medium", action: "Review recent failure signals, run successful patch or deploy to rebuild trust", detail: c.detail });
                break;
            case "workflow-survivability":
                recs.push({ priority: "low", action: "Enable checkpoint saves in long-running workflows", detail: c.detail });
                break;
            case "daily-metrics":
                recs.push({ priority: "medium", action: "Review today's debug/deploy outcomes — investigate failures", detail: c.detail });
                break;
            case "environment-health":
                recs.push({ priority: "high", action: "Fix environment issues before next session", detail: c.detail });
                break;
            case "stale-workflows":
                recs.push({ priority: "low", action: "Run cleanup on stale workflows", detail: c.detail });
                break;
            default:
                recs.push({ priority: "low", action: c.detail, detail: "" });
        }
    });

    if (recs.length === 0) {
        recs.push({ priority: "info", action: "Platform clean — no outstanding issues", detail: "" });
    }

    return recs.sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2, info: 3 };
        return (order[a.priority] || 3) - (order[b.priority] || 3);
    });
}

// ── Run audit ─────────────────────────────────────────────────────────────────

function runAudit() {
    const checks = [
        _checkOpenSessions(),
        _checkOpenDeployments(),
        _checkTrustScore(),
        _checkSurvivability(),
        _checkDailyMetrics(),
        _checkEnvironment(),
        _checkStaleWorkflows(),
    ];

    const passed          = checks.filter(c => c.ok).length;
    const failed          = checks.filter(c => !c.ok);
    const recommendations = _buildRecommendations(checks);
    const clean           = failed.length === 0;

    return {
        ok:              true,
        clean,
        passed,
        total:           checks.length,
        checks,
        recommendations,
        highPriority:    recommendations.filter(r => r.priority === "high").length,
        summary:         `Daily audit: ${passed}/${checks.length} clean | ${recommendations.filter(r => r.priority === "high").length} high-priority action(s)`,
    };
}

module.exports = { runAudit };
