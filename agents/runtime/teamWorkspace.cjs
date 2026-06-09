"use strict";
/**
 * Phase 492 — Team-Ready Workspace Prep
 *
 * Shared workflow views, collaborative replay references,
 * operator attribution, shared operational templates.
 *
 * Scope: read/reference layer only — no full collaboration server.
 * Attribution is stored as metadata; isolation is per-operator.
 * data/team-workspace.json
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const TEAM_PATH = path.join(__dirname, "../../data/team-workspace.json");

const DEFAULT_STATE = {
    sharedWorkflows:  [], // { workflowId, sharedBy, sharedAt, note }
    sharedReplays:    [], // { replayId, sessionId, sharedBy, sharedAt, note }
    sharedTemplates:  [], // { templateId, sharedBy, sharedAt, note }
    operatorActivity: {}, // operatorId → { lastActive, sessionCount, workflowsRun }
};

const MAX_SHARED   = 50;
const MAX_ACTIVITY = 20;

function _load() {
    try { return JSON.parse(fs.readFileSync(TEAM_PATH, "utf8")); }
    catch { return { ...DEFAULT_STATE }; }
}

function _save(state) {
    try { fs.writeFileSync(TEAM_PATH, JSON.stringify(state, null, 2)); } catch {}
}

// ── Shared workflow views ─────────────────────────────────────────────────────

/** Share a workflow with the team workspace. */
function shareWorkflow(workflowId, operatorId, note = "") {
    const lib = _tryRequire("./workflowLibrary.cjs");
    if (lib) {
        const wf = lib.getWorkflow(workflowId);
        if (!wf) return { ok: false, error: `workflow ${workflowId} not found` };
    }
    const state = _load();
    // Remove existing share of same workflow to avoid duplication
    state.sharedWorkflows = state.sharedWorkflows.filter(w => w.workflowId !== workflowId);
    if (state.sharedWorkflows.length >= MAX_SHARED) state.sharedWorkflows.shift();
    state.sharedWorkflows.push({
        workflowId,
        sharedBy:  operatorId || "anonymous",
        sharedAt:  Date.now(),
        note:      (note || "").slice(0, 200),
    });
    _save(state);
    return { ok: true, workflowId, sharedBy: operatorId };
}

/** List shared workflows with enriched metadata. */
function listSharedWorkflows() {
    const lib   = _tryRequire("./workflowLibrary.cjs");
    const state = _load();
    return state.sharedWorkflows.map(entry => {
        const wf = lib ? lib.getWorkflow(entry.workflowId) : null;
        return {
            workflowId: entry.workflowId,
            name:       wf ? wf.name       : entry.workflowId,
            category:   wf ? wf.category   : "unknown",
            goal:       wf ? wf.goal       : null,
            sharedBy:   entry.sharedBy,
            sharedAt:   entry.sharedAt,
            note:       entry.note,
        };
    }).reverse();
}

// ── Collaborative replay references ──────────────────────────────────────────

/** Share a replay with the team workspace for collaborative review. */
function shareReplay(replayId, sessionId, operatorId, note = "") {
    const state = _load();
    state.sharedReplays = state.sharedReplays.filter(r => r.replayId !== replayId);
    if (state.sharedReplays.length >= MAX_SHARED) state.sharedReplays.shift();
    state.sharedReplays.push({
        replayId,
        sessionId: sessionId || null,
        sharedBy:  operatorId || "anonymous",
        sharedAt:  Date.now(),
        note:      (note || "").slice(0, 200),
    });
    _save(state);
    return { ok: true, replayId, sharedBy: operatorId };
}

/** List shared replays. */
function listSharedReplays() {
    const player = _tryRequire("./replayPlayer.cjs");
    const state  = _load();
    return state.sharedReplays.map(entry => {
        const pb = player ? player.getPlayback(entry.replayId) : null;
        return {
            replayId:  entry.replayId,
            sessionId: entry.sessionId,
            goal:      pb && pb.ok ? pb.goal : null,
            passed:    pb && pb.ok ? pb.passed : null,
            failed:    pb && pb.ok ? pb.failed : null,
            sharedBy:  entry.sharedBy,
            sharedAt:  entry.sharedAt,
            note:      entry.note,
        };
    }).reverse();
}

// ── Shared operational templates ──────────────────────────────────────────────

/** Share an operational template. */
function shareTemplate(templateId, operatorId, note = "") {
    const state = _load();
    state.sharedTemplates = state.sharedTemplates.filter(t => t.templateId !== templateId);
    if (state.sharedTemplates.length >= MAX_SHARED) state.sharedTemplates.shift();
    state.sharedTemplates.push({
        templateId,
        sharedBy:  operatorId || "anonymous",
        sharedAt:  Date.now(),
        note:      (note || "").slice(0, 200),
    });
    _save(state);
    return { ok: true, templateId, sharedBy: operatorId };
}

/** List shared templates with names. */
function listSharedTemplates() {
    const tmpl  = _tryRequire("./operationalTemplates.cjs");
    const state = _load();
    return state.sharedTemplates.map(entry => {
        const t = tmpl ? tmpl.getTemplate(entry.templateId) : null;
        return {
            templateId: entry.templateId,
            name:       t ? t.name : entry.templateId,
            goal:       t ? t.goal : null,
            sharedBy:   entry.sharedBy,
            sharedAt:   entry.sharedAt,
            note:       entry.note,
        };
    }).reverse();
}

// ── Operator attribution ──────────────────────────────────────────────────────

/** Record operator activity (call on session start / workflow execution). */
function recordActivity(operatorId, { sessionId, workflowId } = {}) {
    if (!operatorId) return;
    const state = _load();
    if (!state.operatorActivity) state.operatorActivity = {};

    // Prune oldest if over limit
    const keys = Object.keys(state.operatorActivity);
    if (!state.operatorActivity[operatorId] && keys.length >= MAX_ACTIVITY) {
        // Remove least recently active
        const oldest = keys.sort((a, b) =>
            (state.operatorActivity[a].lastActive || 0) - (state.operatorActivity[b].lastActive || 0)
        )[0];
        delete state.operatorActivity[oldest];
    }

    const existing = state.operatorActivity[operatorId] || { sessionCount: 0, workflowsRun: 0 };
    state.operatorActivity[operatorId] = {
        lastActive:   Date.now(),
        sessionCount: existing.sessionCount + (sessionId ? 1 : 0),
        workflowsRun: existing.workflowsRun + (workflowId ? 1 : 0),
        lastSessionId: sessionId || existing.lastSessionId || null,
    };
    _save(state);
}

/** List recent operator activity for team visibility. */
function listOperatorActivity() {
    const state = _load();
    const activity = state.operatorActivity || {};
    return Object.entries(activity)
        .map(([operatorId, data]) => ({ operatorId, ...data }))
        .sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
}

// ── Team workspace snapshot ───────────────────────────────────────────────────

function teamSnapshot() {
    const state = _load();
    return {
        sharedWorkflows:  listSharedWorkflows(),
        sharedReplays:    listSharedReplays(),
        sharedTemplates:  listSharedTemplates(),
        activeOperators:  listOperatorActivity().slice(0, 10),
        counts: {
            workflows:  state.sharedWorkflows.length,
            replays:    state.sharedReplays.length,
            templates:  state.sharedTemplates.length,
            operators:  Object.keys(state.operatorActivity || {}).length,
        },
        ts: new Date().toISOString(),
    };
}

module.exports = {
    shareWorkflow, listSharedWorkflows,
    shareReplay,   listSharedReplays,
    shareTemplate, listSharedTemplates,
    recordActivity, listOperatorActivity,
    teamSnapshot,
};
