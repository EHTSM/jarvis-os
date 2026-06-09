"use strict";
/**
 * Phase 655 — Engineering Productivity Intelligence
 *
 * Improves debugging productivity, deployment efficiency, workflow discoverability,
 * replay readability, operational calmness. Reduces operator fatigue, clutter, warning overload.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Debugging productivity ────────────────────────────────────────────────────

function debuggingProductivity({ windowDays = 7 } = {}) {
    const sdi = _tryRequire("./smartDebugIntelligence.cjs");
    let correlation = null, repeated = null;
    if (sdi) {
        try { correlation = sdi.correlateFailures({ windowMs: windowDays * 86400000 }); } catch {}
        try { repeated    = sdi.detectRepeatedFailures({ windowMs: windowDays * 86400000 }); } catch {}
    }

    const tei = _tryRequire("./terminalExecutionIntelligence.cjs");
    let execSummary = null;
    if (tei) { try { execSummary = tei.executionIntelSummary({ windowMs: windowDays * 86400000 }); } catch {} }

    const health = (execSummary?.successRate && parseInt(execSummary.successRate) >= 70) ? "healthy" : "watch";
    return {
        ok: true,
        windowDays,
        correlation,
        repeatedFailures: repeated?.count || 0,
        execSummary,
        health,
        suggestions: repeated?.count > 0 ? [`${repeated.count} repeated failure patterns — consider building recovery memory`] : [],
    };
}

// ── Deployment efficiency ─────────────────────────────────────────────────────

function deploymentEfficiency({ windowDays = 14 } = {}) {
    const eri = _tryRequire("./executionRiskIntelligence.cjs");
    let riskSummary = null;
    if (eri) { try { riskSummary = eri.riskSummary({ windowMs: windowDays * 86400000 }); } catch {} }

    const epe = _tryRequire("./engineeringProductivityEvolution.cjs");
    let cadence = null;
    if (epe) { try { cadence = epe.deploymentCadenceReport({ windowDays }); } catch {} }

    const health = riskSummary?.overall === "low" ? "healthy" : riskSummary?.overall === "moderate" ? "watch" : "needs-attention";
    return {
        ok: true,
        windowDays,
        riskLevel:  riskSummary?.overall || "unknown",
        cadence,
        health,
        suggestions: riskSummary?.overall === "high" ? ["High deployment risk — review risk signals before deploying"] : [],
    };
}

// ── Workflow discoverability ──────────────────────────────────────────────────

function discoverWorkflows(goal = "") {
    const suggestions = [];

    const daa = _tryRequire("./dailyExecutionAutomation.cjs");
    if (daa) {
        try {
            const catalog = daa.catalogList();
            const q = goal.toLowerCase();
            const matching = catalog.filter(w =>
                !q || w.name.includes(q) || w.description.toLowerCase().includes(q)
            );
            matching.forEach(w => suggestions.push({ source: "automation", name: w.name, description: w.description, stepCount: w.stepCount }));
        } catch {}
    }

    const daf = _tryRequire("./dailyAutonomousFlows.cjs");
    if (daf) {
        try {
            const catalog = daf.catalogList();
            const q = goal.toLowerCase();
            catalog.filter(w => !q || w.name.includes(q) || w.description.toLowerCase().includes(q))
                .forEach(w => suggestions.push({ source: "autonomous-flow", name: w.name, description: w.description, stepCount: w.stepCount }));
        } catch {}
    }

    const omi = _tryRequire("./operationalMemoryIntelligence.cjs");
    if (omi && goal) {
        try {
            const recalled = omi.recall(goal, { type: "env-workflow", limit: 3 });
            recalled.forEach(r => suggestions.push({ source: "memory", name: r.key, description: `Recalled workflow (confidence: ${r.confidence}%)`, score: r.score }));
        } catch {}
    }

    return { ok: true, goal, suggestions, count: suggestions.length };
}

// ── Replay readability ────────────────────────────────────────────────────────

function formatReplayForReview(replayId) {
    const ers = _tryRequire("./executionReplaySystem.cjs");
    if (!ers) return { ok: false, error: "executionReplaySystem unavailable" };
    try {
        const replay = ers.getReplay ? ers.getReplay(replayId) : null;
        if (!replay) return { ok: false, error: "Replay not found" };
        return {
            ok:      true,
            replayId,
            summary: {
                type:       replay.type,
                idempotent: replay.idempotent,
                stepCount:  replay.steps?.length || 0,
                createdAt:  replay.createdAt,
            },
            readableSteps: (replay.steps || []).map((s, i) => `${i + 1}. ${s.label || s.action || "step"} — ${s.safe !== false ? "safe" : "requires-approval"}`),
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ── Operational calmness score ────────────────────────────────────────────────

function operationalCalmness() {
    let score = 100;
    const signals = [];

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    if (lhec) {
        try {
            const h = lhec.continuityHealth();
            if (h.storm) { score -= 25; signals.push({ factor: "reconnect-storm", impact: -25 }); }
            if (h.staleSessions > 3) { score -= 10; signals.push({ factor: "stale-sessions", count: h.staleSessions, impact: -10 }); }
        } catch {}
    }

    const eri = _tryRequire("./executionRiskIntelligence.cjs");
    if (eri) {
        try {
            const warnings = eri.trustAwareWarnings();
            const critical = warnings.warnings.filter(w => w.severity === "critical").length;
            if (critical > 0) { score -= critical * 15; signals.push({ factor: "critical-warnings", count: critical, impact: -critical * 15 }); }
        } catch {}
    }

    const apr = _tryRequire("./advancedPlatformResilience.cjs");
    if (apr) {
        try {
            const wd = apr.watchdogSummary();
            if (wd.pressureLevel === "critical") { score -= 20; signals.push({ factor: "critical-pressure", impact: -20 }); }
            else if (wd.pressureLevel === "stressed") { score -= 10; signals.push({ factor: "stressed-pressure", impact: -10 }); }
        } catch {}
    }

    const normalized = Math.max(0, Math.min(100, score));
    const level = normalized >= 80 ? "calm" : normalized >= 60 ? "moderate" : "stressed";

    return { ok: true, score: normalized, level, signals, summary: `Operational calmness: ${level} (${normalized}/100)` };
}

// ── Fatigue and warning noise reduction ───────────────────────────────────────

function filterWarningNoise(warnings = [], { sessionId = null } = {}) {
    if (!warnings.length) return { ok: true, filtered: [], suppressedCount: 0 };

    // Deduplicate by message, cap at 5 warnings shown at once
    const seen = new Set();
    const unique = warnings.filter(w => {
        const key = (w.type || w.message || "").slice(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // Prioritize: critical first, then warning, then info
    const prioritized = [...unique.filter(w => w.severity === "critical"), ...unique.filter(w => w.severity === "warning"), ...unique.filter(w => !["critical", "warning"].includes(w.severity))];
    const shown       = prioritized.slice(0, 5);
    const suppressed  = prioritized.length - shown.length;

    return {
        ok:             true,
        filtered:       shown,
        suppressedCount: suppressed,
        total:          warnings.length,
        notice:         suppressed > 0 ? `${suppressed} lower-priority warning(s) suppressed` : null,
    };
}

// ── Full productivity summary ─────────────────────────────────────────────────

function productivityIntelSummary({ windowDays = 7 } = {}) {
    const debug    = debuggingProductivity({ windowDays });
    const deploy   = deploymentEfficiency({ windowDays });
    const calmness = operationalCalmness();

    const healthyCount = [debug.health, deploy.health].filter(h => h === "healthy").length;
    const overall = healthyCount >= 2 && calmness.level === "calm" ? "excellent" :
                    healthyCount >= 1 ? "good" : "needs-attention";

    return {
        ok: true,
        windowDays,
        overall,
        debug,
        deploy,
        calmness,
        summary: `Productivity intelligence: ${overall} — debug=${debug.health} deploy=${deploy.health} calm=${calmness.level}`,
    };
}

module.exports = { debuggingProductivity, deploymentEfficiency, discoverWorkflows, formatReplayForReview, operationalCalmness, filterWarningNoise, productivityIntelSummary };
