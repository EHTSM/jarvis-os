/**
 * Analytics Agent — tracks usage events and produces stats.
 * Persists to data/analytics.json (ring buffer, last 2000 events).
 */

const fs   = require("fs");
const path = require("path");

const FILE     = path.join(__dirname, "../../data/analytics.json");
const MAX_ROWS = 2000;

function _read() {
    try {
        if (!fs.existsSync(FILE)) return [];
        return JSON.parse(fs.readFileSync(FILE, "utf8")) || [];
    } catch { return []; }
}

function _write(data) {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

const EVENT_TYPES = ["message_sent", "conversion", "payment_created", "lead_added", "campaign_sent", "login", "api_call"];

function track(eventType, meta = {}) {
    if (!EVENT_TYPES.includes(eventType)) return;
    const rows = _read();
    rows.push({ event: eventType, ts: new Date().toISOString(), ...meta });
    if (rows.length > MAX_ROWS) rows.splice(0, rows.length - MAX_ROWS);
    _write(rows);
}

function _stats(rows, windowDays = 7) {
    const now    = new Date();
    const cutoff = new Date(now.getTime() - windowDays * 86400000);
    const recent = rows.filter(r => new Date(r.ts) >= cutoff);

    const byType = {};
    for (const row of recent) {
        byType[row.event] = (byType[row.event] || 0) + 1;
    }

    const conversions = recent.filter(r => r.event === "conversion").length;
    const messages    = recent.filter(r => r.event === "message_sent").length;
    const rate        = messages > 0 ? ((conversions / messages) * 100).toFixed(1) + "%" : "0%";

    return {
        window_days:       windowDays,
        total_events:      recent.length,
        by_type:           byType,
        messages_sent:     messages,
        conversions:       conversions,
        conversion_rate:   rate,
        payments_created:  byType.payment_created  || 0,
        campaigns_sent:    byType.campaign_sent     || 0,
        leads_added:       byType.lead_added        || 0
    };
}

async function run(task) {
    const p = task.payload || {};

    switch (task.type) {
        case "analytics_stats":
        case "get_analytics":
        case "usage_stats": {
            const rows = _read();
            return { success: true, type: "analyticsAgent", data: _stats(rows, p.days || 7) };
        }

        case "track_event": {
            if (!p.event) return { success: false, type: "analyticsAgent", data: { error: "event required" } };
            track(p.event, p.meta || {});
            return { success: true, type: "analyticsAgent", data: { tracked: p.event } };
        }

        case "event_types":
            return { success: true, type: "analyticsAgent", data: { eventTypes: EVENT_TYPES } };

        default:
            return { success: true, type: "analyticsAgent", data: _stats(_read(), 7) };
    }
}

module.exports = { run, track, stats: (days = 7) => _stats(_read(), days) };
