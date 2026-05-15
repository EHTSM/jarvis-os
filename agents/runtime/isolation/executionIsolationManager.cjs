"use strict";
/**
 * executionIsolationManager — isolated execution domains with resource quotas
 * and fault-state lifecycle management.
 *
 * createIsolationDomain(spec)         → { created, domainId, isolationType }
 * destroyIsolationDomain(domainId)    → { destroyed, domainId }
 * getIsolationDomain(domainId)        → DomainRecord | null
 * listIsolationDomains(filter)        → DomainRecord[]
 * assignResources(domainId, res)      → { assigned, domainId, memoryQuota, cpuQuota }
 * getIsolationStats()                 → Stats
 * reset()
 */

const ISOLATION_TYPES = ["workflow", "agent", "capability", "session", "recovery"];
const FAULT_STATES    = ["healthy", "degraded", "unstable", "quarantined", "terminated"];

let _domains = new Map();
let _counter  = 0;

function createIsolationDomain(spec = {}) {
    const {
        isolationType = "workflow",
        memoryQuota   = 256,
        cpuQuota      = 1.0,
        parentDomain  = null,
        metadata      = {},
    } = spec;

    if (!ISOLATION_TYPES.includes(isolationType))
        return { created: false, reason: `invalid_isolation_type: ${isolationType}` };

    const domainId = `dom-${++_counter}`;
    const record = {
        domainId,
        isolationType,
        memoryQuota,
        cpuQuota,
        parentDomain,
        metadata:       { ...metadata },
        executionCount: 0,
        faultState:     "healthy",
        recoveryMode:   false,
        status:         "active",
        createdAt:      new Date().toISOString(),
        destroyedAt:    null,
    };

    _domains.set(domainId, record);
    return { created: true, domainId, isolationType };
}

function destroyIsolationDomain(domainId) {
    const domain = _domains.get(domainId);
    if (!domain)                        return { destroyed: false, reason: "domain_not_found" };
    if (domain.status === "destroyed")  return { destroyed: false, reason: "already_destroyed" };

    domain.status      = "destroyed";
    domain.destroyedAt = new Date().toISOString();
    return { destroyed: true, domainId };
}

function getIsolationDomain(domainId) {
    const d = _domains.get(domainId);
    return d ? { ...d } : null;
}

function listIsolationDomains(filter = {}) {
    let domains = [..._domains.values()];
    if (filter.isolationType) domains = domains.filter(d => d.isolationType === filter.isolationType);
    if (filter.status)        domains = domains.filter(d => d.status        === filter.status);
    if (filter.faultState)    domains = domains.filter(d => d.faultState    === filter.faultState);
    return domains.map(d => ({ ...d }));
}

function assignResources(domainId, resources = {}) {
    const domain = _domains.get(domainId);
    if (!domain)                        return { assigned: false, reason: "domain_not_found" };
    if (domain.status === "destroyed")  return { assigned: false, reason: "domain_destroyed" };

    if (resources.memoryQuota != null) domain.memoryQuota = Math.max(0, resources.memoryQuota);
    if (resources.cpuQuota    != null) domain.cpuQuota    = Math.max(0, resources.cpuQuota);

    return { assigned: true, domainId, memoryQuota: domain.memoryQuota, cpuQuota: domain.cpuQuota };
}

function getIsolationStats() {
    const all      = [..._domains.values()];
    const byType   = {};
    const byFault  = {};

    for (const d of all) {
        byType[d.isolationType]  = (byType[d.isolationType]  ?? 0) + 1;
        byFault[d.faultState]    = (byFault[d.faultState]    ?? 0) + 1;
    }

    return {
        total:       all.length,
        active:      all.filter(d => d.status     === "active").length,
        destroyed:   all.filter(d => d.status     === "destroyed").length,
        quarantined: all.filter(d => d.faultState === "quarantined").length,
        byType,
        byFaultState: byFault,
    };
}

function reset() {
    _domains = new Map();
    _counter  = 0;
}

module.exports = {
    ISOLATION_TYPES, FAULT_STATES,
    createIsolationDomain, destroyIsolationDomain, getIsolationDomain,
    listIsolationDomains, assignResources, getIsolationStats, reset,
};
