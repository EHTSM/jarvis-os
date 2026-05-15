"use strict";
/**
 * incidentContainment — cascading incident detection and blast-radius containment.
 *
 * openContainment(incident)                      → ContainmentRecord
 * closeContainment(containmentId, outcome)       → CloseResult
 * containCascade(incidents)                      → CascadeContainmentResult
 * isolateBlastRadius(incident, topology)         → IsolationResult
 * scoreContainmentEffectiveness(containments)    → EffectivenessScore
 * getActiveContainments()                        → ContainmentRecord[]
 * getContainmentHistory()                        → ContainmentRecord[]
 * reset()
 */

const CONTAINMENT_STRATEGIES = {
    security_violation:     ["isolate_execution", "revoke_credentials", "quarantine_tenant"],
    cascade_failure:        ["circuit_break_all", "shed_load",          "reroute_traffic"  ],
    execution_failure:      ["retry_with_backoff", "reroute",           "sandbox"          ],
    resource_exhaustion:    ["throttle_concurrency","free_memory",      "reduce_batch_size"],
    performance_degradation:["throttle_concurrency","enable_caching",   "degrade_gracefully"],
    unknown:                ["sandbox",              "investigate",      "alert_oncall"     ],
};

let _containments = new Map();   // containmentId → record
let _counter      = 0;

// ── openContainment ───────────────────────────────────────────────────

function openContainment(incident = {}) {
    const containmentId = `cont-${++_counter}`;
    const type          = incident.type ?? "unknown";
    const severity      = incident.severity ?? "P3";
    const strategies    = CONTAINMENT_STRATEGIES[type] ?? CONTAINMENT_STRATEGIES.unknown;

    const record = {
        containmentId,
        incidentId:  incident.incidentId ?? null,
        type,
        severity,
        strategies:  [...strategies],
        status:      "active",
        openedAt:    new Date().toISOString(),
        closedAt:    null,
        outcome:     null,
    };
    _containments.set(containmentId, record);
    return record;
}

// ── closeContainment ──────────────────────────────────────────────────

function closeContainment(containmentId, outcome = "resolved") {
    const record = _containments.get(containmentId);
    if (!record) return { closed: false, reason: "not_found" };
    if (record.status === "closed") return { closed: false, reason: "already_closed" };

    record.status   = "closed";
    record.closedAt = new Date().toISOString();
    record.outcome  = outcome;

    const durationMs = new Date(record.closedAt).getTime() - new Date(record.openedAt).getTime();
    return { closed: true, containmentId, outcome, durationMs };
}

// ── containCascade ────────────────────────────────────────────────────

function containCascade(incidents = []) {
    if (incidents.length === 0) return { contained: false, reason: "no_incidents" };

    const isCascade  = incidents.length > 1;
    const maxSev     = incidents.some(i => i.severity === "P1") ? "P1" :
                       incidents.some(i => i.severity === "P2") ? "P2" : "P3";

    // Deduplicate strategies across all incident types
    const allStrategies = [...new Set(
        incidents.flatMap(i =>
            CONTAINMENT_STRATEGIES[i.type ?? "unknown"] ?? CONTAINMENT_STRATEGIES.unknown
        )
    )];

    // Open one containment per incident
    const containmentIds = incidents.map(inc => openContainment(inc).containmentId);

    return {
        contained:      true,
        isCascade,
        incidentCount:  incidents.length,
        maxSeverity:    maxSev,
        strategies:     allStrategies,
        containmentIds,
        circuitBreak:   allStrategies.includes("circuit_break_all"),
    };
}

// ── isolateBlastRadius ────────────────────────────────────────────────

function isolateBlastRadius(incident = {}, topology = {}) {
    const { services = [], dependencies = [] } = topology;
    const affected = incident.affectedServices ?? [];
    const severity = incident.severity ?? "P3";

    // Walk downstream dependencies
    const isolated = new Set(affected);
    for (const dep of dependencies) {
        if (affected.includes(dep.from)) isolated.add(dep.to);
    }

    const radius  = isolated.size === 0             ? "none"     :
                    isolated.size === 1             ? "low"      :
                    isolated.size <= 3              ? "medium"   :
                    isolated.size / Math.max(1, services.length) > 0.5 ? "critical" : "high";

    const actions = radius === "critical" ? ["circuit_break_all", "shed_load"]          :
                    radius === "high"     ? ["isolate_affected_services", "reroute"]     :
                    radius === "medium"   ? ["throttle_affected_services"]               :
                    radius === "low"      ? ["monitor_affected_service"]                 : [];

    return {
        radius,
        isolatedCount:   isolated.size,
        isolatedServices: [...isolated],
        totalServices:   services.length,
        actions,
        severity,
    };
}

// ── scoreContainmentEffectiveness ────────────────────────────────────

function scoreContainmentEffectiveness(containments = []) {
    if (containments.length === 0) return { score: 0, grade: "F", reason: "no_containments" };

    const resolved = containments.filter(c => c.outcome === "resolved" || c.status === "closed");
    const resolvedRate = resolved.length / containments.length;

    const durations = resolved
        .filter(c => c.closedAt && c.openedAt)
        .map(c => new Date(c.closedAt).getTime() - new Date(c.openedAt).getTime());

    const avgDuration = durations.length > 0
        ? durations.reduce((s, d) => s + d, 0) / durations.length
        : 0;

    // Fast resolution bonus: <1min=20, <5min=15, <15min=10, else 0
    const speedBonus = avgDuration < 60000   ? 20 :
                       avgDuration < 300000  ? 15 :
                       avgDuration < 900000  ? 10 : 0;

    const raw   = Math.min(100, resolvedRate * 80 + speedBonus);
    const score = +raw.toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    return { score, grade, resolvedRate: +resolvedRate.toFixed(3), avgDurationMs: +avgDuration.toFixed(0), total: containments.length };
}

// ── getActiveContainments / getContainmentHistory / reset ─────────────

function getActiveContainments() {
    return [..._containments.values()].filter(c => c.status === "active");
}

function getContainmentHistory() {
    return [..._containments.values()];
}

function reset() {
    _containments = new Map();
    _counter      = 0;
}

module.exports = {
    CONTAINMENT_STRATEGIES,
    openContainment, closeContainment, containCascade,
    isolateBlastRadius, scoreContainmentEffectiveness,
    getActiveContainments, getContainmentHistory, reset,
};
