/**
 * Usage Metering Agent — tracks API calls and feature usage per tenant.
 */

const { load, flush, loadGlobal, requireAuth, meter, auditLog, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");
const { PLANS } = require("./multiTenantManager.cjs");

function track({ tenantId, userId, feature, count = 1 }) {
    meter(tenantId, userId, feature, count);
    return { tracked: true, feature, count };
}

function getUsage(tenantId, requesterId, month = null) {
    const auth = requireAuth(tenantId, requesterId, "manager");
    if (!auth.ok) return forbidden("usageMeteringAgent", auth.error);

    const key   = month || new Date().toISOString().slice(0, 7);
    const usage = load(tenantId, `usage-${key}`, {});

    const tenants = loadGlobal("tenants", {});
    const plan    = tenants[tenantId]?.plan || "free";
    const limits  = PLANS[plan] || PLANS.free;

    const totalApiCalls = Object.values(usage).reduce((sum, u) =>
        sum + Object.values(u).reduce((s, c) => s + c, 0), 0);

    const atLimit  = limits.maxApiCalls !== -1 && totalApiCalls >= limits.maxApiCalls;
    const pctUsed  = limits.maxApiCalls !== -1 ? Math.min(100, Math.round(totalApiCalls / limits.maxApiCalls * 100)) : 0;

    return {
        tenantId,
        period:        key,
        plan,
        totalApiCalls,
        limit:         limits.maxApiCalls === -1 ? "Unlimited" : limits.maxApiCalls,
        percentUsed:   pctUsed + "%",
        atLimit,
        nearLimit:     pctUsed >= 80 && !atLimit,
        byUser:        usage,
        alerts:        atLimit ? ["⚠️ API limit reached — upgrade plan"] : pctUsed >= 80 ? ["📊 Approaching API limit — consider upgrading"] : []
    };
}

function getUsageTrend(tenantId, requesterId, months = 3) {
    const auth = requireAuth(tenantId, requesterId, "admin");
    if (!auth.ok) return forbidden("usageMeteringAgent", auth.error);

    const trend = [];
    for (let i = 0; i < months; i++) {
        const d   = new Date();
        d.setMonth(d.getMonth() - i);
        const key = d.toISOString().slice(0, 7);
        const u   = load(tenantId, `usage-${key}`, {});
        const calls = Object.values(u).reduce((sum, usr) => sum + Object.values(usr).reduce((s, c) => s + c, 0), 0);
        trend.push({ month: key, apiCalls: calls });
    }

    return { tenantId, trend: trend.reverse(), months };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "track_usage")     data = track(p);
        else if (task.type === "usage_trend") data = getUsageTrend(p.tenantId, p.userId, p.months || 3);
        else                                 data = getUsage(p.tenantId, p.userId, p.month);
        if (data?.code === 403) return data;
        return ok("usageMeteringAgent", data);
    } catch (err) { return fail("usageMeteringAgent", err.message); }
}

module.exports = { track, getUsage, getUsageTrend, run };
