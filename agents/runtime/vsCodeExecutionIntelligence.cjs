"use strict";
/**
 * Phase 692 — VS Code Execution Intelligence
 *
 * Active-editor awareness, contextual patch planning, symbol-aware navigation,
 * debugging-aware code targeting, replay-linked edit continuity.
 * PREVENTS: stale-file modification, unsafe patch overlap, invalid context replay.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/vscode-exec-intel.json");
const MAX_FILES  = 100;
const TTL_MS     = 8 * 60 * 60 * 1000;
const STALE_MS   = 30 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { files: [], patches: [], sessions: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.files    = (db.files    || []).filter(f => f.ts > cutoff).slice(0, MAX_FILES);
    db.patches  = (db.patches  || []).filter(p => p.ts > cutoff).slice(0, 50);
    db.sessions = (db.sessions || []).filter(s => s.ts > cutoff).slice(0, 20);
}

// ── Active-editor awareness ───────────────────────────────────────────────────

function registerActiveFile(filePath, { language = "unknown", lineCount = 0, lastSavedAt = null } = {}) {
    if (!filePath) return { ok: false, error: "filePath required" };
    const db  = _load(); _prune(db);
    const idx = db.files.findIndex(f => f.filePath === filePath);
    const record = { filePath, language, lineCount, lastSavedAt, ts: Date.now() };
    if (idx >= 0) { db.files[idx] = record; }
    else          { db.files.unshift(record); }
    _save(db);
    return { ok: true, filePath, language };
}

function getActiveContext() {
    const db = _load(); _prune(db);
    const recent = db.files.sort((a, b) => b.ts - a.ts)[0];
    if (!recent) return { ok: true, active: null, detail: "No active files registered" };

    const stale = (Date.now() - recent.ts) > STALE_MS;
    return { ok: true, active: recent, stale, warning: stale ? "Active file context stale (>30min)" : null };
}

// ── Contextual patch planning ─────────────────────────────────────────────────

function planContextualPatch(filePath, opts = {}) {
    if (!filePath) return { ok: false, error: "filePath required" };
    const { symbol = null, lineRange = null, description = "", replayId = null, trustScore = 65 } = opts;

    // Check for overlapping patches
    const db      = _load(); _prune(db);
    const overlap = db.patches.filter(p => p.filePath === filePath && p.status === "pending");

    if (overlap.length > 0 && !opts.force) {
        return {
            ok:      false,
            blocked: true,
            reason:  `${overlap.length} pending patch(es) on file — resolve first or pass force=true`,
            overlap: overlap.map(p => ({ patchId: p.patchId, description: p.description })),
        };
    }

    const apt = _tryRequire("./advancedPatchTrust.cjs");
    let trustOk = true;
    if (apt) { try { const c = apt.executionConfidenceSummary(); trustOk = c.ok !== false; } catch {} }

    const patchId = `patch-${Date.now()}`;
    db.patches.unshift({ patchId, filePath, symbol, lineRange, description: description.slice(0, 200), replayId, status: "pending", ts: Date.now() });
    _save(db);

    return {
        ok:           trustOk,
        patchId,
        filePath,
        symbol,
        lineRange,
        replayId,
        trustOk,
        requiresApproval: !trustOk || trustScore < 50,
        explainer:    `Patch planned for '${path.basename(filePath)}' ${symbol ? `symbol='${symbol}'` : ""} ${lineRange ? `lines=${lineRange}` : ""}`,
    };
}

function completePatch(patchId, { succeeded = true } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.patches.findIndex(p => p.patchId === patchId);
    if (idx === -1) return { ok: false, error: "Patch not found" };
    db.patches[idx].status = succeeded ? "completed" : "failed";
    db.patches[idx].completedAt = Date.now();
    _save(db);
    return { ok: true, patchId, status: db.patches[idx].status };
}

// ── Symbol-aware navigation ───────────────────────────────────────────────────

function planSymbolNavigation(symbol = "", { filePath = null, action = "goto-definition" } = {}) {
    if (!symbol) return { ok: false, error: "symbol required" };

    const SAFE_ACTIONS = ["goto-definition", "find-references", "hover-info", "outline-view"];
    const safe = SAFE_ACTIONS.includes(action);

    return {
        ok:     true,
        symbol,
        filePath,
        action,
        safe,
        requiresApproval: !safe,
        plan: [
            { step: "validate-file-open", autonomous: true },
            { step: action,               autonomous: safe, requiresApproval: !safe },
            { step: "update-context",     autonomous: true },
        ],
    };
}

// ── Debugging-aware code targeting ────────────────────────────────────────────

function buildDebugCodeTarget(opts = {}) {
    const { errorText = "", filePath = null, breakpointLine = null, watchExpressions = [] } = opts;

    const sdi = _tryRequire("./smartDebugIntelligence.cjs");
    let pattern = null;
    if (sdi && errorText) { try { pattern = sdi.identifyPattern(errorText); } catch {} }

    return {
        ok:               true,
        filePath,
        breakpointLine,
        watchExpressions: watchExpressions.slice(0, 10),
        pattern,
        confidence:       pattern?.confidence || 40,
        plan: [
            { step: "open-file",          autonomous: true  },
            { step: "set-breakpoint",     autonomous: false, requiresApproval: true, line: breakpointLine },
            { step: "start-debug-session", autonomous: false, requiresApproval: true },
        ],
        approvalRequired: true,
    };
}

// ── Replay-linked edit continuity ─────────────────────────────────────────────

function restoreEditContinuity(replayId = "") {
    if (!replayId) return { ok: false, error: "replayId required" };

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    let isDup  = false;
    if (lhec) { try { isDup = lhec.isDuplicateRecovery(`vscode-replay:${replayId}`); } catch {} }
    if (isDup) return { ok: false, duplicate: true, error: "Duplicate edit replay blocked" };

    const db = _load(); _prune(db);
    const replayPatches = db.patches.filter(p => p.replayId === replayId && p.status === "pending");
    const ctx = getActiveContext();

    return {
        ok:          true,
        replayId,
        pendingPatches: replayPatches.length,
        activeContext:  ctx.active,
        stale:          ctx.stale,
        warning:        ctx.stale ? "Active context stale — verify before applying patches" : null,
    };
}

// ── Stale-file detection ──────────────────────────────────────────────────────

function detectStaleFiles() {
    const db    = _load(); _prune(db);
    const stale = db.files.filter(f => (Date.now() - f.ts) > STALE_MS);
    return {
        ok:         stale.length === 0,
        staleCount: stale.length,
        stale:      stale.map(f => ({ filePath: f.filePath, ageMs: Date.now() - f.ts })),
        detail:     stale.length > 0 ? `${stale.length} stale file(s)` : "All files current",
    };
}

module.exports = { registerActiveFile, getActiveContext, planContextualPatch, completePatch, planSymbolNavigation, buildDebugCodeTarget, restoreEditContinuity, detectStaleFiles };
