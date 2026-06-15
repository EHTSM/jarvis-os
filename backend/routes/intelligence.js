"use strict";
/**
 * intelligence.js — J4 Cross-Domain Intelligence routes
 *
 * GET /intelligence/correlations        — all 6 correlation vectors
 * GET /intelligence/insights            — derived actionable insights
 * GET /intelligence/patterns            — recurring pattern clusters
 * GET /intelligence/trends              — time-bucketed trend series (?days=7)
 * GET /intelligence/recommendation-confidence — per-rec confidence scores
 */
const router = require("express").Router();
const intel  = require("../services/intelligenceLayer.cjs");

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

module.exports = router;
