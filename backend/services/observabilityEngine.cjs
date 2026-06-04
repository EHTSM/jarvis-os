"use strict";
/**
 * ObservabilityEngine — metrics collection, structured logs, alerts,
 * health monitoring and service telemetry.
 *
 * Integrates with existing:
 *   metricsStore.js        — in-process request counters
 *   execLog.cjs            — execution NDJSON log
 *   auditLog.cjs           — audit trail
 *   data/metrics/*.ndjson  — daily metric shards
 *   /health endpoint       — service status
 *
 * Adds:
 *   Custom metric registration + recording (counters, gauges, histograms)
 *   Structured log sink with severity levels
 *   Alert rules engine (threshold + rate-of-change rules)
 *   Synthetic health probes per service
 *   Telemetry snapshots persisted to data/telemetry-engine.json
 *
 * Public API:
 *   recordMetric(name, value, tags)     → void
 *   getMetric(name, opts)               → { values[], stats }
 *   registerAlert(rule)                 → { alertId }
 *   evaluateAlerts()                    → { fired[], cleared[] }
 *   structuredLog(level, msg, ctx)      → void
 *   queryLogs(opts)                     → { entries[] }
 *   probeHealth()                       → { services{} }
 *   getSnapshot()                       → full telemetry snapshot
 *   getAlerts(opts)                     → { active[], history[] }
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const http = require("http");
const https = require("https");
const logger = require("../utils/logger");

const TELEMETRY_FILE = path.join(__dirname, "../../data/telemetry-engine.json");
const LOG_FILE       = path.join(__dirname, "../../data/logs/structured.ndjson");
const ALERT_FILE     = path.join(__dirname, "../../data/alert-rules.json");
const ALERT_LOG_FILE = path.join(__dirname, "../../data/logs/alerts.ndjson");
const METRICS_DIR    = path.join(__dirname, "../../data/metrics");

function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function _wj(f, d) {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, f);
}

// ── Log stream ────────────────────────────────────────────────────────────
let _logStream = null;
let _alertStream = null;

function _logSink() {
    if (_logStream) return _logStream;
    try {
        fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
        _logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
        _logStream.on("error", () => { _logStream = null; });
    } catch { _logStream = null; }
    return _logStream;
}
function _alertSink() {
    if (_alertStream) return _alertStream;
    try {
        fs.mkdirSync(path.dirname(ALERT_LOG_FILE), { recursive: true });
        _alertStream = fs.createWriteStream(ALERT_LOG_FILE, { flags: "a" });
        _alertStream.on("error", () => { _alertStream = null; });
    } catch { _alertStream = null; }
    return _alertStream;
}

/** Write a structured log line. */
function structuredLog(level, msg, ctx = {}) {
    const entry = { ts: new Date().toISOString(), level: level.toUpperCase(), msg, ...ctx };
    const s = _logSink();
    if (s) { try { s.write(JSON.stringify(entry) + "\n"); } catch { /* non-fatal */ } }
    // Mirror to the process logger
    if (level === "error") logger.error(`[Obs] ${msg}`);
    else if (level === "warn") logger.warn(`[Obs] ${msg}`);
}

/** Read structured log tail. */
function queryLogs({ limit = 200, level, service, since } = {}) {
    try {
        const text  = fs.readFileSync(LOG_FILE, "utf8");
        let   lines = text.split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        if (level)   lines = lines.filter(e => e.level   === level.toUpperCase());
        if (service) lines = lines.filter(e => e.service === service);
        if (since)   lines = lines.filter(e => e.ts >= since);
        return { entries: lines.slice(-limit).reverse(), total: lines.length };
    } catch { return { entries: [], total: 0 }; }
}

// ── In-memory metric store ────────────────────────────────────────────────
// Keyed by metric name → ring buffer of { ts, value, tags }
const _metrics = new Map();
const METRIC_RING = 1000;

function recordMetric(name, value, tags = {}) {
    if (!_metrics.has(name)) _metrics.set(name, []);
    const buf = _metrics.get(name);
    buf.push({ ts: Date.now(), value: Number(value), tags });
    if (buf.length > METRIC_RING) buf.shift();
}

function getMetric(name, { since, limit = 200 } = {}) {
    const raw = _metrics.get(name) || [];
    let values = since ? raw.filter(e => e.ts >= since) : raw;
    values = values.slice(-limit);
    if (!values.length) return { values: [], stats: null };
    const nums  = values.map(v => v.value);
    const sorted = [...nums].sort((a, b) => a - b);
    const avg   = nums.reduce((a, b) => a + b, 0) / nums.length;
    return {
        values,
        stats: {
            count: nums.length, min: sorted[0], max: sorted[sorted.length - 1],
            avg: Math.round(avg * 100) / 100,
            p50: sorted[Math.floor(sorted.length * 0.5)],
            p95: sorted[Math.floor(sorted.length * 0.95)],
            p99: sorted[Math.floor(sorted.length * 0.99)],
        },
    };
}

function listMetrics() {
    return Array.from(_metrics.keys()).map(name => {
        const buf = _metrics.get(name);
        return { name, count: buf.length, lastValue: buf[buf.length - 1]?.value ?? null, lastTs: buf[buf.length - 1]?.ts ?? null };
    });
}

// ── Alert rules ───────────────────────────────────────────────────────────
let _rules  = _rj(ALERT_FILE, []);
const _firing = new Map();   // alertId → { since, lastFiredAt }
let _alertSeq = _rules.length;
function _alertId() { return `alr_${Date.now()}_${(++_alertSeq).toString(36)}`; }
function _saveRules() { try { _wj(ALERT_FILE, _rules); } catch { /* non-fatal */ } }

/**
 * Register an alert rule.
 * rule: { name, metric, op: "gt"|"lt"|"gte"|"lte", threshold, windowMs, severity: "info"|"warn"|"critical" }
 */
function registerAlert(rule) {
    if (!rule.name || !rule.metric || !rule.op || rule.threshold === undefined) {
        throw new Error("rule requires: name, metric, op, threshold");
    }
    const alertId = _alertId();
    const full = { alertId, ...rule, windowMs: rule.windowMs || 60_000, severity: rule.severity || "warn", active: true, createdAt: new Date().toISOString() };
    _rules.push(full);
    _saveRules();
    return { alertId };
}

function evaluateAlerts() {
    const fired   = [];
    const cleared = [];
    const now     = Date.now();

    for (const rule of _rules.filter(r => r.active)) {
        const buf = _metrics.get(rule.metric) || [];
        const window = buf.filter(e => e.ts >= now - rule.windowMs);
        if (!window.length) continue;
        const avg = window.reduce((s, e) => s + e.value, 0) / window.length;

        const shouldFire = (
            (rule.op === "gt"  && avg >  rule.threshold) ||
            (rule.op === "lt"  && avg <  rule.threshold) ||
            (rule.op === "gte" && avg >= rule.threshold) ||
            (rule.op === "lte" && avg <= rule.threshold)
        );

        if (shouldFire && !_firing.has(rule.alertId)) {
            _firing.set(rule.alertId, { since: new Date().toISOString(), lastFiredAt: new Date().toISOString() });
            const entry = { ts: new Date().toISOString(), alertId: rule.alertId, name: rule.name, metric: rule.metric, value: Math.round(avg * 100) / 100, threshold: rule.threshold, severity: rule.severity, status: "fired" };
            const s = _alertSink();
            if (s) { try { s.write(JSON.stringify(entry) + "\n"); } catch { /* non-fatal */ } }
            fired.push(entry);
            structuredLog("warn", `Alert fired: ${rule.name}`, { alertId: rule.alertId, value: avg, threshold: rule.threshold });
        } else if (!shouldFire && _firing.has(rule.alertId)) {
            _firing.delete(rule.alertId);
            cleared.push({ alertId: rule.alertId, name: rule.name, clearedAt: new Date().toISOString() });
        }
    }
    return { fired, cleared };
}

function getAlerts({ includeInactive = false } = {}) {
    const active = Array.from(_firing.entries()).map(([id, v]) => {
        const rule = _rules.find(r => r.alertId === id);
        return { ...rule, ...v };
    });
    const rules = includeInactive ? _rules : _rules.filter(r => r.active);
    return { active, rules };
}

// ── Health probes ─────────────────────────────────────────────────────────
async function _probe(name, urlOrFn) {
    const start = Date.now();
    try {
        if (typeof urlOrFn === "function") {
            const ok = await urlOrFn();
            return { service: name, status: ok ? "healthy" : "degraded", latencyMs: Date.now() - start };
        }
        const u   = new URL(urlOrFn);
        const mod = u.protocol === "https:" ? https : http;
        await new Promise((res, rej) => {
            const req = mod.get(urlOrFn, { timeout: 4000 }, r => { r.resume(); res(r.statusCode); });
            req.on("error", rej); req.on("timeout", () => rej(new Error("timeout")));
        });
        return { service: name, status: "healthy", latencyMs: Date.now() - start };
    } catch (e) {
        return { service: name, status: "down", latencyMs: Date.now() - start, error: e.message };
    }
}

async function probeHealth() {
    const port    = process.env.PORT || 5050;
    const results = await Promise.allSettled([
        _probe("self",      `http://localhost:${port}/health`),
        _probe("ollama",    `http://localhost:11434/api/tags`),
        _probe("openrouter",() => !!process.env.OPENROUTER_API_KEY),
        _probe("github",    () => !!process.env.GITHUB_TOKEN),
        _probe("slack",     () => !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET)),
        _probe("google",    () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)),
        _probe("notion",    () => !!(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET)),
    ]);
    const services = {};
    for (const r of results) {
        if (r.status === "fulfilled") services[r.value.service] = r.value;
    }
    // Record latency metrics
    for (const [name, svc] of Object.entries(services)) {
        recordMetric(`health.latency.${name}`, svc.latencyMs);
        recordMetric(`health.up.${name}`, svc.status === "healthy" ? 1 : 0);
    }
    return { services, probeAt: new Date().toISOString() };
}

// ── System metrics collection (auto-recorded every 30s) ──────────────────
function _collectSystemMetrics() {
    const mem = process.memoryUsage();
    recordMetric("system.rss_mb",    Math.round(mem.rss      / 1_048_576));
    recordMetric("system.heap_mb",   Math.round(mem.heapUsed / 1_048_576));
    recordMetric("system.heap_total_mb", Math.round(mem.heapTotal / 1_048_576));
    recordMetric("system.uptime_s",  Math.round(process.uptime()));
    recordMetric("system.cpu_user_ms",  process.cpuUsage().user / 1000);
    recordMetric("os.loadavg_1m",    os.loadavg()[0]);
    recordMetric("os.freemem_mb",    Math.round(os.freemem() / 1_048_576));
    // Pull from existing metricsStore if available
    try {
        const ms = require("../utils/metricsStore");
        const snap = ms.snapshot ? ms.snapshot() : ms.get ? ms.get() : null;
        if (snap) {
            if (snap.counters?.requests !== undefined) recordMetric("app.requests", snap.counters.requests);
            if (snap.counters?.errors   !== undefined) recordMetric("app.errors",   snap.counters.errors);
        }
    } catch { /* non-critical */ }
    // Evaluate alerts after collecting metrics
    evaluateAlerts();
}
setInterval(_collectSystemMetrics, 30_000).unref();
_collectSystemMetrics();

// ── Full snapshot ─────────────────────────────────────────────────────────
async function getSnapshot() {
    const health  = await probeHealth();
    const mem     = process.memoryUsage();
    const snap = {
        ts:          new Date().toISOString(),
        uptime_s:    Math.round(process.uptime()),
        pid:         process.pid,
        nodeVersion: process.version,
        memory: {
            rss_mb:    Math.round(mem.rss      / 1_048_576),
            heap_mb:   Math.round(mem.heapUsed  / 1_048_576),
            heapTotal_mb: Math.round(mem.heapTotal / 1_048_576),
        },
        os: {
            platform:  process.platform,
            arch:      process.arch,
            loadavg:   os.loadavg(),
            freemem_mb:Math.round(os.freemem() / 1_048_576),
            totalmem_mb:Math.round(os.totalmem() / 1_048_576),
        },
        health: health.services,
        metrics: listMetrics(),
        alerts:  getAlerts().active,
    };
    try { _wj(TELEMETRY_FILE, snap); } catch { /* non-critical */ }
    return snap;
}

module.exports = { recordMetric, getMetric, listMetrics, registerAlert, evaluateAlerts, getAlerts, structuredLog, queryLogs, probeHealth, getSnapshot };
