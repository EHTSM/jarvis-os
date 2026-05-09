"use strict";
const { load, flush, uid, NOW, ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "habitRecoveryAgent";

function createHabitPlan({ userId, habitToBreak, trigger, replacement, motivation }) {
    if (!userId || !habitToBreak) return fail(AGENT, "userId and habitToBreak required");

    accessLog(userId, AGENT, "habit_plan_created", { habitToBreak: habitToBreak.slice(0, 50) });

    const strategies = [
        "Make the habit harder to do (increase friction): remove cues, don't buy the item, delete the app",
        `Replace the habit with a positive alternative: ${replacement || "walk, deep breath, drink water, or call someone"}`,
        "Track your streak — don't break the chain",
        "Identify your specific trigger: ${trigger || 'time of day, emotion, location, or social context'} and plan around it",
        "Use implementation intentions: 'When X happens, I will do Y instead'",
        "Tell one supportive person about your goal — accountability increases success by 65%",
        "Expect setbacks — a lapse is not a relapse. Get back on track immediately without harsh self-judgment",
        "Reward small wins: every 7-day streak earns a meaningful reward"
    ];

    const plan = {
        id:           uid("hab"),
        userId,
        habitToBreak,
        trigger:      trigger || "Not identified yet",
        replacement:  replacement || "Deep breathing or 5-minute walk",
        motivation:   motivation || "Improved health and wellbeing",
        strategies,
        startDate:    NOW().slice(0, 10),
        createdAt:    NOW()
    };

    const plans = load(userId, "habit_plans", []);
    plans.push(plan);
    flush(userId, "habit_plans", plans.slice(-50));
    return ok(AGENT, plan);
}

function logHabitDay({ userId, planId, success, notes = "" }) {
    if (!userId || !planId) return fail(AGENT, "userId and planId required");

    accessLog(userId, AGENT, "habit_day_logged", { success });

    const log   = load(userId, `habit_log_${planId}`, []);
    const entry = { date: NOW().slice(0, 10), success: !!success, notes, loggedAt: NOW() };
    log.push(entry);
    flush(userId, `habit_log_${planId}`, log.slice(-500));

    const streak     = log.slice().reverse().reduce((s, e) => e.success ? s + 1 : 0, 0);
    const successRate = log.length ? Math.round(log.filter(e => e.success).length / log.length * 100) : 0;

    const message = success
        ? streak >= 21 ? `⭐ Excellent! ${streak}-day streak — new habit is forming!`
          : streak >= 7 ? `🔥 ${streak}-day streak! Keep going!`
          : `Day logged! Streak: ${streak}`
        : "Tough day — that's okay. Every attempt builds resilience. Start fresh tomorrow.";

    return ok(AGENT, { entry, streak, successRate, message });
}

function getHabitProgress({ userId, planId }) {
    if (!userId || !planId) return fail(AGENT, "userId and planId required");
    accessLog(userId, AGENT, "habit_progress_viewed");
    const log = load(userId, `habit_log_${planId}`, []);
    const streak = log.slice().reverse().reduce((s, e) => e.success ? s + 1 : 0, 0);
    const successDays = log.filter(e => e.success).length;
    return ok(AGENT, {
        totalDays: log.length, successDays, streak,
        successRate: log.length ? Math.round(successDays / log.length * 100) : 0,
        milestone: streak >= 66 ? "🏆 66-day milestone — habit is neurologically established!"
                 : streak >= 21 ? "🌟 21-day milestone — habit is forming!"
                 : `${66 - streak} days to habit formation milestone`
    });
}

module.exports = { createHabitPlan, logHabitDay, getHabitProgress };
