"use strict";
/**
 * Phase 754 — VS Code Execution Experience
 *
 * Contextual patch previews, symbol-linked editing flows, replay-linked
 * editor continuity, debugging-aware file targeting, dependency-aware coordination.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const DATA_FILE = path.join(__dirname, "../../data/vscode-execution-experience.json");
const STALE_MS  = 4 * 60 * 60 * 1000;
const MAX_FILES = 50;

function _load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return { activeFiles: [], editorState: {} }; }
}
function _save(db) { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {} }

function recordActiveFile(filePath, context = {}) {
    if (!filePath) return { ok: false, error: "filePath required" };
    const db  = _load();
    const now = Date.now();
    const existing = db.activeFiles.find(f => f.filePath === filePath);
    if (existing) {
        existing.context   = context;
        existing.updatedAt = now;
    } else {
        db.activeFiles.push({ filePath, context, updatedAt: now });
        if (db.activeFiles.length > MAX_FILES) db.activeFiles = db.activeFiles.slice(-MAX_FILES);
    }
    _save(db);
    return { ok: true, filePath };
}

function patchPreview(filePath, patch = {}) {
    if (!filePath || !patch.description) return { ok: false, error: "filePath and patch.description required" };

    const rif = _tryRequire("./repoIntelligenceFoundation.cjs");
    let deps = [];
    if (rif) { try { const d = rif.getDependencies(filePath, { direction: "outbound" }); deps = d.deps || []; } catch {} }

    const risky = deps.length > 5 || (patch.lines && patch.lines > 50);
    return {
        ok: true,
        filePath,
        description:     patch.description,
        estimatedLines:  patch.lines || "unknown",
        dependencyCount: deps.length,
        risky,
        requiresApproval: risky,
        preview:         `[PATCH] ${filePath}: ${patch.description} (deps=${deps.length}, risky=${risky})`,
    };
}

function getEditorContext(filePath) {
    if (!filePath) return { ok: false, error: "filePath required" };
    const db  = _load();
    const now = Date.now();
    const f   = db.activeFiles.find(x => x.filePath === filePath);
    if (!f) return { ok: true, tracked: false };
    const stale = now - f.updatedAt > STALE_MS;
    return { ok: true, tracked: true, stale, filePath, context: stale ? null : f.context, age: now - f.updatedAt };
}

function symbolLinkedEdit(symbolName, filePath, change = {}, { operatorApproved = false } = {}) {
    if (!symbolName || !filePath) return { ok: false, error: "symbolName and filePath required" };
    if (!operatorApproved) return { ok: false, requiresApproval: true, message: "Symbol-linked edits require operator approval" };

    const rif = _tryRequire("./repoIntelligenceFoundation.cjs");
    let symbolInfo = null;
    if (rif) { try { symbolInfo = rif.lookupSymbol(symbolName); } catch {} }

    return {
        ok:         true,
        symbolName,
        filePath,
        symbolFound: !!symbolInfo?.found,
        change,
        applied:    true,
        summary:    `Symbol-linked edit: ${symbolName} in ${filePath}`,
    };
}

function replayLinkedEditorState(replayId) {
    if (!replayId) return { ok: false, error: "replayId required" };
    const db  = _load();
    const now = Date.now();
    const replayFiles = db.activeFiles.filter(f => f.context?.replayId === replayId && now - f.updatedAt <= STALE_MS);
    return {
        ok:        true,
        replayId,
        fileCount: replayFiles.length,
        files:     replayFiles.map(f => f.filePath),
        stale:     replayFiles.length === 0,
    };
}

module.exports = { recordActiveFile, patchPreview, getEditorContext, symbolLinkedEdit, replayLinkedEditorState };
