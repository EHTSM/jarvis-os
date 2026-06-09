"use strict";
/**
 * Phase 455 — Operational Template System
 *
 * Reusable, editable, exportable workflow templates.
 * Combines: debugging flows + productivity chains + deployment flows
 * into a single addressable template registry.
 *
 * Templates are validated before execution (step structure, approval levels).
 * Exportable as JSON or markdown.
 *
 * Custom templates can be added at runtime and are persisted to
 * data/custom-templates.json.
 */

const fs   = require("fs");
const path = require("path");

const CUSTOM_PATH = path.join(__dirname, "../../data/custom-templates.json");
const MAX_CUSTOM  = 50;

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Built-in template sources ─────────────────────────────────────────────────
function _getBuiltins() {
    const templates = {};

    const prod = _tryRequire("./productivityChains.cjs");
    if (prod) {
        for (const [name, chain] of Object.entries(prod.PRODUCTIVITY_CHAINS || {})) {
            templates[name] = { ...chain, source: "productivity", name };
        }
    }

    const debug = _tryRequire("./debuggingFlows.cjs");
    if (debug) {
        for (const [name, flow] of Object.entries(debug.DEBUG_FLOWS || {})) {
            templates[name] = { ...flow, source: "debugging", name };
        }
    }

    const deploy = _tryRequire("./deploymentRecoveryFlows.cjs");
    if (deploy) {
        for (const [name, flow] of Object.entries(deploy.DEPLOY_FLOWS || {})) {
            templates[name] = { ...flow, source: "deployment", name };
        }
    }

    const planner = _tryRequire("./executionChainPlanner.cjs");
    if (planner) {
        for (const t of planner.listTemplates?.() || []) {
            if (!templates[t.name]) templates[t.name] = { ...t, source: "chain-planner" };
        }
    }

    return templates;
}

// ── Custom template persistence ───────────────────────────────────────────────
function _loadCustom() {
    try { return JSON.parse(fs.readFileSync(CUSTOM_PATH, "utf8")); }
    catch { return {}; }
}

function _saveCustom(custom) {
    try {
        const dir = path.dirname(CUSTOM_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CUSTOM_PATH, JSON.stringify(custom, null, 2));
    } catch {}
}

// ── Validation ────────────────────────────────────────────────────────────────
const VALID_APPROVAL = new Set(["SAFE", "CAUTION", "CRITICAL"]);
const VALID_FAIL     = new Set(["abort", "continue", "retry"]);

function validateTemplate(tpl) {
    const errors = [];
    if (!tpl.name   || typeof tpl.name   !== "string") errors.push("name required");
    if (!tpl.goal   || typeof tpl.goal   !== "string") errors.push("goal required");
    if (!Array.isArray(tpl.steps) || !tpl.steps.length) errors.push("steps[] required");
    for (let i = 0; i < (tpl.steps || []).length; i++) {
        const s = tpl.steps[i];
        if (!s.cmd   || typeof s.cmd   !== "string") errors.push(`step[${i}].cmd required`);
        if (!s.label || typeof s.label !== "string") errors.push(`step[${i}].label required`);
        if (s.approvalLevel && !VALID_APPROVAL.has(s.approvalLevel)) errors.push(`step[${i}].approvalLevel invalid`);
        if (s.failBehavior  && !VALID_FAIL.has(s.failBehavior))      errors.push(`step[${i}].failBehavior invalid`);
    }
    return { valid: errors.length === 0, errors };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** List all templates (builtins + custom). */
function listTemplates() {
    const builtins = _getBuiltins();
    const custom   = _loadCustom();
    const all      = { ...builtins, ...custom }; // custom overrides builtins by name
    return Object.values(all).map(t => {
        const steps = Array.isArray(t.steps) ? t.steps : [];
        return {
            name:       t.name,
            goal:       t.goal,
            source:     t.source || "custom",
            stepCount:  steps.length,
            maxRetries: t.maxRetries ?? 0,
            hasProbes:  steps.some(s => s && s.probes),
        };
    });
}

/** Get a specific template by name. */
function getTemplate(name) {
    const custom = _loadCustom();
    if (custom[name]) return { ...custom[name], source: custom[name].source || "custom" };
    const builtins = _getBuiltins();
    return builtins[name] || null;
}

/**
 * Save a custom template (validates before saving).
 * @param {object} tpl — { name, goal, steps[], maxRetries? }
 */
function saveTemplate(tpl) {
    const { valid, errors } = validateTemplate(tpl);
    if (!valid) return { saved: false, errors };
    const custom = _loadCustom();
    const keys   = Object.keys(custom);
    if (keys.length >= MAX_CUSTOM && !custom[tpl.name]) {
        return { saved: false, errors: ["custom template limit reached (50)"] };
    }
    custom[tpl.name] = { ...tpl, savedAt: Date.now(), source: "custom" };
    _saveCustom(custom);
    return { saved: true, name: tpl.name };
}

/** Delete a custom template (cannot delete builtins). */
function deleteTemplate(name) {
    const custom = _loadCustom();
    if (!custom[name]) return false;
    delete custom[name];
    _saveCustom(custom);
    return true;
}

/**
 * Export a template as JSON string.
 */
function exportJson(name) {
    const tpl = getTemplate(name);
    if (!tpl) return null;
    return JSON.stringify(tpl, null, 2);
}

/**
 * Export a template as Markdown.
 */
function exportMarkdown(name) {
    const tpl = getTemplate(name);
    if (!tpl) return null;
    const lines = [`# Template: ${tpl.name}`, ``, `**Goal:** ${tpl.goal}`, ``];
    if (tpl.maxRetries) lines.push(`**Max retries:** ${tpl.maxRetries}`, ``);
    lines.push(`## Steps`, ``);
    (tpl.steps || []).forEach((s, i) => {
        lines.push(`### ${i + 1}. ${s.label}`);
        lines.push(`- **Approval:** ${s.approvalLevel || "SAFE"}`);
        lines.push(`- **On failure:** ${s.failBehavior || "continue"}`);
        lines.push(`\`\`\`bash\n${s.cmd}\n\`\`\``, ``);
    });
    if (tpl.suggestions?.length) {
        lines.push(`## Recovery Suggestions`, ``);
        tpl.suggestions.forEach(sg => lines.push(`- ${sg}`));
    }
    return lines.join("\n");
}

module.exports = { listTemplates, getTemplate, saveTemplate, deleteTemplate, validateTemplate, exportJson, exportMarkdown };
