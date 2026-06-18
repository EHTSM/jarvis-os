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
function _uil() { try { return require("../services/unifiedIntelligenceLayer.cjs"); } catch { return null; } }
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
        _ok(res, uil.getExecutiveDashboard());
    } catch (e) { _err(res, e); }
});

router.get("/intelligence/unified/correlate", (req, res) => {
    try {
        const uil = _uil();
        if (!uil) return _err(res, new Error("unified intelligence unavailable"), 503);
        _ok(res, uil.correlate());
    } catch (e) { _err(res, e); }
});

router.get("/intelligence/unified/events", (req, res) => {
    try {
        const uil = _uil();
        if (!uil) return _err(res, new Error("unified intelligence unavailable"), 503);
        const dryRun = req.query.dryRun !== "false"; // default dryRun=true for GET; pass ?dryRun=false to trigger missions
        _ok(res, uil.detectCrossDomainEvents({ dryRun }));
    } catch (e) { _err(res, e); }
});

router.get("/intelligence/unified/recommendations", (req, res) => {
    try {
        const uil = _uil();
        if (!uil) return _err(res, new Error("unified intelligence unavailable"), 503);
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
        _ok(res, uil.getUnifiedRecommendations({ limit }));
    } catch (e) { _err(res, e); }
});

router.post("/intelligence/unified/score", (req, res) => {
    try {
        const uil = _uil();
        if (!uil) return _err(res, new Error("unified intelligence unavailable"), 503);
        if (!req.body || typeof req.body !== "object") return res.status(400).json({ ok: false, error: "event body required" });
        _ok(res, uil.scoreImpact(req.body));
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
