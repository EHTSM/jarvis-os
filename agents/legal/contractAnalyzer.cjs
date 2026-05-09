"use strict";
const { load, flush, uid, NOW, auditLog, scoreRisk, ok, fail, DISCLAIMER } = require("./_legalStore.cjs");
const AGENT = "contractAnalyzer";

const RED_FLAG_PATTERNS = [
    { pattern:/unlimited\s+liabilit/i,       severity:"HIGH",   issue:"Unlimited liability clause — exposes you to uncapped financial risk" },
    { pattern:/unilateral(ly)?\s+(amend|change|modif)/i, severity:"HIGH", issue:"Unilateral amendment right — other party can change terms without your consent" },
    { pattern:/perpetual\s+licen/i,           severity:"MEDIUM", issue:"Perpetual license granted — you may be giving up rights indefinitely" },
    { pattern:/irrevocable/i,                 severity:"MEDIUM", issue:"Irrevocable clause — cannot be undone once agreed" },
    { pattern:/auto.?renew/i,                 severity:"MEDIUM", issue:"Auto-renewal clause — contract continues unless actively cancelled" },
    { pattern:/exclusiv/i,                    severity:"MEDIUM", issue:"Exclusivity clause — restricts your ability to work with others" },
    { pattern:/non.?compet/i,                 severity:"HIGH",   issue:"Non-compete clause — restricts your future activities" },
    { pattern:/indemnif/i,                    severity:"MEDIUM", issue:"Indemnification clause — you may be responsible for third-party losses" },
    { pattern:/no\s+warrant/i,                severity:"MEDIUM", issue:"No warranty clause — other party disclaims all guarantees" },
    { pattern:/binding\s+arbitration/i,       severity:"LOW",    issue:"Binding arbitration — waives right to sue in court" },
    { pattern:/governing\s+law.{0,30}(delaware|cayman|offshore)/i, severity:"MEDIUM", issue:"Offshore governing law — may disadvantage you in disputes" },
    { pattern:/waive.{0,20}class\s+action/i,  severity:"HIGH",   issue:"Class action waiver — prevents joining group lawsuits" }
];

const CONTRACT_TYPES = {
    employment:   { mustHave:["notice period","termination clause","confidentiality","governing law","salary","probation"], minMonths:12 },
    saas:         { mustHave:["SLA","data ownership","termination for convenience","limitation of liability","GDPR/data processing"], minMonths:12 },
    nda:          { mustHave:["definition of confidential","exclusions","duration","permitted disclosures","jurisdiction"], minMonths:24 },
    service:      { mustHave:["scope of work","payment terms","IP ownership","termination","dispute resolution"], minMonths:6 },
    partnership:  { mustHave:["profit sharing","decision making","exit provisions","liability","governing law"], minMonths:12 },
    lease:        { mustHave:["rent amount","duration","deposit","maintenance responsibility","break clause"], minMonths:12 }
};

function analyzeText({ userId, contractText, contractType = "service", jurisdiction = "India" }) {
    if (!userId || !contractText) return fail(AGENT, "userId and contractText required");
    const logId = auditLog(AGENT, userId, "contract_analyzed", { contractType, jurisdiction, charCount: contractText.length });

    const flags   = RED_FLAG_PATTERNS.filter(r => r.pattern.test(contractText));
    const highRisk = flags.filter(f => f.severity === "HIGH");
    const typeInfo = CONTRACT_TYPES[contractType.toLowerCase()] || CONTRACT_TYPES.service;

    const missingClauses = typeInfo.mustHave.filter(clause =>
        !contractText.toLowerCase().includes(clause.split("/")[0].toLowerCase())
    );

    const riskScore = scoreRisk([
        ...(highRisk.length > 0 ? ["contractualDispute"] : []),
        ...(missingClauses.length > 2 ? ["ipClaim"] : [])
    ]);

    const analysis = {
        id:             uid("ca"),
        userId,
        contractType,
        jurisdiction,
        wordCount:      contractText.split(/\s+/).length,
        redFlags:       flags.map(f => ({ issue: f.issue, severity: f.severity })),
        highRiskCount:  highRisk.length,
        missingClauses,
        overallRisk:    riskScore,
        recommendation: highRisk.length >= 2
            ? "⚠️ HIGH RISK — Do NOT sign without legal review. Multiple critical clauses detected."
            : flags.length >= 3
            ? "⚠️ Review recommended before signing — moderate risk clauses present."
            : missingClauses.length >= 3
            ? "⚠️ Several standard clauses are missing — negotiate additions before signing."
            : "✓ No major red flags detected. Standard review recommended.",
        auditId:        logId,
        analyzedAt:     NOW()
    };

    const records = load(userId, "contract_analyses", []);
    records.push({ id: analysis.id, contractType, overallRisk: riskScore, analyzedAt: analysis.analyzedAt });
    flush(userId, "contract_analyses", records.slice(-100));

    return ok(AGENT, analysis);
}

function getContractTypes() { return ok(AGENT, CONTRACT_TYPES); }
function getRedFlagPatternList() {
    return ok(AGENT, RED_FLAG_PATTERNS.map(r => ({ issue: r.issue, severity: r.severity })));
}

module.exports = { analyzeText, getContractTypes, getRedFlagPatternList };
