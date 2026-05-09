/**
 * Doubt Solver Agent — context-aware Q&A using user history from memoryAgent.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail } = require("./_eduStore.cjs");

const SYSTEM = `You are a brilliant, patient teacher who explains concepts clearly with examples.
Always:
- Answer the question directly first
- Then explain the underlying concept
- Give a practical example
- Suggest what to study next
Respond ONLY with valid JSON.`;

function _getMemoryContext(userId) {
    try {
        const memoryStore = require("../memory/memoryStore.cjs");
        const recent      = memoryStore.recent(10);
        const eduHistory  = recent.filter(e => e.category === "education" || e.type === "education");
        return eduHistory.slice(0, 5).map(e => `Previously studied: ${e.input}`).join(". ");
    } catch { return ""; }
}

async function solveDoubt({ question, topic = "", subject = "", userId = "" }) {
    if (!question) throw new Error("question required");

    const memCtx   = _getMemoryContext(userId);
    const context  = [subject && `Subject: ${subject}`, topic && `Topic: ${topic}`, memCtx && `User context: ${memCtx}`].filter(Boolean).join(". ");

    let response;
    try {
        const prompt = `${context ? context + ". " : ""}Student question: "${question}"
JSON: {
  "answer": "Direct, clear answer in 2-3 sentences",
  "explanation": "Deeper conceptual explanation with examples",
  "example": "Concrete real-world or code example",
  "commonMistakes": ["mistake 1", "mistake 2"],
  "studyNext": ["related topic 1", "related topic 2"],
  "difficulty": "easy|medium|hard"
}`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 700 });
        response   = groq.parseJson(raw);
    } catch {
        response = {
            answer:         `${question} relates to ${topic || subject || "this concept"}. The key principle is understanding the fundamental mechanism at work.`,
            explanation:    `To understand this fully, consider how ${topic || "the concept"} works in practice. Break it down step by step and relate it to what you already know.`,
            example:        `For example, think of ${topic || "this"} like a real-world scenario where the same logic applies.`,
            commonMistakes: ["Confusing the concept with a related but different one", "Skipping foundational understanding"],
            studyNext:      [`${topic || subject} fundamentals`, "Practice problems on this topic"],
            difficulty:     "medium"
        };
    }

    const result = { id: uid("doubt"), question, topic, subject, userId, ...response, solvedAt: NOW() };
    logToMemory("doubtSolverAgent", question, { topic, answer: response.answer?.slice(0, 100) });
    return result;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await solveDoubt({
            question: p.question || p.doubt || task.input || "",
            topic:    p.topic || "",
            subject:  p.subject || "",
            userId:   p.userId || ""
        });
        return ok("doubtSolverAgent", data, data.studyNext?.map(t => `Study: ${t}`) || []);
    } catch (err) { return fail("doubtSolverAgent", err.message); }
}

module.exports = { solveDoubt, run };
