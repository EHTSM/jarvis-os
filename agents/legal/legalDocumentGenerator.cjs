"use strict";
const { load, flush, uid, NOW, auditLog, ok, fail, DISCLAIMER } = require("./_legalStore.cjs");
const AGENT = "legalDocumentGenerator";

const TEMPLATES = {
    nda: {
        title: "NON-DISCLOSURE AGREEMENT",
        sections: ["Parties","Definition of Confidential Information","Exclusions from Confidential Information","Obligations of Receiving Party","Duration","Return of Information","Remedies","Governing Law","Entire Agreement"],
        variables: ["disclosingParty","receivingParty","purpose","duration","jurisdiction","effectiveDate"]
    },
    employment: {
        title: "EMPLOYMENT AGREEMENT",
        sections: ["Parties","Position and Duties","Commencement Date","Remuneration","Working Hours","Confidentiality","Intellectual Property","Termination","Non-Solicitation","Governing Law"],
        variables: ["employer","employee","position","salary","startDate","probationPeriod","noticePeriod","jurisdiction"]
    },
    service: {
        title: "SERVICE AGREEMENT",
        sections: ["Parties","Services","Fees and Payment","Intellectual Property","Confidentiality","Warranties","Limitation of Liability","Term and Termination","Dispute Resolution","Governing Law"],
        variables: ["serviceProvider","client","services","fees","paymentTerms","startDate","jurisdiction"]
    },
    freelance: {
        title: "FREELANCE / INDEPENDENT CONTRACTOR AGREEMENT",
        sections: ["Parties","Engagement","Deliverables","Fees","IP Assignment","Independent Contractor Status","Confidentiality","Termination","Governing Law"],
        variables: ["contractor","client","project","fees","deliverables","deadline","jurisdiction"]
    },
    mou: {
        title: "MEMORANDUM OF UNDERSTANDING",
        sections: ["Parties","Background","Purpose","Scope","Responsibilities","Confidentiality","Term","Non-Binding Nature","Governing Law"],
        variables: ["party1","party2","purpose","duration","jurisdiction"]
    },
    privacy_policy: {
        title: "PRIVACY POLICY",
        sections: ["Introduction","Information We Collect","How We Use Information","Legal Basis (GDPR)","Data Sharing","Data Retention","Your Rights","Cookies","Security","Contact"],
        variables: ["companyName","website","dpoEmail","jurisdiction","effectiveDate"]
    }
};

function generateTemplate({ userId, documentType, variables = {}, jurisdiction = "India" }) {
    if (!userId || !documentType) return fail(AGENT, "userId and documentType required");
    const key      = documentType.toLowerCase().replace(/\s+/g,"_");
    const template = TEMPLATES[key];
    if (!template) return fail(AGENT, `Unknown document type. Available: ${Object.keys(TEMPLATES).join(", ")}`);

    auditLog(AGENT, userId, "document_generated", { documentType, jurisdiction });

    const missingVars = template.variables.filter(v => !variables[v]);

    const doc = {
        id:           uid("doc"),
        userId,
        documentType: key,
        title:        template.title,
        jurisdiction,
        variables:    { ...variables, jurisdiction },
        sections:     template.sections,
        missingVariables: missingVars,
        draft:        _buildDraft(template, { ...variables, jurisdiction }),
        status:       missingVars.length ? "draft_incomplete" : "draft_complete",
        disclaimer:   "DRAFT ONLY — This document requires review by a qualified lawyer before execution.",
        exportFormats:["PDF","DOCX","TXT"],
        createdAt:    NOW()
    };

    const docs = load(userId, "generated_docs", []);
    docs.push({ id: doc.id, documentType: key, status: doc.status, createdAt: doc.createdAt });
    flush(userId, "generated_docs", docs.slice(-100));

    return ok(AGENT, doc);
}

function _buildDraft(template, vars) {
    const fill = (s) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] || `[${k.toUpperCase()}]`);
    return `${template.title}\n\nEffective Date: ${vars.effectiveDate || "[DATE]"}\nJurisdiction: ${vars.jurisdiction || "[JURISDICTION]"}\n\n${template.sections.map((s, i) => `${i+1}. ${s}\n[${s.toUpperCase()} CONTENT — to be reviewed and customised by legal counsel]`).join("\n\n")}\n\n---\nDISCLAIMER: ${DISCLAIMER}`;
}

function getTemplates() { return ok(AGENT, { available: Object.entries(TEMPLATES).map(([k, v]) => ({ key: k, title: v.title, variables: v.variables })) }); }

function getUserDocs({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    return ok(AGENT, load(userId, "generated_docs", []));
}

module.exports = { generateTemplate, getTemplates, getUserDocs };
