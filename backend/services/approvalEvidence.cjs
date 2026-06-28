"use strict";
/**
 * approvalEvidence.cjs — POST-Ω Sprint P4
 *
 * Records measurable evidence for every approval lifecycle event:
 *   created → approved/rejected/expired → resumed → verified
 *
 * Reuses executionEvidence.cjs patterns (append-only NDJSON) but is
 * approval-specific — stores approval package, response time, and
 * post-approval execution outcome.
 *
 * Storage: data/approval-evidence.ndjson + data/approval-evidence-index.json
 */

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT       = path.join(__dirname, "../..");
const NDJSON     = path.join(ROOT, "data", "approval-evidence.ndjson");
const INDEX      = path.join(ROOT, "data", "approval-evidence-index.json");

const _try  = fn => { try { return fn(); } catch { return null; } };
const _le   = () => _try(() => require("./continuousLearningEngine.cjs"));
const _pbe  = () => _try(() => require("./productionBibleEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `aev_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`; }

function _gitCommit() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT, timeout: 3000, stdio: ["ignore","pipe","ignore"] }).toString().trim(); }
  catch { return "unknown"; }
}

function _append(record) {
  fs.mkdirSync(path.dirname(NDJSON), { recursive: true });
  fs.appendFileSync(NDJSON, JSON.stringify(record) + "\n");
}

function _updateIndex(record) {
  let idx = [];
  try { idx = JSON.parse(fs.readFileSync(INDEX, "utf8")); } catch {}
  idx.push({
    evidenceId:    record.evidenceId,
    reqId:         record.reqId,
    workflowId:    record.workflowId,
    approvalType:  record.approvalType,
    event:         record.event,
    ts:            record.ts,
    responseMs:    record.responseMs,
    autoApproved:  record.autoApproved,
    outcome:       record.outcome,
    minutesSaved:  record.minutesSaved,
  });
  if (idx.length > 1000) idx = idx.slice(-1000);
  fs.writeFileSync(INDEX, JSON.stringify(idx, null, 2));
}

// ── Core: Record an approval event ────────────────────────────────────────────

function record({
  reqId,
  workflowId,
  approvalType,
  event,            // "created" | "approved" | "auto_approved" | "rejected" | "expired" | "resumed" | "verified"
  responseMs   = null,
  autoApproved = false,
  approvedBy   = null,
  rejectedReason = null,
  outcome      = null,
  minutesSaved = 0,
  executionId  = null,
  notes        = "",
}) {
  const evidenceId = _id();
  const rec = {
    evidenceId,
    reqId,
    workflowId,
    approvalType,
    event,
    ts:            _ts(),
    responseMs,
    responseMinutes: responseMs != null ? Math.round(responseMs / 60000 * 10) / 10 : null,
    autoApproved,
    approvedBy,
    rejectedReason,
    outcome,
    minutesSaved,
    executionId,
    gitCommit:     _gitCommit(),
    notes,
  };

  _append(rec);
  _updateIndex(rec);

  // Update continuous learning
  _try(() => _le()?.createLesson?.({
    type:       "approval_evidence",
    title:      `Approval ${event}: ${workflowId} (${approvalType})`,
    source:     "approvalEvidence",
    confidence: event === "verified" ? 0.95 : 0.7,
    tags:       ["approval", event, approvalType, workflowId.split("_")[1] || "general"],
    data:       { reqId, workflowId, approvalType, event, responseMs, autoApproved, outcome, minutesSaved },
  }));

  // Update Production Bible on successful completion
  if (event === "verified" && outcome === "success") {
    _try(() => _pbe()?.executeWorkflow?.(`pbw_fwr_${workflowId}`, { triggeredBy: "approvalEvidence" }));
  }

  return { ok: true, evidenceId, record: rec };
}

// ── Queries ───────────────────────────────────────────────────────────────────

function getEvidence(evidenceId) {
  try {
    const lines = fs.readFileSync(NDJSON, "utf8").trim().split("\n").filter(Boolean);
    for (const line of lines.reverse()) {
      try { const r = JSON.parse(line); if (r.evidenceId === evidenceId) return r; } catch {}
    }
  } catch {}
  return null;
}

function listEvidence({ workflowId, event, approvalType, limit = 50 } = {}) {
  let idx = [];
  try { idx = JSON.parse(fs.readFileSync(INDEX, "utf8")); } catch {}
  if (workflowId)   idx = idx.filter(e => e.workflowId === workflowId);
  if (event)        idx = idx.filter(e => e.event === event);
  if (approvalType) idx = idx.filter(e => e.approvalType === approvalType);
  return idx.slice(-limit).reverse();
}

function getSummary() {
  let idx = [];
  try { idx = JSON.parse(fs.readFileSync(INDEX, "utf8")); } catch {}
  const total        = idx.length;
  const approved     = idx.filter(e => e.event === "approved" || e.event === "auto_approved").length;
  const autoApproved = idx.filter(e => e.autoApproved).length;
  const rejected     = idx.filter(e => e.event === "rejected").length;
  const verified     = idx.filter(e => e.event === "verified").length;
  const withResponse = idx.filter(e => e.responseMs != null && e.responseMs > 0);
  const avgResponseMs = withResponse.length > 0
    ? Math.round(withResponse.reduce((s, e) => s + e.responseMs, 0) / withResponse.length)
    : 0;
  const minutesSaved = idx.filter(e => e.event === "verified").reduce((s, e) => s + (e.minutesSaved || 0), 0);

  return {
    totalEvents:      total,
    approved,
    autoApproved,
    rejected,
    verified,
    avgResponseMs,
    avgResponseMinutes: Math.round(avgResponseMs / 60000 * 10) / 10,
    minutesSaved,
  };
}

module.exports = { record, getEvidence, listEvidence, getSummary };
