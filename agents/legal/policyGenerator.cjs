"use strict";
const { load, flush, uid, NOW, auditLog, ok, fail, DISCLAIMER } = require("./_legalStore.cjs");
const AGENT = "policyGenerator";

const POLICY_TYPES = {
    privacy:        { sections:["Introduction","Data We Collect","How We Use Data","Legal Basis","Data Sharing","Retention","Your Rights","Cookies","Security","Contact Us"], minSections:8 },
    terms:          { sections:["Acceptance","Services","Account Registration","User Obligations","Prohibited Content","IP Rights","Disclaimers","Limitation of Liability","Termination","Governing Law"], minSections:8 },
    cookie:         { sections:["What Are Cookies","Types of Cookies We Use","Third-Party Cookies","Cookie Consent","Managing Cookies","Updates"], minSections:4 },
    refund:         { sections:["Eligibility","Refund Period","Process","Exclusions","Partial Refunds","Processing Time","Contact"], minSections:5 },
    aml:            { sections:["Policy Statement","Customer Due Diligence","Enhanced Due Diligence","Suspicious Activity Reporting","Record Keeping","Training","MLRO Contact"], minSections:6 },
    data_retention: { sections:["Purpose","Retention Schedule","Deletion Process","Legal Holds","Data Subject Requests","Review Cycle"], minSections:4 },
    acceptable_use: { sections:["Permitted Use","Prohibited Activities","Security","Monitoring","Enforcement","Reporting Violations"], minSections:4 },
    whistleblower:  { sections:["Purpose","Scope","Reporting Channels","Protection Guarantees","Investigation Process","Confidentiality","Non-Retaliation"], minSections:5 }
};

const AML_RISK_COUNTRIES = ["Iran","North Korea","Myanmar","Russia","Belarus","Syria"];

function generatePolicy({ userId, policyType, companyInfo = {}, jurisdiction = "India", customSections = [] }) {
    if (!userId || !policyType) return fail(AGENT, "userId and policyType required");
    const key  = policyType.toLowerCase().replace(/\s+/g,"_");
    const tmpl = POLICY_TYPES[key];
    if (!tmpl) return fail(AGENT, `Unknown policy type. Available: ${Object.keys(POLICY_TYPES).join(", ")}`);

    auditLog(AGENT, userId, "policy_generated", { policyType: key, jurisdiction });

    const sections = [...tmpl.sections, ...customSections];
    const policy   = {
        id:           uid("pol"),
        userId,
        policyType:   key,
        jurisdiction,
        companyInfo,
        effectiveDate: new Date().toISOString().slice(0,10),
        sections:     sections.map((s, i) => ({
            order:   i + 1,
            heading: s,
            content: `[${s.toUpperCase()} — Customise this section with your specific practices. This is a template requiring legal review.]`
        })),
        legalRequirements: _getRequirements(key, jurisdiction),
        reviewNote:   `This policy should be reviewed by a qualified lawyer before publication. Ensure compliance with ${jurisdiction} law.`,
        exportFormats:["PDF","DOCX","Markdown","HTML"],
        createdAt:    NOW()
    };

    const docs = load(userId, "policies", []);
    docs.push({ id: policy.id, policyType: key, jurisdiction, createdAt: policy.createdAt });
    flush(userId, "policies", docs.slice(-50));

    return ok(AGENT, policy);
}

function _getRequirements(type, jurisdiction) {
    const map = {
        privacy:   { "India":"Must comply with DPDP Act 2023", "EU":"Must comply with GDPR", "USA":"Consider CCPA (California), CAN-SPAM" },
        terms:     { "India":"Indian Contract Act 1872 applies", "EU":"EU Consumer Rights Directive applies", "Global":"Specify jurisdiction clearly" },
        aml:       { "India":"PMLA 2002 + RBI AML Master Direction", "Global":"FATF Recommendations" }
    };
    const typeMap = map[type] || {};
    return typeMap[jurisdiction] || typeMap["Global"] || `Review applicable ${type} requirements in ${jurisdiction}`;
}

function getPolicyTypes() {
    return ok(AGENT, { types: Object.entries(POLICY_TYPES).map(([k, v]) => ({ key: k, sections: v.sections, minSections: v.minSections })) });
}

module.exports = { generatePolicy, getPolicyTypes };
