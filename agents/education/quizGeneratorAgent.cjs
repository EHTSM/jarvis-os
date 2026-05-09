/**
 * Quiz Generator Agent — MCQ, subjective, and coding quizzes with difficulty levels.
 * Auto-updates skillTrackerAgent on completion.
 */

const groq = require("../core/groqClient.cjs");
const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_eduStore.cjs");

const SYSTEM = `You are an expert quiz designer. Create accurate, educational quizzes.
Respond ONLY with valid JSON.`;

const STORE = "quizzes";

const MCQ_TEMPLATES = {
    easy: (topic) => ([
        { q: `What is the primary purpose of ${topic}?`, options: ["A: Core function", "B: Alternative use", "C: Common misconception", "D: Unrelated concept"], answer: "A", explanation: `${topic} primarily serves as the core function in its domain.` },
        { q: `Which of the following best describes ${topic}?`, options: ["A: Correct definition", "B: Partial definition", "C: Wrong definition", "D: Irrelevant description"], answer: "A", explanation: "Option A captures the complete and accurate definition." }
    ]),
    medium: (topic) => ([
        { q: `In ${topic}, what happens when you apply concept X to scenario Y?`, options: ["A: Expected result", "B: Common mistake", "C: Edge case result", "D: Completely wrong"], answer: "A", explanation: "Applying X to Y produces the expected result because of the underlying principle." },
        { q: `Which approach is most efficient for ${topic}?`, options: ["A: Optimal approach", "B: Acceptable but slow", "C: Incorrect approach", "D: Anti-pattern"], answer: "A", explanation: "The optimal approach minimizes time and resource complexity." }
    ]),
    hard: (topic) => ([
        { q: `What is the time complexity of the optimal ${topic} algorithm?`, options: ["A: O(n log n)", "B: O(n²)", "C: O(n)", "D: O(log n)"], answer: "A", explanation: "The optimal solution achieves O(n log n) through divide and conquer." },
        { q: `In edge case E, how should ${topic} behave?`, options: ["A: Handle gracefully", "B: Throw error", "C: Return null", "D: Loop infinitely"], answer: "A", explanation: "Edge cases must be handled gracefully to maintain system stability." }
    ])
};

async function generate({ topic, difficulty = "medium", type = "mcq", count = 5, userId = "" }) {
    if (!topic) throw new Error("topic required");

    let questions = [];

    try {
        const typeInstructions = {
            mcq:        `${count} MCQ questions with 4 options (A-D), correct answer, and explanation.`,
            subjective: `${count} open-ended questions with model answers and key points to cover.`,
            coding:     `${count} coding problems with problem statement, sample input/output, and solution approach.`,
            mixed:      `Mix of MCQ (60%), subjective (30%), coding (10%) — ${count} questions total.`
        };

        const prompt = `Create a ${difficulty} ${type} quiz on "${topic}". ${typeInstructions[type] || typeInstructions.mcq}
JSON: { "questions": [{ "id": 1, "type": "mcq|subjective|coding", "question": "...", "options": ["A:...","B:...","C:...","D:..."], "answer": "A", "explanation": "...", "points": 2, "timeLimit": 60 }] }`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 1200 });
        const ai  = groq.parseJson(raw);
        questions = ai?.questions || [];
    } catch {
        questions = MCQ_TEMPLATES[difficulty]?.(topic) || MCQ_TEMPLATES.medium(topic);
    }

    // Ensure IDs and point values
    questions = questions.map((q, i) => ({ ...q, id: i + 1, points: q.points || (difficulty === "hard" ? 3 : difficulty === "medium" ? 2 : 1) }));

    const quiz = {
        id:          uid("quiz"),
        topic,
        difficulty,
        type,
        totalPoints: questions.reduce((s, q) => s + (q.points || 1), 0),
        timeLimit:   count * (difficulty === "hard" ? 3 : 2) + " min",
        questions,
        userId,
        createdAt:   NOW()
    };

    const all = load(STORE, []);
    all.push(quiz);
    flush(STORE, all.slice(-200));
    logToMemory("quizGeneratorAgent", topic, { difficulty, type, count: questions.length });

    return quiz;
}

async function submitAnswers(quizId, answers = {}) {
    const quizzes = load(STORE, []);
    const quiz    = quizzes.find(q => q.id === quizId);
    if (!quiz) throw new Error("Quiz not found");

    let score = 0, total = 0;
    const results = quiz.questions.map(q => {
        total += q.points || 1;
        const userAnswer = answers[q.id];
        const correct    = String(userAnswer).toUpperCase() === String(q.answer).toUpperCase();
        if (correct) score += q.points || 1;
        return { id: q.id, question: q.question, userAnswer, correctAnswer: q.answer, correct, explanation: q.explanation };
    });

    const pct    = Math.round((score / total) * 100);
    const result = { quizId, score, total, percentage: pct, grade: pct >= 90 ? "A" : pct >= 75 ? "B" : pct >= 60 ? "C" : pct >= 40 ? "D" : "F", results, submittedAt: NOW() };

    // Update skill tracker
    try { require("./skillTrackerAgent.cjs").recordActivity({ userId: quiz.userId, topic: quiz.topic, score: pct, type: "quiz" }); } catch { /* non-critical */ }

    logToMemory("quizGeneratorAgent", `quiz:${quizId}`, result);
    return result;
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "submit_quiz") {
            data = await submitAnswers(p.quizId, p.answers || {});
        } else {
            data = await generate({ topic: p.topic || p.subject || task.input || "General Knowledge", difficulty: p.difficulty || "medium", type: p.type || "mcq", count: p.count || 5, userId: p.userId || "" });
        }
        return ok("quizGeneratorAgent", data, ["Review wrong answers", "Generate exam simulator for harder practice"]);
    } catch (err) { return fail("quizGeneratorAgent", err.message); }
}

module.exports = { generate, submitAnswers, run };
