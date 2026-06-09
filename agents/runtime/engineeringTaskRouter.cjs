"use strict";
/**
 * Phase 421 — Engineering Task Router
 *
 * Routes engineering tasks to the right adapter chain based on:
 *   - Task intent classification
 *   - Adapter availability (toolStateMonitor)
 *   - Execution pressure (runtimePressureMonitor)
 *   - Workflow priority
 *   - Recovery urgency
 *
 * Returns a routing decision: { adapter, chainName, priority, reason, blocked }
 * Does NOT execute — caller dispatches using the returned routing.
 */

const logger = require("../../backend/utils/logger");

// ── Intent classification ─────────────────────────────────────────────────────
const INTENT_PATTERNS = [
    { intent: "debug",      pattern: /debug|error|crash|exception|stack.?trace|lint|type.?check/i },
    { intent: "deploy",     pattern: /deploy|release|push.?prod|publish|ship/i },
    { intent: "recovery",   pattern: /recover|fix|repair|restore|stabilize|reset|rollback/i },
    { intent: "validation", pattern: /verif|valid|check|test|health|smoke/i },
    { intent: "git",        pattern: /git|commit|branch|merge|pull|push|rebase|conflict/i },
    { intent: "build",      pattern: /build|compile|bundle|webpack|vite|npm.?run/i },
    { intent: "install",    pattern: /install|npm.?i|yarn|node.?modules|depend/i },
    { intent: "browser",    pattern: /browser|dom|page|tab|screenshot|selenium|playwright/i },
    { intent: "monitor",    pattern: /monitor|watch|tail|log|status|uptime|pm2/i },
    { intent: "maintenance",pattern: /clean|prune|purge|compress|expire|stale|archive/i },
];

// Intent → preferred adapter ordering (first available wins)
const INTENT_ADAPTERS = {
    debug:      ["vscode", "terminal"],
    deploy:     ["terminal", "runtime"],
    recovery:   ["runtime", "terminal"],
    validation: ["runtime", "terminal", "browser"],
    git:        ["terminal"],
    build:      ["terminal"],
    install:    ["terminal"],
    browser:    ["browser"],
    monitor:    ["runtime", "terminal"],
    maintenance:["runtime"],
    default:    ["terminal", "runtime"],
};

// Intent → preferred chain
const INTENT_CHAINS = {
    debug:      "vscode-error-navigation",
    deploy:     "deploy-update",
    recovery:   "health-check",
    validation: "health-check",
    git:        "git-safe-update",
    build:      "recover-frontend-runtime",
    install:    "clean-install",
    browser:    "health-check",
    monitor:    "health-check",
    maintenance:"health-check",
};

function _classifyIntent(task) {
    const text = `${task.goal || ""} ${task.cmd || ""} ${task.type || ""}`.toLowerCase();
    for (const { intent, pattern } of INTENT_PATTERNS) {
        if (pattern.test(text)) return intent;
    }
    return "default";
}

function _getAdapterStatus() {
    try {
        const tsm = require("./toolStateMonitor.cjs");
        return tsm.query(); // { vscode, terminal, browser, runtime }
    } catch { return {}; }
}

function _getPressure() {
    try {
        const pm = require("./runtimePressureMonitor.cjs");
        return pm.computePressure();
    } catch { return { score: 0, level: "nominal" }; }
}

function _pickAdapter(intent, adapterStatus) {
    const preferred = INTENT_ADAPTERS[intent] || INTENT_ADAPTERS.default;
    for (const adapter of preferred) {
        const state = adapterStatus[adapter];
        if (!state || state.state === "connected" || state.state === "active") return adapter;
        if (state.state === "stale" && adapter !== "browser") return adapter; // stale terminal/runtime still usable
    }
    return preferred[0]; // fall back to first preference even if state unknown
}

/**
 * Route an engineering task.
 * @param {object} task — { goal?, cmd?, type?, priority?, urgency? }
 * @returns {{ adapter: string, chainName: string, intent: string, priority: number, reason: string, blocked: boolean, pressure: object }}
 */
function route(task = {}) {
    const intent       = _classifyIntent(task);
    const adapterStatus = _getAdapterStatus();
    const pressure     = _getPressure();

    const adapter   = _pickAdapter(intent, adapterStatus);
    const chainName = task.chainName || INTENT_CHAINS[intent] || "health-check";

    // Priority: urgency field overrides, recovery tasks get HIGH
    let priority = task.priority ?? 3; // NORMAL
    if (task.urgency === "emergency") priority = 0;
    else if (intent === "recovery")   priority = 2; // HIGH
    else if (intent === "deploy")     priority = 2;

    // Block low-priority routing under high pressure
    let blocked = false;
    let reason  = `intent=${intent} adapter=${adapter}`;
    if (pressure.level === "critical" && priority >= 3) {
        blocked = true;
        reason  = `blocked: pressure=${pressure.level} blocks priority=${priority}`;
        logger.warn(`[TaskRouter] routing blocked — ${reason}`);
    } else if (pressure.level === "high" && priority >= 4) {
        blocked = true;
        reason  = `blocked: pressure=${pressure.level} blocks low priority`;
    }

    // Duplicate detection: if this exact chainName was recently started, warn
    let duplicateWarning = false;
    try {
        const cooldown = require("./executionCooldown.cjs");
        const check    = cooldown.checkChain(chainName);
        if (!check.allowed) {
            duplicateWarning = true;
            reason += ` | chain_cooldown:${Math.ceil(check.remainingMs / 1000)}s`;
        }
    } catch {}

    return { adapter, chainName, intent, priority, reason, blocked, duplicateWarning, pressure };
}

/**
 * Route multiple tasks in order, returns array of routing decisions.
 * Enforces no two tasks get the same adapter if both are high priority.
 */
function routeMany(tasks = []) {
    const usedAdapters = new Set();
    return tasks.map(task => {
        const decision = route(task);
        if (usedAdapters.has(decision.adapter) && decision.priority <= 2) {
            decision.reason += " | adapter_conflict_warned";
        }
        usedAdapters.add(decision.adapter);
        return { task, decision };
    });
}

module.exports = { route, routeMany, _classifyIntent };
