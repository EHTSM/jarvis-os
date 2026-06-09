"use strict";
/**
 * Phase 436 — Daily Operator Workspace
 *
 * Aggregates all operator-relevant runtime state into a single workspace snapshot.
 * Includes: active sessions, pinned workflows, runtime status, recovery alerts,
 * recent operations, execution summaries.
 *
 * Read-only aggregation — no state mutation. Designed for dashboard consumption.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const PINNED_WORKFLOWS_KEY = "jarvis_pinned_workflows";
const MAX_RECENT = 10;

function _getPinnedWorkflows() {
    // Persisted in data/workspace-pins.json
    const fs   = require("fs");
    const path = require("path");
    const fp   = path.join(__dirname, "../../data/workspace-pins.json");
    try { return JSON.parse(fs.readFileSync(fp, "utf8")); }
    catch { return []; }
}

function _savePinnedWorkflows(pins) {
    const fs   = require("fs");
    const path = require("path");
    const fp   = path.join(__dirname, "../../data/workspace-pins.json");
    try { fs.writeFileSync(fp, JSON.stringify(pins.slice(0, 20), null, 2)); } catch {}
}

/**
 * Build the full operator workspace snapshot.
 * @returns {object} workspace
 */
function getWorkspace() {
    const ws = { ts: Date.now() };

    // Active sessions
    try {
        const sm = _tryRequire("./engineeringSession.cjs");
        ws.activeSessions  = sm ? sm.list({ state: "active",  limit: 5 }) : [];
        ws.blockedSessions = sm ? sm.list({ state: "blocked", limit: 3 }) : [];
        ws.recentSessions  = sm ? sm.list({ limit: MAX_RECENT }) : [];
    } catch { ws.activeSessions = []; ws.blockedSessions = []; ws.recentSessions = []; }

    // Pinned workflows
    ws.pinnedWorkflows = _getPinnedWorkflows();

    // Runtime status (health matrix)
    try {
        const hm = _tryRequire("./operationalHealthMatrix.cjs");
        ws.health = hm ? hm.compute() : null;
    } catch { ws.health = null; }

    // Recovery alerts (pressure + adapter problems)
    ws.alerts = [];
    try {
        const pm = _tryRequire("./runtimePressureMonitor.cjs");
        if (pm) {
            const p = pm.computePressure();
            if (p.level !== "nominal") ws.alerts.push({ level: p.level === "critical" ? "critical" : "warn", msg: `Runtime pressure: ${p.level} (score=${p.score})` });
        }
    } catch {}
    try {
        const tsm = _tryRequire("./toolStateMonitor.cjs");
        if (tsm) {
            for (const prob of tsm.detectProblems()) {
                ws.alerts.push({ level: "warn", msg: `Adapter stale: ${prob.tool} (${prob.reason})` });
            }
        }
    } catch {}
    try {
        const heal = _tryRequire("./adapterSelfHealing.cjs");
        if (heal) {
            const snap = heal.snapshot();
            for (const [adapter, s] of Object.entries(snap)) {
                if (s.degraded) ws.alerts.push({ level: "critical", msg: `Adapter degraded: ${adapter}` });
            }
        }
    } catch {}

    // Recent operations (forensics)
    try {
        const forensics = _tryRequire("./runtimeForensics.cjs");
        ws.recentFailures = forensics ? forensics.query({ limit: 5 }) : [];
    } catch { ws.recentFailures = []; }

    // Context snapshot status
    try {
        const snap = _tryRequire("./engineeringContextSnapshot.cjs");
        ws.contextSnapshot = snap ? snap.status() : null;
    } catch { ws.contextSnapshot = null; }

    // Execution summary
    ws.summary = {
        activeSessions:  ws.activeSessions.length,
        blockedSessions: ws.blockedSessions.length,
        alerts:          ws.alerts.length,
        criticalAlerts:  ws.alerts.filter(a => a.level === "critical").length,
        healthGrade:     ws.health?.grade ?? "?",
        healthScore:     ws.health?.score ?? null,
    };

    return ws;
}

/**
 * Pin a workflow to the workspace.
 * @param {string} chainName
 * @param {string} label
 */
function pinWorkflow(chainName, label) {
    const pins = _getPinnedWorkflows();
    if (!pins.find(p => p.chainName === chainName)) {
        pins.unshift({ chainName, label: (label || chainName).slice(0, 80), pinnedAt: Date.now() });
    }
    _savePinnedWorkflows(pins);
}

/**
 * Unpin a workflow.
 * @param {string} chainName
 */
function unpinWorkflow(chainName) {
    const pins = _getPinnedWorkflows().filter(p => p.chainName !== chainName);
    _savePinnedWorkflows(pins);
}

module.exports = { getWorkspace, pinWorkflow, unpinWorkflow };
