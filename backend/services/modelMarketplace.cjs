"use strict";
/**
 * Model Marketplace — catalogue of every model across all providers.
 *
 * Fields: price, latency, quality, availability, context window, health, version.
 * Auto-updates via health checks against live provider state.
 *
 * Storage: data/model-marketplace.json (version overrides + user favourites)
 */

const fs   = require("fs");
const path = require("path");
const aiRegistry    = require("./aiRegistry.cjs");
const providerMgr   = require("./providerManager.cjs");

const STORE_FILE = path.join(__dirname, "../../data/model-marketplace.json");

function _load() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return { overrides: {}, favourites: {}, versions: {} }; }
}

function _save(d) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}

// ── Build model catalogue from registry ──────────────────────────
function buildCatalogue(opts = {}) {
  const providers  = aiRegistry.getAll();
  const healthMap  = {};
  providerMgr.getAll().forEach(p => { healthMap[p.id] = p; });
  const store      = _load();
  const capFilter  = opts.capability;
  const search     = opts.search?.toLowerCase();

  const models = [];

  for (const provider of providers) {
    const health = healthMap[provider.id];
    const available = health?.available ?? (provider.type === "local");

    for (const [capability, capDef] of Object.entries(provider.capabilities || {})) {
      if (capFilter && capability !== capFilter) continue;

      for (const modelId of (capDef.models || [])) {
        const overrideKey = `${provider.id}:${modelId}`;
        const override    = store.overrides?.[overrideKey] || {};

        const entry = {
          id:            `${provider.id}/${modelId}`,
          modelId,
          providerId:    provider.id,
          providerName:  provider.name,
          providerType:  provider.type,
          capability,
          // Commercial
          costPer1kInput:  override.costPer1kInput  ?? capDef.costPer1k,
          costPer1kOutput: override.costPer1kOutput ?? capDef.costPer1k,
          // Quality
          quality:       override.quality  ?? capDef.quality,
          latencyClass:  override.latency  ?? capDef.latencyClass,
          // Context
          contextWindow: capDef.contextWindow,
          maxOutput:     capDef.maxOutput,
          streamable:    capDef.streamable,
          // Health
          available,
          healthy:       health?.healthy ?? true,
          rateLimited:   health?.rateLimited ?? false,
          usageToday:    health?.usageToday ?? 0,
          quotaUsePct:   health?.quotaUsePct ?? null,
          // Version
          version:       store.versions?.[overrideKey] || "latest",
          favourite:     !!(store.favourites?.[overrideKey]),
        };

        if (search && !entry.modelId.toLowerCase().includes(search) &&
            !entry.providerName.toLowerCase().includes(search) &&
            !entry.capability.toLowerCase().includes(search)) continue;

        models.push(entry);
      }
    }
  }

  // Sort: available first, then quality desc
  models.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    return (b.quality || 0) - (a.quality || 0);
  });

  return models;
}

/**
 * Get the full model catalogue.
 */
function getCatalogue(opts = {}) { return buildCatalogue(opts); }

/**
 * Get top model per capability (the "featured" selection).
 */
function getFeatured() {
  const caps = aiRegistry.getAllCapabilities();
  const out  = {};
  for (const cap of caps) {
    const models = buildCatalogue({ capability: cap }).filter(m => m.available);
    if (models.length) out[cap] = models[0];
  }
  return out;
}

/**
 * Mark/unmark a model as favourite.
 */
function setFavourite(providerId, modelId, value) {
  const store = _load();
  store.favourites = store.favourites || {};
  const key = `${providerId}:${modelId}`;
  if (value) store.favourites[key] = true;
  else delete store.favourites[key];
  _save(store);
}

/**
 * Override pricing/quality for a model (admin / BYOK adjustment).
 */
function setOverride(providerId, modelId, patch) {
  const store = _load();
  store.overrides = store.overrides || {};
  const key = `${providerId}:${modelId}`;
  store.overrides[key] = { ...(store.overrides[key] || {}), ...patch };
  _save(store);
}

/**
 * Record a version string for a model.
 */
function setVersion(providerId, modelId, version) {
  const store = _load();
  store.versions = store.versions || {};
  store.versions[`${providerId}:${modelId}`] = version;
  _save(store);
}

/**
 * Stats summary for admin.
 */
function getStats() {
  const cat = buildCatalogue();
  return {
    totalModels:     cat.length,
    availableModels: cat.filter(m => m.available).length,
    providers:       [...new Set(cat.map(m => m.providerId))].length,
    capabilities:    [...new Set(cat.map(m => m.capability))].length,
    cheapest:        cat.filter(m => m.available && m.costPer1kInput === 0).slice(0, 3),
    highest_quality: cat.filter(m => m.available).sort((a,b)=>b.quality-a.quality).slice(0,3),
    fastest:         cat.filter(m => m.available && m.latencyClass === "fast").slice(0,3),
  };
}

module.exports = { getCatalogue, getFeatured, setFavourite, setOverride, setVersion, getStats };
