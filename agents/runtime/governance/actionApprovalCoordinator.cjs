"use strict";
/**
 * actionApprovalCoordinator — governance approval workflows for elevated,
 * critical, and restricted actions; multi-approver quorum enforcement.
 *
 * requestApproval(spec)       → { requested, approvalId, action, requiredApprovers }
 * grantApproval(spec)         → { granted, approvalId, approverId, status }
 * denyApproval(spec)          → { denied, approvalId, approverId }
 * checkApprovalStatus(spec)   → { status, approvalId, approved, approvalCount }
 * getApprovalMetrics()        → ApprovalMetrics
 * reset()
 *
 * Quorum requirements by risk class:
 *   elevated   → 1 approver (operator or above)
 *   critical   → 2 approvers (controller or above)
 *   restricted → 3 approvers (governor or above), OR 1 root-runtime approver
 *
 * Any single denial immediately blocks the approval (unanimous-deny model).
 */

const { AUTHORITY_RANK } = require("./runtimeAuthorityManager.cjs");

const REQUIRED_APPROVERS = { elevated: 1, critical: 2, restricted: 3 };
const MIN_APPROVER_LEVEL = { elevated: "operator", critical: "controller", restricted: "governor" };

let _approvals = new Map();   // approvalId → ApprovalRecord
let _counter   = 0;

// ── requestApproval ───────────────────────────────────────────────────

function requestApproval(spec = {}) {
    const {
        principalId = null,
        action      = null,
        riskClass   = "elevated",
        context     = {},
    } = spec;

    if (!principalId) return { requested: false, reason: "principalId_required" };
    if (!action)      return { requested: false, reason: "action_required" };

    const validClasses = ["elevated", "critical", "restricted"];
    if (!validClasses.includes(riskClass))
        return { requested: false, reason: `approval_not_required_for: ${riskClass}` };

    const approvalId       = `approval-${++_counter}`;
    const requiredApprovers = REQUIRED_APPROVERS[riskClass];
    const minApproverLevel  = MIN_APPROVER_LEVEL[riskClass];

    _approvals.set(approvalId, {
        approvalId,
        principalId,
        action,
        riskClass,
        context,
        requiredApprovers,
        minApproverLevel,
        approvals:    [],   // { approverId, authorityLevel, ts }
        denials:      [],   // { approverId, reason, ts }
        status:       "pending",
        requestedAt:  new Date().toISOString(),
    });

    return { requested: true, approvalId, principalId, action, riskClass, requiredApprovers, minApproverLevel };
}

// ── grantApproval ─────────────────────────────────────────────────────

function grantApproval(spec = {}) {
    const { approvalId = null, approverId = null, approverAuthority = "operator" } = spec;
    if (!approvalId) return { granted: false, reason: "approvalId_required" };
    if (!approverId) return { granted: false, reason: "approverId_required" };

    const rec = _approvals.get(approvalId);
    if (!rec) return { granted: false, reason: "approval_not_found" };

    // Duplicate check before status check — same approver on a completed approval is still a duplicate
    if (rec.approvals.some(a => a.approverId === approverId))
        return { granted: false, reason: "duplicate_approval", approverId };

    if (rec.status !== "pending") return { granted: false, reason: `approval_not_pending: ${rec.status}` };

    // Check approver authority meets minimum
    if ((AUTHORITY_RANK[approverAuthority] ?? -1) < AUTHORITY_RANK[rec.minApproverLevel])
        return {
            granted: false, reason: "approver_authority_insufficient",
            required: rec.minApproverLevel, provided: approverAuthority,
        };

    rec.approvals.push({ approverId, approverAuthority, ts: new Date().toISOString() });

    // root-runtime approver shortcut for restricted actions
    const rootApproved = rec.riskClass === "restricted" && approverAuthority === "root-runtime";
    if (rec.approvals.length >= rec.requiredApprovers || rootApproved) {
        rec.status = "approved";
    }

    return { granted: true, approvalId, approverId, status: rec.status, approvalCount: rec.approvals.length };
}

// ── denyApproval ──────────────────────────────────────────────────────

function denyApproval(spec = {}) {
    const { approvalId = null, approverId = null, reason = "denied" } = spec;
    if (!approvalId) return { denied: false, reason: "approvalId_required" };
    if (!approverId) return { denied: false, reason: "approverId_required" };

    const rec = _approvals.get(approvalId);
    if (!rec)                     return { denied: false, reason: "approval_not_found" };
    if (rec.status !== "pending") return { denied: false, reason: `approval_not_pending: ${rec.status}` };

    rec.denials.push({ approverId, reason, ts: new Date().toISOString() });
    rec.status = "denied";

    return { denied: true, approvalId, approverId, status: "denied" };
}

// ── checkApprovalStatus ───────────────────────────────────────────────

function checkApprovalStatus(spec = {}) {
    const { approvalId = null } = spec;
    if (!approvalId) return { found: false, reason: "approvalId_required" };

    const rec = _approvals.get(approvalId);
    if (!rec) return { found: false, reason: "approval_not_found", approvalId };

    return {
        found:            true,
        approvalId,
        principalId:      rec.principalId,
        action:           rec.action,
        riskClass:        rec.riskClass,
        status:           rec.status,
        approved:         rec.status === "approved",
        approvalCount:    rec.approvals.length,
        requiredApprovers: rec.requiredApprovers,
        deniedBy:         rec.denials.map(d => d.approverId),
    };
}

// ── getApprovalMetrics ────────────────────────────────────────────────

function getApprovalMetrics() {
    const all      = [..._approvals.values()];
    const approved = all.filter(a => a.status === "approved").length;
    const denied   = all.filter(a => a.status === "denied").length;
    const pending  = all.filter(a => a.status === "pending").length;

    return {
        totalRequests: all.length,
        approvedCount: approved,
        deniedCount:   denied,
        pendingCount:  pending,
        approvalRate:  all.length > 0 ? +(approved / all.length).toFixed(3) : 0,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _approvals = new Map();
    _counter   = 0;
}

module.exports = {
    REQUIRED_APPROVERS, MIN_APPROVER_LEVEL,
    requestApproval, grantApproval, denyApproval,
    checkApprovalStatus, getApprovalMetrics, reset,
};
