"use strict";
/**
 * Asset Library — unified store for all creative outputs.
 *
 * Stores: images, videos, voices, music, templates, brand kits.
 * Each asset carries metadata: type, prompt, provider, capability,
 * tags, folders, favorites, version history, reuse links.
 *
 * Storage: data/creative-assets.ndjson (append-only log)
 *          data/creative-asset-index.json (fast lookup index)
 *
 * Reusable in: Browser Automation (via assetId), Engineering Workspace.
 */

const fs   = require("fs");
const path = require("path");

const LOG_FILE   = path.join(__dirname, "../../data/creative-assets.ndjson");
const INDEX_FILE = path.join(__dirname, "../../data/creative-asset-index.json");

// ── Types ──────────────────────────────────────────────────────────
const ASSET_TYPES = ["image","video","voice","music","template","brand_kit","animation","document","audio","other"];

// ── Helpers ────────────────────────────────────────────────────────

function _genId() { return `ast-${Date.now()}-${Math.random().toString(36).slice(2,6)}`; }

function _loadIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")); }
  catch { return { assets: {}, folders: {}, tags: {}, favorites: [] }; }
}

function _saveIndex(idx) {
  try {
    fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
    fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2));
  } catch { /* non-fatal */ }
}

function _appendLog(record) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + "\n");
  } catch { /* non-fatal */ }
}

// ── Create / Store ─────────────────────────────────────────────────

/**
 * Store a new asset.
 * opts: { type, prompt, provider, capability, model, url, dataUrl, mimeType,
 *         tags, folder, accountId, metadata, jobId, brandKitId }
 */
function storeAsset(opts = {}) {
  const id = _genId();
  const asset = {
    id,
    type:        opts.type        || "image",
    prompt:      opts.prompt      || "",
    provider:    opts.provider    || "unknown",
    capability:  opts.capability  || "image_generate",
    model:       opts.model       || "",
    url:         opts.url         || null,
    dataUrl:     opts.dataUrl     || null,
    mimeType:    opts.mimeType    || "image/png",
    tags:        opts.tags        || [],
    folder:      opts.folder      || "uncategorized",
    accountId:   opts.accountId   || null,
    jobId:       opts.jobId       || null,
    brandKitId:  opts.brandKitId  || null,
    metadata:    opts.metadata    || {},
    favorite:    false,
    versions:    [],
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };

  // Update index
  const idx = _loadIndex();
  idx.assets[id] = {
    id, type: asset.type, prompt: asset.prompt, provider: asset.provider,
    capability: asset.capability, tags: asset.tags, folder: asset.folder,
    accountId: asset.accountId, createdAt: asset.createdAt, favorite: false,
    jobId: asset.jobId,
  };

  // Update folder index
  if (!idx.folders[asset.folder]) idx.folders[asset.folder] = [];
  idx.folders[asset.folder].push(id);

  // Update tag index
  for (const tag of asset.tags) {
    if (!idx.tags[tag]) idx.tags[tag] = [];
    idx.tags[tag].push(id);
  }

  _saveIndex(idx);
  _appendLog({ event: "asset_created", ...asset });
  return asset;
}

function getAsset(id) {
  const idx = _loadIndex();
  return idx.assets[id] || null;
}

/**
 * Search / list assets.
 * opts: { type, folder, tag, accountId, favorite, search, limit, capability }
 */
function listAssets(opts = {}) {
  const idx   = _loadIndex();
  let   list  = Object.values(idx.assets);

  if (opts.type)       list = list.filter(a => a.type === opts.type);
  if (opts.folder)     list = list.filter(a => a.folder === opts.folder);
  if (opts.accountId)  list = list.filter(a => a.accountId === opts.accountId);
  if (opts.favorite)   list = list.filter(a => a.favorite);
  if (opts.capability) list = list.filter(a => a.capability === opts.capability);
  if (opts.tag)        list = list.filter(a => (a.tags || []).includes(opts.tag));
  if (opts.search) {
    const q = opts.search.toLowerCase();
    list = list.filter(a =>
      (a.prompt || "").toLowerCase().includes(q) ||
      (a.tags   || []).some(t => t.toLowerCase().includes(q)) ||
      (a.folder || "").toLowerCase().includes(q)
    );
  }

  list = list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return list.slice(0, opts.limit || 100);
}

function toggleFavorite(id) {
  const idx   = _loadIndex();
  const asset = idx.assets[id];
  if (!asset) return null;
  asset.favorite = !asset.favorite;
  if (asset.favorite) {
    if (!idx.favorites.includes(id)) idx.favorites.push(id);
  } else {
    idx.favorites = idx.favorites.filter(i => i !== id);
  }
  _saveIndex(idx);
  return asset;
}

function addTag(id, tag) {
  const idx   = _loadIndex();
  const asset = idx.assets[id];
  if (!asset) return null;
  if (!(asset.tags || []).includes(tag)) {
    asset.tags = [...(asset.tags || []), tag];
    if (!idx.tags[tag]) idx.tags[tag] = [];
    idx.tags[tag].push(id);
    _saveIndex(idx);
  }
  return asset;
}

function moveToFolder(id, folder) {
  const idx   = _loadIndex();
  const asset = idx.assets[id];
  if (!asset) return null;
  const old = asset.folder;
  if (old && idx.folders[old]) idx.folders[old] = idx.folders[old].filter(i => i !== id);
  asset.folder = folder;
  if (!idx.folders[folder]) idx.folders[folder] = [];
  idx.folders[folder].push(id);
  _saveIndex(idx);
  _appendLog({ event: "asset_moved", id, from: old, to: folder, ts: new Date().toISOString() });
  return asset;
}

function deleteAsset(id) {
  const idx = _loadIndex();
  if (!idx.assets[id]) return false;
  const asset = idx.assets[id];
  delete idx.assets[id];
  if (asset.folder && idx.folders[asset.folder])
    idx.folders[asset.folder] = idx.folders[asset.folder].filter(i => i !== id);
  for (const tag of (asset.tags || []))
    if (idx.tags[tag]) idx.tags[tag] = idx.tags[tag].filter(i => i !== id);
  idx.favorites = idx.favorites.filter(i => i !== id);
  _saveIndex(idx);
  _appendLog({ event: "asset_deleted", id, ts: new Date().toISOString() });
  return true;
}

function getFolders() {
  const idx = _loadIndex();
  return Object.entries(idx.folders).map(([name, ids]) => ({ name, count: ids.length }));
}

function getTags() {
  const idx = _loadIndex();
  return Object.entries(idx.tags).map(([tag, ids]) => ({ tag, count: ids.length }))
    .sort((a, b) => b.count - a.count);
}

function getStats() {
  const idx  = _loadIndex();
  const list = Object.values(idx.assets);
  const byType = {};
  for (const a of list) {
    byType[a.type] = (byType[a.type] || 0) + 1;
  }
  return {
    total:     list.length,
    favorites: idx.favorites.length,
    folders:   Object.keys(idx.folders).length,
    tags:      Object.keys(idx.tags).length,
    byType,
  };
}

/**
 * Get asset URL for reuse in Browser Automation or Engineering Workspace.
 */
function getReuseRef(id) {
  const asset = getAsset(id);
  if (!asset) return null;
  return { assetId: id, url: asset.url, type: asset.type, mimeType: asset.mimeType };
}

module.exports = {
  storeAsset, getAsset, listAssets,
  toggleFavorite, addTag, moveToFolder, deleteAsset,
  getFolders, getTags, getStats, getReuseRef,
  ASSET_TYPES,
};
