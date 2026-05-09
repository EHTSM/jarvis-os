"use strict";
const { load, flush, uid, NOW, auditLog, ok, fail, DISCLAIMER } = require("./_legalStore.cjs");
const AGENT = "termsGenerator";

const MANDATORY_CLAUSES = {
    ecommerce:   ["Payment terms","Shipping and delivery","Returns and refunds","Consumer rights","Dispute resolution","Governing law","Limitation of liability"],
    saas:        ["Service availability (SLA)","Subscription and billing","Data ownership","Acceptable use","Termination","Limitation of liability","Intellectual property"],
    marketplace: ["User accounts","Prohibited items","Seller/buyer obligations","Transaction fees","Dispute resolution","Fraud prevention","Termination"],
    social:      ["User content","Content moderation","Privacy","Age restriction (18+/13+)","Prohibited content","Account termination","IP ownership"],
    mobile_app:  ["App usage","In-app purchases","Device permissions","Data collection","Third-party services","Updates","Termination"]
};

const MINIMUM_REQUIREMENTS = {
    "India":     ["Indian Contract Act 1872","Consumer Protection Act 2019 (for B2C)","IT Act 2000","DPDP Act 2023"],
    "EU":        ["GDPR","EU Consumer Rights Directive","DSA (Digital Services Act for large platforms)","Product Liability Directive"],
    "USA":       ["COPPA (if children's data)","CAN-SPAM (email)","CCPA (if California users)","State-specific consumer laws"]
};

function generateTerms({ userId, businessType, companyName, website, jurisdiction = "India", productDescription, additionalClauses = [] }) {
    if (!userId || !businessType || !companyName) return fail(AGENT, "userId, businessType, companyName required");
    auditLog(AGENT, userId, "terms_generated", { businessType, jurisdiction });

    const key      = businessType.toLowerCase().replace(/\s+/g,"_");
    const clauses  = [...(MANDATORY_CLAUSES[key] || MANDATORY_CLAUSES.saas), ...additionalClauses];
    const reqs     = MINIMUM_REQUIREMENTS[jurisdiction] || MINIMUM_REQUIREMENTS["India"];

    const terms = {
        id:               uid("tos"),
        userId,
        documentTitle:    "TERMS OF SERVICE / TERMS AND CONDITIONS",
        companyName,
        website:          website || "[WEBSITE URL]",
        businessType:     key,
        jurisdiction,
        effectiveDate:    NOW().slice(0,10),
        lastUpdated:      NOW().slice(0,10),
        mandatoryClauses: clauses,
        jurisdictionRequirements: reqs,
        sections:         [
            { title:"1. Acceptance of Terms", content:`By accessing ${website || "our service"}, you agree to these Terms of Service.` },
            { title:"2. Eligibility",          content:"You must be at least 18 years old to use our service." },
            ...clauses.map((c, i) => ({ title:`${i+3}. ${c}`, content:`[${c.toUpperCase()} — Customise this section for your business]` })),
            { title:"Last clause. Governing Law", content:`These Terms are governed by the laws of ${jurisdiction}. Disputes shall be resolved in courts of ${jurisdiction}.` }
        ],
        note:             "DRAFT — Review by a qualified lawyer is mandatory before publishing.",
        exportFormats:    ["HTML","PDF","DOCX","Markdown"],
        createdAt:        NOW()
    };

    const docs = load(userId, "terms_docs", []);
    docs.push({ id: terms.id, businessType: key, jurisdiction, createdAt: terms.createdAt });
    flush(userId, "terms_docs", docs.slice(-50));

    return ok(AGENT, terms);
}

function getBusinessTypes() { return ok(AGENT, { types: Object.keys(MANDATORY_CLAUSES), clauses: MANDATORY_CLAUSES }); }

module.exports = { generateTerms, getBusinessTypes };
