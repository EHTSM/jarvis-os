/**
 * Relationship Advisor Agent — communication advice and relationship tips.
 * General guidance only. NOT therapy or couples counseling.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail, HEALTH_DISCLAIMER } = require("./_lifeStore.cjs");

const SYSTEM = `You are a communication coach giving general relationship and communication advice.
Always emphasize this is general guidance, not therapy. Recommend professional counseling for serious issues.
Respond ONLY with valid JSON.`;

const COMMUNICATION_TIPS = {
    conflict: [
        "Use 'I feel...' statements instead of 'You always...'",
        "Listen to understand, not to respond",
        "Take a 20-minute break if emotions are too high — the brain needs time to calm",
        "Attack the problem, never the person",
        "Agree on the goal: resolution, not winning"
    ],
    connection: [
        "Put the phone down during conversations — full presence matters",
        "Ask open-ended questions: 'How did that make you feel?' not 'Was it okay?'",
        "Schedule regular 1:1 time — relationships need investment",
        "Express appreciation daily — small acknowledgments compound",
        "Celebrate each other's wins — big and small"
    ],
    boundaries: [
        "Boundaries are not walls — they're the rules for respectful interaction",
        "State needs clearly: 'I need...' rather than expecting others to guess",
        "It's okay to say no — healthy relationships survive 'no'",
        "Enforce boundaries consistently — inconsistency breeds confusion",
        "Others' discomfort with your boundaries is not your responsibility"
    ],
    trust: [
        "Trust is rebuilt through consistent small actions, not grand gestures",
        "Acknowledge impact even when intent was good",
        "Transparency > perfection — honesty builds more trust than a perfect record",
        "Follow through on every commitment, however small",
        "Give trust incrementally as it is earned"
    ],
    general: [
        "Relationships require maintenance — like plants, they die without attention",
        "Assume positive intent before assuming negative",
        "Check in regularly: 'How are we doing?'",
        "Grow together — share goals and support each other's development"
    ]
};

const LOVE_LANGUAGES = [
    { language: "Words of Affirmation", signs: ["I love hearing compliments", "Kind words mean a lot to me"], tips: "Express appreciation verbally and in writing. Compliment often." },
    { language: "Acts of Service",      signs: ["Actions mean more than words", "I notice when you do things for me"], tips: "Help with tasks without being asked. Small acts of care speak loudly." },
    { language: "Receiving Gifts",      signs: ["Thoughtful gifts mean a lot", "I keep meaningful mementos"], tips: "Give thoughtful, personalized gifts. It's about the meaning, not cost." },
    { language: "Quality Time",         signs: ["Undivided attention is key", "I value focused time together"], tips: "Plan activities together. Put the phone away. Be fully present." },
    { language: "Physical Touch",       signs: ["Hugs and touch feel reassuring", "Proximity matters"], tips: "Appropriate, consensual touch: hugs, handshakes, pats on the back." }
];

async function advise({ situation, relationshipType = "general", concern = "communication", userId = "" }) {
    const tips = COMMUNICATION_TIPS[concern] || COMMUNICATION_TIPS.general;

    let aiAdvice = null;
    try {
        const prompt = `Someone has this ${relationshipType} relationship situation: "${situation}".
Core concern: ${concern}. Give practical, empathetic communication advice.
JSON: { "summary": "...", "immediateSteps": ["..."], "longTermAdvice": ["..."], "thingsToAvoid": ["..."], "professionalHelpNote": "..." }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
        aiAdvice   = groq.parseJson(raw);
    } catch { /* template only */ }

    const result = {
        id:              uid("rel"),
        userId,
        situation:       situation?.slice(0, 500) || "",
        relationshipType,
        concern,
        keyTips:         tips,
        loveLangaugeInfo: LOVE_LANGUAGES.slice(0, 3),
        aiAdvice,
        reminder:        "Every relationship is unique — general advice is a starting point, not a prescription.",
        disclaimer:      HEALTH_DISCLAIMER + "\n⚠️ For serious relationship issues, please consult a qualified therapist or counselor.",
        createdAt:       NOW()
    };

    logToMemory("relationshipAdvisorAgent", `${userId}:${concern}`, { type: relationshipType });
    return result;
}

function getLoveLanugages() {
    return { loveLanugages: LOVE_LANGUAGES, tips: "Understanding each other's primary love language prevents mismatched effort." };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "love_languages") {
            data = getLoveLanugages();
        } else {
            data = await advise({ situation: p.situation || p.message || "", relationshipType: p.type || p.relationshipType || "general", concern: p.concern || "communication", userId: p.userId || "" });
        }
        return ok("relationshipAdvisorAgent", data, ["Empathy first, advice second", "Professional counselors exist for a reason — use them"]);
    } catch (err) { return fail("relationshipAdvisorAgent", err.message); }
}

module.exports = { advise, getLoveLanugages, LOVE_LANGUAGES, run };
