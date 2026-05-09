"use strict";
const { load, flush, uid, NOW, ok, fail, escalate, accessLog, RISK } = require("./_healthStore.cjs");

const AGENT = "symptomChecker";

// Body-system keyword mappings
const SYSTEM_MAP = {
    cardiac:       { kw: ["chest pain","chest tightness","heart racing","palpitations","arm pain","jaw pain","shortness of breath","sweating cold"], boost: 3 },
    neurological:  { kw: ["severe headache","sudden headache","seizure","convulsion","confusion","numbness face","drooping face","slurred speech","sudden vision loss","loss of consciousness"], boost: 3 },
    respiratory:   { kw: ["difficulty breathing","can't breathe","wheezing","coughing blood","blue lips","choking","rapid breathing"], boost: 2 },
    gastrointestinal: { kw: ["nausea","vomiting","diarrhea","stomach pain","abdominal pain","bloating","blood in stool","black stool","constipation","jaundice"], boost: 1 },
    musculoskeletal:  { kw: ["back pain","joint pain","muscle ache","swelling","stiffness","bone pain","fracture","sprain"], boost: 0 },
    dermatological:   { kw: ["rash","itching","hives","redness","blisters","face swelling","throat swelling","peeling skin"], boost: 1 },
    fever:            { kw: ["fever","high temperature","chills","rigors","sweating","burning hot"], boost: 0 },
    mental:           { kw: ["suicidal","self harm","self-harm","hopeless","can't go on","want to die","panic attack","severe anxiety"], boost: 3 },
    urological:       { kw: ["blood in urine","painful urination","no urination","kidney pain","frequent urination"], boost: 1 },
    gynecological:    { kw: ["heavy bleeding","abnormal discharge","severe pelvic pain","missed period"], boost: 1 }
};

// Immediately HIGH-risk patterns (any match → risk = HIGH)
const CRITICAL_SYMPTOMS = [
    "chest pain","can't breathe","difficulty breathing","seizure","convulsion",
    "unconscious","unresponsive","coughing blood","vomiting blood","blue lips",
    "slurred speech","drooping face","sudden severe headache","suicidal","self harm",
    "self-harm","severe allergic reaction","anaphylaxis","choking","overdose",
    "stroke","heart attack","loss of consciousness","throat swelling"
];

function checkSymptoms({ userId, symptoms = [], age, gender, duration, existingConditions = [] }) {
    if (!userId)          return fail(AGENT, "userId required");
    if (!symptoms.length) return fail(AGENT, "symptoms array is required");

    accessLog(userId, AGENT, "symptom_check", { count: symptoms.length });

    const lower   = symptoms.map(s => String(s).toLowerCase());
    const inputStr = lower.join(" ");

    // Critical symptom check — immediate HIGH
    const criticalFound = CRITICAL_SYMPTOMS.filter(c => inputStr.includes(c));
    if (criticalFound.length) {
        const record = { id: uid("sx"), userId, symptoms, riskLevel: RISK.HIGH, checkedAt: NOW() };
        const hist   = load(userId, "symptoms", []);
        hist.push(record);
        flush(userId, "symptoms", hist.slice(-500));
        return escalate(AGENT, `Critical symptom(s) detected: ${criticalFound.join(", ")}. Seek emergency help immediately.`, RISK.HIGH);
    }

    // System-level scoring
    let riskScore  = 0;
    const detected = [];
    for (const [system, conf] of Object.entries(SYSTEM_MAP)) {
        const matches = conf.kw.filter(k => inputStr.includes(k));
        if (matches.length) {
            detected.push({ system, matches });
            riskScore += matches.length + conf.boost;
        }
    }

    // Age-based adjustment
    if (age) {
        if (age < 2 || age > 75) riskScore += 1;
        if (age < 1)              riskScore += 2;
    }

    // Chronic conditions increase risk sensitivity
    if (existingConditions.length) riskScore += Math.min(existingConditions.length, 3);

    // Duration modifier
    if (duration) {
        const d = duration.toLowerCase();
        if (d.includes("week") || d.includes("month") || d.includes("year")) riskScore += 1;
    }

    const riskLevel = riskScore >= 6 ? RISK.HIGH : riskScore >= 3 ? RISK.MEDIUM : RISK.LOW;

    const record = { id: uid("sx"), userId, symptoms, detectedSystems: detected.map(d => d.system), riskLevel, riskScore, age, gender, duration, existingConditions, checkedAt: NOW() };
    const hist   = load(userId, "symptoms", []);
    hist.push(record);
    flush(userId, "symptoms", hist.slice(-500));

    return ok(AGENT, {
        checkId:         record.id,
        symptoms,
        detectedSystems: detected.map(d => d.system),
        systemDetails:   detected,
        riskLevel,
        riskScore,
        checkedAt:       record.checkedAt,
        nextStep:        riskLevel === RISK.LOW
            ? "Monitor symptoms. See a doctor if they worsen or persist."
            : riskLevel === RISK.MEDIUM
            ? "Consult a doctor within 24 hours."
            : "Seek medical attention immediately."
    }, { riskLevel });
}

function getHistory({ userId, limit = 20 }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "history_viewed");
    const hist = load(userId, "symptoms", []);
    return ok(AGENT, hist.slice(-limit).reverse());
}

module.exports = { checkSymptoms, getHistory };
