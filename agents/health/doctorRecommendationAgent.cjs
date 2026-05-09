"use strict";
const { ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "doctorRecommendationAgent";

// System/symptom → specialist type mapping
const SPECIALIST_MAP = {
    cardiac:          { specialist: "Cardiologist", desc: "Heart and cardiovascular system specialist" },
    neurological:     { specialist: "Neurologist", desc: "Brain, spinal cord, and nervous system specialist" },
    respiratory:      { specialist: "Pulmonologist", desc: "Lung and respiratory system specialist" },
    gastrointestinal: { specialist: "Gastroenterologist", desc: "Digestive system specialist" },
    musculoskeletal:  { specialist: "Orthopedic Surgeon / Rheumatologist", desc: "Bones, joints, and muscle specialist" },
    dermatological:   { specialist: "Dermatologist", desc: "Skin, hair, and nail specialist" },
    urological:       { specialist: "Urologist", desc: "Urinary tract and kidney specialist" },
    gynecological:    { specialist: "Gynecologist / Obstetrician", desc: "Women's reproductive health specialist" },
    mental:           { specialist: "Psychiatrist / Clinical Psychologist", desc: "Mental health and behavioral specialist" },
    endocrine:        { specialist: "Endocrinologist", desc: "Hormones and metabolism specialist" },
    ophthalmological: { specialist: "Ophthalmologist", desc: "Eye and vision specialist" },
    oncological:      { specialist: "Oncologist", desc: "Cancer diagnosis and treatment specialist" },
    pediatric:        { specialist: "Pediatrician", desc: "Children's health specialist (up to 18 years)" },
    geriatric:        { specialist: "Geriatrician", desc: "Elderly care specialist (65+ years)" },
    immunological:    { specialist: "Allergist / Immunologist", desc: "Allergies and immune system specialist" },
    dental:           { specialist: "Dentist / Oral Surgeon", desc: "Teeth and oral health specialist" },
    ear_nose_throat:  { specialist: "ENT (Otolaryngologist)", desc: "Ear, nose, and throat specialist" }
};

// Keyword → specialty mapping for free-text matching
const KEYWORD_SPECIALTY = {
    "heart":      "cardiac",     "chest":      "cardiac",   "cardiac":    "cardiac",
    "headache":   "neurological","seizure":    "neurological","brain":    "neurological",
    "breathing":  "respiratory", "lung":       "respiratory","asthma":   "respiratory",
    "stomach":    "gastrointestinal","gut":    "gastrointestinal","bowel": "gastrointestinal",
    "bone":       "musculoskeletal","joint":  "musculoskeletal","back":   "musculoskeletal",
    "skin":       "dermatological","rash":    "dermatological",
    "urine":      "urological",  "kidney":     "urological",
    "period":     "gynecological","pregnancy": "gynecological",
    "anxiety":    "mental",       "depression": "mental",   "mental":    "mental",
    "diabetes":   "endocrine",    "thyroid":    "endocrine","hormone":   "endocrine",
    "eye":        "ophthalmological","vision": "ophthalmological",
    "cancer":     "oncological",  "tumor":      "oncological",
    "child":      "pediatric",    "infant":     "pediatric",
    "elderly":    "geriatric",    "senior":     "geriatric",
    "allergy":    "immunological","allergic":   "immunological",
    "tooth":      "dental",       "teeth":      "dental",    "gum":       "dental",
    "ear":        "ear_nose_throat","nose":     "ear_nose_throat","throat": "ear_nose_throat"
};

function recommendDoctor({ userId, symptoms = [], detectedSystems = [], age, query }) {
    if (!userId) return fail(AGENT, "userId required");

    accessLog(userId, AGENT, "recommendation_requested");

    const specialists = new Set();

    // From detected systems
    for (const s of detectedSystems) {
        if (SPECIALIST_MAP[s]) specialists.add(s);
    }

    // From symptoms / query free text
    const text = [...symptoms, query || ""].join(" ").toLowerCase();
    for (const [kw, system] of Object.entries(KEYWORD_SPECIALTY)) {
        if (text.includes(kw)) specialists.add(system);
    }

    // Age-based default additions
    if (age !== undefined) {
        if (age <= 18) specialists.add("pediatric");
        if (age >= 65) specialists.add("geriatric");
    }

    // Always include General Practitioner as first step
    const recommendations = [{
        specialist:   "General Practitioner (GP) / Family Doctor",
        desc:         "Your first point of contact — can assess and refer to specialists",
        priority:     "First"
    }];

    for (const sys of specialists) {
        const s = SPECIALIST_MAP[sys];
        if (s) recommendations.push({ specialist: s.specialist, desc: s.desc, priority: "Referred" });
    }

    return ok(AGENT, {
        recommendations,
        tip: "Always start with a General Practitioner. They will refer you to the right specialist based on your examination.",
        onlinePlatforms: ["Practo", "Apollo 247", "mFine", "1mg", "Tata 1mg", "Bajaj Health"]
    });
}

module.exports = { recommendDoctor };
