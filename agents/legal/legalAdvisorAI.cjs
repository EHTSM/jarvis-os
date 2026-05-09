"use strict";
const { load, flush, uid, NOW, auditLog, scoreRisk, ok, fail, DISCLAIMER, JURISDICTIONS } = require("./_legalStore.cjs");
const AGENT = "legalAdvisorAI";

const LEGAL_DOMAINS = {
    contract:       { description:"Contract law — formation, breach, remedies", specialists:["Commercial Lawyer","Contract Specialist"] },
    employment:     { description:"Employment law — termination, discrimination, wages", specialists:["Employment Lawyer","HR Counsel"] },
    corporate:      { description:"Company law — incorporation, governance, M&A", specialists:["Corporate Lawyer","Company Secretary"] },
    ip:             { description:"Intellectual property — patents, trademarks, copyright", specialists:["IP Lawyer","Patent Attorney"] },
    criminal:       { description:"Criminal law — offences, defence, procedure", specialists:["Criminal Defence Lawyer"] },
    family:         { description:"Family law — divorce, custody, adoption", specialists:["Family Lawyer"] },
    property:       { description:"Property law — purchase, lease, disputes", specialists:["Property Lawyer","Conveyancer"] },
    tax:            { description:"Tax law — income, GST/VAT, international", specialists:["Tax Lawyer","Chartered Accountant"] },
    privacy:        { description:"Data protection — GDPR, DPDP Act, CCPA", specialists:["Privacy Lawyer","DPO"] },
    consumer:       { description:"Consumer protection — refunds, warranties, fraud", specialists:["Consumer Rights Lawyer"] },
    startup:        { description:"Startup law — equity, vesting, term sheets", specialists:["Startup Lawyer","VC Counsel"] },
    dispute:        { description:"Dispute resolution — litigation, arbitration, mediation", specialists:["Litigation Lawyer","Arbitrator"] }
};

const QUICK_GUIDANCE = {
    "what is gdpr":           "GDPR (General Data Protection Regulation) is an EU law governing how organisations collect, process and store personal data. It gives EU residents rights including access, erasure and portability. Applies to any business handling EU resident data.",
    "can i be fired without notice": "In most jurisdictions, employment can be terminated with contractual or statutory notice. Immediate dismissal (summary dismissal) requires gross misconduct. Check your employment contract and local labour laws.",
    "what is an nda":         "An NDA (Non-Disclosure Agreement) is a contract preventing parties from sharing confidential information. NDAs can be unilateral (one party) or mutual. They specify what is confidential, the duration, and remedies for breach.",
    "what is force majeure":  "Force majeure is a contractual clause excusing performance due to extraordinary events beyond a party's control (war, natural disaster, pandemic). It must be invoked promptly and typically doesn't excuse monetary obligations.",
    "what is fair use":       "Fair use (US) / fair dealing (UK/India) allows limited use of copyrighted material without permission for commentary, criticism, education, or parody. Assessed on purpose, nature, amount used, and market effect.",
    "how to register a trademark": "File an application with the Trademark Registry in your jurisdiction (IPO in India, USPTO in USA, EUIPO in EU). Conduct a prior search first. Registration typically takes 12-18 months and lasts 10 years (renewable).",
    "what is arbitration":    "Arbitration is a private dispute resolution process where parties agree to have a neutral arbitrator decide their dispute instead of going to court. Awards are generally binding and enforceable under the New York Convention."
};

function advise({ userId, question, domain, jurisdiction = "India", urgency = "low" }) {
    if (!userId || !question) return fail(AGENT, "userId and question required");

    const logId = auditLog(AGENT, userId, "legal_advice_requested", { domain, jurisdiction, urgency });
    const key   = question.toLowerCase().replace(/[?!]/g, "").trim();
    const quick = Object.entries(QUICK_GUIDANCE).find(([k]) => key.includes(k.split(" ")[0]) && key.includes(k.split(" ").slice(-1)[0]));

    const domainKey = (domain || "contract").toLowerCase();
    const domainInfo = LEGAL_DOMAINS[domainKey] || LEGAL_DOMAINS.contract;

    const riskFactors = [];
    if (urgency === "high")     riskFactors.push("jurisdictionConflict");
    if (domainKey === "criminal") riskFactors.push("criminalElement");

    const advice = {
        id:             uid("adv"),
        userId,
        question,
        domain:         domainKey,
        domainInfo,
        jurisdiction,
        urgency,
        guidance:       quick ? quick[1] : `For ${domainKey} law in ${jurisdiction}: This is a complex area requiring professional assessment. Key considerations include: (1) Review applicable statutes in ${jurisdiction}, (2) Examine any existing contractual arrangements, (3) Consider your rights and obligations, (4) Assess limitation periods.`,
        nextSteps:      [`Consult a ${domainInfo.specialists[0]} in ${jurisdiction}`, "Gather all relevant documents", "Note key dates and deadlines", "Do not take unilateral action without legal advice"],
        specialists:    domainInfo.specialists,
        riskLevel:      scoreRisk(riskFactors),
        auditId:        logId,
        createdAt:      NOW()
    };

    const history = load(userId, "advice_history", []);
    history.push({ id: advice.id, question, domain, jurisdiction, createdAt: advice.createdAt });
    flush(userId, "advice_history", history.slice(-200));

    return ok(AGENT, advice);
}

function getDomains()      { return ok(AGENT, { domains: LEGAL_DOMAINS, jurisdictions: JURISDICTIONS }); }
function getAdviceHistory({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    return ok(AGENT, load(userId, "advice_history", []));
}

module.exports = { advise, getDomains, getAdviceHistory };
