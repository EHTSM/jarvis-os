/**
 * Enterprise Dashboard — aggregated tenant health, usage, and KPI summary.
 */

const { load, loadGlobal, requireAuth, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");
const { PLANS } = require("./multiTenantManager.cjs");

function getDashboard(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "manager");
    if (!auth.ok) return forbidden("enterpriseDashboard", auth.error);

    const tenants    = loadGlobal("tenants", {});
    const tenant     = tenants[tenantId];
    const members    = loadGlobal("members", {});
    const teamMembers = Object.values(members).filter(m => m.tenantId === tenantId);

    const month      = new Date().toISOString().slice(0, 7);
    const usage      = load(tenantId, `usage-${month}`, {});
    const totalCalls = Object.values(usage).reduce((s, u) => s + Object.values(u).reduce((ss, v) => ss + v, 0), 0);

    const plan     = tenant?.plan || "free";
    const limits   = PLANS[plan] || PLANS.free;
    const pctUsed  = limits.maxApiCalls !== -1 ? Math.round(totalCalls / limits.maxApiCalls * 100) : 0;

    const tickets  = load(tenantId, "tickets", []);
    const openTickets = tickets.filter(t => t.status === "open").length;

    const kpis     = load(tenantId, "kpis", []);
    const onTrack  = kpis.filter(k => k.status === "on_track").length;

    return ok("enterpriseDashboard", {
        tenantId,
        tenant:    { name: tenant?.name, plan, status: tenant?.status },
        members:   { total: teamMembers.length, byRole: teamMembers.reduce((m, mem) => { m[mem.role] = (m[mem.role] || 0) + 1; return m; }, {}) },
        usage:     { thisMonth: totalCalls, limit: limits.maxApiCalls === -1 ? "Unlimited" : limits.maxApiCalls, percentUsed: pctUsed + "%" },
        support:   { openTickets },
        kpis:      { total: kpis.length, onTrack },
        health:    pctUsed < 70 && openTickets < 5 ? "Healthy" : pctUsed >= 90 ? "Warning" : "Monitor",
        generatedAt: NOW()
    });
}

async function run(task) {
    const p = task.payload || {};
    try {
        return getDashboard(p.tenantId, p.userId);
    } catch (err) { return fail("enterpriseDashboard", err.message); }
}

module.exports = { getDashboard, run };
