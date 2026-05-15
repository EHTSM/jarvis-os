"use strict";
/**
 * dockerExecutionAdapter — container inspection-only docker adapter.
 *
 * inspectContainer(spec)    → { inspected, executionId, containerId, info }
 * listContainers(spec)      → { listed, executionId, containers }
 * getContainerLogs(spec)    → { retrieved, executionId, logs }
 * validateDockerOp(spec)    → { valid, violations }
 * getExecutionLog()         → ExecutionRecord[]
 * getAdapterMetrics()       → AdapterMetrics
 * reset()
 *
 * Safety: read-only inspection only. exec, privileged, host-network,
 * root escalation, and container commit are all permanently blocked.
 */

const BLOCKED_DOCKER_OPS = [
    "exec", "run --privileged", "run --net=host", "run --pid=host",
    "commit", "run --rm -v /:/host",
];

const ALLOWED_DOCKER_OPS = ["inspect", "ps", "logs", "stats", "top", "port"];

let _execLog = [];
let _counter = 0;

function _log(op, containerId, executionId, outcome) {
    _execLog.push({ executionId, op, containerId: containerId ?? null, outcome, ts: new Date().toISOString() });
}

// ── validateDockerOp ──────────────────────────────────────────────────

function validateDockerOp(spec = {}) {
    const {
        operation      = null,
        privileged     = false,
        hostNetwork    = false,
        rootEscalation = false,
    } = spec;

    const violations = [];

    if (!operation) violations.push("operation_required");
    if (operation && !ALLOWED_DOCKER_OPS.includes(operation))
        violations.push(`operation_not_allowed: ${operation}`);
    if (privileged)     violations.push("privileged_containers_denied");
    if (hostNetwork)    violations.push("host_networking_denied");
    if (rootEscalation) violations.push("root_escalation_denied");

    return { valid: violations.length === 0, violations, operation };
}

// ── inspectContainer ──────────────────────────────────────────────────

function inspectContainer(spec = {}) {
    const { containerId = null, workflowId = null, authorityLevel = "observer" } = spec;
    if (!containerId) return { inspected: false, reason: "containerId_required" };

    const executionId = `docker-exec-${++_counter}`;
    _log("inspect", containerId, executionId, "ok");

    return {
        inspected: true, executionId, containerId,
        info: {
            id:      containerId,
            status:  "running",
            image:   "[simulated image]",
            created: new Date().toISOString(),
        },
        workflowId, authorityLevel,
    };
}

// ── listContainers ────────────────────────────────────────────────────

function listContainers(spec = {}) {
    const { workflowId = null, authorityLevel = "observer", all = false } = spec;
    const executionId = `docker-exec-${++_counter}`;
    _log("ps", null, executionId, "ok");

    return {
        listed: true, executionId,
        containers: [{ id: "sim-container-1", status: "running", image: "[simulated]" }],
        workflowId, authorityLevel, showAll: all,
    };
}

// ── getContainerLogs ──────────────────────────────────────────────────

function getContainerLogs(spec = {}) {
    const { containerId = null, workflowId = null, authorityLevel = "observer", lines = 50 } = spec;
    if (!containerId) return { retrieved: false, reason: "containerId_required" };

    const executionId = `docker-exec-${++_counter}`;
    _log("logs", containerId, executionId, "ok");

    return {
        retrieved: true, executionId, containerId,
        logs: `[simulated ${lines}-line log for ${containerId}]`,
        workflowId, authorityLevel,
    };
}

// ── getExecutionLog ───────────────────────────────────────────────────

function getExecutionLog() {
    return [..._execLog];
}

// ── getAdapterMetrics ─────────────────────────────────────────────────

function getAdapterMetrics() {
    const byOp = {};
    for (const r of _execLog) byOp[r.op] = (byOp[r.op] ?? 0) + 1;
    return {
        totalExecutions: _execLog.length,
        byOperation:     byOp,
        adapterType:     "docker",
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _execLog = [];
    _counter = 0;
}

module.exports = {
    BLOCKED_DOCKER_OPS, ALLOWED_DOCKER_OPS,
    validateDockerOp, inspectContainer, listContainers, getContainerLogs,
    getExecutionLog, getAdapterMetrics, reset,
};
