"use strict";
const { load, NOW, ok, fail, accessLog, DISCLAIMER } = require("./_healthStore.cjs");

const AGENT = "healthReportGenerator";

function generateReport({ userId, reportType = "weekly_summary", includePrivateData = false }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "report_generated", { reportType });

    const profile      = load(userId, "health_profile", {});
    const riskHistory  = load(userId, "risk_assessments", []).slice(-3);
    const symptoms     = load(userId, "symptoms", []).slice(-20);
    const fitness      = load(userId, "fitness_log", []).slice(-30);
    const sleepLog     = load(userId, "sleep_log", []).slice(-14);
    const moodLog      = load(userId, "mood_log", []).slice(-14);
    const appointments = load(userId, "appointments", []).filter(a => a.status === "scheduled");
    const medications  = load(userId, "medication_reminders", []).filter(m => m.active);
    const meals        = load(userId, "meal_log", []).slice(-14);
    const stressLog    = load(userId, "stress_log", []).slice(-5);

    // Fitness analysis
    const fitnessWeekly = fitness.filter(f => {
        const d = new Date(f.loggedAt || 0);
        return Date.now() - d.getTime() < 7 * 86400000;
    });
    const avgSleep   = sleepLog.length ? +(sleepLog.reduce((s,e) => s + e.hoursSlept, 0) / sleepLog.length).toFixed(1) : null;
    const avgMood    = moodLog.length ? +(moodLog.reduce((s,e) => s + e.moodRating, 0) / moodLog.length).toFixed(1) : null;
    const avgStress  = stressLog.length ? +(stressLog.reduce((s,e) => s + e.scaledScore, 0) / stressLog.length).toFixed(0) : null;

    // Risk summary
    const latestRisk    = riskHistory.slice(-1)[0] || null;
    const recentHigh    = symptoms.filter(s => s.riskLevel === "HIGH");
    const avgCalories   = meals.length ? Math.round(meals.reduce((s,m) => s + (m.totals?.calories || 0), 0) / meals.length) : null;

    const report = {
        id:            `RPT-${Date.now().toString(36)}`,
        userId,
        generatedAt:   NOW(),
        reportType,
        disclaimer:    DISCLAIMER,

        profile: {
            bloodGroup:         profile.bloodGroup || "Not set",
            allergies:          profile.allergies  || [],
            chronicConditions:  profile.chronicConditions || [],
            emergencyContact:   includePrivateData ? profile.emergencyContact : "Hidden for privacy"
        },

        healthMetrics: {
            latestRiskLevel:    latestRisk?.riskLevel || "Not assessed",
            latestRiskScore:    latestRisk?.riskScore ?? null,
            highRiskSymptoms:   recentHigh.length,
            currentMedications: medications.length
        },

        fitness: {
            workoutsThisWeek:  fitnessWeekly.length,
            totalMinutes:      fitnessWeekly.reduce((s,f) => s + f.durationMinutes, 0),
            caloriesBurned:    fitnessWeekly.reduce((s,f) => s + f.caloriesBurned, 0)
        },

        nutrition: {
            mealsLogged:      meals.length,
            avgDailyCalories: avgCalories
        },

        sleep: {
            logsCount:  sleepLog.length,
            avgHours:   avgSleep,
            quality:    sleepLog.length
                ? +(sleepLog.reduce((s,e) => s + e.quality, 0) / sleepLog.length).toFixed(1)
                : null
        },

        mentalHealth: {
            avgMoodRating: avgMood,
            avgStressScore: avgStress,
            moodLogs:      moodLog.length
        },

        upcomingAppointments: appointments.slice(0, 5),

        recommendations: _generateRecommendations({ latestRisk, avgSleep, avgMood, avgStress, fitnessWeekly, recentHigh })
    };

    return ok(AGENT, report);
}

function _generateRecommendations({ latestRisk, avgSleep, avgMood, avgStress, fitnessWeekly, recentHigh }) {
    const recs = [];
    if (latestRisk?.riskLevel === "HIGH")        recs.push("⚠️ High health risk detected — please consult a doctor");
    if (avgSleep && avgSleep < 7)                recs.push("Improve sleep — aim for 7-9 hours. Review sleep hygiene tips.");
    if (avgMood && avgMood < 5)                  recs.push("Low mood detected — consider speaking to a mental health professional");
    if (avgStress && avgStress > 25)             recs.push("High stress levels — add mindfulness or breathing exercises daily");
    if (fitnessWeekly.length < 3)                recs.push("Increase physical activity — aim for at least 3-5 workouts per week");
    if (recentHigh.length > 0)                   recs.push(`${recentHigh.length} high-risk symptom check(s) in recent period — please follow up with a doctor`);
    if (!recs.length)                             recs.push("Health metrics look balanced. Keep up your current routine!");
    return recs;
}

module.exports = { generateReport };
