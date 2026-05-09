"use strict";
const { load, flush, loadGlobal, flushGlobal, uid, NOW, govAudit, ok, fail, GOV_DISCLAIMER } = require("./_governanceStore.cjs");
const AGENT = "transparencyEngine";

const DISCLOSURE_TYPES = {
    financial:     { name:"Financial Disclosure",     frequency:"quarterly", audience:"public", required:true },
    conflict:      { name:"Conflict of Interest",     frequency:"annual",    audience:"board",  required:true },
    executive_comp:{ name:"Executive Compensation",   frequency:"annual",    audience:"public", required:true },
    related_party: { name:"Related Party Transactions",frequency:"annual",   audience:"public", required:true },
    material_event:{ name:"Material Event",           frequency:"event-based",audience:"public",required:true },
    esg_report:    { name:"ESG/Sustainability Report",frequency:"annual",    audience:"public", required:false },
    policy_update: { name:"Policy Change",            frequency:"event-based",audience:"stakeholder",required:false }
};

function publishDisclosure({ userId, organizationId, type, title, summary, content, period, audience, isPublic = false }) {
    if (!userId || !type || !title) return fail(AGENT, "userId, type, and title required");
    if (!DISCLOSURE_TYPES[type]) return fail(AGENT, `type must be: ${Object.keys(DISCLOSURE_TYPES).join(", ")}`);

    const disclosureConf = DISCLOSURE_TYPES[type];
    const orgKey = organizationId || userId;
    const disclosures = loadGlobal(`disclosures_${orgKey}`, []);

    const disclosure = {
        id:           uid("disc"),
        type,
        typeName:     disclosureConf.name,
        title,
        summary:      summary || null,
        content:      content || null,
        period:       period || NOW().slice(0, 7),
        audience:     audience || disclosureConf.audience,
        isPublic:     isPublic || disclosureConf.audience === "public",
        publishedBy:  userId,
        publishedAt:  NOW(),
        status:       "PUBLISHED"
    };

    disclosures.push(disclosure);
    flushGlobal(`disclosures_${orgKey}`, disclosures);

    govAudit(AGENT, userId, "disclosure_published", { disclosureId: disclosure.id, type, isPublic: disclosure.isPublic }, "HIGH");
    return ok(AGENT, { disclosureId: disclosure.id, type: disclosure.typeName, publishedAt: disclosure.publishedAt, isPublic: disclosure.isPublic, disclaimer: GOV_DISCLAIMER });
}

function getDisclosures({ userId, organizationId, type, fromDate, isPublicOnly = false }) {
    if (!userId) return fail(AGENT, "userId required");

    const orgKey = organizationId || userId;
    let   list   = loadGlobal(`disclosures_${orgKey}`, []);

    if (type)         list = list.filter(d => d.type === type);
    if (fromDate)     list = list.filter(d => new Date(d.publishedAt) >= new Date(fromDate));
    if (isPublicOnly) list = list.filter(d => d.isPublic);

    govAudit(AGENT, userId, "disclosures_viewed", { orgKey, count: list.length }, "INFO");
    return ok(AGENT, { total: list.length, disclosures: list.map(d => ({ id:d.id, type:d.typeName, title:d.title, period:d.period, isPublic:d.isPublic, publishedAt:d.publishedAt })), disclaimer: GOV_DISCLAIMER });
}

function recordStakeholderEngagement({ userId, organizationId, stakeholderGroup, channel, summary, actionItems = [], date }) {
    if (!userId || !stakeholderGroup || !channel) return fail(AGENT, "userId, stakeholderGroup, and channel required");

    const orgKey   = organizationId || userId;
    const log      = load(userId, `engagement_log_${orgKey}`, []);

    const record = {
        id:               uid("eng"),
        stakeholderGroup,
        channel,
        summary:          summary || null,
        actionItems,
        date:             date || NOW(),
        recordedBy:       userId,
        recordedAt:       NOW()
    };

    log.push(record);
    flush(userId, `engagement_log_${orgKey}`, log.slice(-2000));

    govAudit(AGENT, userId, "engagement_recorded", { engagementId: record.id, stakeholderGroup, channel }, "INFO");
    return ok(AGENT, { engagementId: record.id, stakeholderGroup, channel, date: record.date });
}

function getTransparencyScore({ userId, organizationId }) {
    if (!userId) return fail(AGENT, "userId required");

    const orgKey      = organizationId || userId;
    const disclosures = loadGlobal(`disclosures_${orgKey}`, []);
    const engagements = load(userId, `engagement_log_${orgKey}`, []);

    const requiredTypes = Object.entries(DISCLOSURE_TYPES).filter(([,v]) => v.required).map(([k]) => k);
    const coveredTypes  = new Set(disclosures.map(d => d.type));
    const coveragePct   = Math.round(requiredTypes.filter(t => coveredTypes.has(t)).length / requiredTypes.length * 100);

    const recentEngagements = engagements.filter(e => new Date(e.recordedAt) >= new Date(Date.now() - 90 * 86400000)).length;
    const engagementScore   = Math.min(100, recentEngagements * 10);

    const totalScore = Math.round(coveragePct * 0.6 + engagementScore * 0.4);
    const band       = totalScore >= 80 ? "EXCELLENT" : totalScore >= 60 ? "GOOD" : totalScore >= 40 ? "NEEDS_IMPROVEMENT" : "POOR";

    govAudit(AGENT, userId, "transparency_score_computed", { orgKey, totalScore, band }, "INFO");
    return ok(AGENT, { organizationId:orgKey, transparencyScore:totalScore, band, disclosureCoveragePct:coveragePct, recentEngagementsQ:recentEngagements, engagementScore, disclaimer:GOV_DISCLAIMER });
}

module.exports = { publishDisclosure, getDisclosures, recordStakeholderEngagement, getTransparencyScore };
