"use strict";
/**
 * Health Dashboard — aggregates all health metrics into a single overview.
 * Pulls from: symptoms, fitness, sleep, mood, risk assessments, wearable data.
 */
const { load, NOW, ok, fail, accessLog, DISCLAIMER } = require("./_healthStore.cjs");

const AGENT = "healthDashboard";

function getDashboard({ userId, days = 7 }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "dashboard_viewed");

    const since   = Date.now() - days * 86400000;
    const _recent = (arr) => arr.filter(e => new Date(e.loggedAt || e.checkedAt || e.assessedAt || e.date || 0).getTime() > since);

    // Aggregate from all health data stores
    const symptoms   = _recent(load(userId, "symptoms",          []));
    const fitness    = _recent(load(userId, "fitness_log",       []));
    const meals      = _recent(load(userId, "meal_log",          []));
    const moodLog    = _recent(load(userId, "mood_log",          []));
    const sleepLog   = _recent(load(userId, "sleep_log",         []));
    const medLog     = _recent(load(userId, "meditation_log",    []));
    const wearable   = _recent(load(userId, "wearable_log",      []));
    const riskHist   = load(userId, "risk_assessments", []).slice(-1);
    const appts      = load(userId, "appointments",     []).filter(a => a.status === "scheduled" && a.date >= NOW().slice(0,10));
    const profile    = load(userId, "health_profile",   {});

    // Fitness summary
    const totalCalBurned = fitness.reduce((s, w) => s + (w.caloriesBurned || 0), 0);
    const totalWorkoutMin = fitness.reduce((s, w) => s + (w.durationMinutes || 0), 0);

    // Nutrition summary
    const totalCalIn  = meals.reduce((s, m) => s + (m.totals?.calories || 0), 0);
    const avgCalPerDay = meals.length ? Math.round(totalCalIn / days) : 0;

    // Sleep summary
    const avgSleep   = sleepLog.length
        ? +(sleepLog.reduce((s, e) => s + e.hoursSlept, 0) / sleepLog.length).toFixed(1)
        : null;
    const avgQuality = sleepLog.length
        ? +(sleepLog.reduce((s, e) => s + e.quality, 0) / sleepLog.length).toFixed(1)
        : null;

    // Mood summary
    const avgMood    = moodLog.length
        ? +(moodLog.reduce((s, e) => s + e.moodRating, 0) / moodLog.length).toFixed(1)
        : null;

    // Latest risk
    const latestRisk = riskHist[0] || null;

    // Latest wearable
    const latestWearable = wearable[wearable.length - 1] || null;

    // Symptom flags
    const highRiskSymptoms = symptoms.filter(s => s.riskLevel === "HIGH");

    // Wellness score (0-100 composite)
    let wellnessScore  = 50; // baseline
    if (fitness.length >= 3) wellnessScore += 10;
    if (avgSleep && avgSleep >= 7)  wellnessScore += 10;
    if (avgMood && avgMood >= 6)    wellnessScore += 10;
    if (medLog.length >= 3)          wellnessScore += 5;
    if (highRiskSymptoms.length)     wellnessScore -= 15;
    if (latestRisk?.riskLevel === "HIGH") wellnessScore -= 10;
    wellnessScore = Math.max(0, Math.min(100, wellnessScore));

    return ok(AGENT, {
        period:   `Last ${days} days`,
        profile:  { bloodGroup: profile.bloodGroup, allergies: profile.allergies, conditions: profile.chronicConditions },
        wellness: { score: wellnessScore, label: wellnessScore >= 70 ? "Good" : wellnessScore >= 50 ? "Moderate" : "Needs Attention" },
        fitness:  { workouts: fitness.length, totalMinutes: totalWorkoutMin, caloriesBurned: totalCalBurned },
        nutrition:{ mealsLogged: meals.length, avgCaloriesPerDay: avgCalPerDay },
        sleep:    { logsCount: sleepLog.length, avgHours: avgSleep, avgQuality },
        mentalHealth: { moodLogs: moodLog.length, avgMood, meditationSessions: medLog.length },
        symptoms: { recentChecks: symptoms.length, highRiskFlags: highRiskSymptoms.length },
        latestRisk: latestRisk ? { level: latestRisk.riskLevel, score: latestRisk.riskScore } : null,
        wearable:   latestWearable ? { date: latestWearable.date, alerts: latestWearable.alerts?.length || 0 } : null,
        upcomingAppointments: appts.slice(0, 5),
        generatedAt: NOW()
    });
}

module.exports = { getDashboard };
