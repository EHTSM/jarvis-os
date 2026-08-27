"use strict";
/**
 * L1 — Plugin SDK V2 routes
 *
 * GET    /plugins                  — list installed plugins for workspace
 * GET    /plugins/health           — health summary for all plugins
 * GET    /plugins/diagnostics      — all diagnostic events (or ?pluginId=x for one)
 * GET    /plugins/stats            — workspace plugin statistics
 * GET    /plugins/manifest/:id     — full V2 manifest for a plugin
 * GET    /plugins/:id              — single plugin detail
 * GET    /plugins/:id/config       — plugin configuration
 * POST   /plugins/install          — install (or upgrade) a plugin
 * POST   /plugins/uninstall        — uninstall a plugin
 * POST   /plugins/enable           — enable a plugin in this workspace
 * POST   /plugins/disable          — disable a plugin in this workspace
 * POST   /plugins/health/check     — trigger an active health check
 * PATCH  /plugins/:id/config       — update plugin configuration
 * POST   /plugins/validate         — validate a manifest without installing
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachWorkspace, requireRole, requireWorkspaceMember } = require("../middleware/workspaceMiddleware.cjs");
const { requireFeature } = require("../services/featureGate.cjs");
const mgr = require("../services/pluginManagerService.cjs");

router.use("/plugins", requireAuth);
router.use("/plugins", attachWorkspace);

function _wsId(req) {
  return req.query.workspaceId || req.body?.workspaceId || req.workspace?.id || "default";
}

// Mission 44: the read-only routes below relied on _wsId(req), which accepts
// a caller-supplied ?workspaceId= directly with NO membership check —
// attachWorkspace only resolves req.workspace/req.workspaceRole (non-blocking
// by its own header comment); the mutating routes already correctly compose
// requireRole(), which does enforce real membership via req.workspaceRole,
// but these reads had no equivalent gate. A real, unrelated account could
// supply another workspace's id and read its plugin list, health,
// diagnostics, stats, manifest, and per-plugin config (which can hold
// plugin-specific settings) — 200, not 403. Fixed the same way
// extensions.js's identical defect was fixed: requireWorkspaceMember (the
// existing real membership check) after attachWorkspace, on each previously-
// unguarded read route. The default "view my own workspace" case (no
// workspaceId supplied) is unaffected, since attachWorkspace's own fallback
// (getActiveWorkspace) always resolves to a real workspace the caller is
// trivially a member of. /plugins/validate is untouched — it validates a
// manifest against a schema and never reads workspace-scoped data.
// ── List ──────────────────────────────────────────────────────────
router.get("/plugins", requireWorkspaceMember, requireFeature("plugins.marketplace"), (req, res) => {
  try {
    const { category, enabled, tag } = req.query;
    const enabledFilter = enabled === undefined ? undefined : enabled === "true";
    const plugins = mgr.list(_wsId(req), { category, enabled: enabledFilter, tag });
    res.json({ plugins, total: plugins.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Health ────────────────────────────────────────────────────────
router.get("/plugins/health", requireWorkspaceMember, (req, res) => {
  try { res.json(mgr.getHealth(_wsId(req))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/plugins/health/check", requireRole("Operator"), (req, res) => {
  try {
    const results = mgr.checkHealth(_wsId(req), req.body?.pluginId || null);
    res.json({ results, checked: results.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Diagnostics ───────────────────────────────────────────────────
router.get("/plugins/diagnostics", requireWorkspaceMember, (req, res) => {
  try { res.json(mgr.getDiagnostics(_wsId(req), req.query.pluginId || null)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Stats ─────────────────────────────────────────────────────────
router.get("/plugins/stats", requireWorkspaceMember, (req, res) => {
  try { res.json(mgr.getStats(_wsId(req))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Validate (no install) ─────────────────────────────────────────
router.post("/plugins/validate", (req, res) => {
  try {
    const result = mgr.validateManifest(req.body);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Install / Uninstall ───────────────────────────────────────────
router.post("/plugins/install", requireRole("Admin"), requireFeature("plugins.install"), (req, res) => {
  try {
    const result = mgr.install(_wsId(req), req.body, req.user.sub);
    res.json(result);
  } catch (e) {
    const status = e.message.includes("already installed") ? 409 : 400;
    res.status(status).json({ error: e.message });
  }
});

router.post("/plugins/uninstall", requireRole("Admin"), (req, res) => {
  try {
    const { pluginId } = req.body;
    if (!pluginId) return res.status(400).json({ error: "pluginId required" });
    res.json(mgr.uninstall(_wsId(req), pluginId, req.user.sub));
  } catch (e) {
    const status = e.message.includes("not installed") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

// ── Enable / Disable ──────────────────────────────────────────────
router.post("/plugins/enable", requireRole("Admin"), (req, res) => {
  try {
    const { pluginId } = req.body;
    if (!pluginId) return res.status(400).json({ error: "pluginId required" });
    res.json(mgr.enable(_wsId(req), pluginId, req.user.sub));
  } catch (e) {
    const status = e.message.includes("not installed") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

router.post("/plugins/disable", requireRole("Admin"), (req, res) => {
  try {
    const { pluginId } = req.body;
    if (!pluginId) return res.status(400).json({ error: "pluginId required" });
    res.json(mgr.disable(_wsId(req), pluginId, req.user.sub));
  } catch (e) {
    const status = e.message.includes("not installed") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

// ── Manifest ──────────────────────────────────────────────────────
router.get("/plugins/manifest/:id", requireWorkspaceMember, (req, res) => {
  try { res.json(mgr.getManifest(_wsId(req), req.params.id)); }
  catch (e) {
    const status = e.message.includes("not installed") ? 404 : 500;
    res.status(status).json({ error: e.message });
  }
});

// ── Config ────────────────────────────────────────────────────────
router.get("/plugins/:id/config", requireWorkspaceMember, (req, res) => {
  try { res.json(mgr.getConfig(_wsId(req), req.params.id)); }
  catch (e) {
    const status = e.message.includes("not installed") ? 404 : 500;
    res.status(status).json({ error: e.message });
  }
});

router.patch("/plugins/:id/config", requireRole("Admin"), (req, res) => {
  try { res.json(mgr.updateConfig(_wsId(req), req.params.id, req.body, req.user.sub)); }
  catch (e) {
    const status = e.message.includes("not installed") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

// ── Get single (must be after all named routes) ───────────────────
router.get("/plugins/:id", requireWorkspaceMember, (req, res) => {
  try {
    const plugin = mgr.get(_wsId(req), req.params.id);
    if (!plugin) return res.status(404).json({ error: "Plugin not found" });
    res.json({ plugin });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
