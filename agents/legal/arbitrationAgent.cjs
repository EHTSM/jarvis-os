"use strict";
const { load, flush, uid, NOW, auditLog, ok, fail } = require("./_legalStore.cjs");
const AGENT = "arbitrationAgent";

const ARBITRATION_INSTITUTIONS = {
    india: [
        { name:"Mumbai Centre for International Arbitration (MCIA)", url:"mcia.world", strength:"Commercial, financial disputes" },
        { name:"Indian Council of Arbitration (ICA)",                url:"icaindia.org", strength:"Domestic commercial" },
        { name:"Delhi International Arbitration Centre (DIAC)",      url:"diac.in", strength:"Domestic and international" },
        { name:"NITI Aayog Arbitration",                             url:"arbitration.niti.gov.in", strength:"Government contracts" }
    ],
    international: [
        { name:"ICC International Court of Arbitration",   url:"iccwbo.org/dispute-resolution/arbitration", strength:"Large international disputes" },
        { name:"London Court of International Arbitration (LCIA)", url:"lcia.org", strength:"UK/English law disputes" },
        { name:"Singapore International Arbitration Centre (SIAC)", url:"siac.org.sg", strength:"Asia-Pacific" },
        { name:"American Arbitration Association (AAA)",  url:"adr.org", strength:"US commercial" }
    ]
};

const ARBITRATION_STAGES = [
    { stage:1, name:"Initiation",      description:"Claimant files Notice of Arbitration per the arbitration clause" },
    { stage:2, name:"Tribunal Formation", description:"Arbitrator(s) appointed — sole arbitrator or three-member panel" },
    { stage:3, name:"Preliminary Hearing", description:"Procedure, timeline, seat, language agreed" },
    { stage:4, name:"Pleadings",       description:"Statement of Claim and Statement of Defence filed" },
    { stage:5, name:"Disclosure",      description:"Document exchange — less formal than court discovery" },
    { stage:6, name:"Hearing",         description:"Evidence, witnesses, and oral arguments presented" },
    { stage:7, name:"Award",           description:"Tribunal issues final, binding award — typically within 12 months" },
    { stage:8, name:"Enforcement",     description:"Award enforced in any New York Convention signatory country (170+ countries)" }
];

function initiateArbitration({ userId, caseTitle, claimantName, respondentName, contractRef, claimAmount, jurisdiction = "India", preferredInstitution }) {
    if (!userId || !caseTitle) return fail(AGENT, "userId and caseTitle required");
    auditLog(AGENT, userId, "arbitration_initiated", { caseTitle, claimAmount, jurisdiction });

    const institution = preferredInstitution || (jurisdiction === "India" ? "MCIA" : "ICC");
    const institutions = [...ARBITRATION_INSTITUTIONS.india, ...ARBITRATION_INSTITUTIONS.international];

    const record = {
        id:              uid("arb"),
        userId,
        caseTitle,
        claimantName,
        respondentName,
        contractRef,
        claimAmount,
        jurisdiction,
        preferredInstitution:institution,
        stages:          ARBITRATION_STAGES,
        currentStage:    1,
        estimatedTimeline:"6-18 months depending on complexity",
        requiredDocuments:["Copy of the arbitration clause","Notice of Arbitration","Statement of Claim","Evidence bundle","Contract / Agreement"],
        arbitrationAct:  jurisdiction === "India" ? "Arbitration and Conciliation Act 1996 (as amended 2021)" : "As per agreed institutional rules",
        enforcement:     "New York Convention on the Recognition and Enforcement of Foreign Arbitral Awards (1958)",
        status:          "initiated",
        createdAt:       NOW()
    };

    const records = load(userId, "arbitrations", []);
    records.push(record);
    flush(userId, "arbitrations", records.slice(-50));

    return ok(AGENT, { record, availableInstitutions: institutions.filter(i => i.name.includes(institution) || jurisdiction === "Global") });
}

function getArbitrationStatus({ userId, caseId }) {
    if (!userId || !caseId) return fail(AGENT, "userId and caseId required");
    const records = load(userId, "arbitrations", []);
    const rec     = records.find(r => r.id === caseId);
    if (!rec)     return fail(AGENT, "Arbitration case not found");
    return ok(AGENT, rec);
}

function getInstitutions({ jurisdiction }) {
    const all = { ...ARBITRATION_INSTITUTIONS };
    if (jurisdiction?.toLowerCase() === "india") return ok(AGENT, { institutions: ARBITRATION_INSTITUTIONS.india });
    return ok(AGENT, { institutions: all });
}

module.exports = { initiateArbitration, getArbitrationStatus, getInstitutions };
