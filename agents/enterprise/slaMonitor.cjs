/**
 * SLA Monitor — tracks service level agreement compliance and uptime.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const SLA_TARGETS = {
    free:       { uptime: 99.0,  responseTime: 2000, supportResponse: "48h" },
    starter:    { uptime: 99.5,  responseTime: 1000, supportResponse: "24h" },
    pro:        { uptime: 99.9,  responseTime: 500,  supportResponse: "8h"  },
    enterprise: { uptime: 99.99, responseTime: 200,  supportResponse: "1h"  }
};

function recordIncident({ tenantId, userId, type, severity = "medium", description, durationMin = 0 }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("slaMonitor", auth.error);

    const incidents = load(tenantId, "sla-incidents", []);
    const incident  = { id: uid("inc"), type, severity, description, durationMin, resolvedAt: durationMin > 0 ? NOW() : null, reportedAt: NOW(), reportedBy: userId };
    incidents.push(incident);
    flush(tenantId, "sla-incidents", incidents.slice(-500));
    auditLog(tenantId, userId, "sla_incident_recorded", { type, severity });
    return ok("slaMonitor", incident);
}

function getReport(tenantId, requesterId, days = 30) {
    const auth = requireAuth(tenantId, requesterId, "manager");
    if (!auth.ok) return forbidden("slaMonitor", auth.error);

    const { loadGlobal } = require("./_enterpriseStore.cjs");
    const tenant    = loadGlobal("tenants", {})[tenantId];
    const plan      = tenant?.plan || "free";
    const targets   = SLA_TARGETS[plan] || SLA_TARGETS.free;
    const since     = Date.now() - days * 86_400_000;
    const incidents = load(tenantId, "sla-incidents", []).filter(i => new Date(i.reportedAt).getTime() >= since);
    const downMin   = incidents.filter(i => i.type === "outage").reduce((s, i) => s + (i.durationMin || 0), 0);
    const totalMin  = days * 24 * 60;
    const uptimePct = +((1 - downMin / totalMin) * 100).toFixed(3);
    const slaBreached = uptimePct < targets.uptime;

    return ok("slaMonitor", {
        tenantId, plan, period: `${days} days`,
        targets, uptimePct: uptimePct + "%",
        slaBreached, downMin,
        incidents: incidents.length,
        bySeverity: incidents.reduce((m, i) => { m[i.severity] = (m[i.severity] || 0) + 1; return m; }, {}),
        checkedAt: NOW()
    });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "record_incident") return recordIncident(p);
        return getReport(p.tenantId, p.userId, p.days || 30);
    } catch (err) { return fail("slaMonitor", err.message); }
}

module.exports = { recordIncident, getReport, SLA_TARGETS, run };
