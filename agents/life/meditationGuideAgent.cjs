/**
 * Meditation Guide Agent — guided relaxation suggestions. NOT therapy.
 */

const { uid, NOW, logToMemory, ok, fail, HEALTH_DISCLAIMER } = require("./_lifeStore.cjs");

const SESSIONS = {
    breathing: [
        { name: "Box Breathing",       duration: 5,  steps: ["Inhale 4s", "Hold 4s", "Exhale 4s", "Hold 4s"], benefit: "Reduces anxiety" },
        { name: "4-7-8 Breathing",     duration: 5,  steps: ["Inhale 4s", "Hold 7s", "Exhale 8s"],            benefit: "Promotes sleep" },
        { name: "Belly Breathing",     duration: 5,  steps: ["Breathe deep into belly", "Slow exhale"],        benefit: "Calms nervous system" }
    ],
    body_scan: [
        { name: "Progressive Relaxation", duration: 10, steps: ["Start at feet", "Move up through legs, torso, arms, neck, face", "Release tension in each area"], benefit: "Full body relaxation" },
        { name: "Quick Body Scan",         duration: 5,  steps: ["Close eyes", "Scan head to toe", "Notice without judgment"], benefit: "Grounding" }
    ],
    visualization: [
        { name: "Safe Place",           duration: 10, steps: ["Imagine a peaceful place", "Notice sights, sounds, smells", "Feel safe and calm"], benefit: "Stress relief" },
        { name: "Future Self",          duration: 10, steps: ["Visualize your goal achieved", "See yourself confident", "Hold the feeling"], benefit: "Motivation" }
    ],
    mindfulness: [
        { name: "Present Moment",       duration: 5,  steps: ["Focus on breath", "Notice thoughts without attachment", "Return to breath"], benefit: "Mental clarity" },
        { name: "Loving-Kindness",      duration: 10, steps: ["Send kindness to self", "To loved ones", "To all beings"], benefit: "Emotional wellbeing" }
    ]
};

const MOOD_MAP = {
    anxious:  "breathing",
    stressed: "breathing",
    tired:    "body_scan",
    angry:    "body_scan",
    sad:      "visualization",
    unfocused:"mindfulness",
    default:  "mindfulness"
};

function getSession({ type, mood, duration = 5, userId = "default" }) {
    const category = type || MOOD_MAP[mood] || MOOD_MAP.default;
    const pool     = SESSIONS[category] || SESSIONS.mindfulness;
    const options  = pool.filter(s => s.duration <= duration + 2);
    const session  = options.length ? options[Math.floor(Math.random() * options.length)] : pool[0];

    const result = {
        id:         uid("med"),
        userId,
        session:    { ...session, category },
        tips:       [
            "Find a quiet, comfortable spot.",
            "Set a timer so you're not watching the clock.",
            "Be patient — 5 minutes daily beats 1 hour weekly."
        ],
        disclaimer: HEALTH_DISCLAIMER,
        loggedAt:   NOW()
    };

    logToMemory("meditationGuideAgent", `${userId}:${category}`, { session: session.name });
    return result;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = getSession({ type: p.type, mood: p.mood, duration: p.duration || 5, userId: p.userId || "default" });
        return ok("meditationGuideAgent", data, ["Consistency matters more than duration", "Morning sessions set the tone for the day"]);
    } catch (err) { return fail("meditationGuideAgent", err.message); }
}

module.exports = { getSession, SESSIONS, run };
