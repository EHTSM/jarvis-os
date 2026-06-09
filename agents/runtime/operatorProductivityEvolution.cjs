"use strict";
/**
 * Phase 627 — Operator Productivity Evolution
 *
 * Improves: debugging speed, deployment flow, replay readability,
 * operational clarity, workflow discoverability, execution calmness.
 * Reduces: operator fatigue, workflow clutter, warning overload.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Debugging speed metrics ───────────────────────────────────────────────────

function debuggingSpeedReport() {
    const dwe = _tryRequire("./debugWorkflowEngine.cjs");
    if (!dwe) return { ok: false, error: "debugWorkflowEngine unavailable" };

    const sessions = dwe.listSessions({ limit: 20 });
    const closed   = sessions.filter(s => s.durationMs);
    const resolved = closed.filter(s => s.resolved);

    const avgMs     = closed.length > 0 ? Math.round(closed.reduce((s, x) => s + x.durationMs, 0) / closed.length) : null;
    const resRate   = closed.length > 0 ? Math.round(resolved.length / closed.length * 100) : null;

    return {
        ok:              true,
        sessionCount:    sessions.length,
        closedCount:     closed.length,
        resolvedCount:   resolved.length,
        resolutionRate:  resRate !== null ? resRate + "%" : "n/a",
        avgDurationMs:   avgMs,
        avgDurationMin:  avgMs ? Math.round(avgMs / 60000 * 10) / 10 : null,
        grade:           resRate >= 80 ? "A" : resRate >= 60 ? "B" : resRate >= 40 ? "C" : "D",
    };
}

// ── Deployment flow quality ───────────────────────────────────────────────────

function deploymentFlowReport() {
    const dwe = _tryRequire("./deployWorkflowEngine.cjs");
    if (!dwe) return { ok: false, error: "deployWorkflowEngine unavailable" };

    const deployments = dwe.listDeployments({ limit: 20 });
    const completed   = deployments.filter(d => d.phase === "completed");
    const failed      = deployments.filter(d => d.phase === "failed");
    const rolledBack  = deployments.filter(d => d.phase === "rolled-back");

    const successRate = deployments.length > 0 ? Math.round(completed.length / deployments.length * 100) : null;
    const avgDuration = completed.length > 0 ? Math.round(completed.reduce((s, d) => s + (d.durationMs || 0), 0) / completed.length) : null;

    return {
        ok:           true,
        total:        deployments.length,
        completed:    completed.length,
        failed:       failed.length,
        rolledBack:   rolledBack.length,
        successRate:  successRate !== null ? successRate + "%" : "n/a",
        avgDurationMs: avgDuration,
        grade:        successRate >= 90 ? "A" : successRate >= 75 ? "B" : successRate >= 60 ? "C" : "D",
    };
}

// ── Replay readability ────────────────────────────────────────────────────────

function formatReplayForReview(replayId) {
    const ers = _tryRequire("./executionReplaySystem.cjs");
    if (!ers) return { ok: false, error: "executionReplaySystem unavailable" };

    const replay = ers.getReplay(replayId);
    if (!replay) return { ok: false, error: "replay not found" };

    const lines = [
        `Replay: ${replay.name || "unnamed"}`,
        `Goal:   ${replay.goal || "n/a"}`,
        `Steps:  ${replay.steps.length}`,
        `Runs:   ${replay.replayCount}`,
        ``,
        ...replay.steps.map(s => `  ${s.order + 1}. [${s.idempotent ? "safe" : "APPROVAL"}] ${s.label}`),
    ];

    return { ok: true, replayId, formatted: lines.join("\n"), lineCount: lines.length };
}

// ── Workflow discoverability ──────────────────────────────────────────────────

function discoverWorkflows(goal = "") {
    const suggestions = [];

    // From automation catalog
    const dea = _tryRequire("./dailyEngineeringAutomation.cjs");
    if (dea) {
        const catalog = dea.catalogList();
        catalog.forEach(a => {
            if (!goal || a.description.toLowerCase().includes(goal.toLowerCase())) {
                suggestions.push({ type: "automation", name: a.name, description: a.description, stepCount: a.stepCount });
            }
        });
    }

    // From goal patterns
    const ege = _tryRequire("./engineeringGoalExecution.cjs");
    if (ege && goal) {
        const goalPatterns = ege.GOAL_PATTERNS || [];
        goalPatterns.forEach(p => {
            if (p.pattern.test(goal)) {
                suggestions.push({ type: "goal", name: p.name, description: p.outcome, chain: p.chain });
            }
        });
    }

    return { ok: true, goal, suggestions, count: suggestions.length };
}

// ── Warning load reduction ────────────────────────────────────────────────────

function filterClutter(warnings = [], sessionId = "default") {
    const ec = _tryRequire("./executionCalmness.cjs");
    if (!ec) {
        // Fallback: deduplicate by message text
        const seen = new Set();
        return warnings.filter(w => {
            const key = typeof w === "string" ? w : w.message || JSON.stringify(w);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    return warnings.filter(w => {
        const severity = w.severity || "info";
        const key      = typeof w === "string" ? w.slice(0, 50) : (w.key || w.message || "").slice(0, 50);
        try { return ec.evaluateWarning(sessionId, key, severity).show; }
        catch { return true; }
    });
}

// ── Operator fatigue score ────────────────────────────────────────────────────

function fatigueSummary(sessionId = null) {
    const ec  = _tryRequire("./executionCalmness.cjs");
    let calm   = null;
    if (ec && sessionId) {
        try { calm = ec.clarityReport(sessionId); } catch {}
    }

    const dwe  = _tryRequire("./debugWorkflowEngine.cjs");
    const open = dwe ? dwe.activeSessions().length : 0;

    const fatigue = open >= 3 ? "high" : open >= 1 ? "medium" : "low";

    return {
        ok:             true,
        fatigue,
        openDebugCount: open,
        calmness:       calm,
        recommendation: fatigue === "high" ? "Close or consolidate open debug sessions before starting new work" :
                        fatigue === "medium" ? "Consider resolving active session before adding new work" :
                        "Workload healthy",
    };
}

// ── Productivity summary ──────────────────────────────────────────────────────

function productivitySummary() {
    const debug  = debuggingSpeedReport();
    const deploy = deploymentFlowReport();
    const fatigue = fatigueSummary();

    return {
        ok:      true,
        debug:   debug.ok ? { grade: debug.grade, resolutionRate: debug.resolutionRate, avgMin: debug.avgDurationMin } : null,
        deploy:  deploy.ok ? { grade: deploy.grade, successRate: deploy.successRate } : null,
        fatigue: fatigue.fatigue,
        summary: [
            debug.ok  ? `Debug: ${debug.grade} (${debug.resolutionRate} resolved)` : "Debug: n/a",
            deploy.ok ? `Deploy: ${deploy.grade} (${deploy.successRate} success)` : "Deploy: n/a",
            `Fatigue: ${fatigue.fatigue}`,
        ].join(" | "),
    };
}

module.exports = { debuggingSpeedReport, deploymentFlowReport, formatReplayForReview, discoverWorkflows, filterClutter, fatigueSummary, productivitySummary };
