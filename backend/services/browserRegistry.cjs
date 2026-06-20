"use strict";
/**
 * Browser Registry — every browser engine and its capabilities.
 *
 * Browsers: Chrome, Edge, Brave, Arc, Electron, Playwright (Chromium/Firefox/WebKit)
 * Each browser: type, detection, capabilities, launch hints.
 *
 * Reuses: aiRegistry pattern (same shape: id, name, capabilities: {[cap]: CapDef})
 * Storage: data/browser-registry.json (custom / discovered overrides)
 */

const fs   = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "../../data/browser-registry.json");

// ── Browser catalogue ─────────────────────────────────────────────
const BROWSERS = {
  playwright_chromium: {
    id: "playwright_chromium", name: "Playwright (Chromium)", family: "chromium",
    type: "automated", available: true,
    description: "Headless Chromium via Playwright — fully automated, no user account needed.",
    launchHint: "npx playwright install chromium",
    capabilities: {
      navigate:   { quality: 1.0, headless: true,  auth: false },
      screenshot: { quality: 1.0, headless: true,  auth: false },
      pdf:        { quality: 1.0, headless: true,  auth: false },
      click:      { quality: 1.0, headless: true,  auth: false },
      type:       { quality: 1.0, headless: true,  auth: false },
      scroll:     { quality: 1.0, headless: true,  auth: false },
      download:   { quality: 0.9, headless: true,  auth: false },
      upload:     { quality: 0.9, headless: true,  auth: false },
      javascript: { quality: 1.0, headless: true,  auth: false },
      network:    { quality: 1.0, headless: true,  auth: false },
      cookies:    { quality: 1.0, headless: true,  auth: false },
      storage:    { quality: 1.0, headless: true,  auth: false },
      incognito:  { quality: 1.0, headless: true,  auth: false },
      multiTab:   { quality: 1.0, headless: true,  auth: false },
    },
  },
  playwright_firefox: {
    id: "playwright_firefox", name: "Playwright (Firefox)", family: "firefox",
    type: "automated", available: false,
    description: "Firefox via Playwright — useful for Firefox-specific flows.",
    launchHint: "npx playwright install firefox",
    capabilities: {
      navigate:   { quality: 0.95, headless: true, auth: false },
      screenshot: { quality: 0.95, headless: true, auth: false },
      click:      { quality: 0.95, headless: true, auth: false },
      type:       { quality: 0.95, headless: true, auth: false },
      cookies:    { quality: 0.95, headless: true, auth: false },
      incognito:  { quality: 0.90, headless: true, auth: false },
    },
  },
  playwright_webkit: {
    id: "playwright_webkit", name: "Playwright (WebKit/Safari)", family: "webkit",
    type: "automated", available: false,
    description: "WebKit via Playwright — Safari-compatible automation.",
    launchHint: "npx playwright install webkit",
    capabilities: {
      navigate:   { quality: 0.90, headless: true, auth: false },
      screenshot: { quality: 0.95, headless: true, auth: false },
      click:      { quality: 0.90, headless: true, auth: false },
    },
  },
  chrome: {
    id: "chrome", name: "Google Chrome", family: "chromium",
    type: "system", available: false,
    description: "System Chrome — can use existing profiles and logged-in sessions.",
    detection: ["google-chrome","chrome","Google Chrome"],
    capabilities: {
      navigate:   { quality: 1.0, headless: false, auth: true  },
      screenshot: { quality: 1.0, headless: false, auth: true  },
      click:      { quality: 1.0, headless: false, auth: true  },
      type:       { quality: 1.0, headless: false, auth: true  },
      multiTab:   { quality: 1.0, headless: false, auth: true  },
      cookies:    { quality: 1.0, headless: false, auth: true  },
      profile:    { quality: 1.0, headless: false, auth: true  },
      download:   { quality: 1.0, headless: false, auth: true  },
      upload:     { quality: 1.0, headless: false, auth: true  },
    },
  },
  edge: {
    id: "edge", name: "Microsoft Edge", family: "chromium",
    type: "system", available: false,
    description: "Edge with Playwright's channel=msedge.",
    detection: ["msedge","microsoft-edge","Microsoft Edge"],
    capabilities: {
      navigate:   { quality: 1.0, headless: false, auth: true },
      screenshot: { quality: 1.0, headless: false, auth: true },
      click:      { quality: 1.0, headless: false, auth: true },
      multiTab:   { quality: 1.0, headless: false, auth: true },
      cookies:    { quality: 1.0, headless: false, auth: true },
    },
  },
  brave: {
    id: "brave", name: "Brave Browser", family: "chromium",
    type: "system", available: false,
    description: "Brave — Chromium-based, blocks many trackers/ads by default.",
    capabilities: {
      navigate:   { quality: 0.95, headless: false, auth: true },
      screenshot: { quality: 0.95, headless: false, auth: true },
      click:      { quality: 0.95, headless: false, auth: true },
      incognito:  { quality: 1.0,  headless: false, auth: false },
    },
  },
  arc: {
    id: "arc", name: "Arc Browser", family: "chromium",
    type: "system", available: false,
    description: "Arc — macOS Chromium-based browser.",
    capabilities: {
      navigate:   { quality: 0.90, headless: false, auth: true },
      screenshot: { quality: 0.90, headless: false, auth: true },
      click:      { quality: 0.90, headless: false, auth: true },
    },
  },
  electron: {
    id: "electron", name: "Electron (this app)", family: "chromium",
    type: "embedded", available: true,
    description: "The embedded Electron browser — IPC bridge available.",
    capabilities: {
      navigate:   { quality: 1.0, headless: false, auth: true  },
      screenshot: { quality: 1.0, headless: false, auth: true  },
      ipc:        { quality: 1.0, headless: false, auth: false },
      storage:    { quality: 1.0, headless: false, auth: false },
    },
  },
};

// ── Capability taxonomy ───────────────────────────────────────────
const BROWSER_CAPABILITIES = [
  "navigate","screenshot","pdf","click","type","scroll",
  "download","upload","javascript","network","cookies",
  "storage","incognito","multiTab","profile","ipc","auth",
];

// ── State ─────────────────────────────────────────────────────────
function _load() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return {}; }
}

function _save(d) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}

// ── Public API ────────────────────────────────────────────────────

function getAll() {
  const overlay = _load();
  const merged  = { ...BROWSERS };
  for (const [id, p] of Object.entries(overlay)) {
    merged[id] = { ...(merged[id] || {}), ...p };
  }
  return Object.values(merged);
}

function getById(id) {
  return getAll().find(b => b.id === id) || null;
}

function getByCapability(cap) {
  return getAll().filter(b => b.capabilities?.[cap]);
}

function getAvailable() {
  return getAll().filter(b => b.available);
}

/**
 * Best browser for a capability.
 * Prefers automated (playwright_chromium) for headless needs,
 * system browsers when auth/profile required.
 */
function bestFor(capability, opts = {}) {
  const requireAuth = opts.requireAuth || false;
  const candidates  = getByCapability(capability)
    .filter(b => b.available)
    .filter(b => !requireAuth || b.capabilities[capability]?.auth);
  if (!candidates.length) return getById("playwright_chromium"); // default fallback
  return candidates.sort((a, b) => (b.capabilities[capability]?.quality || 0) - (a.capabilities[capability]?.quality || 0))[0];
}

function register(def) {
  const overlay = _load();
  overlay[def.id] = def;
  _save(overlay);
}

function setAvailable(id, value) {
  const overlay = _load();
  overlay[id] = { ...(overlay[id] || {}), available: value };
  _save(overlay);
}

module.exports = { getAll, getById, getByCapability, getAvailable, bestFor, register, setAvailable, BROWSERS, BROWSER_CAPABILITIES };
