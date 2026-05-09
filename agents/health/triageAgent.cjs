"use strict";
const { load, flush, uid, NOW, ok, fail, escalate, accessLog, RISK, EMERGENCY_NUMBERS } = require("./_healthStore.cjs");

const AGENT = "triageAgent";

const TRIAGE_GUIDANCE = {
    [RISK.LOW]: {
        message:    "Your symptoms appear to be low-risk at this time.",
        action:     "Rest, stay hydrated, and monitor for any worsening. Schedule a routine doctor visit if symptoms persist beyond 3 days.",
        urgency:    "routine",
        timeframe:  "Within 1 week"
    },
    [RISK.MEDIUM]: {
        message:    "Your symptoms warrant medical attention.",
        action:     "Please consult a doctor within 24 hours. Do not ignore these symptoms.",
        urgency:    "soon",
        timeframe:  "Within 24 hours"
    },
    [RISK.HIGH]: {
        message:    "⚠️ Your symptoms indicate a potentially serious condition.",
        action:     "Seek IMMEDIATE medical help. Call 112 or visit the nearest emergency room NOW.",
        urgency:    "emergency",
        timeframe:  "Immediately"
    }
};

// Additional first-aid tips keyed by detected body system
const FIRST_AID = {
    cardiac:       "Stop all physical activity. Sit or lie down. If prescribed nitrates, take them. Call emergency services.",
    respiratory:   "Sit upright. Use prescribed inhaler if available. Do NOT lie flat. Call emergency if breathing worsens.",
    neurological:  "Do NOT give food/water. Keep person still. Clear the area of sharp objects. Call emergency services.",
    mental:        "Stay with the person. Remove potential hazards. Call iCall (9152987821) or NIMHANS (080-46110007). Do not leave them alone.",
    gastrointestinal: "Stay hydrated with small sips of water. Avoid solid food temporarily. Seek medical attention if pain is severe.",
    fever:         "Cool compresses on forehead. Stay hydrated. Paracetamol per label instructions only. See doctor if temperature exceeds 103°F / 39.4°C.",
    dermatological: "Do not scratch. Apply cool compress. If throat/face swelling occurs — this is emergency, call 112.",
    default:       "Rest, stay hydrated. Monitor symptoms. Seek medical help if worsening."
};

function triage({ userId, checkId, riskLevel, detectedSystems = [], symptoms = [], age }) {
    if (!userId) return fail(AGENT, "userId required");

    accessLog(userId, AGENT, "triage", { checkId, riskLevel });

    // If no riskLevel given, try to load from symptom check
    let level = riskLevel;
    if (!level && checkId) {
        const hist = load(userId, "symptoms", []);
        const check = hist.find(c => c.id === checkId);
        if (check) level = check.riskLevel;
    }
    if (!level) level = RISK.LOW;

    // Always escalate HIGH immediately
    if (level === RISK.HIGH) {
        const primarySystem = detectedSystems[0] || "default";
        const firstAid = FIRST_AID[primarySystem] || FIRST_AID.default;
        return escalate(AGENT,
            `HIGH-RISK TRIAGE: Immediate medical attention required. ${firstAid}`,
            RISK.HIGH
        );
    }

    const guidance = TRIAGE_GUIDANCE[level];
    const systemTips = detectedSystems
        .filter(s => FIRST_AID[s])
        .map(s => ({ system: s, tip: FIRST_AID[s] }));

    const record = {
        id:      uid("tr"),
        userId, checkId, riskLevel: level,
        detectedSystems, age,
        triaged: NOW()
    };
    const hist = load(userId, "triage", []);
    hist.push(record);
    flush(userId, "triage", hist.slice(-200));

    const response = {
        triageId:      record.id,
        riskLevel:     level,
        urgency:       guidance.urgency,
        timeframe:     guidance.timeframe,
        message:       guidance.message,
        action:        guidance.action,
        systemTips,
        emergencyNumbers: level === RISK.MEDIUM ? EMERGENCY_NUMBERS : undefined,
        triaged:       record.triaged
    };

    return ok(AGENT, response, { riskLevel: level });
}

function getTriageHistory({ userId, limit = 10 }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "history_viewed");
    return ok(AGENT, load(userId, "triage", []).slice(-limit).reverse());
}

module.exports = { triage, getTriageHistory };
