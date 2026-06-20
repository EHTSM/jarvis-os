"use strict";
/**
 * Human-in-the-Loop — approval gate for dangerous browser actions.
 *
 * Before dangerous actions (payment, delete, transfer, publish) runs are paused
 * and an approval request is created. Execution resumes only after human approval.
 *
 * Storage: data/hitl-queue.json
 * Schema: { [requestId]: ApprovalRequest }
 *
 * ApprovalRequest: {
 *   id:          string
 *   ts:          ISO
 *   sessionId:   string
 *   workflowId:  string
 *   intent:      string
 *   dangerLevel: "review" | "dangerous"
 *   dangerReason:string
 *   steps:       Step[]       (pending steps)
 *   context:     object       (screenshot url, current url, etc)
 *   status:      "pending" | "approved" | "rejected" | "expired"
 *   approvedBy:  string | null
 *   approvedAt:  ISO | null
 *   rejectedReason: string | null
 *   expiresAt:   ISO
 * }
 */

const fs   = require("fs");
const path = require("path");

const STORE_FILE  = path.join(__dirname, "../../data/hitl-queue.json");
const TTL_MS      = 30 * 60 * 1000; // 30 min expiry

function _load() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return {}; }
}

function _save(d) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}

function _genId() { return `hitl-${Date.now()}-${Math.random().toString(36).slice(2,6)}`; }

// ── Danger triggers ───────────────────────────────────────────────
const DANGER_ACTIONS = ["click","fillForm","type","pressKey","selectOption"];
const DANGER_KEYWORDS = [/pay/i,/payment/i,/transfer/i,/delete/i,/remove/i,/publish/i,/post/i,/send/i,/submit/i,/book/i,/confirm/i,/buy/i,/purchase/i];

/**
 * Scan a list of steps and return which ones need approval.
 */
function scanSteps(steps, intent = "") {
  const flagged = [];
  const intentDanger = DANGER_KEYWORDS.some(p => p.test(intent));

  for (const [i, step] of steps.entries()) {
    const label   = (step.label || "").toLowerCase();
    const value   = (step.value || "").toLowerCase();
    const url     = (step.url   || "").toLowerCase();
    const isDanger = DANGER_KEYWORDS.some(p => p.test(label) || p.test(value) || p.test(url));
    if (isDanger && DANGER_ACTIONS.includes(step.action)) {
      flagged.push({ stepIndex: i, step, reason: "dangerous_keyword" });
    }
  }

  if (!flagged.length && intentDanger) {
    // Flag the whole flow if intent is dangerous but no specific step matched
    flagged.push({ stepIndex: 0, step: steps[0], reason: "dangerous_intent" });
  }

  return flagged;
}

/**
 * Create an approval request.
 * Returns the request object. Caller should pause execution until status !== "pending".
 */
function createRequest(opts = {}) {
  const store = _load();
  const id    = _genId();
  const req   = {
    id,
    ts:           new Date().toISOString(),
    sessionId:    opts.sessionId   || null,
    workflowId:   opts.workflowId  || null,
    intent:       opts.intent      || "",
    dangerLevel:  opts.dangerLevel || "review",
    dangerReason: opts.dangerReason|| "unknown",
    steps:        opts.steps       || [],
    flaggedSteps: opts.flaggedSteps|| [],
    context:      opts.context     || {},
    status:       "pending",
    approvedBy:   null,
    approvedAt:   null,
    rejectedReason: null,
    expiresAt:    new Date(Date.now() + TTL_MS).toISOString(),
  };
  store[id] = req;
  _save(store);
  return req;
}

/**
 * Approve a pending request.
 */
function approve(requestId, opts = {}) {
  const store = _load();
  const req   = store[requestId];
  if (!req) return null;
  if (req.status !== "pending") return req;
  req.status     = "approved";
  req.approvedBy = opts.approvedBy || "operator";
  req.approvedAt = new Date().toISOString();
  _save(store);
  return req;
}

/**
 * Reject a pending request.
 */
function reject(requestId, opts = {}) {
  const store = _load();
  const req   = store[requestId];
  if (!req) return null;
  req.status         = "rejected";
  req.rejectedReason = opts.reason || "manual_rejection";
  req.approvedAt     = new Date().toISOString();
  _save(store);
  return req;
}

/**
 * Get a request by id.
 */
function getRequest(requestId) {
  const r = _load()[requestId];
  if (!r) return null;
  // Auto-expire
  if (r.status === "pending" && new Date(r.expiresAt) < new Date()) {
    r.status = "expired";
    const store = _load();
    store[requestId] = r;
    _save(store);
  }
  return r;
}

/**
 * List pending requests (for approval queue UI).
 */
function listPending() {
  const store = _load();
  return Object.values(store)
    .filter(r => r.status === "pending" && new Date(r.expiresAt) > new Date())
    .sort((a, b) => new Date(b.ts) - new Date(a.ts));
}

/**
 * List all requests (with optional status filter).
 */
function listAll(opts = {}) {
  const store = _load();
  let list = Object.values(store);
  if (opts.status) list = list.filter(r => r.status === opts.status);
  return list.sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, opts.limit || 100);
}

/**
 * Queue summary for dashboard.
 */
function summary() {
  const store = _load();
  const all   = Object.values(store);
  return {
    pending:  all.filter(r => r.status === "pending").length,
    approved: all.filter(r => r.status === "approved").length,
    rejected: all.filter(r => r.status === "rejected").length,
    expired:  all.filter(r => r.status === "expired").length,
    total:    all.length,
  };
}

module.exports = { scanSteps, createRequest, approve, reject, getRequest, listPending, listAll, summary };
