/**
 * Habit Tracker Agent — track daily habits and streaks.
 */

const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_lifeStore.cjs");

const STORE = "habit-log";

function _today() { return new Date().toDateString(); }

function addHabit({ userId = "default", name, frequency = "daily", category = "health", target = 1 }) {
    if (!name) throw new Error("habit name required");
    const all = load(STORE, {});
    if (!all[userId]) all[userId] = { habits: [], logs: [] };

    const habit = { id: uid("habit"), name, frequency, category, target, streak: 0, bestStreak: 0, totalCompletions: 0, createdAt: NOW() };
    all[userId].habits.push(habit);
    flush(STORE, all);
    return habit;
}

function logHabit({ userId = "default", habitId, count = 1, note = "" }) {
    const all = load(STORE, {});
    if (!all[userId]) throw new Error("no habits found");

    const habit = all[userId].habits.find(h => h.id === habitId);
    if (!habit) throw new Error("habit not found");

    const today = _today();
    const log   = { id: uid("hlog"), habitId, count, note, date: today, loggedAt: NOW() };
    all[userId].logs.push(log);

    // update streak
    const recentLogs = all[userId].logs.filter(l => l.habitId === habitId);
    const yesterday  = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const hadYesterday = recentLogs.some(l => l.date === yesterday.toDateString());
    habit.streak     = hadYesterday ? habit.streak + 1 : 1;
    habit.bestStreak = Math.max(habit.streak, habit.bestStreak);
    habit.totalCompletions += count;

    flush(STORE, all);
    logToMemory("habitTrackerAgent", `${userId}:${habitId}`, { streak: habit.streak, total: habit.totalCompletions });
    return { log, streak: habit.streak, bestStreak: habit.bestStreak };
}

function getReport(userId = "default") {
    const all = load(STORE, {});
    if (!all[userId]?.habits?.length) return { userId, message: "No habits tracked yet.", empty: true };

    const today   = _today();
    const habits  = all[userId].habits.map(h => {
        const todayDone = (all[userId].logs || []).some(l => l.habitId === h.id && l.date === today);
        return { ...h, completedToday: todayDone };
    });

    const completedToday = habits.filter(h => h.completedToday).length;
    const totalHabits    = habits.length;
    const adherence      = +((completedToday / totalHabits) * 100).toFixed(0);

    return {
        userId,
        habits,
        today: { completed: completedToday, total: totalHabits, adherence: adherence + "%" },
        topStreak: habits.reduce((top, h) => h.streak > top.streak ? h : top, habits[0]),
        suggestions: [
            adherence < 50 ? "Focus on 1-3 core habits first — master before adding more." : "Great consistency! Consider adding a new challenge.",
            "Stack habits: do new habits right after existing ones.",
            "Track for 66 days to build a lasting habit."
        ]
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "habit_report") {
            data = getReport(p.userId || "default");
        } else if (task.type === "log_habit") {
            data = logHabit({ userId: p.userId || "default", habitId: p.habitId, count: p.count || 1, note: p.note || "" });
        } else {
            data = addHabit({ userId: p.userId || "default", name: p.name, frequency: p.frequency || "daily", category: p.category || "health", target: p.target || 1 });
        }
        return ok("habitTrackerAgent", data, ["Never miss twice", "Habits compound like interest"]);
    } catch (err) { return fail("habitTrackerAgent", err.message); }
}

module.exports = { addHabit, logHabit, getReport, run };
