"use strict";
const { load, flush, uid, NOW, govAudit, ok, fail, GOV_DISCLAIMER } = require("./_governanceStore.cjs");
const AGENT = "regulationTracker";

const REGULATIONS = {
    // India
    DPDP_2023:   { name:"Digital Personal Data Protection Act 2023", jurisdiction:"India", effective:"2024-01-01", authority:"MeitY", category:"data_privacy", penalty:"Up to ₹250 Cr", status:"ACTIVE" },
    IT_ACT_2000: { name:"Information Technology Act 2000 (amended 2008)", jurisdiction:"India", effective:"2000-10-17", authority:"MeitY", category:"cyber_law", penalty:"Criminal + civil", status:"ACTIVE" },
    SEBI_LODR:   { name:"SEBI (LODR) Regulations 2015", jurisdiction:"India", effective:"2015-09-02", authority:"SEBI", category:"listed_company", penalty:"Up to ₹25 Cr", status:"ACTIVE" },
    GST_ACT:     { name:"Goods and Services Tax Act 2017", jurisdiction:"India", effective:"2017-07-01", authority:"GSTN", category:"taxation", penalty:"Tax + interest + penalty", status:"ACTIVE" },
    POSH_2013:   { name:"POSH Act 2013 (Sexual Harassment at Workplace)", jurisdiction:"India", effective:"2013-12-09", authority:"Ministry of WCD", category:"workplace", penalty:"₹50,000 + license cancellation", status:"ACTIVE" },
    RBI_DPDL:    { name:"RBI Data Localisation Mandate", jurisdiction:"India", effective:"2019-06-30", authority:"RBI", category:"data_localisation", penalty:"License suspension", status:"ACTIVE" },
    COMPANIES_ACT:{ name:"Companies Act 2013", jurisdiction:"India", effective:"2013-09-12", authority:"MCA", category:"corporate_governance", penalty:"Criminal + civil", status:"ACTIVE" },
    // International
    GDPR:        { name:"General Data Protection Regulation", jurisdiction:"EU", effective:"2018-05-25", authority:"DPA (per member state)", category:"data_privacy", penalty:"Up to 4% global turnover or €20M", status:"ACTIVE" },
    CCPA:        { name:"California Consumer Privacy Act", jurisdiction:"USA-CA", effective:"2020-01-01", authority:"California AG", category:"data_privacy", penalty:"Up to $7,500 per violation", status:"ACTIVE" },
    SOX:         { name:"Sarbanes-Oxley Act", jurisdiction:"USA", effective:"2002-07-30", authority:"SEC/PCAOB", category:"financial_reporting", penalty:"Criminal + fines", status:"ACTIVE" },
    HIPAA:       { name:"Health Insurance Portability and Accountability Act", jurisdiction:"USA", effective:"1996-08-21", authority:"HHS OCR", category:"healthcare", penalty:"Up to $1.9M per violation type/year", status:"ACTIVE" },
    ISO_27001:   { name:"ISO/IEC 27001:2022 (Information Security)", jurisdiction:"International", effective:"2022-10-25", authority:"ISO", category:"information_security", penalty:"Certification loss", status:"ACTIVE" },
    PCI_DSS:     { name:"PCI DSS v4.0", jurisdiction:"International", effective:"2024-03-31", authority:"PCI Council", category:"payment_security", penalty:"Fines + loss of card acceptance", status:"ACTIVE" }
};

function searchRegulations({ userId, jurisdiction, category, keyword }) {
    if (!userId) return fail(AGENT, "userId required");

    let results = Object.entries(REGULATIONS).map(([id, r]) => ({ id, ...r }));
    if (jurisdiction) results = results.filter(r => r.jurisdiction.toLowerCase().includes(jurisdiction.toLowerCase()));
    if (category)     results = results.filter(r => r.category === category);
    if (keyword)      results = results.filter(r => r.name.toLowerCase().includes(keyword.toLowerCase()) || r.category.includes(keyword.toLowerCase()));

    govAudit(AGENT, userId, "regulations_searched", { jurisdiction, category, keyword, count: results.length }, "INFO");
    return ok(AGENT, { total: results.length, regulations: results, disclaimer: GOV_DISCLAIMER });
}

function trackCompliance({ userId, organizationId, regulationId, status, notes, reviewDate }) {
    if (!userId || !regulationId || !status) return fail(AGENT, "userId, regulationId, and status required");

    const validStatuses = ["COMPLIANT","PARTIAL","NON_COMPLIANT","UNDER_REVIEW","NOT_APPLICABLE"];
    if (!validStatuses.includes(status)) return fail(AGENT, `Status must be one of: ${validStatuses.join(", ")}`);

    const reg = REGULATIONS[regulationId];
    if (!reg) return fail(AGENT, `Unknown regulation ID: ${regulationId}. Use searchRegulations() to browse.`);

    const orgKey = organizationId || userId;
    const records = load(userId, `reg_compliance_${orgKey}`, {});
    records[regulationId] = {
        regulationId, status, notes: notes || null,
        reviewDate: reviewDate || null,
        updatedAt: NOW(), updatedBy: userId
    };
    flush(userId, `reg_compliance_${orgKey}`, records);

    govAudit(AGENT, userId, "compliance_status_updated", { regulationId, status }, status === "NON_COMPLIANT" ? "HIGH" : "INFO");
    return ok(AGENT, { regulationId, name: reg.name, status, updatedAt: records[regulationId].updatedAt });
}

function getComplianceMatrix({ userId, organizationId }) {
    if (!userId) return fail(AGENT, "userId required");

    const orgKey  = organizationId || userId;
    const records = load(userId, `reg_compliance_${orgKey}`, {});

    const matrix = Object.entries(REGULATIONS).map(([id, reg]) => ({
        regulationId: id,
        name:         reg.name,
        jurisdiction: reg.jurisdiction,
        category:     reg.category,
        penalty:      reg.penalty,
        status:       records[id]?.status || "NOT_REVIEWED",
        notes:        records[id]?.notes || null,
        reviewDate:   records[id]?.reviewDate || null,
        lastUpdated:  records[id]?.updatedAt || null
    }));

    const summary = { COMPLIANT:0, PARTIAL:0, NON_COMPLIANT:0, UNDER_REVIEW:0, NOT_APPLICABLE:0, NOT_REVIEWED:0 };
    matrix.forEach(m => { summary[m.status] = (summary[m.status] || 0) + 1; });

    govAudit(AGENT, userId, "compliance_matrix_viewed", { orgKey }, "INFO");
    return ok(AGENT, { organizationId: orgKey, totalRegulations: matrix.length, summary, matrix, disclaimer: GOV_DISCLAIMER });
}

function setReviewReminder({ userId, regulationId, reviewDate, assignedTo }) {
    if (!userId || !regulationId || !reviewDate) return fail(AGENT, "userId, regulationId, and reviewDate required");

    const reg = REGULATIONS[regulationId];
    if (!reg) return fail(AGENT, `Unknown regulation: ${regulationId}`);

    const reminders = load(userId, "reg_reminders", []);
    reminders.push({ id: uid("rem"), regulationId, regulationName: reg.name, reviewDate, assignedTo: assignedTo || userId, createdAt: NOW() });
    flush(userId, "reg_reminders", reminders);

    govAudit(AGENT, userId, "review_reminder_set", { regulationId, reviewDate }, "INFO");
    return ok(AGENT, { scheduled: true, regulationId, name: reg.name, reviewDate, assignedTo: assignedTo || userId });
}

module.exports = { searchRegulations, trackCompliance, getComplianceMatrix, setReviewReminder };
