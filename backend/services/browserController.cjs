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
// Real Playwright action primitives (navigate/click/typeText/screenshot/
// etc., agents/browser/actionEngine.cjs) — executeWorkflow() below
// previously parsed an intent into a step plan via nlBrowser.cjs and
// returned it without ever running a single step against a real page;
// this closes that gap using the same real actions already driving
// openTab()/inspectPage() above, not a new execution path.
const _ae   = () => _try(() => require("../../agents/browser/actionEngine.cjs"));
// Real Playwright session (agents/browser/browserSession.cjs) — the same
// service visualCaptureService.cjs already drives for real screenshot
// capture (confirmed live in the Universal Brand/JARVIS Dream audits).
// openTab/closeTab/inspectPage below previously only wrote JSON bookkeeping
// records with a fabricated tabId and never opened a real browser — this
// wires the existing real session manager in instead of building a second,
// parallel browser runtime.
const _session = () => _try(() => require("../../agents/browser/browserSession.cjs"));
const { assertSafeNavigationTarget } = require("../utils/urlSafety.cjs");

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

async function openTab({ url, browser = null, profileId = null } = {}) {
  if (!url) return { ok: false, error: "url required" };

  const safety = await assertSafeNavigationTarget(url);
  if (!safety.safe) return { ok: false, error: `unsafe navigation target: ${safety.reason}` };

  const session = _session();
  if (!session) return { ok: false, error: "browserSession (Playwright) unavailable" };

  if (!session.isRunning()) {
    const launched = await session.launch({ headless: true });
    if (!launched.ok) return { ok: false, error: `Browser launch failed: ${launched.error}` };
  }

  const page = await session.newPage();
  if (!page.ok) return { ok: false, error: page.error };

  try {
    await page.page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  } catch (e) {
    await session.closePage(page.pageId).catch(() => {});
    return { ok: false, error: `Navigation failed: ${e.message}` };
  }

  const d = _load();
  const tabId = page.pageId;   // real Playwright pageId, not a fabricated id
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
    title:      await page.page.title().catch(() => ""),
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

  return { ok: true, tabId, url, browser: tab.browserName, title: tab.title };
}

// ── closeTab ──────────────────────────────────────────────────────────────────

async function closeTab(tabId) {
  const d = _load();
  const tab = d.sessions[tabId];
  if (!tab) return { ok: false, error: "tab not found" };

  const session = _session();
  if (session) await session.closePage(tabId).catch(() => {});

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

async function inspectPage(tabId, query = "") {
  const d = _load();
  const tab = d.sessions[tabId];
  if (!tab) return { ok: false, error: "tab not found" };

  const session = _session();
  const page    = session?.getPage?.(tabId);
  if (!page) {
    d.history.push({ event: "inspect_page", tabId, query, ts: _ts(), ok: false });
    _save(d);
    return { ok: false, tabId, url: tab.url, query, error: "no active Playwright page for this tab (closed or session restarted)" };
  }

  let title, url, text;
  try {
    title = await page.title();
    url   = page.url();
    // Visible-text snapshot — a real (if simple) answer to "what's on this
    // page," matching the query-in/summary-out contract this function
    // already advertised. For selector-targeted element inspection, use
    // liveDesignInspector.cjs's inspectElement({pageId, selector}), which
    // already exists for that narrower, real use case — not duplicated here.
    text = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || "");
  } catch (e) {
    d.history.push({ event: "inspect_page", tabId, query, ts: _ts(), ok: false });
    _save(d);
    return { ok: false, tabId, error: `inspection failed: ${e.message}` };
  }

  d.history.push({ event: "inspect_page", tabId, query, ts: _ts(), ok: true });
  _save(d);
  return { ok: true, tabId, url, title, query, text };
}

// ── captureScreenshot ────────────────────────────────────────────────────────

async function captureScreenshot(tabId, opts = {}) {
  const cap = _cap();
  if (!cap) return { ok: false, error: "visualCaptureService unavailable" };
  const d = _load();
  d.stats.screenshots++;
  _save(d);
  try {
    // Screenshot the ALREADY-OPEN, tracked tab (captureFromPage reuses the
    // real page by pageId) instead of always spawning an unrelated new one
    // via captureViewport, which previously happened regardless of tabId.
    const result = tabId
      ? await cap.captureFromPage?.({ pageId: tabId, ...opts })
      : (await cap.captureViewport?.(opts) || await cap.captureDesktop?.(opts));
    if (!result) return { ok: false, tabId, error: "capture unavailable" };
    if (result.ok === false) return { ok: false, tabId, error: result.error };
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

  // Parse intent to steps. Real bug fix: nlSvc.parse() is async but was
  // never awaited here — `nlSvc.parse?.(intent) || nlSvc.matchKnownFlow?.(intent)`
  // always short-circuited on the truthy (unresolved) Promise parse()
  // returns, so matchKnownFlow's known-flow fast path was unreachable and
  // parsed.steps was always undefined regardless of what nlBrowser would
  // have actually produced — every workflow ran with an empty step list.
  const parsed = await nlSvc.parse?.(intent) || nlSvc.matchKnownFlow?.(intent) || { steps: [] };
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

  // Real execution — previously this function only ever returned the
  // parsed step PLAN without running a single step, regardless of
  // whether a tabId/real page was available. A tabId is required to
  // actually execute (there is no page to act on otherwise); without one
  // this still returns the plan, same as before, but now honestly
  // labeled "planned" rather than implying execution happened.
  const steps = parsed?.steps || [];
  let stepResults = null;
  let executed = false;
  if (tabId && steps.length) {
    const session = _session();
    const page = session?.getPage?.(tabId);
    const ae = _ae();
    if (page && ae) {
      stepResults = await _runSteps(ae, page, steps);
      executed = true;
    }
  }

  _le()?.createLesson?.({
    type: "browser_workflow", title: `Browser: ${intent}`, source: "browserController",
    confidence: 0.85, tags: ["browser", "workflow", "automation"],
    data: { intent, parsed, tabId, executed },
  });

  const allStepsOk = executed && stepResults.length > 0 && stepResults.every(r => r.ok !== false);
  return {
    ok: executed ? allStepsOk : true,
    intent, steps, danger, tabId, executedAt: _ts(),
    status: executed ? (allStepsOk ? "executed" : "executed_with_errors") : "planned",
    stepResults,
  };
}

// ── _runSteps — dispatch a parsed step plan onto real Playwright actions ──────
// Step action vocabulary matches nlBrowser.cjs's own AI prompt template
// exactly (buildPrompt()'s "Available actions:" line + its known-flow
// library) rather than a guessed subset — every action nlBrowser can
// produce has a real actionEngine.cjs function backing it here.
async function _runSteps(ae, page, steps) {
  const results = [];
  for (const step of steps) {
    try {
      let r;
      switch (step.action) {
        case "navigate":
          r = await ae.navigate(page, step.url); break;
        case "click":
          r = await ae.click(page, step.selector); break;
        case "type":
          r = await ae.typeText(page, step.selector, step.text ?? step.value ?? ""); break;
        case "fillForm":
          r = await ae.fillForm(page, step.selector, step.text ?? step.value ?? ""); break;
        case "screenshot":
          r = await ae.screenshot(page, { fullPage: !!step.fullPage }); break;
        case "scroll":
          r = await ae.scrollDown(page, step.pixels || 500); break;
        case "pressKey":
          r = await ae.pressKey(page, step.key); break;
        case "selectOption":
          r = await ae.selectOption(page, step.selector, step.value); break;
        case "waitForElement":
          r = await ae.waitForElement(page, step.selector, { timeout: step.timeout }); break;
        case "waitForNavigation":
          r = await ae.waitForNavigation(page, { timeout: step.timeout }); break;
        case "getText":
          r = await ae.getText(page, step.selector); break;
        case "getUrl":
          r = { ok: true, action: "getUrl", url: ae.getUrl(page), ts: new Date().toISOString() }; break;
        case "hoverElement":
          r = await ae.hoverElement(page, step.selector); break;
        default:
          r = { ok: false, action: step.action || "unknown", error: `unsupported step action: ${step.action}` };
      }
      results.push({ step, ...r });
      if (!r.ok && step.stopOnFail !== false) break;
    } catch (e) {
      results.push({ step, ok: false, error: e.message });
      break;
    }
  }
  return results;
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
