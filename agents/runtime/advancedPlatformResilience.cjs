"use strict";
/**
 * Phase 642 — Advanced Platform Resilience
 *
 * Multi-layered resilience: process watchdog, dependency circuit-breaking,
 * degraded-mode detection, runtime pressure scoring, cascading failure prevention.
 * Read-heavy diagnostics. Approval required for any state mutation.
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/platform-resilience.json");
const MAX_EVENTS = 200;
const TTL_MS     = 48 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { events: [], circuitBreakers: {} }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.events = (db.events || []).filter(e => e.ts > cutoff).slice(0, MAX_EVENTS);
}

// ── Circuit breaker ────────────────────────────────────────────────────────────

const CB_TRIP_THRESHOLD = 5;
const CB_TRIP_WINDOW    = 5 * 60 * 1000; // 5 minutes
const CB_RESET_AFTER    = 15 * 60 * 1000; // 15 minutes

function recordComponentFailure(component, { detail = "" } = {}) {
    if (!component) return { ok: false, error: "component required" };
    const db = _load(); _prune(db);
    db.events.unshift({ type: "component-failure", component, detail: (detail || "").slice(0, 200), ts: Date.now() });
    _save(db);
    return { ok: true, component };
}

function circuitBreakerStatus(component) {
    if (!component) return { ok: false, error: "component required" };
    const db      = _load(); _prune(db);
    const cutoff  = Date.now() - CB_TRIP_WINDOW;
    const failures = db.events.filter(e => e.type === "component-failure" && e.component === component && e.ts > cutoff);

    const tripped = failures.length >= CB_TRIP_THRESHOLD;
    const lastFail = failures[0]?.ts;
    const cooldownRemaining = lastFail ? Math.max(0, CB_RESET_AFTER - (Date.now() - lastFail)) : 0;
    const recovering = tripped && cooldownRemaining === 0;

    return {
        ok:        true,
        component,
        tripped,
        failureCount:       failures.length,
        threshold:          CB_TRIP_THRESHOLD,
        cooldownRemainingMs: cooldownRemaining,
        recovering,
        status:    tripped ? (recovering ? "recovering" : "open") : "closed",
    };
}

function allCircuitBreakers() {
    const db   = _load();
    const cutoff = Date.now() - CB_TRIP_WINDOW;
    const components = [...new Set(db.events.filter(e => e.type === "component-failure" && e.ts > cutoff).map(e => e.component))];
    return {
        ok:       true,
        breakers: components.map(c => circuitBreakerStatus(c)),
        tripped:  components.filter(c => circuitBreakerStatus(c).tripped),
    };
}

// ── Runtime pressure scoring ───────────────────────────────────────────────────

function runtimePressureScore() {
    let score  = 100;
    const signals = [];

    // Memory pressure
    try {
        const freeMem  = os.freemem();
        const totalMem = os.totalmem();
        const usedPct  = Math.round((1 - freeMem / totalMem) * 100);
        if (usedPct > 90) { score -= 30; signals.push({ signal: "memory-critical", usedPct, severity: "critical" }); }
        else if (usedPct > 75) { score -= 15; signals.push({ signal: "memory-high", usedPct, severity: "warning" }); }
    } catch {}

    // Load average (1-min)
    try {
        const load = os.loadavg()[0];
        const cpus = os.cpus().length;
        const norm = load / cpus;
        if (norm > 2.0) { score -= 25; signals.push({ signal: "cpu-overload", loadAvg: load, severity: "critical" }); }
        else if (norm > 1.0) { score -= 10; signals.push({ signal: "cpu-high", loadAvg: load, severity: "warning" }); }
    } catch {}

    // Stale process supervision
    const ats = _tryRequire("./autonomousTerminalSupervision.cjs");
    if (ats) {
        try {
            const stale = ats.detectStale();
            if (stale.runawayCount > 0) { score -= 20; signals.push({ signal: "runaway-processes", count: stale.runawayCount, severity: "critical" }); }
            else if (stale.staleCount > 2) { score -= 8; signals.push({ signal: "stale-processes", count: stale.staleCount, severity: "warning" }); }
        } catch {}
    }

    // Reconnect storm
    const lhac = _tryRequire("./longHorizonAutonomousContinuity.cjs");
    if (lhac) {
        try {
            const health = lhac.continuityHealth();
            if (health.storm) { score -= 15; signals.push({ signal: "reconnect-storm", severity: "critical" }); }
        } catch {}
    }

    // Circuit breakers
    const breakers = allCircuitBreakers();
    if (breakers.tripped && breakers.tripped.length > 0) {
        score -= Math.min(20, breakers.tripped.length * 7);
        signals.push({ signal: "circuit-breakers-tripped", count: breakers.tripped.length, severity: "warning" });
    }

    const normalized = Math.max(0, Math.min(100, score));
    const level = normalized >= 80 ? "nominal" : normalized >= 60 ? "degraded" : normalized >= 40 ? "stressed" : "critical";

    return {
        ok:      true,
        score:   normalized,
        level,
        signals,
        summary: `Platform pressure: ${level} (${normalized}/100)`,
    };
}

// ── Degraded mode detection ───────────────────────────────────────────────────

function detectDegradedMode() {
    const pressure = runtimePressureScore();
    const degraded = pressure.score < 60;

    const capabilities = {
        deploymentAllowed:   pressure.score >= 70,
        patchAllowed:        pressure.score >= 50,
        recoveryAllowed:     pressure.score >= 30,
        monitoringActive:    true,
    };

    const restrictions = [];
    if (!capabilities.deploymentAllowed) restrictions.push("deployment blocked — pressure too high");
    if (!capabilities.patchAllowed)      restrictions.push("patch application blocked");

    return {
        ok:          true,
        degraded,
        pressureScore: pressure.score,
        pressureLevel: pressure.level,
        capabilities,
        restrictions,
        signals:     pressure.signals,
        summary:     degraded ? `Degraded mode: ${restrictions.join("; ")}` : "Platform operating normally",
    };
}

// ── Cascading failure prevention ──────────────────────────────────────────────

function cascadeRiskAssessment() {
    const db      = _load();
    const cutoff  = Date.now() - 10 * 60 * 1000; // 10 minutes
    const recent  = db.events.filter(e => e.ts > cutoff && e.type === "component-failure");

    const uniqueComponents = new Set(recent.map(e => e.component)).size;
    const cascadeRisk = uniqueComponents >= 3 ? "high" : uniqueComponents >= 2 ? "medium" : "low";

    const recommend = [];
    if (cascadeRisk === "high") {
        recommend.push("Halt new deployments immediately");
        recommend.push("Activate operator-supervised recovery");
        recommend.push("Run runtime stabilization flow");
    } else if (cascadeRisk === "medium") {
        recommend.push("Pause non-critical operations");
        recommend.push("Run health-scan flow");
    }

    return {
        ok:                  true,
        cascadeRisk,
        recentFailureCount:  recent.length,
        affectedComponents:  uniqueComponents,
        recommendations:     recommend,
        summary:             `Cascade risk: ${cascadeRisk} (${uniqueComponents} component(s) failing)`,
    };
}

// ── Watchdog summary ──────────────────────────────────────────────────────────

function watchdogSummary() {
    const pressure  = runtimePressureScore();
    const degraded  = detectDegradedMode();
    const cascade   = cascadeRiskAssessment();
    const breakers  = allCircuitBreakers();

    const critical  = pressure.signals.filter(s => s.severity === "critical").length;
    const warnings  = pressure.signals.filter(s => s.severity === "warning").length;
    const overallOk = pressure.score >= 60 && cascade.cascadeRisk !== "high";

    return {
        ok:          overallOk,
        pressureScore: pressure.score,
        pressureLevel: pressure.level,
        degraded:    degraded.degraded,
        cascadeRisk: cascade.cascadeRisk,
        trippedBreakers: breakers.tripped?.length || 0,
        criticalSignals: critical,
        warningSignals:  warnings,
        restrictions:    degraded.restrictions,
        summary:         `Resilience watchdog: ${overallOk ? "OK" : "DEGRADED"} — pressure=${pressure.level} cascade=${cascade.cascadeRisk}`,
    };
}

module.exports = { recordComponentFailure, circuitBreakerStatus, allCircuitBreakers, runtimePressureScore, detectDegradedMode, cascadeRiskAssessment, watchdogSummary };
