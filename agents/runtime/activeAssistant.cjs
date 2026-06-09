"use strict";
/**
 * Phase 496 — Active Engineering Assistant
 *
 * Low-noise, confidence-aware assistant that detects stalled debugging,
 * suggests recovery workflows, recommends validation steps, identifies
 * missing dependencies, and proposes replayable fixes.
 *
 * All suggestions are bounded, interruptible, and explainable.
 * No autonomous execution — suggestions only.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const MIN_CONFIDENCE_TO_SUGGEST = 50;
const STALL_THRESHOLD_MS        = 15 * 60 * 1000; // 15 min without progress
const MAX_SUGGESTIONS           = 5;

// ── Stall detection ───────────────────────────────────────────────────────────

function _detectStall(session) {
    if (!session) return null;
    const now       = Date.now();
    const lastEvent = session.updatedAt || session.createdAt || 0;
    const stalledMs = now - lastEvent;

    if (session.state !== "active")    return null;
    if (stalledMs < STALL_THRESHOLD_MS) return null;

    return {
        detected:  true,
        stalledMs,
        stalledMin: Math.round(stalledMs / 60_000),
        sessionId: session.id,
        goal:      session.goal,
    };
}

// ── Recovery workflow suggestion ──────────────────────────────────────────────

function _suggestRecovery(context = {}) {
    const lib     = _tryRequire("./workflowLibrary.cjs");
    const opSearch = _tryRequire("./operationalSearch.cjs");

    const suggestions = [];

    if (lib && context.goal) {
        const matches = lib.searchWorkflows(context.goal, { limit: 3 });
        matches.forEach(w => suggestions.push({
            type:       "recovery-workflow",
            name:       w.name,
            workflowId: w.id,
            reason:     `Matches goal: "${context.goal}"`,
            confidence: 70,
            action:     `Run workflow: ${w.id}`,
        }));
    }

    // Recovery memory suggestions
    const rm = _tryRequire("./executionRecoveryMemory.cjs");
    if (rm && rm.query) {
        try {
            const paths = rm.query({ limit: 50 })
                .filter(e => e.type === "validated-path")
                .filter(e => context.goal && (e.chainName || "").toLowerCase().includes(
                    (context.goal || "").toLowerCase().split(" ")[0]
                ))
                .slice(0, 2);
            paths.forEach(p => suggestions.push({
                type:       "validated-path",
                name:       p.chainName,
                reason:     `Previously validated with confidence ${p.confidence}%`,
                confidence: p.confidence || 60,
                action:     `Replay chain: ${p.chainName}`,
            }));
        } catch {}
    }

    return suggestions.slice(0, MAX_SUGGESTIONS);
}

// ── Validation step recommendation ───────────────────────────────────────────

function _suggestValidation(context = {}) {
    const suggestions = [];
    const { recentFailures = 0, lastChain, goal = "" } = context;

    if (recentFailures >= 2) {
        suggestions.push({
            type:       "validation",
            name:       "Health Check",
            workflowId: "deployment-validation",
            reason:     `${recentFailures} recent failures — verify system state before continuing`,
            confidence: 85,
            action:     "Run: deployment-validation workflow",
        });
    }

    if (lastChain && lastChain.includes("deploy")) {
        suggestions.push({
            type:       "validation",
            name:       "Post-Deployment Verification",
            workflowId: "deployment-validation",
            reason:     "Deployment chain detected — validate before next step",
            confidence: 80,
            action:     "Run: deployment-validation workflow",
        });
    }

    if (goal.toLowerCase().includes("frontend")) {
        suggestions.push({
            type:       "validation",
            name:       "Frontend Health Check",
            workflowId: "frontend-recovery",
            reason:     "Frontend goal detected — verify nginx and static serving",
            confidence: 75,
            action:     "Run: frontend-recovery workflow",
        });
    }

    return suggestions.slice(0, 2);
}

// ── Missing dependency identification ─────────────────────────────────────────

function _identifyMissingDeps(context = {}) {
    const suggestions = [];
    const { recentErrors = [], goal = "" } = context;
    const errorText = recentErrors.join(" ").toLowerCase();

    const depPatterns = [
        { pattern: /cannot find module|module not found/,    name: "npm install",          workflowId: "dependency-repair", confidence: 90 },
        { pattern: /enoent|no such file/,                    name: "File/path check",      workflowId: null,                confidence: 75 },
        { pattern: /connection refused|econnrefused/,        name: "Backend service check", workflowId: "backend-restore",   confidence: 85 },
        { pattern: /nginx|502|503/,                          name: "Frontend/proxy check",  workflowId: "frontend-recovery", confidence: 80 },
        { pattern: /git.*conflict|merge conflict/,           name: "Git conflict resolution", workflowId: "git-safe-update", confidence: 85 },
    ];

    for (const { pattern, name, workflowId, confidence } of depPatterns) {
        if (pattern.test(errorText)) {
            suggestions.push({
                type:       "missing-dependency",
                name,
                workflowId,
                reason:     `Error pattern detected: ${pattern.source}`,
                confidence,
                action:     workflowId ? `Run workflow: ${workflowId}` : `Investigate: ${name}`,
            });
        }
    }

    return suggestions.slice(0, 2);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyse a session and produce low-noise operator suggestions.
 * @param {string} sessionId
 * @param {{ recentErrors?, recentFailures?, lastChain? }} context
 */
function assist(sessionId, context = {}) {
    const sm      = _tryRequire("./engineeringSession.cjs");
    const pressure = _tryRequire("./runtimePressureMonitor.cjs");

    const session  = sm ? sm.get(sessionId) : null;
    const pres     = pressure ? pressure.computePressure() : { level: "nominal", score: 0 };

    // Under high pressure, suppress non-critical suggestions to reduce noise
    const suppressNoise = ["high", "critical"].includes(pres.level);

    const ctx = { ...context, goal: session ? session.goal : (context.goal || "") };

    const stall       = _detectStall(session);
    const recovery    = _suggestRecovery(ctx);
    const validation  = suppressNoise ? [] : _suggestValidation(ctx);
    const missingDeps = _identifyMissingDeps(ctx);

    // Combine and rank by confidence
    const all = [...recovery, ...validation, ...missingDeps]
        .filter(s => s.confidence >= MIN_CONFIDENCE_TO_SUGGEST)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, MAX_SUGGESTIONS);

    return {
        sessionId,
        sessionGoal:      session ? session.goal : null,
        sessionState:     session ? session.state : null,
        stallDetected:    stall,
        pressureLevel:    pres.level,
        suggestions:      all,
        suppressedNoise:  suppressNoise,
        ts:               new Date().toISOString(),
        note:             all.length === 0 ? "No suggestions — session progressing normally" : null,
    };
}

/**
 * Suggest next step for a given goal without requiring an active session.
 * Quick lookup for command-line / operator prompt use.
 */
function quickSuggest(goal) {
    const ctx = { goal, recentErrors: [], recentFailures: 0 };
    const recovery   = _suggestRecovery(ctx);
    const validation = _suggestValidation(ctx);
    return [...recovery, ...validation]
        .filter(s => s.confidence >= MIN_CONFIDENCE_TO_SUGGEST)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3);
}

module.exports = { assist, quickSuggest, _detectStall, _suggestRecovery, _suggestValidation, _identifyMissingDeps };
