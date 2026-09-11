"use strict";
/**
 * intelligence.js — J4 + B5 Cross-Domain Intelligence routes
 *
 * Engineering (J4):
 * GET /intelligence/correlations        — all 6 engineering correlation vectors
 * GET /intelligence/insights            — derived actionable insights
 * GET /intelligence/patterns            — recurring pattern clusters
 * GET /intelligence/trends              — time-bucketed trend series (?days=7)
 * GET /intelligence/recommendation-confidence — per-rec confidence scores
 *
 * Unified (B5) — one reasoning layer for engineering + business:
 * GET  /intelligence/unified/reason         — full unified intelligence report
 * GET  /intelligence/unified/executive      — executive dashboard + impact scores
 * GET  /intelligence/unified/correlate      — engineering↔business correlation vectors
 * GET  /intelligence/unified/events         — cross-domain events (opt: ?automate=true creates missions)
 * GET  /intelligence/unified/recommendations— merged eng+biz recommendations, ranked
 * POST /intelligence/unified/score          — executive impact score for any event
 * GET  /intelligence/unified/rules          — list all 7 cross-domain rules
 */
const router = require("express").Router();
const intel  = require("../services/intelligenceLayer.cjs");
const { attachOrg, requireOrgMember } = require("../middleware/orgMiddleware.cjs");
function _uil() { try { return require("../services/unifiedIntelligenceLayer.cjs"); } catch { return null; } }
// MASTER RESIDUAL CLOSURE (2026-08-15, C10-017): /intelligence/unified/executive,
// /correlate, /events, /recommendations, and /score previously called
// unifiedIntelligenceLayer's business-state readers with no org filter —
// live-reproduced a real cross-tenant leak where a fresh org with zero data
// received another tenant's real leads/revenue/pipeline value.
//
// First pass only added attachOrg, which is non-blocking by design (it
// resolves req.org from an X-Org-Id header/query/body when no :orgId path
// param exists, for routes like this one that carry no such param) — but
// attachOrg alone does not verify the caller is actually a MEMBER of that
// org. Re-reproduced live: Org B forging X-Org-Id: <Org A's real id>
// received Org A's real data (200, not 403) even after the first fix,
// because attachOrg resolved req.org to Org A on the forged header's say-so
// alone. requireOrgMember (the same membership check used across the rest
// of this codebase's org-scoped routes) closes that: a caller with no real
// membership in the org named by the header now correctly gets 403.
router.use("/intelligence/unified", attachOrg, requireOrgMember);
function _ok(res, data) { res.json({ ok: true, ...data }); }
function _err(res, e, status = 500) { res.status(status).json({ ok: false, error: e.message }); }

router.get("/intelligence/correlations", (req, res) => {
    try {
        res.json({ ok: true, ...intel.getCorrelations() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get("/intelligence/insights", (req, res) => {
    try {
        res.json({ ok: true, ...intel.getInsights() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get("/intelligence/patterns", (req, res) => {
    try {
        res.json({ ok: true, ...intel.getPatterns() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get("/intelligence/trends", (req, res) => {
    try {
        const days = Math.min(30, Math.max(1, parseInt(req.query.days) || 7));
        res.json({ ok: true, ...intel.getTrends(days) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get("/intelligence/recommendation-confidence", (req, res) => {
    try {
        res.json({ ok: true, ...intel.getRecommendationConfidence() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── Unified Intelligence Layer (B5) ──────────────────────────────────────────

router.get("/intelligence/unified/reason", (req, res) => {
    try {
        const uil = _uil();
        if (!uil) return _err(res, new Error("unified intelligence unavailable"), 503);
        const dryRun = req.query.dryRun === "true";
        _ok(res, uil.reason({ dryRun }));
    } catch (e) { _err(res, e); }
});

router.get("/intelligence/unified/executive", (req, res) => {
    try {
        const uil = _uil();
        if (!uil) return _err(res, new Error("unified intelligence unavailable"), 503);
        _ok(res, uil.getExecutiveDashboard(req.org?.id));
    } catch (e) { _err(res, e); }
});

router.get("/intelligence/unified/correlate", (req, res) => {
    try {
        const uil = _uil();
        if (!uil) return _err(res, new Error("unified intelligence unavailable"), 503);
        _ok(res, uil.correlate(req.org?.id));
    } catch (e) { _err(res, e); }
});

router.get("/intelligence/unified/events", (req, res) => {
    try {
        const uil = _uil();
        if (!uil) return _err(res, new Error("unified intelligence unavailable"), 503);
        const dryRun = req.query.dryRun !== "false"; // default dryRun=true for GET; pass ?dryRun=false to trigger missions
        _ok(res, uil.detectCrossDomainEvents({ dryRun, orgId: req.org?.id }));
    } catch (e) { _err(res, e); }
});

router.get("/intelligence/unified/recommendations", (req, res) => {
    try {
        const uil = _uil();
        if (!uil) return _err(res, new Error("unified intelligence unavailable"), 503);
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
        _ok(res, uil.getUnifiedRecommendations({ limit, orgId: req.org?.id }));
    } catch (e) { _err(res, e); }
});

router.post("/intelligence/unified/score", (req, res) => {
    try {
        const uil = _uil();
        if (!uil) return _err(res, new Error("unified intelligence unavailable"), 503);
        if (!req.body || typeof req.body !== "object") return res.status(400).json({ ok: false, error: "event body required" });
        _ok(res, uil.scoreImpact(req.body, req.org?.id));
    } catch (e) { _err(res, e, 400); }
});

router.get("/intelligence/unified/rules", (req, res) => {
    try {
        const uil = _uil();
        if (!uil) return _err(res, new Error("unified intelligence unavailable"), 503);
        const rules = uil.listCrossRules();
        _ok(res, { rules, total: rules.length });
    } catch (e) { _err(res, e); }
});
// Note: cross-domain rule registration is code-only (registerCrossRule in cjs).
// No HTTP endpoint — dynamic code eval over HTTP is an RCE surface.

module.exports = router;
