"use strict";
const { getAdminState, flushAdminState, ultimateLog, isKillSwitchActive, uid, NOW, ok, fail, blocked, killed, load, flush } = require("./_ultimateStore.cjs");

const AGENT = "adminControlPanel";

// ── Register admin ────────────────────────────────────────────────
function registerAdmin({ registrarId, registrarSecret, newAdminId, newAdminName, newAdminSecret }) {
    if (!registrarId || !newAdminId || !newAdminSecret) {
        return fail(AGENT, "registrarId, newAdminId, and newAdminSecret are required");
    }
    const state = getAdminState();

    // First admin can self-register; subsequent admins require existing admin
    if (state.admins.length > 0) {
        const registrar = state.admins.find(a => a.id === registrarId && a.secret === registrarSecret);
        if (!registrar) return blocked(AGENT, "Only an existing registered admin can register new admins");
    }

    if (state.admins.find(a => a.id === newAdminId)) {
        return fail(AGENT, `Admin '${newAdminId}' is already registered`);
    }

    state.admins.push({
        id:          newAdminId,
        name:        newAdminName || newAdminId,
        secret:      newAdminSecret,
        registeredBy: registrarId,
        registeredAt: NOW()
    });
    flushAdminState(state);

    ultimateLog(AGENT, "ADMIN_REGISTERED", { newAdminId, registeredBy: registrarId }, "WARN");
    return ok(AGENT, { adminId: newAdminId, name: newAdminName || newAdminId, registeredAt: NOW(), message: "Admin registered. Keep secret secure." });
}

// ── Approve a pending critical action ────────────────────────────
function approveAction({ adminId, adminSecret, approvalId, note = "" }) {
    if (!adminId || !adminSecret || !approvalId) {
        return fail(AGENT, "adminId, adminSecret, and approvalId are required");
    }
    const state = getAdminState();
    const admin = state.admins.find(a => a.id === adminId && a.secret === adminSecret);
    if (!admin) return blocked(AGENT, "Invalid admin credentials");

    const pending = state.pendingApprovals.find(p => p.id === approvalId);
    if (!pending) return fail(AGENT, `Approval request '${approvalId}' not found`);
    if (pending.status !== "pending") return fail(AGENT, `Approval '${approvalId}' is already ${pending.status}`);

    pending.status    = "approved";
    pending.approvedBy   = adminId;
    pending.approvedAt   = NOW();
    pending.approvalNote = note;
    flushAdminState(state);

    ultimateLog(AGENT, "ACTION_APPROVED", { approvalId, adminId, action: pending.action }, "WARN");
    return ok(AGENT, { approvalId, action: pending.action, approvedBy: adminId, approvedAt: NOW(), note });
}

// ── Reject a pending action ───────────────────────────────────────
function rejectAction({ adminId, adminSecret, approvalId, reason }) {
    if (!adminId || !adminSecret || !approvalId) {
        return fail(AGENT, "adminId, adminSecret, and approvalId are required");
    }
    const state = getAdminState();
    const admin = state.admins.find(a => a.id === adminId && a.secret === adminSecret);
    if (!admin) return blocked(AGENT, "Invalid admin credentials");

    const pending = state.pendingApprovals.find(p => p.id === approvalId);
    if (!pending) return fail(AGENT, `Approval request '${approvalId}' not found`);

    pending.status     = "rejected";
    pending.rejectedBy = adminId;
    pending.rejectedAt = NOW();
    pending.reason     = reason || "No reason given";
    flushAdminState(state);

    ultimateLog(AGENT, "ACTION_REJECTED", { approvalId, adminId, action: pending.action, reason }, "WARN");
    return ok(AGENT, { approvalId, status: "rejected", rejectedBy: adminId, reason });
}

// ── Submit an action for admin approval ──────────────────────────
function requestApproval({ action, requestedBy, riskScore, context = {} }) {
    if (!action || !requestedBy) return fail(AGENT, "action and requestedBy are required");

    const state = getAdminState();
    const req = {
        id:          uid("apr"),
        action,
        requestedBy,
        riskScore:   riskScore || 0,
        context,
        status:      "pending",
        requestedAt: NOW()
    };
    state.pendingApprovals = state.pendingApprovals || [];
    state.pendingApprovals.push(req);
    // Keep only last 200 approval records
    if (state.pendingApprovals.length > 200) state.pendingApprovals = state.pendingApprovals.slice(-200);
    flushAdminState(state);

    ultimateLog(AGENT, "approval_requested", { approvalId: req.id, action, requestedBy, riskScore }, "INFO");
    return ok(AGENT, { approvalId: req.id, status: "pending", action, message: "Approval request submitted. Awaiting admin decision.", requestedAt: req.requestedAt }, "pending_approval");
}

// ── Check if a specific approval is granted ───────────────────────
function checkApproval({ approvalId }) {
    if (!approvalId) return fail(AGENT, "approvalId required");
    const state = getAdminState();
    const record = state.pendingApprovals.find(p => p.id === approvalId);
    if (!record) return fail(AGENT, `Approval '${approvalId}' not found`);
    return ok(AGENT, record, record.status);
}

// ── List pending approvals (admin only) ───────────────────────────
function listPending({ adminId, adminSecret }) {
    const state = getAdminState();
    const admin = state.admins.find(a => a.id === adminId && a.secret === adminSecret);
    if (!admin) return blocked(AGENT, "Invalid admin credentials");
    const pending = (state.pendingApprovals || []).filter(p => p.status === "pending");
    return ok(AGENT, { total: pending.length, pending });
}

// ── System status (admin only) ────────────────────────────────────
function getSystemStatus({ adminId, adminSecret }) {
    const state = getAdminState();
    const admin = state.admins.find(a => a.id === adminId && a.secret === adminSecret);
    if (!admin) return blocked(AGENT, "Invalid admin credentials");

    return ok(AGENT, {
        adminCount:       state.admins.length,
        killSwitchActive: isKillSwitchActive(),
        pendingApprovals: (state.pendingApprovals || []).filter(p => p.status === "pending").length,
        totalApprovals:   (state.pendingApprovals || []).length,
        checkedAt:        NOW()
    });
}

module.exports = { registerAdmin, approveAction, rejectAction, requestApproval, checkApproval, listPending, getSystemStatus };
