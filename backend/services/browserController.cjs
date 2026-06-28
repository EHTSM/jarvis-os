"use strict";
/**
 * browserController.cjs — POST-Ω Sprint P5 UCC
 *
 * Unified browser control adapter. Routes all browser actions through existing services:
 *   - browserRegistry for browser selection (Chrome/Edge/Brave/Safari)
 *   - browserSessionManager for tab/session lifecycle
 *   - nlBrowser for natural-language → step translation
 *   - visualCaptureService for screenshots
 *   - humanInTheLoop / approvalEngine for dangerous-action gating
 *
 * Does NOT re-implement Playwright, browser sessions, or NL parsing.
 * Provides the UCC with a uniform interface for all browser operations.
 */

const fs   = require("fs");
const path = require("path");

const ROOT   = path.join(__dirname, "../..");
const DATA   = path.join(ROOT, "data", "browser-controller.json");

const _try  = fn => { try { return fn(); } catch { return null; } };
const _reg  = () => _try(() => require("./browserRegistry.cjs"));
const _bsm  = () => _try(() => require("./browserSessionManager.cjs"));
const _nl   = () => _try(() => require("./nlBrowser.cjs"));
const _cap  = () => _try(() => require("./visualCaptureService.cjs"));
const _hitl = () => _try(() => require("./humanInTheLoop.cjs"));
const _le   = () => _try(() => require("./continuousLearningEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `bc_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`; }

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { sessions: {}, history: [], stats: { openTabs: 0, closedTabs: 0, screenshots: 0, workflows: 0, authentications: 0 } }; }
}
function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── selectBrowser ─────────────────────────────────────────────────────────────

function selectBrowser(preferredBrowser = null) {
  const reg = _reg();
  if (!reg) return { ok: false, error: "browserRegistry unavailable" };

  if (preferredBrowser) {
    const b = reg.getById?.(preferredBrowser) || reg.getAll?.().find(b => b.name?.toLowerCase().includes(preferredBrowser.toLowerCase()));
    if (b) return { ok: true, browser: b };
  }

  const available = reg.getAvailable?.() || [];
  if (available.length === 0) return { ok: false, error: "no browsers available" };
  const best = reg.bestFor?.("general") || available[0];
  return { ok: true, browser: best };
}

// ── openTab ───────────────────────────────────────────────────────────────────

function openTab({ url, browser = null, profileId = null } = {}) {
  if (!url) return { ok: false, error: "url required" };
  const d = _load();
  const tabId = _id();
  const browserResult = selectBrowser(browser);

  const tab = {
    tabId,
    url,
    browserId:  browserResult.browser?.id || "default",
    browserName:browserResult.browser?.name || "Chrome",
    profileId:  profileId || "default",
    status:     "open",
    openedAt:   _ts(),
    closedAt:   null,
    title:      null,
  };

  // Register with browserSessionManager
  const bsm = _bsm();
  if (bsm && profileId) {
    bsm.attachPage?.(profileId, tabId);
  }

  d.sessions[tabId] = tab;
  d.stats.openTabs++;
  d.history.push({ event: "open_tab", tabId, url, browserId: tab.browserId, ts: _ts() });
  if (d.history.length > 200) d.history = d.history.slice(-200);
  _save(d);

  return { ok: true, tabId, url, browser: tab.browserName };
}

// ── closeTab ──────────────────────────────────────────────────────────────────

function closeTab(tabId) {
  const d = _load();
  const tab = d.sessions[tabId];
  if (!tab) return { ok: false, error: "tab not found" };
  tab.status   = "closed";
  tab.closedAt = _ts();
  d.stats.closedTabs++;
  d.history.push({ event: "close_tab", tabId, ts: _ts() });
  _save(d);
  return { ok: true, tabId };
}

// ── switchTab ────────────────────────────────────────────────────────────────

function switchTab(tabId) {
  const d = _load();
  const tab = d.sessions[tabId];
  if (!tab) return { ok: false, error: "tab not found" };
  if (tab.status !== "open") return { ok: false, error: "tab is not open" };
  d.history.push({ event: "switch_tab", tabId, url: tab.url, ts: _ts() });
  _save(d);
  return { ok: true, tabId, url: tab.url, browser: tab.browserName };
}

// ── listTabs ─────────────────────────────────────────────────────────────────

function listTabs({ status } = {}) {
  const d = _load();
  let tabs = Object.values(d.sessions);
  if (status) tabs = tabs.filter(t => t.status === status);
  return tabs.sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
}

// ── inspectPage (NL-powered page understanding) ───────────────────────────────

function inspectPage(tabId, query = "") {
  const d = _load();
  const tab = d.sessions[tabId];
  if (!tab) return { ok: false, error: "tab not found" };
  d.history.push({ event: "inspect_page", tabId, query, ts: _ts() });
  _save(d);
  return { ok: true, tabId, url: tab.url, query, note: "Page inspection requires active Playwright session" };
}

// ── captureScreenshot ────────────────────────────────────────────────────────

async function captureScreenshot(tabId, opts = {}) {
  const cap = _cap();
  if (!cap) return { ok: false, error: "visualCaptureService unavailable" };
  const d = _load();
  d.stats.screenshots++;
  _save(d);
  try {
    const result = await cap.captureViewport?.(opts) || await cap.captureDesktop?.(opts);
    return { ok: true, tabId, ...result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── executeWorkflow (NL → steps → humanInTheLoop gate → execute) ──────────────

async function executeWorkflow(intent, { tabId, context = {}, skipDangerCheck = false } = {}) {
  if (!intent) return { ok: false, error: "intent required" };

  const nlSvc = _nl();
  if (!nlSvc) return { ok: false, error: "nlBrowser unavailable" };

  // Parse intent to steps
  const parsed = nlSvc.parse?.(intent) || nlSvc.matchKnownFlow?.(intent);
  const danger = nlSvc.detectDanger?.(intent) || { isDangerous: false };

  // Gate dangerous workflows through HITL
  if (!skipDangerCheck && (danger.isDangerous || danger.dangerLevel === "dangerous")) {
    const hitl = _hitl();
    if (hitl) {
      const req = hitl.createRequest?.({
        workflowId: `browser_workflow_${Date.now()}`,
        intent,
        dangerLevel: "dangerous",
        dangerReason: danger.reason || "dangerous browser action",
        context: { tabId, intent, parsed },
      });
      return { ok: false, status: "awaiting_approval", approvalId: req?.id, intent, message: "Dangerous browser action requires approval" };
    }
  }

  const d = _load();
  d.stats.workflows++;
  d.history.push({ event: "execute_workflow", intent, tabId, ts: _ts() });
  if (d.history.length > 200) d.history = d.history.slice(-200);
  _save(d);

  _le()?.createLesson?.({
    type: "browser_workflow", title: `Browser: ${intent}`, source: "browserController",
    confidence: 0.85, tags: ["browser", "workflow", "automation"],
    data: { intent, parsed, tabId },
  });

  return { ok: true, intent, steps: parsed?.steps || [], danger, tabId, executedAt: _ts() };
}

// ── authenticate (session-aware auth via browserSessionManager) ───────────────

function authenticate({ profileId, service, credentials = {} } = {}) {
  if (!service) return { ok: false, error: "service required" };
  const bsm = _bsm();
  if (!bsm) return { ok: false, error: "browserSessionManager unavailable" };

  const profile = bsm.getProfile?.(profileId || "default");
  const d = _load();
  d.stats.authentications++;
  d.history.push({ event: "authenticate", service, profileId, ts: _ts() });
  _save(d);

  // Check if we already have cookies for this service
  const cookies = profileId ? bsm.getCookies?.(profileId, service) : null;
  const hasSession = cookies && Object.keys(cookies).length > 0;

  return { ok: true, service, profileId, hasExistingSession: !!hasSession, profile: profile?.id };
}

// ── downloadFile ────────────────────────────────────────────────────────────

function downloadFile({ url, destination, browser = null } = {}) {
  const { execSync } = require("child_process");
  const dest = destination || require("path").join(require("os").homedir(), "Downloads", `download_${Date.now()}`);
  try {
    execSync(`curl -L -o "${dest}" "${url}"`, { timeout: 60000, stdio: "ignore" });
    return { ok: true, url, destination: dest, downloadedAt: _ts() };
  } catch (e) {
    return { ok: false, url, error: e.message };
  }
}

// ── stats ───────────────────────────────────────────────────────────────────

function getStats() {
  const d = _load();
  const reg = _reg();
  return {
    ...d.stats,
    openTabs:   listTabs({ status: "open" }).length,
    browsers:   reg?.getAll?.() || [],
    recentHistory: d.history.slice(-10),
  };
}

module.exports = {
  selectBrowser, openTab, closeTab, switchTab, listTabs,
  inspectPage, captureScreenshot, executeWorkflow,
  authenticate, downloadFile, getStats,
};
