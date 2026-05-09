/**
 * Coding Tutor Agent — code explanation, debugging, tasks, and concept teaching.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail } = require("./_eduStore.cjs");

const SYSTEM = `You are an expert coding tutor. Explain code clearly, debug effectively, teach best practices.
Always provide working code examples. Respond ONLY with valid JSON.`;

const LANGUAGES = ["JavaScript", "Python", "Java", "C++", "C", "TypeScript", "Go", "Rust", "SQL", "Kotlin", "Swift", "PHP"];

async function explain({ code, language = "JavaScript", question = "" }) {
    if (!code && !question) throw new Error("code or question required");
    let result;
    try {
        const prompt = `Explain this ${language} code/question.
${code ? `Code:\n\`\`\`${language.toLowerCase()}\n${code.slice(0, 800)}\n\`\`\`` : `Question: ${question}`}
JSON: {
  "explanation": "plain English explanation",
  "lineByLine": [{ "line": "code snippet", "explanation": "what it does" }],
  "concepts": ["concept 1", "concept 2"],
  "timeComplexity": "O(n) if applicable",
  "spaceComplexity": "O(n) if applicable",
  "improvements": ["suggestion 1"],
  "relatedConcepts": ["concept to learn next"]
}`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 900 });
        result    = groq.parseJson(raw);
    } catch {
        result = {
            explanation:  `This ${language} code ${code ? "performs the specified operations" : "addresses: " + question}. Understanding it requires knowledge of ${language} fundamentals.`,
            lineByLine:   code ? code.split("\n").slice(0, 5).map(line => ({ line: line.trim(), explanation: "This line performs a specific operation" })) : [],
            concepts:     [language + " basics", "Programming fundamentals"],
            improvements: ["Add error handling", "Add comments for clarity"],
            relatedConcepts: ["Data structures", "Algorithms", language + " advanced features"]
        };
    }
    logToMemory("codingTutorAgent", `explain:${language}`, { concepts: result.concepts?.length });
    return { id: uid("code"), type: "explanation", language, code, question, ...result, createdAt: NOW() };
}

async function debug({ code, error, language = "JavaScript" }) {
    if (!code) throw new Error("code required");
    let result;
    try {
        const prompt = `Debug this ${language} code.
Error: ${error || "not specified"}
Code:\n\`\`\`${language.toLowerCase()}\n${code.slice(0, 800)}\n\`\`\`
JSON: {
  "bugFound": "description of the bug",
  "fixedCode": "corrected code",
  "explanation": "why this was a bug",
  "preventionTip": "how to avoid this in future",
  "otherIssues": ["any other potential issues"]
}`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 900 });
        result    = groq.parseJson(raw);
    } catch {
        result = { bugFound: "Review the code logic and check for common issues", fixedCode: code, explanation: "Carefully trace through the code execution to identify the issue", preventionTip: "Write unit tests to catch bugs early", otherIssues: [] };
    }
    logToMemory("codingTutorAgent", `debug:${language}`, { error: error?.slice(0, 50) });
    return { id: uid("code"), type: "debug", language, code, error, ...result, createdAt: NOW() };
}

async function generateTask({ topic, language = "JavaScript", difficulty = "medium" }) {
    if (!topic) throw new Error("topic required");
    let task;
    try {
        const prompt = `Create a ${difficulty} ${language} coding task on "${topic}".
JSON: {
  "title": "...",
  "description": "...",
  "requirements": ["req 1"],
  "starterCode": "// Start here\n...",
  "expectedOutput": "...",
  "hints": ["hint 1", "hint 2"],
  "solution": "complete working solution",
  "concepts": ["tested concept 1"]
}`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 900 });
        task      = groq.parseJson(raw);
    } catch {
        task = {
            title:          `${topic} Exercise`,
            description:    `Write a ${language} program that demonstrates ${topic}`,
            requirements:   ["Implement the core functionality", "Handle edge cases", "Add basic error handling"],
            starterCode:    `// ${topic} - ${language}\n// Your solution here\n`,
            expectedOutput: "Program runs correctly with expected results",
            hints:          [`Think about the ${topic} algorithm`, "Break the problem into smaller steps"],
            solution:       `// Complete solution for ${topic}`,
            concepts:       [topic, language + " fundamentals"]
        };
    }
    logToMemory("codingTutorAgent", `task:${topic}`, { difficulty, language });
    return { id: uid("code"), type: "task", language, topic, difficulty, ...task, createdAt: NOW() };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "debug_code" || p.error) {
            data = await debug({ code: p.code || task.input || "", error: p.error || "", language: p.language || "JavaScript" });
        } else if (task.type === "coding_task") {
            data = await generateTask({ topic: p.topic || task.input || "", language: p.language || "JavaScript", difficulty: p.difficulty || "medium" });
        } else {
            data = await explain({ code: p.code || "", question: p.question || task.input || "", language: p.language || "JavaScript" });
        }
        return ok("codingTutorAgent", data, ["Solve the task yourself first", "Run the code and test with edge cases"]);
    } catch (err) { return fail("codingTutorAgent", err.message); }
}

module.exports = { explain, debug, generateTask, LANGUAGES, run };
