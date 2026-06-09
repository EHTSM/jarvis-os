"use strict";
/**
 * Phase 744 — Platform Health Projection
 *
 * Projects platform health trajectory based on recent signal trends.
 * Provides 1h, 4h, and 24h health outlooks using current degradation rates.
 * Never auto-remediates — projection data only.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const DATA_FILE   = path.join(__dirname, "../../data/platform-health-projection.json");
const MAX_SNAPSHOTS = 200;

function _load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
    catch { return { snapshots: [] }; }
}
function _save(db) {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {}
}

function captureHealthSnapshot() {
    const snapshot = { ts: Date.now(), dimensions: {} };

    const cpi = _tryRequire("./crossPhaseIntelligence.cjs");
    if (cpi) {
        try {
            const r = cpi.crossPhaseHealthReport();
            snapshot.dimensions.phases = { healthy: r.healthy, degraded: r.degraded, total: r.total };
        } catch {}
    }

    const psa = _tryRequire("./platformSignalAggregation.cjs");
    if (psa) {
        try {
            const r = psa.aggregateSignals({ maxAge: 60 * 60 * 1000 });
            snapshot.dimensions.signals = { critical: r.criticalCount, warnings: r.warningCount };
        } catch {}
    }

    const ois = _tryRequire("./operatorIntelligenceSurface.cjs");
    if (ois) {
        try {
            const r = ois.platformHealthSummary();
            snapshot.dimensions.platform = { ok: r.ok, level: r.level, critical: r.totalCrit };
        } catch {}
    }

    snapshot.ok = snapshot.dimensions.platform?.ok !== false && (snapshot.dimensions.signals?.critical || 0) === 0;

    const db = _load();
    db.snapshots.push(snapshot);
    if (db.snapshots.length > MAX_SNAPSHOTS) db.snapshots = db.snapshots.slice(-MAX_SNAPSHOTS);
    _save(db);

    return { ok: true, snapshot };
}

function _trendOver(snapshots, windowMs) {
    const now = Date.now();
    const windowed = snapshots.filter(s => now - s.ts <= windowMs);
    if (windowed.length < 2) return { trend: "unknown", dataPoints: windowed.length };

    const first = windowed[0];
    const last  = windowed[windowed.length - 1];

    const firstCrit = first.dimensions.signals?.critical || 0;
    const lastCrit  = last.dimensions.signals?.critical  || 0;
    const firstDeg  = first.dimensions.phases?.degraded  || 0;
    const lastDeg   = last.dimensions.phases?.degraded   || 0;

    const critDelta = lastCrit - firstCrit;
    const degDelta  = lastDeg  - firstDeg;

    const trend = (critDelta > 2 || degDelta > 1) ? "degrading" :
                  (critDelta < -1 || degDelta < 0) ? "improving" : "stable";

    return { trend, critDelta, degDelta, dataPoints: windowed.length };
}

function projectHealthOutlook() {
    const db = _load();

    const trend1h  = _trendOver(db.snapshots, 60 * 60 * 1000);
    const trend4h  = _trendOver(db.snapshots, 4 * 60 * 60 * 1000);
    const trend24h = _trendOver(db.snapshots, 24 * 60 * 60 * 1000);

    const currentOk = db.snapshots.length > 0 ? db.snapshots[db.snapshots.length - 1].ok : true;

    function _outlook(trend) {
        if (!currentOk && trend.trend === "degrading") return "critical";
        if (!currentOk && trend.trend === "stable")    return "watch";
        if (currentOk  && trend.trend === "degrading") return "watch";
        return "nominal";
    }

    return {
        ok:      currentOk,
        current: currentOk ? "healthy" : "degraded",
        outlook: {
            "1h":  { trend: trend1h.trend,  outlook: _outlook(trend1h) },
            "4h":  { trend: trend4h.trend,  outlook: _outlook(trend4h) },
            "24h": { trend: trend24h.trend, outlook: _outlook(trend24h) },
        },
        snapshots: db.snapshots.length,
        summary:   `Health projection: current=${currentOk ? "healthy" : "degraded"} 1h=${_outlook(trend1h)} 4h=${_outlook(trend4h)}`,
    };
}

module.exports = { captureHealthSnapshot, projectHealthOutlook };
