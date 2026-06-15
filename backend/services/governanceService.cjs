"use strict";
/**
 * K4 — Enterprise Governance Service
 * Manages: governance policies, policy templates, compliance profiles,
 *          risk matrix, governance reports.
 * Storage: data/governance-layer.json (keyed by workspaceId)
 * Reports reuse securityLayer.getAuditLog + workspaceService.getActivity
 *   — zero duplicate logs, zero duplicate audit storage.
 */
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DATA_FILE = path.join(__dirname, "../../data/governance-layer.json");

// ── Lazy deps ─────────────────────────────────────────────────────
let _secSvc = null, _wsSvc = null, _adminSvc = null, _bus = null;
function _security()  { if (!_secSvc)   try { _secSvc   = require("./securityLayer.cjs"); }   catch {} return _secSvc; }
function _workspace() { if (!_wsSvc)    try { _wsSvc    = require("./workspaceService.cjs"); } catch {} return _wsSvc; }
function _admin()     { if (!_adminSvc) try { _adminSvc = require("./adminService.cjs"); }      catch {} return _adminSvc; }
function _evtBus()    { if (!_bus)      try { _bus       = require("../../agents/runtime/runtimeEventBus.cjs"); } catch {} return _bus; }

// ── Policy types & enforcement levels ────────────────────────────
const POLICY_TYPES = ["approval", "change", "deployment", "environment", "retention", "audit_retention", "access"];
const ENFORCEMENT  = ["advisory", "blocking", "logging"];

// ── Built-in policy templates ─────────────────────────────────────
const BUILT_IN_TEMPLATES = [
  {
    id:          "tpl_soc2",
    name:        "SOC 2 Type II",
    description: "Common SOC 2 controls: audit log retention, access reviews, change management.",
    category:    "compliance",
    policies: [
      { type: "audit_retention",  name: "Audit Log Retention",   enforcement: "blocking", rules: [{ field: "retentionDays", value: 365 }] },
      { type: "access",           name: "Access Review Policy",  enforcement: "advisory", rules: [{ field: "reviewCycleDays", value: 90 }] },
      { type: "change",           name: "Change Management",     enforcement: "blocking", rules: [{ field: "requireApproval", value: true }] },
    ],
  },
  {
    id:          "tpl_gdpr",
    name:        "GDPR Baseline",
    description: "Data retention, access controls, and audit requirements for GDPR compliance.",
    category:    "compliance",
    policies: [
      { type: "retention",        name: "Data Retention Policy", enforcement: "blocking", rules: [{ field: "maxRetentionDays", value: 730 }] },
      { type: "access",           name: "Data Access Controls",  enforcement: "blocking", rules: [{ field: "requireMfa", value: true }] },
      { type: "audit_retention",  name: "Audit Trail",           enforcement: "blocking", rules: [{ field: "retentionDays", value: 180 }] },
    ],
  },
  {
    id:          "tpl_hipaa",
    name:        "HIPAA Security",
    description: "Access controls, audit controls, and integrity requirements for HIPAA.",
    category:    "compliance",
    policies: [
      { type: "access",      name: "PHI Access Control",  enforcement: "blocking", rules: [{ field: "requireMfa", value: true }, { field: "sessionTimeoutHours", value: 8 }] },
      { type: "audit_retention", name: "Activity Audit", enforcement: "blocking", rules: [{ field: "retentionDays", value: 2190 }] },
      { type: "change",      name: "Change Control",      enforcement: "advisory", rules: [{ field: "requireApproval", value: true }] },
    ],
  },
  {
    id:          "tpl_iso27001",
    name:        "ISO 27001 Core",
    description: "Information security management controls aligned to ISO 27001 Annex A.",
    category:    "security",
    policies: [
      { type: "access",      name: "Access Management",   enforcement: "blocking", rules: [{ field: "maxSessionsPerUser", value: 3 }] },
      { type: "change",      name: "Change Control",      enforcement: "blocking", rules: [{ field: "requireApproval", value: true }] },
      { type: "deployment",  name: "Deployment Approval", enforcement: "blocking", rules: [{ field: "requireSignOff", value: true }] },
    ],
  },
  {
    id:          "tpl_startup",
    name:        "Startup Baseline",
    description: "Lightweight governance suitable for early-stage teams.",
    category:    "operational",
    policies: [
      { type: "audit_retention", name: "Basic Audit",       enforcement: "logging",  rules: [{ field: "retentionDays", value: 90 }] },
      { type: "deployment",      name: "Deployment Policy", enforcement: "advisory", rules: [{ field: "requireApproval", value: false }] },
    ],
  },
];

// ── Compliance profile defaults ───────────────────────────────────
function _defaultCompliance() {
  return {
    frameworks:   [],          // ["soc2", "gdpr", "hipaa", "iso27001"]
    dataClassification: "internal",
    retentionDays: 365,
    riskTolerance: "medium",   // low | medium | high
    reviewCycleDays: 90,
    lastReviewAt:  null,
    nextReviewAt:  null,
    notes:         "",
  };
}

// ── Risk matrix defaults ──────────────────────────────────────────
const RISK_CATEGORIES = ["access", "data", "deployment", "compliance", "operational"];
const LIKELIHOOD_LEVELS = ["rare", "unlikely", "possible", "likely", "almost_certain"];
const IMPACT_LEVELS     = ["negligible", "minor", "moderate", "major", "critical"];

function _defaultRiskMatrix() {
  return RISK_CATEGORIES.map(cat => ({
    category:   cat,
    likelihood: "unlikely",
    impact:     "moderate",
    score:      2,         // likelihood_idx * impact_idx
    mitigation: "",
    updatedAt:  null,
  }));
}

// ── Storage ───────────────────────────────────────────────────────
function _read() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return {}; }
}
function _write(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

function _ws(workspaceId) {
  const all = _read();
  if (!all[workspaceId]) {
    all[workspaceId] = {
      policies:   [],
      templates:  [],      // workspace-local templates (in addition to built-ins)
      compliance: _defaultCompliance(),
      riskMatrix: _defaultRiskMatrix(),
    };
    _write(all);
  }
  return { all, ws: all[workspaceId] };
}
function _save(all) { _write(all); }

function _emit(event, payload) {
  try { _evtBus()?.emit(event, { ...payload, _ts: Date.now() }); } catch {}
  // Also write to securityLayer audit log so governance changes appear in the unified audit timeline
  try {
    _security()?.addAuditEntry(
      payload.workspaceId,
      payload.accountId || "system",
      `governance.${event}`,
      payload.detail || "",
      "success"
    );
  } catch {}
}

// ── Policies ──────────────────────────────────────────────────────

function getPolicies(workspaceId) {
  const { ws } = _ws(workspaceId);
  return ws.policies;
}

function createPolicy(workspaceId, { name, type, enforcement = "advisory", rules = [], description = "" }, requestingAccountId) {
  if (!name?.trim()) throw new Error("Policy name required");
  if (!POLICY_TYPES.includes(type)) throw new Error(`Invalid type. Must be one of: ${POLICY_TYPES.join(", ")}`);
  if (!ENFORCEMENT.includes(enforcement)) throw new Error(`Invalid enforcement. Must be: ${ENFORCEMENT.join(", ")}`);

  const { all, ws } = _ws(workspaceId);
  const policy = {
    id:            `pol_${crypto.randomBytes(6).toString("hex")}`,
    name:          name.trim(),
    type,
    enforcement,
    rules,
    description:   description.trim(),
    status:        "active",
    createdBy:     requestingAccountId,
    createdAt:     Date.now(),
    updatedAt:     Date.now(),
    evaluationCount: 0,
    violationCount:  0,
    lastEvaluatedAt: null,
  };
  ws.policies.push(policy);
  _emit("policy_created", { workspaceId, accountId: requestingAccountId, detail: `name=${name} type=${type}` });
  _save(all);
  return policy;
}

function updatePolicy(workspaceId, policyId, patch, requestingAccountId) {
  const { all, ws } = _ws(workspaceId);
  const policy = ws.policies.find(p => p.id === policyId);
  if (!policy) throw new Error("Policy not found");
  const ALLOWED = ["name", "enforcement", "rules", "description", "status"];
  for (const k of ALLOWED) { if (patch[k] !== undefined) policy[k] = patch[k]; }
  policy.updatedAt = Date.now();
  if (patch.status === "archived") policy.archivedAt = Date.now();
  _emit("policy_updated", { workspaceId, accountId: requestingAccountId, detail: `id=${policyId}` });
  _save(all);
  return policy;
}

// ── Templates ─────────────────────────────────────────────────────

function getTemplates(workspaceId) {
  const { ws } = _ws(workspaceId);
  return [...BUILT_IN_TEMPLATES, ...ws.templates];
}

function createTemplate(workspaceId, { name, description = "", category = "operational", policies = [] }, requestingAccountId) {
  if (!name?.trim()) throw new Error("Template name required");
  const { all, ws } = _ws(workspaceId);
  const tpl = {
    id:          `tpl_${crypto.randomBytes(6).toString("hex")}`,
    name:        name.trim(),
    description: description.trim(),
    category,
    policies,
    createdBy:   requestingAccountId,
    createdAt:   Date.now(),
    custom:      true,
  };
  ws.templates.push(tpl);
  _emit("template_created", { workspaceId, accountId: requestingAccountId, detail: `name=${name}` });
  _save(all);
  return tpl;
}

// ── Compliance ────────────────────────────────────────────────────

function getCompliance(workspaceId) {
  const { ws } = _ws(workspaceId);
  return ws.compliance;
}

function updateCompliance(workspaceId, patch, requestingAccountId) {
  const { all, ws } = _ws(workspaceId);
  const ALLOWED = ["frameworks", "dataClassification", "retentionDays", "riskTolerance", "reviewCycleDays", "notes"];
  for (const k of ALLOWED) { if (patch[k] !== undefined) ws.compliance[k] = patch[k]; }
  ws.compliance.lastReviewAt = Date.now();
  if (ws.compliance.reviewCycleDays) {
    ws.compliance.nextReviewAt = Date.now() + ws.compliance.reviewCycleDays * 86400_000;
  }
  _emit("compliance_updated", { workspaceId, accountId: requestingAccountId, detail: Object.keys(patch).join(",") });
  _save(all);
  return ws.compliance;
}

// ── Risk Matrix ───────────────────────────────────────────────────

function getRiskMatrix(workspaceId) {
  const { ws } = _ws(workspaceId);
  return ws.riskMatrix.map(r => ({
    ...r,
    likelihoodIdx: LIKELIHOOD_LEVELS.indexOf(r.likelihood),
    impactIdx:     IMPACT_LEVELS.indexOf(r.impact),
    score:         (LIKELIHOOD_LEVELS.indexOf(r.likelihood) + 1) * (IMPACT_LEVELS.indexOf(r.impact) + 1),
    riskLevel:     _riskLevel((LIKELIHOOD_LEVELS.indexOf(r.likelihood) + 1) * (IMPACT_LEVELS.indexOf(r.impact) + 1)),
  }));
}

function _riskLevel(score) {
  if (score >= 15) return "critical";
  if (score >= 9)  return "high";
  if (score >= 4)  return "medium";
  return "low";
}

function updateRiskEntry(workspaceId, category, { likelihood, impact, mitigation }, requestingAccountId) {
  const { all, ws } = _ws(workspaceId);
  const entry = ws.riskMatrix.find(r => r.category === category);
  if (!entry) throw new Error(`Risk category not found: ${category}`);
  if (likelihood && !LIKELIHOOD_LEVELS.includes(likelihood)) throw new Error("Invalid likelihood");
  if (impact     && !IMPACT_LEVELS.includes(impact))         throw new Error("Invalid impact");
  if (likelihood) entry.likelihood = likelihood;
  if (impact)     entry.impact     = impact;
  if (mitigation !== undefined) entry.mitigation = mitigation;
  entry.score     = (LIKELIHOOD_LEVELS.indexOf(entry.likelihood) + 1) * (IMPACT_LEVELS.indexOf(entry.impact) + 1);
  entry.updatedAt = Date.now();
  _emit("risk_updated", { workspaceId, accountId: requestingAccountId, detail: `category=${category}` });
  _save(all);
  return entry;
}

// ── Governance Reports ─────────────────────────────────────────────
// Reads from existing securityLayer audit log + workspaceService activity
// Zero new log storage — pure aggregation over existing data

function getReports(workspaceId) {
  const secSvc   = _security();
  const wsSvc    = _workspace();
  const adminSvc = _admin();

  // Pull data from existing services
  let auditLog = [], wsActivity = [], stats = {};
  try { if (secSvc)   auditLog   = secSvc.getAuditLog(workspaceId, { limit: 500 }); } catch {}
  try { if (wsSvc)    wsActivity = wsSvc.getActivity(workspaceId, 100);              } catch {}
  try { if (adminSvc) stats      = adminSvc.getStatistics(workspaceId);              } catch {}
  const { ws }    = _ws(workspaceId);
  const policies  = ws.policies || [];
  const compliance = ws.compliance || _defaultCompliance();
  const riskMatrix = getRiskMatrix(workspaceId);

  // Policy summary
  const activePolicies  = policies.filter(p => p.status === "active");
  const blockingPolicies = activePolicies.filter(p => p.enforcement === "blocking");

  // Audit summary — group by action prefix
  const auditByType = {};
  for (const e of auditLog) {
    const prefix = (e.action || "other").split(".")[0];
    auditByType[prefix] = (auditByType[prefix] || 0) + 1;
  }

  // Risk summary
  const riskCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of riskMatrix) riskCounts[r.riskLevel] = (riskCounts[r.riskLevel] || 0) + 1;

  // Compliance score — simple heuristic
  let complianceScore = 50;
  if (compliance.frameworks?.length > 0)  complianceScore += 15;
  if (blockingPolicies.length >= 2)       complianceScore += 15;
  if (riskCounts.critical === 0)          complianceScore += 10;
  if (riskCounts.high === 0)              complianceScore += 10;
  complianceScore = Math.min(complianceScore, 100);

  return {
    generatedAt:  Date.now(),
    policies: {
      total:    policies.length,
      active:   activePolicies.length,
      blocking: blockingPolicies.length,
      byType:   Object.fromEntries(POLICY_TYPES.map(t => [t, policies.filter(p => p.type === t).length])),
    },
    compliance: {
      score:       complianceScore,
      grade:       complianceScore >= 85 ? "A" : complianceScore >= 70 ? "B" : complianceScore >= 55 ? "C" : "D",
      frameworks:  compliance.frameworks || [],
      nextReview:  compliance.nextReviewAt,
    },
    risk: {
      summary:  riskCounts,
      highestRisk: riskMatrix.sort((a, b) => b.score - a.score).slice(0, 3),
    },
    audit: {
      totalEvents: auditLog.length,
      byType:      auditByType,
      recent:      auditLog.slice(0, 10),
    },
    members:     stats.members     || {},
    departments: stats.departments || {},
    activity: {
      total:   wsActivity.length,
      recent:  wsActivity.slice(0, 10),
    },
  };
}

module.exports = {
  getPolicies, createPolicy, updatePolicy,
  getTemplates, createTemplate,
  getCompliance, updateCompliance,
  getRiskMatrix, updateRiskEntry,
  getReports,
  POLICY_TYPES, ENFORCEMENT, LIKELIHOOD_LEVELS, IMPACT_LEVELS, RISK_CATEGORIES,
};
