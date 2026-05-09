/**
 * Goal Tracker Agent — set and track daily/weekly/monthly goals.
 */

const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_lifeStore.cjs");

const STORE = "goal-log";

function setGoal({ userId = "default", title, description = "", category = "personal", frequency = "weekly", target, deadline }) {
    if (!title) throw new Error("goal title required");
    const all = load(STORE, {});
    if (!all[userId]) all[userId] = { goals: [] };

    const goal = {
        id:          uid("goal"),
        userId,
        title,
        description,
        category,
        frequency,
        target:      target || 1,
        progress:    0,
        status:      "active",
        milestones:  [],
        deadline:    deadline || null,
        createdAt:   NOW(),
        updatedAt:   NOW()
    };

    all[userId].goals.push(goal);
    flush(STORE, all);
    logToMemory("goalTrackerAgent", `${userId}:set`, { title, frequency });
    return goal;
}

function updateProgress({ userId = "default", goalId, progress, note = "" }) {
    const all  = load(STORE, {});
    const goal = all[userId]?.goals?.find(g => g.id === goalId);
    if (!goal) throw new Error("goal not found");

    const prev     = goal.progress;
    goal.progress  = progress;
    goal.updatedAt = NOW();

    if (note) goal.milestones.push({ note, progress, date: NOW() });

    if (goal.progress >= goal.target)  goal.status = "completed";
    else if (goal.deadline && new Date(goal.deadline) < new Date()) goal.status = "overdue";

    flush(STORE, all);
    logToMemory("goalTrackerAgent", `${userId}:update`, { goalId, prev, progress });
    return { goal, delta: progress - prev, pct: +((progress / goal.target) * 100).toFixed(0) + "%" };
}

function getGoals(userId = "default", status = null) {
    const all   = load(STORE, {});
    let   goals = all[userId]?.goals || [];

    if (status) goals = goals.filter(g => g.status === status);

    const active    = goals.filter(g => g.status === "active").length;
    const completed = goals.filter(g => g.status === "completed").length;
    const overdue   = goals.filter(g => g.status === "overdue").length;

    return {
        userId,
        goals,
        summary:  { total: goals.length, active, completed, overdue },
        successRate: goals.length ? +((completed / goals.length) * 100).toFixed(0) + "%" : "0%",
        suggestions: [
            active > 5 ? "Focus on fewer goals — 3-5 active goals is the sweet spot." : "Good number of active goals.",
            overdue    ? `${overdue} goal(s) overdue — revisit deadlines or break into smaller steps.` : "No overdue goals. Keep it up!",
            "Review goals weekly and celebrate small wins."
        ]
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "goal_report") {
            data = getGoals(p.userId || "default", p.status || null);
        } else if (task.type === "update_goal") {
            data = updateProgress({ userId: p.userId || "default", goalId: p.goalId, progress: p.progress, note: p.note || "" });
        } else {
            data = setGoal({ userId: p.userId || "default", title: p.title, description: p.description, category: p.category, frequency: p.frequency, target: p.target, deadline: p.deadline });
        }
        return ok("goalTrackerAgent", data, ["Write goals down — that alone doubles follow-through", "Review every Sunday"]);
    } catch (err) { return fail("goalTrackerAgent", err.message); }
}

module.exports = { setGoal, updateProgress, getGoals, run };
