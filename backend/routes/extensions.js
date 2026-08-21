"use strict";
/**
 * L3 — Extension Runtime routes
 *
 * GET  /extensions/runtime          — list all extensions in runtime for workspace
 * GET  /extensions/runtime/:id      — single extension runtime record + events
 * GET  /extensions/metrics          — aggregate runtime metrics + event bus stats
 * GET  /extensions/hooks            — all registered hooks across extensions
 * GET  /extensions/quotas           — quota usage per extension
 * POST /extensions/load             — load (and activate) an extension into runtime
 * POST /extensions/unload           — unload an extension from runtime
 * POST /extensions/suspend          — suspend an active extension
 * POST /extensions/resume           — resume a suspended extension
 * POST /extensions/restart          — restart (crash recovery) an extension
 * POST /extensions/crash            — record a crash (for testing / external signals)
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachWorkspace, requireRole, requireWorkspaceMember } = require("../middleware/workspaceMiddleware.cjs");
const rt = require("../services/extensionRuntime.cjs");

router.use("/extensions", requireAuth);
router.use("/extensions", attachWorkspace);

function _wsId(req) {
  return req.query.workspaceId || req.body?.workspaceId || req.workspace?.id || "default";
}

// OOPLIX V1 MASTER AUDIT (2026-08-16): the 5 read-only routes below relied
// on _wsId(req), which accepts a caller-supplied ?workspaceId= directly with
// NO membership check — attachWorkspace only resolves req.workspace/
// req.workspaceRole (non-blocking by its own header comment); the mutating
// routes below already correctly compose requireRole(), which does enforce
// real membership via req.workspaceRole, but these reads had no equivalent
// gate at all. Live-reproduced: a real, unrelated account (Org B) supplied
// a real Org A workspace ID and successfully read its extension runtime
// list, metrics (including the full platform event-bus subscriber list),
// hooks, and quotas — 200, not 403. Fixed by adding requireWorkspaceMember
// (the same real membership check already used elsewhere in this codebase,
// e.g. workspace.js's own GET /workspace/:id/members) after attachWorkspace
// — a caller with no membership in the requested/resolved workspace is
// now correctly denied 403, while the default "view my own workspace" case
// (no workspaceId supplied) is unaffected, since attachWorkspace's own
// fallback (getActiveWorkspace) always resolves to a real workspace the
// caller is trivially a member of.
// ── Read-only ─────────────────────────────────────────────────────
router.get("/extensions/runtime", requireWorkspaceMember, (req, res) => {
  try {
    const { state } = req.query;
    res.json({ extensions: rt.listRuntime(_wsId(req), { state }), total: rt.listRuntime(_wsId(req), { state }).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/extensions/metrics", requireWorkspaceMember, (req, res) => {
  try { res.json(rt.getMetrics(_wsId(req))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/extensions/hooks", requireWorkspaceMember, (req, res) => {
  try { res.json(rt.getHooks(_wsId(req))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/extensions/quotas", requireWorkspaceMember, (req, res) => {
  try { res.json({ quotas: rt.getQuotas(_wsId(req)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Single (must be after named routes) ──────────────────────────
router.get("/extensions/runtime/:id", requireWorkspaceMember, (req, res) => {
  try {
    const record = rt.getRuntime(_wsId(req), req.params.id);
    if (!record) return res.status(404).json({ error: "Extension not in runtime" });
    res.json({ extension: record });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Lifecycle mutations (Admin gate) ──────────────────────────────
router.post("/extensions/load", requireRole("Operator"), async (req, res) => {
  try {
    const { extId, hooks, subscriptions, restartPolicy, quota, permissions } = req.body;
    if (!extId) return res.status(400).json({ error: "extId required" });
    const result = rt.load(_wsId(req), extId, { hooks, subscriptions, restartPolicy, quota, permissions }, req.user.sub);
    res.json({ extension: result });
  } catch (e) {
    const status = e.message.includes("not installed") || e.message.includes("not in runtime") ? 404
                 : e.message.includes("already") ? 409 : 400;
    res.status(status).json({ error: e.message });
  }
});

router.post("/extensions/unload", requireRole("Operator"), (req, res) => {
  try {
    const { extId } = req.body;
    if (!extId) return res.status(400).json({ error: "extId required" });
    res.json({ extension: rt.unload(_wsId(req), extId, req.user.sub) });
  } catch (e) {
    const status = e.message.includes("not in runtime") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

router.post("/extensions/suspend", requireRole("Operator"), (req, res) => {
  try {
    const { extId } = req.body;
    if (!extId) return res.status(400).json({ error: "extId required" });
    res.json({ extension: rt.suspend(_wsId(req), extId, req.user.sub) });
  } catch (e) {
    const status = e.message.includes("not active") ? 409 : 400;
    res.status(status).json({ error: e.message });
  }
});

router.post("/extensions/resume", requireRole("Operator"), (req, res) => {
  try {
    const { extId } = req.body;
    if (!extId) return res.status(400).json({ error: "extId required" });
    res.json({ extension: rt.resume(_wsId(req), extId, req.user.sub) });
  } catch (e) {
    const status = e.message.includes("not suspended") ? 409 : 400;
    res.status(status).json({ error: e.message });
  }
});

router.post("/extensions/restart", requireRole("Operator"), (req, res) => {
  try {
    const { extId } = req.body;
    if (!extId) return res.status(400).json({ error: "extId required" });
    res.json({ extension: rt.restart(_wsId(req), extId, req.user.sub) });
  } catch (e) {
    const status = e.message.includes("not in runtime") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

router.post("/extensions/crash", requireRole("Admin"), (req, res) => {
  try {
    const { extId, error } = req.body;
    if (!extId) return res.status(400).json({ error: "extId required" });
    res.json({ extension: rt.recordCrash(_wsId(req), extId, error || "Manual crash signal") });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
