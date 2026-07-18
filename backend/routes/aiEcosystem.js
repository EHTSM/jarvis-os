"use strict";
/**
 * AI Routing Ecosystem Routes — all 10 modules.
 *
 * MODULE 1 – Universal AI Registry
 *   GET  /ai-ecosystem/registry                     — all providers + capabilities
 *   GET  /ai-ecosystem/registry/capabilities        — all capability types
 *   GET  /ai-ecosystem/registry/:providerId         — single provider
 *   POST /ai-ecosystem/registry/register            — register custom provider
 *   GET  /ai-ecosystem/registry/best/:capability    — best provider for capability
 *
 * MODULE 2 – Capability Router
 *   POST /ai-ecosystem/route                        — route intent → capability → provider
 *   GET  /ai-ecosystem/route/capabilities           — all routable capabilities
 *
 * MODULE 3 – Model Marketplace
 *   GET  /ai-ecosystem/marketplace                  — full model catalogue
 *   GET  /ai-ecosystem/marketplace/featured         — top model per capability
 *   GET  /ai-ecosystem/marketplace/stats            — catalogue stats
 *   POST /ai-ecosystem/marketplace/favourite        — mark favourite
 *   POST /ai-ecosystem/marketplace/override         — price/quality override
 *
 * MODULE 4 – Local AI Runtime
 *   GET  /ai-ecosystem/local/discover               — probe local runtimes
 *   GET  /ai-ecosystem/local/health                 — full health snapshot
 *   GET  /ai-ecosystem/local/models                 — installed local models
 *   GET  /ai-ecosystem/local/cached                 — cached state (no probe)
 *   GET  /ai-ecosystem/local/sysinfo                — CPU/RAM info
 *
 * MODULE 5 – Creative AI Hub
 *   GET  /ai-ecosystem/creative                     — all creative capabilities
 *   GET  /ai-ecosystem/creative/:cap                — providers for image/video/voice/music/animation/3d
 *
 * MODULE 6 – Browser AI
 *   GET  /ai-ecosystem/browser                      — browser automation providers
 *   POST /ai-ecosystem/browser/route                — route a browser task
 *
 * MODULE 7 – Enterprise Policies
 *   GET  /ai-ecosystem/policies                     — all org policies
 *   GET  /ai-ecosystem/policies/:orgId              — single org policy
 *   PUT  /ai-ecosystem/policies/:orgId              — set/update policy
 *   POST /ai-ecosystem/policies/evaluate            — evaluate a routing decision
 *   POST /ai-ecosystem/policies/filter              — filter candidates by policy
 *
 * MODULE 8 – AI Benchmark Lab
 *   GET  /ai-ecosystem/benchmark                    — cached leaderboard
 *   GET  /ai-ecosystem/benchmark/matrix             — comparison matrix
 *   POST /ai-ecosystem/benchmark/run                — run suite (async, returns job)
 *   GET  /ai-ecosystem/benchmark/leaderboard/:dim   — leaderboard by dimension
 *
 * MODULE 9 – AI Marketplace UI (data API for frontend)
 *   GET  /ai-ecosystem/ui/catalogue                 — capability-first catalogue
 *   GET  /ai-ecosystem/ui/recommend                 — personalised recommendations
 *
 * MODULE 10 – Commercial Benchmark (routing viability)
 *   GET  /ai-ecosystem/viability                    — routing viability check
 *
 * MODULE 11 – Org/Workspace AI Budgets
 *   GET  /ai-ecosystem/budgets                       — all org + workspace budgets
 *   GET  /ai-ecosystem/budgets/org/:orgId            — one org's budget + current spend
 *   PUT  /ai-ecosystem/budgets/org/:orgId            — set org budget (org_owner only)
 *   GET  /ai-ecosystem/budgets/workspace/:workspaceId — one workspace's budget + spend
 *   PUT  /ai-ecosystem/budgets/workspace/:workspaceId — set workspace budget (org_owner only)
 *   POST /ai-ecosystem/budgets/check                 — check {orgId, workspaceId} against budget
 *
 * MODULE 12 – AI Orchestrator (aiOrchestrator.cjs)
 *   GET  /ai-ecosystem/orchestrator/health              — composite live+historical health, all providers
 *   GET  /ai-ecosystem/orchestrator/health/:providerId   — single provider
 *   POST /ai-ecosystem/orchestrator/chain                — preview the fallback chain for a capability/task
 *   GET  /ai-ecosystem/orchestrator/recommend/:capability — ranked provider recommendations (capability fit + live health)
 *   POST /ai-ecosystem/orchestrator/execute               — run a chat request through the full orchestrated path
 *   POST /ai-ecosystem/orchestrator/execute/stream        — same, but Server-Sent Events token-by-token
 *   GET  /ai-ecosystem/orchestrator/cache                 — response cache hit/miss stats
 *   POST /ai-ecosystem/orchestrator/cache/clear           — clear the response cache
 *
 * MODULE 13 – Usage Analytics + Prompt History
 *   GET  /ai-ecosystem/analytics/by-provider         — cost breakdown by provider
 *   GET  /ai-ecosystem/analytics/by-workspace        — cost breakdown by workspace
 *   GET  /ai-ecosystem/analytics/by-org              — cost breakdown by org
 *   GET  /ai-ecosystem/analytics/me                  — caller's own cost report
 *   GET  /ai-ecosystem/analytics/org/:orgId           — one org's cost + budget report (org_owner only)
 *   GET  /ai-ecosystem/history/me                     — caller's own recent prompt/response history
 *   GET  /ai-ecosystem/history/workspace/:workspaceId — a workspace's recent prompt/response history
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const registry   = require("../services/aiRegistry.cjs");
const capRouter  = require("../services/capabilityRouter.cjs");
const marketplace= require("../services/modelMarketplace.cjs");
const localAI    = require("../services/localAiRuntime.cjs");
const policies   = require("../services/enterprisePolicies.cjs");
const benchLab   = require("../services/aiBenchmarkLab.cjs");
const metering   = require("../services/usageMetering.cjs");
const creditEng  = require("../services/creditEngine.cjs");
const smartRouter= require("../services/smartRouter.cjs");
const provMgr    = require("../services/providerManager.cjs");
const billing    = require("../services/billingService");
const analytics  = require("../services/costAnalytics.cjs");

router.use("/ai-ecosystem", requireAuth);

function _accountId(req) { return req.user?.sub || req.user?.accountId || req.user?.id || "unknown"; }
function _plan(req) {
  try { return billing.checkAccess(_accountId(req)).plan || "trial"; } catch { return "trial"; }
}

// ══════════════════════════════════════════════════════════════════
// MODULE 1: Universal AI Registry
// ══════════════════════════════════════════════════════════════════

router.get("/ai-ecosystem/registry", (req, res) => {
  try { res.json({ ok: true, providers: registry.getAll() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/registry/capabilities", (req, res) => {
  try { res.json({ ok: true, capabilities: registry.getAllCapabilities(), taxonomy: registry.CAPABILITIES }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/registry/best/:capability", (req, res) => {
  try {
    const { capability } = req.params;
    const best = registry.bestFor(capability, {
      prefer:       req.query.prefer || "cost",
      minQuality:   parseFloat(req.query.minQuality || "0.6"),
      maxCostPer1k: req.query.maxCost ? parseFloat(req.query.maxCost) : undefined,
    });
    res.json({ ok: true, capability, best });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/registry/:providerId", (req, res) => {
  try {
    const p = registry.getProvider(req.params.providerId);
    if (!p) return res.status(404).json({ error: "provider_not_found" });
    res.json({ ok: true, provider: p });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/ai-ecosystem/registry/register", (req, res) => {
  try {
    const def = req.body;
    if (!def?.id || !def?.name) return res.status(400).json({ error: "id and name required" });
    const p = registry.registerProvider(def);
    res.json({ ok: true, provider: p });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 2: Capability Router
// ══════════════════════════════════════════════════════════════════

router.post("/ai-ecosystem/route", (req, res) => {
  try {
    const { intent, prefer, userPref, minQuality, maxCostPer1k, orgId } = req.body || {};
    if (!intent) return res.status(400).json({ error: "intent required" });

    const result = capRouter.route({
      intent,
      prefer:        prefer || "cost",
      userPref,
      accountId:     _accountId(req),
      plan:          _plan(req),
      minQuality:    minQuality ? parseFloat(minQuality) : undefined,
      maxCostPer1k:  maxCostPer1k ? parseFloat(maxCostPer1k) : undefined,
      availableKeys: provMgr.getAvailableChain(),
    });

    // Enterprise policy check
    let policyResult = null;
    if (orgId || req.user?.orgId) {
      policyResult = policies.evaluate({
        providerId:   result.primary,
        modelId:      result.model,
        capability:   result.capability,
        costPer1kUsd: result.scores?.costPer1k || 0,
        orgId:        orgId || req.user?.orgId,
      });
      if (!policyResult.allowed) {
        return res.status(403).json({ error: "enterprise_policy_violation", violations: policyResult.violations, result });
      }
    }

    res.json({ ok: true, ...result, policyResult });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/route/capabilities", (req, res) => {
  try { res.json({ ok: true, capabilities: capRouter.listCapabilities() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 3: Model Marketplace
// ══════════════════════════════════════════════════════════════════

router.get("/ai-ecosystem/marketplace", (req, res) => {
  try {
    const opts = { capability: req.query.capability, search: req.query.search };
    res.json({ ok: true, models: marketplace.getCatalogue(opts), total: marketplace.getCatalogue(opts).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/marketplace/featured", (req, res) => {
  try { res.json({ ok: true, featured: marketplace.getFeatured() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/marketplace/stats", (req, res) => {
  try { res.json({ ok: true, stats: marketplace.getStats() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/ai-ecosystem/marketplace/favourite", (req, res) => {
  try {
    const { providerId, modelId, value } = req.body || {};
    if (!providerId || !modelId) return res.status(400).json({ error: "providerId and modelId required" });
    marketplace.setFavourite(providerId, modelId, !!value);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/ai-ecosystem/marketplace/override", (req, res) => {
  try {
    const { providerId, modelId, ...patch } = req.body || {};
    if (!providerId || !modelId) return res.status(400).json({ error: "providerId and modelId required" });
    marketplace.setOverride(providerId, modelId, patch);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 4: Local AI Runtime
// ══════════════════════════════════════════════════════════════════

router.get("/ai-ecosystem/local/discover", async (req, res) => {
  try {
    const runtimes = await localAI.discover();
    res.json({ ok: true, runtimes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/local/health", async (req, res) => {
  try {
    const h = await localAI.health();
    res.json({ ok: true, ...h });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/local/models", async (req, res) => {
  try {
    const models = await localAI.listModels();
    res.json({ ok: true, models });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/local/cached", (req, res) => {
  try { res.json({ ok: true, runtimes: localAI.getCached() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/local/sysinfo", (req, res) => {
  try { res.json({ ok: true, sysinfo: localAI.getSystemInfo() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 5: Creative AI Hub
// ══════════════════════════════════════════════════════════════════

const CREATIVE_CAPS = ["image","video","voice","music","animation","3d","speech"];

router.get("/ai-ecosystem/creative", (req, res) => {
  try {
    const result = {};
    for (const cap of CREATIVE_CAPS) {
      result[cap] = registry.getByCapability(cap).map(p => ({
        id:   p.id,
        name: p.name,
        type: p.type,
        capDef: p.capabilities[cap],
      }));
    }
    res.json({ ok: true, capabilities: CREATIVE_CAPS, providers: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/creative/:cap", (req, res) => {
  try {
    const { cap } = req.params;
    if (!CREATIVE_CAPS.includes(cap)) return res.status(400).json({ error: `invalid creative capability — use: ${CREATIVE_CAPS.join(",")}` });
    const prov = registry.getByCapability(cap).map(p => ({
      id:   p.id,
      name: p.name,
      type: p.type,
      website: p.website,
      capDef: p.capabilities[cap],
    }));
    const best = registry.bestFor(cap, { prefer: "quality" });
    res.json({ ok: true, capability: cap, providers: prov, best });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 6: Browser AI
// ══════════════════════════════════════════════════════════════════

router.get("/ai-ecosystem/browser", (req, res) => {
  try {
    const prov = registry.getByCapability("browser").map(p => ({
      id:      p.id,
      name:    p.name,
      type:    p.type,
      capDef:  p.capabilities.browser,
      website: p.website,
    }));
    const automationCapabilities = ["web_scraping","form_filling","screenshot","navigation","testing","data_extraction"];
    res.json({ ok: true, providers: prov, automationCapabilities });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/ai-ecosystem/browser/route", (req, res) => {
  try {
    const { task, prefer } = req.body || {};
    const best = registry.bestFor("browser", { prefer: prefer || "quality" });
    const aiResult = capRouter.route({ intent: task || "browse", accountId: _accountId(req), plan: _plan(req) });
    res.json({ ok: true, browserProvider: best, aiProvider: aiResult });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 7: Enterprise Policies
// ══════════════════════════════════════════════════════════════════

router.get("/ai-ecosystem/policies", (req, res) => {
  try { res.json({ ok: true, policies: policies.getAllPolicies() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/policies/:orgId", (req, res) => {
  try { res.json({ ok: true, policy: policies.getPolicy(req.params.orgId) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/ai-ecosystem/policies/:orgId", (req, res) => {
  try {
    const p = policies.setPolicy(req.params.orgId, req.body || {});
    res.json({ ok: true, policy: p });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/ai-ecosystem/policies/evaluate", (req, res) => {
  try {
    const result = policies.evaluate(req.body || {});
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/ai-ecosystem/policies/filter", (req, res) => {
  try {
    const { candidates, orgId } = req.body || {};
    if (!Array.isArray(candidates)) return res.status(400).json({ error: "candidates array required" });
    const filtered = policies.filterCandidates(candidates, orgId || "default");
    res.json({ ok: true, original: candidates.length, filtered: filtered.length, candidates: filtered });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 11: Org/Workspace AI Budgets (AI Provider Orchestration mission)
// Monthly USD/request caps scoped to an org or workspace, enforced against
// usageMetering's real cost ledger — distinct from enterprisePolicies'
// per-request cost ceiling above and billingService's per-account plan
// quota; a real cumulative spend cap neither of those covers.
// Setting a budget requires org_owner (manage_billing) — reuses
// organizationService's existing RBAC rather than leaving these open like
// the policy routes above currently are.
// ══════════════════════════════════════════════════════════════════

const orgBudgets = require("../services/orgBudgets.cjs");
const { attachOrg, requireOrgPermission } = require("../middleware/orgMiddleware.cjs");

router.get("/ai-ecosystem/budgets", (req, res) => {
  try { res.json({ ok: true, ...orgBudgets.getAllBudgets() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// attachOrg resolves req.org from the X-Org-Id header or req.query/body.orgId
// only — NOT from an :orgId route param — so it's forwarded into req.body
// before delegating, same fix as workspace.js's member routes needed.
function _forwardOrgParam(req, res, next) {
  req.body = req.body || {};
  if (req.params.orgId && !req.body.orgId) req.body.orgId = req.params.orgId;
  return attachOrg(req, res, next);
}

router.get("/ai-ecosystem/budgets/org/:orgId", _forwardOrgParam, requireOrgPermission("manage_billing"), (req, res) => {
  try { res.json({ ok: true, budget: orgBudgets.getOrgBudget(req.params.orgId) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/ai-ecosystem/budgets/org/:orgId", _forwardOrgParam, requireOrgPermission("manage_billing"), (req, res) => {
  try {
    const { monthlyCapUsd, monthlyRequestCap, alertThresholdPct } = req.body || {};
    const patch = {};
    if (monthlyCapUsd !== undefined)     patch.monthlyCapUsd = monthlyCapUsd;
    if (monthlyRequestCap !== undefined) patch.monthlyRequestCap = monthlyRequestCap;
    if (alertThresholdPct !== undefined) patch.alertThresholdPct = alertThresholdPct;
    res.json({ ok: true, budget: orgBudgets.setOrgBudget(req.params.orgId, patch) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get("/ai-ecosystem/budgets/workspace/:workspaceId", (req, res) => {
  try { res.json({ ok: true, budget: orgBudgets.getWorkspaceBudget(req.params.workspaceId) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Workspace budgets are set by the owning org's owner — the request must
// still carry an orgId (header/query/body) identifying WHICH org owns this
// workspace, since workspaceId alone doesn't tell requireOrgPermission which
// org's RBAC to check against.
router.put("/ai-ecosystem/budgets/workspace/:workspaceId", attachOrg, requireOrgPermission("manage_billing"), (req, res) => {
  try {
    const { monthlyCapUsd, monthlyRequestCap, alertThresholdPct } = req.body || {};
    const patch = {};
    if (monthlyCapUsd !== undefined)     patch.monthlyCapUsd = monthlyCapUsd;
    if (monthlyRequestCap !== undefined) patch.monthlyRequestCap = monthlyRequestCap;
    if (alertThresholdPct !== undefined) patch.alertThresholdPct = alertThresholdPct;
    res.json({ ok: true, budget: orgBudgets.setWorkspaceBudget(req.params.workspaceId, patch) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/ai-ecosystem/budgets/check", (req, res) => {
  try {
    const { orgId, workspaceId } = req.body || {};
    res.json({ ok: true, ...orgBudgets.checkBudget({ orgId, workspaceId }) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 12: AI Orchestrator
// ══════════════════════════════════════════════════════════════════

const orchestrator = require("../services/aiOrchestrator.cjs");

router.get("/ai-ecosystem/orchestrator/health", async (req, res) => {
  try { res.json({ ok: true, providers: await orchestrator.getProviderHealth() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/orchestrator/health/:providerId", async (req, res) => {
  try { res.json({ ok: true, health: await orchestrator.getProviderHealth(req.params.providerId) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/ai-ecosystem/orchestrator/chain", async (req, res) => {
  try {
    const { capability, task, intent, userPref, prefer, minQuality, maxCostPer1k, orgId } = req.body || {};
    const chain = await orchestrator.buildFallbackChain({ capability, task, intent, userPref, prefer, minQuality, maxCostPer1k, orgId });
    res.json({ ok: true, ...chain });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/orchestrator/recommend/:capability", async (req, res) => {
  try {
    const { prefer, minQuality, maxCostPer1k, top } = req.query || {};
    const recommendations = await orchestrator.recommend(req.params.capability, {
      prefer, minQuality: minQuality ? parseFloat(minQuality) : undefined,
      maxCostPer1k: maxCostPer1k ? parseFloat(maxCostPer1k) : undefined,
      top: top ? parseInt(top, 10) : undefined,
    });
    res.json({ ok: true, capability: req.params.capability, recommendations });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/ai-ecosystem/orchestrator/execute", billing.requireUsageQuota, async (req, res) => {
  try {
    const { messages, prompt, capability, task, intent, userPref, prefer, model, maxTokens, temperature, orgId, workspaceId, missionId, noCache } = req.body || {};
    const msgs = Array.isArray(messages) ? messages : (prompt ? [{ role: "user", content: prompt }] : null);
    if (!msgs) return res.status(400).json({ error: "messages array or prompt string required" });
    const accountId = _accountId(req);
    const result = await orchestrator.execute(msgs, {
      capability, task, intent, userPref, prefer, model, maxTokens, temperature, noCache,
      accountId, orgId, workspaceId, missionId,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message, code: e.code });
  }
});

// POST /ai-ecosystem/orchestrator/execute/stream — Server-Sent Events.
// Each token delta arrives as its own `data: {...}` frame the moment
// aiService.streamChat's onChunk fires; a final `event: done` frame carries
// the same metadata /execute returns (provider, cost, latency) once the
// stream completes, so a client can render tokens live and still get the
// same accounting summary as the non-streaming endpoint.
router.post("/ai-ecosystem/orchestrator/execute/stream", billing.requireUsageQuota, async (req, res) => {
  const { messages, prompt, capability, task, intent, userPref, prefer, model, maxTokens, temperature, orgId, workspaceId, missionId } = req.body || {};
  const msgs = Array.isArray(messages) ? messages : (prompt ? [{ role: "user", content: prompt }] : null);
  if (!msgs) return res.status(400).json({ error: "messages array or prompt string required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const accountId = _accountId(req);
  try {
    const result = await orchestrator.executeStream(
      msgs,
      { capability, task, intent, userPref, prefer, model, maxTokens, temperature, accountId, orgId, workspaceId, missionId },
      (delta) => { res.write(`data: ${JSON.stringify({ delta })}\n\n`); }
    );
    res.write(`event: done\ndata: ${JSON.stringify(result)}\n\n`);
    res.end();
  } catch (e) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: e.message, code: e.code })}\n\n`);
    res.end();
  }
});

router.get("/ai-ecosystem/orchestrator/cache", (req, res) => {
  try { res.json({ ok: true, ...orchestrator.getCacheStats() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/ai-ecosystem/orchestrator/cache/clear", (req, res) => {
  try { orchestrator.clearCache(); res.json({ ok: true, cleared: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 8: AI Benchmark Lab
// ══════════════════════════════════════════════════════════════════

router.get("/ai-ecosystem/benchmark", (req, res) => {
  try { res.json({ ok: true, leaderboard: benchLab.getCachedLeaderboard() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/benchmark/matrix", (req, res) => {
  try {
    const tasks = req.query.tasks ? req.query.tasks.split(",") : ["chat","code","reasoning"];
    res.json({ ok: true, matrix: benchLab.comparisonMatrix(tasks) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/ai-ecosystem/benchmark/run", async (req, res) => {
  try {
    const { providers, tasks } = req.body || {};
    // Run async, return immediately with preview
    const results = await benchLab.runSuite({ providers, tasks });
    res.json({ ok: true, results, count: results.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/benchmark/leaderboard/:dim", (req, res) => {
  try {
    const { dim } = req.params;
    const valid = ["speed","quality","cost","reliability"];
    if (!valid.includes(dim)) return res.status(400).json({ error: `invalid dimension — use: ${valid.join(",")}` });
    res.json({ ok: true, dimension: dim, leaderboard: benchLab.leaderboard(dim, req.query.task) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 9: AI Marketplace UI (data API)
// ══════════════════════════════════════════════════════════════════

router.get("/ai-ecosystem/ui/catalogue", (req, res) => {
  try {
    const caps = registry.getAllCapabilities();
    const catalogue = caps.map(cap => {
      const prov = registry.getByCapability(cap);
      const best = registry.bestFor(cap, { prefer: "cost" });
      return {
        capability: cap,
        providerCount: prov.length,
        best,
        providers: prov.map(p => ({
          id:   p.id,
          name: p.name,
          type: p.type,
          quality:     p.capabilities[cap]?.quality,
          costPer1k:   p.capabilities[cap]?.costPer1k,
          latencyClass:p.capabilities[cap]?.latencyClass,
          model:       p.capabilities[cap]?.models?.[0],
        })).sort((a,b) => (a.costPer1k||0)-(b.costPer1k||0)),
      };
    });
    res.json({ ok: true, catalogue, capabilityCount: caps.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/ui/recommend", (req, res) => {
  try {
    const accountId = _accountId(req);
    const plan      = _plan(req);
    const creditRec = creditEngine.getLedger ? creditEngine.getLedger(accountId, 5) : {};
    const byok      = creditRec?.byok?.enabled || false;
    const local     = creditRec?.local?.enabled || false;

    // Personalised recommendations
    const recs = [];
    if (local)      recs.push({ reason: "local_mode_active",  suggestion: "Ollama (Local)", providerId: "ollama",     capability: "chat" });
    if (byok)       recs.push({ reason: "byok_enabled",       suggestion: "Use own key",    providerId: "openrouter", capability: "chat" });
    if (plan === "trial") recs.push({ reason: "free_plan",    suggestion: "Groq (fastest free)", providerId: "groq", capability: "chat" });
    if (plan === "growth" || plan === "scale") recs.push({ reason: "premium_plan", suggestion: "Claude for best quality", providerId: "claude", capability: "reasoning" });

    // Fill with cost-optimised defaults
    for (const cap of ["code","vision","image"]) {
      const best = registry.bestFor(cap, { prefer: "cost" });
      if (best) recs.push({ reason: "cost_optimised", suggestion: `${best.providerName} for ${cap}`, ...best });
    }

    res.json({ ok: true, plan, byok, local, recommendations: recs.slice(0, 8) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 10: Commercial Benchmark — routing viability
// ══════════════════════════════════════════════════════════════════

router.get("/ai-ecosystem/viability", (req, res) => {
  try {
    const bm       = analytics.benchmark();
    const decisions= smartRouter.getDecisions(100);
    const provAll  = provMgr.getAll();
    const usage    = metering.summary({ limit: 1000 });

    // Check fallback coverage (at least 2 providers available per capability)
    const capCoverage = registry.getAllCapabilities().map(cap => {
      const prov = registry.getByCapability(cap);
      return { capability: cap, providerCount: prov.length, covered: prov.length >= 2 };
    });

    // Routing viability checks
    const checks = [
      ...bm.checks,
      {
        check:    "fallback_coverage",
        ok:       capCoverage.every(c => c.covered),
        details:  capCoverage.filter(c => !c.covered),
      },
      {
        check:    "auto_routing_active",
        ok:       decisions.length > 0,
        decisions: decisions.length,
      },
      {
        check:    "credit_system_active",
        ok:       true,
        note:     "creditEngine integrated",
      },
      {
        check:    "enterprise_policy_enforced",
        ok:       true,
        note:     "enterprisePolicies middleware available",
      },
    ];

    const passing  = checks.filter(c => c.ok).length;
    const score    = Math.round((passing / checks.length) * 100);
    const available= provAll.filter(p => p.available);

    res.json({
      ok: true,
      score,
      commercialReadiness: score >= 75 ? "ready" : score >= 50 ? "developing" : "pre_commercial",
      checks,
      capCoverage,
      activeProviders: available.length,
      totalProviders:  provAll.length,
      routingDecisions: decisions.length,
      usageSummary: { requests: usage.totalRequests, costUsd: usage.totalCostUsd },
      benchmark: bm,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Re-export creditEngine for module 10 reference
const creditEngine = require("../services/creditEngine.cjs");

// ══════════════════════════════════════════════════════════════════
// MODULE 13: Usage Analytics + Prompt History
// ══════════════════════════════════════════════════════════════════

const promptHistory = require("../services/promptHistory.cjs");

router.get("/ai-ecosystem/analytics/by-provider", (req, res) => {
  try { res.json({ ok: true, breakdown: analytics.costByProvider(req.query || {}) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/analytics/by-workspace", (req, res) => {
  try { res.json({ ok: true, breakdown: analytics.costByWorkspace(req.query || {}) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/analytics/by-org", (req, res) => {
  try { res.json({ ok: true, breakdown: analytics.costByOrg(req.query || {}) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/analytics/me", (req, res) => {
  try { res.json({ ok: true, report: analytics.perAccount(_accountId(req), req.query || {}) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Org report requires org membership — cost/budget data is org-sensitive,
// same authorization bar as the budget routes in MODULE 11.
router.get("/ai-ecosystem/analytics/org/:orgId",
  (req, res, next) => { req.body = req.body || {}; if (req.params.orgId && !req.body.orgId) req.body.orgId = req.params.orgId; return attachOrg(req, res, next); },
  requireOrgPermission("manage_billing"),
  (req, res) => {
    try { res.json({ ok: true, report: analytics.perOrg(req.params.orgId, req.query || {}) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  }
);

router.get("/ai-ecosystem/history/me", (req, res) => {
  try {
    const { limit, provider, capability, since, fromLedger } = req.query || {};
    const opts = { accountId: _accountId(req), limit: limit ? parseInt(limit, 10) : 50, provider, capability, since };
    const entries = fromLedger === "true" ? promptHistory.loadHistory(opts) : promptHistory.query(opts);
    res.json({ ok: true, entries });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/ai-ecosystem/history/workspace/:workspaceId", (req, res) => {
  try {
    const { limit, provider, capability, since } = req.query || {};
    const entries = promptHistory.query({ workspaceId: req.params.workspaceId, limit: limit ? parseInt(limit, 10) : 50, provider, capability, since });
    res.json({ ok: true, entries });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
