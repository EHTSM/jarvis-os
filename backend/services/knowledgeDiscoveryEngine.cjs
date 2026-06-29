"use strict";
/**
 * knowledgeDiscoveryEngine.cjs — POST-Ω P14 Universal Knowledge Network
 *
 * Automatically discovers valuable knowledge items hiding in existing sources.
 * Pulls from: CLE lessons, ERR rules, research findings, Bible workflows,
 * SIE patterns, KRE analyses, marketplace assets, RKE radar.
 *
 * Does NOT create new storage — surfaces existing items as discoveries.
 *
 * Storage: data/knowledge-discovery.json  (discovery index only)
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "knowledge-discovery.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _err = () => _try(() => require("./engineeringRuleRegistry.cjs"));
const _rke = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _pb  = () => _try(() => require("./productionBibleEngine.cjs"));
const _sie = () => _try(() => require("./selfImprovementEngine.cjs"));
const _kre = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _mce = () => _try(() => require("./marketplaceCatalogEngine.cjs"));
const _kev = () => _try(() => require("./knowledgeEvolutionEngine.cjs"));
const _kqe = () => _try(() => require("./knowledgeQualityEngine.cjs"));
const _eme = () => _try(() => require("./engineeringMemoryEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `kdsc_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const DISCOVERY_CATEGORIES = [
  "high_value_lesson",    // CLE lesson with high application count
  "reusable_rule",        // ERR rule applicable across many error classes
  "research_signal",      // RKE finding with high confidence / radar prominence
  "bible_workflow",       // Production Bible workflow not yet automated
  "improvement_pattern",  // SIE pattern with >75% success rate
  "marketplace_asset",    // High-download or high-cert marketplace asset
  "knowledge_gap",        // Source with zero items — opportunity to grow
  "cross_domain_gem",     // KRE item with high score touching multiple domains
];

const DISCOVERY_THRESHOLDS = {
  high_value_lesson:   { minLessons: 10 },
  reusable_rule:       { minRules: 5 },
  research_signal:     { minFindings: 20 },
  bible_workflow:      { minWorkflows: 5 },
  improvement_pattern: { minPatterns: 1 },
  marketplace_asset:   { minAssets: 5 },
  knowledge_gap:       { maxItems: 0 },
  cross_domain_gem:    { minScore: 50 },
};

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { discoveries: [], stats: { total: 0, byCategory: {}, newSinceLastRun: 0 }, lastRun: null, updatedAt: null };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.discoveries)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.discoveries.length > 1000) d.discoveries = d.discoveries.slice(-1000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Discovery runners ─────────────────────────────────────────────────────────

function _discoverHighValueLessons() {
  const items = [];
  try {
    const s = _cle()?.getStats?.() || {};
    const total = s.totalLessons || 0;
    if (total >= DISCOVERY_THRESHOLDS.high_value_lesson.minLessons) {
      const top = Object.entries(s.lessonsByType || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      top.forEach(([type, count]) => {
        if (count > 10) {
          items.push({
            id: _id(), category: "high_value_lesson",
            title:  `High-frequency lesson: ${type}`,
            source: "continuous_learning",
            value:  Math.min(100, Math.round(count / total * 100 * 10 + 50)),
            meta:   { lessonType: type, count },
            discoveredAt: _ts(),
          });
        }
      });
    }
  } catch {}
  return items;
}

function _discoverReusableRules() {
  const items = [];
  try {
    const s = _err()?.getStats?.() || {};
    if ((s.total || 0) >= DISCOVERY_THRESHOLDS.reusable_rule.minRules) {
      (s.classes || []).forEach(cls => {
        items.push({
          id: _id(), category: "reusable_rule",
          title:  `Reusable rule: ${cls}`,
          source: "engineering_rule_registry",
          value:  70,
          meta:   { errorClass: cls, autoApply: s.autoApply },
          discoveredAt: _ts(),
        });
      });
    }
  } catch {}
  return items;
}

function _discoverResearchSignals() {
  const items = [];
  try {
    const s = _rke()?.getStats?.() || {};
    if ((s.findingsIndexed || 0) >= DISCOVERY_THRESHOLDS.research_signal.minFindings) {
      const radar = _rke()?.getRadar?.() || { entries: [] };
      (radar.entries || []).slice(0, 5).forEach(entry => {
        items.push({
          id: _id(), category: "research_signal",
          title:  `Research radar: ${entry.name || entry.id}`,
          source: "research_knowledge",
          value:  Math.min(100, 60 + (entry.confidence || 0) * 40),
          meta:   { ring: entry.ring, quadrant: entry.quadrant },
          discoveredAt: _ts(),
        });
      });
    }
  } catch {}
  return items;
}

function _discoverBibleWorkflows() {
  const items = [];
  try {
    const bible = _pb()?.getBible?.() || {};
    const wfs = bible.workflows || [];
    const unautomated = wfs.filter(w => !w.automated);
    if (unautomated.length >= DISCOVERY_THRESHOLDS.bible_workflow.minWorkflows) {
      unautomated.slice(0, 5).forEach(wf => {
        items.push({
          id: _id(), category: "bible_workflow",
          title:  `Automatable workflow: ${wf.id || wf.name}`,
          source: "production_bible",
          value:  Math.min(100, 50 + (wf.minutesSaved || 0) / 10),
          meta:   { workflowId: wf.id, minutesSaved: wf.minutesSaved, category: wf.category },
          discoveredAt: _ts(),
        });
      });
    }
  } catch {}
  return items;
}

function _discoverImprovementPatterns() {
  const items = [];
  try {
    const s = _sie()?.getStatistics?.() || {};
    const pending = s.pendingPatterns || 0;
    if (pending >= DISCOVERY_THRESHOLDS.improvement_pattern.minPatterns) {
      items.push({
        id: _id(), category: "improvement_pattern",
        title:  `${pending} self-improvement patterns pending promotion`,
        source: "self_improvement",
        value:  Math.min(100, 60 + pending * 5),
        meta:   { pendingPatterns: pending, cycles: s.evolutionCycles },
        discoveredAt: _ts(),
      });
    }
    const repairRaw = s.improvementScores?.repairSuccess || 0;
    const repair    = typeof repairRaw === "number" && repairRaw > 1 ? repairRaw : repairRaw * 100;
    if (repair > 0) {
      items.push({
        id: _id(), category: "improvement_pattern",
        title:  `Repair success rate: ${Math.round(repair)}%`,
        source: "self_improvement",
        value:  Math.min(100, Math.round(repair)),
        meta:   { repairSuccess: Math.round(repair) },
        discoveredAt: _ts(),
      });
    }
  } catch {}
  return items;
}

function _discoverMarketplaceAssets() {
  const items = [];
  try {
    const s = _mce()?.getStats?.() || {};
    if ((s.total || 0) >= DISCOVERY_THRESHOLDS.marketplace_asset.minAssets) {
      const topTypes = Object.entries(s.byType || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
      topTypes.forEach(([type, count]) => {
        if (count > 0) {
          items.push({
            id: _id(), category: "marketplace_asset",
            title:  `High-availability asset type: ${type} (${count} assets)`,
            source: "marketplace_catalog",
            value:  Math.min(100, 50 + count),
            meta:   { assetType: type, count },
            discoveredAt: _ts(),
          });
        }
      });
    }
  } catch {}
  return items;
}

function _discoverKnowledgeGaps(federationStats) {
  const items = [];
  try {
    const byDomain = federationStats?.byDomain || {};
    Object.entries(byDomain).forEach(([domain, info]) => {
      if ((info.items || 0) === 0) {
        items.push({
          id: _id(), category: "knowledge_gap",
          title:  `Knowledge gap in domain: ${domain}`,
          source: "knowledge_federation",
          value:  90, // high value = high opportunity
          meta:   { domain, sources: info.sources },
          discoveredAt: _ts(),
        });
      }
    });
  } catch {}
  return items;
}

function _discoverCrossDomainGems() {
  const items = [];
  try {
    const s = _kre()?.getStats?.() || {};
    const analyses = _kre()?.listAnalyses?.({ limit: 10 }) || { analyses: [] };
    (analyses.analyses || []).forEach(a => {
      if ((a.overallScore || 0) >= DISCOVERY_THRESHOLDS.cross_domain_gem.minScore) {
        items.push({
          id: _id(), category: "cross_domain_gem",
          title:  `High-value knowledge analysis: ${a.id}`,
          source: "knowledge_reasoning",
          value:  Math.min(100, a.overallScore || 0),
          meta:   { analysisId: a.id, score: a.overallScore },
          discoveredAt: _ts(),
        });
      }
    });
  } catch {}
  return items;
}

// ── Core: discover ────────────────────────────────────────────────────────────

function discover(federationStats) {
  const kfe      = require("./knowledgeFederationEngine.cjs");
  const fed      = kfe.getStats?.() || {};
  const allItems = [
    ..._discoverHighValueLessons(),
    ..._discoverReusableRules(),
    ..._discoverResearchSignals(),
    ..._discoverBibleWorkflows(),
    ..._discoverImprovementPatterns(),
    ..._discoverMarketplaceAssets(),
    ..._discoverKnowledgeGaps(federationStats || fed),
    ..._discoverCrossDomainGems(),
  ];

  const d = _load();
  const before = d.discoveries.length;
  // De-dup by category+title
  const existing = new Map(d.discoveries.map(it => [`${it.category}:${it.title}`, it]));
  allItems.forEach(it => existing.set(`${it.category}:${it.title}`, it));
  d.discoveries = [...existing.values()];

  const byCategory = {};
  DISCOVERY_CATEGORIES.forEach(c => { byCategory[c] = 0; });
  d.discoveries.forEach(it => { if (byCategory[it.category] !== undefined) byCategory[it.category]++; });
  const newSinceLastRun = d.discoveries.length - before;
  d.stats = { total: d.discoveries.length, byCategory, newSinceLastRun };
  d.lastRun = _ts();
  _save(d);

  return { ok: true, found: allItems.length, total: d.discoveries.length, newSinceLastRun, byCategory };
}

function getDiscovery(id) {
  return _load().discoveries.find(it => it.id === id) || null;
}

function listDiscoveries({ category, source, minValue, limit = 50 } = {}) {
  let items = _load().discoveries;
  if (category) items = items.filter(it => it.category === category);
  if (source)   items = items.filter(it => it.source === source);
  if (minValue) items = items.filter(it => it.value >= minValue);
  items = items.sort((a, b) => b.value - a.value);
  return { ok: true, discoveries: items.slice(0, limit), total: items.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, DISCOVERY_CATEGORIES, DISCOVERY_THRESHOLDS, lastRun: d.lastRun, updatedAt: d.updatedAt };
}

module.exports = {
  DISCOVERY_CATEGORIES,
  DISCOVERY_THRESHOLDS,
  discover,
  getDiscovery,
  listDiscoveries,
  getStats,
};
