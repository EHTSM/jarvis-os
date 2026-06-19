"use strict";
/**
 * Repository Editing Engine — ACP-6
 *
 * Transforms a plain-language goal into a multi-file patch bundle:
 *   1. Repo analysis      — file list, entry points, symbol grep
 *   2. Dependency graph   — who imports whom (static analysis)
 *   3. AI multi-file plan — which files, what role (primary/affected/test/doc/changelog)
 *   4. Per-file patches   — AI generates patchSpec per file with full context
 *   5. Bundle assembly    — validation, rollback manifest, confidence scoring
 *   6. Pipeline execution — apply in dependency order through Engineering Pipeline (I7)
 *
 * Reuses: knowledgeGraph, missionMemory, engineeringPipelineCoordinator, aiService,
 *         engineeringRuleRegistry.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const { execSync, spawnSync } = require("child_process");

const DATA_DIR     = path.join(__dirname, "../../data");
const BUNDLES_FILE = path.join(DATA_DIR, "acp6-bundles.json");

const CODE_EXTS = [".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx", ".py", ".go", ".md", ".json"];
const SKIP_DIRS = new Set(["node_modules", ".git", "_archive", "dist", "build", "coverage", "out", ".next"]);

// ── Lazy services ─────────────────────────────────────────────────────────────

function _try(fn) { try { return fn(); } catch { return null; } }
function _ai()   { return _try(() => require("./aiService")); }
function _kg()   { return _try(() => require("./knowledgeGraph.cjs")); }
function _mm()   { return _try(() => require("./missionMemory.cjs")); }
function _pc()   { return _try(() => require("./engineeringPipelineCoordinator.cjs")); }
function _rr()   { return _try(() => require("./engineeringRuleRegistry.cjs")); }

// ── Persistence ───────────────────────────────────────────────────────────────

function _loadBundles() {
    try { return JSON.parse(fs.readFileSync(BUNDLES_FILE, "utf8")); }
    catch { return { bundles: {} }; }
}

function _saveBundles(data) {
    fs.writeFileSync(BUNDLES_FILE, JSON.stringify(data, null, 2));
}

function _saveBundle(bundle) {
    const data = _loadBundles();
    data.bundles[bundle.bundleId] = bundle;
    _saveBundles(data);
}

// ── File walker ───────────────────────────────────────────────────────────────

function _walkFiles(root, maxFiles = 800) {
    const results = [];
    function walk(dir) {
        if (results.length >= maxFiles) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries) {
            if (results.length >= maxFiles) return;
            if (SKIP_DIRS.has(e.name)) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (CODE_EXTS.includes(path.extname(e.name))) results.push(full);
        }
    }
    walk(root);
    return results;
}

// ── Dependency graph (static import analysis) ────────────────────────────────

/**
 * Build a lightweight dependency map: { relPath → [relPath, ...] }
 * Only tracks local imports (relative paths starting with . or ..)
 */
function _buildDepGraph(root, files) {
    const graph = {};
    const relFiles = files.map(f => path.relative(root, f));

    for (const absPath of files) {
        const rel  = path.relative(root, absPath);
        const ext  = path.extname(absPath);
        let content;
        try { content = fs.readFileSync(absPath, "utf8"); } catch { graph[rel] = []; continue; }

        const deps = new Set();

        if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) {
            // require() and import statements
            const patterns = [
                /require\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
                /from\s+["'](\.[^"']+)["']/g,
                /import\s+["'](\.[^"']+)["']/g,
            ];
            for (const re of patterns) {
                let m;
                while ((m = re.exec(content)) !== null) {
                    const importPath = m[1];
                    // Resolve relative to current file
                    const dir       = path.dirname(absPath);
                    const resolved  = path.resolve(dir, importPath);
                    // Try with common extensions
                    for (const tryExt of ["", ".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs", "/index.js"]) {
                        const candidate = resolved + tryExt;
                        const candRel   = path.relative(root, candidate);
                        if (relFiles.includes(candRel)) { deps.add(candRel); break; }
                    }
                }
            }
        }

        graph[rel] = [...deps];
    }

    return graph;
}

/**
 * Topological sort of dependency graph.
 * Returns files in dependency-first order (dependencies before dependents).
 */
function _topoSort(graph) {
    const visited = new Set();
    const order   = [];

    function visit(node) {
        if (visited.has(node)) return;
        visited.add(node);
        for (const dep of graph[node] || []) visit(dep);
        order.push(node);
    }

    for (const node of Object.keys(graph)) visit(node);
    return order;
}

// ── Symbol search (grep for identifiers) ─────────────────────────────────────

function _grepSymbol(root, symbol, maxResults = 20) {
    try {
        const result = execSync(
            `grep -rn --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" --include="*.cjs" --include="*.mjs" -l "${symbol}" . 2>/dev/null | head -${maxResults}`,
            { cwd: root, timeout: 5000, encoding: 'utf8' }
        );
        return result.trim().split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''));
    } catch { return []; }
}

// ── Engineering rules context ─────────────────────────────────────────────────

function _rulesCtx() {
    try {
        const rr = _rr();
        if (!rr) return '';
        const { rules } = rr.listRules({ limit: 8, autoApply: true });
        return rules.map(r => `- ${r.description || r.name}`).join('\n');
    } catch { return ''; }
}

// ── Step 1: Repo analysis ─────────────────────────────────────────────────────

function _analyzeRepo(root) {
    const files   = _walkFiles(root);
    const relFiles = files.map(f => path.relative(root, f));

    // Entry points heuristic
    const entryPoints = relFiles.filter(f =>
        /^(index|main|app|server)\.(js|ts|jsx|tsx|cjs|mjs)$/.test(path.basename(f)) ||
        f.includes('backend/index') || f.includes('src/index') || f.includes('server.js')
    ).slice(0, 10);

    // Git recent changes
    let recentFiles = [];
    try {
        const r = execSync('git diff --name-only HEAD~3 HEAD 2>/dev/null || git diff --name-only HEAD 2>/dev/null', { cwd: root, timeout: 3000, encoding: 'utf8' });
        recentFiles = r.trim().split('\n').filter(Boolean).slice(0, 20);
    } catch {}

    const depGraph = _buildDepGraph(root, files);

    return {
        totalFiles:   files.length,
        relFiles:     relFiles.slice(0, 200),  // send representative set to AI
        entryPoints,
        recentFiles,
        depGraph,
        absFiles:     files,
        root,
    };
}

// ── Step 2: AI multi-file plan ────────────────────────────────────────────────

async function _planBundle(goal, repoInfo, opts = {}) {
    const ai     = _ai();
    if (!ai) throw new Error("aiService unavailable");
    const rules  = _rulesCtx();

    const fileList = repoInfo.relFiles.slice(0, 80).join('\n');

    const system = `You are a senior software engineer performing a repository-wide code change.
You have access to a complete file list and dependency graph.
${rules ? `\nEngineering rules to follow:\n${rules}` : ''}
Repository: ${path.basename(repoInfo.root)}
Total files: ${repoInfo.totalFiles}
Entry points: ${repoInfo.entryPoints.join(', ')}`;

    const prompt = `Goal: ${goal}

Repository files (sample):
${fileList}

Recent changed files: ${repoInfo.recentFiles.join(', ') || 'none'}

Produce a MULTI-FILE EDIT PLAN as JSON (no fences, no preamble):
{
  "summary": "1-2 sentence summary of what will change",
  "strategy": "approach description",
  "confidence": 0.0-1.0,
  "riskLevel": "low|medium|high",
  "riskReason": "why",
  "estimatedFiles": 3,
  "commitMsg": "conventional commit message",
  "changelog": "one-line changelog entry",
  "files": [
    {
      "path": "relative/path/to/file.js",
      "role": "primary|affected|test|docs|changelog",
      "reason": "why this file needs to change",
      "changeType": "rename|refactor|add|update|migrate|generate",
      "priority": 1
    }
  ]
}

Include only files that actually need to change. Max 15 files. Order by priority (1=highest).
For rename goals: include all files that import the renamed symbol.
For API migrations: include all call sites.
For test goals: include the source file and its test file.`;

    const raw = await ai.callAI(prompt, { system });
    const m   = raw.match(/\{[\s\S]+\}/);
    if (!m) throw new Error("AI returned no JSON plan");
    return JSON.parse(m[0]);
}

// ── Step 3: Per-file patch generation ────────────────────────────────────────

async function _generateFilePatch(goal, plan, fileRole, repoInfo) {
    const ai  = _ai();
    if (!ai) throw new Error("aiService unavailable");

    const absPath = path.isAbsolute(fileRole.path)
        ? fileRole.path
        : path.join(repoInfo.root, fileRole.path);

    let fileContent = '';
    try { fileContent = fs.readFileSync(absPath, "utf8"); } catch {}

    const isNew = !fs.existsSync(absPath);

    if (isNew && fileRole.changeType === 'generate') {
        // Generate new file content
        const system = `You are generating a new file for a codebase. Return only the file content, no fences.`;
        const content = await ai.callAI(
            `Generate ${fileRole.path} for goal: ${goal}\nPlan summary: ${plan.summary}\nReason: ${fileRole.reason}`,
            { system }
        );
        return {
            path:      fileRole.path,
            absPath,
            role:      fileRole.role,
            changeType: fileRole.changeType,
            isNew:     true,
            newContent: content.replace(/^```[a-z]*\n/, '').replace(/\n```$/, ''),
            patchSpecs: [],
            valid:     true,
            confidence: plan.confidence || 0.7,
        };
    }

    if (!fileContent) {
        return { path: fileRole.path, absPath, role: fileRole.role, patchSpecs: [], valid: false, error: 'File not found', isNew: false };
    }

    // Context: related imports, same-dir files
    const dir       = path.dirname(fileRole.path);
    const siblings  = repoInfo.relFiles.filter(f => path.dirname(f) === dir && f !== fileRole.path).slice(0, 5);

    const system = `You are performing targeted code surgery. Return ONLY valid JSON, no fences.
Goal: ${goal}
Plan: ${plan.summary}
Strategy: ${plan.strategy}
This file's role: ${fileRole.role} — ${fileRole.reason}
Sibling files: ${siblings.join(', ')}`;

    const prompt = `File: ${fileRole.path}
Content:
\`\`\`
${fileContent.slice(0, 3000)}
\`\`\`

Produce JSON patch specs for this file (return [] if no change needed):
{
  "patchSpecs": [
    {
      "patchTarget": "exact string to replace (must appear EXACTLY ONCE in the file)",
      "patchReplacement": "replacement string",
      "description": "what this specific change does"
    }
  ],
  "explanation": "what changed in this file and why",
  "confidence": 0.0-1.0
}

Rules:
- patchTarget must be a UNIQUE string in the file (copy it exactly)
- If you need to change multiple non-adjacent sections, return multiple patchSpecs
- Return empty patchSpecs array if file needs no change
- Never include line numbers in patchTarget`;

    let result;
    try {
        const raw  = await ai.callAI(prompt, { system });
        const m    = raw.match(/\{[\s\S]+\}/);
        result = m ? JSON.parse(m[0]) : { patchSpecs: [], explanation: raw.slice(0, 200), confidence: 0.3 };
    } catch {
        result = { patchSpecs: [], explanation: 'Failed to parse AI response', confidence: 0.2 };
    }

    // Validate each patchSpec against actual file content
    const validated = (result.patchSpecs || []).map(spec => {
        const count = fileContent.split(spec.patchTarget).length - 1;
        if (count === 0) return { ...spec, targetFile: fileRole.path, valid: false, error: 'patchTarget not found' };
        if (count > 1)  return { ...spec, targetFile: fileRole.path, valid: false, error: `appears ${count} times — ambiguous` };
        return { ...spec, targetFile: fileRole.path, valid: true };
    });

    return {
        path:        fileRole.path,
        absPath,
        role:        fileRole.role,
        changeType:  fileRole.changeType,
        isNew:       false,
        patchSpecs:  validated,
        explanation: result.explanation || '',
        confidence:  result.confidence || plan.confidence || 0.5,
        valid:       validated.length > 0 ? validated.every(v => v.valid) : true,
        error:       validated.find(v => !v.valid)?.error || null,
        originalContent: fileContent,
    };
}

// ── Step 4: Apply bundle ──────────────────────────────────────────────────────

function _applyFilePatch(filePatch) {
    const { absPath, patchSpecs, isNew, newContent, originalContent } = filePatch;

    if (isNew && newContent) {
        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(absPath, newContent, 'utf8');
        spawnSync('git', ['add', absPath], { encoding: 'utf8' });
        return { ok: true, written: true };
    }

    if (!patchSpecs?.length) return { ok: true, written: false };

    let content = originalContent || fs.readFileSync(absPath, 'utf8');
    for (const spec of patchSpecs) {
        if (!spec.valid) continue;
        content = content.replace(spec.patchTarget, spec.patchReplacement);
    }
    fs.writeFileSync(absPath, content, 'utf8');
    spawnSync('git', ['add', absPath], { encoding: 'utf8' });
    return { ok: true, written: true };
}

function _rollbackFile(filePatch) {
    const { absPath, isNew, originalContent } = filePatch;
    if (isNew) {
        try { fs.unlinkSync(absPath); } catch {}
        return { ok: true };
    }
    if (originalContent !== undefined) {
        fs.writeFileSync(absPath, originalContent, 'utf8');
        spawnSync('git', ['add', absPath], { encoding: 'utf8' });
        return { ok: true };
    }
    return { ok: false, error: 'No original content to restore' };
}

// ── Main public API ───────────────────────────────────────────────────────────

/**
 * planBundle(goal, repoPath, opts) → bundle object (not yet applied)
 */
async function planBundle(goal, repoPath, opts = {}) {
    const root      = path.resolve(repoPath || process.cwd());
    const bundleId  = crypto.randomUUID();

    const bundle = {
        bundleId,
        goal,
        repoPath:   root,
        status:     'planning',
        createdAt:  new Date().toISOString(),
        plan:       null,
        files:      [],
        rollbackManifest: [],
        metrics:    { filesTouched: 0, patchesValid: 0, patchesInvalid: 0, depConfidence: 0 },
        pipelineIds: [],
        missionId:  null,
        error:      null,
    };

    _saveBundle(bundle);

    try {
        // Step 1: Repo analysis
        const repoInfo = _analyzeRepo(root);
        bundle.repoInfo = { totalFiles: repoInfo.totalFiles, entryPoints: repoInfo.entryPoints, recentFiles: repoInfo.recentFiles };

        // Step 2: AI plan
        const plan = await _planBundle(goal, repoInfo, opts);
        bundle.plan   = plan;
        bundle.status = 'planned';
        _saveBundle(bundle);

        // Step 3: Per-file patch generation (parallel, max 6 at once)
        const filesToProcess = (plan.files || []).slice(0, 15);
        const CONCURRENCY = 4;
        const filePatches = [];

        for (let i = 0; i < filesToProcess.length; i += CONCURRENCY) {
            const chunk = filesToProcess.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
                chunk.map(f => _generateFilePatch(goal, plan, f, repoInfo).catch(e => ({
                    path: f.path, role: f.role, patchSpecs: [], valid: false, error: e.message,
                })))
            );
            filePatches.push(...results);
        }

        bundle.files = filePatches;

        // Step 4: Build dependency order for apply
        const depGraph  = {};
        for (const fp of filePatches) {
            depGraph[fp.path] = repoInfo.depGraph[fp.path] || [];
        }
        bundle.applyOrder   = _topoSort(depGraph).filter(p => filePatches.find(f => f.path === p));
        bundle.depGraph     = depGraph;

        // Step 5: Rollback manifest
        bundle.rollbackManifest = filePatches.map(fp => ({
            path:            fp.path,
            absPath:         fp.absPath,
            isNew:           fp.isNew,
            originalContent: fp.originalContent || null,
        }));

        // Metrics
        const valid   = filePatches.filter(f => f.valid).length;
        const invalid = filePatches.filter(f => !f.valid).length;
        const avgConf = filePatches.length
            ? filePatches.reduce((s, f) => s + (f.confidence || 0), 0) / filePatches.length
            : 0;

        bundle.metrics = {
            filesTouched:   filePatches.length,
            patchesValid:   valid,
            patchesInvalid: invalid,
            depConfidence:  Math.round(avgConf * 100),
            canApply:       valid > 0,
        };

        bundle.status = 'ready';

        // Create mission for visibility
        try {
            const mm = _mm();
            if (mm) {
                const mission = mm.createMission({
                    objective: `[ACP-6] ${goal.slice(0, 120)}`,
                    priority:  plan.riskLevel === 'high' ? 'high' : 'medium',
                    subtasks:  [
                        { description: `Repository analysis: ${repoInfo.totalFiles} files scanned` },
                        ...filePatches.slice(0, 8).map(f => ({ description: `Patch: ${f.path} (${f.role})` })),
                        { description: 'Apply bundle through Engineering Pipeline' },
                    ],
                    metadata: { source: 'acp6-bundle', bundleId, filesTouched: filePatches.length },
                });
                bundle.missionId = mission.id;
            }
        } catch {}

    } catch (e) {
        bundle.status = 'failed';
        bundle.error  = e.message;
    }

    _saveBundle(bundle);
    return bundle;
}

/**
 * applyBundle(bundleId, opts) → { ok, results, pipelineId }
 * Applies all valid file patches in dependency order, then runs pipeline.
 */
async function applyBundle(bundleId, opts = {}) {
    const data   = _loadBundles();
    const bundle = data.bundles[bundleId];
    if (!bundle) throw new Error(`bundle ${bundleId} not found`);
    if (bundle.status === 'applied') throw new Error('bundle already applied');

    bundle.status   = 'applying';
    bundle.appliedAt = new Date().toISOString();
    _saveBundle(bundle);

    const results = [];
    const applyOrder = bundle.applyOrder || bundle.files.map(f => f.path);

    // Apply in dependency order
    for (const filePath of applyOrder) {
        const fp = bundle.files.find(f => f.path === filePath);
        if (!fp || !fp.valid) {
            results.push({ path: filePath, ok: false, skipped: true, reason: fp?.error || 'invalid' });
            continue;
        }
        try {
            const r = _applyFilePatch(fp);
            results.push({ path: filePath, ok: r.ok, written: r.written });
        } catch (e) {
            results.push({ path: filePath, ok: false, error: e.message });
        }
    }

    bundle.applyResults = results;

    const applied = results.filter(r => r.ok && r.written).map(r => r.path);

    // Run Engineering Pipeline (I7)
    let pipelineId = null;
    try {
        const pc = _pc();
        if (pc && applied.length > 0) {
            const primarySpec = bundle.files.find(f => f.role === 'primary' && f.patchSpecs?.length > 0);
            const pipelineRun = await pc.runPipeline(bundle.goal, {
                patchSpec:       primarySpec ? { ...primarySpec.patchSpecs[0], targetFile: primarySpec.path } : null,
                requireApproval: opts.requireApproval || false,
                priority:        bundle.plan?.riskLevel === 'high' ? 'high' : 'medium',
                commitMsg:       bundle.plan?.commitMsg || `feat: ${bundle.goal.slice(0, 60)}`,
            });
            pipelineId = pipelineRun.pipelineId;
            bundle.pipelineIds.push(pipelineId);
        }
    } catch (e) {
        bundle.pipelineError = e.message;
    }

    bundle.status = 'applied';
    bundle.metrics.filesApplied = applied.length;
    _saveBundle(bundle);

    return {
        ok:         true,
        bundleId,
        results,
        applied,
        pipelineId,
        commitMsg:  bundle.plan?.commitMsg,
        changelog:  bundle.plan?.changelog,
    };
}

/**
 * rollbackBundle(bundleId) → { ok, restored }
 */
async function rollbackBundle(bundleId) {
    const data   = _loadBundles();
    const bundle = data.bundles[bundleId];
    if (!bundle) throw new Error(`bundle ${bundleId} not found`);

    const manifest = bundle.rollbackManifest || bundle.files || [];
    const restored = [];

    // Rollback in reverse apply order
    const reverseOrder = [...(bundle.applyOrder || manifest.map(f => f.path))].reverse();

    for (const filePath of reverseOrder) {
        const fp = manifest.find(f => f.path === filePath);
        if (!fp) continue;
        try {
            const r = _rollbackFile(fp);
            restored.push({ path: filePath, ok: r.ok, error: r.error });
        } catch (e) {
            restored.push({ path: filePath, ok: false, error: e.message });
        }
    }

    bundle.status        = 'rolled_back';
    bundle.rollbackAt    = new Date().toISOString();
    bundle.rollbackResults = restored;
    _saveBundle(bundle);

    return { ok: true, bundleId, restored };
}

/**
 * getBundle(bundleId) → bundle object
 */
function getBundle(bundleId) {
    const data = _loadBundles();
    return data.bundles[bundleId] || null;
}

/**
 * listBundles(opts) → [bundle, ...]
 */
function listBundles(opts = {}) {
    const data    = _loadBundles();
    const all     = Object.values(data.bundles);
    const limit   = opts.limit || 20;
    return all
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
}

/**
 * getBundleStats() → aggregate metrics
 */
function getBundleStats() {
    const bundles = listBundles({ limit: 100 });
    const applied = bundles.filter(b => b.status === 'applied');
    const rolled  = bundles.filter(b => b.status === 'rolled_back');
    const totalPatches = bundles.reduce((s, b) => s + (b.metrics?.patchesValid || 0), 0);
    const totalFiles   = bundles.reduce((s, b) => s + (b.metrics?.filesTouched || 0), 0);
    const avgConf      = applied.length
        ? Math.round(applied.reduce((s, b) => s + (b.metrics?.depConfidence || 0), 0) / applied.length)
        : 0;

    // Scores
    const patchSuccessRate = totalPatches > 0
        ? Math.round((applied.length / Math.max(bundles.length, 1)) * 100)
        : 0;
    const rollbackRate = bundles.length > 0
        ? Math.round((rolled.length / bundles.length) * 100)
        : 0;
    const replaceCursor = Math.min(100, patchSuccessRate * 0.6 + avgConf * 0.4);
    const ooplixScore   = Math.min(100, totalFiles * 2 + applied.length * 5);

    return {
        total:           bundles.length,
        applied:         applied.length,
        rolledBack:      rolled.length,
        totalFilesTouched: totalFiles,
        totalPatches,
        avgDepConfidence: avgConf,
        patchSuccessRate,
        rollbackRate,
        replaceCursorScore: Math.round(replaceCursor),
        buildOoplixScore:   Math.min(100, Math.round(ooplixScore)),
    };
}

module.exports = {
    planBundle,
    applyBundle,
    rollbackBundle,
    getBundle,
    listBundles,
    getBundleStats,
};
