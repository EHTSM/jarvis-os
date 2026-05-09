"use strict";
const { load, flush, loadGlobal, uid, NOW, govAudit, ok, fail, GOV_DISCLAIMER } = require("./_governanceStore.cjs");
const AGENT = "governanceDashboard";

const HEALTH_DIMENSIONS = {
    compliance:    { name:"Compliance Score",     weight: 0.30 },
    riskControl:   { name:"Risk Control",         weight: 0.25 },
    transparency:  { name:"Transparency",         weight: 0.20 },
    auditReadiness:{ name:"Audit Readiness",      weight: 0.15 },
    ethicsScore:   { name:"Ethics & Conduct",     weight: 0.10 }
};

const KPI_DEFINITIONS = {
    policy_coverage:     { name:"Policy Coverage %",         ideal: ">=90" },
    open_risks:          { name:"Open Risk Items",           ideal: "<=5" },
    audit_completion:    { name:"Audit Completion %",        ideal: ">=95" },
    incidents_30d:       { name:"Incidents (30 days)",       ideal: "<=2" },
    compliance_score:    { name:"Compliance Score",          ideal: ">=80" },
    board_meeting_freq:  { name:"Board Meetings (quarter)",  ideal: ">=3" },
    policy_reviews_due:  { name:"Policies Due for Review",   ideal: "=0" }
};

function recordKPI({ userId, organizationId, kpiKey, value, period }) {
    if (!userId || !kpiKey || value === undefined) return fail(AGENT, "userId, kpiKey, and value required");
    if (!KPI_DEFINITIONS[kpiKey]) return fail(AGENT, `Unknown KPI. Valid: ${Object.keys(KPI_DEFINITIONS).join(", ")}`);

    const orgKey = organizationId || userId;
    const kpis   = load(userId, `kpi_${orgKey}`, []);
    const entry  = { id: uid("kpi"), kpiKey, value, period: period || NOW().slice(0,7), recordedAt: NOW(), recordedBy: userId };
    kpis.push(entry);
    flush(userId, `kpi_${orgKey}`, kpis.slice(-10000));

    govAudit(AGENT, userId, "kpi_recorded", { kpiKey, value, period: entry.period }, "INFO");
    return ok(AGENT, { id: entry.id, kpiKey, kpiName: KPI_DEFINITIONS[kpiKey].name, value, ideal: KPI_DEFINITIONS[kpiKey].ideal, period: entry.period });
}

function getDashboard({ userId, organizationId }) {
    if (!userId) return fail(AGENT, "userId required");

    const orgKey = organizationId || userId;
    const kpis   = load(userId, `kpi_${orgKey}`, []);
    const scores = load(userId, `dimension_scores_${orgKey}`, {});

    const latestKPIs = {};
    for (const k of Object.keys(KPI_DEFINITIONS)) {
        const entries = kpis.filter(e => e.kpiKey === k);
        if (entries.length) latestKPIs[k] = entries[entries.length - 1];
    }

    const healthScore = Object.entries(HEALTH_DIMENSIONS).reduce((total, [dim, conf]) => {
        const s = scores[dim] || 0;
        return total + s * conf.weight;
    }, 0);

    const healthBand = healthScore >= 80 ? "EXCELLENT" : healthScore >= 65 ? "GOOD" : healthScore >= 50 ? "NEEDS_IMPROVEMENT" : "CRITICAL";

    govAudit(AGENT, userId, "dashboard_viewed", { orgKey, healthScore: healthScore.toFixed(1) }, "INFO");

    return ok(AGENT, {
        organizationId: orgKey,
        healthScore:    parseFloat(healthScore.toFixed(1)),
        healthBand,
        dimensions:     Object.entries(HEALTH_DIMENSIONS).map(([key, conf]) => ({
            key, name: conf.name, score: scores[key] || 0, weight: conf.weight
        })),
        kpis:           Object.entries(latestKPIs).map(([k, entry]) => ({
            key: k, name: KPI_DEFINITIONS[k].name, value: entry.value, period: entry.period, ideal: KPI_DEFINITIONS[k].ideal
        })),
        disclaimer:     GOV_DISCLAIMER,
        generatedAt:    NOW()
    });
}

function updateDimensionScore({ userId, organizationId, dimension, score }) {
    if (!userId || !dimension || score === undefined) return fail(AGENT, "userId, dimension, and score required");
    if (!HEALTH_DIMENSIONS[dimension]) return fail(AGENT, `Unknown dimension. Valid: ${Object.keys(HEALTH_DIMENSIONS).join(", ")}`);
    if (score < 0 || score > 100) return fail(AGENT, "Score must be 0–100");

    const orgKey = organizationId || userId;
    const scores = load(userId, `dimension_scores_${orgKey}`, {});
    scores[dimension] = score;
    flush(userId, `dimension_scores_${orgKey}`, scores);

    govAudit(AGENT, userId, "dimension_score_updated", { dimension, score }, "INFO");
    return ok(AGENT, { dimension, name: HEALTH_DIMENSIONS[dimension].name, score, updatedAt: NOW() });
}

function generateGovernanceReport({ userId, organizationId, period }) {
    if (!userId) return fail(AGENT, "userId required");

    const orgKey  = organizationId || userId;
    const kpis    = load(userId, `kpi_${orgKey}`, []);
    const scores  = load(userId, `dimension_scores_${orgKey}`, {});
    const p       = period || NOW().slice(0, 7);
    const pKPIs   = kpis.filter(e => e.period === p);

    govAudit(AGENT, userId, "governance_report_generated", { orgKey, period: p }, "HIGH");

    return ok(AGENT, {
        reportId:    uid("rpt"),
        period:      p,
        organization:orgKey,
        kpiCount:    pKPIs.length,
        kpiSummary:  pKPIs.map(e => ({ key: e.kpiKey, value: e.value })),
        dimensionScores: scores,
        generatedBy: userId,
        generatedAt: NOW(),
        disclaimer:  GOV_DISCLAIMER
    });
}

module.exports = { recordKPI, getDashboard, updateDimensionScore, generateGovernanceReport };
