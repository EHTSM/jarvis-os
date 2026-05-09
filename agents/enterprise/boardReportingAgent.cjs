/**
 * Board Reporting Agent — executive and board-level summary reports with KPI snapshots.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const REPORT_TYPES = ["quarterly","monthly","annual","board_deck","executive_summary"];

function generateReport({ tenantId, userId, type = "quarterly", period, highlights = [], risks = [], decisions = [] }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("boardReportingAgent", auth.error);
    if (!REPORT_TYPES.includes(type)) return fail("boardReportingAgent", `Invalid type. Use: ${REPORT_TYPES.join(", ")}`);

    const kpis        = load(tenantId, "kpis", []);
    const okrs        = load(tenantId, "okrs", []);
    const invoices    = load(tenantId, "invoices", []);
    const headcount   = load(tenantId, "employees", []);
    const reviews     = load(tenantId, "performance-reviews", []);

    const totalRevenue   = invoices.filter(i => i.status === "paid").reduce((s, i) => s + (i.amount || 0), 0);
    const openInvoices   = invoices.filter(i => i.status === "sent").reduce((s, i) => s + (i.amount || 0), 0);
    const kpiAchieved    = kpis.filter(k => k.status === "achieved").length;
    const kpiAtRisk      = kpis.filter(k => k.status === "at_risk" || k.status === "off_track").length;
    const okrAvgProgress = okrs.length ? Math.round(okrs.reduce((s, o) => s + o.progress, 0) / okrs.length) : 0;
    const avgPerformance = reviews.length ? +(reviews.reduce((s, r) => s + r.overallRating, 0) / reviews.length).toFixed(1) : null;

    const report = {
        id:        uid("rpt"),
        tenantId,
        type,
        period:    period || new Date().toISOString().slice(0, 7),
        generatedBy: userId,
        generatedAt: NOW(),
        executive: {
            headline:     `${type.replace(/_/g, " ").toUpperCase()} REPORT — ${period || new Date().toISOString().slice(0, 7)}`,
            highlights:   highlights.length ? highlights : ["Operational continuity maintained", "KPIs under active monitoring"],
            risks:        risks.length ? risks : kpiAtRisk > 0 ? [`${kpiAtRisk} KPI(s) require attention`] : ["No critical risks identified"],
            decisions:    decisions.length ? decisions : ["Continued investment in core operations"]
        },
        financials: {
            totalRevenue,
            openReceivables: openInvoices,
            currency:        "USD"
        },
        people: {
            headcount:      headcount.length,
            avgPerformance: avgPerformance || "N/A"
        },
        kpiSnapshot: {
            total:    kpis.length,
            achieved: kpiAchieved,
            atRisk:   kpiAtRisk,
            health:   kpis.length ? `${Math.round((kpiAchieved / kpis.length) * 100)}%` : "0%"
        },
        okrSnapshot: {
            total:       okrs.length,
            avgProgress: `${okrAvgProgress}%`,
            grade:       okrAvgProgress >= 80 ? "A" : okrAvgProgress >= 60 ? "B" : okrAvgProgress >= 40 ? "C" : "D"
        }
    };

    const reports = load(tenantId, "board-reports", []);
    reports.push(report);
    flush(tenantId, "board-reports", reports.slice(-500));
    auditLog(tenantId, userId, "board_report_generated", { type, period: report.period });
    return ok("boardReportingAgent", report);
}

function getReportHistory(tenantId, requesterId, limit = 10) {
    const auth = requireAuth(tenantId, requesterId, "admin");
    if (!auth.ok) return forbidden("boardReportingAgent", auth.error);

    const reports = load(tenantId, "board-reports", []).slice(-limit);
    return ok("boardReportingAgent", { total: reports.length, reports: reports.map(r => ({ id: r.id, type: r.type, period: r.period, generatedAt: r.generatedAt })) });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "generate_report")  return generateReport(p);
        if (task.type === "report_history")   return getReportHistory(p.tenantId, p.userId, p.limit || 10);
        return generateReport({ ...p, type: "executive_summary" });
    } catch (err) { return fail("boardReportingAgent", err.message); }
}

module.exports = { generateReport, getReportHistory, REPORT_TYPES, run };
