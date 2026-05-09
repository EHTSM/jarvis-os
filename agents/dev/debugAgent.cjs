/**
 * Debug Agent — analyzes errors, identifies root cause, suggests and applies fixes.
 */

const groq   = require("../core/groqClient.cjs");
const fsUtil = require("../core/fileSystem.cjs");

const SYSTEM_PROMPT = `You are an expert software debugger.
Given an error message and optional code, respond ONLY with this JSON structure:
{
  "rootCause": "one-sentence explanation of why this error occurs",
  "explanation": "detailed technical explanation",
  "fix": "specific steps to fix the issue",
  "correctedCode": "the fixed code snippet or null if not applicable",
  "preventionTips": ["tip1", "tip2"]
}`;

// Detect common error patterns without AI for instant feedback
const QUICK_PATTERNS = [
    { rx: /Cannot find module ['"]([^'"]+)['"]/,          fix: m => `Run: npm install ${m[1]} (or check the path)` },
    { rx: /is not a function/,                             fix: ()  => "Check that the exported function name matches the import" },
    { rx: /Cannot read propert(?:y|ies) of (null|undefined)/, fix: m => `Add a null check before accessing the property: if (obj) { ... }` },
    { rx: /SyntaxError: Unexpected token/,                 fix: ()  => "Check for missing brackets, quotes, or commas near the error line" },
    { rx: /ENOENT: no such file or directory/,             fix: ()  => "The file path doesn't exist — verify the path is correct" },
    { rx: /EADDRINUSE/,                                    fix: ()  => "Port already in use — kill the process: lsof -ti:PORT | xargs kill" },
    { rx: /ReferenceError: (\w+) is not defined/,          fix: m => `'${m[1]}' is used before declaration — check imports or variable hoisting` }
];

function quickDiagnose(errorMsg) {
    for (const { rx, fix } of QUICK_PATTERNS) {
        const m = errorMsg.match(rx);
        if (m) return { matched: true, quickFix: fix(m) };
    }
    return { matched: false };
}

async function analyze({ error, code = null, file = null }) {
    if (!error) return { success: false, error: "No error message provided" };

    let codeContext = code || "";
    if (!codeContext && file) {
        const content = await fsUtil.readFile(file);
        if (content) codeContext = content;
    }

    const quick = quickDiagnose(error);

    const userPrompt = `Error:\n${error}\n\nCode (context):\n${codeContext || "(none provided)"}`;
    const raw        = await groq.chat(SYSTEM_PROMPT, userPrompt);

    let analysis = {};
    try {
        analysis = groq.parseJson(raw);
    } catch {
        analysis = { rootCause: "AI parse failed", explanation: raw, fix: quick.quickFix || raw, correctedCode: null, preventionTips: [] };
    }

    return {
        success:    true,
        error,
        file:       file || null,
        quickFix:   quick.quickFix || null,
        ...analysis
    };
}

async function run(task) {
    const p = task.payload || {};
    return analyze({
        error: p.error || task.input || "Unknown error",
        code:  p.code  || null,
        file:  p.file  || null
    });
}

module.exports = { run, analyze };
