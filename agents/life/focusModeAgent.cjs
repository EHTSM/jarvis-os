/**
 * Focus Mode Agent — Pomodoro sessions and distraction-free work suggestions.
 */

const { uid, NOW, logToMemory, ok, fail } = require("./_lifeStore.cjs");

const TECHNIQUES = {
    pomodoro:    { workMin: 25, breakMin: 5,  longBreakMin: 15, sessionsBeforeLong: 4 },
    deep_work:   { workMin: 90, breakMin: 15, longBreakMin: 30, sessionsBeforeLong: 2 },
    "52-17":     { workMin: 52, breakMin: 17, longBreakMin: 30, sessionsBeforeLong: 3 },
    ultradian:   { workMin: 90, breakMin: 20, longBreakMin: 20, sessionsBeforeLong: 2 }
};

const DISTRACTION_BLOCKERS = [
    "Put phone in another room or use Focus mode",
    "Close unused browser tabs (each one costs 5-10% attention)",
    "Use noise-canceling headphones or white noise",
    "Set a 'Do Not Disturb' sign or message your team",
    "Work at the same time and place daily — location cues focus",
    "Close email & chat apps — check on fixed schedule only",
    "Use app blockers: Freedom, Cold Turkey, or Screen Time"
];

const ENVIRONMENT_TIPS = [
    "Set room temperature to 20-22°C — best for cognitive performance",
    "Drink water before starting — dehydration reduces concentration by 15%",
    "Have your task written on paper before sitting down",
    "Clear your desk — visual clutter increases cognitive load",
    "Natural light or daylight-spectrum lamp improves alertness"
];

function startSession({ technique = "pomodoro", task = "focused work", goals = [], userId = "default" }) {
    const config  = TECHNIQUES[technique] || TECHNIQUES.pomodoro;
    const session = {
        id:         uid("focus"),
        userId,
        technique,
        task,
        goals,
        config,
        plan: Array.from({ length: 4 }, (_, i) => {
            const isLong = (i + 1) % config.sessionsBeforeLong === 0;
            return {
                session: i + 1,
                work:    `${config.workMin} min focus`,
                break:   isLong ? `${config.longBreakMin} min long break` : `${config.breakMin} min break`
            };
        }),
        totalFocusMin: config.workMin * 4,
        distractionBlockers: DISTRACTION_BLOCKERS.slice(0, 4),
        environmentTips:     ENVIRONMENT_TIPS.slice(0, 3),
        startNow: `Start at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        createdAt: NOW()
    };

    logToMemory("focusModeAgent", `${userId}:${technique}`, { task, focusMin: session.totalFocusMin });
    return session;
}

function getProductivityTips() {
    return {
        cognitiveLoadTips: [
            "Single-task — multitasking reduces quality by 40%",
            "Eat the frog first: hardest task in your peak energy window",
            "Batch similar tasks together (email, calls, writing)",
            "Decision fatigue is real — make important choices before noon"
        ],
        recoveryTips: [
            "Real breaks mean no screens — walk, stretch, breathe",
            "Napping 10-20 min before 3pm boosts afternoon performance",
            "Hydrate every session — keep water at desk"
        ],
        distractionBlockers: DISTRACTION_BLOCKERS,
        environmentTips:     ENVIRONMENT_TIPS
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "focus_tips") {
            data = getProductivityTips();
        } else {
            data = startSession({ technique: p.technique || "pomodoro", task: p.task || "focused work", goals: p.goals || [], userId: p.userId || "default" });
        }
        return ok("focusModeAgent", data, ["One session at a time", "Focus follows systems, not willpower"]);
    } catch (err) { return fail("focusModeAgent", err.message); }
}

module.exports = { startSession, getProductivityTips, TECHNIQUES, run };
