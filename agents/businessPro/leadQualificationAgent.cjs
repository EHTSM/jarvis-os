/**
 * Lead Qualification Agent — scores CRM leads as HOT / WARM / COLD.
 * Reads from existing crm.cjs (single source of truth).
 * Updates lead status via updateLead().
 */

const { getLeads, updateLead } = require("../crm.cjs");
const { NOW } = require("./_store.cjs");

const SCORE_RULES = [
    // Positive signals
    { field: "status",   match: "hot",         score: 40 },
    { field: "status",   match: "interested",  score: 20 },
    { field: "status",   match: "follow_up",   score: 15 },
    { field: "status",   match: "new",         score: 5  },
    { field: "status",   match: "paid",        score: 60 },
    // Engagement
    { field: "notes",    contains: "budget",   score: 15 },
    { field: "notes",    contains: "urgent",   score: 20 },
    { field: "notes",    contains: "buy",      score: 25 },
    { field: "notes",    contains: "price",    score: 10 },
    { field: "notes",    contains: "demo",     score: 15 },
    // Negative signals
    { field: "status",   match: "lost",        score: -30 },
    { field: "notes",    contains: "no",       score: -10 },
    { field: "notes",    contains: "not interested", score: -25 }
];

function _score(lead) {
    let total = 0;
    for (const rule of SCORE_RULES) {
        const val = (lead[rule.field] || "").toLowerCase();
        if (rule.match    && val === rule.match)      total += rule.score;
        if (rule.contains && val.includes(rule.contains)) total += rule.score;
    }

    // Recency boost: leads updated in last 7 days get +10
    if (lead.updatedAt || lead.createdAt) {
        const age = (Date.now() - new Date(lead.updatedAt || lead.createdAt).getTime()) / 86_400_000;
        if (age < 7)  total += 10;
        if (age > 30) total -= 10;
    }

    return Math.max(0, Math.min(100, total));
}

function _grade(score) {
    if (score >= 50) return "hot";
    if (score >= 25) return "warm";
    return "cold";
}

/**
 * Qualify a single lead by phone.
 */
function qualifyOne(phone) {
    const leads = getLeads();
    const lead  = leads.find(l => l.phone === phone);
    if (!lead) return null;

    const score     = _score(lead);
    const grade     = _grade(score);
    const qualified = { qualificationScore: score, qualificationGrade: grade, qualifiedAt: NOW() };

    updateLead(phone, { ...qualified, status: grade === "hot" ? "hot" : lead.status });
    return { ...lead, ...qualified };
}

/**
 * Qualify all leads in the CRM and return a segmented report.
 */
function qualifyAll() {
    const leads  = getLeads();
    const results = { hot: [], warm: [], cold: [], total: leads.length };

    for (const lead of leads) {
        const score = _score(lead);
        const grade = _grade(score);
        updateLead(lead.phone, { qualificationScore: score, qualificationGrade: grade, qualifiedAt: NOW() });
        results[grade].push({ name: lead.name, phone: lead.phone, score, status: lead.status });
    }

    return {
        ...results,
        summary: `Qualified ${leads.length} leads — Hot: ${results.hot.length}, Warm: ${results.warm.length}, Cold: ${results.cold.length}`,
        hotCount:  results.hot.length,
        warmCount: results.warm.length,
        coldCount: results.cold.length
    };
}

async function run(task) {
    const p     = task.payload || {};
    const phone = p.phone || p.contact || null;

    try {
        const data = phone ? qualifyOne(phone) : qualifyAll();
        if (!data) return { success: false, type: "business_pro", agent: "leadQualificationAgent", data: { error: "Lead not found" } };
        return { success: true, type: "business_pro", agent: "leadQualificationAgent", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "leadQualificationAgent", data: { error: err.message } };
    }
}

module.exports = { qualifyOne, qualifyAll, run };
