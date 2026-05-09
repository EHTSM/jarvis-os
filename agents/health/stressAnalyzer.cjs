"use strict";
const { load, flush, uid, NOW, ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "stressAnalyzer";

// PSS-10 inspired questions (simplified, educational only)
const STRESS_QUESTIONS = [
    "How often have you felt unable to control important things in your life?",
    "How often have you felt nervous and stressed?",
    "How often have you felt confident in your ability to handle personal problems?",
    "How often have you felt that things were going your way?",
    "How often have you felt difficulties were piling up so high that you could not overcome them?",
    "How often have you been upset because of something unexpected?",
    "How often have you been able to control irritations in your life?",
    "How often have you felt on top of things?"
];

// Scores 0-4 for each question (0=never, 4=very often)
// Questions 3,4,7,8 are positive (reversed scoring)
const POSITIVE_Q = [2, 3, 6, 7]; // 0-indexed

const STRESS_BANDS = [
    { max: 13, level: "LOW",    label: "Low stress",      color: "green",  description: "You are managing stress well. Keep up your current practices." },
    { max: 26, level: "MEDIUM", label: "Moderate stress", color: "yellow", description: "You are experiencing moderate stress. Consider adding stress management practices." },
    { max: 40, level: "HIGH",   label: "High stress",     color: "red",    description: "High stress levels detected. Please speak with a mental health professional." }
];

function analyzeStress({ userId, scores, source = "self_report" }) {
    if (!userId)                          return fail(AGENT, "userId required");
    if (!scores || scores.length < 4)    return fail(AGENT, "At least 4 stress score values (0-4 each) required");

    accessLog(userId, AGENT, "stress_analyzed");

    const capped = scores.slice(0, 8).map(s => Math.max(0, Math.min(4, Number(s) || 0)));
    let total = 0;
    capped.forEach((s, i) => {
        total += POSITIVE_Q.includes(i) ? (4 - s) : s;
    });

    // Scale to 0-40
    const scaled = Math.round((total / (capped.length * 4)) * 40);
    const band   = STRESS_BANDS.find(b => scaled <= b.max) || STRESS_BANDS[2];

    const strategies = {
        LOW:    ["Maintain your current routine","Continue regular exercise and sleep schedule","Practice gratitude journaling"],
        MEDIUM: ["Add 10 min daily mindfulness or meditation","Prioritise tasks — drop or delegate low-priority items","Ensure 7-8 hours of sleep","Take short breaks during work (Pomodoro technique)","Reduce caffeine intake after 2pm"],
        HIGH:   ["⚠️ Strongly consider speaking to a therapist or counsellor","Reduce workload if possible","Daily stress diary to identify triggers","Progressive muscle relaxation before bed","Consider a mental health day","iCall helpline: 9152987821"]
    };

    const record = {
        id:         uid("st"),
        userId,
        rawScores:  capped,
        scaledScore: scaled,
        stressLevel: band.level,
        source,
        assessedAt: NOW()
    };

    const hist = load(userId, "stress_log", []);
    hist.push(record);
    flush(userId, "stress_log", hist.slice(-200));

    return ok(AGENT, {
        stressScore:   scaled,
        maxScore:      40,
        stressLevel:   band.level,
        label:         band.label,
        description:   band.description,
        strategies:    strategies[band.level],
        trend:         hist.length >= 3
            ? `Your last 3 scores: ${hist.slice(-3).map(h => h.scaledScore).join(", ")}`
            : "Complete more assessments to see your stress trend",
        questions:     STRESS_QUESTIONS,
        note:          "This is a screening tool only. Not a clinical assessment. Consult a mental health professional for diagnosis."
    }, { riskLevel: band.level });
}

function getStressHistory({ userId, limit = 10 }) {
    if (!userId) return fail(AGENT, "userId required");
    return ok(AGENT, load(userId, "stress_log", []).slice(-limit).reverse());
}

module.exports = { analyzeStress, getStressHistory };
