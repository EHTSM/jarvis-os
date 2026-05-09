"use strict";
const { load, flush, uid, NOW, ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "fitnessMonitoringAgent";

const ACTIVITY_TYPES = ["walking","running","cycling","swimming","yoga","weight_training","hiit","sports","dancing","stretching","other"];

function logWorkout({ userId, activityType, durationMinutes, caloriesBurned, distanceKm, heartRateAvg, heartRateMax, notes = "" }) {
    if (!userId)           return fail(AGENT, "userId required");
    if (!activityType)     return fail(AGENT, "activityType required");
    if (!durationMinutes)  return fail(AGENT, "durationMinutes required");

    const type = (activityType || "other").toLowerCase().replace(/\s+/g, "_");

    accessLog(userId, AGENT, "workout_logged", { activityType, durationMinutes });

    // Estimate calories if not provided (rough MET values)
    const MET = { walking: 3.5, running: 9, cycling: 7, swimming: 7, yoga: 2.5, weight_training: 4, hiit: 10, sports: 6, dancing: 5, stretching: 2, other: 4 };
    const estCalories = caloriesBurned || Math.round((MET[type] || 4) * 70 * (durationMinutes / 60));

    const workout = {
        id:             uid("wk"),
        userId,
        activityType:   type,
        durationMinutes,
        caloriesBurned: estCalories,
        distanceKm:     distanceKm || null,
        heartRateAvg:   heartRateAvg || null,
        heartRateMax:   heartRateMax || null,
        notes,
        loggedAt:       NOW()
    };

    const log = load(userId, "fitness_log", []);
    log.push(workout);
    flush(userId, "fitness_log", log.slice(-2000));

    return ok(AGENT, {
        workout,
        message:       `${activityType} workout logged — ${durationMinutes} min, ~${estCalories} kcal burned.`
    });
}

function logDailySteps({ userId, steps, date }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "steps_logged", { steps });

    const d        = date || NOW().slice(0, 10);
    const stepLog  = load(userId, "step_log", {});
    const prev     = stepLog[d]?.steps || 0;
    stepLog[d]     = { steps: Math.max(steps, prev), date: d, loggedAt: NOW() };
    flush(userId, "step_log", stepLog);

    const goal    = 10000;
    const pct     = Math.round((steps / goal) * 100);
    return ok(AGENT, {
        date: d, steps,
        goal, percentComplete: pct,
        status: pct >= 100 ? "Goal reached! 🎉" : `${goal - steps} steps remaining to reach 10,000 step goal.`
    });
}

function getFitnessStats({ userId, days = 7 }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "stats_viewed");

    const log       = load(userId, "fitness_log", []);
    const since     = Date.now() - days * 86400000;
    const recent    = log.filter(w => new Date(w.loggedAt).getTime() > since);

    const totalCalories = recent.reduce((s, w) => s + w.caloriesBurned, 0);
    const totalMinutes  = recent.reduce((s, w) => s + w.durationMinutes, 0);
    const byType        = {};
    for (const w of recent) {
        byType[w.activityType] = (byType[w.activityType] || 0) + 1;
    }

    const stepLog  = load(userId, "step_log", {});
    const stepDays = Object.values(stepLog).filter(s => new Date(s.date).getTime() > since);
    const avgSteps = stepDays.length ? Math.round(stepDays.reduce((s, d) => s + d.steps, 0) / stepDays.length) : 0;

    return ok(AGENT, {
        period:          `Last ${days} days`,
        totalWorkouts:   recent.length,
        totalMinutes,
        totalCalories,
        averageStepsPerDay: avgSteps,
        activityBreakdown: byType,
        weeklyGoalStatus: {
            exerciseDays:   recent.length,
            targetDays:     5,
            onTrack:        recent.length >= Math.round(days * 5 / 7)
        }
    });
}

module.exports = { logWorkout, logDailySteps, getFitnessStats };
