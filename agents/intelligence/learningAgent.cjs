"use strict";
const { load, flush, uid, NOW, ok, fail, MAX_IDEAS, limitIdeas } = require("./_intelligenceStore.cjs");
const AGENT = "learningAgent";

const LESSON_CATEGORIES = {
    pattern:   "Recurring pattern detected across multiple sessions",
    principle: "General principle that holds across contexts",
    mistake:   "Failure mode to avoid in future reasoning",
    method:    "Effective technique or approach worth repeating",
    insight:   "Non-obvious realisation with lasting value"
};

const LEARNING_STYLES = {
    extractive: "Pull lessons directly from outputs",
    contrastive:"Learn by comparing successful vs failed attempts",
    generative: "Generate new knowledge by combining prior lessons"
};

function _extractLessons(pipelineOutput, goal) {
    const lessons = [];
    const { insights = [], validated = [], experiments = [], reasoning = "" } = pipelineOutput;

    // Lesson from validation
    if (validated.length) {
        lessons.push({
            id:       uid("les"),
            category: "pattern",
            lesson:   `For goal type "${goal}": ${validated.length} of ${Math.max(validated.length, 2)} ideas survived validation — quality inputs matter more than quantity.`,
            confidence: 0.75,
            source:   "validation_results"
        });
    }

    // Lesson from experiments
    const topExp = experiments.find(e => (e.simulatedScore || 0) >= 60);
    if (topExp) {
        lessons.push({
            id:       uid("les"),
            category: "insight",
            lesson:   `High-scoring experiments share: structured hypotheses, clear mechanisms, and measurable outcomes. Replicate this pattern.`,
            confidence: 0.80,
            source:   "experiment_results"
        });
    }

    // Lesson from reasoning
    if (reasoning && reasoning.length > 50) {
        lessons.push({
            id:       uid("les"),
            category: "method",
            lesson:   `Effective reasoning for goals like "${goal}" uses multi-modal analysis (logical + creative + critical) to reduce blind spots.`,
            confidence: 0.70,
            source:   "reasoning_analysis"
        });
    }

    // Default lesson if nothing extracted
    if (!lessons.length) {
        lessons.push({
            id:       uid("les"),
            category: "principle",
            lesson:   `Goal "${goal}" processed. Principle: always decompose complex goals into first principles before generating ideas.`,
            confidence: 0.60,
            source:   "default_extraction"
        });
    }

    return limitIdeas(lessons);
}

function extractLessons({ userId, goal, pipelineOutput = {} }) {
    if (!userId || !goal) return fail(AGENT, "userId and goal required");

    const lessons    = _extractLessons(pipelineOutput, goal);
    const history    = load(userId, "lesson_history", []);
    const allLessons = history.flatMap(h => h.lessons || []);

    // Avoid duplicate lessons
    const unique = lessons.filter(l => !allLessons.some(existing => existing.lesson === l.lesson));

    history.push({ goal, count: unique.length, lessons: unique, createdAt: NOW() });
    flush(userId, "lesson_history", history.slice(-200));

    return ok(AGENT, {
        goal,
        extracted:   unique.length,
        lessons:     unique,
        totalLessons: allLessons.length + unique.length,
        recommendation: unique.length ? `${unique.length} new lesson(s) stored — memory will improve future pipeline runs` : "No new lessons — similar goal processed before"
    });
}

function getLessonLibrary({ userId, category, limit = 20 }) {
    if (!userId) return fail(AGENT, "userId required");

    const history = load(userId, "lesson_history", []);
    let   lessons = history.flatMap(h => h.lessons || []);
    if (category) lessons = lessons.filter(l => l.category === category);

    return ok(AGENT, {
        total:    lessons.length,
        lessons:  lessons.slice(-limit).reverse(),
        categories: Object.entries(LESSON_CATEGORIES).map(([k,v]) => ({ key:k, description:v }))
    });
}

function applyLessons({ userId, goal }) {
    if (!userId || !goal) return fail(AGENT, "userId and goal required");

    const history    = load(userId, "lesson_history", []);
    const allLessons = history.flatMap(h => h.lessons || []);
    const g          = goal.toLowerCase();

    // Find relevant lessons
    const relevant = allLessons.filter(l => l.lesson.toLowerCase().includes(g.split(" ")[0]) || l.confidence >= 0.75).slice(0, MAX_IDEAS);

    return ok(AGENT, {
        goal,
        relevantLessons: relevant.length,
        lessons:         relevant,
        note:            relevant.length ? `${relevant.length} prior lesson(s) apply to this goal — apply them to improve pipeline quality` : "No prior lessons found — this is a fresh topic"
    });
}

module.exports = { extractLessons, getLessonLibrary, applyLessons };
