"use strict";
/**
 * Brand Studio — brand kit management and identity generation.
 *
 * A BrandKit: { id, name, colors, fonts, logos[], brandVoice, templates[], assets[] }
 *
 * Storage: data/brand-kits.json
 */

const fs   = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "../../data/brand-kits.json");

const DEFAULT_VOICE = {
  tone:        "professional",
  personality: ["trustworthy", "innovative"],
  avoid:       ["jargon", "superlatives"],
  examples:    [],
};

function _load() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return { kits: {} }; }
}

function _save(d) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}

function _id() { return `bk-${Date.now()}-${Math.random().toString(36).slice(2,5)}`; }

// ── CRUD ───────────────────────────────────────────────────────────

function createKit(opts = {}) {
  const store = _load();
  const id    = _id();
  const kit   = {
    id,
    name:       opts.name       || "My Brand",
    accountId:  opts.accountId  || null,
    colors: {
      primary:    opts.colors?.primary   || "#7c6af7",
      secondary:  opts.colors?.secondary || "#a78bfa",
      accent:     opts.colors?.accent    || "#22c55e",
      background: opts.colors?.background|| "#0d0d0d",
      surface:    opts.colors?.surface   || "#1a1a2e",
      text:       opts.colors?.text      || "#e8e8e8",
    },
    fonts: {
      heading: opts.fonts?.heading || "Inter",
      body:    opts.fonts?.body    || "Inter",
      mono:    opts.fonts?.mono    || "JetBrains Mono",
    },
    logos:      opts.logos     || [],
    brandVoice: opts.brandVoice || { ...DEFAULT_VOICE },
    templates:  opts.templates || [],
    assetIds:   opts.assetIds  || [],
    description: opts.description || "",
    industry:    opts.industry    || "",
    website:     opts.website     || "",
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };
  store.kits[id] = kit;
  _save(store);
  return kit;
}

function getKit(id)      { return _load().kits[id] || null; }
function listKits(accountId) {
  const store = _load();
  let   list  = Object.values(store.kits);
  if (accountId) list = list.filter(k => k.accountId === accountId);
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function updateKit(id, patch) {
  const store = _load();
  if (!store.kits[id]) return null;
  Object.assign(store.kits[id], patch, { updatedAt: new Date().toISOString() });
  _save(store);
  return store.kits[id];
}

function deleteKit(id) {
  const store = _load();
  if (!store.kits[id]) return false;
  delete store.kits[id];
  _save(store);
  return true;
}

// ── Brand Voice ────────────────────────────────────────────────────

function updateBrandVoice(kitId, voice) {
  return updateKit(kitId, { brandVoice: voice });
}

// ── Logo / Asset attachment ────────────────────────────────────────

function attachLogo(kitId, assetId, variant = "primary") {
  const store = _load();
  if (!store.kits[kitId]) return null;
  const kit = store.kits[kitId];
  kit.logos = kit.logos || [];
  // Replace existing variant
  kit.logos  = kit.logos.filter(l => l.variant !== variant);
  kit.logos.push({ assetId, variant, attachedAt: new Date().toISOString() });
  kit.assetIds = [...new Set([...(kit.assetIds || []), assetId])];
  kit.updatedAt = new Date().toISOString();
  _save(store);
  return kit;
}

function addTemplate(kitId, template) {
  const store = _load();
  if (!store.kits[kitId]) return null;
  const kit = store.kits[kitId];
  kit.templates = kit.templates || [];
  kit.templates.push({ ...template, addedAt: new Date().toISOString() });
  kit.updatedAt  = new Date().toISOString();
  _save(store);
  return kit;
}

// ── Identity generation brief ──────────────────────────────────────

/**
 * Build a structured brand generation prompt for the Creative Router.
 * Caller passes this to creativeRouter.route() with capability = "logo_generate" etc.
 */
function buildIdentityBrief(kitId) {
  const kit = getKit(kitId);
  if (!kit) return null;
  return {
    name:    kit.name,
    colors:  kit.colors,
    fonts:   kit.fonts,
    voice:   kit.brandVoice,
    prompts: {
      logo:    `Professional logo for ${kit.name}. Primary color: ${kit.colors.primary}. Style: ${kit.brandVoice.tone}. Industry: ${kit.industry || "technology"}.`,
      banner:  `Brand banner for ${kit.name}. Colors: ${kit.colors.primary}, ${kit.colors.secondary}. Clean, modern, ${kit.brandVoice.tone}.`,
      adCopy:  `Write an ad for ${kit.name}. Tone: ${kit.brandVoice.tone}. Personality: ${(kit.brandVoice.personality || []).join(", ")}. Avoid: ${(kit.brandVoice.avoid || []).join(", ")}.`,
    },
  };
}

function getStats() {
  const store = _load();
  const kits  = Object.values(store.kits);
  return {
    total:       kits.length,
    withLogos:   kits.filter(k => k.logos?.length > 0).length,
    withVoice:   kits.filter(k => k.brandVoice?.tone).length,
    withTemplates: kits.filter(k => k.templates?.length > 0).length,
  };
}

module.exports = {
  createKit, getKit, listKits, updateKit, deleteKit,
  updateBrandVoice, attachLogo, addTemplate,
  buildIdentityBrief, getStats,
  DEFAULT_VOICE,
};
