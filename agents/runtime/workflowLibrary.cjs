"use strict";
/**
 * Phase 483 — Smart Workflow Library
 *
 * Reusable, searchable, replayable, editable, exportable workflow catalog.
 * Aggregates built-in workflows + custom user-defined workflows.
 * Stored in data/workflow-library.json (custom only; builtins are code-defined).
 * Max 200 custom workflows.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const LIB_PATH    = path.join(__dirname, "../../data/workflow-library.json");
const MAX_CUSTOM  = 200;

// ── Built-in workflow catalog ─────────────────────────────────────────────────
const BUILTIN_WORKFLOWS = [
    {
        id:       "frontend-recovery",
        name:     "Frontend Recovery",
        category: "recovery",
        tags:     ["frontend", "nginx", "static", "recovery"],
        goal:     "Recover a degraded or broken frontend runtime",
        chain:    "recover-frontend-runtime",
        steps: [
            { label: "Check nginx status",        cmd: "systemctl status nginx",          approvalLevel: "SAFE"    },
            { label: "Validate static files",     cmd: "ls -la /var/www/jarvis/",         approvalLevel: "SAFE"    },
            { label: "Reload nginx",              cmd: "systemctl reload nginx",           approvalLevel: "CAUTION" },
            { label: "Verify frontend responds",  cmd: "curl -s -o /dev/null -w '%{http_code}' http://localhost/", approvalLevel: "SAFE" },
        ],
        replayable:   true,
        exportable:   true,
        builtin:      true,
        usageCount:   0,
    },
    {
        id:       "backend-restore",
        name:     "Backend Restore",
        category: "recovery",
        tags:     ["backend", "pm2", "node", "restore"],
        goal:     "Restore a stopped or crashed backend service",
        chain:    "recover-backend",
        steps: [
            { label: "Check backend process",    cmd: "pm2 list",                         approvalLevel: "SAFE"    },
            { label: "Reload backend",           cmd: "pm2 reload jarvis-backend",        approvalLevel: "CAUTION" },
            { label: "Check API health",         cmd: "curl -s http://localhost:5050/health", approvalLevel: "SAFE" },
            { label: "Verify logs clean",        cmd: "pm2 logs jarvis-backend --lines 20 --nostream", approvalLevel: "SAFE" },
        ],
        replayable:   true,
        exportable:   true,
        builtin:      true,
        usageCount:   0,
    },
    {
        id:       "deployment-validation",
        name:     "Deployment Validation",
        category: "deployment",
        tags:     ["deploy", "validation", "health", "verify"],
        goal:     "Validate a deployment is healthy before marking it complete",
        chain:    "health-check",
        steps: [
            { label: "API health endpoint",      cmd: "curl -s http://localhost:5050/health", approvalLevel: "SAFE" },
            { label: "Check process running",    cmd: "pm2 show jarvis-backend",          approvalLevel: "SAFE"    },
            { label: "Check error rate in logs", cmd: "pm2 logs jarvis-backend --lines 50 --nostream | grep -c ERROR || true", approvalLevel: "SAFE" },
            { label: "Verify database access",   cmd: "node -e \"require('./backend/db'); console.log('db ok')\"", approvalLevel: "SAFE" },
        ],
        replayable:   true,
        exportable:   true,
        builtin:      true,
        usageCount:   0,
    },
    {
        id:       "environment-bootstrap",
        name:     "Environment Bootstrap",
        category: "setup",
        tags:     ["bootstrap", "setup", "env", "install", "init"],
        goal:     "Bootstrap a fresh engineering environment",
        chain:    "deployment-readiness",
        steps: [
            { label: "Check Node version",       cmd: "node --version",                   approvalLevel: "SAFE"    },
            { label: "Install dependencies",     cmd: "npm install --prefer-offline",     approvalLevel: "CAUTION" },
            { label: "Check environment vars",   cmd: "node -e \"['NODE_ENV','PORT'].forEach(k => console.log(k, process.env[k] || 'MISSING'))\"", approvalLevel: "SAFE" },
            { label: "Run quick sanity test",    cmd: "npm test --if-present 2>&1 | tail -5", approvalLevel: "SAFE" },
        ],
        replayable:   true,
        exportable:   true,
        builtin:      true,
        usageCount:   0,
    },
    {
        id:       "dependency-repair",
        name:     "Dependency Repair",
        category: "maintenance",
        tags:     ["npm", "dependencies", "repair", "node_modules"],
        goal:     "Repair broken or inconsistent npm dependencies",
        chain:    "dependency-resolution",
        steps: [
            { label: "Audit dependencies",       cmd: "npm audit --audit-level=high",     approvalLevel: "SAFE"    },
            { label: "Remove node_modules",      cmd: "rm -rf node_modules",              approvalLevel: "CAUTION" },
            { label: "Clean npm cache",          cmd: "npm cache clean --force",          approvalLevel: "CAUTION" },
            { label: "Fresh install",            cmd: "npm install",                      approvalLevel: "CAUTION" },
            { label: "Verify install",           cmd: "npm ls --depth=0 2>&1 | head -20", approvalLevel: "SAFE"   },
        ],
        replayable:   true,
        exportable:   true,
        builtin:      true,
        usageCount:   0,
    },
    {
        id:       "git-safe-update",
        name:     "Git Safe Update",
        category: "deployment",
        tags:     ["git", "pull", "update", "safe"],
        goal:     "Pull latest changes safely with conflict detection",
        chain:    "git-safe-update",
        steps: [
            { label: "Check working tree",       cmd: "git status --short",               approvalLevel: "SAFE"    },
            { label: "Stash local changes",      cmd: "git stash",                        approvalLevel: "CAUTION" },
            { label: "Pull latest",              cmd: "git pull --ff-only origin main",   approvalLevel: "CAUTION" },
            { label: "Restore stash if any",     cmd: "git stash pop 2>/dev/null || true", approvalLevel: "CAUTION" },
            { label: "Verify HEAD",              cmd: "git log --oneline -3",             approvalLevel: "SAFE"    },
        ],
        replayable:   true,
        exportable:   true,
        builtin:      true,
        usageCount:   0,
    },
    {
        id:       "pressure-relief",
        name:     "Runtime Pressure Relief",
        category: "recovery",
        tags:     ["pressure", "recovery", "memory", "runtime"],
        goal:     "Reduce runtime pressure when system is under stress",
        chain:    "recover-backend",
        steps: [
            { label: "Check current pressure",   cmd: "node -e \"const p=require('./agents/runtime/runtimePressureMonitor.cjs');console.log(JSON.stringify(p.computePressure()))\"", approvalLevel: "SAFE" },
            { label: "Clear dead letter queue",  cmd: "node -e \"const d=require('./agents/runtime/deadLetterQueue.cjs');d.clear&&d.clear();console.log('DLQ cleared')\"", approvalLevel: "CAUTION" },
            { label: "Reload backend",           cmd: "pm2 reload jarvis-backend",        approvalLevel: "CAUTION" },
            { label: "Verify pressure reduced",  cmd: "node -e \"const p=require('./agents/runtime/runtimePressureMonitor.cjs');const r=p.computePressure();console.log('level:',r.level,'score:',r.score)\"", approvalLevel: "SAFE" },
        ],
        replayable:   true,
        exportable:   true,
        builtin:      true,
        usageCount:   0,
    },
];

// ── Persistence ───────────────────────────────────────────────────────────────
function _loadCustom() {
    try { return JSON.parse(fs.readFileSync(LIB_PATH, "utf8")); }
    catch { return []; }
}

function _saveCustom(list) {
    try { fs.writeFileSync(LIB_PATH, JSON.stringify(list, null, 2)); } catch {}
}

function _genId() {
    return `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

// ── Search helpers ────────────────────────────────────────────────────────────
function _score(wf, query) {
    const q = query.toLowerCase();
    let score = 0;
    if (wf.name.toLowerCase().includes(q))     score += 10;
    if (wf.goal.toLowerCase().includes(q))     score += 6;
    if (wf.category.toLowerCase().includes(q)) score += 5;
    if (wf.tags.some(t => t.includes(q)))      score += 4;
    if (wf.id.toLowerCase().includes(q))       score += 3;
    return score;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** List all workflows (builtin + custom), with optional category/tag filter. */
function listWorkflows({ category, tag, builtin } = {}) {
    const custom = _loadCustom();
    const all    = [...BUILTIN_WORKFLOWS, ...custom];
    return all
        .filter(w => !category || w.category === category)
        .filter(w => !tag      || w.tags.includes(tag))
        .filter(w => builtin === undefined || w.builtin === builtin)
        .map(w => ({
            id:         w.id,
            name:       w.name,
            category:   w.category,
            tags:       w.tags,
            goal:       w.goal,
            chain:      w.chain,
            stepCount:  w.steps.length,
            replayable: w.replayable,
            exportable: w.exportable,
            builtin:    !!w.builtin,
            usageCount: w.usageCount || 0,
        }));
}

/** Get full workflow definition (including steps). */
function getWorkflow(id) {
    const builtin = BUILTIN_WORKFLOWS.find(w => w.id === id);
    if (builtin) return { ...builtin };
    return _loadCustom().find(w => w.id === id) || null;
}

/** Search workflows by free-text query. Returns ranked results. */
function searchWorkflows(query, { limit = 10 } = {}) {
    if (!query || !query.trim()) return listWorkflows().slice(0, limit);
    const q   = query.trim();
    const all = [...BUILTIN_WORKFLOWS, ..._loadCustom()];
    return all
        .map(w => ({ ...w, _score: _score(w, q) }))
        .filter(w => w._score > 0)
        .sort((a, b) => b._score - a._score)
        .slice(0, limit)
        .map(({ _score, ...w }) => ({
            id: w.id, name: w.name, category: w.category,
            goal: w.goal, tags: w.tags, stepCount: w.steps.length,
            builtin: !!w.builtin, chain: w.chain,
        }));
}

/** Create a custom workflow. */
function createWorkflow(opts = {}) {
    const custom = _loadCustom();
    if (custom.length >= MAX_CUSTOM) return { created: false, error: "workflow library full (200 max)" };

    const name = (opts.name || "").trim().slice(0, 80);
    const goal = (opts.goal || "").trim().slice(0, 200);
    if (!name) return { created: false, error: "name required" };
    if (!goal) return { created: false, error: "goal required" };

    const steps = (opts.steps || []).slice(0, 30).map(s => ({
        label:         (s.label || s.cmd || "step").slice(0, 80),
        cmd:           (s.cmd   || "").slice(0, 500),
        approvalLevel: ["SAFE", "CAUTION", "CRITICAL"].includes(s.approvalLevel) ? s.approvalLevel : "SAFE",
    }));

    const wf = {
        id:         _genId(),
        name,
        category:   (opts.category || "custom").slice(0, 40),
        tags:       (opts.tags     || []).slice(0, 10).map(t => String(t).slice(0, 30)),
        goal,
        chain:      opts.chain || null,
        steps,
        replayable:  true,
        exportable:  true,
        builtin:     false,
        usageCount:  0,
        createdAt:   Date.now(),
    };

    custom.push(wf);
    _saveCustom(custom);
    return { created: true, workflow: wf };
}

/** Edit a custom workflow (builtin workflows cannot be edited). */
function editWorkflow(id, updates = {}) {
    if (BUILTIN_WORKFLOWS.find(w => w.id === id)) return { ok: false, error: "builtin workflows are read-only" };
    const custom = _loadCustom();
    const idx    = custom.findIndex(w => w.id === id);
    if (idx < 0) return { ok: false, error: "workflow not found" };

    const wf = custom[idx];
    if (updates.name)     wf.name     = updates.name.slice(0, 80);
    if (updates.goal)     wf.goal     = updates.goal.slice(0, 200);
    if (updates.category) wf.category = updates.category.slice(0, 40);
    if (updates.tags)     wf.tags     = updates.tags.slice(0, 10).map(t => String(t).slice(0, 30));
    if (updates.steps)    wf.steps    = updates.steps.slice(0, 30).map(s => ({
        label:         (s.label || s.cmd || "step").slice(0, 80),
        cmd:           (s.cmd   || "").slice(0, 500),
        approvalLevel: ["SAFE", "CAUTION", "CRITICAL"].includes(s.approvalLevel) ? s.approvalLevel : "SAFE",
    }));
    if (updates.chain !== undefined) wf.chain = updates.chain;
    wf.updatedAt = Date.now();
    _saveCustom(custom);
    return { ok: true, workflow: wf };
}

/** Delete a custom workflow. */
function deleteWorkflow(id) {
    if (BUILTIN_WORKFLOWS.find(w => w.id === id)) return { ok: false, error: "builtin workflows cannot be deleted" };
    const custom = _loadCustom();
    const idx    = custom.findIndex(w => w.id === id);
    if (idx < 0) return { ok: false, error: "workflow not found" };
    custom.splice(idx, 1);
    _saveCustom(custom);
    return { ok: true };
}

/** Export a workflow as JSON (portable). */
function exportJson(id) {
    const wf = getWorkflow(id);
    if (!wf) return null;
    return JSON.stringify({ ...wf, exportedAt: new Date().toISOString() }, null, 2);
}

/** Export a workflow as Markdown (human-readable). */
function exportMarkdown(id) {
    const wf = getWorkflow(id);
    if (!wf) return null;
    const lines = [
        `# ${wf.name}`,
        ``,
        `**Category:** ${wf.category}  `,
        `**Goal:** ${wf.goal}  `,
        `**Tags:** ${wf.tags.join(", ")}  `,
        `**Chain:** ${wf.chain || "manual"}`,
        ``,
        `## Steps`,
        ``,
    ];
    wf.steps.forEach((s, i) => {
        lines.push(`### Step ${i + 1}: ${s.label}`);
        lines.push(`*Approval: ${s.approvalLevel}*`);
        lines.push(s.cmd ? `\`\`\`bash\n${s.cmd}\n\`\`\`` : "_no command_");
        lines.push(``);
    });
    lines.push(`---`);
    lines.push(`*Exported from JARVIS Workflow Library — ${new Date().toISOString()}*`);
    return lines.join("\n");
}

/** Record workflow usage (increments usageCount for ranking). */
function recordUsage(id) {
    if (BUILTIN_WORKFLOWS.find(w => w.id === id)) return; // builtins tracked in-memory only
    const custom = _loadCustom();
    const wf     = custom.find(w => w.id === id);
    if (wf) { wf.usageCount = (wf.usageCount || 0) + 1; _saveCustom(custom); }
}

/** Get the categories available in the library. */
function listCategories() {
    const all  = [...BUILTIN_WORKFLOWS, ..._loadCustom()];
    const cats = [...new Set(all.map(w => w.category))].sort();
    return cats.map(c => ({ category: c, count: all.filter(w => w.category === c).length }));
}

/** Library stats. */
function stats() {
    const custom = _loadCustom();
    return {
        builtinCount: BUILTIN_WORKFLOWS.length,
        customCount:  custom.length,
        totalCount:   BUILTIN_WORKFLOWS.length + custom.length,
        categories:   listCategories(),
    };
}

module.exports = {
    listWorkflows, getWorkflow, searchWorkflows,
    createWorkflow, editWorkflow, deleteWorkflow,
    exportJson, exportMarkdown, recordUsage,
    listCategories, stats,
    BUILTIN_WORKFLOWS,
};
