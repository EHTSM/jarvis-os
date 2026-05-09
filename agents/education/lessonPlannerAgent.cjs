/**
 * Lesson Planner Agent — creates daily/weekly study plans based on goal + time budget.
 */

const groq = require("../core/groqClient.cjs");
const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_eduStore.cjs");

const SYSTEM = `You are an expert learning coach. Create realistic, achievable study schedules.
Respond ONLY with valid JSON.`;

const STORE = "lesson-plans";

const INTENSITY = {
    light:    { hoursPerDay: 1,   daysPerWeek: 3, sessionsPerDay: 1 },
    moderate: { hoursPerDay: 2,   daysPerWeek: 5, sessionsPerDay: 2 },
    intense:  { hoursPerDay: 4,   daysPerWeek: 6, sessionsPerDay: 3 }
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function _buildWeekTemplate(goal, topic, intensity) {
    const cfg     = INTENSITY[intensity] || INTENSITY.moderate;
    const activeDays = DAYS.slice(0, cfg.daysPerWeek);

    return activeDays.map((day, i) => ({
        day,
        sessions: Array.from({ length: cfg.sessionsPerDay }, (_, j) => ({
            time:     j === 0 ? "Morning (8-9am)" : j === 1 ? "Afternoon (2-3pm)" : "Evening (7-8pm)",
            duration: `${Math.round(cfg.hoursPerDay / cfg.sessionsPerDay * 60)} min`,
            activity: j === 0 ? `Study: ${topic} — Module ${Math.floor(i / 2) + 1}` : j === 1 ? `Practice exercises for ${topic}` : "Review + flashcard revision",
            type:     j === 0 ? "learning" : j === 1 ? "practice" : "review"
        })),
        totalHours: cfg.hoursPerDay,
        milestone:  i === activeDays.length - 1 ? `Weekly review: test yourself on ${topic}` : null
    }));
}

async function create({ goal, topic, availableHoursPerDay = 2, intensity = "moderate", weeks = 4, userId = "" }) {
    if (!goal && !topic) throw new Error("goal or topic required");
    const subject = topic || goal;

    const weekPlan = _buildWeekTemplate(subject, subject, intensity);
    const cfg      = INTENSITY[intensity] || INTENSITY.moderate;

    let plan = {
        id:          uid("plan"),
        goal,
        topic:       subject,
        intensity,
        weeks,
        daysPerWeek: cfg.daysPerWeek,
        hoursPerDay: availableHoursPerDay,
        totalHours:  availableHoursPerDay * cfg.daysPerWeek * weeks,
        weeklyPlan:  weekPlan,
        milestones: Array.from({ length: weeks }, (_, i) => ({
            week:      i + 1,
            target:    `Complete Module ${i + 1} of ${subject}`,
            checkpoint: `Week ${i + 1} quiz on ${subject}`
        })),
        tips: [
            "Study at the same time each day to build habit",
            "Use Pomodoro technique: 25 min study + 5 min break",
            "Review previous day's notes for 5 minutes before new session",
            "Test yourself every Friday — retrieval practice beats re-reading"
        ],
        userId,
        createdAt: NOW()
    };

    try {
        const prompt = `Create a ${weeks}-week study plan for "${goal || topic}" with ${availableHoursPerDay}h/day, ${intensity} intensity.
JSON: { "weeklyTheme": ["week1 theme","week2 theme"], "dailySchedule": [{"day":"Mon","sessions":[{"time":"...","activity":"...","duration":"..."}]}], "progressMilestones": ["..."], "studyTechniques": ["..."] }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 900 });
        const ai   = groq.parseJson(raw);
        plan       = { ...plan, aiSchedule: ai };
    } catch { /* template only */ }

    const all = load(STORE, []);
    all.push(plan);
    flush(STORE, all.slice(-50));
    logToMemory("lessonPlannerAgent", goal || topic, { weeks, intensity, totalHours: plan.totalHours });

    return plan;
}

function getUserPlan(userId) { return load(STORE, []).filter(p => p.userId === userId); }

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await create({
            goal:                p.goal || task.input || "",
            topic:               p.topic || p.subject || "",
            availableHoursPerDay: p.hours || p.hoursPerDay || 2,
            intensity:           p.intensity || "moderate",
            weeks:               p.weeks || 4,
            userId:              p.userId || ""
        });
        return ok("lessonPlannerAgent", data, ["Set a daily reminder to follow this plan", "Generate flashcards for each module"]);
    } catch (err) { return fail("lessonPlannerAgent", err.message); }
}

module.exports = { create, getUserPlan, run };
