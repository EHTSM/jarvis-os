/**
 * Optimization Agent — AI-powered code performance analysis.
 */

const groq   = require("../core/groqClient.cjs");
const fsUtil = require("../core/fileSystem.cjs");

const SYSTEM = `You are a Node.js performance engineer. Analyze the code and respond ONLY with JSON:
{
  "issues": [{ "line": null, "issue": "description", "impact": "high|medium|low" }],
  "suggestions": ["actionable suggestion"],
  "optimizedCode": "rewritten code or null",
  "estimatedImprovement": "e.g. 30% faster DB queries"
}
Focus: N+1 queries, sync I/O in async context, missing caching, repeated computations, large payloads.`;

async function run(task) {
    const p     = task.payload || {};
    let   src   = p.code || null;

    if (!src && p.file) {
        src = await fsUtil.readFile(p.file);
        if (!src) return { success: false, error: `File not found: ${p.file}` };
    }
    if (!src) return { success: false, error: "Provide code or file in payload" };

    const raw = await groq.chat(SYSTEM, `Focus: ${p.focus || "general"}\n\nCode:\n${src.slice(0, 6000)}`);

    let result = {};
    try   { result = groq.parseJson(raw); }
    catch { result = { issues: [], suggestions: [raw], optimizedCode: null, estimatedImprovement: "N/A" }; }

    return { success: true, file: p.file || null, ...result };
}

module.exports = { run };
