"use strict";
/**
 * runtimeIncidentManager — incident classification, severity routing, and recovery tracking.
 *
 * openIncident(error, context)            → Incident
 * updateIncident(incidentId, update)      → Incident | null
 * closeIncident(incidentId, resolution)   → CloseResult
 * getIncident(incidentId)                 → Incident | null
 * estimateBlastRadius(incident, topology) → BlastRadius
 * getMitigationPlan(incident)             → MitigationPlan
 * getTimeline(incidentId)                 → TimelineEvent[]
 * getOpenIncidents()                      → Incident[]
 * reset()
 */

const INCIDENT_TYPES = [
    "execution_failure", "performance_degradation", "security_violation",
    "dependency_failure", "resource_exhaustion", "cascade_failure", "unknown",
];

const SEVERITY_MAP = {
    execution_failure:       "P2",
    performance_degradation: "P3",
    security_violation:      "P1",
    dependency_failure:      "P2",
    resource_exhaustion:     "P2",
    cascade_failure:         "P1",
    unknown:                 "P3",
};

const MITIGATION_MAP = {
    execution_failure:       ["retry_with_backoff", "isolate_task", "notify_oncall"],
    performance_degradation: ["reduce_concurrency", "enable_throttling", "scale_resources"],
    security_violation:      ["block_execution", "quarantine_tenant", "notify_security_team"],
    dependency_failure:      ["reroute_dependencies", "enable_circuit_breaker", "failover"],
    resource_exhaustion:     ["shed_load", "scale_resources", "enable_throttling"],
    cascade_failure:         ["circuit_break_all", "rollback_last_deployment", "notify_oncall"],
    unknown:                 ["investigate", "enable_safe_mode"],
};

let _incidents = new Map();   // incidentId → Incident
let _counter   = 0;

// ── type classifier ───────────────────────────────────────────────────

function _classifyType(error) {
    const msg = String(error?.message ?? error ?? "").toLowerCase();
    if (msg.includes("security") || msg.includes("privilege") || msg.includes("injection")) return "security_violation";
    if (msg.includes("timeout")  || msg.includes("slow")      || msg.includes("latency"))  return "performance_degradation";
    if (msg.includes("dependency")|| msg.includes("circuit"))                               return "dependency_failure";
    if (msg.includes("memory")   || msg.includes("heap")      || msg.includes("cpu"))       return "resource_exhaustion";
    if (msg.includes("cascade")  || msg.includes("chain"))                                  return "cascade_failure";
    if (msg.includes("execution") || msg.includes("failed") || msg.includes("error"))       return "execution_failure";
    return "unknown";
}

// ── openIncident ──────────────────────────────────────────────────────

function openIncident(error, context = {}) {
    const incidentId = `INC-${String(++_counter).padStart(4, "0")}`;
    const type       = context.type ?? _classifyType(error);
    const severity   = context.severity ?? SEVERITY_MAP[type] ?? "P3";

    const incident = {
        incidentId,
        type,
        severity,
        state:     "open",
        error:     String(error?.message ?? error ?? "unknown"),
        context:   { ...context },
        openedAt:  new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        timeline:  [{
            event:    "incident_opened",
            severity,
            type,
            ts:       new Date().toISOString(),
        }],
    };
    _incidents.set(incidentId, incident);
    return incident;
}

// ── updateIncident ────────────────────────────────────────────────────

function updateIncident(incidentId, update = {}) {
    const incident = _incidents.get(incidentId);
    if (!incident) return null;

    if (update.state) incident.state = update.state;
    incident.timeline.push({
        event: update.event ?? "incident_updated",
        note:  update.note  ?? null,
        ts:    new Date().toISOString(),
    });
    Object.assign(incident.context, update.context ?? {});
    incident.updatedAt = new Date().toISOString();
    return incident;
}

// ── closeIncident ─────────────────────────────────────────────────────

function closeIncident(incidentId, resolution = {}) {
    const incident = _incidents.get(incidentId);
    if (!incident)                     return { closed: false, reason: "not_found" };
    if (incident.state === "closed")   return { closed: false, reason: "already_closed" };

    incident.state     = "closed";
    incident.closedAt  = new Date().toISOString();
    incident.resolution = resolution;
    incident.timeline.push({
        event:      "incident_closed",
        resolution: resolution.summary ?? "resolved",
        ts:         new Date().toISOString(),
    });
    incident.updatedAt = new Date().toISOString();
    return {
        closed:     true,
        incidentId,
        durationMs: Date.now() - new Date(incident.openedAt).getTime(),
    };
}

// ── getIncident ───────────────────────────────────────────────────────

function getIncident(incidentId) {
    return _incidents.get(incidentId) ?? null;
}

// ── estimateBlastRadius ───────────────────────────────────────────────

function estimateBlastRadius(incident, topology = {}) {
    const affectedTasks   = topology.affectedTasks   ?? 1;
    const affectedTenants = topology.affectedTenants ?? 1;
    const systemWide      = topology.systemWide      ?? false;

    const radius = systemWide          ? "critical" :
                   affectedTenants > 1 ? "high"     :
                   affectedTasks > 3   ? "medium"   : "low";

    return {
        radius,
        incidentId:      incident?.incidentId ?? null,
        estimatedImpact: {
            affectedTasks,
            affectedTenants,
            dataLoss:            incident?.type === "cascade_failure",
            estimatedDowntimeMs: affectedTasks * 5000,
        },
    };
}

// ── getMitigationPlan ─────────────────────────────────────────────────

function getMitigationPlan(incident) {
    if (!incident) return { actions: [], priority: "P4" };
    const actions = MITIGATION_MAP[incident.type] ?? MITIGATION_MAP.unknown;
    return {
        incidentId:     incident.incidentId,
        actions,
        priority:       incident.severity,
        autoExecutable: incident.severity !== "P1",
    };
}

// ── getTimeline ───────────────────────────────────────────────────────

function getTimeline(incidentId) {
    return _incidents.get(incidentId)?.timeline ?? [];
}

// ── getOpenIncidents ──────────────────────────────────────────────────

function getOpenIncidents() {
    return [..._incidents.values()].filter(i => i.state !== "closed" && i.state !== "resolved");
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _incidents = new Map();
    _counter   = 0;
}

module.exports = {
    INCIDENT_TYPES, SEVERITY_MAP, MITIGATION_MAP,
    openIncident, updateIncident, closeIncident, getIncident,
    estimateBlastRadius, getMitigationPlan, getTimeline, getOpenIncidents,
    reset,
};
