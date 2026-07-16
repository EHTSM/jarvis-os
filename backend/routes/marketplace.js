"use strict";
/**
 * L2 — Capability Marketplace routes
 *
 * GET  /marketplace/catalog              — full catalog (filterable)
 * GET  /marketplace/plugin/:id           — single plugin detail + reviews + compat
 * GET  /marketplace/categories           — category list with counts
 * GET  /marketplace/featured             — featured + verified plugins
 * GET  /marketplace/search               — full-text search
 * GET  /marketplace/recommendations      — capability-gap-based install recs
 * GET  /marketplace/versions/:id         — version list for a plugin
 * GET  /marketplace/changelog/:id        — changelog entries for a plugin
 * POST /marketplace/plugin/:id/review    — submit a review (authenticated)
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachWorkspace, requireRole } = require("../middleware/workspaceMiddleware.cjs");
const { requireFeature } = require("../services/featureGate.cjs");
const svc = require("../services/marketplaceService.cjs");

router.use("/marketplace", requireAuth);
router.use(attachWorkspace);
router.use("/marketplace", requireFeature("plugins.marketplace"));

function _wsId(req) {
  return req.query.workspaceId || req.body?.workspaceId || req.workspace?.id || "default";
}

// ── Catalog ───────────────────────────────────────────────────────
router.get("/marketplace/catalog", (req, res) => {
  try {
    const { category, verified, tag, limit, offset } = req.query;
    res.json(svc.getCatalog(_wsId(req), {
      category,
      verified: verified === undefined ? undefined : verified === "true",
      tag,
      limit:  parseInt(limit,  10) || 50,
      offset: parseInt(offset, 10) || 0,
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Categories ────────────────────────────────────────────────────
router.get("/marketplace/categories", (req, res) => {
  try { res.json({ categories: svc.getCategories(_wsId(req)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Featured ──────────────────────────────────────────────────────
router.get("/marketplace/featured", (req, res) => {
  try { res.json(svc.getFeatured(_wsId(req))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Search ────────────────────────────────────────────────────────
router.get("/marketplace/search", (req, res) => {
  try {
    const { q, category, limit } = req.query;
    res.json(svc.search(_wsId(req), q || "", {
      category,
      limit: parseInt(limit, 10) || 20,
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Recommendations ───────────────────────────────────────────────
router.get("/marketplace/recommendations", (req, res) => {
  try { res.json(svc.getRecommendations(_wsId(req))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Versions ──────────────────────────────────────────────────────
router.get("/marketplace/versions/:id", (req, res) => {
  try {
    const result = svc.getVersions(req.params.id);
    if (!result) return res.status(404).json({ error: "Plugin not found in catalog" });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Changelog ─────────────────────────────────────────────────────
router.get("/marketplace/changelog/:id", (req, res) => {
  try {
    const result = svc.getChangelog(req.params.id);
    if (!result) return res.status(404).json({ error: "Plugin not found in catalog" });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Plugin detail (must be after named routes) ────────────────────
router.get("/marketplace/plugin/:id", (req, res) => {
  try {
    const plugin = svc.getPlugin(_wsId(req), req.params.id);
    if (!plugin) return res.status(404).json({ error: "Plugin not found in catalog" });
    res.json({ plugin });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Reviews ───────────────────────────────────────────────────────
router.post("/marketplace/plugin/:id/review", (req, res) => {
  try {
    const { rating, body, author } = req.body;
    const review = svc.addReview(req.params.id, { rating, body, author }, req.user.sub, _wsId(req));
    res.json({ review });
  } catch (e) {
    const status = e.message.includes("not in catalog") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

// ── Third-party developer publishing workflow ──────────────────────
// Any authenticated dev can submit; only Admin+ can review/approve —
// same pattern as requireRole("Admin") on /plugins/install.
router.post("/marketplace/submit", (req, res) => {
  try {
    const submission = svc.submitConnector(req.user.sub, req.body);
    res.status(201).json({ submission });
  } catch (e) {
    const status = e.validationErrors ? 400 : (e.message.includes("already exists") ? 409 : 400);
    res.status(status).json({ error: e.message, validationErrors: e.validationErrors });
  }
});

router.get("/marketplace/submissions", requireRole("Admin"), (req, res) => {
  try { res.json({ submissions: svc.listSubmissions(req.query.status) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/marketplace/submissions/:id", requireRole("Admin"), (req, res) => {
  try {
    const submission = svc.getSubmission(req.params.id);
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    res.json({ submission });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/marketplace/submissions/:id/review", requireRole("Admin"), (req, res) => {
  try {
    const { decision, notes } = req.body;
    const submission = svc.reviewSubmission(req.params.id, decision, req.user.sub, notes);
    res.json({ submission });
  } catch (e) {
    const status = e.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

module.exports = router;
