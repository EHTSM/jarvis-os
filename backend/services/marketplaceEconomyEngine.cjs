"use strict";
/**
 * marketplaceEconomyEngine.cjs — POST-Ω P13 Autonomous Marketplace
 *
 * Tracks usage, adoption, ratings, success and ROI for every marketplace
 * asset. Surfaces economic health metrics for the marketplace.
 *
 * Reuses: marketplaceCatalogEngine, marketplaceCertificationEngine,
 *         continuousLearningEngine, businessReasoningEngine (OBI X),
 *         revenueOS, analyticsService, founderWorkRegistry.
 *
 * Storage: data/marketplace-economy.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "marketplace-economy.json");

const _try  = fn => { try { return fn(); } catch { return null; } };
const _mce  = () => _try(() => require("./marketplaceCatalogEngine.cjs"));
const _mce2 = () => _try(() => require("./marketplaceCertificationEngine.cjs"));
const _cle  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _obi  = () => _try(() => require("./businessReasoningEngine.cjs"));
const _rev  = () => _try(() => require("./revenueOS.cjs"));
const _fwr  = () => _try(() => require("./founderWorkRegistry.cjs"));
const _mre  = () => _try(() => require("./marketplaceRecommendationEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `eco_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      events:   [],
      ratings:  {},
      topAssets:[],
      summary:  {
        totalUsageEvents:  0,
        totalDownloads:    0,
        totalRatings:      0,
        avgRating:         0,
        totalROIMinutes:   0,
        adoptionRate:      0,
        successRate:       0,
      },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.events.length > 2000) d.events = d.events.slice(-2000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── ROI computation ───────────────────────────────────────────────────────────

function _computeROI(asset) {
  // Baseline: each download saves time proportional to asset type
  const minutesPerDownload = {
    workflow:          15,
    blueprint:         45,
    product_template:  120,
    company_template:  240,
    plugin:            30,
    sdk_package:       60,
    automation_pack:   90,
    deployment_recipe: 60,
    agent:             30,
    design_system:     120,
    ui_component:      20,
    knowledge_pack:    45,
    prompt_pack:       10,
  };
  const perDownload = minutesPerDownload[asset.type] || 15;
  return (asset.downloads || 0) * perDownload;
}

// ── Core: record events ───────────────────────────────────────────────────────

function recordUsage(assetId, { eventType = "download", userId, context = {} } = {}) {
  const asset = _mce()?.getAsset?.(assetId) || null;
  if (!asset) return { ok: false, error: `asset not found: ${assetId}` };

  const event = {
    id: _id(), assetId, assetName: asset.name, assetType: asset.type,
    eventType, userId, context,
    minutesSaved: eventType === "download" ? (_computeROI(asset) / Math.max(1, asset.downloads || 1)) : 0,
    recordedAt: _ts(),
  };

  if (eventType === "download") _mce()?.recordDownload?.(assetId);

  const d = _load();
  d.events.push(event);
  d.summary.totalUsageEvents = d.events.length;
  d.summary.totalDownloads   = d.events.filter(e => e.eventType === "download").length;
  _save(d);

  return { ok: true, event };
}

function rateAsset(assetId, { rating, comment, userId } = {}) {
  if (rating === undefined || rating < 1 || rating > 5) {
    return { ok: false, error: "rating must be 1–5" };
  }
  const asset = _mce()?.getAsset?.(assetId) || null;
  if (!asset) return { ok: false, error: `asset not found: ${assetId}` };

  const d = _load();
  if (!d.ratings[assetId]) d.ratings[assetId] = [];
  d.ratings[assetId].push({ rating, comment, userId, ratedAt: _ts() });

  const allRatings     = d.ratings[assetId];
  const avgRating      = allRatings.reduce((s, r) => s + r.rating, 0) / allRatings.length;
  d.summary.totalRatings = Object.values(d.ratings).reduce((s, r) => s + r.length, 0);
  const allAvgs        = Object.values(d.ratings).map(rs => rs.reduce((s,r)=>s+r.rating,0)/rs.length);
  d.summary.avgRating  = Math.round(allAvgs.reduce((s,a)=>s+a,0)/allAvgs.length * 10) / 10;
  _save(d);

  return { ok: true, assetId, avgRating: Math.round(avgRating * 10) / 10, totalRatings: allRatings.length };
}

// ── Economy snapshot ──────────────────────────────────────────────────────────

function getEconomySnapshot() {
  const d       = _load();
  const assets  = _mce()?.listAssets?.({ limit: 2000 })?.assets || [];

  // Compute ROI across all assets
  const totalROI = assets.reduce((s, a) => s + _computeROI(a), 0);

  // Top assets by downloads
  const topDownloads = [...assets]
    .sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
    .slice(0, 10)
    .map(a => ({ id: a.id, name: a.name, type: a.type, downloads: a.downloads || 0, rating: a.rating || 0 }));

  // Adoption rate = assets with >= 1 download / total published
  const published = assets.filter(a => a.status === "published").length;
  const adopted   = assets.filter(a => (a.downloads || 0) >= 1).length;
  const adoptionRate = published > 0 ? Math.round((adopted / published) * 100) : 0;

  // Success rate from CLE
  let successRate = 0;
  try {
    const cleStats = _cle()?.getStats?.() || {};
    const total    = (cleStats.totalLessons || 0);
    const success  = (cleStats.lessonsByType?.agent_success || 0) + (cleStats.lessonsByType?.founder_action || 0);
    successRate = total > 0 ? Math.round((success / total) * 100) : 0;
  } catch {}

  // Revenue intelligence from OBI X
  let revenueIntelligence = null;
  try {
    const obi = _obi()?.getStats?.() || {};
    if (obi.total > 0) revenueIntelligence = { source: "OBI X", analyses: obi.total };
  } catch {}

  const snapshot = {
    totalAssets:     assets.length,
    publishedAssets: published,
    adoptedAssets:   adopted,
    adoptionRate,
    totalDownloads:  assets.reduce((s, a) => s + (a.downloads || 0), 0),
    totalROIMinutes: totalROI,
    totalROIHours:   Math.round(totalROI / 60 * 10) / 10,
    avgRating:       d.summary.avgRating,
    totalRatings:    d.summary.totalRatings,
    successRate,
    topDownloads,
    revenueIntelligence,
    usageEvents:     d.summary.totalUsageEvents,
    snapshotAt:      _ts(),
  };

  // Update persistent summary
  d.summary = { ...d.summary, ...snapshot };
  d.topAssets = topDownloads;
  _save(d);

  return { ok: true, economy: snapshot };
}

function getAssetEconomy(assetId) {
  const asset   = _mce()?.getAsset?.(assetId) || null;
  if (!asset) return { ok: false, error: `asset not found: ${assetId}` };

  const d       = _load();
  const ratings = d.ratings[assetId] || [];
  const events  = d.events.filter(e => e.assetId === assetId);
  const avgRating = ratings.length
    ? Math.round(ratings.reduce((s,r)=>s+r.rating,0)/ratings.length * 10)/10 : 0;
  const roiMinutes = _computeROI(asset);

  return {
    ok: true, assetId,
    name:        asset.name,
    type:        asset.type,
    downloads:   asset.downloads || 0,
    ratings:     { count: ratings.length, avg: avgRating, history: ratings.slice(-5) },
    usageEvents: events.length,
    roiMinutes,
    roiHours:    Math.round(roiMinutes / 60 * 10) / 10,
    cert:        _mce2()?.getCertificationForAsset?.(assetId) || null,
  };
}

function getTopAssets({ by = "downloads", type, limit = 10 } = {}) {
  const assets = _mce()?.listAssets?.({ type, limit: 2000, status: "published" })?.assets || [];
  const sorted = [...assets].sort((a, b) => {
    if (by === "roi")     return _computeROI(b) - _computeROI(a);
    if (by === "rating")  return (b.rating || 0) - (a.rating || 0);
    return (b.downloads || 0) - (a.downloads || 0);
  });
  return {
    ok: true,
    assets: sorted.slice(0, limit).map(a => ({
      id: a.id, name: a.name, type: a.type,
      downloads: a.downloads || 0, rating: a.rating || 0,
      roiMinutes: _computeROI(a),
    })),
    total: sorted.length,
    by,
  };
}

function getStats() {
  const d = _load();
  return { ...d.summary, AUTOMATION_ACTIONS: Object.keys({}), updatedAt: d.updatedAt };
}

module.exports = {
  recordUsage, rateAsset, getEconomySnapshot, getAssetEconomy, getTopAssets, getStats,
};
