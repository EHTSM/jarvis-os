"use strict";
/**
 * Coding Assistant — ACP-1 + ACP-2
 *
 * ACP-1 routes (repository-aware AI):
 *   POST /coding/ask          — free-form question with full repo context
 *   POST /coding/action       — explain / refactor / test / review / fix / document
 *   POST /coding/explain-file — explain an entire file
 *   POST /coding/find-impl    — "Where is X implemented?"
 *   POST /coding/summarize    — summarize a module/directory
 *   POST /coding/review       — review current diff before commit
 *   POST /coding/refactor     — multi-file refactor
 *   POST /coding/explain-error — explain stack trace
 *
 * ACP-2 routes (patch preview & pipeline apply):
 *   POST /coding/generate-patch   — AI generates structured patch proposal
 *   POST /coding/apply-patch      — apply via Engineering Pipeline (I7)
 *   POST /coding/convert-to-mission — convert patch proposal → Mission
 *   GET  /coding/patch-history    — list applied AI patches
 *   POST /coding/undo-patch       — revert last AI-applied patch via git
 */

const router  = require("express").Router();
const fs      = require("fs");
const path    = require("path");
const crypto  = require("crypto");
const { execSync, spawnSync } = require("child_process");
const { requireAuth } = require("../middleware/authMiddleware");
const ai      = require("../services/aiService");
const logger  = require("../utils/logger");

const PATCH_HISTORY_PATH = path.join(__dirname, "../../data/ai-patch-history.json");

function _loadPatchHistory() {
    try { return JSON.parse(fs.readFileSync(PATCH_HISTORY_PATH, "utf8")); } catch { return { patches: [] }; }
}
function _savePatchHistory(store) {
    fs.writeFileSync(PATCH_HISTORY_PATH, JSON.stringify(store, null, 2));
}
function _addToPatchHistory(entry) {
    const store = _loadPatchHistory();
    store.patches.unshift(entry);
    if (store.patches.length > 100) store.patches = store.patches.slice(0, 100);
    _savePatchHistory(store);
}

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

// ══════════════════════════════════════════════════════════════════════════════
//  ACP-2: PATCH PREVIEW & PIPELINE APPLY
// ══════════════════════════════════════════════════════════════════════════════

// ── POST /coding/generate-patch — AI produces structured patch proposal ───────
router.post("/coding/generate-patch", async (req, res) => {
    try {
        const { goal, cwd, filePath, fileContent, symbolContext } = req.body;
        if (!goal?.trim()) return res.status(400).json({ ok: false, error: "goal required" });

        const system = _buildRepoContext({ cwd, fileContent, filePath, symbolContext });

        const prompt = `You are a code modification assistant. Given a goal, produce a structured patch proposal.

Goal: ${_clean(goal, 1000)}

Respond with ONLY valid JSON matching this schema (no markdown fences, no preamble):
{
  "explanation": "1-3 sentences explaining what will be changed and why",
  "reasoning": "step-by-step reasoning for the approach taken",
  "affectedFiles": ["relative/path/to/file1.js", "..."],
  "confidence": 0.0-1.0,
  "riskLevel": "low" | "medium" | "high",
  "riskReason": "why this risk level",
  "patchSpecs": [
    {
      "targetFile": "relative/path/to/file.js",
      "patchTarget": "exact string to be replaced (must appear exactly once)",
      "patchReplacement": "replacement string",
      "description": "what this specific change does"
    }
  ],
  "unifiedDiff": "unified diff string for display (optional, best-effort)",
  "commitMsg": "conventional commit message"
}

If you cannot produce a safe, targeted patch (e.g. the change requires understanding files you don't have), set patchSpecs to [] and explain in the explanation field.`;

        const raw = await ai.callAI(prompt, { system });

        let proposal;
        try {
            const jsonMatch = raw.match(/\{[\s\S]+\}/);
            proposal = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
        } catch {
            proposal = {
                explanation: raw.slice(0, 500),
                reasoning: "",
                affectedFiles: filePath ? [filePath] : [],
                confidence: 0.3,
                riskLevel: "medium",
                riskReason: "Could not parse structured proposal",
                patchSpecs: [],
                unifiedDiff: "",
                commitMsg: `feat: ${goal.slice(0, 60)}`,
            };
        }

        // Validate patchSpecs — check each targetFile exists and patchTarget is found
        const ROOT = cwd || path.join(__dirname, "../../");
        const validation = (proposal.patchSpecs || []).map(spec => {
            try {
                const absPath = path.isAbsolute(spec.targetFile)
                    ? spec.targetFile
                    : path.join(ROOT, spec.targetFile);
                if (!fs.existsSync(absPath)) return { ...spec, valid: false, error: "File not found" };
                const content = fs.readFileSync(absPath, "utf8");
                const count = content.split(spec.patchTarget).length - 1;
                if (count === 0) return { ...spec, valid: false, error: "patchTarget not found in file" };
                if (count > 1) return { ...spec, valid: false, error: `patchTarget appears ${count} times — ambiguous` };
                return { ...spec, valid: true, error: null };
            } catch (e) {
                return { ...spec, valid: false, error: e.message };
            }
        });

        const allValid = validation.every(v => v.valid);
        const patchId  = crypto.randomUUID();

        res.json({
            ok: true,
            patchId,
            goal,
            proposal: { ...proposal, patchSpecs: validation },
            allValid,
            canApply: allValid && validation.length > 0,
        });
    } catch (err) {
        logger.error(`[GeneratePatch] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/apply-patch — apply patchSpecs via Engineering Pipeline ──────
router.post("/coding/apply-patch", async (req, res) => {
    try {
        const { patchSpecs = [], goal, cwd, commitMsg, requireApproval = false } = req.body;
        if (!patchSpecs.length) return res.status(400).json({ ok: false, error: "patchSpecs required" });
        if (!goal?.trim())      return res.status(400).json({ ok: false, error: "goal required" });

        const ROOT = cwd || path.join(__dirname, "../../");

        // Step 1: Apply each patchSpec as a string replacement, save originals for undo
        const applied  = [];
        const originals = [];
        for (const spec of patchSpecs) {
            const absPath = path.isAbsolute(spec.targetFile)
                ? spec.targetFile
                : path.join(ROOT, spec.targetFile);
            if (!fs.existsSync(absPath)) {
                return res.status(400).json({ ok: false, error: `File not found: ${spec.targetFile}` });
            }
            const original = fs.readFileSync(absPath, "utf8");
            if (!original.includes(spec.patchTarget)) {
                return res.status(400).json({ ok: false, error: `patchTarget not found in ${spec.targetFile}` });
            }
            const patched = original.replace(spec.patchTarget, spec.patchReplacement);
            fs.writeFileSync(absPath, patched, "utf8");
            originals.push({ targetFile: spec.targetFile, absPath, originalContent: original });
            applied.push(spec.targetFile);
        }

        // Step 2: Stage the changed files
        for (const f of originals) {
            spawnSync("git", ["add", f.absPath], { cwd: ROOT });
        }

        // Step 3: Record in patch history
        const histId = crypto.randomUUID();
        _addToPatchHistory({
            id:          histId,
            goal,
            commitMsg:   commitMsg || `feat: ${goal.slice(0, 80)} [ai-patch]`,
            patchSpecs,
            originals:   originals.map(o => ({ targetFile: o.targetFile, originalContent: o.originalContent })),
            appliedFiles: applied,
            appliedAt:   new Date().toISOString(),
            status:      "staged",
            pipelineId:  null,
        });

        // Step 4: Kick off Engineering Pipeline with the already-staged patch
        let pipeline = null;
        try {
            const pc = require("../services/engineeringPipelineCoordinator.cjs");
            const pipelinePromise = pc.runPipeline(goal, {
                patchSpec:      patchSpecs[0], // primary spec for pipeline validation
                requireApproval,
                priority:       "high",
            });
            pipelinePromise.catch(e => logger.warn(`[ApplyPatch] pipeline error: ${e.message}`));
            await new Promise(r => setTimeout(r, 80));
            const active = pc.getActivePipelines();
            pipeline = active[active.length - 1] || null;
            // Update history with pipeline ID
            if (pipeline) {
                const store = _loadPatchHistory();
                const rec   = store.patches.find(p => p.id === histId);
                if (rec) { rec.pipelineId = pipeline.pipelineId; rec.status = "pipeline_running"; }
                _savePatchHistory(store);
            }
        } catch (e) {
            logger.warn(`[ApplyPatch] pipeline launch failed: ${e.message}`);
        }

        res.json({
            ok:         true,
            histId,
            appliedFiles: applied,
            staged:     true,
            pipeline,
            message:    pipeline
                ? `Applied ${applied.length} file(s), pipeline ${pipeline.pipelineId} started`
                : `Applied ${applied.length} file(s) and staged — pipeline unavailable`,
        });
    } catch (err) {
        logger.error(`[ApplyPatch] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/convert-to-mission — patch → Mission ─────────────────────────
router.post("/coding/convert-to-mission", async (req, res) => {
    try {
        const { goal, patchSpecs = [], affectedFiles = [], confidence, riskLevel } = req.body;
        if (!goal?.trim()) return res.status(400).json({ ok: false, error: "goal required" });

        const mm = _missionMemory();
        if (!mm) return res.status(503).json({ ok: false, error: "missionMemory unavailable" });

        const subtasks = [
            { description: `Review AI-generated patch for: ${goal}`, status: "pending" },
            ...patchSpecs.map(s => ({ description: `Apply patch to ${s.targetFile}`, status: "pending" })),
            { description: "Run tests and verify no regressions", status: "pending" },
            { description: "Commit with conventional commit message", status: "pending" },
        ];

        const mission = mm.createMission({
            objective: goal,
            priority:  riskLevel === "high" ? "high" : riskLevel === "medium" ? "medium" : "low",
            subtasks,
            metadata: {
                source:       "ai-patch-proposal",
                affectedFiles,
                confidence,
                riskLevel,
                patchSpecCount: patchSpecs.length,
            },
        });

        res.json({ ok: true, mission });
    } catch (err) {
        logger.error(`[ConvertToMission] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /coding/patch-history — list applied AI patches ───────────────────────
router.get("/coding/patch-history", (req, res) => {
    try {
        const { limit = 20 } = req.query;
        const store = _loadPatchHistory();
        res.json({ ok: true, patches: store.patches.slice(0, Number(limit)) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/undo-patch — revert the most recent or a specific AI patch ───
router.post("/coding/undo-patch", (req, res) => {
    try {
        const { histId, cwd } = req.body;
        const store  = _loadPatchHistory();
        const idx    = histId
            ? store.patches.findIndex(p => p.id === histId)
            : store.patches.findIndex(p => p.status !== "undone");

        if (idx === -1) return res.status(404).json({ ok: false, error: "Patch not found" });

        const rec    = store.patches[idx];
        const ROOT   = cwd || path.join(__dirname, "../../");
        const undone = [];
        const errors = [];

        for (const orig of rec.originals || []) {
            try {
                const absPath = path.isAbsolute(orig.targetFile)
                    ? orig.targetFile
                    : path.join(ROOT, orig.targetFile);
                fs.writeFileSync(absPath, orig.originalContent, "utf8");
                spawnSync("git", ["add", absPath], { cwd: ROOT });
                undone.push(orig.targetFile);
            } catch (e) {
                errors.push(`${orig.targetFile}: ${e.message}`);
            }
        }

        store.patches[idx].status    = "undone";
        store.patches[idx].undoneAt  = new Date().toISOString();
        _savePatchHistory(store);

        res.json({ ok: true, undone, errors, histId: rec.id });
    } catch (err) {
        logger.error(`[UndoPatch] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
//  ACP-3: ENGINEERING SMELL DETECTION (PROACTIVE RECOMMENDATIONS)
// ══════════════════════════════════════════════════════════════════════════════

function _smellDetector() { return _try(() => require("../services/engineeringSmellDetector.cjs")); }

// ── GET /coding/smells — scan repo and return recommendation cards ─────────────
router.get("/coding/smells", async (req, res) => {
    try {
        const { cwd, enrichAI } = req.query;
        const root = cwd || path.join(__dirname, "../../");

        const sd = _smellDetector();
        if (!sd) return res.status(503).json({ ok: false, error: "smell detector unavailable" });

        const result = sd.scan(root);

        // Optional AI enrichment: for high-severity smells, auto-generate patch proposals
        if (enrichAI === "true" && result.smells.length) {
            const highSmells = result.smells.filter(s => s.severity === "high" && s.patchHint && s.file).slice(0, 3);
            await Promise.allSettled(highSmells.map(async (smell) => {
                try {
                    const absPath = path.isAbsolute(smell.file)
                        ? smell.file
                        : path.join(root, smell.file);
                    const fileContent = fs.existsSync(absPath)
                        ? fs.readFileSync(absPath, "utf8").slice(0, 3000)
                        : "";
                    const system = _buildRepoContext({ cwd: root, filePath: smell.file, fileContent });
                    const prompt = `Given this engineering smell: "${smell.detail}" in file ${smell.file} at line ${smell.line || "unknown"}, and the hint: "${smell.patchHint}", generate ONLY valid JSON:
{
  "patchTarget": "exact string to replace (must appear in file, short)",
  "patchReplacement": "replacement string",
  "explanation": "one line"
}
If you cannot produce a safe, targeted single-string replacement, respond with {"patchTarget":null}.`;
                    const raw   = await ai.callAI(prompt, { system });
                    const m     = raw.match(/\{[\s\S]+\}/);
                    if (m) {
                        const parsed = JSON.parse(m[0]);
                        if (parsed.patchTarget) {
                            smell.aiPatchSpec = {
                                targetFile:        smell.file,
                                patchTarget:       parsed.patchTarget,
                                patchReplacement:  parsed.patchReplacement || "",
                                description:       parsed.explanation || smell.patchHint,
                            };
                        }
                    }
                } catch {}
            }));
        }

        res.json({ ok: true, ...result });
    } catch (err) {
        logger.error(`[Smells] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/smells/dismiss — dismiss a smell ────────────────────────────
router.post("/coding/smells/dismiss", (req, res) => {
    try {
        const { smellId } = req.body;
        if (!smellId) return res.status(400).json({ ok: false, error: "smellId required" });
        const sd = _smellDetector();
        if (!sd) return res.status(503).json({ ok: false, error: "smell detector unavailable" });
        res.json(sd.dismiss(smellId));
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/smells/undismiss ─────────────────────────────────────────────
router.post("/coding/smells/undismiss", (req, res) => {
    try {
        const { smellId } = req.body;
        if (!smellId) return res.status(400).json({ ok: false, error: "smellId required" });
        const sd = _smellDetector();
        if (!sd) return res.status(503).json({ ok: false, error: "smell detector unavailable" });
        res.json(sd.undismiss(smellId));
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
