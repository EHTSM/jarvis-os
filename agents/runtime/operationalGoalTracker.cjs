"use strict";
/**
 * Phase 399 — Operational Goal Tracker
 *
 * Tracks active operator goals, monitors progress, detects blocked states,
 * suggests recovery actions. Operator-scoped only — no self-directed behavior.
 *
 * A goal has:
 *   - A declaration (what the operator wants to achieve)
 *   - A set of success criteria (observable outcomes)
 *   - Progress events (each completed workflow/validation contributes)
 *   - A blocked detector (repeated failures or no progress for N minutes)
 *   - Recovery suggestions (based on what failed)
 */

const session  = require("./engineeringSession.cjs");
const planner  = require("./executionChainPlanner.cjs");

const BLOCK_THRESHOLD_MS  = 15 * 60 * 1000; // 15 min no progress → blocked
const STALL_THRESHOLD_MS  = 5  * 60 * 1000; // 5 min since last event → stale

// Success criteria for known goal patterns
const GOAL_CRITERIA = [
    {
        match: /frontend.*recov|recov.*frontend|stabilize.*frontend/i,
        label: "Frontend Recovery",
        criteria: [
            { id: "build-ok",    description: "Frontend build compiles successfully",    check: (s) => s.workflows.some(w => w.chainName === "recover-frontend-runtime" && w.successRate >= 80) },
            { id: "api-alive",   description: "API health endpoint responds",            check: (s) => s.runtimeState?.apiReachable === true },
            { id: "pm2-online",  description: "Backend pm2 process is online",           check: (s) => s.runtimeState?.pm2Status === "online" },
        ],
        recoveryChains: ["recover-frontend-runtime", "recover-backend", "health-check"],
    },
    {
        match: /backend.*recov|recov.*backend|restart.*backend/i,
        label: "Backend Recovery",
        criteria: [
            { id: "pm2-online",  description: "Backend process online",                  check: (s) => s.runtimeState?.pm2Status === "online" },
            { id: "api-alive",   description: "API responds on port 3001",               check: (s) => s.runtimeState?.apiReachable === true },
        ],
        recoveryChains: ["recover-backend", "health-check"],
    },
    {
        match: /deploy|release|push.*prod/i,
        label: "Deployment",
        criteria: [
            { id: "tests-pass",  description: "Test suite passes",                       check: (s) => s.workflows.some(w => w.chainName === "deployment-readiness" && w.successRate === 100) },
            { id: "build-ok",    description: "Production build succeeds",               check: (s) => s.workflows.some(w => w.chainName === "deploy-update" && w.successRate >= 80) },
            { id: "api-alive",   description: "Post-deploy API responds",                check: (s) => s.runtimeState?.apiReachable === true },
        ],
        recoveryChains: ["deployment-readiness", "git-safe-update", "deploy-update"],
    },
    {
        match: /depend|install|repair/i,
        label: "Dependency Repair",
        criteria: [
            { id: "install-ok",  description: "npm install completes without errors",    check: (s) => s.workflows.some(w => w.chainName === "clean-install" && w.successRate >= 80) },
            { id: "build-ok",    description: "Build compiles after install",            check: (s) => s.runtimeState?.apiReachable === true },
        ],
        recoveryChains: ["clean-install", "stabilize-frontend"],
    },
];

/**
 * Evaluate goal progress for a session.
 * Returns: { label, progress, blocked, suggestions, criteriaMet, criteriaTotal, summary }
 */
function evaluateGoal(sessionId) {
    const s = session.summary(sessionId);
    if (!s) return null;

    const goalDef = GOAL_CRITERIA.find(g => g.match.test(s.goal));
    if (!goalDef) {
        return {
            label:         "Custom goal",
            progress:      null,
            blocked:       _isBlocked(s),
            suggestions:   _genericSuggestions(s),
            criteriaMet:   null,
            criteriaTotal: null,
            summary:       _buildSummary(s, null, []),
        };
    }

    const results  = goalDef.criteria.map(c => ({ ...c, met: c.check(s) }));
    const met      = results.filter(r => r.met).length;
    const total    = results.length;
    const progress = Math.round((met / total) * 100);
    const blocked  = _isBlocked(s);

    const suggestions = _buildSuggestions(s, goalDef, results);

    return {
        label:         goalDef.label,
        progress,
        blocked,
        suggestions,
        criteria:      results.map(r => ({ id: r.id, description: r.description, met: r.met })),
        criteriaMet:   met,
        criteriaTotal: total,
        complete:      met === total,
        summary:       _buildSummary(s, goalDef, results),
    };
}

function _isBlocked(s) {
    if (s.state === "blocked") return true;
    if (s.isStale) return false; // stale ≠ blocked — just idle
    const lastEvent = s.timeline?.[0]?.ts;
    if (!lastEvent) return false;
    const noProgress = Date.now() - lastEvent > BLOCK_THRESHOLD_MS;
    const repeatedFailures = s.recoveryLog.filter(r => !r.recovered).length >= 3;
    return noProgress || repeatedFailures;
}

function _buildSuggestions(s, goalDef, results) {
    const suggestions = [];
    const unmetCriteria = results.filter(r => !r.met);
    const lastRecoveryFailed = s.recoveryLog[0] && !s.recoveryLog[0].recovered;

    if (unmetCriteria.length && goalDef.recoveryChains.length) {
        const chain = goalDef.recoveryChains[0];
        suggestions.push({
            priority: "high",
            action:   `run-chain:${chain}`,
            label:    `Run "${chain}" to address: ${unmetCriteria[0].description}`,
        });
    }
    if (lastRecoveryFailed) {
        suggestions.push({
            priority: "high",
            action:   "run-chain:health-check",
            label:    "Last recovery failed — run health-check to diagnose current state",
        });
    }
    if (s.failedRecoveries >= 3) {
        suggestions.push({
            priority: "critical",
            action:   "pause-session",
            label:    `${s.failedRecoveries} recovery failures — consider pausing and diagnosing manually`,
        });
    }
    if (s.state === "active" && s.workflowCount === 0) {
        const firstChain = goalDef?.recoveryChains?.[0];
        if (firstChain) {
            suggestions.push({
                priority: "medium",
                action:   `run-chain:${firstChain}`,
                label:    `Start with "${firstChain}" to make initial progress`,
            });
        }
    }
    return suggestions;
}

function _genericSuggestions(s) {
    const suggestions = [];
    if (s.workflowCount === 0) {
        suggestions.push({ priority: "medium", action: "run-chain:health-check", label: "Run health-check to assess current state" });
    }
    if (s.failedRecoveries >= 2) {
        suggestions.push({ priority: "high", action: "run-chain:health-check", label: "Multiple failures — run health-check before continuing" });
    }
    return suggestions;
}

function _buildSummary(s, goalDef, results) {
    const age  = Math.round((Date.now() - s.createdAt) / 60_000);
    const met  = results.filter(r => r.met).length;
    const parts = [
        `Session "${s.goal.slice(0, 50)}" — ${age}min active`,
        `${s.workflowCount} workflow(s) run, ${s.failedRecoveries} recovery failure(s)`,
        goalDef ? `Criteria: ${met}/${results.length} met` : "Custom goal (no criteria)",
        s.runtimeState ? `Runtime: PM2=${s.runtimeState.pm2Status || "unknown"} API=${s.runtimeState.apiReachable ? "up" : "down"}` : "Runtime state: unknown",
    ];
    return parts.join(" | ");
}

module.exports = { evaluateGoal };
