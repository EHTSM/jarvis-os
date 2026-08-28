"use strict";
/**
 * Phase 18 routes — Runtime Execution Layer
 *
 * 18A  POST   /p18/actions/execute          execute action now
 *      POST   /p18/actions/queue            queue action async
 *      POST   /p18/actions/:id/retry        retry action
 *      DELETE /p18/actions/:id              cancel action
 *      GET    /p18/actions                  list actions
 *      GET    /p18/actions/:id              get action
 *      GET    /p18/actions/audit            audit trail (tail of execLog)
 *
 * 18B  POST   /p18/agents/:agentId/execute  execute task for agent
 *      POST   /p18/agents/runs/:runId/retry retry a run
 *      GET    /p18/agents                   list agents + stats
 *      GET    /p18/agents/:agentId          agent profile + history
 *      GET    /p18/agents/:agentId/history  run history
 *      GET    /p18/agents/failures          all failure records
 *
 * 18C  POST   /p18/memory                   save memory node
 *      GET    /p18/memory                   list nodes
 *      GET    /p18/memory/stats             stats
 *      GET    /p18/memory/search            keyword search
 *      GET    /p18/memory/recall            agent context recall
 *      GET    /p18/memory/:nodeId           load node
 *      PATCH  /p18/memory/:nodeId           update node
 *      DELETE /p18/memory/:nodeId           archive node
 *
 * 18D  POST   /p18/cycles                   start autonomous cycle
 *      GET    /p18/cycles                   list cycles
 *      GET    /p18/cycles/stats             stats
 *      GET    /p18/cycles/learning          learning log
 *      GET    /p18/cycles/:cycleId          get cycle
 *      DELETE /p18/cycles/:cycleId          cancel cycle
 */

const router     = require("express").Router();
const { requireAuth, operatorOnly } = require("../middleware/authMiddleware");
const rae   = require("../services/runtimeActionEngine.cjs");
const aee   = require("../services/agentExecutionEngine.cjs");
const mpl   = require("../services/memoryPersistenceLayer.cjs");
const atl   = require("../services/autonomousTaskLoop.cjs");

router.use("/p18", requireAuth);

// ── 18A — Runtime Action Engine ──────────────────────────────────────────

router.post("/p18/actions/execute", async (req, res) => {
    const { input, type, timeoutMs, source } = req.body || {};
    if (!input) return res.status(400).json({ error: "input required" });
    try {
        const result = await rae.execute(input.slice(0, 2000), { type, timeoutMs, source });
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p18/actions/queue", (req, res) => {
    const { input, type, scheduledFor, recurringCron, maxRetries, source, metadata } = req.body || {};
    if (!input) return res.status(400).json({ error: "input required" });
    try {
        res.json({ success: true, ...rae.queue(input.slice(0, 2000), { type, scheduledFor, recurringCron, maxRetries, source, metadata }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p18/actions/:id/retry", (req, res) => {
    try {
        res.json({ success: true, ...rae.retry(req.params.id) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.delete("/p18/actions/:id", (req, res) => {
    try {
        res.json({ success: true, ...rae.cancel(req.params.id) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get("/p18/actions/audit", (req, res) => {
    const limit = Math.max(1, parseInt(req.query.limit) || 100);
    res.json({ success: true, ...rae.getAuditTrail({ limit }) });
});

router.get("/p18/actions", (req, res) => {
    const { status, type, limit, offset } = req.query;
    res.json({ success: true, ...rae.listActions({ status, type, limit: parseInt(limit)||50, offset: parseInt(offset)||0 }) });
});

router.get("/p18/actions/:id", (req, res) => {
    const action = rae.getAction(req.params.id);
    if (!action) return res.status(404).json({ error: "Action not found" });
    res.json({ success: true, action });
});

// ── 18B — Agent Execution Engine ─────────────────────────────────────────

router.post("/p18/agents/:agentId/execute", async (req, res) => {
    const { input, type, timeoutMs } = req.body || {};
    if (!input) return res.status(400).json({ error: "input required" });
    try {
        const result = await aee.executeTask(req.params.agentId, input.slice(0, 2000), { type, timeoutMs });
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p18/agents/runs/:runId/retry", async (req, res) => {
    try {
        const result = await aee.retryTask(req.params.runId);
        res.json({ success: true, ...result });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get("/p18/agents/failures", (req, res) => {
    const { agentId, limit } = req.query;
    res.json({ success: true, ...aee.getFailures(agentId, { limit: parseInt(limit)||50 }) });
});

router.get("/p18/agents/:agentId/history", (req, res) => {
    const { status, limit, offset } = req.query;
    res.json({ success: true, ...aee.getHistory(req.params.agentId, { status, limit: parseInt(limit)||50, offset: parseInt(offset)||0 }) });
});

router.get("/p18/agents/:agentId", (req, res) => {
    const agent = aee.getAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    res.json({ success: true, agent });
});

router.get("/p18/agents", (req, res) => {
    res.json({ success: true, agents: aee.listAgents() });
});

// ── 18C — Memory Persistence Layer ───────────────────────────────────────
//
// Memory / Knowledge Storage Authorization & Tenant-Isolation Audit
// (2026-08-21): mpl.save()/update()/archive() have zero orgId/ownership
// concept — memoryPersistenceLayer.cjs is genuinely shared platform
// operational memory, used internally by many autonomous systems
// (missionMemory.cjs, akoWorkflow.cjs, autonomousTaskLoop.cjs, etc. — not
// re-architected here, per this mission's explicit instruction). Live-
// reproduced: an unrelated, ordinary customer (org B) read, overwrote, and
// deleted another org's real memory node by ID with zero ownership check —
// unauthorized destructive mutation, not merely a read-sharing question.
// Whether the READ side (GET /p18/memory*) should remain customer-facing is
// a genuine, separate, already-documented DECISION REQUIRED product
// question (SharedMemoryCenter.jsx is a real, read-only customer feature
// consuming it) — deliberately left untouched here, not guessed at. The
// WRITE/UPDATE/DELETE side has no such legitimate consumer: MemoryCenter.jsx
// is the only frontend code that ever calls saveMemoryNode/updateMemoryNode/
// archiveMemoryNode, and it is not imported or rendered anywhere in App.jsx
// — confirmed dead, unreachable code, not a feature this fix could break.
// Fixed by gating the 3 mutation routes operatorOnly, the same established
// mechanism already used throughout this codebase for exactly this shape of
// gap.
//
// M-4 (2026-08-28): the READ side (GET /p18/memory*) is now scoped to the
// caller's own orgId, closing the "confirmed open P0" read half of M-4.
//
// Deliberately does NOT use attachOrg/req.org at all — attachOrg (see its
// own header comment) resolves req.org from ANY client-suppliable selector
// (X-Org-Id header / query / body orgId) with no membership check of its
// own ("Does NOT block requests"). A first attempt at this fix gated on
// req.orgRole (attachOrg's only real-membership-verified field) and still
// leaked: when a caller supplies an org they DON'T belong to, attachOrg's
// selector branch resolves req.org to that org but never falls back to the
// caller's own real org — so "not verified for the org I asked about"
// collapsed into "no org at all", which (correctly, for a genuinely orgless
// caller) shows the full shared/unscoped pool. That let a caller with a
// real home org bypass scoping entirely just by supplying someone ELSE's
// org id. Reproduced live while writing this mission's own regression test
// (tests/security/126-*, "header-based org spoofing" case).
//
// _ownOrgId() sidesteps the ambiguity by never trusting attachOrg's
// selector for this decision: it always independently resolves the
// caller's own real primary org straight from organizationService, the
// same pattern already used correctly by mission.js's
// /missions/orchestrator/create fix in this same mission. A client-supplied
// org selector can never influence this result in either direction.
function _ownOrgId(req) {
    const accountId = req.user?.sub;
    if (!accountId) return undefined;
    try {
        const ctx = require("../services/organizationService.cjs").resolveContext(accountId);
        return ctx?.primaryOrg?.orgId || undefined;
    } catch { return undefined; }
}

router.post("/p18/memory", operatorOnly, (req, res) => {
    const { key, value, type, tags, importance, confidence, agentIds, expiresAt } = req.body || {};
    if (!key) return res.status(400).json({ error: "key required" });
    try {
        res.json({ success: true, ...mpl.save({ key, value, type, tags, importance, confidence, agentIds, expiresAt, orgId: _ownOrgId(req) }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p18/memory/stats", (req, res) => {
    res.json({ success: true, stats: mpl.stats({ orgId: _ownOrgId(req) }) });
});

router.get("/p18/memory/search", (req, res) => {
    res.json({ success: true, ...mpl.search(req.query.q, { orgId: _ownOrgId(req) }) });
});

router.get("/p18/memory/recall", (req, res) => {
    const { agentId, input, limit } = req.query;
    res.json({ success: true, ...mpl.recall({ agentId, input, limit: parseInt(limit)||10, orgId: _ownOrgId(req) }) });
});

router.get("/p18/memory/:nodeId", (req, res) => {
    const node = mpl.load(req.params.nodeId);
    if (!node) return res.status(404).json({ error: "Node not found" });
    // Cross-tenant read guard: a node WITH an orgId must match the caller's
    // own VERIFIED org membership (same rule as list()/search()/recall()
    // above). A node with no orgId (the historical majority) remains
    // readable by any authenticated caller — unchanged.
    if (node.orgId && node.orgId !== _ownOrgId(req)) {
        return res.status(404).json({ error: "Node not found" });
    }
    res.json({ success: true, node });
});

router.patch("/p18/memory/:nodeId", operatorOnly, (req, res) => {
    const updated = mpl.update(req.params.nodeId, req.body);
    if (!updated) return res.status(404).json({ error: "Node not found" });
    res.json({ success: true, node: updated });
});

router.delete("/p18/memory/:nodeId", operatorOnly, (req, res) => {
    try {
        res.json({ success: true, ...mpl.archive(req.params.nodeId) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get("/p18/memory", (req, res) => {
    const { type, tag, minImportance, limit, offset, agentId } = req.query;
    res.json({ success: true, ...mpl.list({
        type, tag, agentId,
        minImportance: parseInt(minImportance)||0,
        limit:  parseInt(limit)||100,
        offset: parseInt(offset)||0,
        orgId:  _ownOrgId(req),
    }) });
});

// ── 18D — Autonomous Task Loop ───────────────────────────────────────────

router.post("/p18/cycles", (req, res) => {
    const { goal, goalType, source } = req.body || {};
    if (!goal) return res.status(400).json({ error: "goal required" });
    try {
        res.json({ success: true, ...atl.startCycle(goal.slice(0, 500), { goalType, source }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p18/cycles/stats", (req, res) => {
    res.json({ success: true, stats: atl.getStats() });
});

router.get("/p18/cycles/learning", (req, res) => {
    const { limit, agentId, event } = req.query;
    res.json({ success: true, ...atl.getLearningLog({ limit: parseInt(limit)||100, agentId, event }) });
});

router.get("/p18/cycles/:cycleId", (req, res) => {
    const cycle = atl.getCycle(req.params.cycleId);
    if (!cycle) return res.status(404).json({ error: "Cycle not found" });
    res.json({ success: true, cycle });
});

router.delete("/p18/cycles/:cycleId", (req, res) => {
    try {
        res.json({ success: true, ...atl.cancelCycle(req.params.cycleId) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get("/p18/cycles", (req, res) => {
    const { status, goalType, limit, offset } = req.query;
    res.json({ success: true, ...atl.listCycles({ status, goalType, limit: parseInt(limit)||50, offset: parseInt(offset)||0 }) });
});

module.exports = router;
