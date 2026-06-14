"use strict";
/**
 * /metrics/* — E4 Observability routes.
 * Requires auth but NOT requireActiveAccount (mounted before billing gate).
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

// ── Lazy-load services (all optional — degrade gracefully) ────────
const ea = require("../services/errorAggregator.cjs");
const tg = require("../services/taskGraph.cjs");
const br = require("../services/backgroundRuntime.cjs");
const ms = require("../utils/metricsStore");

let _mpl = null;
try { _mpl = require("../services/memoryPersistenceLayer.cjs"); } catch { /* optional */ }

let _ar = null;
try { _ar = require("../../agents/runtime/agentRegistry.cjs"); } catch { /* optional */ }

// ── Auth gate on all /metrics routes ─────────────────────────────
router.use("/metrics", requireAuth);

// ── Helpers ───────────────────────────────────────────────────────
function safeGraphStats() {
    try { return tg.getGraphStats(); } catch { return {}; }
}

function safeRecommendations(limit) {
    try { return br.getRecommendations({ limit }); } catch { return { total: 0 }; }
}

// ── GET /metrics/dashboard ────────────────────────────────────────
router.get("/metrics/dashboard", (req, res) => {
    try {
        const errorRate  = ea.getErrorRate();
        const graphStats = safeGraphStats();
        const recShort   = safeRecommendations(5);
        const recAll     = safeRecommendations(1000);

        let runtime = {};
        try { runtime = ms.getSnapshot(); } catch { /* non-critical */ }

        let memory = {};
        try { memory = _mpl ? _mpl.stats() : {}; } catch { /* non-critical */ }

        let agents = [];
        try { agents = _ar ? _ar.listAll() : []; } catch { /* non-critical */ }

        const healthScore = Math.max(0, 100 - (errorRate * 10));

        res.json({
            system: {
                uptime:      process.uptime(),
                memoryMB:    Math.round(process.memoryUsage().rss / 1024 / 1024),
                nodeVersion: process.version,
            },
            runtime,
            graphs: graphStats,
            recommendations: {
                background: recShort.total,
                total:      recAll.total,
            },
            memory,
            agents: { count: agents.length },
            errors: {
                rate:      errorRate,
                topErrors: ea.getTopErrors(5),
            },
            health: {
                score:  healthScore,
                status: "healthy",
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /metrics/health ───────────────────────────────────────────
router.get("/metrics/health", (req, res) => {
    try {
        const errorRate  = ea.getErrorRate();
        const graphStats = safeGraphStats();

        const checks = [
            { name: "backend_alive",         ok: true },
            { name: "error_rate_lt_5",        ok: errorRate < 5 },
            { name: "graph_success_rate_gt50",ok: (graphStats.successRate || 0) > 50 },
        ];

        const allFailed = checks.every(c => !c.ok);
        const anyFailed = checks.some(c => !c.ok);
        const status    = allFailed ? "critical" : anyFailed ? "degraded" : "healthy";

        res.status(allFailed ? 503 : 200).json({ status, checks });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /metrics/errors ───────────────────────────────────────────
router.get("/metrics/errors", (req, res) => {
    try {
        const groups = ea.getUnresolved();
        res.json({ groups, total: groups.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /metrics/errors/rate ──────────────────────────────────────
router.get("/metrics/errors/rate", (req, res) => {
    try {
        const windowMs = parseInt(req.query.windowMs) || 300000;
        const rate     = ea.getErrorRate(windowMs);
        res.json({ rate, windowMs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /metrics/errors/trend ─────────────────────────────────────
router.get("/metrics/errors/trend", (req, res) => {
    try {
        const hours = parseInt(req.query.hours) || 24;
        res.json(ea.getErrorTrend(hours));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /metrics/errors/:fingerprint/resolve ─────────────────────
router.post("/metrics/errors/:fingerprint/resolve", (req, res) => {
    try {
        ea.resolveError(req.params.fingerprint);
        res.json({ ok: true, fingerprint: req.params.fingerprint });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
