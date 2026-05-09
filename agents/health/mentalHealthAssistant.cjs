"use strict";
/**
 * Mental Health Assistant — supportive conversation, NOT therapy replacement.
 * ALWAYS escalates crisis signals to emergency lines.
 * Follows safe messaging guidelines on suicide/self-harm.
 */
const { load, flush, uid, NOW, ok, fail, escalate, accessLog, EMERGENCY_NUMBERS } = require("./_healthStore.cjs");

const AGENT = "mentalHealthAssistant";

// Crisis keywords — immediate escalation, no exceptions
const CRISIS_KEYWORDS = [
    "suicidal","want to die","end my life","kill myself","self harm","self-harm","cutting myself",
    "no reason to live","worthless","can't go on","ending it all","overdose on purpose","hurt myself"
];

const MOOD_RESPONSES = {
    anxious:    { response: "It sounds like you're feeling overwhelmed right now. That's really tough. Anxiety is your mind's alarm system — sometimes it fires when it doesn't need to. Let's try to slow things down.", cbt_tip: "Try the 5-4-3-2-1 grounding technique: name 5 things you see, 4 you can touch, 3 you hear, 2 you smell, 1 you taste.", resource: "iCall: 9152987821" },
    sad:        { response: "I hear you. Feeling sad can be exhausting, and it's okay to acknowledge that. You don't have to push it away.", cbt_tip: "Try journaling about one small thing that went okay today, even if it's minor. Small positives matter.", resource: "iCall: 9152987821" },
    stressed:   { response: "Stress often comes from feeling like demands outweigh our resources. That's very human. Let's look at what's driving this.", cbt_tip: "Write down your top 3 stressors. For each, ask: is this within my control? Focus energy only on what you can influence.", resource: "NIMHANS: 080-46110007" },
    lonely:     { response: "Loneliness is one of the most painful feelings — and one of the most common. You're not alone in feeling alone.", cbt_tip: "Small connection counts: text one person today, even just to say 'hi'. Human connection doesn't have to be deep to matter.", resource: "iCall: 9152987821" },
    angry:      { response: "Anger is valid — it's often a signal that something important to you isn't being respected. Let's explore what's underneath it.", cbt_tip: "Before responding when angry, use the STOP technique: Stop, Take a breath, Observe your feelings, Proceed mindfully.", resource: null },
    overwhelmed:{ response: "When everything piles up, it's hard to see clearly. Let's try to break things down into smaller pieces.", cbt_tip: "Write down everything on your mind. Then circle just ONE small thing you can act on today. One thing.", resource: "iCall: 9152987821" },
    hopeless:   { response: "Hopelessness can feel absolute, but it's often a feeling — not a fact. Feelings change, even when they feel permanent.", cbt_tip: "Challenge the hopeless thought: 'Has there ever been a time I felt this hopeless and things improved, even slightly?' Most often, yes.", resource: "iCall: 9152987821" }
};

function _detectCrisis(text) {
    const lower = text.toLowerCase();
    return CRISIS_KEYWORDS.some(k => lower.includes(k));
}

function _detectMood(text) {
    const lower = text.toLowerCase();
    const scores = {};
    const moodKW = {
        anxious: ["anxious","anxiety","panic","worried","scared","fear","nervous"],
        sad: ["sad","cry","depressed","unhappy","grief","down"],
        stressed: ["stressed","stress","pressure","overwhelmed by work","too much"],
        lonely: ["lonely","alone","isolated","no one","nobody cares"],
        angry: ["angry","frustrated","furious","rage","annoyed"],
        overwhelmed: ["overwhelmed","can't cope","too much","breaking point"],
        hopeless: ["hopeless","no point","pointless","nothing matters","future"]
    };
    for (const [mood, kws] of Object.entries(moodKW)) {
        scores[mood] = kws.filter(k => lower.includes(k)).length;
    }
    const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return top[1] > 0 ? top[0] : null;
}

function chat({ userId, message, mood }) {
    if (!userId)  return fail(AGENT, "userId required");
    if (!message) return fail(AGENT, "message required");

    accessLog(userId, AGENT, "mental_health_chat");

    // Crisis check — non-negotiable
    if (_detectCrisis(message)) {
        const log = load(userId, "mental_health_log", []);
        log.push({ id: uid("mh"), type: "crisis_detected", message: message.slice(0, 100), at: NOW() });
        flush(userId, "mental_health_log", log.slice(-1000));
        return escalate(AGENT,
            "⚠️ It sounds like you may be in crisis. You are not alone. Please reach out to a crisis helpline immediately.",
            "HIGH"
        );
    }

    const detectedMood = mood || _detectMood(message);
    const moodData     = MOOD_RESPONSES[detectedMood] || {
        response:  "Thank you for sharing that with me. Whatever you're feeling is valid.",
        cbt_tip:   "Sometimes just expressing how you feel is a positive step. Consider journaling or talking to someone you trust.",
        resource:  "iCall: 9152987821"
    };

    const log = load(userId, "mental_health_log", []);
    log.push({ id: uid("mh"), type: "chat", mood: detectedMood, summary: message.slice(0, 100), at: NOW() });
    flush(userId, "mental_health_log", log.slice(-1000));

    return ok(AGENT, {
        response:     moodData.response,
        cbtTechnique: moodData.cbt_tip,
        detectedMood: detectedMood || "general",
        professionalSupport: {
            reminder: "This assistant provides peer-style support only. A licensed therapist can offer much deeper help.",
            resources: {
                iCall:          "9152987821 (Mon-Sat, 8am-10pm)",
                NIMHANS:        "080-46110007",
                Vandrevala:     "1860-2662-345 (24/7)",
                iCall_website:  "icallhelpline.org",
                note:           "In emergencies, call 112 or visit nearest hospital"
            }
        }
    });
}

function logMood({ userId, moodRating, moodLabel = "", notes = "" }) {
    if (!userId)              return fail(AGENT, "userId required");
    if (!moodRating || moodRating < 1 || moodRating > 10)
        return fail(AGENT, "moodRating must be 1-10");

    accessLog(userId, AGENT, "mood_logged");
    const log   = load(userId, "mood_log", []);
    const entry = { id: uid("mood"), moodRating, moodLabel, notes, date: NOW().slice(0, 10), loggedAt: NOW() };
    log.push(entry);
    flush(userId, "mood_log", log.slice(-2000));

    return ok(AGENT, {
        entry,
        trend: log.length >= 7
            ? `7-day average mood: ${+(log.slice(-7).reduce((s, e) => s + e.moodRating, 0) / 7).toFixed(1)}/10`
            : "Keep logging to see mood trends"
    });
}

module.exports = { chat, logMood };
