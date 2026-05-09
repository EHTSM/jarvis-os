"use strict";
const { load, flush, uid, NOW, govAudit, scoreRisk, ok, fail, blocked, GOV_DISCLAIMER } = require("./_governanceStore.cjs");
const AGENT = "ethicsAIMonitor";

const ETHICAL_PRINCIPLES = {
    fairness:      { name:"Fairness & Non-Discrimination", description:"AI outputs must not discriminate by protected characteristics" },
    transparency:  { name:"Transparency & Explainability", description:"AI decisions must be explainable and auditable" },
    privacy:       { name:"Privacy & Data Minimisation",   description:"Only collect and use data necessary for the purpose" },
    accountability:{ name:"Accountability",                description:"Clear human accountability for AI-driven decisions" },
    safety:        { name:"Safety & Reliability",          description:"AI systems must be safe, robust, and tested" },
    consent:       { name:"Informed Consent",              description:"Users must understand and agree to AI use" },
    human_oversight:{ name:"Human Oversight",             description:"High-stakes AI decisions must have human review" }
};

const RED_FLAGS = [
    { id:"RF001", name:"Automated Hiring/Firing",  risk:"HIGH",   principle:"accountability",  description:"Employment decisions without human review" },
    { id:"RF002", name:"Healthcare Diagnosis Solo", risk:"CRITICAL",principle:"safety",          description:"Medical diagnosis without physician oversight" },
    { id:"RF003", name:"Legal Judgment",           risk:"CRITICAL",principle:"accountability",  description:"Legal decisions without qualified human review" },
    { id:"RF004", name:"Financial Trading Auto",   risk:"HIGH",   principle:"accountability",  description:"Autonomous high-value financial execution" },
    { id:"RF005", name:"Biometric Surveillance",   risk:"HIGH",   principle:"privacy",         description:"Mass biometric collection without consent" },
    { id:"RF006", name:"Manipulative Targeting",   risk:"HIGH",   principle:"fairness",        description:"Exploiting psychological vulnerabilities" },
    { id:"RF007", name:"Opaque Decision",          risk:"MEDIUM", principle:"transparency",    description:"Consequential decision with no explanation" },
    { id:"RF008", name:"Minor Data Processing",    risk:"HIGH",   principle:"consent",         description:"Processing children's data without parental consent" }
];

function assessAISystem({ userId, systemName, description, useCases = [], dataInputs = [], outputTypes = [], hasHumanOversight, isExplainable, processesPersonalData, affectsHighStakesDomains = [] }) {
    if (!userId || !systemName) return fail(AGENT, "userId and systemName required");

    const flags      = [];
    const principles = {};

    Object.keys(ETHICAL_PRINCIPLES).forEach(p => { principles[p] = { score:100, findings:[] }; });

    // Human oversight check
    if (!hasHumanOversight && affectsHighStakesDomains.length) {
        flags.push(RED_FLAGS[0].id);
        principles.accountability.score -= 40;
        principles.accountability.findings.push("High-stakes domain without human oversight");
    }

    // Healthcare
    if (affectsHighStakesDomains.includes("healthcare") && !hasHumanOversight) {
        flags.push(RED_FLAGS[1].id);
        principles.safety.score -= 50;
        principles.safety.findings.push("Healthcare AI without physician oversight gate");
    }

    // Legal
    if (affectsHighStakesDomains.includes("legal") && !hasHumanOversight) {
        flags.push(RED_FLAGS[2].id);
        principles.accountability.score -= 50;
        principles.accountability.findings.push("Legal decision-making without qualified human review");
    }

    // Financial autonomy
    if (affectsHighStakesDomains.includes("finance") && !hasHumanOversight) {
        flags.push(RED_FLAGS[3].id);
        principles.accountability.score -= 30;
        principles.accountability.findings.push("Autonomous financial execution without oversight");
    }

    // Explainability
    if (!isExplainable) {
        principles.transparency.score -= 40;
        principles.transparency.findings.push("System cannot explain its decisions");
    }

    // Personal data
    if (processesPersonalData && !dataInputs.includes("consent_verified")) {
        principles.privacy.score -= 30;
        principles.privacy.findings.push("Personal data processed without verified consent mechanism");
    }

    const overallScore = Math.round(Object.values(principles).reduce((s,p) => s + p.score, 0) / Object.keys(principles).length);
    const ethicsBand   = overallScore >= 80 ? "ETHICAL" : overallScore >= 60 ? "REVIEW_NEEDED" : overallScore >= 40 ? "HIGH_RISK" : "UNACCEPTABLE";

    const assessmentId = uid("eth");
    const history      = load(userId, "ethics_assessments", []);
    history.push({ id:assessmentId, systemName, ethicsBand, overallScore, flags, assessedAt:NOW() });
    flush(userId, "ethics_assessments", history.slice(-1000));

    govAudit(AGENT, userId, "ai_ethics_assessed", { assessmentId, systemName, ethicsBand, overallScore }, ethicsBand === "UNACCEPTABLE" || ethicsBand === "HIGH_RISK" ? "HIGH" : "INFO");

    if (ethicsBand === "UNACCEPTABLE") {
        return blocked(AGENT, `AI system "${systemName}" fails ethical assessment (score: ${overallScore}/100). Deployment blocked. Critical flags: ${flags.join(", ")}`, "CRITICAL");
    }

    return ok(AGENT, {
        assessmentId, systemName, overallScore, ethicsBand,
        redFlags:   flags.map(f => RED_FLAGS.find(r => r.id === f)).filter(Boolean),
        principles: Object.entries(principles).map(([key,val]) => ({ key, name:ETHICAL_PRINCIPLES[key].name, score:val.score, findings:val.findings })),
        recommendation: ethicsBand === "ETHICAL" ? "System meets ethical guidelines — approved for deployment with ongoing monitoring" : ethicsBand === "REVIEW_NEEDED" ? "Review findings before deployment — address highlighted concerns" : "Significant ethical concerns — do not deploy without remediation",
        disclaimer: GOV_DISCLAIMER
    });
}

function logAIDecision({ userId, systemName, decision, explanation, affectedUserId, confidence, humanReviewed = false }) {
    if (!userId || !systemName || !decision) return fail(AGENT, "userId, systemName, and decision required");

    const log = load(userId, "ai_decision_log", []);
    const entry = {
        id:             uid("dec"),
        systemName, decision,
        explanation:    explanation || null,
        affectedUserId: affectedUserId || null,
        confidence:     confidence || null,
        humanReviewed,
        loggedAt:       NOW()
    };

    if (!humanReviewed && !explanation) {
        log.push(entry);
        flush(userId, "ai_decision_log", log.slice(-10000));
        govAudit(AGENT, userId, "unreviewed_opaque_decision", { decisionId: entry.id, systemName }, "HIGH");
        return ok(AGENT, { ...entry, warning: "⚠️ Decision logged without human review or explanation — potential transparency risk", disclaimer: GOV_DISCLAIMER });
    }

    log.push(entry);
    flush(userId, "ai_decision_log", log.slice(-10000));
    govAudit(AGENT, userId, "ai_decision_logged", { decisionId: entry.id, systemName, humanReviewed }, "INFO");

    return ok(AGENT, { decisionId: entry.id, systemName, humanReviewed, loggedAt: entry.loggedAt });
}

function getEthicsAssessments({ userId, limit = 20 }) {
    if (!userId) return fail(AGENT, "userId required");
    const history = load(userId, "ethics_assessments", []).slice(-limit).reverse();
    return ok(AGENT, { total: history.length, assessments: history, disclaimer: GOV_DISCLAIMER });
}

function getPrinciples() {
    return ok(AGENT, {
        principles: Object.entries(ETHICAL_PRINCIPLES).map(([k, v]) => ({ key:k, ...v })),
        redFlags:   RED_FLAGS,
        framework:  "Aligned with EU AI Act, IEEE Ethically Aligned Design, and NITI Aayog Responsible AI principles",
        disclaimer: GOV_DISCLAIMER
    });
}

module.exports = { assessAISystem, logAIDecision, getEthicsAssessments, getPrinciples };
