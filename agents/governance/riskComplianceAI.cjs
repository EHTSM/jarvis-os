"use strict";
const { load, flush, uid, NOW, govAudit, scoreRisk, ok, fail, blocked, GOV_DISCLAIMER } = require("./_governanceStore.cjs");
const AGENT = "riskComplianceAI";

const RISK_CATEGORIES = {
    operational:  { name:"Operational Risk",   examples:["process failure","system downtime","human error"] },
    financial:    { name:"Financial Risk",      examples:["liquidity","credit","market volatility"] },
    legal:        { name:"Legal/Regulatory",    examples:["non-compliance","litigation","regulatory change"] },
    reputational: { name:"Reputational Risk",   examples:["data breach","PR crisis","ethics violation"] },
    cyber:        { name:"Cyber Risk",          examples:["ransomware","phishing","insider threat"] },
    strategic:    { name:"Strategic Risk",      examples:["competitor action","market shift","M&A"] },
    esg:          { name:"ESG Risk",            examples:["climate","social responsibility","governance"] }
};

const LIKELIHOOD_SCALE  = { rare:1, unlikely:2, possible:3, likely:4, almost_certain:5 };
const IMPACT_SCALE      = { negligible:1, minor:2, moderate:3, major:4, catastrophic:5 };
const RISK_MATRIX_BAND  = (l, i) => {
    const score = l * i;
    if (score >= 15) return "CRITICAL";
    if (score >= 9)  return "HIGH";
    if (score >= 4)  return "MEDIUM";
    return "LOW";
};

function registerRisk({ userId, organizationId, title, description, category, likelihood, impact, owner, mitigationPlan, dueDate }) {
    if (!userId || !title || !category || !likelihood || !impact) {
        return fail(AGENT, "userId, title, category, likelihood, and impact required");
    }
    if (!RISK_CATEGORIES[category]) return fail(AGENT, `Unknown category. Valid: ${Object.keys(RISK_CATEGORIES).join(", ")}`);
    if (!LIKELIHOOD_SCALE[likelihood]) return fail(AGENT, `likelihood must be: ${Object.keys(LIKELIHOOD_SCALE).join(", ")}`);
    if (!IMPACT_SCALE[impact]) return fail(AGENT, `impact must be: ${Object.keys(IMPACT_SCALE).join(", ")}`);

    const l       = LIKELIHOOD_SCALE[likelihood];
    const i       = IMPACT_SCALE[impact];
    const band    = RISK_MATRIX_BAND(l, i);
    const orgKey  = organizationId || userId;
    const risks   = load(userId, `risk_register_${orgKey}`, []);

    const risk = {
        id: uid("rsk"), title, description: description || null, category,
        likelihood, likelihoodScore: l,
        impact, impactScore: i,
        riskScore: l * i, band,
        owner: owner || userId, mitigationPlan: mitigationPlan || null,
        dueDate: dueDate || null,
        status: "OPEN", createdAt: NOW(), updatedAt: NOW()
    };

    risks.push(risk);
    flush(userId, `risk_register_${orgKey}`, risks);

    govAudit(AGENT, userId, "risk_registered", { riskId: risk.id, title, band }, band === "CRITICAL" || band === "HIGH" ? "HIGH" : "INFO");

    if (band === "CRITICAL") {
        return blocked(AGENT, `Critical risk registered and requires IMMEDIATE attention: "${title}" (score: ${risk.riskScore}/25). Assign owner and mitigation plan now.`, "CRITICAL");
    }

    return ok(AGENT, { ...risk, disclaimer: GOV_DISCLAIMER });
}

function updateRiskStatus({ userId, organizationId, riskId, status, mitigationUpdate, notes }) {
    if (!userId || !riskId || !status) return fail(AGENT, "userId, riskId, and status required");

    const validStatuses = ["OPEN","IN_PROGRESS","MITIGATED","ACCEPTED","CLOSED","ESCALATED"];
    if (!validStatuses.includes(status)) return fail(AGENT, `status must be: ${validStatuses.join(", ")}`);

    const orgKey = organizationId || userId;
    const risks  = load(userId, `risk_register_${orgKey}`, []);
    const risk   = risks.find(r => r.id === riskId);
    if (!risk) return fail(AGENT, `Risk ${riskId} not found`);

    risk.status          = status;
    risk.updatedAt       = NOW();
    if (mitigationUpdate) risk.mitigationPlan = mitigationUpdate;
    if (notes) risk.notes = notes;

    flush(userId, `risk_register_${orgKey}`, risks);
    govAudit(AGENT, userId, "risk_status_updated", { riskId, status }, "INFO");

    return ok(AGENT, { riskId, title: risk.title, status, updatedAt: risk.updatedAt });
}

function getRiskRegister({ userId, organizationId, band, category, status }) {
    if (!userId) return fail(AGENT, "userId required");

    const orgKey = organizationId || userId;
    let   risks  = load(userId, `risk_register_${orgKey}`, []);

    if (band)     risks = risks.filter(r => r.band === band);
    if (category) risks = risks.filter(r => r.category === category);
    if (status)   risks = risks.filter(r => r.status === status);

    const summary = { CRITICAL:0, HIGH:0, MEDIUM:0, LOW:0 };
    risks.forEach(r => { summary[r.band] = (summary[r.band] || 0) + 1; });

    govAudit(AGENT, userId, "risk_register_viewed", { orgKey, count: risks.length }, "INFO");
    return ok(AGENT, { total: risks.length, summary, risks: risks.sort((a,b) => b.riskScore - a.riskScore), disclaimer: GOV_DISCLAIMER });
}

function runComplianceCheck({ userId, organizationId, checkItems = [] }) {
    if (!userId || !checkItems.length) return fail(AGENT, "userId and checkItems[] required");

    const results = checkItems.map(item => {
        const { id: itemId, description, compliant, evidence } = item;
        return {
            itemId:      itemId || uid("ci"),
            description,
            compliant:   !!compliant,
            evidence:    evidence || null,
            checkedAt:   NOW()
        };
    });

    const passed   = results.filter(r => r.compliant).length;
    const failed   = results.length - passed;
    const score    = Math.round(passed / results.length * 100);
    const band     = score >= 90 ? "COMPLIANT" : score >= 70 ? "PARTIAL" : "NON_COMPLIANT";

    const checkId  = uid("chk");
    const orgKey   = organizationId || userId;
    const history  = load(userId, `compliance_checks_${orgKey}`, []);
    history.push({ id: checkId, score, band, passed, failed, total: results.length, checkedAt: NOW(), results });
    flush(userId, `compliance_checks_${orgKey}`, history.slice(-500));

    govAudit(AGENT, userId, "compliance_check_run", { checkId, score, band, failed }, band === "NON_COMPLIANT" ? "HIGH" : "INFO");

    return ok(AGENT, { checkId, score, band, passed, failed, total: results.length, results, disclaimer: GOV_DISCLAIMER });
}

module.exports = { registerRisk, updateRiskStatus, getRiskRegister, runComplianceCheck };
