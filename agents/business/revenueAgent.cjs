/**
 * Revenue Agent — tracks earnings from subscriptions + paid CRM leads.
 * Reads from: data/subscriptions.json + data/leads.json (single sources of truth).
 */

const fs   = require("fs");
const path = require("path");

const SUBS_FILE  = path.join(__dirname, "../../data/subscriptions.json");
const LEADS_FILE = path.join(__dirname, "../../data/leads.json");

function _read(file) {
    try {
        if (!fs.existsSync(file)) return [];
        return JSON.parse(fs.readFileSync(file, "utf8")) || [];
    } catch { return []; }
}

function _sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth()    === b.getMonth()    &&
           a.getDate()     === b.getDate();
}

function _sameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth()    === b.getMonth();
}

function _stats() {
    const now   = new Date();
    const subs  = _read(SUBS_FILE);
    const leads = _read(LEADS_FILE);

    // Revenue from subscriptions
    const paidSubs    = subs.filter(s => s.active && s.amount > 0);
    const totalSubRev = paidSubs.reduce((s, sub) => s + (sub.amount || 0), 0);
    const dailySubRev = paidSubs
        .filter(s => _sameDay(new Date(s.startDate || s.updatedAt), now))
        .reduce((s, sub) => s + (sub.amount || 0), 0);
    const monthlySubRev = paidSubs
        .filter(s => _sameMonth(new Date(s.startDate || s.updatedAt), now))
        .reduce((s, sub) => s + (sub.amount || 0), 0);

    // Paid leads from CRM (any lead with status "paid")
    const paidLeads    = leads.filter(l => l.status === "paid");
    const totalLeadRev = paidLeads.reduce((s, l) => s + (l.amount || 0), 0);
    const dailyLeadRev = paidLeads
        .filter(l => _sameDay(new Date(l.createdAt || l.updatedAt || 0), now))
        .reduce((s, l) => s + (l.amount || 0), 0);

    const total   = totalSubRev + totalLeadRev;
    const daily   = dailySubRev + dailyLeadRev;
    const monthly = monthlySubRev;

    return {
        total_revenue_inr:   total,
        daily_revenue_inr:   daily,
        monthly_revenue_inr: monthly,
        paid_subscribers:    paidSubs.length,
        paid_leads:          paidLeads.length,
        active_plans:        [...new Set(paidSubs.map(s => s.plan))],
        conversion_rate_pct: leads.length > 0
            ? ((paidLeads.length / leads.length) * 100).toFixed(1) + "%"
            : "0%",
        ts: new Date().toISOString()
    };
}

function perUser(userId) {
    const subs  = _read(SUBS_FILE).filter(s => s.userId === userId);
    const leads = _read(LEADS_FILE).filter(l => l.phone === userId || l.id === userId);
    const total = subs.reduce((s, sub) => s + (sub.amount || 0), 0)
                + leads.filter(l => l.status === "paid").reduce((s, l) => s + (l.amount || 0), 0);
    return { userId, total_revenue_inr: total, subscriptions: subs.length };
}

async function run(task) {
    const p = task.payload || {};

    switch (task.type) {
        case "show_revenue":
        case "revenue_stats":
        case "get_revenue":
            return { success: true, type: "revenueAgent", data: _stats() };

        case "revenue_per_user":
            if (!p.userId) return { success: false, type: "revenueAgent", data: { error: "userId required" } };
            return { success: true, type: "revenueAgent", data: perUser(p.userId) };

        default:
            return { success: true, type: "revenueAgent", data: _stats() };
    }
}

module.exports = { run, stats: _stats, perUser };
