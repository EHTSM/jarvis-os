/**
 * Rate Limiter — per-tenant, per-user request throttling.
 */

const { loadGlobal, ok, fail } = require("./_enterpriseStore.cjs");
const { PLANS } = require("./multiTenantManager.cjs");

// In-memory sliding window counters (production: Redis)
const _windows = {};

const RATE_LIMITS = {
    free:       { requestsPerMin: 10,  requestsPerHour: 100,  requestsPerDay: 500   },
    starter:    { requestsPerMin: 30,  requestsPerHour: 500,  requestsPerDay: 5000  },
    pro:        { requestsPerMin: 100, requestsPerHour: 2000, requestsPerDay: 20000 },
    enterprise: { requestsPerMin: 500, requestsPerHour: 10000,requestsPerDay: -1    }
};

function _clean(tenantId, userId, windowMs) {
    const key = `${tenantId}::${userId}`;
    const now = Date.now();
    if (!_windows[key]) _windows[key] = [];
    _windows[key] = _windows[key].filter(t => now - t < windowMs);
    return _windows[key];
}

function check({ tenantId, userId, feature = "api" }) {
    const tenants = loadGlobal("tenants", {});
    const plan    = tenants[tenantId]?.plan || "free";
    const limits  = RATE_LIMITS[plan] || RATE_LIMITS.free;

    const key     = `${tenantId}::${userId}`;
    const now     = Date.now();

    if (!_windows[key]) _windows[key] = [];

    const perMin  = _windows[key].filter(t => now - t < 60_000).length;
    const perHour = _windows[key].filter(t => now - t < 3_600_000).length;

    const blockedMin  = perMin  >= limits.requestsPerMin;
    const blockedHour = limits.requestsPerHour !== -1 && perHour >= limits.requestsPerHour;
    const blocked     = blockedMin || blockedHour;

    if (!blocked) {
        _windows[key].push(now);
        // Keep only last hour
        _windows[key] = _windows[key].filter(t => now - t < 3_600_000);
    }

    const retryAfterSec = blockedMin ? 60 : blockedHour ? 3600 : 0;

    return {
        allowed:       !blocked,
        blocked,
        plan,
        limits,
        current:       { perMin, perHour },
        retryAfterSec,
        headers: {
            "X-RateLimit-Limit":     limits.requestsPerMin,
            "X-RateLimit-Remaining": Math.max(0, limits.requestsPerMin - perMin),
            "X-RateLimit-Reset":     Math.ceil((now + 60_000) / 1000)
        }
    };
}

function getStatus({ tenantId, userId }) {
    const result = check({ tenantId, userId });
    return result;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = task.type === "rate_status" ? getStatus(p) : check(p);
        return ok("rateLimiter", data);
    } catch (err) { return fail("rateLimiter", err.message); }
}

module.exports = { check, getStatus, RATE_LIMITS, run };
