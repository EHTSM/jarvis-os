"use strict";
/**
 * marketplaceCertificationEngine.cjs — POST-Ω P13 Autonomous Marketplace
 *
 * Scores every marketplace asset for quality, security,
 * and production readiness before it becomes publicly available.
 *
 * Reuses: selfReviewEngine, selfImprovementEngine, benchmarkEngine,
 *         productionBibleEngine, deploymentValidator,
 *         marketplaceCatalogEngine, continuousLearningEngine,
 *         evolutionReasoningEngine (OSE X).
 *
 * Certification levels: bronze (≥50), silver (≥70), gold (≥85), platinum (≥95)
 *
 * Storage: data/marketplace-certifications.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "marketplace-certifications.json");

const _try  = fn => { try { return fn(); } catch { return null; } };
const _srev = () => _try(() => require("./selfReviewEngine.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _ben  = () => _try(() => require("./benchmarkEngine.cjs"));
const _pb   = () => _try(() => require("./productionBibleEngine.cjs"));
const _dv   = () => _try(() => require("./deploymentValidator.cjs"));
const _mce  = () => _try(() => require("./marketplaceCatalogEngine.cjs"));
const _cle  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _ose  = () => _try(() => require("./evolutionReasoningEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `cert_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ── Certification config ──────────────────────────────────────────────────────

const CERT_LEVELS  = ["none", "bronze", "silver", "gold", "platinum"];
const CERT_WEIGHTS = { quality: 0.35, security: 0.30, production_readiness: 0.25, adoption: 0.10 };

function _certLevel(score) {
  if (score >= 95) return "platinum";
  if (score >= 85) return "gold";
  if (score >= 70) return "silver";
  if (score >= 50) return "bronze";
  return "none";
}

// ── Dimension scorers ─────────────────────────────────────────────────────────

function _scoreQuality(asset) {
  const review = _srev()?.getLatestReview?.() || null;
  let base = 70;
  if (review?.overall) {
    // Weight by asset type — code assets use arch+debt, workflow assets use reliability
    if (["plugin","sdk_package","agent"].includes(asset.type)) {
      base = Math.round((review.scores?.architecture || 70) * 0.5 +
                        (review.scores?.reliability   || 70) * 0.5);
    } else if (["workflow","automation_pack","deployment_recipe"].includes(asset.type)) {
      base = Math.round((review.scores?.reliability || 70) * 0.6 +
                        (review.overall              || 70) * 0.4);
    } else {
      base = review.overall || 70;
    }
  }
  // Boost for high download count
  const downloadBoost = Math.min(10, Math.floor((asset.downloads || 0) / 5));
  return Math.min(100, base + downloadBoost);
}

function _scoreSecurity(asset) {
  const review = _srev()?.getLatestReview?.() || null;
  const base   = review?.scores?.security ?? 60;
  // Penalise unknown-source assets
  const sourcePenalty = asset.source === "manual" ? -10 : 0;
  return Math.min(100, Math.max(0, base + sourcePenalty));
}

function _scoreProductionReadiness(asset) {
  // Use bible compliance + deploy validator for all asset types
  let score = 75;
  try {
    const bible = _pb()?.getBible?.();
    if (bible?.workflows?.length) {
      const pct  = Math.round((bible.workflows.filter(w => w.automated !== false).length
        / bible.workflows.length) * 100);
      score = Math.round(pct * 0.6 + 75 * 0.4);
    }
  } catch {}
  try {
    const dvReport = _dv()?.getLastReport?.();
    if (dvReport?.score !== undefined) {
      score = Math.round(score * 0.5 + Math.min(100, dvReport.score) * 0.5);
    }
  } catch {}
  // Asset-specific adjustments
  if (asset.automated === true)                         score = Math.min(100, score + 5);
  if (["blueprint","company_template"].includes(asset.type)) score = Math.min(100, score + 5);
  return Math.max(0, score);
}

function _scoreAdoption(asset) {
  const downloads = asset.downloads || 0;
  const rating    = asset.rating    || 0;
  return Math.min(100, downloads * 3 + rating * 10);
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      certifications: [],
      stats: { total: 0, byLevel: { platinum: 0, gold: 0, silver: 0, bronze: 0, none: 0 }, avgScore: 0 },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.certifications.length > 1000) d.certifications = d.certifications.slice(-1000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Core: certify ─────────────────────────────────────────────────────────────

function certify(assetId) {
  const asset = _mce()?.getAsset?.(assetId) || null;
  if (!asset) return { ok: false, error: `asset not found: ${assetId}` };

  const quality             = _scoreQuality(asset);
  const security            = _scoreSecurity(asset);
  const production_readiness= _scoreProductionReadiness(asset);
  const adoption            = _scoreAdoption(asset);

  const overallScore = Math.round(
    CERT_WEIGHTS.quality             * quality             +
    CERT_WEIGHTS.security            * security            +
    CERT_WEIGHTS.production_readiness* production_readiness+
    CERT_WEIGHTS.adoption            * adoption
  );
  const level = _certLevel(overallScore);

  // Record lesson in CLE
  try {
    _cle()?.createLesson?.({
      context: `marketplace_cert_${assetId}`,
      outcome: level !== "none" ? "success" : "failure",
      lesson:  `Asset ${asset.name} certified at ${level} (${overallScore}/100)`,
      source:  "marketplaceCertificationEngine",
    });
  } catch {}

  const id   = _id();
  const cert = {
    id, assetId,
    assetName:  asset.name,
    assetType:  asset.type,
    level,
    overallScore,
    dimensions: { quality, security, production_readiness, adoption },
    passed:     level !== "none",
    expiresAt:  new Date(Date.now() + 90 * 86400000).toISOString(), // 90 days
    certifiedAt: _ts(),
    updatedAt:   _ts(),
  };

  const d = _load();
  d.certifications.push(cert);
  const all = d.certifications;
  const byLevel = { platinum: 0, gold: 0, silver: 0, bronze: 0, none: 0 };
  all.forEach(c => { byLevel[c.level] = (byLevel[c.level] || 0) + 1; });
  d.stats = {
    total:    all.length,
    byLevel,
    avgScore: Math.round(all.reduce((s, c) => s + c.overallScore, 0) / all.length),
  };
  _save(d);

  return { ok: true, certification: cert };
}

function certifyBatch(assetIds) {
  const results = assetIds.map(id => certify(id));
  const passed  = results.filter(r => r.ok && r.certification?.passed).length;
  return { ok: true, total: results.length, passed, results };
}

function getCertification(id) {
  return _load().certifications.find(c => c.id === id) || null;
}

function getCertificationForAsset(assetId) {
  const certs = _load().certifications.filter(c => c.assetId === assetId);
  return certs.pop() || null;
}

function listCertifications({ level, assetType, limit = 50 } = {}) {
  let list = _load().certifications;
  if (level)     list = list.filter(c => c.level     === level);
  if (assetType) list = list.filter(c => c.assetType === assetType);
  return { ok: true, certifications: list.slice(-limit).reverse(), total: list.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, CERT_LEVELS, CERT_WEIGHTS, updatedAt: d.updatedAt };
}

module.exports = {
  CERT_LEVELS, CERT_WEIGHTS, certify, certifyBatch,
  getCertification, getCertificationForAsset, listCertifications, getStats,
};
