"use strict";
/**
 * marketplaceRecommendationEngine.cjs — POST-Ω P13 Autonomous Marketplace
 *
 * Recommends best marketplace assets based on: project context, company
 * profile, history, workforce capabilities, and asset success rates.
 *
 * Reuses: marketplaceCatalogEngine, engineeringReasoningEngine (OAI X),
 *         businessReasoningEngine (OBI X), knowledgeReasoningEngine (OKB X),
 *         productPlannerEngine, companyBlueprintEngine,
 *         workforceManager, continuousLearningEngine, marketplaceService.
 *
 * Storage: data/marketplace-recommendations.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "marketplace-recommendations.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _mce = () => _try(() => require("./marketplaceCatalogEngine.cjs"));
const _oai = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _obi = () => _try(() => require("./businessReasoningEngine.cjs"));
const _okb = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _ppe = () => _try(() => require("./productPlannerEngine.cjs"));
const _bp  = () => _try(() => require("./companyBlueprintEngine.cjs"));
const _wfm = () => _try(() => require("./workforceManager.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _ms  = () => _try(() => require("./marketplaceService.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `mre_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ── Scoring weights ───────────────────────────────────────────────────────────

const RECOMMENDATION_WEIGHTS = {
  relevance:    0.35,
  success_rate: 0.25,
  popularity:   0.15,
  recency:      0.10,
  workforce_fit:0.10,
  knowledge_fit:0.05,
};

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return { recommendations: [], stats: { total: 0, avgRelevance: 0 }, updatedAt: null };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.recommendations.length > 500) d.recommendations = d.recommendations.slice(-500);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function _scoreRelevance(asset, context) {
  const text  = `${context.objective || ""} ${(context.tags || []).join(" ")}`.toLowerCase();
  const tags  = (asset.tags || []).map(t => String(t).toLowerCase());
  const name  = (asset.name || "").toLowerCase();
  const desc  = (asset.desc || "").toLowerCase();
  let score   = 30;
  tags.forEach(t => { if (text.includes(t)) score += 15; });
  if (name.split(" ").some(w => w.length > 3 && text.includes(w))) score += 10;
  if (desc.split(" ").filter(w=>w.length>4).some(w => text.includes(w))) score += 5;
  return Math.min(100, score);
}

function _scorePopularity(asset) {
  const downloads = asset.downloads || 0;
  const rating    = asset.rating    || 0;
  return Math.min(100, downloads * 2 + rating * 10);
}

function _scoreRecency(asset) {
  const created = new Date(asset.discoveredAt || asset.createdAt || 0).getTime();
  const ageMs   = Date.now() - created;
  const ageDays = ageMs / 86400000;
  if (ageDays <  7) return 100;
  if (ageDays < 30) return 80;
  if (ageDays < 90) return 60;
  return 40;
}

function _scoreWorkforceFit(asset, workforceDomains) {
  if (!workforceDomains?.length) return 50;
  const tags = (asset.tags || []).map(t => String(t).toLowerCase());
  const hit  = workforceDomains.some(d => tags.includes(d.toLowerCase()));
  return hit ? 90 : 40;
}

function _scoreKnowledgeFit(asset, knowledgeTags) {
  if (!knowledgeTags?.length) return 50;
  const tags = (asset.tags || []).map(t => String(t).toLowerCase());
  const hits = knowledgeTags.filter(k => tags.some(t => t.includes(k.toLowerCase())));
  return Math.min(100, 40 + hits.length * 20);
}

// ── Context builder ───────────────────────────────────────────────────────────

function _buildContext(opts) {
  const context = {
    objective:        opts.objective || "",
    tags:             opts.tags      || [],
    projectType:      opts.projectType,
    workforceDomains: [],
    knowledgeTags:    [],
  };

  // Pull workforce active domains
  try {
    const missions = _wfm()?.listMissions?.({ limit: 20 });
    context.workforceDomains = [...new Set(
      (missions?.missions || []).map(m => m.domain).filter(Boolean)
    )];
  } catch {}

  // Pull knowledge tags from OKB X
  try {
    const okbStats = _okb()?.getStats?.() || {};
    if (okbStats.recentAnalyses?.length) {
      context.knowledgeTags = okbStats.recentAnalyses
        .slice(0, 5).map(a => a.context || "").filter(Boolean);
    }
  } catch {}

  // Pull CLE lesson categories
  try {
    const raw  = _cle()?.getRecommendations?.() || {};
    const recs = Array.isArray(raw) ? raw : (raw.recommendations || []);
    const cats = [...new Set(recs.filter(r=>r.status==="open").map(r=>r.type).filter(Boolean))];
    context.tags = [...new Set([...context.tags, ...cats])];
  } catch {}

  return context;
}

// ── Core: recommend ───────────────────────────────────────────────────────────

function recommend({ objective, tags = [], projectType, typeFilter, limit = 10 } = {}) {
  const context = _buildContext({ objective, tags, projectType });

  const allAssets = _mce()?.listAssets?.({ status: "published", limit: 2000 })?.assets || [];
  const candidates = typeFilter ? allAssets.filter(a => a.type === typeFilter) : allAssets;

  const scored = candidates.map(asset => {
    const relevance     = _scoreRelevance(asset, context);
    const popularity    = _scorePopularity(asset);
    const recency       = _scoreRecency(asset);
    const workforce_fit = _scoreWorkforceFit(asset, context.workforceDomains);
    const knowledge_fit = _scoreKnowledgeFit(asset, context.knowledgeTags);
    const success_rate  = Math.min(100, (asset.successRate || 70));

    const overall = Math.round(
      RECOMMENDATION_WEIGHTS.relevance     * relevance     +
      RECOMMENDATION_WEIGHTS.success_rate  * success_rate  +
      RECOMMENDATION_WEIGHTS.popularity    * popularity    +
      RECOMMENDATION_WEIGHTS.recency       * recency       +
      RECOMMENDATION_WEIGHTS.workforce_fit * workforce_fit +
      RECOMMENDATION_WEIGHTS.knowledge_fit * knowledge_fit
    );

    return {
      ...asset,
      scores: { relevance, success_rate, popularity, recency, workforce_fit, knowledge_fit },
      recommendationScore: overall,
    };
  });

  scored.sort((a, b) => b.recommendationScore - a.recommendationScore);
  const top = scored.slice(0, limit);

  // Persist recommendation session
  const id  = _id();
  const rec = {
    id, objective, tags, projectType, typeFilter,
    context:  { workforceDomains: context.workforceDomains, knowledgeTags: context.knowledgeTags },
    results:  top.map(a => ({ id: a.id, type: a.type, name: a.name, score: a.recommendationScore })),
    total:    scored.length,
    createdAt:_ts(),
  };

  const d = _load();
  d.recommendations.push(rec);
  const all = d.recommendations;
  d.stats = {
    total:        all.length,
    avgRelevance: Math.round(all.reduce((s, r) => s + (r.results[0]?.score || 0), 0) / Math.max(1, all.length)),
  };
  _save(d);

  return { ok: true, recommendations: top, total: scored.length, sessionId: id, context };
}

function getRecommendation(id) { return _load().recommendations.find(r => r.id === id) || null; }

function listRecommendations({ limit = 50 } = {}) {
  const list = _load().recommendations;
  return { ok: true, recommendations: list.slice(-limit).reverse(), total: list.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, RECOMMENDATION_WEIGHTS, updatedAt: d.updatedAt };
}

module.exports = {
  RECOMMENDATION_WEIGHTS, recommend, getRecommendation, listRecommendations, getStats,
};
