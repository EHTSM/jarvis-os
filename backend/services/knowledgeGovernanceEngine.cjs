"use strict";
/**
 * knowledgeGovernanceEngine.cjs — POST-Ω P14 Universal Knowledge Network
 *
 * Governs knowledge items across the network by tracking:
 *   ownership, confidence, freshness, lineage, provenance.
 *
 * Does NOT store the knowledge itself — governs metadata about
 * existing items from federated sources.
 *
 * Storage: data/knowledge-governance.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "knowledge-governance.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _kfe  = () => _try(() => require("./knowledgeFederationEngine.cjs"));
const _kqe  = () => _try(() => require("./knowledgeQualityEngine.cjs"));
const _kev  = () => _try(() => require("./knowledgeEvolutionEngine.cjs"));
const _cle  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _sre  = () => _try(() => require("./selfReviewEngine.cjs"));
const _err  = () => _try(() => require("./engineeringRuleRegistry.cjs"));
const _rke  = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));

function _ts()  { return new Date().toISOString(); }
function _id()  { return `kgov_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// Governance dimensions
const GOVERNANCE_DIMENSIONS = [
  "ownership",    // who / what service is responsible
  "confidence",   // 0–100 confidence score for the item
  "freshness",    // age-weighted recency score
  "lineage",      // where the item came from (chain of sources)
  "provenance",   // original creation context
];

// ── Freshness calculation ─────────────────────────────────────────────────────

function _freshnessScore(updatedAt) {
  if (!updatedAt) return 40;
  const ageMs  = Date.now() - new Date(updatedAt).getTime();
  const ageDays= ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < 1)    return 100;
  if (ageDays < 7)    return 90;
  if (ageDays < 30)   return 75;
  if (ageDays < 90)   return 55;
  if (ageDays < 180)  return 40;
  return 25;
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = {
    records: [],
    policies: [],
    stats: { total: 0, avgConfidence: 0, avgFreshness: 0, byOwner: {} },
    updatedAt: null,
  };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.records)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.records.length > 2000) d.records = d.records.slice(-2000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Governance record builder ─────────────────────────────────────────────────

function _buildRecordForSource(srcId, srcMeta, probe) {
  const updatedAt = probe.meta?.updatedAt || null;
  const freshness = _freshnessScore(updatedAt);

  // Confidence: blend quality score (if available) with source health
  let confidence = probe.healthy ? 70 : 20;
  try {
    const kqe = _kqe()?.listScores?.({ limit: 1 });
    if (kqe?.scores?.length > 0) {
      const s = kqe.scores[0];
      confidence = Math.round((confidence + (s.overall || confidence)) / 2);
    }
  } catch {}

  return {
    id:          _id(),
    sourceId:    srcId,
    sourceName:  probe.name || srcId,
    domain:      probe.domain || "unknown",
    ownership:   probe.service || srcId,
    confidence:  Math.min(100, confidence),
    freshness,
    lineage:     [srcId],
    provenance:  `federated from ${probe.service || srcId}`,
    itemCount:   probe.itemCount || 0,
    governedAt:  _ts(),
  };
}

// ── Core: govern ─────────────────────────────────────────────────────────────

function governAll() {
  const kfe   = _kfe();
  const srcs  = kfe?.listSources?.()?.sources || [];

  const d     = _load();
  const byId  = new Map(d.records.map(r => [r.sourceId, r]));

  srcs.forEach(src => {
    byId.set(src.id, _buildRecordForSource(src.id, src, src));
  });

  d.records = [...byId.values()];

  // Stats
  const byOwner = {};
  let totalConf = 0, totalFresh = 0;
  d.records.forEach(r => {
    byOwner[r.ownership] = (byOwner[r.ownership] || 0) + 1;
    totalConf  += r.confidence;
    totalFresh += r.freshness;
  });
  const n = d.records.length || 1;
  d.stats = {
    total: d.records.length,
    avgConfidence: Math.round(totalConf / n),
    avgFreshness:  Math.round(totalFresh / n),
    byOwner,
    staleItems:    d.records.filter(r => r.freshness < 50).length,
    lowConfidence: d.records.filter(r => r.confidence < 50).length,
  };
  _save(d);

  return { ok: true, governed: d.records.length, ...d.stats };
}

function governRecord(sourceId, overrides = {}) {
  const kfe   = _kfe();
  const src   = kfe?.getSource?.(sourceId) || null;
  if (!src)   return { ok: false, error: `source not found: ${sourceId}` };

  const record = _buildRecordForSource(sourceId, src, src);
  Object.assign(record, overrides);

  const d = _load();
  const idx = d.records.findIndex(r => r.sourceId === sourceId);
  if (idx >= 0) d.records[idx] = record;
  else d.records.push(record);
  _save(d);

  return { ok: true, record };
}

// ── Policies ──────────────────────────────────────────────────────────────────

function addPolicy({ name, condition, action, description } = {}) {
  if (!name || !condition || !action) return { ok: false, error: "name, condition, action required" };
  const d = _load();
  const policy = { id: _id(), name, condition, action, description, createdAt: _ts() };
  d.policies.push(policy);
  _save(d);
  return { ok: true, policy };
}

function listPolicies() {
  return { ok: true, policies: _load().policies };
}

function getRecord(sourceId) {
  return _load().records.find(r => r.sourceId === sourceId) || null;
}

function listRecords({ domain, minConfidence, minFreshness, limit = 50 } = {}) {
  let recs = _load().records;
  if (domain)        recs = recs.filter(r => r.domain === domain);
  if (minConfidence) recs = recs.filter(r => r.confidence >= minConfidence);
  if (minFreshness)  recs = recs.filter(r => r.freshness >= minFreshness);
  recs = recs.sort((a, b) => b.confidence - a.confidence);
  return { ok: true, records: recs.slice(0, limit), total: recs.length };
}

// ── Health report ─────────────────────────────────────────────────────────────

function getGovernanceHealth() {
  const s = _load().stats;
  return {
    ok: true,
    governed:         s.total || 0,
    avgConfidence:    s.avgConfidence || 0,
    avgFreshness:     s.avgFreshness || 0,
    staleItems:       s.staleItems || 0,
    lowConfidence:    s.lowConfidence || 0,
    healthScore:      Math.round(
      (((s.avgConfidence || 0) + (s.avgFreshness || 0)) / 2) *
      (1 - (s.staleItems || 0) / Math.max(1, s.total))
    ),
  };
}

function getStats() {
  const d = _load();
  return { ...d.stats, GOVERNANCE_DIMENSIONS, updatedAt: d.updatedAt };
}

module.exports = {
  GOVERNANCE_DIMENSIONS,
  governAll,
  governRecord,
  addPolicy,
  listPolicies,
  getRecord,
  listRecords,
  getGovernanceHealth,
  getStats,
};
