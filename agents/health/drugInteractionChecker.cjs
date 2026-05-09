"use strict";
/**
 * Drug Interaction Checker — detects possible interactions between medications.
 * Informational only. Final decisions must be made by a pharmacist or doctor.
 */
const { ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "drugInteractionChecker";

// Severity levels
const SEV = { HIGH: "HIGH", MODERATE: "MODERATE", LOW: "LOW" };

// Known interactions [drug_a, drug_b, severity, description, recommendation]
const INTERACTIONS = [
    ["warfarin","aspirin",          SEV.HIGH,     "Significantly increased bleeding risk", "Avoid combination unless explicitly directed by cardiologist/hematologist"],
    ["warfarin","ibuprofen",        SEV.HIGH,     "Increased bleeding risk; ibuprofen displaces warfarin from proteins", "Avoid NSAIDs with warfarin; use paracetamol for pain with doctor guidance"],
    ["warfarin","naproxen",         SEV.HIGH,     "Increased anticoagulant effect and bleeding risk", "Consult doctor; INR monitoring required if combination is used"],
    ["ssri","tramadol",             SEV.HIGH,     "Risk of serotonin syndrome (agitation, rapid heart rate, high temperature)", "Consult prescribing doctor immediately"],
    ["maoi","ssri",                 SEV.HIGH,     "Life-threatening serotonin syndrome risk", "Never combine. 14-day washout period required between MAOIs and SSRIs"],
    ["maoi","tramadol",             SEV.HIGH,     "Life-threatening serotonin syndrome", "Absolutely contraindicated"],
    ["lithium","ibuprofen",         SEV.HIGH,     "NSAIDs raise lithium levels to toxic range", "Use paracetamol instead; monitor lithium levels closely"],
    ["methotrexate","aspirin",      SEV.HIGH,     "Aspirin reduces methotrexate excretion — toxicity risk", "Avoid combination; consult oncologist/rheumatologist"],
    ["clopidogrel","omeprazole",    SEV.MODERATE, "Omeprazole may reduce clopidogrel effectiveness by 40%", "Discuss alternative PPI (e.g. pantoprazole) with cardiologist"],
    ["atorvastatin","clarithromycin",SEV.MODERATE,"Clarithromycin increases statin blood levels — myopathy risk", "Temporarily halt statin during antibiotic course; consult doctor"],
    ["metformin","alcohol",         SEV.MODERATE, "Increased lactic acidosis risk", "Limit alcohol to minimum; avoid binge drinking"],
    ["amlodipine","simvastatin",    SEV.MODERATE, "Amlodipine raises simvastatin levels — muscle pain risk", "Limit simvastatin to 20mg/day when combined; consider alternative statin"],
    ["digoxin","amiodarone",        SEV.HIGH,     "Amiodarone significantly raises digoxin levels — toxicity risk", "Reduce digoxin dose; close monitoring required"],
    ["sildenafil","nitrates",       SEV.HIGH,     "Life-threatening blood pressure drop", "Absolutely contraindicated. Do not combine."],
    ["tramadol","benzodiazepine",   SEV.HIGH,     "Respiratory depression risk", "Use with extreme caution; avoid if possible"],
    ["levothyroxine","calcium",     SEV.LOW,      "Calcium reduces levothyroxine absorption", "Take levothyroxine 4 hours apart from calcium supplements"],
    ["levothyroxine","iron",        SEV.LOW,      "Iron reduces levothyroxine absorption", "Take levothyroxine 2-4 hours apart from iron supplements"],
    ["ciprofloxacin","antacids",    SEV.MODERATE, "Antacids reduce ciprofloxacin absorption significantly", "Take ciprofloxacin 2 hours before or 6 hours after antacids"],
    ["metronidazole","alcohol",     SEV.HIGH,     "Disulfiram-like reaction: vomiting, flushing, rapid heartbeat", "Absolutely avoid alcohol during metronidazole course and 48h after"],
    ["doxycycline","dairy",         SEV.LOW,      "Dairy products reduce doxycycline absorption", "Take doxycycline 1 hour before or 2 hours after dairy"],
    ["paracetamol","alcohol",       SEV.MODERATE, "Heavy alcohol use with paracetamol causes liver damage", "Avoid paracetamol if consuming alcohol regularly or heavily"]
];

function _normalise(name) {
    return String(name).toLowerCase()
        .replace(/\s+/g, "")
        .replace(/-/g, "")
        .replace(/\(.*?\)/g, "");
}

function checkInteractions({ userId, medications = [] }) {
    if (!userId)              return fail(AGENT, "userId required");
    if (medications.length < 2) return fail(AGENT, "At least 2 medications required to check interactions");

    accessLog(userId, AGENT, "interaction_check", { count: medications.length });

    const norms       = medications.map(m => _normalise(m));
    const found       = [];
    const highRisk    = [];

    for (const [a, b, severity, desc, rec] of INTERACTIONS) {
        const matchA = norms.some(n => n.includes(_normalise(a)) || _normalise(a).includes(n));
        const matchB = norms.some(n => n.includes(_normalise(b)) || _normalise(b).includes(n));
        if (matchA && matchB) {
            const interaction = { drugs: [a, b], severity, description: desc, recommendation: rec };
            found.push(interaction);
            if (severity === SEV.HIGH) highRisk.push(interaction);
        }
    }

    const result = {
        medications,
        interactions:      found,
        totalFound:        found.length,
        highRiskCount:     highRisk.length,
        safetyStatus:      found.length === 0 ? "No known interactions detected in our database" : `${found.length} potential interaction(s) found`,
        important:         "This database is not exhaustive. Always consult a pharmacist or doctor before combining medications.",
        action:            highRisk.length
            ? "⚠️ HIGH-RISK interactions detected. Consult your doctor or pharmacist BEFORE taking these medications together."
            : found.length
            ? "Moderate interactions found. Review with your pharmacist."
            : "No major interactions detected — still verify with your pharmacist."
    };

    return ok(AGENT, result, { riskLevel: highRisk.length ? "HIGH" : found.length ? "MEDIUM" : "LOW" });
}

module.exports = { checkInteractions };
