"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "aiCompanionPro";

const COMPANION_ROLES = ["mentor","friend","coach","accountability_partner","creative_collaborator","study_buddy","wellness_guide"];
const MOOD_STATES     = ["supportive","encouraging","reflective","playful","focused","empathetic","celebratory"];
const SESSION_TYPES   = ["check_in","deep_talk","goal_review","crisis_support","celebration","brainstorm","mindfulness"];

function createCompanion({ userId, consent, companionName, role = "friend", primaryMoodState = "supportive", personalityTraits = [] }) {
    const gate = requireConsent(consent, "AI companion creation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");
    if (!COMPANION_ROLES.includes(role)) return fail(AGENT, `role must be: ${COMPANION_ROLES.join(", ")}`);
    if (!MOOD_STATES.includes(primaryMoodState)) return fail(AGENT, `primaryMoodState must be: ${MOOD_STATES.join(", ")}`);

    const companion = {
        id:                uid("cp"),
        companionName:     companionName || `Companion_${uid("cn")}`,
        role,
        primaryMoodState,
        personalityTraits: personalityTraits.slice(0, 10),
        relationshipScore: 0,
        totalSessions:     0,
        createdAt:         NOW(),
        ...watermark(AGENT)
    };

    const companions = load(userId, "companions", []);
    companions.push({ id: companion.id, companionName: companion.companionName, role, totalSessions: 0, createdAt: companion.createdAt });
    flush(userId, "companions", companions.slice(-20));

    humanAILog(AGENT, userId, "companion_created", { companionId: companion.id, role }, "INFO");
    return ok(AGENT, companion, { boundary: "AI companions are tools, not replacements for human relationships or professional mental health support" });
}

function startSession({ userId, consent, companionId, sessionType = "check_in", userMessage }) {
    const gate = requireConsent(consent, "companion session");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !companionId) return fail(AGENT, "userId and companionId required");
    if (!SESSION_TYPES.includes(sessionType)) return fail(AGENT, `sessionType must be: ${SESSION_TYPES.join(", ")}`);
    if (!userMessage) return fail(AGENT, "userMessage required");

    const companions = load(userId, "companions", []);
    const companion = companions.find(c => c.id === companionId);
    if (!companion) return fail(AGENT, `companionId ${companionId} not found`);

    const RESPONSES = {
        check_in:        "I'm here! How are you feeling today?",
        deep_talk:       "I'm listening fully. Tell me what's on your mind.",
        goal_review:     "Let's look at your goals together. What progress have you made?",
        crisis_support:  "I hear you, and I'm here. Remember, if this is a mental health emergency, please contact a professional immediately.",
        celebration:     "That's wonderful! I'm so proud of you — tell me everything!",
        brainstorm:      "Love it! Let's explore ideas together. Fire away!",
        mindfulness:     "Take a deep breath. Let's slow down together for a moment."
    };

    const session = {
        id:           uid("ses"),
        companionId,
        companionName: companion.companionName,
        role:          companion.role,
        sessionType,
        userMessage:   String(userMessage).slice(0, 1000),
        companionResponse: `[${companion.role.toUpperCase()}] ${RESPONSES[sessionType]}`,
        empathyScore:  Math.round(70 + Math.random() * 28),
        sessionAt:     NOW(),
        ...watermark(AGENT)
    };

    // increment session count
    companion.totalSessions = (companion.totalSessions || 0) + 1;
    flush(userId, "companions", companions);

    const sessions = load(userId, "companion_sessions", []);
    sessions.push({ id: session.id, companionId, sessionType, sessionAt: session.sessionAt });
    flush(userId, "companion_sessions", sessions.slice(-5000));

    humanAILog(AGENT, userId, "companion_session", { companionId, sessionType }, "INFO");
    return ok(AGENT, session);
}

function getCompanionHistory({ userId, consent, companionId, limit = 20 }) {
    const gate = requireConsent(consent, "companion history");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !companionId) return fail(AGENT, "userId and companionId required");

    const sessions = load(userId, "companion_sessions", []);
    const filtered = sessions.filter(s => s.companionId === companionId).slice(-limit).reverse();
    return ok(AGENT, { total: filtered.length, sessions: filtered });
}

function listCompanions({ userId, consent }) {
    const gate = requireConsent(consent, "companion listing");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const companions = load(userId, "companions", []);
    return ok(AGENT, { total: companions.length, companions, roles: COMPANION_ROLES, sessionTypes: SESSION_TYPES });
}

module.exports = { createCompanion, startSession, getCompanionHistory, listCompanions };
