/**
 * Daily Planner Agent — generate structured daily schedules.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail } = require("./_lifeStore.cjs");

const SYSTEM = `You are a productivity expert. Create realistic, balanced daily schedules.
Respond ONLY with valid JSON.`;

const TIME_BLOCKS = {
    morning:   { start: "06:00", end: "09:00" },
    work:      { start: "09:00", end: "13:00" },
    afternoon: { start: "13:00", end: "17:00" },
    evening:   { start: "17:00", end: "21:00" },
    night:     { start: "21:00", end: "23:00" }
};

const TEMPLATES = {
    productive: [
        { time: "06:00", task: "Morning routine (water, stretch)", duration: 20, type: "self-care" },
        { time: "06:30", task: "Exercise", duration: 30, type: "health" },
        { time: "07:15", task: "Shower + breakfast", duration: 30, type: "self-care" },
        { time: "08:00", task: "Deep work block 1 (most important task)", duration: 90, type: "work" },
        { time: "09:30", task: "Emails & communication", duration: 30, type: "work" },
        { time: "10:00", task: "Deep work block 2", duration: 90, type: "work" },
        { time: "11:30", task: "Break + walk", duration: 15, type: "break" },
        { time: "12:00", task: "Lunch", duration: 45, type: "self-care" },
        { time: "13:00", task: "Meetings or admin tasks", duration: 90, type: "work" },
        { time: "14:30", task: "Learning / skill development", duration: 45, type: "growth" },
        { time: "15:15", task: "Deep work block 3", duration: 60, type: "work" },
        { time: "16:30", task: "Review + plan tomorrow", duration: 15, type: "work" },
        { time: "17:00", task: "Personal time / family", duration: 90, type: "personal" },
        { time: "18:30", task: "Dinner", duration: 45, type: "self-care" },
        { time: "20:00", task: "Reading / wind down", duration: 60, type: "growth" },
        { time: "22:00", task: "Sleep prep", duration: 30, type: "self-care" }
    ],
    balanced: [
        { time: "07:00", task: "Wake up + morning routine", duration: 30, type: "self-care" },
        { time: "07:30", task: "Breakfast", duration: 20, type: "self-care" },
        { time: "08:00", task: "Priority task 1", duration: 90, type: "work" },
        { time: "09:30", task: "Communication check", duration: 30, type: "work" },
        { time: "10:00", task: "Priority task 2", duration: 60, type: "work" },
        { time: "11:00", task: "Break", duration: 15, type: "break" },
        { time: "12:00", task: "Lunch break", duration: 60, type: "self-care" },
        { time: "13:00", task: "Admin / meetings", duration: 90, type: "work" },
        { time: "15:00", task: "Light tasks + emails", duration: 60, type: "work" },
        { time: "17:00", task: "Exercise or walk", duration: 45, type: "health" },
        { time: "18:00", task: "Dinner + family", duration: 90, type: "personal" },
        { time: "20:00", task: "Hobbies / relaxation", duration: 90, type: "personal" },
        { time: "22:00", task: "Wind down + sleep", duration: 30, type: "self-care" }
    ]
};

async function generate({ style = "balanced", tasks = [], wakeTime = "07:00", goals = [], userId = "" }) {
    const template = TEMPLATES[style] || TEMPLATES.balanced;

    let customSchedule = [...template];
    if (tasks.length) {
        const customTasks = tasks.map((t, i) => ({ time: `${10 + i}:00`, task: t, duration: 60, type: "custom" }));
        customSchedule = [...customTasks, ...template.filter(b => b.type !== "work").slice(0, 8)];
    }

    let aiInsights = null;
    try {
        const prompt = `Create a ${style} daily schedule for someone who wakes at ${wakeTime} with goals: ${goals.join(", ") || "general productivity"}.
Tasks to fit in: ${tasks.join(", ") || "standard workday"}.
JSON: { "priorityAdvice": "...", "energyMap": { "peak": "...", "low": "..." }, "tips": ["..."], "eveningRoutine": ["..."] }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
        aiInsights = groq.parseJson(raw);
    } catch { /* template only */ }

    const plan = {
        id:           uid("plan"),
        userId,
        date:         new Date().toDateString(),
        style,
        wakeTime,
        schedule:     customSchedule,
        totalWorkMin: customSchedule.filter(b => b.type === "work").reduce((s, b) => s + b.duration, 0),
        totalBreaks:  customSchedule.filter(b => b.type === "break").length,
        aiInsights,
        reminder:     "Treat your schedule like appointments — block time, protect it.",
        createdAt:    NOW()
    };

    logToMemory("dailyPlannerAgent", `${userId}:${style}`, { tasks: tasks.length });
    return plan;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await generate({ style: p.style || "balanced", tasks: p.tasks || [], wakeTime: p.wakeTime || "07:00", goals: p.goals || [], userId: p.userId || "" });
        return ok("dailyPlannerAgent", data, ["Plan the night before", "Time-block your deep work first"]);
    } catch (err) { return fail("dailyPlannerAgent", err.message); }
}

module.exports = { generate, TEMPLATES, run };
