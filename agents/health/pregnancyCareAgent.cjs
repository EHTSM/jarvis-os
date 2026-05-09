"use strict";
/**
 * Pregnancy Care Agent — tracks milestones, provides safe tips.
 * NEVER provides medical advice. All guidance is general education only.
 * High-risk symptoms → always escalate immediately.
 */
const { load, flush, uid, NOW, ok, fail, escalate, accessLog } = require("./_healthStore.cjs");

const AGENT = "pregnancyCareAgent";

// High-risk pregnancy symptoms — immediate escalation
const HIGH_RISK = [
    "heavy bleeding","severe abdominal pain","severe headache during pregnancy",
    "vision changes","swollen face hands","reduced fetal movement after 28 weeks",
    "fever above 38","premature contractions","water breaking early","chest pain pregnancy"
];

const TRIMESTER_INFO = {
    1: {
        weeks:       "1-12",
        development: "Heart forms and starts beating (week 6). Baby grows from embryo to fetus. All major organs begin developing.",
        symptoms:    ["Morning sickness","Fatigue","Breast tenderness","Frequent urination","Food aversions"],
        dos:         ["Start folic acid (5mg/day) immediately","Schedule first antenatal appointment","Avoid alcohol, smoking, unpasteurised foods","Take prenatal vitamins","Stay hydrated"],
        donts:       ["Avoid raw/undercooked meat and fish","No alcohol","No smoking","Avoid high-dose vitamin A","No contact sports"],
        screenings:  ["First trimester ultrasound (11-14 weeks)","Blood tests: CBC, blood group, rubella, HIV","NT scan (nuchal translucency)"]
    },
    2: {
        weeks:       "13-26",
        development: "Baby can hear and move. Gender visible from 18-20 weeks. Hair, eyebrows form. Kicks begin (16-22 weeks).",
        symptoms:    ["Energy returns","Growing belly","Backache","Round ligament pain","Possible nasal congestion"],
        dos:         ["Continue prenatal vitamins (folic acid + iron)","Gentle exercise (walking, swimming, prenatal yoga)","Sleep on left side (improves circulation)","Kegel exercises","Attend all antenatal visits"],
        donts:       ["Avoid lying flat on back for long periods","No contact sports","Limit caffeine to 200mg/day","No heavy lifting"],
        screenings:  ["Anatomy scan (18-20 weeks)","Gestational diabetes screening (24-28 weeks)","Anomaly scan"]
    },
    3: {
        weeks:       "27-40",
        development: "Baby gains weight rapidly. Lungs mature. Baby moves into head-down position. Full term at 37 weeks.",
        symptoms:    ["Braxton Hicks contractions","Frequent urination","Heartburn","Shortness of breath","Swollen feet"],
        dos:         ["Monitor fetal movements daily (10 movements in 2 hours)","Pack hospital bag by 36 weeks","Attend more frequent check-ups","Rest and sleep when possible","Attend antenatal classes"],
        donts:       ["Avoid long journeys after 36 weeks without medical clearance","No heavy exercise","Watch for signs of labour"],
        screenings:  ["Group B strep test (35-37 weeks)","Regular BP and urine checks","NST (non-stress test) if needed"]
    }
};

function _getTrimester(weeksPregnant) {
    if (weeksPregnant <= 12) return 1;
    if (weeksPregnant <= 26) return 2;
    return 3;
}

function getPregnancyInfo({ userId, weeksPregnant, query }) {
    if (!userId)        return fail(AGENT, "userId required");
    if (!weeksPregnant) return fail(AGENT, "weeksPregnant required");

    accessLog(userId, AGENT, "pregnancy_info_requested");

    // Check query for high-risk symptoms
    if (query && HIGH_RISK.some(s => query.toLowerCase().includes(s))) {
        return escalate(AGENT, "High-risk pregnancy symptom detected. Seek immediate medical attention.", "HIGH");
    }

    const trimester = _getTrimester(Number(weeksPregnant));
    const info      = TRIMESTER_INFO[trimester];
    const daysLeft  = Math.max(0, (280 - (weeksPregnant * 7)));
    const dueDate   = new Date(Date.now() + daysLeft * 86400000).toISOString().slice(0, 10);

    return ok(AGENT, {
        weeksPregnant,
        trimester,
        estimatedDueDate: dueDate,
        daysUntilDue:     daysLeft,
        trimesterInfo:    info,
        emergencySymptoms: HIGH_RISK.slice(0, 5),
        helpline:         "FOGSI helpline (India): 1800-419-0077 | If emergency: 112"
    });
}

function logPregnancyEntry({ userId, weeksPregnant, weight, bp, symptoms = [], notes = "", fetalMovements }) {
    if (!userId || !weeksPregnant) return fail(AGENT, "userId and weeksPregnant required");

    accessLog(userId, AGENT, "entry_logged");

    // Check symptoms for high-risk flags
    const sympText = symptoms.join(" ").toLowerCase();
    if (HIGH_RISK.some(s => sympText.includes(s.split(" ")[0]))) {
        return escalate(AGENT, "High-risk symptom reported. Please contact your obstetrician or go to the nearest emergency.", "HIGH");
    }

    const entry = { id: uid("preg"), weeksPregnant, weight, bp, symptoms, fetalMovements, notes, date: NOW().slice(0, 10), loggedAt: NOW() };
    const log   = load(userId, "pregnancy_log", []);
    log.push(entry);
    flush(userId, "pregnancy_log", log.slice(-300));

    return ok(AGENT, { entry, message: "Entry logged. Keep attending regular antenatal check-ups." });
}

module.exports = { getPregnancyInfo, logPregnancyEntry };
