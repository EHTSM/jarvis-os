"use strict";
/**
 * organizationGovernanceEngine.cjs — POST-Ω P20 Artificial Organization Network
 *
 * Tracks inter-org agreements, trust scores, compliance, reputation, and ownership.
 * Does NOT re-implement governance of any individual org.
 * Federation-level governance only.
 *
 * Reuses: organizationRegistryEngine, organizationCollaborationEngine,
 *         digitalTwinEngine, selfImprovementEngine, capitalAllocationEngine,
 *         riskAssessmentEngine.
 *
 * Storage: data/org-governance.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "org-governance.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _reg    = () => _try(() => require("./organizationRegistryEngine.cjs"));
const _collab = () => _try(() => require("./organizationCollaborationEngine.cjs"));
const _twin   = () => _try(() => require("./digitalTwinEngine.cjs"));
const _sie    = () => _try(() => require("./selfImprovementEngine.cjs"));
const _cap    = () => _try(() => require("./capitalAllocationEngine.cjs"));
const _risk   = () => _try(() => require("./riskAssessmentEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `gov_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const AGREEMENT_TYPES = [
  "service_level",
  "data_sharing",
  "workforce_exchange",
  "revenue_sharing",
  "knowledge_sharing",
  "infrastructure_access",
];

const AGREEMENT_STATUSES = ["draft", "active", "expired", "terminated", "renegotiating"];

const COMPLIANCE_DIMENSIONS = [
  "data_privacy",
  "security",
  "performance_sla",
  "audit_trail",
  "conflict_of_interest",
];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = {
    agreements:    [],
    trustScores:   {},
    violations:    [],
    reputations:   {},
  };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.agreements)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.agreements.length > 1000) d.agreements = d.agreements.slice(-1000);
  if (d.violations.length > 1000) d.violations = d.violations.slice(-1000);
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Trust Score ───────────────────────────────────────────────────────────────

function _computeTrustScore(orgId, d) {
  const collabStats = _collab()?.getCollaborationStats?.() || { total: 0, successRate: 0 };
  const violations  = d.violations.filter(v => v.orgId === orgId).length;
  const agreements  = d.agreements.filter(a => (a.fromOrgId === orgId || a.toOrgId === orgId) && a.status === "active").length;
  const base        = 50;
  const trust       = Math.max(0, Math.min(100,
    base
    + (collabStats.successRate * 0.3)
    + (agreements * 5)
    - (violations * 15)
  ));
  return Math.round(trust);
}

// ── Agreements ────────────────────────────────────────────────────────────────

function createAgreement({ fromOrgId, toOrgId, type, terms = {}, expiresAt } = {}) {
  if (!fromOrgId || !toOrgId) return { ok: false, error: "fromOrgId and toOrgId are required" };
  if (!AGREEMENT_TYPES.includes(type)) return { ok: false, error: `Unknown type: ${type}` };

  const reg     = _reg();
  const fromOrg = reg?.getOrg(fromOrgId);
  const toOrg   = reg?.getOrg(toOrgId);
  if (!fromOrg) return { ok: false, error: `Org ${fromOrgId} not found` };
  if (!toOrg)   return { ok: false, error: `Org ${toOrgId} not found` };

  const d = _load();
  const agreement = {
    id: _id(),
    fromOrgId,  fromOrgName: fromOrg.name,
    toOrgId,    toOrgName:   toOrg.name,
    type,
    terms,
    status:     "active",
    expiresAt:  expiresAt || null,
    createdAt:  _ts(),
    updatedAt:  _ts(),
    complianceScore: 100,
  };

  d.agreements.push(agreement);

  // Update trust scores
  d.trustScores[fromOrgId] = _computeTrustScore(fromOrgId, d);
  d.trustScores[toOrgId]   = _computeTrustScore(toOrgId, d);

  _save(d);
  return { ok: true, agreement };
}

function updateAgreement(id, { status, terms } = {}) {
  const d = _load();
  const a = d.agreements.find(x => x.id === id);
  if (!a) return { ok: false, error: `Agreement ${id} not found` };
  if (status && AGREEMENT_STATUSES.includes(status)) a.status = status;
  if (terms) a.terms = { ...a.terms, ...terms };
  a.updatedAt = _ts();
  _save(d);
  return { ok: true, agreement: a };
}

function getAgreement(id) { return _load().agreements.find(a => a.id === id) || null; }

function listAgreements({ fromOrgId, toOrgId, type, status, limit = 100 } = {}) {
  let items = _load().agreements;
  if (fromOrgId) items = items.filter(a => a.fromOrgId === fromOrgId || a.toOrgId === fromOrgId);
  if (toOrgId)   items = items.filter(a => a.fromOrgId === toOrgId   || a.toOrgId === toOrgId);
  if (type)      items = items.filter(a => a.type === type);
  if (status)    items = items.filter(a => a.status === status);
  return { ok: true, agreements: items.slice(0, limit), total: items.length };
}

// ── Trust Network ─────────────────────────────────────────────────────────────

function getTrustScore(orgId) {
  const d     = _load();
  const score = d.trustScores[orgId];
  if (score !== undefined) return { ok: true, orgId, trustScore: score };
  const computed = _computeTrustScore(orgId, d);
  return { ok: true, orgId, trustScore: computed };
}

function getTrustNetwork() {
  const reg = _reg();
  if (!reg) return { ok: false, error: "Registry unavailable" };
  const d    = _load();
  const orgs = reg.listOrgs({ status: "active" }).orgs;

  const network = orgs.map(org => ({
    orgId:      org.id,
    name:       org.name,
    trustLevel: org.trustLevel,
    trustScore: d.trustScores[org.id] || _computeTrustScore(org.id, d),
    agreements: d.agreements.filter(a => a.fromOrgId === org.id || a.toOrgId === org.id).length,
    violations: d.violations.filter(v => v.orgId === org.id).length,
  }));

  const avgTrust = network.length > 0
    ? Math.round(network.reduce((s, n) => s + n.trustScore, 0) / network.length)
    : 0;

  return { ok: true, network, totalOrgs: network.length, avgTrustScore: avgTrust };
}

// ── Compliance ────────────────────────────────────────────────────────────────

function assessCompliance() {
  const d          = _load();
  const risk       = _risk()?.assess?.() || { risks: [] };
  const violations = [];

  COMPLIANCE_DIMENSIONS.forEach(dim => {
    const relevant = (risk.risks || []).filter(r => r.category?.includes(dim));
    if (relevant.some(r => r.severity === "critical")) {
      violations.push({
        id:       _id(),
        dimension: dim,
        severity: "critical",
        source:   "risk_engine",
        ts:       _ts(),
      });
    }
  });

  d.violations.push(...violations);

  const totalActive = d.agreements.filter(a => a.status === "active").length;
  const complianceScore = Math.max(0, 100 - (violations.length * 10));

  d.agreements.forEach(a => { if (a.status === "active") a.complianceScore = complianceScore; });
  _save(d);

  return {
    ok: true,
    complianceScore,
    violationsFound: violations.length,
    violations,
    totalActiveAgreements: totalActive,
    COMPLIANCE_DIMENSIONS,
  };
}

function recordViolation({ orgId, dimension, severity, note } = {}) {
  if (!orgId) return { ok: false, error: "orgId required" };
  const d = _load();
  const v = { id: _id(), orgId, dimension: dimension || "general", severity: severity || "medium", note, ts: _ts() };
  d.violations.push(v);
  d.trustScores[orgId] = _computeTrustScore(orgId, d);
  _save(d);
  return { ok: true, violation: v };
}

function getStats() {
  const d = _load();
  const byType   = {};
  const byStatus = {};
  AGREEMENT_TYPES.forEach(t => { byType[t] = 0; });
  AGREEMENT_STATUSES.forEach(s => { byStatus[s] = 0; });
  d.agreements.forEach(a => {
    if (byType[a.type]     !== undefined) byType[a.type]++;
    if (byStatus[a.status] !== undefined) byStatus[a.status]++;
  });
  return {
    totalAgreements: d.agreements.length,
    totalViolations: d.violations.length,
    byType,
    byStatus,
    AGREEMENT_TYPES,
    COMPLIANCE_DIMENSIONS,
  };
}

module.exports = {
  AGREEMENT_TYPES,
  AGREEMENT_STATUSES,
  COMPLIANCE_DIMENSIONS,
  createAgreement,
  updateAgreement,
  getAgreement,
  listAgreements,
  getTrustScore,
  getTrustNetwork,
  assessCompliance,
  recordViolation,
  getStats,
};
