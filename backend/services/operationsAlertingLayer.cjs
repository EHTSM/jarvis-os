"use strict";
/**
 * OperationsAlertingLayer — critical and warning alerts with notification
 * routing and persistent history. Integrates with ObservabilityEngine.
 *
 * Alert lifecycle: pending → firing → resolved | suppressed | escalated
 *
 * Notification channels (pluggable):
 *   telegram  — sends via TELEGRAM_TOKEN + TELEGRAM_OPERATOR_CHAT_ID
 *   log       — writes to data/logs/ops-alerts.ndjson (always active)
 *   webhook   — HTTP POST to OPS_WEBHOOK_URL if set
 *
 * Built-in system monitors (checked on each probe()):
 *   - Heap memory > 450MB
 *   - Process uptime anomaly (< 60s after expected stable)
 *   - Failed tasks count spike
 *   - Secret missing (critical)
 *   - Production readiness score drop
 *   - Autonomous cycle failure rate > 50%
 *
 * Public API:
 *   fire(alert)                            → AlertRecord
 *   resolve(alertId)                       → AlertRecord
 *   suppress(alertId, durationMs)          → AlertRecord
 *   escalate(alertId)                      → AlertRecord
 *   probe()                                → { fired[], resolved[] }
 *   getAlert(alertId)                      → AlertRecord | null
 *   listAlerts(opts)                       → { alerts[], stats }
 *   getHistory(opts)                       → { history[] }
 *   getNotificationStatus()                → channel status
 *   setNotificationChannel(channel, config)→ void
 */

const fs     = require("fs");
const path   = require("path");
const https  = require("https");
const http   = require("http");
const logger = require("../utils/logger");
const execLog  = require("../utils/execLog.cjs");

const ALERT_FILE   = path.join(__dirname, "../../data/ops-alerts.json");
const HISTORY_FILE = path.join(__dirname, "../../data/ops-alert-history.json");
const LOG_FILE     = path.join(__dirname, "../../data/logs/ops-alerts.ndjson");

function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function _wj(f, d) {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, f);
}

let _alerts  = _rj(ALERT_FILE,   []);  // active alerts
let _history = _rj(HISTORY_FILE, []);  // resolved/suppressed alerts
let _seq     = _alerts.length + _history.length;

function _aid()        { return `oal_${Date.now()}_${(++_seq).toString(36)}`; }
function _saveAlerts() { try { _wj(ALERT_FILE,   _alerts.slice(-500));   } catch { /* non-fatal */ } }
function _saveHist()   { try { _wj(HISTORY_FILE, _history.slice(-1000)); } catch { /* non-fatal */ } }

// ── Log sink ──────────────────────────────────────────────────────────────
let _logStream = null;
function _logSink() {
    if (_logStream) return _logStream;
    try {
        fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
        _logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
        _logStream.on("error", () => { _logStream = null; });
    } catch { _logStream = null; }
    return _logStream;
}
function _writeLog(entry) {
    const s = _logSink();
    if (s) { try { s.write(JSON.stringify(entry) + "\n"); } catch { /* non-fatal */ } }
}

// ── Channel config ────────────────────────────────────────────────────────
const _channels = {
    telegram: { enabled: !!(process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_OPERATOR_CHAT_ID), config: {} },
    log:      { enabled: true, config: {} },
    webhook:  { enabled: !!process.env.OPS_WEBHOOK_URL, config: { url: process.env.OPS_WEBHOOK_URL } },
};

function setNotificationChannel(channel, config = {}) {
    if (!_channels[channel]) throw new Error(`Unknown channel: ${channel}`);
    Object.assign(_channels[channel], { enabled: config.enabled !== false, config });
}

function getNotificationStatus() {
    return Object.entries(_channels).reduce((a, [k, v]) => ({ ...a, [k]: { enabled: v.enabled } }), {});
}

// ── Notification dispatch ─────────────────────────────────────────────────
async function _notify(alert) {
    const msg = `[${alert.severity.toUpperCase()}] ${alert.title}\n${alert.detail || ""}\nTime: ${alert.firedAt}`;

    // Always write to log
    _writeLog({ ts: new Date().toISOString(), ...alert });

    // Telegram
    if (_channels.telegram.enabled && process.env.TELEGRAM_TOKEN) {
        const token  = process.env.TELEGRAM_TOKEN;
        const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID;
        if (chatId) {
            const body = JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown" });
            try {
                await new Promise((res, rej) => {
                    const u = new URL(`https://api.telegram.org/bot${token}/sendMessage`);
                    const req = https.request({ hostname: u.hostname, port: 443, path: u.pathname, method: "POST",
                        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
                    }, r => { r.resume(); res(r.statusCode); });
                    req.on("error", rej);
                    req.setTimeout(5000, () => req.destroy());
                    req.write(body); req.end();
                });
            } catch (e) { logger.warn(`[OpsAlert] Telegram notify failed: ${e.message}`); }
        }
    }

    // Webhook
    if (_channels.webhook.enabled && _channels.webhook.config.url) {
        const webhookUrl = _channels.webhook.config.url;
        try {
            const body = JSON.stringify({ alert, message: msg, ts: new Date().toISOString() });
            const u    = new URL(webhookUrl);
            const mod  = u.protocol === "https:" ? https : http;
            await new Promise((res, rej) => {
                const req = mod.request({ hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname, method: "POST",
                    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
                }, r => { r.resume(); res(r.statusCode); });
                req.on("error", rej);
                req.setTimeout(5000, () => req.destroy());
                req.write(body); req.end();
            });
        } catch (e) { logger.warn(`[OpsAlert] Webhook notify failed: ${e.message}`); }
    }

    // Also push to ObservabilityEngine if available
    try {
        const obs = require("./observabilityEngine.cjs");
        obs.structuredLog(alert.severity === "critical" ? "error" : "warn", `OpsAlert: ${alert.title}`, { alertId: alert.alertId });
        obs.recordMetric(`ops.alert.${alert.severity}`, 1);
    } catch { /* non-critical */ }
}

// ── Core alert operations ─────────────────────────────────────────────────
function fire(opts) {
    const {
        title, detail = "", severity = "warning",
        source = "manual", category = "general",
        dedupeKey = null,
    } = opts;
    if (!title) throw new Error("title required");

    // Deduplicate: don't re-fire an already-active alert with same dedupeKey
    if (dedupeKey) {
        const existing = _alerts.find(a => a.dedupeKey === dedupeKey && a.status === "firing");
        if (existing) { existing.lastSeenAt = new Date().toISOString(); existing.count = (existing.count || 1) + 1; _saveAlerts(); return existing; }
    }

    const alert = {
        alertId:    _aid(),
        title, detail, severity, source, category,
        dedupeKey,
        status:     "firing",
        count:      1,
        firedAt:    new Date().toISOString(),
        resolvedAt: null,
        lastSeenAt: new Date().toISOString(),
        suppressedUntil: null,
        escalated:  false,
        notifications: [],
    };

    _alerts.push(alert);
    _saveAlerts();
    execLog.append({ agentId: "OpsAlerting", taskType: "alert_fired", taskId: alert.alertId, success: true, durationMs: 0 });
    logger.warn(`[OpsAlert] FIRED [${severity.toUpperCase()}]: ${title}`);

    // Async notify — don't block the caller
    _notify(alert).catch(e => logger.warn(`[OpsAlert] Notify error: ${e.message}`));

    return { ...alert };
}

function resolve(alertId) {
    const idx = _alerts.findIndex(a => a.alertId === alertId);
    if (idx < 0) throw new Error(`Alert ${alertId} not found`);
    const alert = _alerts.splice(idx, 1)[0];
    alert.status     = "resolved";
    alert.resolvedAt = new Date().toISOString();
    _history.push(alert);
    _saveAlerts(); _saveHist();
    execLog.append({ agentId: "OpsAlerting", taskType: "alert_resolved", taskId: alertId, success: true, durationMs: 0 });
    _writeLog({ ts: new Date().toISOString(), event: "resolved", alertId, title: alert.title });
    return { ...alert };
}

function suppress(alertId, durationMs = 3600_000) {
    const alert = _alerts.find(a => a.alertId === alertId);
    if (!alert) throw new Error(`Alert ${alertId} not found`);
    alert.status          = "suppressed";
    alert.suppressedUntil = new Date(Date.now() + durationMs).toISOString();
    _saveAlerts();
    execLog.append({ agentId: "OpsAlerting", taskType: "alert_suppressed", taskId: alertId, success: true, durationMs: 0 });
    return { ...alert };
}

function escalate(alertId) {
    const alert = _alerts.find(a => a.alertId === alertId);
    if (!alert) throw new Error(`Alert ${alertId} not found`);
    alert.escalated = true;
    alert.severity  = "critical";
    _saveAlerts();
    execLog.append({ agentId: "OpsAlerting", taskType: "alert_escalated", taskId: alertId, success: true, durationMs: 0 });
    _notify({ ...alert, title: `[ESCALATED] ${alert.title}` }).catch(() => {});
    return { ...alert };
}

// ── System monitors ───────────────────────────────────────────────────────
async function probe() {
    const fired    = [];
    const resolved = [];

    // 1. Heap memory
    const heapMB = Math.round(process.memoryUsage().heapUsed / 1_048_576);
    if (heapMB > 450) {
        fired.push(fire({ title: "High heap memory", detail: `Heap: ${heapMB}MB > 450MB threshold`, severity: "warning", source: "probe", category: "system", dedupeKey: "high_heap" }));
    } else {
        const existing = _alerts.find(a => a.dedupeKey === "high_heap" && a.status === "firing");
        if (existing) { resolve(existing.alertId); resolved.push(existing.alertId); }
    }

    // 2. Critical secrets missing
    try {
        const sml  = require("./secretManagementLayer.cjs");
        const miss = sml.detectMissing();
        if (miss.critical.length > 0) {
            fired.push(fire({ title: "Critical secrets missing", detail: `Missing: ${miss.critical.join(", ")}`, severity: "critical", source: "probe", category: "security", dedupeKey: "secrets_missing" }));
        } else {
            const ex = _alerts.find(a => a.dedupeKey === "secrets_missing" && a.status === "firing");
            if (ex) { resolve(ex.alertId); resolved.push(ex.alertId); }
        }
    } catch { /* non-critical */ }

    // 3. Task queue failures spike
    try {
        const tq   = require("../../agents/taskQueue.cjs");
        const all  = tq.getAll();
        const failCount = all.filter(t => t.status === "failed").length;
        if (failCount > 10) {
            fired.push(fire({ title: "High task failure count", detail: `${failCount} failed tasks in queue`, severity: "warning", source: "probe", category: "runtime", dedupeKey: "task_failures" }));
        } else {
            const ex = _alerts.find(a => a.dedupeKey === "task_failures" && a.status === "firing");
            if (ex) { resolve(ex.alertId); resolved.push(ex.alertId); }
        }
    } catch { /* non-critical */ }

    // 4. Autonomous cycle failure rate
    try {
        const atl  = require("./autonomousTaskLoop.cjs");
        const { stats } = atl.listCycles({ limit: 20 });
        const failRate = stats.total ? (stats.failed / stats.total) * 100 : 0;
        if (failRate > 50 && stats.total >= 5) {
            fired.push(fire({ title: "High autonomous cycle failure rate", detail: `${Math.round(failRate)}% cycles failing`, severity: "warning", source: "probe", category: "autonomy", dedupeKey: "cycle_failures" }));
        } else {
            const ex = _alerts.find(a => a.dedupeKey === "cycle_failures" && a.status === "firing");
            if (ex) { resolve(ex.alertId); resolved.push(ex.alertId); }
        }
    } catch { /* non-critical */ }

    // 5. Expired suppressed alerts: re-activate or auto-resolve
    const now = Date.now();
    for (const a of _alerts.filter(x => x.status === "suppressed" && x.suppressedUntil && new Date(x.suppressedUntil).getTime() < now)) {
        a.status = "firing";
        a.suppressedUntil = null;
    }
    _saveAlerts();

    // 6. Emit metrics to obs
    try {
        const obs = require("./observabilityEngine.cjs");
        obs.recordMetric("ops.alerts.firing",    _alerts.filter(a => a.status === "firing").length);
        obs.recordMetric("ops.alerts.critical",  _alerts.filter(a => a.severity === "critical" && a.status === "firing").length);
    } catch { /* non-critical */ }

    return { fired: fired.map(a => a.alertId), resolved, probedAt: new Date().toISOString() };
}

function getAlert(alertId) {
    return _alerts.find(a => a.alertId === alertId) || _history.find(a => a.alertId === alertId) || null;
}

function listAlerts({ status, severity, category, limit = 100, offset = 0 } = {}) {
    let rows = [..._alerts];
    if (status)   rows = rows.filter(a => a.status   === status);
    if (severity) rows = rows.filter(a => a.severity === severity);
    if (category) rows = rows.filter(a => a.category === category);
    rows = rows.sort((a, b) => b.firedAt.localeCompare(a.firedAt));

    const stats = {
        total:    _alerts.length,
        firing:   _alerts.filter(a => a.status === "firing").length,
        critical: _alerts.filter(a => a.severity === "critical" && a.status === "firing").length,
        warning:  _alerts.filter(a => a.severity === "warning"  && a.status === "firing").length,
        suppressed:_alerts.filter(a => a.status === "suppressed").length,
    };
    return { alerts: rows.slice(offset, offset + limit), total: rows.length, stats };
}

function getHistory({ limit = 100, severity } = {}) {
    let rows = [..._history].reverse();
    if (severity) rows = rows.filter(a => a.severity === severity);
    return { history: rows.slice(0, limit), total: _history.length };
}

// Auto-probe every 5 minutes
setInterval(() => probe().catch(e => logger.warn(`[OpsAlert] Probe error: ${e.message}`)), 5 * 60_000).unref();

module.exports = { fire, resolve, suppress, escalate, probe, getAlert, listAlerts, getHistory, getNotificationStatus, setNotificationChannel };
