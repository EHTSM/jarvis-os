"use strict";
/**
 * Phase 603 — VS Code Execution Maturity
 *
 * Matures VS Code integration: active file targeting, patch-from-editor,
 * editor-context debugging continuity, workspace-aware recovery,
 * terminal-integrated chain execution, launch config awareness.
 *
 * Builds on vsCodeOperations (542) — does not replace it.
 * No VS Code API dependency. All context modeled from file system + patch log.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Editor context model ──────────────────────────────────────────────────────
// Tracks what the operator has open, where they are in a file, and what tasks
// are relevant to that context.

const _editorContext = new Map(); // sessionId -> EditorContext

function setEditorContext(sessionId, ctx = {}) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const prev = _editorContext.get(sessionId) || {};
    const next  = {
        sessionId,
        activeFile:      ctx.activeFile      || prev.activeFile      || null,
        openFiles:       ctx.openFiles       || prev.openFiles       || [],
        cursorLine:      ctx.cursorLine      || prev.cursorLine      || null,
        selection:       ctx.selection       || prev.selection       || null,
        workspaceRoot:   ctx.workspaceRoot   || prev.workspaceRoot   || process.cwd(),
        breakpoints:     ctx.breakpoints     || prev.breakpoints     || [],
        updatedAt:       Date.now(),
    };
    _editorContext.set(sessionId, next);
    return { ok: true, sessionId, activeFile: next.activeFile };
}

function getEditorContext(sessionId) {
    return _editorContext.get(sessionId) || null;
}

// ── Active file targeting ─────────────────────────────────────────────────────

/**
 * Validate that the active file is safe to patch and in-workspace.
 */
function validateActiveFile(sessionId) {
    const ctx = getEditorContext(sessionId);
    if (!ctx || !ctx.activeFile) return { ok: false, error: "No active file in editor context" };

    const vsc = _tryRequire("./vsCodeOperations.cjs");
    if (vsc) return vsc.validateFileTarget(ctx.activeFile);

    // Fallback: basic check
    const abs = path.resolve(ctx.workspaceRoot, ctx.activeFile);
    const inWs = abs.startsWith(path.resolve(ctx.workspaceRoot));
    if (!inWs) return { ok: false, error: "Active file is outside workspace" };

    let exists = false, size = 0;
    try { const stat = fs.statSync(abs); exists = true; size = stat.size; } catch {}
    return { ok: true, filePath: abs, exists, size, inWorkspace: true };
}

// ── Patch from editor context ─────────────────────────────────────────────────

/**
 * Build a patch targeting the active file + cursor position.
 * Returns a proposal for operator review — does not apply.
 */
function proposeContextualPatch(sessionId, patchContent, { reason = "", replayId = null } = {}) {
    const ctx = getEditorContext(sessionId);
    if (!ctx || !ctx.activeFile) return { ok: false, error: "No active file context — set editor context first" };

    const vsc = _tryRequire("./vsCodeOperations.cjs");
    if (!vsc) return { ok: false, error: "vsCodeOperations unavailable" };

    const preview = vsc.previewPatch(ctx.activeFile, patchContent, { sessionId, replayId });
    if (!preview.ok) return preview;

    return {
        ok:            true,
        filePath:      ctx.activeFile,
        cursorLine:    ctx.cursorLine,
        reason,
        preview:       preview.preview,
        duplicate:     preview.duplicate,
        requiresApproval: true,
        sessionId,
        replayId,
    };
}

/**
 * Apply a contextual patch (requires approval).
 */
function applyContextualPatch(sessionId, patchContent, { approved = false, reason = "", replayId = null } = {}) {
    if (!approved) return { ok: false, error: "Operator approval required" };
    const ctx = getEditorContext(sessionId);
    if (!ctx || !ctx.activeFile) return { ok: false, error: "No active file context" };

    const vsc = _tryRequire("./vsCodeOperations.cjs");
    if (!vsc) return { ok: false, error: "vsCodeOperations unavailable" };

    const result = vsc.applyPatch(ctx.activeFile, patchContent, { sessionId, replayId, apply: true });

    if (result.ok) {
        const tl = _tryRequire("./executionTimeline.cjs");
        if (tl) tl.recordPatch(result.key, ctx.activeFile, "applied", sessionId);
    }

    return result;
}

// ── Launch config awareness ───────────────────────────────────────────────────

/**
 * Read VS Code launch.json if present and extract debug configurations.
 */
function getLaunchConfigs(workspaceRoot = process.cwd()) {
    const launchPath = path.join(workspaceRoot, ".vscode", "launch.json");
    try {
        const raw  = fs.readFileSync(launchPath, "utf8");
        // Strip JSON comments (VS Code allows them)
        const clean = raw.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
        const json  = JSON.parse(clean);
        const configs = (json.configurations || []).map(c => ({
            name:    c.name,
            type:    c.type,
            request: c.request,
            program: c.program || null,
            cwd:     c.cwd     || null,
        }));
        return { ok: true, configCount: configs.length, configs };
    } catch (e) {
        return { ok: false, error: e.message, available: false };
    }
}

/**
 * Read .vscode/settings.json for project-specific settings.
 */
function getWorkspaceSettings(workspaceRoot = process.cwd()) {
    const settingsPath = path.join(workspaceRoot, ".vscode", "settings.json");
    try {
        const raw   = fs.readFileSync(settingsPath, "utf8");
        const clean = raw.replace(/\/\/[^\n]*/g, "");
        const json  = JSON.parse(clean);
        return { ok: true, settings: json };
    } catch (e) {
        return { ok: false, error: e.message, available: false };
    }
}

// ── Debugging context continuity ──────────────────────────────────────────────

/**
 * Save full VS Code debugging context for session restore.
 */
function saveDebugContext(sessionId, ctx = {}) {
    setEditorContext(sessionId, ctx);
    const vsc = _tryRequire("./vsCodeOperations.cjs");
    if (vsc && vsc.saveEditorContext) {
        try { return vsc.saveEditorContext(sessionId, ctx); } catch {}
    }
    return { ok: true, sessionId, saved: "memory-only" };
}

/**
 * Load the last saved debug context for a session.
 */
function loadDebugContext(sessionId) {
    const mem = getEditorContext(sessionId);
    if (mem) return { ok: true, sessionId, source: "memory", context: mem };

    const vsc = _tryRequire("./vsCodeOperations.cjs");
    if (vsc && vsc.patchHistory) {
        const history = vsc.patchHistory({ sessionId, limit: 5 });
        if (history.count > 0) {
            return { ok: true, sessionId, source: "patch-history", lastFile: history.patches[history.patches.length - 1]?.filePath };
        }
    }
    return { ok: false, sessionId, error: "No context found" };
}

// ── Terminal-integrated chain execution ───────────────────────────────────────

/**
 * Get a chain recommendation based on editor context.
 * E.g.: open file = backend/server.js → suggest debug-backend chain.
 */
function recommendChain(sessionId) {
    const ctx  = getEditorContext(sessionId);
    const file = ctx?.activeFile || "";

    if (/frontend|react|jsx|tsx|css|vite/i.test(file))  return { chain: "full-debug-session", reason: "Active file is frontend — debug-frontend flow" };
    if (/server|backend|api|route|controller/i.test(file)) return { chain: "full-debug-session", reason: "Active file is backend — debug-backend flow" };
    if (/deploy|pm2|ecosystem/i.test(file))              return { chain: "deploy-preflight-full", reason: "Active file is deploy config" };
    if (/package\.json|node_modules/i.test(file))        return { chain: "dep-repair-full", reason: "Active file is package config" };
    return { chain: "env-bootstrap-full", reason: "No specific context — environment bootstrap recommended" };
}

module.exports = { setEditorContext, getEditorContext, validateActiveFile, proposeContextualPatch, applyContextualPatch, getLaunchConfigs, getWorkspaceSettings, saveDebugContext, loadDebugContext, recommendChain };
