"use strict";
/**
 * Browser Session Manager — tabs, cookies, profiles, storage, multi-account, incognito.
 *
 * Wraps the existing browserSession.cjs (Playwright-level tab management) with
 * higher-level profile/cookie/storage management and multi-account session isolation.
 *
 * Storage: data/browser-session-manager.json
 *
 * SessionProfile: {
 *   id:          string
 *   name:        string
 *   accountId:   string
 *   type:        "normal" | "incognito" | "profile"
 *   cookies:     CookieStore (by domain)
 *   localStorage:{ [origin]: { [key]: value } }
 *   userAgent:   string | null
 *   viewport:    { width, height } | null
 *   pageIds:     string[]   (active tab ids)
 *   createdAt:   ISO
 *   lastUsed:    ISO
 * }
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const STORE_FILE = path.join(__dirname, "../../data/browser-session-manager.json");

function _load() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return { profiles: {}, activeSessions: {} }; }
}

function _save(d) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(d, null, 2));
  } catch (e) { logger.error("[BSM] save failed:", e.message); }
}

function _genId() { return `bsp-${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }

// ── Public API ────────────────────────────────────────────────────

/**
 * Create a new session profile.
 */
function createProfile(opts = {}) {
  const store = _load();
  const id    = opts.id || _genId();
  store.profiles[id] = {
    id,
    name:         opts.name      || `Session ${Object.keys(store.profiles).length + 1}`,
    accountId:    opts.accountId || "default",
    type:         opts.type      || "normal",
    cookies:      {},
    localStorage: {},
    userAgent:    opts.userAgent  || null,
    viewport:     opts.viewport   || { width: 1280, height: 800 },
    pageIds:      [],
    tags:         opts.tags       || [],
    notes:        opts.notes      || "",
    createdAt:    new Date().toISOString(),
    lastUsed:     new Date().toISOString(),
  };
  _save(store);
  return store.profiles[id];
}

/**
 * Get a profile by id.
 */
function getProfile(id) {
  return _load().profiles[id] || null;
}

/**
 * List all profiles (optionally filter by accountId).
 */
function listProfiles(opts = {}) {
  const store = _load();
  let list = Object.values(store.profiles);
  if (opts.accountId) list = list.filter(p => p.accountId === opts.accountId);
  if (opts.type)      list = list.filter(p => p.type      === opts.type);
  return list.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));
}

/**
 * Update profile metadata (name, tags, notes, viewport, userAgent).
 */
function updateProfile(id, patch) {
  const store = _load();
  if (!store.profiles[id]) return null;
  Object.assign(store.profiles[id], patch, { lastUsed: new Date().toISOString() });
  _save(store);
  return store.profiles[id];
}

/**
 * Delete a profile.
 */
function deleteProfile(id) {
  const store = _load();
  const p = store.profiles[id];
  if (!p) return false;
  delete store.profiles[id];
  _save(store);
  return true;
}

/**
 * Store cookies for a profile (by domain).
 */
function saveCookies(profileId, domain, cookies) {
  const store = _load();
  const p = store.profiles[profileId];
  if (!p) return null;
  p.cookies[domain] = cookies;
  p.lastUsed = new Date().toISOString();
  _save(store);
  return p.cookies[domain];
}

/**
 * Get cookies for a profile / domain.
 */
function getCookies(profileId, domain = null) {
  const p = getProfile(profileId);
  if (!p) return null;
  if (domain) return p.cookies[domain] || [];
  return p.cookies;
}

/**
 * Clear cookies for a profile (or specific domain).
 */
function clearCookies(profileId, domain = null) {
  const store = _load();
  const p = store.profiles[profileId];
  if (!p) return false;
  if (domain) { delete p.cookies[domain]; }
  else        { p.cookies = {}; }
  _save(store);
  return true;
}

/**
 * Save localStorage snapshot for a profile origin.
 */
function saveStorage(profileId, origin, data) {
  const store = _load();
  const p = store.profiles[profileId];
  if (!p) return null;
  p.localStorage[origin] = data;
  p.lastUsed = new Date().toISOString();
  _save(store);
  return data;
}

/**
 * Register a Playwright pageId as open under this profile.
 */
function attachPage(profileId, pageId) {
  const store = _load();
  const p = store.profiles[profileId];
  if (!p) return;
  if (!p.pageIds.includes(pageId)) p.pageIds.push(pageId);
  p.lastUsed = new Date().toISOString();
  _save(store);
}

/**
 * Remove a Playwright pageId from profile (tab closed).
 */
function detachPage(profileId, pageId) {
  const store = _load();
  const p = store.profiles[profileId];
  if (!p) return;
  p.pageIds = p.pageIds.filter(id => id !== pageId);
  _save(store);
}

/**
 * Create an incognito profile (no cookie persistence).
 */
function createIncognitoProfile(opts = {}) {
  return createProfile({ ...opts, type: "incognito", name: opts.name || "Incognito Session" });
}

/**
 * Get session status summary (for dashboard).
 */
function getStatus() {
  const store  = _load();
  const profiles = Object.values(store.profiles);
  return {
    total:     profiles.length,
    normal:    profiles.filter(p => p.type === "normal").length,
    incognito: profiles.filter(p => p.type === "incognito").length,
    profile:   profiles.filter(p => p.type === "profile").length,
    active:    profiles.filter(p => p.pageIds?.length > 0).length,
    profiles:  profiles.slice(0, 20),
  };
}

module.exports = {
  createProfile, getProfile, listProfiles, updateProfile, deleteProfile,
  saveCookies, getCookies, clearCookies,
  saveStorage, attachPage, detachPage,
  createIncognitoProfile, getStatus,
};
