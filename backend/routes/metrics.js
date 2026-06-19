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

// ── GET /metrics/summary ─────────────────────────────────────────
// Used by DevDashboard — lightweight daily stats summary.
router.get("/metrics/summary", (req, res) => {
    try {
        const dashboard = ms.getDashboard ? ms.getDashboard() : {};
        res.json({
            period:           req.query.period || "today",
            requestsTotal:    dashboard.totalRequests   || 0,
            errorsTotal:      dashboard.totalErrors     || 0,
            avgLatencyMs:     dashboard.avgLatencyMs    || 0,
            uptimeSeconds:    dashboard.uptimeSeconds   || 0,
        });
    } catch (err) {
        res.json({ period: "today", requestsTotal: 0, errorsTotal: 0 });
    }
});

// ── GET /metrics/perf-audit ──────────────────────────────────────
// Performance audit: startup, memory, CPU, repo indexing, AI latency.
// Returns current process stats + recommendations.
router.get("/metrics/perf-audit", (req, res) => {
    try {
        const mem   = process.memoryUsage();
        const cpu   = process.cpuUsage();
        const upMs  = process.uptime() * 1000;

        const dashboard = ms.getDashboard ? ms.getDashboard() : {};
        const errors    = (ea.getErrors ? ea.getErrors({ limit: 5 }) : []);

        // Build recommendations from real data
        const recommendations = [];
        const heapUsedMB = mem.heapUsed / 1024 / 1024;
        if (heapUsedMB > 300)  recommendations.push({ area: "memory",  severity: "high",   text: `Heap at ${heapUsedMB.toFixed(0)}MB — consider lazy-loading heavy modules` });
        if ((dashboard.avgLatencyMs || 0) > 500) recommendations.push({ area: "api",     severity: "high",   text: `Avg API latency ${dashboard.avgLatencyMs}ms — add caching or query optimization` });
        if ((dashboard.errorRate || 0) > 0.05)   recommendations.push({ area: "errors",  severity: "medium", text: `Error rate ${((dashboard.errorRate || 0) * 100).toFixed(1)}% — check error aggregator` });
        if (upMs < 5000)                         recommendations.push({ area: "startup", severity: "info",   text: "Process recently started — startup time within normal range" });
        if (recommendations.length === 0)        recommendations.push({ area: "overall", severity: "ok",    text: "No critical performance issues detected" });

        res.json({
            timestamp:     new Date().toISOString(),
            process: {
                uptimeMs:    Math.round(upMs),
                heapUsedMB:  Math.round(heapUsedMB),
                heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
                rssMB:       Math.round(mem.rss / 1024 / 1024),
                cpuUserMs:   Math.round(cpu.user / 1000),
                cpuSysMs:    Math.round(cpu.system / 1000),
            },
            api: {
                avgLatencyMs:      dashboard.avgLatencyMs    || 0,
                p95LatencyMs:      dashboard.p95LatencyMs    || 0,
                requestsPerMinute: dashboard.requestsPerMinute || 0,
                errorRate:         dashboard.errorRate        || 0,
            },
            recentErrors: errors.slice(0, 3),
            recommendations,
            score: Math.max(0, 100
                - (heapUsedMB > 300 ? 20 : 0)
                - ((dashboard.avgLatencyMs || 0) > 500 ? 25 : 0)
                - ((dashboard.errorRate || 0) > 0.05 ? 20 : 0)
            ),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
