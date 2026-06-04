"use strict";
/**
 * EnterpriseObservability
 *
 * Capabilities:
 *   - Metrics aggregation (counters, gauges, histograms, rates)
 *   - Distributed traces (spans, trace context propagation)
 *   - Service dependency map (live call graph from trace data)
 *   - Alert routing (threshold-based, routed to configured channels)
 *   - SLO monitoring (error budget, burn rate, remaining budget)
 *
 * Persistence: data/observability.json  (rolling window, capped)
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");

const STORE_PATH = path.join(__dirname, "../../data/observability.json");

// ── Persistence ───────────────────────────────────────────────────────────────

function _load() {
    try { return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")); }
    catch { return { metrics: {}, traces: [], alerts: [], slos: {}, alertRules: {}, channels: {}, seq: 0 }; }
}
function _save(d) {
    // cap traces at 2000 and alerts at 500
    if (d.traces?.length  > 2000) d.traces  = d.traces.slice(-2000);
    if (d.alerts?.length  > 500)  d.alerts  = d.alerts.slice(-500);
    fs.writeFileSync(STORE_PATH, JSON.stringify(d, null, 2));
}
function _id(prefix, store) { store.seq = (store.seq || 0) + 1; return `${prefix}-${store.seq}`; }

// ── Metrics aggregation ───────────────────────────────────────────────────────

function recordMetric(service, name, value, type = "gauge", labels = {}) {
    const store = _load();
    if (!store.metrics[service]) store.metrics[service] = {};
    const key   = name + (Object.keys(labels).length ? ":" + JSON.stringify(labels) : "");
    const prev  = store.metrics[service][key];
    const now   = Date.now();

    let updated;
    if (type === "counter") {
        updated = { type, name, labels, value: (prev?.value || 0) + value, lastUpdated: now };
    } else if (type === "histogram") {
        const samples = [...(prev?.samples || []), value].slice(-100);
        updated = {
            type, name, labels,
            samples,
            count: samples.length,
            sum:   samples.reduce((s, v) => s + v, 0),
            min:   Math.min(...samples),
            max:   Math.max(...samples),
            avg:   Math.round(samples.reduce((s, v) => s + v, 0) / samples.length * 100) / 100,
            p50:   _percentile(samples, 50),
            p95:   _percentile(samples, 95),
            p99:   _percentile(samples, 99),
            lastUpdated: now,
        };
    } else {
        // gauge
        updated = { type, name, labels, value, lastUpdated: now };
    }

    store.metrics[service][key] = updated;
    _save(store);
    _checkAlertRules(store, service, name, value);
    return updated;
}

function _percentile(sorted, p) {
    const arr = [...sorted].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, idx)] ?? 0;
}

function getMetrics(service) {
    const store = _load();
    if (service) return store.metrics[service] || {};
    return store.metrics;
}

function getSystemMetrics() {
    const memUsed = os.totalmem() - os.freemem();
    const loadAvg = os.loadavg();
    const uptime  = os.uptime();
    const procMem = process.memoryUsage();

    return {
        system: {
            memUsedMB:    Math.round(memUsed / 1024 / 1024),
            memTotalMB:   Math.round(os.totalmem() / 1024 / 1024),
            memPct:       Math.round(memUsed / os.totalmem() * 100),
            loadAvg1:     Math.round(loadAvg[0] * 100) / 100,
            loadAvg5:     Math.round(loadAvg[1] * 100) / 100,
            cpus:         os.cpus().length,
            uptimeHours:  Math.round(uptime / 3600 * 10) / 10,
            platform:     os.platform(),
        },
        process: {
            heapUsedMB:   Math.round(procMem.heapUsed / 1024 / 1024),
            heapTotalMB:  Math.round(procMem.heapTotal / 1024 / 1024),
            rssMB:        Math.round(procMem.rss / 1024 / 1024),
            uptimeSec:    Math.round(process.uptime()),
            pid:          process.pid,
        },
        collectedAt: new Date().toISOString(),
    };
}

// ── Distributed traces ────────────────────────────────────────────────────────

function startSpan(traceId, service, operation, parentSpanId = null, meta = {}) {
    const store  = _load();
    const spanId = _id("span", store);
    const span   = {
        traceId,
        spanId,
        parentSpanId,
        service,
        operation,
        startTs:  Date.now(),
        endTs:    null,
        durationMs: null,
        status:   "running",
        meta,
        events:   [],
    };
    store.traces.push(span);
    _save(store);
    return span;
}

function endSpan(spanId, status = "ok", error = null) {
    const store = _load();
    const span  = store.traces.find(s => s.spanId === spanId);
    if (!span) throw new Error("Span not found");
    span.endTs      = Date.now();
    span.durationMs = span.endTs - span.startTs;
    span.status     = status;
    if (error) span.error = error;
    _save(store);
    return span;
}

function addSpanEvent(spanId, name, attrs = {}) {
    const store = _load();
    const span  = store.traces.find(s => s.spanId === spanId);
    if (!span) throw new Error("Span not found");
    span.events.push({ name, attrs, ts: Date.now() });
    _save(store);
    return span;
}

function getTrace(traceId) {
    const store  = _load();
    const spans  = store.traces.filter(s => s.traceId === traceId);
    if (!spans.length) throw new Error("Trace not found");
    return {
        traceId,
        spans,
        totalDurationMs: Math.max(...spans.filter(s => s.durationMs).map(s => s.durationMs || 0), 0),
        services: [...new Set(spans.map(s => s.service))],
        status:   spans.some(s => s.status === "error") ? "error" : "ok",
    };
}

function listTraces(service, limit = 20) {
    const store  = _load();
    const traces = store.traces.filter(s => !service || s.service === service);
    // group by traceId
    const byTrace = {};
    for (const s of traces) {
        if (!byTrace[s.traceId]) byTrace[s.traceId] = [];
        byTrace[s.traceId].push(s);
    }
    return Object.values(byTrace).slice(-limit).map(spans => ({
        traceId:    spans[0].traceId,
        service:    spans[0].service,
        operation:  spans[0].operation,
        startTs:    spans[0].startTs,
        durationMs: Math.max(...spans.filter(s => s.durationMs).map(s => s.durationMs || 0), 0),
        spanCount:  spans.length,
        status:     spans.some(s => s.status === "error") ? "error" : "ok",
    }));
}

// ── Service dependency map ────────────────────────────────────────────────────

function getServiceMap() {
    const store = _load();
    const edges = {};
    for (const span of store.traces) {
        if (!span.parentSpanId) continue;
        const parent = store.traces.find(s => s.spanId === span.parentSpanId);
        if (!parent || parent.service === span.service) continue;
        const key = `${parent.service}→${span.service}`;
        if (!edges[key]) edges[key] = { from: parent.service, to: span.service, calls: 0, errors: 0, totalMs: 0 };
        edges[key].calls++;
        if (span.status === "error") edges[key].errors++;
        if (span.durationMs) edges[key].totalMs += span.durationMs;
    }
    const edgeList = Object.values(edges).map(e => ({
        ...e,
        errorRate: Math.round(e.errors / e.calls * 100),
        avgMs:     Math.round(e.totalMs / e.calls),
    }));
    const services = [...new Set([...edgeList.map(e => e.from), ...edgeList.map(e => e.to)])];
    return { services, edges: edgeList, generatedAt: new Date().toISOString() };
}

// ── Alert rules + routing ─────────────────────────────────────────────────────

function setAlertRule(ruleId, opts) {
    const store = _load();
    store.alertRules[ruleId] = {
        ruleId,
        service:    opts.service || "*",
        metric:     opts.metric,
        threshold:  opts.threshold,
        operator:   opts.operator || "gt",  // gt | lt | eq
        severity:   opts.severity || "warning",
        channel:    opts.channel  || "log",
        enabled:    opts.enabled !== false,
        createdAt:  new Date().toISOString(),
    };
    _save(store);
    return store.alertRules[ruleId];
}

function _checkAlertRules(store, service, metric, value) {
    for (const rule of Object.values(store.alertRules || {})) {
        if (!rule.enabled) continue;
        if (rule.service !== "*" && rule.service !== service) continue;
        if (rule.metric !== metric) continue;
        const triggered =
            rule.operator === "gt" ? value >  rule.threshold :
            rule.operator === "lt" ? value <  rule.threshold :
            rule.operator === "eq" ? value === rule.threshold : false;
        if (triggered) {
            _fireAlert(store, { rule: rule.ruleId, service, metric, value, threshold: rule.threshold, severity: rule.severity, channel: rule.channel });
        }
    }
}

function _fireAlert(store, data) {
    const alertId = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    store.alerts.push({ alertId, ...data, firedAt: new Date().toISOString(), resolved: false });
    // In production, route to configured channels (Slack, PagerDuty, email etc.)
    // Here we log — channel integrations plug in via /p25/obs/channels
    console.warn(`[Alert] ${data.severity.toUpperCase()} ${data.service}/${data.metric}=${data.value} (threshold=${data.threshold}) → ${data.channel}`);
}

function fireManualAlert(data) {
    const store = _load();
    _fireAlert(store, data);
    _save(store);
}

function resolveAlert(alertId) {
    const store = _load();
    const alert = store.alerts.find(a => a.alertId === alertId);
    if (!alert) throw new Error("Alert not found");
    alert.resolved   = true;
    alert.resolvedAt = new Date().toISOString();
    _save(store);
    return alert;
}

function listAlerts(opts = {}) {
    const store  = _load();
    let alerts   = store.alerts || [];
    if (opts.unresolved) alerts = alerts.filter(a => !a.resolved);
    if (opts.service)    alerts = alerts.filter(a => a.service === opts.service);
    if (opts.severity)   alerts = alerts.filter(a => a.severity === opts.severity);
    return alerts.slice(-(opts.limit || 100));
}

function setChannel(channelId, config) {
    const store = _load();
    if (!store.channels) store.channels = {};
    store.channels[channelId] = { channelId, ...config, updatedAt: new Date().toISOString() };
    _save(store);
    return store.channels[channelId];
}

function listChannels() { return Object.values(_load().channels || {}); }
function listAlertRules() { return Object.values(_load().alertRules || {}); }

// ── SLO monitoring ────────────────────────────────────────────────────────────

function setSLO(sloId, opts) {
    const store = _load();
    store.slos[sloId] = {
        sloId,
        service:         opts.service,
        name:            opts.name    || sloId,
        targetPct:       opts.targetPct || 99.9,    // e.g. 99.9%
        windowDays:      opts.windowDays || 30,
        errorBudgetPct:  100 - (opts.targetPct || 99.9),
        createdAt:       new Date().toISOString(),
        events:          [],
    };
    _save(store);
    return store.slos[sloId];
}

function recordSLOEvent(sloId, good) {
    const store = _load();
    const slo   = store.slos[sloId];
    if (!slo) throw new Error("SLO not found");
    const windowMs = slo.windowDays * 86400000;
    const cutoff   = Date.now() - windowMs;
    slo.events.push({ ts: Date.now(), good: !!good });
    // trim to window
    slo.events = slo.events.filter(e => e.ts >= cutoff);
    _save(store);
    return _computeSLO(slo);
}

function getSLOStatus(sloId) {
    const slo = _load().slos[sloId];
    if (!slo) throw new Error("SLO not found");
    return _computeSLO(slo);
}

function _computeSLO(slo) {
    const total     = slo.events.length;
    const goodCount = slo.events.filter(e => e.good).length;
    const actualPct = total ? Math.round(goodCount / total * 10000) / 100 : 100;
    const errorBudgetUsedPct = Math.max(0, ((slo.targetPct - actualPct) / slo.errorBudgetPct) * 100);
    const burnRate  = errorBudgetUsedPct / 100;

    return {
        sloId:            slo.sloId,
        service:          slo.service,
        name:             slo.name,
        targetPct:        slo.targetPct,
        actualPct,
        windowDays:       slo.windowDays,
        totalEvents:      total,
        goodEvents:       goodCount,
        errorBudgetPct:   slo.errorBudgetPct,
        errorBudgetUsedPct: Math.round(errorBudgetUsedPct * 100) / 100,
        errorBudgetRemaining: Math.max(0, 100 - errorBudgetUsedPct),
        burnRate:         Math.round(burnRate * 100) / 100,
        status:           actualPct >= slo.targetPct ? "ok" : errorBudgetUsedPct >= 100 ? "breached" : "at-risk",
        computedAt:       new Date().toISOString(),
    };
}

function listSLOs() {
    return Object.values(_load().slos || {}).map(slo => _computeSLO(slo));
}

module.exports = {
    recordMetric, getMetrics, getSystemMetrics,
    startSpan, endSpan, addSpanEvent, getTrace, listTraces,
    getServiceMap,
    setAlertRule, fireManualAlert, resolveAlert, listAlerts, setChannel, listChannels, listAlertRules,
    setSLO, recordSLOEvent, getSLOStatus, listSLOs,
};
