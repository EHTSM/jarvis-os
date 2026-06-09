"use strict";
/**
 * browserSession — persistent Playwright Chromium browser with crash recovery.
 *
 * Stability guarantees:
 *   - Auto-relaunches after unexpected browser disconnect
 *   - Detects and evicts stale/crashed pages before use
 *   - Tab lifecycle cleanup on page crash or context error
 *   - Launch idempotent: concurrent callers wait on one launch promise
 *   - Hard cap on open tabs (MAX_PAGES)
 *
 * Public API:
 *   launch()           — start the browser (idempotent, concurrent-safe)
 *   newPage(opts)      — open a new tab, returns { ok, page, pageId }
 *   getPage(pageId)    — retrieve an existing open tab (null if not found)
 *   getPageMeta(pageId)— retrieve page + metadata
 *   closePage(pageId)  — close a tab and its context
 *   listPages()        — list all open tabs with metadata
 *   shutdown()         — close browser and release all resources
 *   isRunning()        — quick health check
 *   isPageAlive(pageId)— check if a specific page is usable
 *   getMetrics()       — session statistics
 */

let _playwright   = null;
let _browser      = null;
let _launchError  = null;
let _launchPromise = null;   // guards concurrent launch() calls

const _pages      = new Map();   // pageId → { page, context, url, title, openedAt, lastActivity }
let   _pageCount  = 0;
let   _totalOpened = 0;
let   _totalClosed = 0;
let   _crashCount  = 0;

const MAX_PAGES         = 10;
const LAUNCH_TIMEOUT_MS = 30_000;
const STALE_CHECK_MS    = 3_000;   // timeout for ping on potentially stale page

function _getPW() {
  if (_playwright) return _playwright;
  try {
    _playwright = require("playwright");
    return _playwright;
  } catch (err) {
    _launchError = `Playwright not installed: ${err.message}`;
    return null;
  }
}

// ── Launch (concurrent-safe) ─────────────────────────────────────────────────
async function launch({ headless = true } = {}) {
  if (_browser && _browser.isConnected()) return { ok: true, already: true };

  // Collapse concurrent callers onto one launch attempt
  if (_launchPromise) return _launchPromise;

  _launchPromise = _doLaunch({ headless }).finally(() => { _launchPromise = null; });
  return _launchPromise;
}

async function _doLaunch({ headless }) {
  const pw = _getPW();
  if (!pw) return { ok: false, error: _launchError };

  try {
    _browser = await pw.chromium.launch({
      headless,
      timeout: LAUNCH_TIMEOUT_MS,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
      ],
    });

    _browser.on("disconnected", _onBrowserDisconnect);
    console.log("[BrowserSession] Browser launched (headless=%s)", headless);
    return { ok: true };
  } catch (err) {
    _launchError = err.message;
    _browser = null;
    console.error("[BrowserSession] Launch failed:", err.message);
    return { ok: false, error: err.message };
  }
}

function _onBrowserDisconnect() {
  _crashCount++;
  console.warn("[BrowserSession] Browser disconnected (crash #%d) — clearing page registry", _crashCount);
  _browser = null;
  // All pages are now dead — clean up so callers get clean errors
  for (const [pageId] of _pages) {
    _pages.delete(pageId);
    _totalClosed++;
  }
}

// ── newPage ──────────────────────────────────────────────────────────────────
async function newPage({ userAgent, viewport } = {}) {
  if (!_browser || !_browser.isConnected()) {
    const r = await launch();
    if (!r.ok) return { ok: false, error: r.error };
  }

  if (_pages.size >= MAX_PAGES) {
    // Auto-evict any dead pages before rejecting
    await _evictDeadPages();
    if (_pages.size >= MAX_PAGES) {
      return { ok: false, error: `Tab limit reached (${MAX_PAGES} open). Close a tab first.` };
    }
  }

  try {
    const context = await _browser.newContext({
      userAgent: userAgent || _defaultUA(),
      viewport:  viewport  || { width: 1280, height: 900 },
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });

    const page   = await context.newPage();
    const pageId = `page-${++_pageCount}`;

    const meta = {
      page,
      context,
      pageId,
      url:          "about:blank",
      title:        "",
      openedAt:     new Date().toISOString(),
      lastActivity: Date.now(),
    };

    page.on("domcontentloaded", async () => {
      const m = _pages.get(pageId);
      if (m) {
        m.url          = page.url();
        m.title        = await page.title().catch(() => "");
        m.lastActivity = Date.now();
      }
    });

    page.on("close",  () => { _pages.delete(pageId); _totalClosed++; });
    page.on("crash",  () => {
      console.warn("[BrowserSession] Page crashed: %s", pageId);
      _pages.delete(pageId);
      _totalClosed++;
    });

    context.on("close", () => { _pages.delete(pageId); });

    _pages.set(pageId, meta);
    _totalOpened++;

    return { ok: true, pageId, page };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function _defaultUA() {
  return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
}

// ── Stale page eviction ───────────────────────────────────────────────────────
async function _evictDeadPages() {
  const checks = [];
  for (const [pageId, meta] of _pages) {
    checks.push(_checkPageAlive(pageId, meta));
  }
  await Promise.allSettled(checks);
}

async function _checkPageAlive(pageId, meta) {
  try {
    // A crashed/closed page throws on any evaluation
    await meta.page.evaluate(() => 1, { timeout: STALE_CHECK_MS });
  } catch {
    console.warn("[BrowserSession] Evicting stale page: %s", pageId);
    _pages.delete(pageId);
    _totalClosed++;
    try { await meta.context.close(); } catch {}
  }
}

// ── getPage / getPageMeta ─────────────────────────────────────────────────────
function getPage(pageId) {
  return _pages.get(pageId)?.page ?? null;
}

function getPageMeta(pageId) {
  return _pages.get(pageId) ?? null;
}

// ── isPageAlive ───────────────────────────────────────────────────────────────
async function isPageAlive(pageId) {
  const meta = _pages.get(pageId);
  if (!meta) return false;
  try {
    await meta.page.evaluate(() => 1, { timeout: STALE_CHECK_MS });
    return true;
  } catch {
    return false;
  }
}

// ── closePage ─────────────────────────────────────────────────────────────────
async function closePage(pageId) {
  const meta = _pages.get(pageId);
  if (!meta) return { ok: false, error: "Page not found" };
  try {
    await meta.context.close();
    _pages.delete(pageId);
    _totalClosed++;
    return { ok: true };
  } catch (err) {
    _pages.delete(pageId);
    return { ok: true, warning: err.message };
  }
}

// ── listPages ─────────────────────────────────────────────────────────────────
function listPages() {
  return Array.from(_pages.values()).map(m => ({
    pageId:       m.pageId,
    url:          m.url,
    title:        m.title,
    openedAt:     m.openedAt,
    lastActivity: new Date(m.lastActivity).toISOString(),
  }));
}

// ── shutdown ──────────────────────────────────────────────────────────────────
async function shutdown() {
  if (!_browser) return { ok: true, already: true };
  try {
    await _browser.close();
    _browser = null;
    _pages.clear();
    return { ok: true };
  } catch (err) {
    _browser = null;
    _pages.clear();
    return { ok: true, warning: err.message };
  }
}

// ── Health ────────────────────────────────────────────────────────────────────
function isRunning() {
  return _browser !== null && _browser.isConnected?.() !== false;
}

function getMetrics() {
  return {
    running:      isRunning(),
    openTabs:     _pages.size,
    maxTabs:      MAX_PAGES,
    totalOpened:  _totalOpened,
    totalClosed:  _totalClosed,
    crashCount:   _crashCount,
    pages:        listPages(),
  };
}

module.exports = {
  launch, newPage,
  getPage, getPageMeta, isPageAlive,
  closePage, listPages,
  shutdown, isRunning, getMetrics,
};
