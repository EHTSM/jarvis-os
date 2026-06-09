"use strict";
/**
 * Phase 358 — Tool-State Awareness
 *
 * Tracks operational state of: VS Code, terminal, browser, runtime services.
 * Detects: stale sessions, disconnected tools, failed runtime state, conflicting workflows.
 *
 * Pure state tracking — no external network calls, no side effects.
 * Consumers call report*() to push state in; query() to read current state.
 */

const MAX_HISTORY = 100;

const STALE_THRESHOLDS = {
    vscode:   60_000,  // 60s without heartbeat → stale
    terminal: 120_000, // 120s without activity → stale
    browser:  90_000,  // 90s without activity → stale
    runtime:  30_000,  // 30s without activity → stale (should be active)
};

// State store: toolName → { toolName, state, lastSeen, meta, history[] }
const _tools = new Map();

// Conflict registry: tracks active workflows per tool
const _activeWorkflows = new Map(); // toolName → Set<workflowId>

function _ensureTool(name) {
    if (!_tools.has(name)) {
        _tools.set(name, {
            toolName: name,
            state:    "unknown",
            lastSeen: null,
            meta:     {},
            history:  [],
        });
    }
    return _tools.get(name);
}

function _pushHistory(tool, entry) {
    tool.history.push(entry);
    if (tool.history.length > MAX_HISTORY) tool.history.shift();
}

/**
 * Report a tool's current state.
 * @param {string} toolName — "vscode" | "terminal" | "browser" | "runtime"
 * @param {string} state    — "connected" | "disconnected" | "idle" | "busy" | "error"
 * @param {object} meta     — arbitrary diagnostic metadata
 */
function reportState(toolName, state, meta = {}) {
    const tool = _ensureTool(toolName);
    const prev = tool.state;
    tool.state   = state;
    tool.lastSeen = Date.now();
    tool.meta    = { ...tool.meta, ...meta };
    if (prev !== state) {
        _pushHistory(tool, { state, prev, ts: Date.now(), meta });
    }
}

/**
 * Record a heartbeat for a tool (marks as alive without changing state).
 */
function heartbeat(toolName, meta = {}) {
    const tool = _ensureTool(toolName);
    tool.lastSeen = Date.now();
    if (meta && Object.keys(meta).length > 0) {
        tool.meta = { ...tool.meta, ...meta };
    }
}

/**
 * Register a workflow as active on a tool (conflict detection).
 */
function startWorkflow(toolName, workflowId) {
    if (!_activeWorkflows.has(toolName)) _activeWorkflows.set(toolName, new Set());
    _activeWorkflows.get(toolName).add(workflowId);
}

/**
 * Mark a workflow as finished on a tool.
 */
function finishWorkflow(toolName, workflowId) {
    _activeWorkflows.get(toolName)?.delete(workflowId);
}

/**
 * Query current state for all tools or a specific tool.
 * Automatically marks tools as stale if lastSeen exceeded threshold.
 */
function query(toolName) {
    const now = Date.now();

    function _enrich(tool) {
        const threshold = STALE_THRESHOLDS[tool.toolName] || 120_000;
        const msSinceHeartbeat = tool.lastSeen ? (now - tool.lastSeen) : Infinity;
        const stale = msSinceHeartbeat > threshold && tool.state !== "disconnected";
        const conflictingWorkflows = [...(_activeWorkflows.get(tool.toolName) || [])];
        return {
            toolName:    tool.toolName,
            state:       stale ? "stale" : tool.state,
            lastSeen:    tool.lastSeen,
            msSinceHeartbeat: tool.lastSeen ? msSinceHeartbeat : null,
            stale,
            meta:        tool.meta,
            conflicts:   conflictingWorkflows.length > 1 ? conflictingWorkflows : [],
        };
    }

    if (toolName) {
        const tool = _tools.get(toolName);
        return tool ? _enrich(tool) : { toolName, state: "unknown", stale: false, lastSeen: null };
    }

    return [..._tools.values()].map(_enrich);
}

/**
 * Detect problems across all tools — returns list of issues.
 */
function detectProblems() {
    const now    = Date.now();
    const issues = [];

    for (const [name, tool] of _tools) {
        const threshold = STALE_THRESHOLDS[name] || 120_000;
        const age       = tool.lastSeen ? now - tool.lastSeen : Infinity;

        if (tool.state === "error") {
            issues.push({ tool: name, type: "error", severity: "high", detail: tool.meta.error || "error state" });
        }
        if (tool.state !== "disconnected" && age > threshold) {
            issues.push({ tool: name, type: "stale", severity: "medium", detail: `No heartbeat for ${Math.round(age / 1000)}s` });
        }
        if (tool.state === "disconnected") {
            issues.push({ tool: name, type: "disconnected", severity: "high", detail: "Tool is disconnected" });
        }

        const workflows = _activeWorkflows.get(name);
        if (workflows && workflows.size > 1) {
            issues.push({ tool: name, type: "conflict", severity: "high",
                detail: `${workflows.size} concurrent workflows: ${[...workflows].join(", ")}` });
        }
    }

    return issues;
}

/** Expose runtime service state wired from runtimeEventBus if available */
function syncFromRuntime() {
    try {
        const bus    = require("./runtimeEventBus.cjs");
        const status = bus.metrics?.();
        if (status) {
            reportState("runtime", status.connectionCount > 0 ? "connected" : "idle", {
                sseClients:  status.connectionCount,
                degraded:    status.degraded || false,
            });
        }
    } catch { /* non-critical */ }
}

// Sync runtime state every 15s
setInterval(syncFromRuntime, 15_000).unref();
syncFromRuntime();

module.exports = { reportState, heartbeat, startWorkflow, finishWorkflow, query, detectProblems };
