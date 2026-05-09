/**
 * Exam Simulator Agent — timed mock tests simulating real exam environments.
 * Supports: JEE, UPSC, CAT, GATE, AWS, IELTS, TOEFL, coding interviews, custom.
 */

const groq = require("../core/groqClient.cjs");
const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_eduStore.cjs");

const SYSTEM = `You are an exam preparation expert. Create realistic mock exams that mirror real exam patterns.
Respond ONLY with valid JSON.`;

const STORE = "exams";

const EXAM_PROFILES = {
    jee:        { name: "JEE Mains", questions: 75,  duration: 180, sections: ["Physics", "Chemistry", "Mathematics"],        negativeMarking: true,  markPerQ: 4, negMark: -1  },
    upsc:       { name: "UPSC CSE",  questions: 100, duration: 120, sections: ["Current Affairs", "History", "Geography"],    negativeMarking: true,  markPerQ: 2, negMark: -0.66 },
    cat:        { name: "CAT",       questions: 66,  duration: 120, sections: ["VARC", "DILR", "QA"],                         negativeMarking: true,  markPerQ: 3, negMark: -1  },
    gate:       { name: "GATE",      questions: 65,  duration: 180, sections: ["General Aptitude", "Core Subject"],           negativeMarking: true,  markPerQ: 2, negMark: -0.67 },
    aws:        { name: "AWS SAA",   questions: 65,  duration: 130, sections: ["Architecture", "Security", "Deployment"],     negativeMarking: false, markPerQ: 1, negMark: 0   },
    ielts:      { name: "IELTS",     questions: 40,  duration: 60,  sections: ["Listening", "Reading", "Writing"],            negativeMarking: false, markPerQ: 1, negMark: 0   },
    coding:     { name: "Coding Interview", questions: 5, duration: 60, sections: ["Data Structures", "Algorithms", "System Design"], negativeMarking: false, markPerQ: 20, negMark: 0 },
    custom:     { name: "Custom Exam", questions: 30, duration: 60, sections: ["Section A", "Section B"],                     negativeMarking: false, markPerQ: 2, negMark: 0   }
};

async function createExam({ examType = "custom", topic = "", difficulty = "medium", userId = "" }) {
    const profile  = EXAM_PROFILES[examType.toLowerCase()] || EXAM_PROFILES.custom;
    const subject  = topic || profile.name;

    let questions = [];
    try {
        const prompt = `Create a ${profile.questions}-question mock ${profile.name} exam on "${subject}".
Sections: ${profile.sections.join(", ")}. Difficulty: ${difficulty}.
JSON: { "sections": [{ "name": "...", "questions": [{ "id": N, "question": "...", "options": ["A:...","B:...","C:...","D:..."], "answer": "A", "explanation": "...", "marks": ${profile.markPerQ}, "negativeMark": ${profile.negMark} }] }] }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 2000 });
        const ai   = groq.parseJson(raw);
        // Flatten sections into questions array
        if (ai?.sections) {
            for (const sec of ai.sections) {
                for (const q of sec.questions || []) {
                    questions.push({ ...q, section: sec.name });
                }
            }
        }
    } catch { /* generate fallback template */ }

    if (!questions.length) {
        questions = profile.sections.flatMap((sec, si) =>
            Array.from({ length: Math.ceil(profile.questions / profile.sections.length) }, (_, i) => ({
                id: si * 10 + i + 1, section: sec, question: `${sec} Question ${i + 1} on ${subject}`,
                options: ["A: Option 1", "B: Option 2", "C: Option 3", "D: Option 4"],
                answer: "A", marks: profile.markPerQ, negativeMark: profile.negMark,
                explanation: `This tests your knowledge of ${sec} fundamentals.`
            }))
        ).slice(0, profile.questions);
    }

    const exam = {
        id:              uid("exam"),
        examType,
        name:            profile.name,
        topic:           subject,
        difficulty,
        totalQuestions:  questions.length,
        totalMarks:      questions.length * profile.markPerQ,
        durationMinutes: profile.duration,
        sections:        profile.sections,
        negativeMarking: profile.negativeMarking,
        questions,
        instructions: [
            `Total time: ${profile.duration} minutes`,
            `Total marks: ${questions.length * profile.markPerQ}`,
            profile.negativeMarking ? `Negative marking: ${profile.negMark} per wrong answer` : "No negative marking",
            "Read all questions carefully before answering",
            "Attempt all questions within the time limit"
        ],
        userId,
        createdAt: NOW(),
        status:    "not_started"
    };

    const all = load(STORE, []);
    all.push(exam);
    flush(STORE, all.slice(-50));
    logToMemory("examSimulatorAgent", `${examType}: ${subject}`, { questions: questions.length, duration: profile.duration });
    return exam;
}

async function submitExam(examId, answers = {}, timeTaken = 0) {
    const exams = load(STORE, []);
    const exam  = exams.find(e => e.id === examId);
    if (!exam) throw new Error("Exam not found");

    let score = 0, correct = 0, wrong = 0, skipped = 0;
    const results = exam.questions.map(q => {
        const userAnswer = answers[q.id];
        if (!userAnswer) { skipped++; return { ...q, userAnswer: null, result: "skipped" }; }
        const isCorrect  = String(userAnswer).toUpperCase() === String(q.answer).toUpperCase();
        if (isCorrect) { score += q.marks || 1; correct++; }
        else           { score += (q.negativeMark || 0); wrong++; }
        return { ...q, userAnswer, result: isCorrect ? "correct" : "wrong" };
    });

    const pct      = Math.round((score / exam.totalMarks) * 100);
    const sectionBreakdown = {};
    for (const r of results) {
        if (!sectionBreakdown[r.section]) sectionBreakdown[r.section] = { correct: 0, wrong: 0, skipped: 0 };
        sectionBreakdown[r.section][r.result]++;
    }

    const result = {
        examId, score: Math.max(0, score), maxScore: exam.totalMarks, percentage: pct,
        correct, wrong, skipped, timeTaken: `${timeTaken} min`,
        grade:   pct >= 90 ? "A+" : pct >= 75 ? "A" : pct >= 60 ? "B" : pct >= 45 ? "C" : "F",
        sectionBreakdown,
        weakAreas: Object.entries(sectionBreakdown).filter(([, v]) => v.correct < v.wrong + v.skipped).map(([k]) => k),
        submittedAt: NOW()
    };

    try { require("./skillTrackerAgent.cjs").recordActivity({ userId: exam.userId, topic: exam.topic, score: pct, type: "exam" }); } catch { /* non-critical */ }
    logToMemory("examSimulatorAgent", `result:${examId}`, result);
    return result;
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "submit_exam") {
            data = await submitExam(p.examId, p.answers || {}, p.timeTaken || 0);
        } else {
            data = await createExam({ examType: p.examType || p.exam || "custom", topic: p.topic || task.input || "", difficulty: p.difficulty || "medium", userId: p.userId || "" });
        }
        return ok("examSimulatorAgent", data, ["Review weak areas", "Create a targeted study plan for weak sections"]);
    } catch (err) { return fail("examSimulatorAgent", err.message); }
}

module.exports = { createExam, submitExam, run };
