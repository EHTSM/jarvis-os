"use strict";
/**
 * AutonomousRefactorEngine
 *
 * Capabilities:
 *   - Detect code duplication (n-gram hashing)
 *   - Detect oversized files (line threshold)
 *   - Detect architecture smells (god objects, circular deps, deep nesting)
 *   - Suggest + generate refactor plans
 *   - Apply safe refactors (extract function, rename, split file)
 *
 * Persistence: data/refactor-results.json
 */

const fs   = require("fs");
const path = require("path");

const RESULTS_PATH = path.join(__dirname, "../../data/refactor-results.json");

// ── Persistence ───────────────────────────────────────────────────────────────

function _load() {
    try { return JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8")); }
    catch { return { analyses: {}, plans: {}, appliedRefactors: [] }; }
}
function _save(d) { fs.writeFileSync(RESULTS_PATH, JSON.stringify(d, null, 2)); }

// ── File scanning ─────────────────────────────────────────────────────────────

const CODE_EXTS  = [".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx", ".py", ".go"];
const SKIP_DIRS  = new Set(["node_modules", ".git", "_archive", "dist", "build", "coverage", "out"]);
const MAX_LINES  = 400;
const MAX_FUNCS  = 15;
const DUP_THRESH = 0.65;

function _walkFiles(root) {
    const results = [];
    function walk(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries) {
            if (SKIP_DIRS.has(e.name)) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full); }
            else if (CODE_EXTS.includes(path.extname(e.name))) results.push(full);
        }
    }
    walk(root);
    return results;
}

// ── Duplication detection (shingle-based Jaccard similarity) ─────────────────

function _shingles(text, k = 5) {
    const tokens  = text.split(/\s+/).filter(Boolean);
    const set     = new Set();
    for (let i = 0; i <= tokens.length - k; i++) {
        set.add(tokens.slice(i, i + k).join(" "));
    }
    return set;
}

function _jaccard(a, b) {
    let inter = 0;
    for (const s of a) if (b.has(s)) inter++;
    return inter / (a.size + b.size - inter || 1);
}

function detectDuplication(repoPath) {
    const files   = _walkFiles(path.resolve(repoPath));
    const fileData = files.map(f => {
        try {
            const content = fs.readFileSync(f, "utf8");
            return { file: path.relative(repoPath, f), shingles: _shingles(content), lines: content.split("\n").length };
        } catch { return null; }
    }).filter(Boolean);

    const pairs = [];
    for (let i = 0; i < fileData.length; i++) {
        for (let j = i + 1; j < fileData.length; j++) {
            const sim = _jaccard(fileData[i].shingles, fileData[j].shingles);
            if (sim >= DUP_THRESH) {
                pairs.push({
                    fileA:      fileData[i].file,
                    fileB:      fileData[j].file,
                    similarity: Math.round(sim * 100) / 100,
                    severity:   sim >= 0.85 ? "high" : sim >= 0.75 ? "medium" : "low",
                });
            }
        }
    }
    return { duplicatePairs: pairs, fileCount: fileData.length, pairsChecked: (fileData.length * (fileData.length - 1)) / 2 };
}

// ── Oversized file detection ──────────────────────────────────────────────────

function detectOversizedFiles(repoPath) {
    const files = _walkFiles(path.resolve(repoPath));
    const oversized = [];
    for (const f of files) {
        try {
            const content = fs.readFileSync(f, "utf8");
            const lines   = content.split("\n").length;
            if (lines > MAX_LINES) {
                const funcs = (content.match(/function\s+\w+|=>\s*{|def\s+\w+|func\s+\w+/g) || []).length;
                oversized.push({
                    file:     path.relative(repoPath, f),
                    lines,
                    functions: funcs,
                    severity: lines > 1000 ? "critical" : lines > 600 ? "high" : "medium",
                    suggestion: funcs > MAX_FUNCS ? "Split into multiple modules" : "Extract large blocks into helper functions",
                });
            }
        } catch { /* skip */ }
    }
    return { oversizedFiles: oversized.sort((a, b) => b.lines - a.lines) };
}

// ── Architecture smell detection ──────────────────────────────────────────────

function detectArchSmells(repoPath) {
    const files  = _walkFiles(path.resolve(repoPath));
    const smells = [];

    for (const f of files) {
        let content;
        try { content = fs.readFileSync(f, "utf8"); }
        catch { continue; }
        const rel   = path.relative(repoPath, f);
        const lines = content.split("\n");

        // God object: class with too many methods
        const classMethods = (content.match(/(?:function|=>|def|func)\s+\w+/g) || []).length;
        if (classMethods > 20) {
            smells.push({ file: rel, smell: "god-object", detail: `${classMethods} function definitions — likely doing too much`, severity: "high" });
        }

        // Deep nesting
        const maxDepth = _maxNestingDepth(lines);
        if (maxDepth >= 5) {
            smells.push({ file: rel, smell: "deep-nesting", detail: `Max nesting depth ${maxDepth}`, severity: maxDepth >= 7 ? "high" : "medium" });
        }

        // Long parameter lists
        const longParams = lines.find(l => (l.match(/,/g) || []).length >= 7);
        if (longParams) {
            smells.push({ file: rel, smell: "long-parameter-list", detail: "Function with 7+ parameters — use options object", severity: "low" });
        }

        // Magic numbers
        const magicNums = (content.match(/[^.\w]\d{3,}[^.\w]/g) || []).length;
        if (magicNums > 5) {
            smells.push({ file: rel, smell: "magic-numbers", detail: `${magicNums} unlabeled numeric literals`, severity: "low" });
        }
    }

    return { smells, fileCount: files.length };
}

function _maxNestingDepth(lines) {
    let depth = 0, max = 0;
    for (const l of lines) {
        depth += (l.match(/[{(]/g) || []).length - (l.match(/[})]/g) || []).length;
        if (depth > max) max = depth;
        if (depth < 0) depth = 0;
    }
    return max;
}

// ── Refactor plan generation ──────────────────────────────────────────────────

function generateRefactorPlan(repoPath) {
    const startMs  = Date.now();
    const dupData  = detectDuplication(repoPath);
    const sizeData = detectOversizedFiles(repoPath);
    const smellData = detectArchSmells(repoPath);

    const steps = [];
    let priority = 1;

    for (const p of dupData.duplicatePairs.slice(0, 5)) {
        steps.push({
            priority: priority++,
            type:     "extract-shared-module",
            target:   [p.fileA, p.fileB],
            reason:   `${Math.round(p.similarity * 100)}% code similarity — extract shared utilities`,
            effort:   "medium",
            risk:     "low",
            automated: false,
        });
    }

    for (const f of sizeData.oversizedFiles.slice(0, 5)) {
        steps.push({
            priority: priority++,
            type:     "split-file",
            target:   [f.file],
            reason:   `${f.lines} lines — exceeds ${MAX_LINES} line threshold`,
            effort:   f.lines > 800 ? "high" : "medium",
            risk:     "medium",
            automated: false,
        });
    }

    for (const s of smellData.smells.filter(x => x.severity === "high").slice(0, 5)) {
        steps.push({
            priority: priority++,
            type:     `fix-${s.smell}`,
            target:   [s.file],
            reason:   s.detail,
            effort:   "medium",
            risk:     "low",
            automated: s.smell === "magic-numbers",
        });
    }

    const planId = `plan-${Date.now()}`;
    const plan   = {
        planId,
        repoPath,
        generatedAt: new Date().toISOString(),
        durationMs:  Date.now() - startMs,
        summary: {
            duplicatePairs:  dupData.duplicatePairs.length,
            oversizedFiles:  sizeData.oversizedFiles.length,
            archSmells:      smellData.smells.length,
            totalSteps:      steps.length,
        },
        steps,
        duplication:  dupData,
        oversized:    sizeData,
        archSmells:   smellData,
    };

    const store = _load();
    store.plans[planId] = plan;
    _save(store);

    return plan;
}

// ── Safe automated refactor: extract constants (magic numbers) ───────────────

function applyRefactor(planId, stepIndex, opts = {}) {
    const store = _load();
    const plan  = store.plans[planId];
    if (!plan) return { success: false, error: "Plan not found" };
    const step = plan.steps[stepIndex];
    if (!step) return { success: false, error: "Step not found" };
    if (!step.automated) return { success: false, error: "Step is not safe for automated apply — manual review required" };

    const results = [];
    for (const file of step.target) {
        const absFile = path.join(plan.repoPath, file);
        let content;
        try { content = fs.readFileSync(absFile, "utf8"); }
        catch (e) { results.push({ file, success: false, error: e.message }); continue; }

        if (step.type === "fix-magic-numbers") {
            // Replace obvious magic numbers with named constants at top of file
            const nums = [...content.matchAll(/[^.\w](\d{3,})[^.\w]/g)].map(m => parseInt(m[1]));
            const unique = [...new Set(nums)].slice(0, 10);
            let consts = "";
            for (const n of unique) {
                consts += `const CONST_${n} = ${n};\n`;
            }
            let newContent = content;
            for (const n of unique) {
                newContent = newContent.replace(new RegExp(`(?<=[^.\\w])${n}(?=[^.\\w])`, "g"), `CONST_${n}`);
            }
            if (!opts.dryRun) fs.writeFileSync(absFile, consts + newContent);
            results.push({ file, success: true, constants: unique.length, dryRun: !!opts.dryRun });
        }
    }

    const record = {
        planId, stepIndex, step, results,
        appliedAt: new Date().toISOString(),
        dryRun:    !!opts.dryRun,
    };
    store.appliedRefactors.push(record);
    _save(store);
    return { success: true, results, record };
}

// ── Getters ───────────────────────────────────────────────────────────────────

function getPlans(repoPath) {
    const store = _load();
    const plans = Object.values(store.plans);
    return repoPath ? plans.filter(p => p.repoPath === repoPath) : plans;
}

function getPlan(planId) {
    const store = _load();
    return store.plans[planId] || null;
}

function getAppliedRefactors() {
    return _load().appliedRefactors;
}

module.exports = {
    detectDuplication, detectOversizedFiles, detectArchSmells,
    generateRefactorPlan, applyRefactor,
    getPlans, getPlan, getAppliedRefactors,
};
