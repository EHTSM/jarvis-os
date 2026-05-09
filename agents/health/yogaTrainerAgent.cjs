"use strict";
const { ok, fail, accessLog, load, flush, uid, NOW } = require("./_healthStore.cjs");

const AGENT = "yogaTrainerAgent";

const YOGA_SESSIONS = {
    beginner_morning: {
        name:      "Beginner Morning Flow",
        duration:  "20 minutes",
        level:     "beginner",
        poses:     [
            { name: "Child's Pose (Balasana)",        duration: "1 min",  benefit: "Gentle spinal stretch, calms nervous system" },
            { name: "Cat-Cow (Marjaryasana)",         duration: "1 min",  benefit: "Warms up spine, improves flexibility" },
            { name: "Downward Facing Dog (Adho Mukha Svanasana)", duration: "1 min", benefit: "Full body stretch, hamstrings, calves, shoulders" },
            { name: "Low Lunge (Anjaneyasana)",       duration: "1 min each side", benefit: "Hip flexor stretch" },
            { name: "Warrior I (Virabhadrasana I)",   duration: "45 sec each side", benefit: "Strength, balance, hip opener" },
            { name: "Mountain Pose (Tadasana)",       duration: "1 min",  benefit: "Posture alignment, grounding" },
            { name: "Seated Forward Bend (Paschimottanasana)", duration: "1 min", benefit: "Hamstring and spine stretch" },
            { name: "Bridge Pose (Setu Bandhasana)",  duration: "1 min",  benefit: "Glutes, lower back strength" },
            { name: "Corpse Pose (Savasana)",         duration: "5 min",  benefit: "Integration, deep relaxation" }
        ],
        breathing: "Breathe through the nose throughout. Inhale to expand, exhale to deepen."
    },
    stress_relief: {
        name:      "Stress Relief Sequence",
        duration:  "15 minutes",
        level:     "all levels",
        poses:     [
            { name: "Legs Up the Wall (Viparita Karani)",   duration: "5 min",  benefit: "Activates parasympathetic nervous system, reduces anxiety" },
            { name: "Supine Twist (Supta Matsyendrasana)",  duration: "2 min each side", benefit: "Releases spinal tension, aids digestion" },
            { name: "Happy Baby (Ananda Balasana)",         duration: "2 min",  benefit: "Deep hip release, playful grounding" },
            { name: "Child's Pose (Balasana)",              duration: "3 min",  benefit: "Surrender, nervous system reset" }
        ],
        breathing: "Extended exhale breath: inhale 4 counts, exhale 8 counts throughout."
    },
    back_pain_relief: {
        name:      "Back Pain Relief Sequence",
        duration:  "20 minutes",
        level:     "gentle",
        poses:     [
            { name: "Cat-Cow",                             duration: "2 min",  benefit: "Mobilises spine gently" },
            { name: "Child's Pose",                        duration: "2 min",  benefit: "Decompresses lumbar spine" },
            { name: "Supine Knee to Chest",                duration: "1 min each side", benefit: "Stretches lower back" },
            { name: "Bridge Pose (low)",                   duration: "1 min",  benefit: "Strengthens lower back and glutes" },
            { name: "Supine Twist",                        duration: "2 min each side", benefit: "Releases paraspinal muscles" },
            { name: "Thread the Needle",                   duration: "1 min each side", benefit: "Piriformis and SI joint release" }
        ],
        breathing: "Breathe slowly and deeply. Never force a stretch into pain.",
        warning:   "⚠️ If back pain is severe, recent, or radiates down the leg, consult a doctor before exercising."
    },
    sleep_yoga: {
        name:      "Yoga Nidra Preparation (Pre-Sleep)",
        duration:  "15 minutes",
        level:     "all levels",
        poses:     [
            { name: "Reclined Butterfly (Supta Baddha Konasana)", duration: "3 min", benefit: "Hip opener, calming" },
            { name: "Legs Up Wall",                         duration: "5 min",  benefit: "Restorative, reduces insomnia" },
            { name: "Corpse Pose with body scan",           duration: "7 min",  benefit: "Full relaxation, sleep preparation" }
        ],
        breathing: "4-7-8 breathing throughout."
    }
};

function getYogaSession({ userId, goal, level = "beginner", durationPref }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "session_requested", { goal, level });

    let key = "beginner_morning";
    if (goal) {
        const g = goal.toLowerCase();
        if (g.includes("stress") || g.includes("anxiety") || g.includes("calm")) key = "stress_relief";
        else if (g.includes("back") || g.includes("spine"))                       key = "back_pain_relief";
        else if (g.includes("sleep") || g.includes("relax"))                      key = "sleep_yoga";
    }

    const session = YOGA_SESSIONS[key];
    const log     = load(userId, "yoga_log", []);
    log.push({ id: uid("yg"), session: key, date: NOW().slice(0, 10), at: NOW() });
    flush(userId, "yoga_log", log.slice(-1000));

    return ok(AGENT, {
        session: { key, ...session },
        totalSessionsLogged: log.length,
        available:           Object.keys(YOGA_SESSIONS),
        tip:                 "Props (blocks, straps, blanket) make yoga more accessible. Never push into pain.",
        safetyNote:          "If you have any medical condition, injury, or are pregnant, consult your doctor before starting yoga."
    });
}

module.exports = { getYogaSession };
