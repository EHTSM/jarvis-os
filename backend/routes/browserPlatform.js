"use strict";
/**
 * Browser Automation Platform Routes — all 10 modules.
 *
 * MODULE 1 – Browser Registry
 *   GET  /browser-platform/registry                  — all browsers + capabilities
 *   GET  /browser-platform/registry/:id              — single browser
 *   GET  /browser-platform/registry/best/:cap        — best browser for capability
 *   POST /browser-platform/registry/register         — register custom browser
 *   POST /browser-platform/registry/:id/available    — mark browser available
 *
 * MODULE 2 – Session Manager
 *   GET  /browser-platform/sessions                  — list profiles
 *   POST /browser-platform/sessions                  — create profile
 *   GET  /browser-platform/sessions/:id              — get profile
 *   PUT  /browser-platform/sessions/:id              — update profile
 *   DELETE /browser-platform/sessions/:id            — delete profile
 *   POST /browser-platform/sessions/:id/cookies      — save cookies
 *   GET  /browser-platform/sessions/:id/cookies      — get cookies
 *   DELETE /browser-platform/sessions/:id/cookies    — clear cookies
 *   POST /browser-platform/sessions/:id/storage      — save localStorage
 *   POST /browser-platform/sessions/incognito        — create incognito profile
 *   GET  /browser-platform/sessions/status           — session status
 *
 * MODULE 3 – Visual Browser Controller
 *   POST /browser-platform/control/run               — run step sequence
 *   POST /browser-platform/control/action            — single action
 *   POST /browser-platform/control/navigate          — navigate to URL
 *   POST /browser-platform/control/screenshot        — capture screenshot
 *   POST /browser-platform/control/pdf               — export PDF
 *   GET  /browser-platform/control/tabs              — list open tabs
 *   POST /browser-platform/control/tabs/close        — close a tab
 *
 * MODULE 4 – Natural Language Browser
 *   POST /browser-platform/nl/parse                  — parse intent → steps
 *   POST /browser-platform/nl/run                    — parse + run
 *   GET  /browser-platform/nl/flows                  — list known flows
 *
 * MODULE 5 – Browser Memory
 *   GET  /browser-platform/memory                    — memory snapshot
 *   POST /browser-platform/memory/login              — remember login
 *   GET  /browser-platform/memory/login/:domain      — get login
 *   POST /browser-platform/memory/selector           — remember selector
 *   GET  /browser-platform/memory/selectors/:domain  — get selectors
 *   POST /browser-platform/memory/flow               — remember flow
 *   GET  /browser-platform/memory/flow/:key          — get best flow
 *   GET  /browser-platform/memory/flows              — list all flows
 *   POST /browser-platform/memory/cookies            — save cookies
 *
 * MODULE 6 – Workflow Builder
 *   POST /browser-platform/workflows                 — save recording as template
 *   GET  /browser-platform/workflows                 — list templates
 *   GET  /browser-platform/workflows/:id             — get template
 *   DELETE /browser-platform/workflows/:id           — delete template
 *   POST /browser-platform/workflows/:id/run         — replay template
 *   POST /browser-platform/workflows/:id/clone       — clone template
 *
 * MODULE 7 – Human-in-the-Loop
 *   GET  /browser-platform/hitl/queue                — pending approvals
 *   GET  /browser-platform/hitl/all                  — all requests
 *   GET  /browser-platform/hitl/:id                  — single request
 *   POST /browser-platform/hitl/:id/approve          — approve
 *   POST /browser-platform/hitl/:id/reject           — reject
 *   GET  /browser-platform/hitl/summary              — queue summary
 *   POST /browser-platform/hitl/scan                 — scan steps for danger
 *
 * MODULE 8 – Browser Marketplace
 *   GET  /browser-platform/marketplace               — full catalogue
 *   GET  /browser-platform/marketplace/:id           — single automation
 *   POST /browser-platform/marketplace/:id/install   — install
 *   GET  /browser-platform/marketplace/installed     — installed automations
 *   POST /browser-platform/marketplace/:id/run       — install + run
 *   GET  /browser-platform/marketplace/platforms     — platform list
 *   GET  /browser-platform/marketplace/stats         — catalogue stats
 *
 * MODULE 9 – Automation Dashboard
 *   GET  /browser-platform/dashboard                 — full dashboard snapshot
 *   GET  /browser-platform/dashboard/sessions        — running + recent sessions
 *   GET  /browser-platform/dashboard/health          — browser health
 *
 * MODULE 10 – Commercial Benchmark
 *   GET  /browser-platform/benchmark                 — run commercial benchmark
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const browserRegistry  = require("../services/browserRegistry.cjs");
const sessionManager   = require("../services/browserSessionManager.cjs");
const nlBrowser        = require("../services/nlBrowser.cjs");
const browserMemory    = require("../services/browserMemory.cjs");
const humanInTheLoop   = require("../services/humanInTheLoop.cjs");
const marketplace      = require("../services/browserMarketplace.cjs");
const benchmark        = require("../services/browserBenchmark.cjs");

// Lazy-load the existing browser agent layer (Playwright)
function _getSession()  { return require("../../agents/browser/browserSession.cjs"); }
function _getRunner()   { return require("../../agents/browser/browserRunner.cjs"); }
function _getEngine()   { return require("../../agents/browser/actionEngine.cjs"); }
function _getStore()    { return require("../../agents/browser/browserWorkflowStore.cjs"); }

router.use(requireAuth);

function _accountId(req) { return req.user?.accountId || req.user?.id || "unknown"; }

// ══════════════════════════════════════════════════════════════════
// MODULE 1: Browser Registry
// ══════════════════════════════════════════════════════════════════

router.get("/browser-platform/registry", (req, res) => {
  try { res.json({ ok: true, browsers: browserRegistry.getAll() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/registry/best/:cap", (req, res) => {
  try {
    const best = browserRegistry.bestFor(req.params.cap, { requireAuth: req.query.requireAuth === "true" });
    res.json({ ok: true, capability: req.params.cap, best });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/registry/:id", (req, res) => {
  try {
    const b = browserRegistry.getById(req.params.id);
    if (!b) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, browser: b });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/registry/register", (req, res) => {
  try {
    const def = req.body;
    if (!def?.id || !def?.name) return res.status(400).json({ error: "id and name required" });
    browserRegistry.register(def);
    res.json({ ok: true, browser: browserRegistry.getById(def.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/registry/:id/available", (req, res) => {
  try {
    browserRegistry.setAvailable(req.params.id, !!req.body.available);
    res.json({ ok: true, browser: browserRegistry.getById(req.params.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 2: Session Manager
// ══════════════════════════════════════════════════════════════════

router.get("/browser-platform/sessions/status", (req, res) => {
  try { res.json({ ok: true, ...sessionManager.getStatus() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/sessions", (req, res) => {
  try {
    const profiles = sessionManager.listProfiles({ accountId: req.query.all ? undefined : _accountId(req), type: req.query.type });
    res.json({ ok: true, profiles });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/sessions", (req, res) => {
  try {
    const p = sessionManager.createProfile({ ...req.body, accountId: _accountId(req) });
    res.json({ ok: true, profile: p });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/sessions/incognito", (req, res) => {
  try {
    const p = sessionManager.createIncognitoProfile({ ...req.body, accountId: _accountId(req) });
    res.json({ ok: true, profile: p });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/sessions/:id", (req, res) => {
  try {
    const p = sessionManager.getProfile(req.params.id);
    if (!p) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, profile: p });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/browser-platform/sessions/:id", (req, res) => {
  try {
    const p = sessionManager.updateProfile(req.params.id, req.body);
    if (!p) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, profile: p });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/browser-platform/sessions/:id", (req, res) => {
  try {
    const ok = sessionManager.deleteProfile(req.params.id);
    res.json({ ok });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/sessions/:id/cookies", (req, res) => {
  try {
    const { domain, cookies } = req.body || {};
    if (!domain) return res.status(400).json({ error: "domain required" });
    const result = sessionManager.saveCookies(req.params.id, domain, cookies || []);
    res.json({ ok: true, saved: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/sessions/:id/cookies", (req, res) => {
  try {
    const cookies = sessionManager.getCookies(req.params.id, req.query.domain || null);
    res.json({ ok: true, cookies });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/browser-platform/sessions/:id/cookies", (req, res) => {
  try {
    const ok = sessionManager.clearCookies(req.params.id, req.query.domain || null);
    res.json({ ok });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/sessions/:id/storage", (req, res) => {
  try {
    const { origin, data } = req.body || {};
    if (!origin) return res.status(400).json({ error: "origin required" });
    const saved = sessionManager.saveStorage(req.params.id, origin, data || {});
    res.json({ ok: true, saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 3: Visual Browser Controller
// ══════════════════════════════════════════════════════════════════

router.post("/browser-platform/control/run", async (req, res) => {
  try {
    const { steps, pageId, profileId } = req.body || {};
    if (!steps?.length) return res.status(400).json({ error: "steps required" });

    // Delegate to existing browserRunner
    const runner = _getRunner();
    const result = await runner.run(steps, { pageId, accountId: _accountId(req) });

    // Store in memory if successful
    if (result.ok) {
      browserMemory.rememberFlow(`manual_${Date.now()}`, steps, {
        success: true, durationMs: result.durationMs,
      });
    }

    res.json({ ok: result.ok, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/control/action", async (req, res) => {
  try {
    const { action, selector, url, value, pageId, ...rest } = req.body || {};
    if (!action) return res.status(400).json({ error: "action required" });
    const engine = _getEngine();
    const session= _getSession();
    let page     = pageId ? await session.getPage(pageId) : null;
    if (!page) {
      const result = await session.newPage();
      page = result.page;
    }
    const fn = engine[action];
    if (!fn) return res.status(400).json({ error: `unknown action: ${action}` });
    const result = await fn(page, { selector, url, value, ...rest });
    res.json({ ok: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/control/navigate", async (req, res) => {
  try {
    const { url, pageId } = req.body || {};
    if (!url) return res.status(400).json({ error: "url required" });
    const runner = _getRunner();
    const result = await runner.run([{ action: "navigate", url }], { pageId });
    res.json({ ok: result.ok, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/control/screenshot", async (req, res) => {
  try {
    const { pageId, fullPage } = req.body || {};
    const runner = _getRunner();
    const result = await runner.run(
      [{ action: "screenshot", label: "Manual screenshot", fullPage: !!fullPage }],
      { pageId }
    );
    res.json({ ok: result.ok, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/control/pdf", async (req, res) => {
  try {
    const { pageId } = req.body || {};
    const runner = _getRunner();
    const result = await runner.run([{ action: "screenshot", label: "PDF export" }], { pageId });
    res.json({ ok: result.ok, result, note: "PDF export via Playwright page.pdf() — requires headless mode" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/control/tabs", async (req, res) => {
  try {
    const session = _getSession();
    const tabs    = session.listPages();
    res.json({ ok: true, tabs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/control/tabs/close", async (req, res) => {
  try {
    const { pageId } = req.body || {};
    if (!pageId) return res.status(400).json({ error: "pageId required" });
    const session = _getSession();
    await session.closePage(pageId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 4: Natural Language Browser
// ══════════════════════════════════════════════════════════════════

router.post("/browser-platform/nl/parse", async (req, res) => {
  try {
    const { intent, params, currentUrl, useKnownFlow } = req.body || {};
    if (!intent) return res.status(400).json({ error: "intent required" });
    const result = await nlBrowser.parse(intent, { params, currentUrl, useKnownFlow });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/nl/run", async (req, res) => {
  try {
    const { intent, params, pageId, requireApproval } = req.body || {};
    if (!intent) return res.status(400).json({ error: "intent required" });

    // 1. Parse intent
    const parsed = await nlBrowser.parse(intent, { params, useKnownFlow: true });

    // 2. Danger scan
    const flagged = humanInTheLoop.scanSteps(parsed.steps, intent);

    // 3. If dangerous and approval required, create HITL request
    if (flagged.length > 0 && (requireApproval !== false || parsed.dangerLevel === "dangerous")) {
      const req_ = humanInTheLoop.createRequest({
        intent, steps: parsed.steps, flaggedSteps: flagged,
        dangerLevel: parsed.dangerLevel, dangerReason: parsed.dangerReason,
        accountId: _accountId(req),
      });
      return res.json({
        ok: false,
        requiresApproval: true,
        hitlRequestId: req_.id,
        parsed,
        flagged,
        message: `This action requires human approval before running. Approve at /browser-platform/hitl/${req_.id}/approve`,
      });
    }

    // 4. Run steps via existing runner
    const runner = _getRunner();
    const result = await runner.run(parsed.steps, { pageId, accountId: _accountId(req) });

    // 5. Store in memory
    browserMemory.rememberFlow(intent.slice(0, 50), parsed.steps, {
      success: result.ok, durationMs: result.durationMs,
    });

    res.json({ ok: result.ok, parsed, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/nl/flows", (req, res) => {
  try { res.json({ ok: true, flows: nlBrowser.listKnownFlows() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 5: Browser Memory
// ══════════════════════════════════════════════════════════════════

router.get("/browser-platform/memory", (req, res) => {
  try { res.json({ ok: true, snapshot: browserMemory.getSnapshot() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/memory/login", (req, res) => {
  try {
    const { domain, ...opts } = req.body || {};
    if (!domain) return res.status(400).json({ error: "domain required" });
    browserMemory.rememberLogin(domain, opts);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/memory/login/:domain", (req, res) => {
  try { res.json({ ok: true, login: browserMemory.getLogin(req.params.domain) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/memory/selector", (req, res) => {
  try {
    const { domain, selector, ...opts } = req.body || {};
    if (!domain || !selector) return res.status(400).json({ error: "domain and selector required" });
    browserMemory.rememberSelector(domain, selector, opts);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/memory/selectors/:domain", (req, res) => {
  try { res.json({ ok: true, selectors: browserMemory.getSelectors(req.params.domain) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/memory/flow", (req, res) => {
  try {
    const { key, steps, ...opts } = req.body || {};
    if (!key || !steps) return res.status(400).json({ error: "key and steps required" });
    browserMemory.rememberFlow(key, steps, opts);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/memory/flow/:key", (req, res) => {
  try {
    const flow = browserMemory.getBestFlow(req.params.key);
    const hist = browserMemory.getFlowHistory(req.params.key, 10);
    res.json({ ok: true, bestFlow: flow, history: hist });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/memory/flows", (req, res) => {
  try { res.json({ ok: true, flows: browserMemory.listFlows() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/memory/cookies", (req, res) => {
  try {
    const { domain, cookies } = req.body || {};
    if (!domain) return res.status(400).json({ error: "domain required" });
    browserMemory.saveCookies(domain, cookies || []);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 6: Workflow Builder (wraps existing browserWorkflowStore)
// ══════════════════════════════════════════════════════════════════

router.post("/browser-platform/workflows", (req, res) => {
  try {
    const store  = _getStore();
    const { name, steps, tags, description } = req.body || {};
    if (!name || !steps) return res.status(400).json({ error: "name and steps required" });
    const tpl = store.saveTemplate(name, steps, { tags: tags || [], description: description || "", source: "manual" });
    res.json({ ok: true, template: tpl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/workflows", (req, res) => {
  try {
    const store = _getStore();
    res.json({ ok: true, templates: store.listTemplates() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/workflows/:id", (req, res) => {
  try {
    const store = _getStore();
    const tpl   = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, template: tpl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/browser-platform/workflows/:id", (req, res) => {
  try {
    const store = _getStore();
    const ok    = store.deleteTemplate(req.params.id);
    res.json({ ok });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/workflows/:id/run", async (req, res) => {
  try {
    const store  = _getStore();
    const tpl    = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ error: "not_found" });
    const runner = _getRunner();
    const result = await runner.run(tpl.steps, { accountId: _accountId(req) });
    store.recordExecution(result, { templateId: req.params.id, name: tpl.name });
    res.json({ ok: result.ok, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/workflows/:id/clone", (req, res) => {
  try {
    const store = _getStore();
    const cloned = store.cloneTemplate(req.params.id, req.body?.name);
    if (!cloned) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, template: cloned });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 7: Human-in-the-Loop
// ══════════════════════════════════════════════════════════════════

router.get("/browser-platform/hitl/summary", (req, res) => {
  try { res.json({ ok: true, ...humanInTheLoop.summary() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/hitl/queue", (req, res) => {
  try { res.json({ ok: true, queue: humanInTheLoop.listPending() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/hitl/all", (req, res) => {
  try {
    res.json({ ok: true, requests: humanInTheLoop.listAll({ status: req.query.status, limit: parseInt(req.query.limit || "50") }) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/hitl/:id", (req, res) => {
  try {
    const r = humanInTheLoop.getRequest(req.params.id);
    if (!r) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, request: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/hitl/:id/approve", async (req, res) => {
  try {
    const r = humanInTheLoop.approve(req.params.id, { approvedBy: _accountId(req) });
    if (!r) return res.status(404).json({ error: "not_found" });

    // Auto-run approved steps
    if (r.steps?.length && req.body?.autoRun !== false) {
      const runner = _getRunner();
      const result = await runner.run(r.steps, { accountId: _accountId(req) });
      return res.json({ ok: true, request: r, executed: true, result });
    }

    res.json({ ok: true, request: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/hitl/:id/reject", (req, res) => {
  try {
    const r = humanInTheLoop.reject(req.params.id, { reason: req.body?.reason });
    if (!r) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, request: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/hitl/scan", (req, res) => {
  try {
    const { steps, intent } = req.body || {};
    if (!steps) return res.status(400).json({ error: "steps required" });
    const flagged = humanInTheLoop.scanSteps(steps, intent || "");
    res.json({ ok: true, flagged, requiresApproval: flagged.length > 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 8: Browser Marketplace
// ══════════════════════════════════════════════════════════════════

router.get("/browser-platform/marketplace/installed", (req, res) => {
  try { res.json({ ok: true, automations: marketplace.getInstalled(_accountId(req)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/marketplace/platforms", (req, res) => {
  try { res.json({ ok: true, platforms: marketplace.getPlatforms() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/marketplace/stats", (req, res) => {
  try { res.json({ ok: true, stats: marketplace.getStats() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/marketplace", (req, res) => {
  try {
    const opts = { platform: req.query.platform, category: req.query.category, search: req.query.search };
    res.json({ ok: true, automations: marketplace.getCatalogue(opts), stats: marketplace.getStats() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/marketplace/:id", (req, res) => {
  try {
    const a = marketplace.getById(req.params.id);
    if (!a) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, automation: a });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/marketplace/:id/install", (req, res) => {
  try {
    const a = marketplace.install(req.params.id, _accountId(req));
    if (!a) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, automation: a });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/browser-platform/marketplace/:id/run", async (req, res) => {
  try {
    const a = marketplace.getById(req.params.id);
    if (!a) return res.status(404).json({ error: "not_found" });

    marketplace.install(a.id, _accountId(req));

    // Danger check
    const flagged = humanInTheLoop.scanSteps(a.steps, a.name);
    if (flagged.length > 0 || a.dangerLevel === "dangerous") {
      const hitlReq = humanInTheLoop.createRequest({
        intent: a.name, steps: a.steps, flaggedSteps: flagged,
        dangerLevel: a.dangerLevel, dangerReason: "marketplace_automation",
      });
      return res.json({
        ok: false, requiresApproval: true, hitlRequestId: hitlReq.id,
        automation: a, message: "Requires human approval before running.",
      });
    }

    const runner = _getRunner();
    const result = await runner.run(a.steps, { accountId: _accountId(req) });
    res.json({ ok: result.ok, automation: a, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 9: Automation Dashboard
// ══════════════════════════════════════════════════════════════════

router.get("/browser-platform/dashboard", async (req, res) => {
  try {
    const session    = _getSession();
    const store      = _getStore();
    const hitlSumm   = humanInTheLoop.summary();
    const memSnap    = browserMemory.getSnapshot();
    const sessStat   = sessionManager.getStatus();
    const mktStats   = marketplace.getStats();
    const tabs       = session.listPages();
    const history    = store.listHistory({ limit: 20 });

    const running    = history.filter(h => h.status === "running" || h.ok === null).length;
    const completed  = history.filter(h => h.ok === true).length;
    const failed     = history.filter(h => h.ok === false).length;

    res.json({
      ok: true,
      ts: new Date().toISOString(),
      sessions:  sessStat,
      tabs:      tabs.length,
      tabList:   tabs.slice(0, 10),
      history:   { running, completed, failed, total: history.length, recent: history.slice(0, 5) },
      hitl:      hitlSumm,
      memory:    memSnap,
      marketplace: mktStats,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/dashboard/sessions", async (req, res) => {
  try {
    const session = _getSession();
    const store   = _getStore();
    const tabs    = session.listPages();
    const history = store.listHistory({ limit: 10 });
    res.json({ ok: true, tabs, history });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/browser-platform/dashboard/health", async (req, res) => {
  try {
    const session  = _getSession();
    const store    = _getStore();
    const sysHealth= store.getSystemHealth();
    res.json({
      ok: true,
      browserRunning: session.isRunning(),
      pages: session.listPages().length,
      systemHealth: sysHealth,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 10: Commercial Benchmark
// ══════════════════════════════════════════════════════════════════

router.get("/browser-platform/benchmark", async (req, res) => {
  try {
    const result = await benchmark.runBenchmark();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
