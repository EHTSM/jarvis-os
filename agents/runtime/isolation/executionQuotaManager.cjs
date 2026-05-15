"use strict";
/**
 * executionQuotaManager — execution budgeting, rate limiting, concurrency control,
 * and overload prevention per isolation domain.
 *
 * allocateQuota(domainId, spec)         → { allocated, allocationId, domainId, quotaType, limit }
 * consumeQuota(domainId, quotaType, n)  → { consumed, domainId, quotaType, used, remaining }
 * releaseQuota(domainId, quotaType, n)  → { released, domainId, quotaType, used, remaining }
 * checkQuota(domainId, quotaType)       → { available, limit, used, remaining, exhausted }
 * getQuotaUsage(domainId)              → { domainId, quotas, found }
 * reset()
 */

const QUOTA_TYPES = [
    "executions_per_minute",
    "concurrent_tasks",
    "memory_budget",
    "retry_budget",
    "recovery_budget",
];

let _quotas  = new Map();   // domainId → Map<quotaType, QuotaRecord>
let _counter = 0;

function _getDomainMap(domainId) {
    if (!_quotas.has(domainId)) _quotas.set(domainId, new Map());
    return _quotas.get(domainId);
}

function allocateQuota(domainId, spec = {}) {
    const { quotaType, limit, windowMs = 60000 } = spec;

    if (!QUOTA_TYPES.includes(quotaType))
        return { allocated: false, reason: `invalid_quota_type: ${quotaType}` };
    if (limit == null || limit < 0)
        return { allocated: false, reason: "invalid_limit" };

    const domainMap    = _getDomainMap(domainId);
    const allocationId = `qta-${++_counter}`;
    const record = {
        allocationId,
        domainId,
        quotaType,
        limit,
        used:        0,
        windowMs,
        windowStart: new Date().toISOString(),
        exhausted:   false,
        allocatedAt: new Date().toISOString(),
    };
    domainMap.set(quotaType, record);
    return { allocated: true, allocationId, domainId, quotaType, limit };
}

function consumeQuota(domainId, quotaType, amount = 1) {
    const record = _quotas.get(domainId)?.get(quotaType);
    if (!record)
        return { consumed: false, reason: "quota_not_allocated" };
    if (record.exhausted)
        return { consumed: false, reason: "quota_exhausted", used: record.used, limit: record.limit };

    const remaining = record.limit - record.used;
    if (amount > remaining) {
        record.exhausted = true;
        return { consumed: false, reason: "quota_exhausted", used: record.used, limit: record.limit };
    }

    record.used += amount;
    if (record.used >= record.limit) record.exhausted = true;

    return {
        consumed:  true,
        domainId,
        quotaType,
        used:      record.used,
        remaining: record.limit - record.used,
    };
}

function releaseQuota(domainId, quotaType, amount = 1) {
    const record = _quotas.get(domainId)?.get(quotaType);
    if (!record)
        return { released: false, reason: "quota_not_allocated" };

    record.used = Math.max(0, record.used - amount);
    if (record.used < record.limit) record.exhausted = false;

    return {
        released:  true,
        domainId,
        quotaType,
        used:      record.used,
        remaining: record.limit - record.used,
    };
}

function checkQuota(domainId, quotaType) {
    const record = _quotas.get(domainId)?.get(quotaType);
    if (!record)
        return { available: false, reason: "quota_not_allocated" };

    return {
        available:  !record.exhausted,
        domainId,
        quotaType,
        limit:      record.limit,
        used:       record.used,
        remaining:  record.limit - record.used,
        exhausted:  record.exhausted,
    };
}

function getQuotaUsage(domainId) {
    const domainMap = _quotas.get(domainId);
    if (!domainMap) return { domainId, quotas: [], found: false };
    return {
        domainId,
        quotas: [...domainMap.values()].map(r => ({ ...r })),
        found:  true,
    };
}

function reset() {
    _quotas  = new Map();
    _counter = 0;
}

module.exports = {
    QUOTA_TYPES,
    allocateQuota, consumeQuota, releaseQuota, checkQuota, getQuotaUsage, reset,
};
