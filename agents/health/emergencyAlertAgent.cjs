"use strict";
/**
 * Emergency Alert Agent — surfaces critical safety information.
 * This is a FIRST AID guidance + escalation tool only.
 * ALWAYS directs to emergency services. Never substitutes them.
 */
const { load, flush, uid, NOW, ok, fail, accessLog, EMERGENCY_NUMBERS } = require("./_healthStore.cjs");

const AGENT = "emergencyAlertAgent";

const FIRST_AID = {
    cardiac_arrest: {
        title:    "Cardiac Arrest / Unresponsive Person",
        steps:    [
            "1. CALL 112 IMMEDIATELY — do not delay",
            "2. Check for response: tap shoulders and shout 'Are you okay?'",
            "3. If no response and not breathing normally — start CPR",
            "4. CPR: Push hard and fast in the centre of chest (100-120 times/min)",
            "5. Push down 5-6 cm each compression",
            "6. Give 2 rescue breaths every 30 compressions if trained",
            "7. If AED available — use it immediately",
            "8. Continue until ambulance arrives or person recovers"
        ],
        call: "112"
    },
    choking: {
        title:    "Choking (Adult/Child)",
        steps:    [
            "1. Ask: 'Are you choking?' — if they can cough forcefully, encourage coughing",
            "2. If cannot cough/speak/breathe — 5 firm back blows between shoulder blades",
            "3. Then 5 abdominal thrusts (Heimlich): stand behind person, hands just above navel, pull inward and upward sharply",
            "4. Alternate back blows and abdominal thrusts",
            "5. If person becomes unconscious — call 112 and start CPR",
            "6. For infants: face-down back blows and chest thrusts (NOT abdominal)"
        ],
        call: "112"
    },
    stroke: {
        title:    "Stroke — FAST Assessment",
        steps:    [
            "F — FACE: Ask to smile. Is one side drooping?",
            "A — ARMS: Ask to raise both arms. Does one drift down?",
            "S — SPEECH: Ask to repeat a phrase. Is speech slurred or strange?",
            "T — TIME: If ANY sign is positive — CALL 112 IMMEDIATELY",
            "Do NOT give food or water",
            "Do NOT leave the person alone",
            "Note the time symptoms started — crucial for treatment"
        ],
        call: "112"
    },
    severe_bleeding: {
        title:    "Severe Bleeding",
        steps:    [
            "1. Press firmly on the wound with clean cloth or hands",
            "2. Apply continuous pressure for at least 10 minutes",
            "3. Do NOT lift the cloth to check — add more cloth on top if soaked",
            "4. Elevate injured limb above heart level if possible",
            "5. Do NOT remove embedded objects — pack around them",
            "6. Call 112 if bleeding is severe or does not stop in 15 minutes"
        ],
        call: "112"
    },
    severe_allergic: {
        title:    "Severe Allergic Reaction (Anaphylaxis)",
        steps:    [
            "1. CALL 112 IMMEDIATELY — anaphylaxis kills within minutes",
            "2. Use adrenaline/epinephrine auto-injector (EpiPen) if available — outer thigh",
            "3. Lay person flat with legs elevated (unless breathing difficulty — then sit up)",
            "4. Give second EpiPen after 5-15 minutes if no improvement and help delayed",
            "5. If prescribed antihistamine + steroid — give after EpiPen, NOT instead",
            "6. CPR if unresponsive"
        ],
        call: "112"
    },
    burns: {
        title:    "Burns",
        steps:    [
            "1. Remove from source of burn (ensure your own safety first)",
            "2. Cool burn with cool/lukewarm running water for 20 minutes",
            "3. Do NOT use ice, butter, toothpaste, or any creams",
            "4. Remove jewellery near the burn (swelling will follow)",
            "5. Cover loosely with cling film or clean non-fluffy material",
            "6. Call 112 for large burns (>hand size), face/hands/genitals, or deep burns"
        ],
        call: "112 for serious burns"
    },
    overdose: {
        title:    "Suspected Drug/Medication Overdose",
        steps:    [
            "1. CALL 112 IMMEDIATELY — bring medication packaging if possible",
            "2. If unconscious but breathing: recovery position (on side)",
            "3. If not breathing: CPR",
            "4. Do NOT induce vomiting unless specifically instructed by emergency services",
            "5. Stay with the person until emergency services arrive",
            "6. Poison control (India): 1800-116-117"
        ],
        call: "112 | Poison Control: 1800-116-117"
    },
    mental_health_crisis: {
        title:    "Mental Health Crisis / Suicidal Behaviour",
        steps:    [
            "1. Stay with the person — do not leave them alone",
            "2. Remove access to means if safe to do so",
            "3. Speak calmly and listen without judgment",
            "4. Do not promise secrecy — safety comes first",
            "5. Call iCall: 9152987821 or Vandrevala: 1860-2662-345",
            "6. If immediate danger: call 112"
        ],
        call: "112 | iCall: 9152987821"
    }
};

function getEmergencyGuide({ userId, situation }) {
    if (!userId || !situation) return fail(AGENT, "userId and situation required");
    accessLog(userId, AGENT, "emergency_guide_requested", { situation: situation.slice(0, 50) });

    const lower = situation.toLowerCase();
    let key = "cardiac_arrest"; // default to most critical
    if (lower.includes("chok"))     key = "choking";
    else if (lower.includes("stroke"))   key = "stroke";
    else if (lower.includes("bleed"))    key = "severe_bleeding";
    else if (lower.includes("allerg") || lower.includes("anaphyl")) key = "severe_allergic";
    else if (lower.includes("burn"))     key = "burns";
    else if (lower.includes("overdos") || lower.includes("poison"))  key = "overdose";
    else if (lower.includes("mental") || lower.includes("suicid"))   key = "mental_health_crisis";
    else if (lower.includes("cardiac") || lower.includes("heart") || lower.includes("unconscious")) key = "cardiac_arrest";

    const guide = FIRST_AID[key];

    const log = load(userId, "emergency_log", []);
    log.push({ id: uid("em"), situation: situation.slice(0, 100), guideUsed: key, at: NOW() });
    flush(userId, "emergency_log", log.slice(-500));

    return ok(AGENT, {
        emergencyNumber:  "⚠️ CALL 112 NOW FOR LIFE-THREATENING EMERGENCIES",
        guide,
        allEmergencyNumbers: EMERGENCY_NUMBERS,
        allFirstAidTopics: Object.keys(FIRST_AID)
    }, { riskLevel: "HIGH" });
}

function triggerAlert({ userId, type = "general", location, message }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "alert_triggered", { type });
    const alert = { id: uid("alrt"), userId, type, location, message, triggeredAt: NOW() };
    const alerts = load(userId, "alerts", []);
    alerts.push(alert);
    flush(userId, "alerts", alerts.slice(-100));
    return ok(AGENT, {
        alert,
        action:           "⚠️ Alert logged. In real emergencies, call 112 immediately.",
        emergencyNumbers: EMERGENCY_NUMBERS
    }, { riskLevel: "HIGH" });
}

module.exports = { getEmergencyGuide, triggerAlert, FIRST_AID };
