"use strict";
/**
 * Code Generator Agent — generates code via Groq, writes to /generated/.
 *
 * Restored from git history (98b01f4). Original used groqClient.cjs +
 * fileSystem.cjs, both deleted. This version calls Groq directly so it
 * can set temperature:0.2 and max_tokens:4096, which aiService hardcodes
 * at 0.7 and 1024 — both wrong for code generation.
 *
 * API contract (unchanged from original):
 *   generate({ framework, description, outputPath, filename })
 *   → { success, framework, description, code, lines, written:{path,bytes}|null }
 */

const fs   = require("fs");
const path = require("path");
const axios = require("axios");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL    = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const SYSTEM_PROMPT =
    "You are an expert full-stack engineer. " +
    "Generate clean, production-ready code following these rules:\n" +
    "- Node.js: use CommonJS (require/module.exports), async/await, proper error handling\n" +
    "- React: functional components with hooks, no class components\n" +
    "- APIs: RESTful conventions, structured JSON responses\n" +
    "- Always include basic input validation\n" +
    "Return ONLY the code — no explanations, no markdown fences";

const FRAMEWORK_HINTS = {
    node:    "Node.js CommonJS module",
    express: "Express.js REST endpoint with router",
    react:   "React functional component with hooks",
    api:     "REST API module with CRUD operations",
    utility: "Pure JavaScript utility function module",
};

// Strip markdown code fences if the model wraps output despite the instruction
function _stripFences(raw) {
    return raw
        .replace(/^```[\w]*\n?/m, "")
        .replace(/\n?```\s*$/m, "")
        .trim();
}

async function _callGroq(systemPrompt, userPrompt) {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("GROQ_API_KEY not set");

    const res = await axios.post(
        GROQ_URL,
        {
            model:       MODEL,
            messages:    [
                { role: "system", content: systemPrompt },
                { role: "user",   content: userPrompt   },
            ],
            temperature: 0.2,
            max_tokens:  4096,
        },
        {
            headers: {
                Authorization:  `Bearer ${key}`,
                "Content-Type": "application/json",
            },
            timeout: 45000,
        }
    );

    return res.data.choices[0].message.content.trim();
}

async function generate({ framework = "node", description, outputPath = null, filename = null }) {
    if (!description || !description.trim()) {
        throw new Error("codeGeneratorAgent: description is required");
    }

    const hint   = FRAMEWORK_HINTS[framework] || framework;
    const prompt = `Generate a ${hint} for:\n${description}\n\nReturn only the complete code.`;
    const raw    = await _callGroq(SYSTEM_PROMPT, prompt);
    const code   = _stripFences(raw);

    let written = null;
    if (outputPath && filename) {
        const fullPath = path.resolve(outputPath, filename);
        const dir      = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, code, "utf8");
        written = { path: fullPath, bytes: Buffer.byteLength(code, "utf8") };
    }

    return {
        success:     true,
        framework,
        description,
        code,
        lines:   code.split("\n").length,
        written,
    };
}

// ── buildRepoContext ──────────────────────────────────────────────────────────
// Live repository scan: no pre-index required.
//
// Given a file path and a keyword (e.g. "login", "auth"), returns:
//   - imports declared in the target file (static require/import parse)
//   - files that import the target file (reverse dependency)
//   - files across the repo that contain the keyword
//   - first 40 lines of each related file (capped at MAX_CONTEXT_FILES)
//
// Uses only fs + safe regex — no exec, no network.
// Designed to be injected into the modifyFile prompt as additional context.

const SKIP_DIRS  = new Set(["node_modules", "_archive", "build", ".git", "dist", "coverage"]);
const CODE_EXTS  = new Set([".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx"]);
const MAX_CONTEXT_FILES  = 4;   // related files included in prompt
const MAX_CONTEXT_LINES  = 40;  // lines per related file
const MAX_SCAN_FILES     = 800; // hard cap on files walked

function _walkFiles(dir, results = [], depth = 0) {
    if (depth > 6 || results.length >= MAX_SCAN_FILES) return results;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
    for (const e of entries) {
        if (SKIP_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) _walkFiles(full, results, depth + 1);
        else if (e.isFile() && CODE_EXTS.has(path.extname(e.name))) results.push(full);
    }
    return results;
}

function _extractRequires(content) {
    const found = [];
    const re = /require\s*\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(content)) !== null) found.push(m[1] || m[2]);
    return found;
}

function _fileSnippet(filePath, lines = MAX_CONTEXT_LINES) {
    try {
        return fs.readFileSync(filePath, "utf8").split("\n").slice(0, lines).join("\n");
    } catch { return ""; }
}

function buildRepoContext(targetFile, keyword = "") {
    const abs     = path.resolve(targetFile);
    const root    = path.resolve(".");
    const relTarget = path.relative(root, abs);

    // 1. Static imports declared in target file
    let targetContent = "";
    try { targetContent = fs.readFileSync(abs, "utf8"); } catch {}
    const rawImports = _extractRequires(targetContent);
    const resolvedImports = rawImports
        .filter(r => r.startsWith("."))   // local only
        .map(r => {
            const candidate = path.resolve(path.dirname(abs), r);
            // Try with and without extension
            for (const ext of ["", ".js", ".cjs", ".mjs", ".jsx", ".ts"]) {
                if (fs.existsSync(candidate + ext)) return path.relative(root, candidate + ext);
            }
            return null;
        })
        .filter(Boolean);

    // 2. Walk repo and find: (a) files importing target, (b) files containing keyword
    const allFiles     = _walkFiles(root);
    const importers    = [];
    const keywordFiles = [];
    const kw           = keyword.toLowerCase();

    for (const f of allFiles) {
        if (f === abs) continue;
        let content = "";
        try { content = fs.readFileSync(f, "utf8"); } catch { continue; }

        // Reverse dependency: does this file require the target?
        const requires = _extractRequires(content);
        const rel      = path.relative(path.dirname(f), abs).replace(/\\/g, "/");
        const relNoExt = rel.replace(/\.[^.]+$/, "");
        if (requires.some(r => r === rel || r === relNoExt || r === "./" + path.basename(abs) || r === "./" + path.basename(abs, path.extname(abs)))) {
            importers.push(path.relative(root, f));
        }

        // Keyword match (only if keyword provided)
        if (kw && content.toLowerCase().includes(kw)) {
            keywordFiles.push(path.relative(root, f));
        }
    }

    // 3. Pick the most relevant related files for context injection
    //    Priority: importers > resolvedImports > keyword files
    const seen = new Set([relTarget]);
    const related = [];
    for (const f of [...importers, ...resolvedImports, ...keywordFiles]) {
        if (!seen.has(f) && related.length < MAX_CONTEXT_FILES) {
            seen.add(f);
            related.push(f);
        }
    }

    return {
        targetFile:       relTarget,
        keyword,
        imports:          resolvedImports,
        importers:        importers.slice(0, 10),
        keywordFiles:     keywordFiles.slice(0, 20),
        relatedFiles:     related,
        relatedSnippets:  related.map(f => ({
            file:    f,
            snippet: _fileSnippet(path.resolve(root, f)),
        })),
        scannedFiles:     allFiles.length,
    };
}

// ── modifyFile ────────────────────────────────────────────────────────────────
// Takes an existing file path + a plain-English change instruction.
// Optional: pass context from buildRepoContext() to enrich the AI prompt
// with related files, importers, and keyword matches.
//
// Returns { originalContent, patchedContent } — never writes.

const MODIFY_SYSTEM_PROMPT =
    "You are an expert code editor. You will be given an existing file and an instruction. " +
    "Return the COMPLETE modified file — every line, not just the changed section. " +
    "Do not add explanations. Do not add markdown fences. Preserve all existing formatting, " +
    "indentation, and style unless the instruction explicitly changes them.";

async function modifyFile({ filePath, instruction, context = null }) {
    if (!filePath || !instruction || !instruction.trim()) {
        throw new Error("modifyFile: filePath and instruction are required");
    }

    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) throw new Error(`modifyFile: file not found: ${abs}`);

    const originalContent = fs.readFileSync(abs, "utf8");
    if (Buffer.byteLength(originalContent) > 128 * 1024) {
        throw new Error("modifyFile: file exceeds 128 KB — too large for single-pass modification");
    }

    // Build context section when repo context is provided
    let contextSection = "";
    if (context && context.relatedSnippets && context.relatedSnippets.length > 0) {
        const snippetBlock = context.relatedSnippets
            .map(s => `--- ${s.file} (first ${MAX_CONTEXT_LINES} lines) ---\n${s.snippet}`)
            .join("\n\n");
        contextSection =
            `\nREPO CONTEXT — files that import or are related to this file:\n` +
            `Imports: ${(context.imports || []).join(", ") || "none"}\n` +
            `Imported by: ${(context.importers || []).slice(0, 5).join(", ") || "none"}\n\n` +
            `RELATED FILE SNIPPETS:\n${snippetBlock}\n`;
    }

    const prompt =
        `FILE: ${path.basename(abs)}\n\n` +
        `INSTRUCTION: ${instruction}\n` +
        contextSection +
        `\nCURRENT FILE CONTENT:\n${originalContent}\n\n` +
        `Return the complete modified file.`;

    const raw            = await _callGroq(MODIFY_SYSTEM_PROMPT, prompt);
    const patchedContent = _stripFences(raw);

    return {
        filePath:        abs,
        originalContent,
        patchedContent,
        linesOriginal:   originalContent.split("\n").length,
        linesPatched:    patchedContent.split("\n").length,
        contextUsed:     context ? { relatedFiles: context.relatedFiles, imports: context.imports, importers: context.importers } : null,
    };
}

module.exports = { generate, buildRepoContext, modifyFile };
