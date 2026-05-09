/**
 * Life Coach Agent — motivation, clarity, and general life direction guidance.
 * Inspirational guidance only. NOT therapy or professional coaching.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail, HEALTH_DISCLAIMER } = require("./_lifeStore.cjs");

const SYSTEM = `You are an empathetic, direct life coach. Give honest, practical, motivating advice.
Be direct — not preachy. Focus on action. Respond ONLY with valid JSON.`;

const FRAMEWORKS = {
    ikigai: {
        name:        "Ikigai (Why you exist)",
        questions:   ["What do you love?", "What are you good at?", "What does the world need?", "What can you be paid for?"],
        description: "Where all 4 overlap is your ikigai — your reason for being."
    },
    wheel_of_life: {
        name:        "Wheel of Life",
        areas:       ["Health", "Career", "Finance", "Relationships", "Personal Growth", "Fun & Recreation", "Family", "Spirituality"],
        description: "Rate each area 1-10. The gaps reveal where to focus next."
    },
    smart_goals: {
        name:        "SMART Goals",
        criteria:    ["Specific", "Measurable", "Achievable", "Relevant", "Time-bound"],
        description: "Transform vague dreams into concrete goals with SMART."
    },
    five_whys: {
        name:        "5 Whys (Find root cause)",
        description: "Ask 'why' 5 times to get from surface problem to root cause.",
        example:     "I'm unhappy → Why? → I hate my job → Why? → It's not aligned with my values → Why? → I never defined my values → ..."
    }
};

const DAILY_HABITS_HIGH_IMPACT = [
    "Journal 5 min every morning — clears mental clutter",
    "Set 1 MIT (Most Important Task) the night before",
    "No phone for first 30 min after waking",
    "Move your body daily — even a 20-min walk rewires the brain",
    "Read 20 pages/day — 1 book/month compounds into massive knowledge",
    "Meditate 5-10 min — science-backed stress reduction",
    "Express gratitude to 1 person daily",
    "Review your goals every Sunday evening"
];

const MINDSET_SHIFTS = [
    { from: "I can't do this",        to: "I can't do this YET — what's step 1?" },
    { from: "I failed",               to: "I learned what doesn't work" },
    { from: "I don't have time",      to: "It's not a priority right now — and that's a choice" },
    { from: "I'm not good enough",    to: "I'm good enough to start and get better" },
    { from: "I'll start Monday",      to: "I'll start with 5 minutes today" },
    { from: "What if I fail?",        to: "What if I succeed — and what if failing teaches me more?" }
];

async function coach({ question, context = "", area = "general", userId = "" }) {
    const framework = area === "purpose" ? FRAMEWORKS.ikigai : area === "goals" ? FRAMEWORKS.smart_goals : null;

    let aiResponse = null;
    try {
        const prompt = `Life coaching question: "${question}". Context: "${context}". Area: ${area}.
Give honest, action-focused coaching. No platitudes.
JSON: { "directAnswer": "...", "keyInsight": "...", "actionSteps": ["..."], "challengeFor24hrs": "...", "powerfulQuestion": "..." }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
        aiResponse = groq.parseJson(raw);
    } catch { /* template only */ }

    const session = {
        id:             uid("coach"),
        userId,
        question:       question?.slice(0, 500) || "",
        area,
        framework,
        aiResponse,
        fallbackAdvice: {
            directAnswer:  "Clarity comes from action, not from thinking more. Pick one small step and do it today.",
            keyInsight:    "The gap between where you are and where you want to be is bridged by consistent daily action — not breakthrough moments.",
            actionSteps:   ["Write down the ONE thing you could do today that moves this forward", "Set a 25-minute timer and work on it now", "Tell one person your goal — accountability is powerful"],
            challenge:     "Take one imperfect action on this within the next 24 hours."
        },
        dailyHabits:    DAILY_HABITS_HIGH_IMPACT.slice(0, 5),
        mindsetShifts:  MINDSET_SHIFTS.slice(0, 3),
        disclaimer:     HEALTH_DISCLAIMER + "\n⚠️ For clinical mental health concerns, consult a licensed professional.",
        sessionAt:      NOW()
    };

    logToMemory("lifeCoachAgent", `${userId}:${area}`, { question: question?.slice(0, 100) });
    return session;
}

function getFrameworks() {
    return { frameworks: FRAMEWORKS, tip: "Use one framework at a time — mastery over variety." };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "life_frameworks") {
            data = getFrameworks();
        } else {
            data = await coach({ question: p.question || p.message || "How do I improve my life?", context: p.context || "", area: p.area || "general", userId: p.userId || "" });
        }
        return ok("lifeCoachAgent", data, ["Clarity + Action > Motivation alone", "You don't need to see the whole staircase — just the next step"]);
    } catch (err) { return fail("lifeCoachAgent", err.message); }
}

module.exports = { coach, getFrameworks, FRAMEWORKS, MINDSET_SHIFTS, run };
