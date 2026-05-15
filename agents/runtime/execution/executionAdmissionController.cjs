"use strict";
/**
 * executionAdmissionController — validate, classify risk, and gate execution requests.
 *
 * Policies:
 *   - critical operations denied in degraded/recovery mode
 *   - high operations denied in recovery mode
 *   - destructive filesystem ops require verificationPolicy
 *   - docker stop/remove and git reset_hard require rollbackMetadata
 *   - terminal commands reclassified via safeCommandClassifier
 *
 * requestExecution(action)          → ExecutionTicket
 * approveExecution(ticketId)        → ApprovalResult
 * rejectExecution(ticketId, reason) → RejectResult
 * getExecutionQueue(filter)         → ExecutionTicket[]
 * getExecutionPolicy()              → Policy
 * setRuntimeMode(mode)              → ModeResult
 * reset()
 */

const classifier = require("./safeCommandClassifier.cjs");

const RISK_LEVELS      = ["low", "medium", "high", "critical"];
const EXECUTION_CLASSES = ["filesystem", "terminal", "git", "docker", "browser", "vscode", "network", "automation"];
const RUNTIME_MODES    = ["normal", "safe", "degraded", "recovery"];

// Base risk per class/operation
const RISK_TABLE = {
    filesystem: { read: "low",  write: "medium", delete: "high",   format: "critical", move: "medium", copy: "low"     },
    terminal:   { read: "low",  execute: "medium", admin: "high",   script: "medium"                                    },
    git:        { read: "low",  clone: "low",   commit: "medium",  push: "medium",   force_push: "high",
                  reset_hard: "high", delete_branch: "high", revert: "medium"                                           },
    docker:     { inspect: "low", run: "medium", start: "medium",  stop: "high",     remove: "high",   prune: "critical",
                  build: "medium"                                                                                        },
    browser:    { navigate: "low", click: "medium", form: "medium", download: "medium", screenshot: "low"              },
    vscode:     { read: "low",  edit: "medium", run_task: "medium", debug: "low"                                        },
    network:    { request: "medium", scan: "high", upload: "medium", download: "medium", connect: "medium"             },
    automation: { trigger: "medium", schedule: "medium", webhook: "medium", workflow: "high"                           },
};

// What each runtime mode allows
const MODE_RESTRICTIONS = {
    normal:   { deniedRisks: [],                    requiresApproval: ["critical", "high"] },
    safe:     { deniedRisks: [],                    requiresApproval: ["critical", "high"] },
    degraded: { deniedRisks: ["critical"],           requiresApproval: ["high"]             },
    recovery: { deniedRisks: ["critical", "high"],  requiresApproval: ["medium"]           },
};

// Ops that need a verificationPolicy attached
const VERIFICATION_REQUIRED = new Set([
    "filesystem:delete", "filesystem:format",
    "docker:remove",     "docker:prune",
    "git:reset_hard",    "git:force_push",
]);

// Ops that need rollbackMetadata attached
const ROLLBACK_METADATA_REQUIRED = new Set([
    "filesystem:delete", "filesystem:format",
    "docker:stop",       "docker:remove",
    "git:reset_hard",
]);

let _queue       = new Map();   // ticketId → ExecutionTicket
let _counter     = 0;
let _runtimeMode = "normal";

// ── requestExecution ──────────────────────────────────────────────────

function requestExecution(action = {}) {
    const {
        class: execClass     = "terminal",
        operation            = "execute",
        payload              = {},
        requestedBy          = "system",
        verificationPolicy   = null,
        rollbackMetadata     = null,
        command              = null,   // terminal-only: raw shell command
    } = action;

    const ticketId = `tkt-${++_counter}`;

    // Validate execution class
    if (!EXECUTION_CLASSES.includes(execClass)) {
        return _makeTicket({
            ticketId, execClass, operation, riskLevel: "medium",
            status: "rejected", violations: [`invalid_execution_class: ${execClass}`],
            payload, requestedBy, verificationPolicy, rollbackMetadata,
        });
    }

    // Classify risk — terminal commands use safeCommandClassifier
    let riskLevel = (RISK_TABLE[execClass] ?? {})[operation] ?? "medium";
    if (execClass === "terminal" && command) {
        const score = classifier.getSafetyScore(command);
        riskLevel = score >= 80 ? "low" : score >= 60 ? "medium" : score >= 30 ? "high" : "critical";
    }

    const restrictions = MODE_RESTRICTIONS[_runtimeMode] ?? MODE_RESTRICTIONS.normal;
    const violations   = [];

    // Mode-based denial
    if (restrictions.deniedRisks.includes(riskLevel)) {
        violations.push(`${riskLevel}_risk_denied_in_${_runtimeMode}_mode`);
    }

    // Special policy gates
    const key = `${execClass}:${operation}`;
    if (VERIFICATION_REQUIRED.has(key) && !verificationPolicy) {
        violations.push(`verification_policy_required: ${key}`);
    }
    if (ROLLBACK_METADATA_REQUIRED.has(key) && !rollbackMetadata) {
        violations.push(`rollback_metadata_required: ${key}`);
    }

    const needsApproval = violations.length === 0 && restrictions.requiresApproval.includes(riskLevel);
    const status = violations.length > 0 ? "rejected"
                 : needsApproval          ? "pending"
                 :                          "approved";

    return _makeTicket({
        ticketId, execClass, operation, riskLevel, status, violations,
        payload, requestedBy, verificationPolicy, rollbackMetadata,
    });
}

function _makeTicket({ ticketId, execClass, operation, riskLevel, status, violations, payload, requestedBy, verificationPolicy, rollbackMetadata }) {
    const ticket = {
        ticketId,
        class:             execClass,
        operation,
        riskLevel,
        status,
        violations,
        rejectReason:      violations.length > 0 ? violations[0] : null,
        autoApproved:      status === "approved",
        runtimeMode:       _runtimeMode,
        payload:           { ...payload },
        requestedBy,
        verificationPolicy,
        rollbackMetadata,
        createdAt:         new Date().toISOString(),
        updatedAt:         new Date().toISOString(),
    };
    _queue.set(ticketId, ticket);
    return ticket;
}

// ── approveExecution ──────────────────────────────────────────────────

function approveExecution(ticketId) {
    const ticket = _queue.get(ticketId);
    if (!ticket) return { approved: false, reason: "ticket_not_found" };
    if (ticket.status === "rejected")  return { approved: false, reason: "ticket_rejected", ticketId };
    if (ticket.status === "approved")  return { approved: true,  ticketId, alreadyApproved: true };
    ticket.status    = "approved";
    ticket.updatedAt = new Date().toISOString();
    return { approved: true, ticketId };
}

// ── rejectExecution ───────────────────────────────────────────────────

function rejectExecution(ticketId, reason = "manual_rejection") {
    const ticket = _queue.get(ticketId);
    if (!ticket) return { rejected: false, reason: "ticket_not_found" };
    if (ticket.status === "approved") return { rejected: false, reason: "already_approved", ticketId };
    ticket.status      = "rejected";
    ticket.rejectReason = reason;
    ticket.updatedAt   = new Date().toISOString();
    return { rejected: true, ticketId, reason };
}

// ── getExecutionQueue ─────────────────────────────────────────────────

function getExecutionQueue(filter = {}) {
    let tickets = [..._queue.values()];
    if (filter.status)    tickets = tickets.filter(t => t.status    === filter.status);
    if (filter.class)     tickets = tickets.filter(t => t.class     === filter.class);
    if (filter.riskLevel) tickets = tickets.filter(t => t.riskLevel === filter.riskLevel);
    return tickets;
}

// ── getExecutionPolicy ────────────────────────────────────────────────

function getExecutionPolicy() {
    return {
        runtimeMode:              _runtimeMode,
        restrictions:             { ...MODE_RESTRICTIONS[_runtimeMode] },
        verificationRequired:     [...VERIFICATION_REQUIRED],
        rollbackMetadataRequired: [...ROLLBACK_METADATA_REQUIRED],
    };
}

// ── setRuntimeMode ────────────────────────────────────────────────────

function setRuntimeMode(mode) {
    if (!RUNTIME_MODES.includes(mode)) return { set: false, reason: `invalid_mode: ${mode}` };
    _runtimeMode = mode;
    return { set: true, mode };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _queue       = new Map();
    _counter     = 0;
    _runtimeMode = "normal";
}

module.exports = {
    RISK_LEVELS, EXECUTION_CLASSES, RUNTIME_MODES,
    RISK_TABLE, MODE_RESTRICTIONS,
    requestExecution, approveExecution, rejectExecution,
    getExecutionQueue, getExecutionPolicy, setRuntimeMode,
    reset,
};
