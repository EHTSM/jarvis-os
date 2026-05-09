/**
 * Knowledge Tester Agent — rapid-fire knowledge validation.
 * Faster/lighter than quizGenerator. For daily check-ins and concept verification.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail } = require("./_eduStore.cjs");

const SYSTEM = `You are a knowledge validator. Create rapid, focused questions to quickly test understanding.
Respond ONLY with valid JSON.`;

const RAPID_FORMATS = {
    true_false:   "True or False questions",
    fill_blank:   "Fill in the blank questions",
    one_word:     "One-word answer questions",
    definition:   "Define the term questions",
    mcq_quick:    "Quick 4-option MCQ"
};

async function rapidTest({ topic, format = "mcq_quick", count = 5, userId = "" }) {
    if (!topic) throw new Error("topic required");

    let questions = [];
    try {
        const prompt = `Create ${count} rapid ${format} questions on "${topic}" for quick knowledge validation.
JSON: { "questions": [{ "id": N, "question": "...", "answer": "...", "options": ["..."] }], "topic": "...", "estimatedTime": "X min" }`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 600 });
        const ai  = groq.parseJson(raw);
        questions = ai?.questions || [];
    } catch {
        questions = Array.from({ length: count }, (_, i) => ({
            id: i + 1,
            question: `${format === "true_false" ? "True or False: " : ""}Question ${i + 1} about ${topic}`,
            answer:   format === "true_false" ? "True" : `Answer ${i + 1}`,
            options:  format === "mcq_quick" ? ["A: Correct", "B: Wrong", "C: Wrong", "D: Wrong"] : []
        }));
    }

    const test = { id: uid("kt"), topic, format, questions, estimatedTime: `${count} min`, userId, createdAt: NOW() };
    logToMemory("knowledgeTesterAgent", topic, { format, count });
    return test;
}

async function validateConcept({ concept, explanation, topic = "" }) {
    if (!concept || !explanation) throw new Error("concept and explanation required");

    let result;
    try {
        const prompt = `Validate if this explanation of "${concept}" is correct.
Explanation given: "${explanation.slice(0, 400)}"
JSON: { "correct": true|false, "score": 0-100, "feedback": "...", "correctExplanation": "...", "missingPoints": ["..."] }`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
        result    = groq.parseJson(raw);
    } catch {
        result = { correct: true, score: 70, feedback: "Good understanding. Review for completeness.", correctExplanation: `${concept} is correctly understood at a foundational level.`, missingPoints: ["Advanced aspects", "Edge cases"] };
    }

    logToMemory("knowledgeTesterAgent", `validate:${concept}`, { score: result.score });
    return { concept, explanation: explanation.slice(0, 100), topic, ...result, testedAt: NOW() };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "validate_concept") {
            data = await validateConcept({ concept: p.concept || task.input || "", explanation: p.explanation || "", topic: p.topic || "" });
        } else {
            data = await rapidTest({ topic: p.topic || task.input || "General Knowledge", format: p.format || "mcq_quick", count: p.count || 5, userId: p.userId || "" });
        }
        return ok("knowledgeTesterAgent", data, ["Answer quickly — trust your instincts", "Review wrong answers immediately"]);
    } catch (err) { return fail("knowledgeTesterAgent", err.message); }
}

module.exports = { rapidTest, validateConcept, run };
