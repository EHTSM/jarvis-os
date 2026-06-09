"use strict";
/**
 * Telemetry Engine — disk-backed operational event store for deployed products.
 *
 * Writer API (call from pipeline, middleware, or product code):
 *   recordDeploy(event)       — deploy started/succeeded/failed/rolled-back
 *   recordApiRequest(event)   — single API call: method, path, status, durationMs
 *   recordApiError(event)     — API error: method, path, statusCode, errorCode, message
 *   recordPageView(event)     — page navigation: route, durationMs
 *
 * Reader API (called by HTTP endpoints):
 *   getHealthSummary(opts)    — current product health snapshot
 *   getMetrics(opts)          — aggregated counters and rates
 *   getHistory(opts)          — raw event stream with filters
 *   getDeployHistory(opts)    — deploy events only
 *
 * Storage:
 *   data/telemetry.json          — ring buffer of raw events  (max MAX_EVENTS, newest-first)
 *   data/telemetry-summary.json  — aggregated snapshot        (recomputed on each write)
 *
 * Event shape (all events share a base):
 *   { id, type, ts, blueprintId?, productName?, ... type-specific fields }
 *
 * Deploy event fields:
 *   { phase, action, ok, gitHead, elapsedMs, health }
 *   phase: "started"|"completed"|"failed"|"rolled-back"
 *
 * API request event fields:
 *   { method, path, statusCode, durationMs, operatorId? }
 *
 * API error event fields:
 *   { method, path, statusCode, errorCode, message, stack? }
 *
 * Page view event fields:
 *   { route, pageName?, durationMs?, userId? }
 *
 * Health summary fields:
 *   {
 *     generatedAt, windowMins,
 *     deploy   : { total, ok, failed, lastDeployAt, lastStatus, avgElapsedMs },
 *     api      : { total, ok, errors, errorRate, p50Ms, p95Ms, topErrors[] },
 *     pages    : { total, topRoutes[] },
 *     overall  : "healthy" | "degraded" | "critical"
 *   }
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR       = path.join(__dirname, "../../data");
const EVENTS_PATH    = path.join(DATA_DIR, "telemetry.json");
const SUMMARY_PATH   = path.join(DATA_DIR, "telemetry-summary.json");
const MAX_EVENTS     = 10_000;
const SUMMARY_WINDOW = 60;   // minutes — health summary covers last 60 min by default

let _evtCounter = Date.now();

// ── Storage helpers ───────────────────────────────────────────────

function _loadEvents() {
    try {
        const raw = fs.readFileSync(EVENTS_PATH, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function _saveEvents(events) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = EVENTS_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(events.slice(0, MAX_EVENTS), null, 2));
    fs.renameSync(tmp, EVENTS_PATH);
}

// Auto-detection throttle: run detect() at most once per 60s to avoid thrashing on API floods.
let _lastDetectMs = 0;
const DETECT_THROTTLE_MS = 60_000;

function _appendEvent(event) {
    const events = _loadEvents();
    events.unshift(event);           // newest-first
    _saveEvents(events);
    const summary = _recomputeSummary(events);  // keep summary fresh

    // Trigger incident detection on high-signal events or when summary warrants it.
    // Throttled so a burst of API errors doesn't hammer the detector.
    const triggerTypes = new Set(["deploy", "api_error"]);
    const triggerHealth = summary.overall !== "healthy";
    if (triggerTypes.has(event.type) || triggerHealth) {
        const now = Date.now();
        if (now - _lastDetectMs >= DETECT_THROTTLE_MS) {
            _lastDetectMs = now;
            setImmediate(() => {
                try {
                    const inc = require("./incidentEngine.cjs");
                    inc.detect({ windowMins: SUMMARY_WINDOW });
                } catch { /* non-fatal */ }
                // Lifecycle re-evaluation on degraded health
                if (triggerHealth) {
                    try {
                        const ple = require("./productLifecycleEngine.cjs");
                        ple.evaluate({ windowMins: SUMMARY_WINDOW, persist: true });
                    } catch { /* non-fatal */ }
                }
            });
        }
    }

    return event;
}

// ── Summary recomputer ────────────────────────────────────────────
// Called on every write. Cheap — processes only events in the window.
function _recomputeSummary(events) {
    const cutoff = Date.now() - SUMMARY_WINDOW * 60_000;
    const recent = events.filter(e => new Date(e.ts).getTime() >= cutoff);

    const deployEvents  = recent.filter(e => e.type === "deploy");
    const apiReqEvents  = recent.filter(e => e.type === "api_request");
    const apiErrEvents  = recent.filter(e => e.type === "api_error");
    const pageEvents    = recent.filter(e => e.type === "page_view");

    // Deploy stats
    const lastDeploy    = deployEvents.find(e => e.phase === "completed" || e.phase === "failed");
    const deployOk      = deployEvents.filter(e => e.phase === "completed" && e.ok).length;
    const deployFailed  = deployEvents.filter(e => e.phase === "failed" || (e.phase === "completed" && !e.ok)).length;
    const deployElapsed = deployEvents.filter(e => e.elapsedMs).map(e => e.elapsedMs);
    const avgDeployMs   = deployElapsed.length ? Math.round(deployElapsed.reduce((a, b) => a + b, 0) / deployElapsed.length) : null;

    // API stats
    const apiOk         = apiReqEvents.filter(e => e.statusCode < 400).length;
    const apiTotal      = apiReqEvents.length;
    const errorRate     = apiTotal > 0 ? Math.round((apiErrEvents.length / apiTotal) * 100) : 0;
    const durations     = apiReqEvents.map(e => e.durationMs).filter(Boolean).sort((a, b) => a - b);
    const p50           = durations.length ? durations[Math.floor(durations.length * 0.5)] : null;
    const p95           = durations.length ? durations[Math.floor(durations.length * 0.95)] : null;

    // Top error codes
    const errCounts = {};
    for (const e of apiErrEvents) {
        const k = `${e.statusCode}:${e.errorCode || "unknown"}`;
        errCounts[k] = (errCounts[k] || 0) + 1;
    }
    const topErrors = Object.entries(errCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([k, count]) => ({ key: k, count }));

    // Top routes
    const routeCounts = {};
    for (const e of pageEvents) {
        routeCounts[e.route] = (routeCounts[e.route] || 0) + 1;
    }
    const topRoutes = Object.entries(routeCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([route, count]) => ({ route, count }));

    // Overall health
    let overall = "healthy";
    if (errorRate > 25 || deployFailed > deployOk) overall = "critical";
    else if (errorRate > 10 || deployFailed > 0)   overall = "degraded";

    const summary = {
        generatedAt:  new Date().toISOString(),
        windowMins:   SUMMARY_WINDOW,
        eventCount:   recent.length,
        deploy: {
            total:        deployEvents.length,
            ok:           deployOk,
            failed:       deployFailed,
            lastDeployAt: lastDeploy?.ts ?? null,
            lastStatus:   lastDeploy?.phase ?? null,
            lastOk:       lastDeploy?.ok ?? null,
            avgElapsedMs: avgDeployMs,
        },
        api: {
            total:     apiTotal,
            ok:        apiOk,
            errors:    apiErrEvents.length,
            errorRate,
            p50Ms:     p50,
            p95Ms:     p95,
            topErrors,
        },
        pages: {
            total:     pageEvents.length,
            topRoutes,
        },
        overall,
    };

    try {
        fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
    } catch { /* non-fatal */ }

    return summary;
}

// ── Writer API ────────────────────────────────────────────────────

/**
 * Record a deploy lifecycle event.
 * @param {object} opts
 * @param {string} opts.phase         — "started"|"completed"|"failed"|"rolled-back"
 * @param {string} opts.action        — "reload"|"restart"|"start"
 * @param {boolean} opts.ok
 * @param {string} [opts.gitHead]
 * @param {number} [opts.elapsedMs]
 * @param {object} [opts.health]      — { status, uptime }
 * @param {string} [opts.blueprintId]
 * @param {string} [opts.productName]
 * @param {string} [opts.error]
 */
function recordDeploy(opts) {
    const event = {
        id:          `tel_${++_evtCounter}`,
        type:        "deploy",
        ts:          new Date().toISOString(),
        phase:       opts.phase || "completed",
        action:      opts.action || "unknown",
        ok:          opts.ok ?? false,
        gitHead:     opts.gitHead || null,
        elapsedMs:   opts.elapsedMs || null,
        health:      opts.health || null,
        error:       opts.error || null,
        blueprintId: opts.blueprintId || null,
        productName: opts.productName || null,
    };
    console.log(`[Telemetry] deploy ${event.phase} — ok=${event.ok} elapsed=${event.elapsedMs}ms`);
    return _appendEvent(event);
}

/**
 * Record a single API request.
 * @param {object} opts
 * @param {string} opts.method
 * @param {string} opts.path
 * @param {number} opts.statusCode
 * @param {number} [opts.durationMs]
 * @param {string} [opts.operatorId]
 * @param {string} [opts.blueprintId]
 */
function recordApiRequest(opts) {
    const event = {
        id:          `tel_${++_evtCounter}`,
        type:        "api_request",
        ts:          new Date().toISOString(),
        method:      opts.method,
        path:        opts.path,
        statusCode:  opts.statusCode,
        durationMs:  opts.durationMs || null,
        operatorId:  opts.operatorId || null,
        blueprintId: opts.blueprintId || null,
    };
    return _appendEvent(event);
}

/**
 * Record an API error.
 * @param {object} opts
 * @param {string} opts.method
 * @param {string} opts.path
 * @param {number} opts.statusCode
 * @param {string} [opts.errorCode]  — application error code (e.g. "NOT_FOUND", "VALIDATION")
 * @param {string} [opts.message]
 * @param {string} [opts.blueprintId]
 */
function recordApiError(opts) {
    const event = {
        id:          `tel_${++_evtCounter}`,
        type:        "api_error",
        ts:          new Date().toISOString(),
        method:      opts.method,
        path:        opts.path,
        statusCode:  opts.statusCode,
        errorCode:   opts.errorCode || null,
        message:     opts.message?.slice(0, 200) || null,
        blueprintId: opts.blueprintId || null,
    };
    console.log(`[Telemetry] api_error ${event.method} ${event.path} → ${event.statusCode} (${event.errorCode || "unknown"})`);
    return _appendEvent(event);
}

/**
 * Record a page view / navigation event.
 * @param {object} opts
 * @param {string} opts.route
 * @param {string} [opts.pageName]
 * @param {number} [opts.durationMs]  — time spent on page
 * @param {string} [opts.userId]
 * @param {string} [opts.blueprintId]
 */
function recordPageView(opts) {
    const event = {
        id:          `tel_${++_evtCounter}`,
        type:        "page_view",
        ts:          new Date().toISOString(),
        route:       opts.route,
        pageName:    opts.pageName || null,
        durationMs:  opts.durationMs || null,
        userId:      opts.userId || null,
        blueprintId: opts.blueprintId || null,
    };
    return _appendEvent(event);
}

// ── Reader API ────────────────────────────────────────────────────

/**
 * Return the current product health summary.
 * If the cached summary is fresh (< 30s old), return it directly.
 * Otherwise recompute from the event store.
 *
 * @param {object} [opts]
 * @param {number} [opts.windowMins]  — lookback window in minutes (default 60)
 * @returns {HealthSummary}
 */
function getHealthSummary({ windowMins = SUMMARY_WINDOW } = {}) {
    // Try cached summary first
    try {
        const raw  = fs.readFileSync(SUMMARY_PATH, "utf8");
        const sum  = JSON.parse(raw);
        const ageMs = Date.now() - new Date(sum.generatedAt).getTime();
        if (ageMs < 30_000 && sum.windowMins === windowMins) return sum;
    } catch { /* recompute */ }

    return _recomputeSummary(_loadEvents());
}

/**
 * Return aggregated metrics for a given time window.
 *
 * @param {object} [opts]
 * @param {number} [opts.windowMins]    — lookback window (default 60)
 * @param {string} [opts.type]          — filter by event type
 * @param {string} [opts.blueprintId]   — filter by product
 * @returns {{ total, byType, byStatus, topPaths, errorsByCode }}
 */
function getMetrics({ windowMins = 60, type, blueprintId } = {}) {
    const cutoff = Date.now() - windowMins * 60_000;
    let events   = _loadEvents().filter(e => new Date(e.ts).getTime() >= cutoff);
    if (type)        events = events.filter(e => e.type === type);
    if (blueprintId) events = events.filter(e => e.blueprintId === blueprintId);

    const byType   = {};
    const byStatus = {};
    const pathCounts = {};
    const errCodes = {};

    for (const e of events) {
        byType[e.type] = (byType[e.type] || 0) + 1;
        if (e.statusCode) byStatus[e.statusCode] = (byStatus[e.statusCode] || 0) + 1;
        if (e.path) pathCounts[e.path] = (pathCounts[e.path] || 0) + 1;
        if (e.errorCode) errCodes[e.errorCode] = (errCodes[e.errorCode] || 0) + 1;
    }

    const topPaths = Object.entries(pathCounts)
        .sort(([, a], [, b]) => b - a).slice(0, 10)
        .map(([path, count]) => ({ path, count }));

    const errorsByCode = Object.entries(errCodes)
        .sort(([, a], [, b]) => b - a).slice(0, 10)
        .map(([code, count]) => ({ code, count }));

    return { windowMins, total: events.length, byType, byStatus, topPaths, errorsByCode };
}

/**
 * Return raw events with optional filters.
 *
 * @param {object} [opts]
 * @param {number}  [opts.limit]       — max events returned (default 100)
 * @param {string}  [opts.type]        — filter by event type
 * @param {string}  [opts.blueprintId] — filter by product
 * @param {number}  [opts.windowMins]  — lookback window in minutes
 * @returns {Event[]}
 */
function getHistory({ limit = 100, type, blueprintId, windowMins } = {}) {
    let events = _loadEvents();
    if (windowMins) {
        const cutoff = Date.now() - windowMins * 60_000;
        events = events.filter(e => new Date(e.ts).getTime() >= cutoff);
    }
    if (type)        events = events.filter(e => e.type === type);
    if (blueprintId) events = events.filter(e => e.blueprintId === blueprintId);
    return events.slice(0, limit);
}

/**
 * Return deploy events only, newest-first.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @param {string} [opts.blueprintId]
 * @returns {DeployEvent[]}
 */
function getDeployHistory({ limit = 20, blueprintId } = {}) {
    return getHistory({ limit, type: "deploy", blueprintId });
}

/**
 * Prune events older than retentionDays to keep disk usage bounded.
 * Called automatically; also exposed for manual invocation.
 *
 * @param {number} retentionDays — default 30
 * @returns {number} pruned count
 */
function pruneOldEvents(retentionDays = 30) {
    const cutoff = Date.now() - retentionDays * 86_400_000;
    const events = _loadEvents();
    const kept   = events.filter(e => new Date(e.ts).getTime() >= cutoff);
    const pruned = events.length - kept.length;
    if (pruned > 0) {
        _saveEvents(kept);
        console.log(`[Telemetry] pruned ${pruned} events older than ${retentionDays}d`);
    }
    return pruned;
}

module.exports = {
    recordDeploy,
    recordApiRequest,
    recordApiError,
    recordPageView,
    getHealthSummary,
    getMetrics,
    getHistory,
    getDeployHistory,
    pruneOldEvents,
};
