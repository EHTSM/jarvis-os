"use strict";
const { load, flush, uid, NOW, auditLog, scoreRisk, ok, fail } = require("./_legalStore.cjs");
const AGENT = "complianceChecker";

const FRAMEWORKS = {
    gdpr: {
        name:"GDPR (EU General Data Protection Regulation)",
        jurisdiction:"EU",
        applicableTo:"Any organisation processing EU resident data",
        requirements:["Lawful basis for processing","Privacy notice / policy","Data subject rights mechanism","DPO appointment (if required)","Data processing agreements with vendors","Breach notification within 72 hours","Data retention policy","DPIA for high-risk processing","Records of processing activities"],
        penalties:"Up to €20M or 4% of global annual turnover",
        checklist:["Have you identified your lawful basis for each processing activity?","Do you have a published privacy policy?","Can users exercise their rights (access, erasure, portability)?","Do you have a DPA with all third-party processors?","Do you have a breach response plan?","Is your data retention schedule documented?"]
    },
    dpdp: {
        name:"DPDP Act 2023 (India Digital Personal Data Protection Act)",
        jurisdiction:"India",
        applicableTo:"All entities processing personal data of Indian residents",
        requirements:["Notice in clear language before processing","Consent management","Data Fiduciary obligations","Significant Data Fiduciary obligations (if applicable)","Data localisation (for SDFs)","Grievance redressal mechanism","Children's data consent (verified parental consent)"],
        penalties:"Up to ₹250 crore per instance",
        checklist:["Do you provide notice before collecting data?","Is consent freely given, specific, and revocable?","Do you have a grievance officer designated?","Are you processing children's data with verified parental consent?","Do you have data minimisation practices?"]
    },
    posh: {
        name:"POSH Act (Prevention of Sexual Harassment at Workplace) India",
        jurisdiction:"India",
        applicableTo:"All organisations with 10+ employees",
        requirements:["Internal Complaints Committee (ICC) constituted","ICC includes external member","Annual report to District Officer","POSH policy published","POSH training conducted","Complaint mechanism established"],
        penalties:"₹50,000 fine for non-compliance; cancellation of licence",
        checklist:["Is your ICC constituted with the right composition?","Have you filed your annual report?","Is your POSH policy displayed at workplace?","Has mandatory training been conducted?","Is there a confidential complaint mechanism?"]
    },
    iso27001: {
        name:"ISO/IEC 27001:2022 — Information Security Management",
        jurisdiction:"Global",
        applicableTo:"Any organisation seeking information security certification",
        requirements:["ISMS scope definition","Risk assessment and treatment","Information security policy","Asset management","Access control","Cryptography policy","Physical security","Incident management","Business continuity","Supplier security"],
        penalties:"Non-certification (competitive disadvantage, contract loss)",
        checklist:["Is ISMS scope formally documented?","Has a risk assessment been completed?","Are controls from Annex A implemented as applicable?","Is there a documented incident response plan?","Are supplier agreements assessed for security?"]
    },
    rbi_data: {
        name:"RBI Data Localisation Guidelines",
        jurisdiction:"India",
        applicableTo:"Payment system operators and banks in India",
        requirements:["Payment data stored only in India","End-to-end data for payment processing in India","Audit report submission","No foreign storage of complete transaction data"],
        penalties:"Regulatory action by RBI including licence cancellation",
        checklist:["Is all payment data stored within India?","Have you submitted your compliance audit report to RBI?","Are processing systems physically located in India?"]
    }
};

function checkCompliance({ userId, frameworkKey, answers = {} }) {
    if (!userId || !frameworkKey) return fail(AGENT, "userId and frameworkKey required");
    const key  = frameworkKey.toLowerCase().replace(/\s+/g,"_").replace(/-/g,"_");
    const fw   = FRAMEWORKS[key];
    if (!fw)   return fail(AGENT, `Unknown framework. Available: ${Object.keys(FRAMEWORKS).join(", ")}`);

    auditLog(AGENT, userId, "compliance_check", { framework: key });

    const checklistResults = fw.checklist.map((q, i) => ({
        item:    i + 1,
        question:q,
        status:  answers[`q${i+1}`] === "yes" ? "compliant" : answers[`q${i+1}`] === "no" ? "non_compliant" : "not_assessed"
    }));

    const compliant    = checklistResults.filter(r => r.status === "compliant").length;
    const nonCompliant = checklistResults.filter(r => r.status === "non_compliant").length;
    const assessed     = checklistResults.filter(r => r.status !== "not_assessed").length;
    const score        = assessed ? Math.round(compliant / assessed * 100) : null;
    const overallStatus = score === null ? "not_assessed" : score === 100 ? "compliant" : score >= 70 ? "mostly_compliant" : score >= 40 ? "partial" : "non_compliant";

    const result = {
        id:          uid("cc"),
        userId,
        framework:   fw.name,
        jurisdiction:fw.jurisdiction,
        overallStatus,
        complianceScore: score !== null ? `${score}%` : "N/A",
        checklist:   checklistResults,
        gaps:        checklistResults.filter(r => r.status === "non_compliant"),
        requirements:fw.requirements,
        penalties:   fw.penalties,
        riskLevel:   scoreRisk(nonCompliant >= 3 ? ["regulatoryBreach","dataPrivacy"] : nonCompliant >= 1 ? ["regulatoryBreach"] : []),
        checkedAt:   NOW()
    };

    const history = load(userId, "compliance_checks", []);
    history.push({ id: result.id, framework: key, overallStatus, checkedAt: result.checkedAt });
    flush(userId, "compliance_checks", history.slice(-50));

    return ok(AGENT, result);
}

function getFrameworks() { return ok(AGENT, { frameworks: Object.entries(FRAMEWORKS).map(([k, v]) => ({ key: k, name: v.name, jurisdiction: v.jurisdiction, applicableTo: v.applicableTo })) }); }

module.exports = { checkCompliance, getFrameworks };
