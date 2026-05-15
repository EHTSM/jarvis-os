"use strict";
/**
 * humanApproval — async human-in-the-loop approval gates.
 *
 * requestApproval(id, action, detail, opts) — register a pending approval
 * approve(id, reason)   — approve the action
 * deny(id, reason)      — deny the action
 * override(id, actor)   — force-approve, bypassing normal flow
 * waitForApproval(id, timeoutMs) → { approved, reason, overridden? }
 * pause(workflowId)     — pause a workflow (waitIfPaused will block)
 * resume(workflowId)    — resume a paused workflow
 * isPaused(wf)          → boolean
 * waitIfPaused(wf, intervalMs) → resolves when unpaused
 * pendingApprovals()    → [{ id, action, detail, createdAt, priority }]
 * getApproval(id)       → approval record without internal fields
 * reset()               — clear all state
 */

const DEFAULT_TIMEOUT_MS = 30_000;

// id → approval record
const _approvals = new Map();
// workflowId → { paused: bool, waiters: [resolve] }
const _paused    = new Map();

// ── Approval lifecycle ────────────────────────────────────────────

function requestApproval(id, action, detail = {}, opts = {}) {
    if (_approvals.has(id)) return _approvals.get(id);

    let resolve;
    const promise = new Promise(res => { resolve = res; });

    const entry = {
        id, action, detail,
        status:    "pending",
        priority:  opts.priority || "normal",
        createdAt: new Date().toISOString(),
        decidedAt: null,
        reason:    null,
        resolve,
        promise,
    };
    _approvals.set(id, entry);
    return entry;
}

function approve(id, reason = "approved") {
    const e = _approvals.get(id);
    if (!e || e.status !== "pending") return false;
    e.status    = "approved";
    e.decidedAt = new Date().toISOString();
    e.reason    = reason;
    e.resolve({ approved: true, reason });
    return true;
}

function deny(id, reason = "denied") {
    const e = _approvals.get(id);
    if (!e || e.status !== "pending") return false;
    e.status    = "denied";
    e.decidedAt = new Date().toISOString();
    e.reason    = reason;
    e.resolve({ approved: false, reason });
    return true;
}

function override(id, actor = "system") {
    const e = _approvals.get(id);
    if (!e) return false;
    const reason = `override by ${actor}`;
    if (e.status === "pending") {
        e.status    = "overridden";
        e.decidedAt = new Date().toISOString();
        e.reason    = reason;
        e.resolve({ approved: true, reason, overridden: true });
    }
    return true;
}

async function waitForApproval(id, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const e = _approvals.get(id);
    if (!e) return { approved: false, reason: "not_found" };

    if (e.status !== "pending") {
        return {
            approved: e.status === "approved" || e.status === "overridden",
            reason:   e.reason,
        };
    }

    const timeout = new Promise(res => {
        const t = setTimeout(() => {
            if (e.status === "pending") {
                e.status    = "timed_out";
                e.decidedAt = new Date().toISOString();
                e.reason    = "approval_timeout";
                res({ approved: false, reason: "approval_timeout" });
            }
        }, timeoutMs);
        if (t.unref) t.unref();
    });

    return Promise.race([e.promise, timeout]);
}

// ── Pause / Resume ────────────────────────────────────────────────

function pause(workflowId) {
    if (!_paused.has(workflowId)) _paused.set(workflowId, { paused: true,  waiters: [] });
    else _paused.get(workflowId).paused = true;
    return true;
}

function resume(workflowId) {
    const entry = _paused.get(workflowId);
    if (!entry) return false;
    entry.paused = false;
    const waiters = entry.waiters.splice(0);
    for (const w of waiters) w();
    return true;
}

function isPaused(workflowId) {
    return _paused.get(workflowId)?.paused === true;
}

async function waitIfPaused(workflowId, intervalMs = 50) {
    while (isPaused(workflowId)) {
        await new Promise(res => {
            const entry = _paused.get(workflowId);
            if (entry) entry.waiters.push(res);
            const t = setTimeout(res, intervalMs);
            if (t.unref) t.unref();
        });
    }
}

// ── Query ─────────────────────────────────────────────────────────

function pendingApprovals() {
    return [..._approvals.values()]
        .filter(e => e.status === "pending")
        .map(({ id, action, detail, createdAt, priority }) =>
            ({ id, action, detail, createdAt, priority }));
}

function getApproval(id) {
    const e = _approvals.get(id);
    if (!e) return null;
    const { resolve, promise, ...safe } = e;
    return safe;
}

function reset() { _approvals.clear(); _paused.clear(); }

module.exports = {
    requestApproval, approve, deny, override,
    waitForApproval,
    pause, resume, isPaused, waitIfPaused,
    pendingApprovals, getApproval,
    reset,
    DEFAULT_TIMEOUT_MS,
};
