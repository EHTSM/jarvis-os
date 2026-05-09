/**
 * Code Generator Agent — generates backend/frontend/API code via Groq.
 * Supports: node, react, express, api, utility
 */

const path   = require("path");
const groq   = require("../core/groqClient.cjs");
const fsUtil = require("../core/fileSystem.cjs");

const SYSTEM_PROMPT = `You are an expert full-stack engineer.
Generate clean, production-ready code following these rules:
- Node.js: use CommonJS (require/module.exports), async/await, proper error handling
- React: functional components with hooks, no class components
- APIs: RESTful conventions, structured JSON responses
- Always include basic input validation
- Return ONLY the code — no explanations, no markdown fences`;

const FRAMEWORK_HINTS = {
    node:    "Node.js CommonJS module",
    express: "Express.js REST endpoint with router",
    react:   "React functional component with hooks",
    api:     "REST API module with CRUD operations",
    utility: "Pure JavaScript utility function module"
};

async function generate({ framework = "node", description, outputPath = null, filename = null }) {
    if (!description) throw new Error("codeGeneratorAgent: description is required");

    const hint   = FRAMEWORK_HINTS[framework] || framework;
    const prompt = `Generate a ${hint} for:\n${description}\n\nReturn only the complete code.`;

    const code = await groq.chat(SYSTEM_PROMPT, prompt);

    let written = null;
    if (outputPath && filename) {
        const fullPath = path.join(outputPath, filename);
        written = await fsUtil.writeFile(fullPath, code);
    }

    return {
        success:   true,
        framework,
        description,
        code,
        lines:   code.split("\n").length,
        written
    };
}

async function run(task) {
    const p = task.payload || {};
    return generate({
        framework:   p.framework   || "node",
        description: p.description || task.input || "Express server with health endpoint",
        outputPath:  p.outputPath  || null,
        filename:    p.filename    || null
    });
}

module.exports = { run, generate };
