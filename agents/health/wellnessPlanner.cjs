"use strict";
const { ok, fail, accessLog, load, flush, uid, NOW } = require("./_healthStore.cjs");

const AGENT = "wellnessPlanner";

function createWellnessPlan({ userId, goals = [], schedule = "7_days", focusAreas = [] }) {
    if (!userId) return fail(AGENT, "userId required");

    accessLog(userId, AGENT, "plan_created");

    const defaultGoals = goals.length ? goals : ["improve energy","better sleep","reduce stress","be more active"];
    const areas = focusAreas.length ? focusAreas : ["physical","mental","nutrition","sleep","social"];

    const pillars = {
        physical:   { habit: "30 minutes of movement daily (walk, yoga, gym)", frequency: "Daily", tip: "Start with 10 minutes and build up" },
        mental:     { habit: "10 minutes mindfulness or meditation", frequency: "Daily", tip: "Use breathing exercises during stressful moments" },
        nutrition:  { habit: "Eat 5 servings of vegetables/fruits daily, drink 8 glasses of water", frequency: "Daily", tip: "Prep meals in advance to avoid unhealthy defaults" },
        sleep:      { habit: "7-9 hours of sleep with consistent bed/wake times", frequency: "Daily", tip: "Wind-down routine: no screens 1 hour before bed" },
        social:     { habit: "Meaningful social connection at least 3x per week", frequency: "3x/week", tip: "A 15-minute call with a friend counts" },
        purpose:    { habit: "10 minutes of a hobby or passion activity", frequency: "Daily", tip: "This is not a luxury — purposeful activity is protective for mental health" },
        preventive: { habit: "Annual health check-up + dental visit", frequency: "Annual", tip: "Schedule it now — preventive care saves lives" }
    };

    const weeklySchedule = _buildWeeklySchedule(areas, pillars);

    const plan = {
        id:             uid("wlp"),
        userId,
        goals:          defaultGoals,
        focusAreas:     areas,
        pillars:        Object.fromEntries(areas.map(a => [a, pillars[a] || pillars.physical])),
        weeklySchedule,
        createdAt:      NOW()
    };

    const plans = load(userId, "wellness_plans", []);
    plans.push(plan);
    flush(userId, "wellness_plans", plans.slice(-10));

    return ok(AGENT, {
        plan,
        reminder: "Review your wellness plan weekly. Adjust what isn't working — small consistent actions beat perfect occasional ones.",
        quote:    "Health is not merely the absence of disease — it is a state of complete physical, mental, and social wellbeing. — WHO"
    });
}

function _buildWeeklySchedule(areas, pillars) {
    const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
    return days.map((day, i) => ({
        day,
        tasks: areas.map(a => {
            const p = pillars[a];
            return p ? `${a}: ${p.habit}` : `${a}: Continue daily practice`;
        }),
        rest: i === 6 ? "Rest day — focus on social connection and gratitude" : null
    }));
}

function logWellnessDay({ userId, date, completedPillars = [], mood = 5, notes = "" }) {
    if (!userId) return fail(AGENT, "userId required");

    accessLog(userId, AGENT, "wellness_day_logged");

    const d     = date || NOW().slice(0, 10);
    const entry = { id: uid("wl"), date: d, completedPillars, pillarsCount: completedPillars.length, mood, notes, loggedAt: NOW() };
    const log   = load(userId, "wellness_log", []);
    log.push(entry);
    flush(userId, "wellness_log", log.slice(-1000));

    const recent7 = log.slice(-7);
    const avgMood = +(recent7.reduce((s, e) => s + e.mood, 0) / recent7.length).toFixed(1);

    return ok(AGENT, {
        entry,
        weekAvgMood: avgMood,
        message: completedPillars.length >= 3
            ? `Great day! You completed ${completedPillars.length} wellness pillars.`
            : `You completed ${completedPillars.length} pillar(s) today. Progress over perfection.`
    });
}

module.exports = { createWellnessPlan, logWellnessDay };
