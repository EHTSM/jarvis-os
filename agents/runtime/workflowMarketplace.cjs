"use strict";
/**
 * Phase 514 — Workflow Marketplace Prep
 *
 * Import/export, validation metadata, replay confidence,
 * categorization, operator ratings, template versioning.
 *
 * Wraps workflowLibrary with marketplace-grade metadata.
 * data/marketplace-ratings.json
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const RATINGS_PATH = path.join(__dirname, "../../data/marketplace-ratings.json");
const MAX_RATINGS  = 1000;

// ── Ratings persistence ───────────────────────────────────────────────────────

function _loadRatings() {
    try { return JSON.parse(fs.readFileSync(RATINGS_PATH, "utf8")); }
    catch { return {}; }
}

function _saveRatings(r) {
    try { fs.writeFileSync(RATINGS_PATH, JSON.stringify(r, null, 2)); } catch {}
}

// ── Version hash ──────────────────────────────────────────────────────────────

function _versionHash(workflow) {
    const str = JSON.stringify({ name: workflow.name, goal: workflow.goal, steps: workflow.steps });
    return crypto.createHash("sha256").update(str).digest("hex").slice(0, 12);
}

// ── Validation metadata ───────────────────────────────────────────────────────

function validateWorkflow(workflow) {
    const errors   = [];
    const warnings = [];

    if (!workflow.name || !workflow.name.trim()) errors.push("name required");
    if (!workflow.goal || !workflow.goal.trim()) errors.push("goal required");
    if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) errors.push("at least one step required");
    if (workflow.steps && workflow.steps.length > 30) warnings.push("more than 30 steps — consider splitting");

    const validLevels = ["SAFE", "CAUTION", "CRITICAL"];
    (workflow.steps || []).forEach((s, i) => {
        if (!s.cmd && !s.label) errors.push(`step ${i}: cmd or label required`);
        if (s.approvalLevel && !validLevels.includes(s.approvalLevel)) {
            warnings.push(`step ${i}: unknown approvalLevel "${s.approvalLevel}"`);
        }
    });

    const hasCritical = (workflow.steps || []).some(s => s.approvalLevel === "CRITICAL");
    const hasDestructive = (workflow.steps || []).some(s => /rm\s+-rf|drop\s+table|mkfs|format/i.test(s.cmd || ""));
    if (hasDestructive) warnings.push("workflow contains potentially destructive commands — review carefully");

    return {
        valid:       errors.length === 0,
        errors,
        warnings,
        hasCriticalSteps: hasCritical,
        hasDestructiveCommands: hasDestructive,
        stepCount:   (workflow.steps || []).length,
        versionHash: workflow.name ? _versionHash(workflow) : null,
    };
}

// ── Replay confidence scoring ─────────────────────────────────────────────────

function replayConfidence(workflowId) {
    const analytics = _tryRequire("./operationalAnalytics.cjs");
    const lib       = _tryRequire("./workflowLibrary.cjs");
    const wf        = lib ? lib.getWorkflow(workflowId) : null;

    if (!wf) return { workflowId, confidence: null, reason: "workflow not found" };

    // Builtins have baseline confidence
    if (wf.builtin) return { workflowId, confidence: 85, reason: "built-in workflow — high baseline confidence" };

    // Check analytics for chain with same name
    if (analytics) {
        try {
            const s     = analytics.summary();
            const chain = (s.chains || {})[wf.chain || wf.name];
            if (chain && chain.runs >= 3) {
                const conf = Math.round((chain.successRate || 0) * 100);
                return { workflowId, confidence: conf, runs: chain.runs, reason: `${chain.runs} recorded runs, ${conf}% success` };
            }
        } catch {}
    }

    return { workflowId, confidence: 60, reason: "no analytics data — default confidence" };
}

// ── Operator ratings ──────────────────────────────────────────────────────────

function rateWorkflow(workflowId, operatorId, rating, comment = "") {
    if (!workflowId || !operatorId) return { ok: false, error: "workflowId and operatorId required" };
    if (rating < 1 || rating > 5) return { ok: false, error: "rating must be 1-5" };

    const ratings = _loadRatings();
    if (!ratings[workflowId]) ratings[workflowId] = [];

    // One rating per operator per workflow — update existing
    const existing = ratings[workflowId].findIndex(r => r.operatorId === operatorId);
    const entry = { operatorId, rating, comment: (comment || "").slice(0, 200), ts: Date.now() };

    if (existing >= 0) ratings[workflowId][existing] = entry;
    else {
        ratings[workflowId].push(entry);
        // Trim to MAX_RATINGS total across all workflows
        const total = Object.values(ratings).reduce((s, r) => s + r.length, 0);
        if (total > MAX_RATINGS) {
            // Remove oldest single entry
            let oldest = null, oldestKey = null, oldestTs = Infinity;
            for (const [k, rs] of Object.entries(ratings)) {
                for (const r of rs) {
                    if (r.ts < oldestTs) { oldest = r; oldestKey = k; oldestTs = r.ts; }
                }
            }
            if (oldestKey) ratings[oldestKey] = ratings[oldestKey].filter(r => r !== oldest);
        }
    }
    _saveRatings(ratings);
    return { ok: true, workflowId, operatorId, rating };
}

function getWorkflowRating(workflowId) {
    const ratings = _loadRatings();
    const wfRatings = ratings[workflowId] || [];
    if (wfRatings.length === 0) return { workflowId, avgRating: null, count: 0, ratings: [] };
    const avg = wfRatings.reduce((s, r) => s + r.rating, 0) / wfRatings.length;
    return {
        workflowId,
        avgRating: Math.round(avg * 10) / 10,
        count:     wfRatings.length,
        ratings:   wfRatings.map(r => ({ operatorId: r.operatorId, rating: r.rating, comment: r.comment })),
    };
}

// ── Import/export ─────────────────────────────────────────────────────────────

/**
 * Export a workflow as a portable marketplace bundle.
 */
function exportBundle(workflowId) {
    const lib = _tryRequire("./workflowLibrary.cjs");
    if (!lib) return { ok: false, error: "workflow library unavailable" };

    const wf = lib.getWorkflow(workflowId);
    if (!wf) return { ok: false, error: "workflow not found" };

    const validation    = validateWorkflow(wf);
    const confidence    = replayConfidence(workflowId);
    const rating        = getWorkflowRating(workflowId);

    return {
        ok:          true,
        schemaVersion: "1.0",
        workflow:    wf,
        validation,
        confidence,
        rating,
        versionHash: validation.versionHash,
        exportedAt:  new Date().toISOString(),
    };
}

/**
 * Import a workflow bundle (validate first, then create).
 */
function importBundle(bundle, operatorId) {
    const lib = _tryRequire("./workflowLibrary.cjs");
    if (!lib) return { ok: false, error: "workflow library unavailable" };

    if (!bundle || !bundle.workflow) return { ok: false, error: "invalid bundle — missing workflow" };

    const validation = validateWorkflow(bundle.workflow);
    if (!validation.valid) return { ok: false, errors: validation.errors, validation };

    const result = lib.createWorkflow({ ...bundle.workflow, builtin: false });
    if (!result.created) return { ok: false, error: result.error };

    return { ok: true, workflowId: result.workflow.id, validation, importedAt: new Date().toISOString() };
}

/**
 * List all workflows enriched with marketplace metadata.
 */
function listWithMetadata({ category, tag, limit = 50 } = {}) {
    const lib     = _tryRequire("./workflowLibrary.cjs");
    const ratings = _loadRatings();
    if (!lib) return [];

    return lib.listWorkflows({ category, tag }).slice(0, limit).map(wf => {
        const wfRatings = ratings[wf.id] || [];
        const avgRating = wfRatings.length > 0
            ? Math.round(wfRatings.reduce((s, r) => s + r.rating, 0) / wfRatings.length * 10) / 10
            : null;
        return { ...wf, avgRating, ratingCount: wfRatings.length };
    }).sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0) || b.usageCount - a.usageCount);
}

module.exports = { validateWorkflow, replayConfidence, rateWorkflow, getWorkflowRating, exportBundle, importBundle, listWithMetadata };
