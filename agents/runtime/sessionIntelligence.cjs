"use strict";
/**
 * Phase 518 — Engineering Session Intelligence
 *
 * Active goal tracking, blocked-state detection, recovery-path suggestions,
 * workflow continuity, session summarization.
 *
 * Bounded, explainable, low-noise.
 * Pure read — no state mutation.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STALL_THRESHOLD_MS    = 15 * 60 * 1000;
const CONFIDENCE_WARN_BELOW = 50;

// ── Goal tracking ─────────────────────────────────────────────────────────────

function trackGoal(sessionId) {
    const sm = _tryRequire("./engineeringSession.cjs");
    if (!sm) return { available: false };

    const session = sm.get(sessionId);
    if (!session) return { available: false, error: "session not found" };

    const now      = Date.now();
    const ageMins  = Math.round((now - (session.createdAt || now)) / 60_000);
    const stalledMs = now - (session.updatedAt || session.createdAt || now);
    const stalled  = session.state === "active" && stalledMs > STALL_THRESHOLD_MS;

    return {
        available:   true,
        sessionId,
        goal:        session.goal,
        state:       session.state,
        ageMins,
        stalled,
        stalledMins: stalled ? Math.round(stalledMs / 60_000) : null,
        alert:       stalled ? `Session stalled for ${Math.round(stalledMs / 60_000)} minutes` : null,
    };
}

// ── Blocked-state detection ───────────────────────────────────────────────────

function detectBlockedState(sessionId) {
    const sm       = _tryRequire("./engineeringSession.cjs");
    const forensics = _tryRequire("./runtimeForensics.cjs");

    const session = sm ? sm.get(sessionId) : null;
    if (!session) return { blocked: false, reason: "session not found" };

    if (session.state === "blocked") {
        // Try to identify cause from forensics
        const events  = forensics ? forensics.query({ sessionId, limit: 10 }) : [];
        const lastFail = events.find(e => e.type === "failure" || e.type === "error");
        return {
            blocked:  true,
            reason:   lastFail ? (lastFail.summary || "unknown failure") : "session marked blocked",
            lastEvent: lastFail || null,
            suggestion: "Run health check, then attempt recovery workflow",
        };
    }

    return { blocked: false };
}

// ── Recovery-path suggestions ─────────────────────────────────────────────────

function suggestRecoveryPaths(sessionId) {
    const sm      = _tryRequire("./engineeringSession.cjs");
    const wfLib   = _tryRequire("./workflowLibrary.cjs");
    const em      = _tryRequire("./engineeringMemory.cjs");

    const session = sm ? sm.get(sessionId) : null;
    const goal    = session ? session.goal : "";
    const suggestions = [];

    // Workflow library match
    if (wfLib && goal) {
        wfLib.searchWorkflows(goal, { limit: 3 }).forEach(wf => {
            suggestions.push({ source: "workflow-library", name: wf.name, workflowId: wf.id, confidence: wf.builtin ? 80 : 65, replayable: true });
        });
    }

    // Engineering memory
    if (em && em.suggest && goal) {
        try {
            (em.suggest(goal) || []).slice(0, 2).forEach(s => {
                suggestions.push({ source: "memory", name: s.chainName || s.name, confidence: s.confidence || 60, replayable: true });
            });
        } catch {}
    }

    // Dedupe by name
    const seen = new Set();
    return suggestions.filter(s => { if (seen.has(s.name)) return false; seen.add(s.name); return true; }).slice(0, 5);
}

// ── Workflow continuity ───────────────────────────────────────────────────────

function workflowContinuity(sessionId) {
    const cont = _tryRequire("./engineeringContinuity.cjs");
    if (!cont) return { available: false };

    const progress = cont.getWorkflowProgress(sessionId);
    if (!progress) return { available: true, hasProgress: false };

    const ageMins = Math.round((Date.now() - (progress.savedAt || 0)) / 60_000);

    return {
        available:  true,
        hasProgress: true,
        workflowId: progress.workflowId,
        stepIndex:  progress.stepIndex,
        savedAt:    progress.savedAt,
        ageMins,
        resumable:  ageMins < 480, // 8 hours
        suggestion: `Resume "${progress.workflowId}" from step ${progress.stepIndex}`,
    };
}

// ── Session summarization ─────────────────────────────────────────────────────

function summarizeSession(sessionId) {
    const goal    = trackGoal(sessionId);
    const blocked = detectBlockedState(sessionId);
    const paths   = suggestRecoveryPaths(sessionId);
    const cont    = workflowContinuity(sessionId);
    const insights = _tryRequire("./insightSummary.cjs");

    const textSummary = insights ? insights.sessionSummary(sessionId) : null;

    // Build executive summary
    const lines = [];
    if (goal.available) {
        lines.push(`Goal: "${goal.goal}" — ${goal.state} (${goal.ageMins} min)`);
        if (goal.stalled) lines.push(`⚠ Stalled for ${goal.stalledMins} minutes`);
    }
    if (blocked.blocked) lines.push(`⚠ Blocked: ${blocked.reason}`);
    if (cont.hasProgress) lines.push(`Resume available: ${cont.workflowId} at step ${cont.stepIndex}`);
    if (paths.length > 0) lines.push(`${paths.length} recovery path(s) available`);

    return {
        sessionId,
        goal:           goal.available ? goal : null,
        blockedState:   blocked,
        recoveryPaths:  paths,
        continuity:     cont,
        textSummary:    textSummary ? textSummary.summary : null,
        executiveSummary: lines.join("\n") || "Session progressing normally",
    };
}

module.exports = { trackGoal, detectBlockedState, suggestRecoveryPaths, workflowContinuity, summarizeSession };
