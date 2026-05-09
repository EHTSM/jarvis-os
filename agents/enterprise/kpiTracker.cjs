/**
 * KPI Tracker — define, measure, and report key performance indicators.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const KPI_CATEGORIES = ["revenue","growth","operations","customer","people","product"];

function createKPI({ tenantId, userId, name, category, target, unit, owner, frequency = "monthly" }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("kpiTracker", auth.error);

    const kpi = { id: uid("kpi"), tenantId, name, category, target, unit, current: 0, owner, frequency, status: "on_track", history: [], createdBy: userId, createdAt: NOW() };
    const kpis = load(tenantId, "kpis", []);
    kpis.push(kpi);
    flush(tenantId, "kpis", kpis);
    auditLog(tenantId, userId, "kpi_created", { name, target });
    return ok("kpiTracker", kpi);
}

function updateKPI({ tenantId, userId, kpiId, current, note = "" }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("kpiTracker", auth.error);

    const kpis = load(tenantId, "kpis", []);
    const kpi  = kpis.find(k => k.id === kpiId);
    if (!kpi) return fail("kpiTracker", "KPI not found");

    kpi.history.push({ value: kpi.current, recordedAt: NOW() });
    kpi.history = kpi.history.slice(-12);
    kpi.current = current;
    kpi.status  = current >= kpi.target ? "achieved" : current >= kpi.target * 0.8 ? "on_track" : current >= kpi.target * 0.5 ? "at_risk" : "off_track";
    kpi.updatedAt = NOW();
    flush(tenantId, "kpis", kpis);
    auditLog(tenantId, userId, "kpi_updated", { kpiId, current, status: kpi.status });
    return ok("kpiTracker", kpi);
}

function getDashboard(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "manager");
    if (!auth.ok) return forbidden("kpiTracker", auth.error);

    const kpis     = load(tenantId, "kpis", []);
    const achieved = kpis.filter(k => k.status === "achieved").length;
    const atRisk   = kpis.filter(k => k.status === "at_risk").length;
    const offTrack = kpis.filter(k => k.status === "off_track").length;

    return ok("kpiTracker", {
        tenantId,
        total:     kpis.length,
        achieved,
        onTrack:   kpis.filter(k => k.status === "on_track").length,
        atRisk,
        offTrack,
        score:     kpis.length ? Math.round(((achieved + kpis.filter(k => k.status === "on_track").length) / kpis.length) * 100) + "%" : "0%",
        kpis:      kpis.map(k => ({ id: k.id, name: k.name, current: k.current, target: k.target, unit: k.unit, status: k.status }))
    });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "create_kpi")  return createKPI(p);
        if (task.type === "update_kpi")  return updateKPI(p);
        return getDashboard(p.tenantId, p.userId);
    } catch (err) { return fail("kpiTracker", err.message); }
}

module.exports = { createKPI, updateKPI, getDashboard, KPI_CATEGORIES, run };
