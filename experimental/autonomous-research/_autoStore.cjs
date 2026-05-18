/**
 * Shared store for the Autonomous System Layer.
 * Provides persistence, safety gates, and standard response shapes.
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data/autonomous");

function _ensure() { fs.mkdirSync(DATA_DIR, { recursive: true }); }

function load(key, def = {}) {
    _ensure();
    const file = path.join(DATA_DIR, `${key}.json`);
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { /* fresh */ }
    return def instanceof Array ? [] : { ...def };
}

function flush(key, data) {
    _ensure();
    fs.writeFileSync(path.join(DATA_DIR, `${key}.json`), JSON.stringify(data, null, 2));
}

function uid(p = "auto") { return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`; }
function NOW()            { return new Date().toISOString(); }

function logToMemory(agent, input, output) {
    try {
        const ms = require("../memory/memoryStore.cjs");
        ms.save({ type: "autonomous", agent, input: String(input).slice(0, 200), output: JSON.stringify(output).slice(0, 400), category: "autonomous", tags: [agent, "autonomous"] });
    } catch { /* non-critical */ }
}

// Safety constants
const MAX_TASKS_PER_CYCLE   = 5;
const MAX_GROWTH_ITERATIONS = 3;
const DECISION_THRESHOLD    = 8;    // (reward × feasibility) / (risk + 1) × confidence must exceed this
// Formula range: ~1 (worst: low reward, low feasibility, max risk) to ~38 (best: max reward, max feasibility, min risk, 85% confidence)
// Threshold 8 blocks poor decisions while allowing low-risk/high-feasibility opportunities to proceed

// Actions requiring explicit human approval before execution
const HIGH_RISK_ACTIONS = new Set([
    "payment", "purchase", "charge", "billing",
    "campaign", "mass_message", "bulk_email", "send_email_bulk",
    "auto_publish", "deploy_live", "production_deploy"
]);

function isHighRisk(action = "") {
    const lower = action.toLowerCase();
    return [...HIGH_RISK_ACTIONS].some(h => lower.includes(h));
}

function ok(agent, data, actions = []) {
    return { success: true, type: "autonomous", agent, data, actions };
}

function fail(agent, error) {
    return { success: false, type: "autonomous", agent, data: { error: String(error) }, actions: [] };
}

function approvalRequired(agent, reason, pendingAction) {
    return {
        success:          false,
        type:             "autonomous",
        agent,
        approvalRequired: true,
        reason,
        pendingAction,
        message:          `⚠️ Human approval required before executing: ${pendingAction}. Reason: ${reason}`
    };
}

module.exports = {
    load, flush, uid, NOW, logToMemory,
    ok, fail, approvalRequired,
    MAX_TASKS_PER_CYCLE, MAX_GROWTH_ITERATIONS, DECISION_THRESHOLD,
    HIGH_RISK_ACTIONS, isHighRisk
};
