"use strict";
/**
 * Diagnosis Support Agent — provides POSSIBLE causes for symptoms.
 * NEVER provides a diagnosis. Always recommends professional consultation.
 * Output is purely educational and informational.
 */
const { ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "diagnosisSupportAgent";

// Symptom → possible causes mapping (educational only, NOT diagnostic)
const POSSIBLE_CAUSES_MAP = {
    "chest pain":           ["musculoskeletal strain", "acid reflux (GERD)", "anxiety/stress", "possible cardiac issue — see doctor urgently"],
    "headache":             ["tension headache", "dehydration", "migraine", "sinusitis", "eye strain"],
    "fever":                ["viral infection", "bacterial infection", "inflammatory response", "heat exhaustion"],
    "fatigue":              ["iron deficiency anaemia", "poor sleep", "thyroid dysfunction", "viral infection", "depression"],
    "nausea":               ["gastroenteritis", "food poisoning", "acid reflux", "motion sickness", "medication side effect"],
    "back pain":            ["muscle strain", "poor posture", "herniated disc", "kidney-related issue"],
    "cough":                ["upper respiratory infection", "allergies", "asthma", "GERD", "environmental irritants"],
    "shortness of breath":  ["asthma", "anxiety/panic", "anaemia", "respiratory infection", "possible cardiac — see doctor"],
    "joint pain":           ["osteoarthritis", "rheumatoid arthritis", "gout", "injury", "viral illness"],
    "skin rash":            ["contact dermatitis", "eczema", "allergic reaction", "viral exanthem", "heat rash"],
    "dizziness":            ["low blood pressure", "dehydration", "inner ear issue", "anaemia", "medication side effect"],
    "stomach pain":         ["gastritis", "irritable bowel syndrome", "gas/bloating", "food intolerance", "appendicitis — if severe right-sided, see doctor urgently"],
    "diarrhea":             ["gastroenteritis", "food poisoning", "IBS", "infection", "medication side effect"],
    "sore throat":          ["viral pharyngitis", "streptococcal infection", "allergies", "acid reflux"],
    "frequent urination":   ["urinary tract infection", "diabetes mellitus", "overactive bladder", "prostate issues"],
    "blurred vision":       ["refractive error", "migraines", "high blood pressure", "diabetic retinopathy", "see eye doctor"],
    "weight loss":          ["thyroid hyperactivity", "diabetes", "malabsorption", "stress — consult doctor if unexplained"],
    "chest tightness":      ["anxiety", "asthma", "possible cardiac — see doctor urgently"],
    "insomnia":             ["stress/anxiety", "poor sleep hygiene", "caffeine excess", "depression", "sleep apnoea"],
    "swollen lymph nodes":  ["infection", "allergic reaction", "inflammatory condition", "see doctor if persistent"],
    "palpitations":         ["anxiety/stress", "caffeine/stimulants", "anaemia", "thyroid dysfunction", "possible arrhythmia — see doctor"],
    "numbness":             ["nerve compression", "poor circulation", "vitamin B12 deficiency", "diabetes neuropathy"],
    "high blood pressure":  ["lifestyle factors", "stress", "essential hypertension", "kidney-related", "see doctor for management"]
};

function getPossibleCauses({ userId, symptoms = [], checkId }) {
    if (!userId)          return fail(AGENT, "userId required");
    if (!symptoms.length) return fail(AGENT, "symptoms array required");

    accessLog(userId, AGENT, "possible_causes_viewed", { count: symptoms.length });

    const results = [];
    for (const symptom of symptoms) {
        const key     = symptom.toLowerCase().trim();
        const causes  = POSSIBLE_CAUSES_MAP[key] || null;
        const partial = causes === null
            ? Object.entries(POSSIBLE_CAUSES_MAP)
                .filter(([k]) => k.includes(key) || key.includes(k))
                .flatMap(([, v]) => v)
            : causes;

        results.push({
            symptom,
            possibleCauses: partial.length ? partial : ["No specific match found — please consult a doctor for evaluation"],
            note: "These are POSSIBLE causes for educational purposes only. This is NOT a diagnosis."
        });
    }

    return ok(AGENT, {
        checkId,
        symptomAnalysis: results,
        important: "These possible causes are for EDUCATIONAL purposes only. Only a qualified doctor can diagnose you.",
        recommendation: "Please consult a healthcare professional for proper evaluation and diagnosis."
    });
}

module.exports = { getPossibleCauses };
