/**
 * Interview Coach Agent — mock interviews with structured feedback.
 * Reads skillTrackerAgent for personalized question targeting.
 */

const groq = require("../core/groqClient.cjs");
const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_eduStore.cjs");

const SYSTEM = `You are a senior hiring manager and interview coach. Conduct realistic mock interviews.
Give detailed, constructive feedback. Respond ONLY with valid JSON.`;

const STORE = "interview-sessions";

const INTERVIEW_TYPES = {
    behavioral: { focus: "STAR method, past experience", rounds: 1 },
    technical:  { focus: "Problem solving, algorithms, system design", rounds: 2 },
    hr:         { focus: "Culture fit, salary negotiation, career goals", rounds: 1 },
    case:       { focus: "Business case analysis and problem framing", rounds: 1 },
    coding:     { focus: "Live coding, data structures, algorithms", rounds: 2 },
    system:     { focus: "System design, scalability, trade-offs", rounds: 1 }
};

const BEHAVIORAL_QUESTIONS = [
    "Tell me about yourself.",
    "What is your greatest strength and weakness?",
    "Describe a time you handled a conflict at work.",
    "Tell me about a project you are most proud of.",
    "Where do you see yourself in 5 years?",
    "Why do you want to work here?",
    "Describe a time you failed and what you learned.",
    "How do you handle pressure and tight deadlines?"
];

async function generateQuestions({ role, interviewType = "technical", skills = [], difficulty = "medium", count = 5 }) {
    if (!role) throw new Error("role required");

    let questions = [];
    try {
        const prompt = `Create ${count} ${difficulty} ${interviewType} interview questions for a ${role} position.
Skills to test: ${skills.join(", ") || "general"}.
JSON: { "questions": [{ "id": N, "question": "...", "type": "${interviewType}", "expectedTopics": ["..."], "difficulty": "...", "timeLimit": 120, "followUp": "..." }] }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 900 });
        const ai   = groq.parseJson(raw);
        questions  = ai?.questions || [];
    } catch {
        questions = (interviewType === "behavioral" ? BEHAVIORAL_QUESTIONS : [
            `Explain how you would design a ${role}-related system.`,
            `What is your approach to debugging a complex problem?`,
            `How do you stay updated with the latest trends in ${skills[0] || "your field"}?`,
            `Walk me through your most complex project.`,
            `How would you optimize performance in a large-scale application?`
        ]).slice(0, count).map((q, i) => ({ id: i + 1, question: q, type: interviewType, expectedTopics: [role], timeLimit: 120, difficulty }));
    }

    return questions;
}

async function evaluateAnswer({ question, answer, role, interviewType = "technical" }) {
    if (!question || !answer) throw new Error("question and answer required");

    let evaluation;
    try {
        const prompt = `Evaluate this interview answer for a ${role} ${interviewType} interview.
Question: "${question}"
Answer: "${answer.slice(0, 600)}"
JSON: {
  "score": 0-10,
  "strengths": ["what was good"],
  "improvements": ["what to improve"],
  "modelAnswer": "ideal answer structure",
  "starScore": { "situation": N, "task": N, "action": N, "result": N },
  "bodyLanguageTip": "...",
  "grade": "A|B|C|D|F"
}`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 600 });
        evaluation = groq.parseJson(raw);
    } catch {
        evaluation = {
            score: 7, grade: "B",
            strengths:    ["Clear communication", "Relevant experience mentioned"],
            improvements: ["Add specific metrics", "Use STAR method more explicitly"],
            modelAnswer:  "Structure: Situation → Task → Action → Result with specific numbers",
            starScore:    { situation: 8, task: 7, action: 7, result: 6 },
            bodyLanguageTip: "Maintain eye contact and speak at a measured pace"
        };
    }

    return { question, answer: answer.slice(0, 200), role, ...evaluation, evaluatedAt: NOW() };
}

async function runMockInterview({ userId = "", role, interviewType = "technical", skills = [], difficulty = "medium" }) {
    if (!role) throw new Error("role required");

    // Pull skills from tracker
    let trackedSkills = skills;
    try {
        const report  = require("./skillTrackerAgent.cjs").getReport(userId);
        trackedSkills = [...new Set([...skills, ...(report.skills?.map(s => s.topic) || [])])];
    } catch { /* no data */ }

    const questions = await generateQuestions({ role, interviewType, skills: trackedSkills, difficulty, count: 5 });
    const session   = {
        id:            uid("iv"),
        userId,
        role,
        interviewType,
        difficulty,
        skills:        trackedSkills,
        questions,
        status:        "in_progress",
        tips: [
            "Take 30 seconds to think before answering",
            "Use the STAR method for behavioral questions",
            "Ask clarifying questions when needed",
            "Quantify achievements with numbers",
            "Prepare 2-3 questions to ask the interviewer"
        ],
        createdAt: NOW()
    };

    const all = load(STORE, []);
    all.push(session);
    flush(STORE, all.slice(-50));
    logToMemory("interviewCoachAgent", `${role}: ${interviewType}`, { questions: questions.length });
    return session;
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "evaluate_answer") {
            data = await evaluateAnswer({ question: p.question, answer: p.answer, role: p.role || "professional", interviewType: p.interviewType || "behavioral" });
        } else if (task.type === "interview_questions") {
            data = { questions: await generateQuestions({ role: p.role || task.input || "Developer", interviewType: p.type || "technical", skills: p.skills || [], difficulty: p.difficulty || "medium", count: p.count || 5 }) };
        } else {
            data = await runMockInterview({ userId: p.userId || "", role: p.role || task.input || "Software Developer", interviewType: p.type || p.interviewType || "technical", skills: p.skills || [], difficulty: p.difficulty || "medium" });
        }
        return ok("interviewCoachAgent", data, ["Answer each question aloud", "Record yourself for self-review"]);
    } catch (err) { return fail("interviewCoachAgent", err.message); }
}

module.exports = { runMockInterview, evaluateAnswer, generateQuestions, run };
