"use strict";
/**
 * Coding Assistant — ACP-1
 *
 * Repository-aware AI coding endpoint. Gathers context from:
 *   - Current file content (if provided)
 *   - Symbol context (function/class name at cursor)
 *   - Related file snippets (from ProjectSearch-style selection)
 *   - Active mission + recent mission objectives
 *   - Engineering rules (from Sprint 2 Rule Registry)
 *   - Git log summary (recent commits in cwd)
 *   - Knowledge Graph context (Q1/Q2 node lookup by label)
 *
 * Routes:
 *   POST /coding/ask          — free-form question with full repo context
 *   POST /coding/action       — code action (explain / refactor / test / review / fix / document)
 *   POST /coding/explain-file — explain an entire file
 *   POST /coding/find-impl    — "Where is X implemented?"
 *   POST /coding/summarize    — summarize a module/directory
 *   POST /coding/review       — review current diff before commit
 *   POST /coding/refactor     — multi-file refactor (was /jarvis/refactor)
 *   POST /coding/explain-error — explain stack trace (was /jarvis/explain-error)
 */

const router  = require("express").Router();
const { execSync } = require("child_process");
const { requireAuth } = require("../middleware/authMiddleware");
const ai      = require("../services/aiService");
const logger  = require("../utils/logger");

// ── Helpers ───────────────────────────────────────────────────────────────────

function _try(fn) { try { return fn(); } catch { return null; } }
function _missionMemory() { return _try(() => require("../services/missionMemory.cjs")); }
function _ruleRegistry()  { return _try(() => require("../services/engineeringRuleRegistry.cjs")); }
function _graphStore()    { return _try(() => require("../services/knowledgeGraph.cjs")); }

function _clean(str, max = 8000) {
    if (!str || typeof str !== "string") return "";
    return str.trim().slice(0, max);
}

/** Run git log in cwd, return last N commit subjects. Silently fails. */
function _gitLog(cwd, n = 10) {
    if (!cwd) return "";
    try {
        const out = execSync(`git log --oneline -${n}`, { cwd, timeout: 3000, encoding: "utf8" });
        return out.trim();
    } catch { return ""; }
}

/** Run git diff --stat HEAD in cwd. */
function _gitDiffStat(cwd) {
    if (!cwd) return "";
    try {
        return execSync("git diff --stat HEAD", { cwd, timeout: 3000, encoding: "utf8" }).trim();
    } catch { return ""; }
}

/** Get recent mission context (last 5 active/in-progress missions). */
function _missionContext() {
    try {
        const mm = _missionMemory();
        if (!mm) return "";
        const { missions } = mm.listMissions({ limit: 5 });
        if (!missions.length) return "";
        return missions.map(m =>
            `Mission [${m.status}]: ${m.objective.slice(0, 120)}` +
            (m.subtasks?.length ? ` (${m.subtasks.filter(s => s.status === "done").length}/${m.subtasks.length} subtasks done)` : "")
        ).join("\n");
    } catch { return ""; }
}

/** Get top engineering rules as context. */
function _rulesContext() {
    try {
        const reg = _ruleRegistry();
        if (!reg) return "";
        const { rules } = reg.listRules({ limit: 8, autoApply: true });
        if (!rules?.length) return "";
        return rules.map(r => `Rule [${r.problemClass}]: ${r.description || r.id}`).join("\n");
    } catch { return ""; }
}

/** Get graph stats as repo context (node counts by type). */
function _graphContext() {
    try {
        const gs = _graphStore();
        if (!gs?.getStats) return "";
        const stats = gs.getStats();
        if (!stats?.totalEdges) return "";
        return `Graph: ${stats.totalEdges} edges indexed across ${Object.keys(stats.nodeTypes || {}).length} node types`;
    } catch { return ""; }
}

/**
 * Assemble a full repository context block for the AI system prompt.
 * Only includes non-empty sections.
 */
function _buildRepoContext({ cwd, fileContent, filePath, symbolContext, relatedFiles }) {
    const parts = [];

    parts.push("You are an expert software engineering assistant embedded inside Ooplix, a developer IDE.");
    parts.push("You have access to the following repository context. Use it to give precise, file-specific answers.");
    parts.push("Always cite file paths and line numbers when relevant. Be concise and actionable.");
    parts.push("");

    if (cwd) {
        parts.push(`## Repository Root\n${cwd}`);
        const gitLog = _gitLog(cwd);
        if (gitLog) parts.push(`\n## Recent Git History\n${gitLog}`);
        const diffStat = _gitDiffStat(cwd);
        if (diffStat) parts.push(`\n## Uncommitted Changes (diff --stat)\n${diffStat}`);
    }

    const missions = _missionContext();
    if (missions) parts.push(`\n## Active Missions\n${missions}`);

    const rules = _rulesContext();
    if (rules) parts.push(`\n## Engineering Rules (auto-apply)\n${rules}`);

    const kg = _graphContext();
    if (kg) parts.push(`\n## Knowledge Graph\n${kg}`);

    if (filePath) {
        parts.push(`\n## Current File\n${filePath}`);
    }
    if (fileContent) {
        const preview = _clean(fileContent, 6000);
        parts.push(`\n## File Content\n\`\`\`\n${preview}\n\`\`\``);
    }
    if (symbolContext) {
        parts.push(`\n## Symbol at Cursor\n${symbolContext}`);
    }
    if (relatedFiles?.length) {
        parts.push(`\n## Related Files\n${relatedFiles.map(f => `- ${f}`).join("\n")}`);
    }

    return parts.join("\n");
}

// ── All routes require auth ───────────────────────────────────────────────────
router.use(requireAuth);

// ── POST /coding/ask — free-form question with full repo context ──────────────
router.post("/coding/ask", async (req, res) => {
    try {
        const {
            question,
            cwd,
            filePath,
            fileContent,
            symbolContext,
            relatedFiles,
            history = [],
        } = req.body;

        if (!question?.trim()) return res.status(400).json({ ok: false, error: "question required" });

        const system = _buildRepoContext({ cwd, fileContent, filePath, symbolContext, relatedFiles });

        const reply = await ai.callAI(_clean(question, 2000), {
            system,
            history: history.slice(-10).map(h => ({ role: h.role, content: h.content })),
        });

        res.json({ ok: true, reply, contextUsed: { hasCwd: !!cwd, hasFile: !!fileContent, hasMissions: !!_missionContext(), hasRules: !!_rulesContext() } });
    } catch (err) {
        logger.error(`[CodingAsk] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/action — explain / refactor / test / review / fix / document ─
router.post("/coding/action", async (req, res) => {
    try {
        const { action, code, language = "javascript", cwd, filePath, symbolContext } = req.body;

        if (!action) return res.status(400).json({ ok: false, error: "action required" });
        if (!code?.trim()) return res.status(400).json({ ok: false, error: "code required" });

        const ACTION_PROMPTS = {
            explain:  "Explain this code clearly. Describe what it does, any edge cases, and non-obvious behaviour.",
            refactor: "Refactor this code for clarity, performance, and maintainability. Return ONLY the improved code, then a brief explanation of changes.",
            test:     "Generate comprehensive unit tests for this code. Use the same language/framework implied by the code.",
            review:   "Review this code for bugs, security issues, performance problems, and style. List issues by severity (HIGH/MEDIUM/LOW). Be specific.",
            fix:      "Identify and fix all bugs in this code. Return the corrected code, then a list of what was fixed.",
            document: "Add clear, concise JSDoc/docstring comments to this code. Return the documented version only.",
        };

        const instruction = ACTION_PROMPTS[action] || `Perform the following action on this code: ${action}`;

        const system = _buildRepoContext({ cwd, filePath, symbolContext});

        const prompt = `${instruction}\n\nLanguage: ${language}\n\`\`\`${language}\n${_clean(code, 6000)}\n\`\`\``;
        const reply  = await ai.callAI(prompt, { system });

        // Extract patch if action is refactor/fix
        let patch = null;
        const patchMatch = reply.match(/```(?:diff|patch)([^`]+)```/s);
        if (patchMatch) patch = patchMatch[1].trim();

        // Try to extract code block for refactor/fix/document
        let resultCode = null;
        if (['refactor', 'fix', 'document'].includes(action)) {
            const codeMatch = reply.match(/```(?:\w+)?\n([\s\S]+?)```/);
            if (codeMatch) resultCode = codeMatch[1].trim();
        }

        res.json({ ok: true, action, reply, text: reply, code: resultCode, patch, explanation: reply });
    } catch (err) {
        logger.error(`[CodingAction] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/explain-file — explain an entire file ───────────────────────
router.post("/coding/explain-file", async (req, res) => {
    try {
        const { filePath, fileContent, cwd } = req.body;
        if (!fileContent) return res.status(400).json({ ok: false, error: "fileContent required" });

        const system = _buildRepoContext({ cwd, filePath, fileContent});
        const prompt = `Explain this file comprehensively:\n- What it does\n- Key functions/classes and their roles\n- Dependencies and what they provide\n- Non-obvious design decisions\n- How it fits into the broader codebase`;

        const reply = await ai.callAI(prompt, { system });
        res.json({ ok: true, reply, text: reply });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/find-impl — "Where is X implemented?" ───────────────────────
router.post("/coding/find-impl", async (req, res) => {
    try {
        const { query, cwd, symbolIndex = [] } = req.body;
        if (!query) return res.status(400).json({ ok: false, error: "query required" });

        const system = _buildRepoContext({ cwd});

        // Build symbol context from the passed symbol index
        let symbolCtx = "";
        if (symbolIndex.length) {
            const q = query.toLowerCase();
            const matches = symbolIndex.filter(s =>
                s.name.toLowerCase().includes(q) ||
                (s.filePath || "").toLowerCase().includes(q)
            ).slice(0, 20);
            if (matches.length) {
                symbolCtx = "\n\n## Matching Symbols in Index\n" +
                    matches.map(s => `- ${s.kind} \`${s.name}\` in ${s.filePath}:${s.line}`).join("\n");
            }
        }

        const prompt = `The developer is asking: "${_clean(query, 400)}"\n\nBased on the repository context and symbol index, answer: where is this implemented? Provide specific file paths and line numbers if available.${symbolCtx}`;
        const reply = await ai.callAI(prompt, { system });
        res.json({ ok: true, reply, text: reply });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/summarize — summarize a module/directory ────────────────────
router.post("/coding/summarize", async (req, res) => {
    try {
        const { filePaths = [], fileContents = [], cwd, moduleName } = req.body;
        if (!fileContents.length && !filePaths.length) {
            return res.status(400).json({ ok: false, error: "filePaths or fileContents required" });
        }

        const contentBlock = fileContents.slice(0, 5).map((c, i) =>
            `### ${filePaths[i] || `File ${i+1}`}\n\`\`\`\n${_clean(c, 1200)}\n\`\`\``
        ).join("\n\n");

        const system = _buildRepoContext({ cwd});
        const prompt = `Summarize this module${moduleName ? ` (${moduleName})` : ""}:\n- Purpose\n- Public API surface\n- Key dependencies\n- Architecture decisions\n\n${contentBlock}`;

        const reply = await ai.callAI(prompt, { system });
        res.json({ ok: true, reply, text: reply });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/review — review changes before commit ───────────────────────
router.post("/coding/review", async (req, res) => {
    try {
        const { cwd, diff } = req.body;

        let diffContent = diff;
        if (!diffContent && cwd) {
            try {
                diffContent = execSync("git diff HEAD", { cwd, timeout: 5000, encoding: "utf8" }).trim();
                if (!diffContent) {
                    diffContent = execSync("git diff --cached", { cwd, timeout: 5000, encoding: "utf8" }).trim();
                }
            } catch {}
        }

        const system = _buildRepoContext({ cwd});
        const prompt = diffContent
            ? `Review these changes before commit. Check for bugs, security issues, missing tests, style violations:\n\`\`\`diff\n${_clean(diffContent, 8000)}\n\`\`\``
            : "Describe the current state of uncommitted changes and suggest what to review before committing.";

        const reply  = await ai.callAI(prompt, { system });
        const issues = [];
        const lines  = reply.split("\n");
        for (const line of lines) {
            const m = line.match(/^[-*]\s*(?:\*\*)?(HIGH|MEDIUM|LOW|CRITICAL)\*?\*?[:\s]+(.+)/i);
            if (m) issues.push({ severity: m[1].toLowerCase(), title: m[2].trim() });
        }

        res.json({ ok: true, reply, text: reply, summary: reply.slice(0, 300), issues });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/refactor — multi-file refactor ───────────────────────────────
router.post("/coding/refactor", async (req, res) => {
    try {
        const { files = [], goal, cwd } = req.body;
        if (!goal?.trim()) return res.status(400).json({ ok: false, error: "goal required" });

        const system = _buildRepoContext({ cwd});
        const prompt = `Perform this refactor: "${_clean(goal, 500)}"\n\nFiles involved:\n${files.map(f => `- ${f}`).join("\n")}\n\nProvide: 1) Summary of changes, 2) For each file: the full new content in a fenced code block labelled with the file path.`;

        const reply   = await ai.callAI(prompt, { system });
        const patches = [];
        const re      = /```(?:\w+)?(?:\s*\/\/\s*(.+?))?\n([\s\S]+?)```/g;
        let   m;
        while ((m = re.exec(reply)) !== null) {
            if (m[1]) patches.push({ file: m[1].trim(), content: m[2].trim(), diff: "" });
        }

        res.json({ ok: true, summary: reply.slice(0, 500), reply, patches });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/explain-error — explain a stack trace ───────────────────────
router.post("/coding/explain-error", async (req, res) => {
    try {
        const { error: errorText, cwd, fileContent, filePath } = req.body;
        if (!errorText?.trim()) return res.status(400).json({ ok: false, error: "error field required" });

        const system = _buildRepoContext({ cwd, fileContent, filePath});

        const rules = _rulesContext();
        const engineeringCtx = rules ? `\n\nKnown engineering rules:\n${rules}` : "";

        const prompt = `Explain this error and provide a fix:\n\`\`\`\n${_clean(errorText, 3000)}\n\`\`\`${engineeringCtx}`;
        const reply  = await ai.callAI(prompt, { system });

        const fixMatch = reply.match(/(?:fix|solution|resolution)[:\s]+([^.]+\.)/i);
        const fix      = fixMatch ? fixMatch[1].trim() : null;
        const patchMatch = reply.match(/```(?:diff|patch)([^`]+)```/s);
        const patch    = patchMatch ? patchMatch[1].trim() : null;

        res.json({ ok: true, explanation: reply, fix, patch, text: reply });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
