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
const { attachWorkspace, requireRole, requireWorkspaceMember } = require("../middleware/workspaceMiddleware.cjs");
const { requireFeature } = require("../services/featureGate.cjs");
const svc = require("../services/marketplaceService.cjs");

router.use("/marketplace", requireAuth);
router.use("/marketplace", attachWorkspace);
router.use("/marketplace", requireFeature("plugins.marketplace"));

function _wsId(req) {
  return req.query.workspaceId || req.body?.workspaceId || req.workspace?.id || "default";
}

// Mission 44: catalog/featured/search/recommendations/plugin-detail all pass
// _wsId(req) into marketplaceService.cjs to compute an `installed`/`depsMet`
// flag against the target workspace's real install list — a caller-supplied
// ?workspaceId= with no membership check let any authenticated account learn
// which marketplace plugins another workspace has installed. The catalog
// entries themselves are shared/global (not per-workspace secret data), so
// this is narrower than plugins.js's config/diagnostics leak, but it is
// still workspace-private information disclosed cross-tenant. Fixed with the
// same requireWorkspaceMember gate used on the equivalent plugins.js and
// extensions.js reads. /marketplace/categories is untouched — it computes
// per-workspace installedIds but never uses it in the response (dead value),
// so there is nothing to leak there. /marketplace/versions/:id and
// /marketplace/changelog/:id are untouched — they don't take a workspaceId
// at all (pure catalog lookups by plugin id).
// ── Catalog ───────────────────────────────────────────────────────
router.get("/marketplace/catalog", requireWorkspaceMember, (req, res) => {
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
router.get("/marketplace/featured", requireWorkspaceMember, (req, res) => {
  try { res.json(svc.getFeatured(_wsId(req))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Search ────────────────────────────────────────────────────────
router.get("/marketplace/search", requireWorkspaceMember, (req, res) => {
  try {
    const { q, category, limit } = req.query;
    res.json(svc.search(_wsId(req), q || "", {
      category,
      limit: parseInt(limit, 10) || 20,
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Recommendations ───────────────────────────────────────────────
router.get("/marketplace/recommendations", requireWorkspaceMember, (req, res) => {
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
router.get("/marketplace/plugin/:id", requireWorkspaceMember, (req, res) => {
  try {
    const plugin = svc.getPlugin(_wsId(req), req.params.id);
    if (!plugin) return res.status(404).json({ error: "Plugin not found in catalog" });
    res.json({ plugin });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Reviews ───────────────────────────────────────────────────────
// Phase 4 Mission 171-173 (Trust/Rating): this POST route was the one
// review-family route missing requireWorkspaceMember — every GET sibling in
// this file (catalog/featured/search/recommendations/plugin-detail) was
// fixed for the read-side IDOR (Mission 44, see the header comment above),
// but the POST route still passed the caller's raw _wsId(req) into
// svc.addReview(), which forwards it straight to
// securityLayer.addAuditEntry(workspaceId, ...). That function creates the
// target workspace's audit-log record if it doesn't already exist and
// unconditionally appends to it — so an authenticated account with no
// membership in workspace X could still cause an audit-log entry to be
// written into X's own audit trail (spoofed workspace attribution), because
// nothing on this route verified the caller actually belongs to the
// workspace being cited. The review itself is stored globally per pluginId
// (not workspace-scoped data), so this is not a data-disclosure IDOR like
// the GET routes' fix — it's a cross-tenant audit-integrity gap on the
// exact same _wsId(req) pattern. Fixed with the same requireWorkspaceMember
// gate as every sibling read route in this file.
router.post("/marketplace/plugin/:id/review", requireWorkspaceMember, (req, res) => {
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
