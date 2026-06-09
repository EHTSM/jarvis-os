"use strict";
/**
 * Phase 528 — Engineering Template Ecosystem
 *
 * Categorized workflows, replay confidence, template validation history,
 * operator favorites, environment compatibility, version-aware templates.
 *
 * Extends workflowLibrary and workflowMarketplace with ecosystem-grade metadata.
 * data/template-ecosystem.json
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const ECO_PATH = path.join(__dirname, "../../data/template-ecosystem.json");

const DEFAULT_STATE = {
    favorites:          {}, // operatorId → [workflowId]
    validationHistory:  {}, // workflowId → [{ ts, valid, errors, warnings }]
    compatibilityTags:  {}, // workflowId → { nodeMin, envTypes, requires }
};

function _load() {
    try { return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(ECO_PATH, "utf8")) }; }
    catch { return { ...DEFAULT_STATE }; }
}

function _save(s) {
    try { fs.writeFileSync(ECO_PATH, JSON.stringify(s, null, 2)); } catch {}
}

// ── Favorites ─────────────────────────────────────────────────────────────────

function toggleFavorite(operatorId, workflowId) {
    if (!operatorId || !workflowId) return { ok: false, error: "operatorId and workflowId required" };
    const state = _load();
    if (!state.favorites[operatorId]) state.favorites[operatorId] = [];
    const idx = state.favorites[operatorId].indexOf(workflowId);
    if (idx >= 0) {
        state.favorites[operatorId].splice(idx, 1);
        _save(state);
        return { ok: true, favorited: false, workflowId };
    }
    if (state.favorites[operatorId].length >= 20) state.favorites[operatorId].shift();
    state.favorites[operatorId].push(workflowId);
    _save(state);
    return { ok: true, favorited: true, workflowId };
}

function getFavorites(operatorId) {
    const state = _load();
    const ids   = (state.favorites[operatorId] || []);
    const lib   = _tryRequire("./workflowLibrary.cjs");
    return ids.map(id => {
        const wf = lib ? lib.getWorkflow(id) : null;
        return wf ? { id: wf.id, name: wf.name, category: wf.category, goal: wf.goal } : { id, name: id };
    });
}

// ── Validation history ────────────────────────────────────────────────────────

function recordValidation(workflowId, validationResult) {
    const state = _load();
    if (!state.validationHistory[workflowId]) state.validationHistory[workflowId] = [];
    const entry = { ts: Date.now(), valid: validationResult.valid, errors: validationResult.errors || [], warnings: validationResult.warnings || [] };
    state.validationHistory[workflowId] = [entry, ...state.validationHistory[workflowId]].slice(0, 10);
    _save(state);
    return entry;
}

function getValidationHistory(workflowId) {
    return (_load().validationHistory[workflowId] || []);
}

// ── Environment compatibility ─────────────────────────────────────────────────

function setCompatibility(workflowId, compat = {}) {
    const state = _load();
    state.compatibilityTags[workflowId] = {
        nodeMin:   compat.nodeMin   || null,
        envTypes:  (compat.envTypes || []).slice(0, 5),    // ["development","production","staging"]
        requires:  (compat.requires || []).slice(0, 10),   // ["nginx","pm2","postgresql"]
        updatedAt: Date.now(),
    };
    _save(state);
    return { ok: true, workflowId, compat: state.compatibilityTags[workflowId] };
}

function getCompatibility(workflowId) {
    return (_load().compatibilityTags[workflowId] || null);
}

function checkCompatibility(workflowId) {
    const compat = getCompatibility(workflowId);
    if (!compat) return { compatible: true, reason: "no compatibility requirements set" };

    const issues = [];
    const nodeMajor = parseInt(process.version.slice(1).split(".")[0]);

    if (compat.nodeMin) {
        const minMajor = parseInt(compat.nodeMin.replace(/[^0-9]/g, ""));
        if (nodeMajor < minMajor) issues.push(`requires Node ${compat.nodeMin}+ (current: ${process.version})`);
    }

    const nodeEnv = process.env.NODE_ENV || "development";
    if (compat.envTypes && compat.envTypes.length > 0 && !compat.envTypes.includes(nodeEnv)) {
        issues.push(`designed for [${compat.envTypes.join(",")}], current: ${nodeEnv}`);
    }

    return {
        compatible: issues.length === 0,
        issues,
        compat,
        reason: issues.length === 0 ? "environment compatible" : issues.join("; "),
    };
}

// ── Version-aware template listing ───────────────────────────────────────────

/**
 * Full ecosystem view: workflow + favorites + compatibility + validation + confidence.
 */
function ecosystemView(operatorId) {
    const lib         = _tryRequire("./workflowLibrary.cjs");
    const marketplace = _tryRequire("./workflowMarketplace.cjs");
    if (!lib) return { workflows: [] };

    const state      = _load();
    const favIds     = new Set(state.favorites[operatorId] || []);
    const allWf      = lib.listWorkflows();

    const workflows  = allWf.map(wf => {
        const conf      = marketplace ? marketplace.replayConfidence(wf.id) : null;
        const rating    = marketplace ? marketplace.getWorkflowRating(wf.id)  : null;
        const compat    = state.compatibilityTags[wf.id] || null;
        const valHist   = (state.validationHistory[wf.id] || []);
        const lastVal   = valHist[0] || null;

        return {
            id:              wf.id,
            name:            wf.name,
            category:        wf.category,
            goal:            wf.goal,
            tags:            wf.tags,
            builtin:         wf.builtin,
            stepCount:       wf.stepCount,
            favorite:        favIds.has(wf.id),
            confidence:      conf ? conf.confidence : null,
            avgRating:       rating ? rating.avgRating : null,
            ratingCount:     rating ? rating.count     : 0,
            compatible:      compat ? checkCompatibility(wf.id).compatible : null,
            lastValidated:   lastVal ? { valid: lastVal.valid, ts: lastVal.ts } : null,
        };
    });

    // Sort: favorites first, then by confidence, then by rating
    workflows.sort((a, b) => {
        if (a.favorite && !b.favorite) return -1;
        if (!a.favorite && b.favorite) return 1;
        return (b.confidence || 0) - (a.confidence || 0) || (b.avgRating || 0) - (a.avgRating || 0);
    });

    return {
        operatorId,
        workflows,
        totalCount:      workflows.length,
        favoriteCount:   workflows.filter(w => w.favorite).length,
        builtinCount:    workflows.filter(w => w.builtin).length,
        ts:              new Date().toISOString(),
    };
}

module.exports = {
    toggleFavorite, getFavorites,
    recordValidation, getValidationHistory,
    setCompatibility, getCompatibility, checkCompatibility,
    ecosystemView,
};
