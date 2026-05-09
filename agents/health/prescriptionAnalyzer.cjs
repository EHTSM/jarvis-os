"use strict";
/**
 * Prescription Analyzer — explains prescriptions in plain language.
 * NEVER modifies dosage. NEVER recommends stopping/changing medication.
 * Explanation only — always consult prescribing doctor.
 */
const { ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "prescriptionAnalyzer";

// Common drug information database (educational; NOT exhaustive)
const DRUG_INFO = {
    "paracetamol":    { also: "Acetaminophen / Crocin / Dolo", use: "Pain relief and fever reduction", common_se: "Rare at recommended doses. Liver stress at high doses.", notes: "Do not exceed 4g/day. Avoid with alcohol." },
    "ibuprofen":      { also: "Brufen / Advil", use: "Pain, inflammation, fever", common_se: "Stomach irritation, take with food", notes: "Avoid on empty stomach. Not for kidney disease without advice." },
    "amoxicillin":    { also: "Mox / Amoxil", use: "Bacterial infections (antibiotic)", common_se: "Nausea, diarrhea, rash", notes: "Complete the full course even if feeling better." },
    "metformin":      { also: "Glyciphage / Glucophage", use: "Type 2 diabetes — reduces blood sugar", common_se: "Nausea, stomach upset initially", notes: "Take with meals. Do not crush tablets." },
    "atorvastatin":   { also: "Atorva / Lipitor", use: "Lowers cholesterol", common_se: "Muscle aches (report to doctor)", notes: "Usually taken at night. Avoid grapefruit juice." },
    "amlodipine":     { also: "Amlong / Norvasc", use: "High blood pressure, angina", common_se: "Ankle swelling, flushing", notes: "Do not stop suddenly without doctor advice." },
    "omeprazole":     { also: "Omez / Prilosec", use: "Acid reflux, stomach ulcers", common_se: "Headache, nausea (usually mild)", notes: "Best taken 30 minutes before meals." },
    "azithromycin":   { also: "Azee / Zithromax", use: "Bacterial infections (antibiotic)", common_se: "Stomach upset, diarrhea", notes: "Complete full course. Take 1 hour before or 2 hours after meals." },
    "cetirizine":     { also: "Cetrizet / Zyrtec", use: "Allergies, hay fever, hives", common_se: "Drowsiness (less than older antihistamines)", notes: "Can cause mild drowsiness; avoid driving if affected." },
    "pantoprazole":   { also: "Pan / Pantocid", use: "Acid reflux, stomach ulcer protection", common_se: "Headache, diarrhea", notes: "Take before meals. Long-term use — consult doctor." },
    "aspirin":        { also: "Ecosprin / Disprin", use: "Pain, fever, blood-thinning (low dose)", common_se: "Stomach irritation, bleeding risk", notes: "Low-dose used for heart protection. Do not give to children under 16 for viral illness." },
    "montelukast":    { also: "Montair / Singulair", use: "Asthma and allergic rhinitis prevention", common_se: "Headache, mood changes (monitor)", notes: "Usually taken at night." },
    "levothyroxine":  { also: "Thyronorm / Eltroxin", use: "Hypothyroidism (underactive thyroid)", common_se: "If overdosed: rapid heartbeat, weight loss", notes: "Take on empty stomach, 30 min before food. Specific timing is critical." },
    "salbutamol":     { also: "Asthalin / Ventolin", use: "Asthma reliever (bronchodilator)", common_se: "Tremor, fast heartbeat", notes: "Rescue inhaler — use only when needed. Shake before use." },
    "diclofenac":     { also: "Voveran / Voltaren", use: "Pain and inflammation", common_se: "Stomach upset, take with food", notes: "Short-term use preferred. Avoid in kidney/heart disease." }
};

function _frequencyToText(frequency) {
    const map = {
        "od":"Once daily","bd":"Twice daily","tds":"Three times daily","qid":"Four times daily",
        "hs":"At bedtime","ac":"Before meals","pc":"After meals","sos":"When required",
        "stat":"Immediately (single dose)"
    };
    return map[frequency?.toLowerCase()] || frequency || "As prescribed";
}

function analyzePrescription({ userId, medications = [], rawText }) {
    if (!userId)                                   return fail(AGENT, "userId required");
    if (!medications.length && !rawText)           return fail(AGENT, "medications array or rawText required");

    accessLog(userId, AGENT, "prescription_analyzed");

    // Parse rawText into medication entries if medications array not provided
    const medList = medications.length ? medications : (rawText || "").split(/\n|,/).map(l => ({ name: l.trim() })).filter(m => m.name);

    const explanations = medList.map(med => {
        const nameLower = (med.name || "").toLowerCase().trim();
        const match     = Object.entries(DRUG_INFO).find(([key]) =>
            nameLower.includes(key) || key.includes(nameLower)
        );
        const info = match ? match[1] : null;

        return {
            name:          med.name,
            dosage:        med.dosage     || "As prescribed by doctor",
            frequency:     _frequencyToText(med.frequency),
            duration:      med.duration   || "As prescribed",
            knownAs:       info?.also     || "Check with pharmacist",
            purpose:       info?.use      || "Consult your doctor or pharmacist for purpose",
            sideEffects:   info?.common_se || "Consult your doctor or pharmacist for side effects",
            importantNote: info?.notes    || "Follow doctor's instructions exactly",
            found:         !!info
        };
    });

    return ok(AGENT, {
        medications: explanations,
        generalAdvice: [
            "Never alter dosage without consulting your prescribing doctor",
            "Complete the full course of antibiotics even if you feel better",
            "Report any unusual side effects to your doctor immediately",
            "Keep all medications out of reach of children",
            "Store medications as per label instructions (some need refrigeration)"
        ],
        note: "This is a plain-language explanation only. Do NOT change your prescription based on this information."
    });
}

module.exports = { analyzePrescription };
