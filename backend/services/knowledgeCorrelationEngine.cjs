"use strict";
/**
 * knowledgeCorrelationEngine.cjs — POST-Ω P14 Universal Knowledge Network
 *
 * Finds cross-domain relationships between items across existing knowledge
 * sources. No new graph — correlates by shared tags, domains, concepts,
 * failure patterns and learning signals already in the platform.
 *
 * Storage: data/knowledge-correlations.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "knowledge-correlations.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _kfe = () => _try(() => require("./knowledgeFederationEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _kre = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _rke = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _err = () => _try(() => require("./engineeringRuleRegistry.cjs"));
const _sie = () => _try(() => require("./selfImprovementEngine.cjs"));
const _oai = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _obi = () => _try(() => require("./businessReasoningEngine.cjs"));
const _pb  = () => _try(() => require("./productionBibleEngine.cjs"));
const _mce = () => _try(() => require("./marketplaceCatalogEngine.cjs"));
const _kev = () => _try(() => require("./knowledgeEvolutionEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `kcor_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const CORRELATION_TYPES = [
  "failure_pattern",    // same failure class across engineering + ops
  "workflow_overlap",   // same workflow in Bible + FWR + automation packs
  "learning_signal",    // lesson reinforced across CLE + SIE + KRE
  "domain_bridge",      // concept surfacing in multiple domains
  "quality_trend",      // quality signal correlated across sources
  "evolution_link",     // evolution cycle connects sources
];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { correlations: [], stats: { total: 0, byType: {}, avgStrength: 0 }, updatedAt: null };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.correlations)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.correlations.length > 2000) d.correlations = d.correlations.slice(-2000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Correlation builders ──────────────────────────────────────────────────────

function _correlateFailures() {
  const correlations = [];
  try {
    // CLE lessons by failure type vs ERR rules
    const cleStats = _cle()?.getStats?.() || {};
    const errStats = _err()?.getStats?.() || {};
    const cleFailures = cleStats.lessonsByType?.failure || 0;
    const errRules    = errStats.total || 0;
    if (cleFailures > 0 && errRules > 0) {
      correlations.push({
        id: _id(), type: "failure_pattern",
        sourceA: "continuous_learning", sourceB: "engineering_rule_registry",
        label: "Failure lessons reinforce engineering rules",
        strength: Math.min(100, Math.round((cleFailures / (cleFailures + 1)) * 80 + errRules * 2)),
        evidence: { cleFailures, errRules },
        discoveredAt: _ts(),
      });
    }

    // SIE patterns vs KRE analyses
    const sieStats = _sie()?.getStatistics?.() || {};
    const kreStats = _kre()?.getStats?.() || {};
    if ((sieStats.pendingPatterns || 0) > 0 && (kreStats.total || 0) > 0) {
      correlations.push({
        id: _id(), type: "failure_pattern",
        sourceA: "self_improvement", sourceB: "knowledge_reasoning",
        label: "Self-improvement patterns align with knowledge analyses",
        strength: Math.min(100, 60 + (sieStats.pendingPatterns || 0) * 2),
        evidence: { patterns: sieStats.pendingPatterns, kreItems: kreStats.total },
        discoveredAt: _ts(),
      });
    }
  } catch {}
  return correlations;
}

function _correlateWorkflows() {
  const correlations = [];
  try {
    const bible = _pb()?.getBible?.() || {};
    const bibleWf = bible.workflows?.length || 0;
    const mktAssets = _mce()?.listAssets?.({ type: "automation_pack", limit: 100 })?.total || 0;
    if (bibleWf > 0 && mktAssets > 0) {
      correlations.push({
        id: _id(), type: "workflow_overlap",
        sourceA: "production_bible", sourceB: "marketplace_catalog",
        label: "Production bible workflows published as marketplace automation packs",
        strength: Math.min(100, Math.round((mktAssets / bibleWf) * 100)),
        evidence: { bibleWorkflows: bibleWf, marketplaceAutomationPacks: mktAssets },
        discoveredAt: _ts(),
      });
    }

    // RKE recommendations vs marketplace blueprints
    const rkeStats = _rke()?.getStats?.() || {};
    const bpAssets = _mce()?.listAssets?.({ type: "blueprint", limit: 100 })?.total || 0;
    if ((rkeStats.recommendationsGenerated || 0) > 0 && bpAssets > 0) {
      correlations.push({
        id: _id(), type: "workflow_overlap",
        sourceA: "research_knowledge", sourceB: "marketplace_catalog",
        label: "Research recommendations surfaced as marketplace blueprints",
        strength: Math.min(100, 50 + Math.round(bpAssets / 10)),
        evidence: { rkeRecs: rkeStats.recommendationsGenerated, blueprints: bpAssets },
        discoveredAt: _ts(),
      });
    }
  } catch {}
  return correlations;
}

function _correlateLearning() {
  const correlations = [];
  try {
    const cleStats = _cle()?.getStats?.() || {};
    const oaiStats = _oai()?.getStats?.() || {};
    const totalLessons = cleStats.totalLessons || 0;
    if (totalLessons > 0 && (oaiStats.total || 0) > 0) {
      correlations.push({
        id: _id(), type: "learning_signal",
        sourceA: "continuous_learning", sourceB: "engineering_reasoning",
        label: "CLE lessons feed engineering reasoning analyses",
        strength: Math.min(100, 70 + Math.round(Math.log10(totalLessons + 1) * 10)),
        evidence: { lessons: totalLessons, reasoningItems: oaiStats.total },
        discoveredAt: _ts(),
      });
    }

    const obiStats = _obi()?.getStats?.() || {};
    if ((obiStats.total || 0) > 0 && totalLessons > 0) {
      correlations.push({
        id: _id(), type: "learning_signal",
        sourceA: "continuous_learning", sourceB: "business_reasoning",
        label: "Business decisions generate founder_action lessons in CLE",
        strength: Math.min(100, 65 + Math.round((cleStats.lessonsByType?.founder_action || 0) / 10)),
        evidence: { founderActionLessons: cleStats.lessonsByType?.founder_action, obiItems: obiStats.total },
        discoveredAt: _ts(),
      });
    }
  } catch {}
  return correlations;
}

function _correlateDomainBridges() {
  const correlations = [];
  try {
    // Engineering ↔ Business via workforce
    const kfe = _kfe();
    const fedSrcs = kfe ? Object.values(_load_index(kfe)) : [];
    const eng = fedSrcs.filter(s => s.domain === "engineering" && s.healthy);
    const biz = fedSrcs.filter(s => s.domain === "business" && s.healthy);
    if (eng.length > 0 && biz.length > 0) {
      correlations.push({
        id: _id(), type: "domain_bridge",
        sourceA: "engineering_reasoning", sourceB: "business_reasoning",
        label: "Engineering and business reasoning share workforce context",
        strength: 75,
        evidence: { engineeringSources: eng.length, businessSources: biz.length },
        discoveredAt: _ts(),
      });
    }

    // Research ↔ Marketplace
    const rkeStats = _rke()?.getStats?.() || {};
    if ((rkeStats.findingsIndexed || 0) > 0) {
      correlations.push({
        id: _id(), type: "domain_bridge",
        sourceA: "research_knowledge", sourceB: "marketplace_catalog",
        label: "Research findings drive knowledge pack creation in marketplace",
        strength: 70,
        evidence: { findings: rkeStats.findingsIndexed, radarEntries: rkeStats.radarEntries },
        discoveredAt: _ts(),
      });
    }
  } catch {}
  return correlations;
}

function _load_index(kfe) {
  try {
    const d = JSON.parse(require("fs").readFileSync(
      require("path").join(require("path").join(__dirname, "../.."), "data", "knowledge-federation.json"), "utf8"
    ));
    return d.index || {};
  } catch { return {}; }
}

function _correlateQuality() {
  const correlations = [];
  try {
    const kqeStats  = require("./knowledgeQualityEngine.cjs")?.getStats?.() || {};
    const sieStats  = _sie()?.getStatistics?.() || {};
    if ((kqeStats.total || 0) > 0) {
      const repairSuccess = sieStats.improvementScores?.repairSuccess || 0;
      const score = typeof repairSuccess === "number" && repairSuccess > 1 ? repairSuccess : repairSuccess * 100;
      correlations.push({
        id: _id(), type: "quality_trend",
        sourceA: "knowledge_quality", sourceB: "self_improvement",
        label: "Knowledge quality scores correlate with self-improvement repair rates",
        strength: Math.min(100, Math.round((kqeStats.avgScore || 0) * 0.5 + score * 0.5)),
        evidence: { kqeItems: kqeStats.total, repairSuccess: score },
        discoveredAt: _ts(),
      });
    }
  } catch {}
  return correlations;
}

// ── Core: correlate ───────────────────────────────────────────────────────────

function correlate() {
  const all = [
    ..._correlateFailures(),
    ..._correlateWorkflows(),
    ..._correlateLearning(),
    ..._correlateDomainBridges(),
    ..._correlateQuality(),
  ];

  const d = _load();
  // Replace with fresh set (de-dup by type+sourceA+sourceB)
  const existing = new Map(d.correlations.map(c => [`${c.type}:${c.sourceA}:${c.sourceB}`, c]));
  all.forEach(c => existing.set(`${c.type}:${c.sourceA}:${c.sourceB}`, c));
  d.correlations = [...existing.values()];

  const byType = {};
  CORRELATION_TYPES.forEach(t => { byType[t] = 0; });
  d.correlations.forEach(c => { if (byType[c.type] !== undefined) byType[c.type]++; });
  const avgStrength = d.correlations.length
    ? Math.round(d.correlations.reduce((s, c) => s + c.strength, 0) / d.correlations.length)
    : 0;
  d.stats = { total: d.correlations.length, byType, avgStrength };
  _save(d);

  return { ok: true, found: all.length, total: d.correlations.length, avgStrength, byType };
}

function getCorrelation(id) {
  return _load().correlations.find(c => c.id === id) || null;
}

function listCorrelations({ type, sourceId, limit = 50 } = {}) {
  let cs = _load().correlations;
  if (type)     cs = cs.filter(c => c.type === type);
  if (sourceId) cs = cs.filter(c => c.sourceA === sourceId || c.sourceB === sourceId);
  cs = cs.sort((a, b) => b.strength - a.strength);
  return { ok: true, correlations: cs.slice(0, limit), total: cs.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, CORRELATION_TYPES, updatedAt: d.updatedAt };
}

module.exports = {
  CORRELATION_TYPES,
  correlate,
  getCorrelation,
  listCorrelations,
  getStats,
};
