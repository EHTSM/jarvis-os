"use strict";
const { ok, fail, accessLog, load, flush, uid, NOW } = require("./_healthStore.cjs");

const AGENT = "meditationCoach";

const MEDITATION_TYPES = {
    breathing: {
        name:         "Box Breathing (4-4-4-4)",
        duration:     "5 minutes",
        instructions: ["Find a comfortable seated position","Inhale through nose for 4 counts","Hold breath for 4 counts","Exhale slowly for 4 counts","Hold empty for 4 counts","Repeat 5-10 cycles"],
        benefits:     "Activates parasympathetic nervous system. Reduces cortisol. Ideal for acute stress or before sleep.",
        when:         "Anxiety, pre-presentation nerves, before sleep"
    },
    body_scan: {
        name:         "Body Scan Meditation",
        duration:     "10-15 minutes",
        instructions: ["Lie down comfortably","Close your eyes and take 3 deep breaths","Bring attention to your feet — notice any sensations without judgment","Slowly move awareness upward: feet → calves → knees → thighs → hips → abdomen → chest → shoulders → arms → hands → neck → face","If mind wanders, gently return to the body part you were on","End with 3 deep breaths"],
        benefits:     "Reduces physical tension. Improves body awareness. Excellent for chronic pain and anxiety.",
        when:         "Before sleep, after exercise, chronic tension"
    },
    mindfulness: {
        name:         "Mindfulness of Breath",
        duration:     "10 minutes",
        instructions: ["Sit comfortably with back straight","Set a gentle timer for 10 minutes","Focus attention on the sensation of breath at the nostrils or belly","When thoughts arise, simply label them 'thinking' and return to breath","Do not fight thoughts — just notice and return","Build up from 5 to 20 minutes over weeks"],
        benefits:     "Reduces rumination. Improves focus and emotional regulation. Evidence base: strongest of all meditation types.",
        when:         "Daily practice, stress reduction, focus improvement"
    },
    loving_kindness: {
        name:         "Loving Kindness (Metta) Meditation",
        duration:     "10 minutes",
        instructions: ["Sit comfortably and close eyes","Bring a sense of warmth to yourself. Silently repeat: 'May I be happy. May I be healthy. May I be at peace.'","Extend this to someone you love: 'May you be happy. May you be healthy. May you be at peace.'","Extend to a neutral person, then to all beings","Notice any resistance and be gentle with yourself"],
        benefits:     "Reduces self-criticism. Increases compassion. Helps with loneliness and interpersonal conflict.",
        when:         "Depression, social anxiety, relationship difficulties"
    },
    "478_breathing": {
        name:         "4-7-8 Breathing (Sleep Aid)",
        duration:     "5 minutes",
        instructions: ["Exhale completely through mouth making a 'whoosh' sound","Close mouth and inhale through nose for 4 counts","Hold breath for 7 counts","Exhale through mouth for 8 counts (whoosh sound)","Repeat 4 cycles — do not exceed 4 cycles initially"],
        benefits:     "Powerful sleep aid. Reduces anxiety rapidly. Acts as a natural tranquilliser for nervous system.",
        when:         "Insomnia, acute anxiety, before sleep"
    }
};

function getSession({ userId, type = "breathing", goal }) {
    if (!userId) return fail(AGENT, "userId required");

    accessLog(userId, AGENT, "session_requested", { type });

    // Auto-select based on goal
    let selectedType = type;
    if (goal) {
        const g = goal.toLowerCase();
        if (g.includes("sleep") || g.includes("insomnia"))              selectedType = "478_breathing";
        else if (g.includes("anxiety") || g.includes("stress"))        selectedType = "breathing";
        else if (g.includes("body") || g.includes("tension") || g.includes("pain")) selectedType = "body_scan";
        else if (g.includes("compassion") || g.includes("loneli"))     selectedType = "loving_kindness";
        else if (g.includes("focus") || g.includes("mindful"))         selectedType = "mindfulness";
    }

    const session = MEDITATION_TYPES[selectedType] || MEDITATION_TYPES.breathing;

    const log = load(userId, "meditation_log", []);
    log.push({ id: uid("med"), type: selectedType, date: NOW().slice(0, 10), at: NOW() });
    flush(userId, "meditation_log", log.slice(-1000));

    const streak = _calculateStreak(log);

    return ok(AGENT, {
        session: { type: selectedType, ...session },
        streak:  streak > 0 ? `🧘 ${streak}-day meditation streak!` : "Start your streak today!",
        tip:     "Consistency matters more than duration. Even 5 minutes daily is more effective than 60 minutes once a week.",
        available: Object.keys(MEDITATION_TYPES)
    });
}

function _calculateStreak(log) {
    const dates = [...new Set(log.map(l => l.date))].sort().reverse();
    let streak  = 0;
    let current = NOW().slice(0, 10);
    for (const d of dates) {
        if (d === current) { streak++; const dt = new Date(current); dt.setDate(dt.getDate() - 1); current = dt.toISOString().slice(0, 10); }
        else break;
    }
    return streak;
}

function getStats({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    const log    = load(userId, "meditation_log", []);
    const dates  = [...new Set(log.map(l => l.date))];
    const byType = {};
    for (const l of log) byType[l.type] = (byType[l.type] || 0) + 1;
    return ok(AGENT, { totalSessions: log.length, uniqueDays: dates.length, byType, streak: _calculateStreak(log) });
}

module.exports = { getSession, getStats };
