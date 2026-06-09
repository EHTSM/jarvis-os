"use strict";
/**
 * Phase 542 — Advanced VS Code Operations
 *
 * Active file awareness, patch previews, contextual file targeting,
 * replay-linked edits, debugging-context continuity, safe patch application.
 *
 * Prevents: unsafe overwrites, duplicate patch execution, stale editor targeting.
 * Local-first, no VS Code API dependency — models editor context for safety.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const PATCH_LOG_PATH = path.join(__dirname, "../../data/vscode-patch-log.json");
const MAX_PATCHES    = 200;
const PATCH_TTL_MS   = 24 * 60 * 60 * 1000;
const MAX_PATCH_LINES = 2000;
const MAX_PATCH_LENGTH = 128 * 1024;

// ── Patch log ─────────────────────────────────────────────────────────────────

function _loadPatches() {
    try {
        const raw = JSON.parse(fs.readFileSync(PATCH_LOG_PATH, "utf8"));
        const now = Date.now();
        return raw.filter(p => now - p.ts < PATCH_TTL_MS);
    } catch { return []; }
}

function _savePatches(patches) {
    try {
        const dir = path.dirname(PATCH_LOG_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(PATCH_LOG_PATH, JSON.stringify(patches.slice(-MAX_PATCHES), null, 2));
    } catch {}
}

function _patchKey(filePath, content) {
    return crypto.createHash("md5").update(`${filePath}:${content}`).digest("hex");
}

function _absPath(filePath) {
    return path.normalize(path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath));
}

function _isPathInWorkspace(filePath) {
    const cwd = path.resolve(process.cwd());
    const target = path.resolve(filePath);
    return target === cwd || target.startsWith(cwd + path.sep);
}

function _ensureDirectory(absPath) {
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _parsePatchContent(patchContent) {
    if (typeof patchContent !== "string") return { ok: false, error: "patchContent must be a string" };
    const normalized = patchContent.replace(/\r\n/g, "\n");
    if (normalized.length > MAX_PATCH_LENGTH) return { ok: false, error: "patchContent is too large" };
    const lines = normalized.split("\n");
    if (lines.length > MAX_PATCH_LINES) return { ok: false, error: "patchContent has too many lines" };

    const hunks = [];
    let current = null;
    let sawHeader = false;

    for (const line of lines) {
        const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (hunkMatch) {
            sawHeader = true;
            if (current) hunks.push(current);
            current = {
                header: line,
                oldStart: Number(hunkMatch[1]),
                oldCount: hunkMatch[2] ? Number(hunkMatch[2]) : 1,
                newStart: Number(hunkMatch[3]),
                newCount: hunkMatch[4] ? Number(hunkMatch[4]) : 1,
                lines: [],
            };
            continue;
        }

        if (current) {
            if (line === "\\ No newline at end of file") continue;
            const op = line[0];
            if (op === "+" || op === "-" || op === " ") {
                current.lines.push({ op, text: line.slice(1) });
            } else {
                current.lines.push({ op: " ", text: line });
            }
            continue;
        }

        if (/^diff --git |^--- |^\+\+\+ /.test(line)) continue;
        if (/^[ +-]/.test(line) || line === "\\ No newline at end of file") {
            if (!current) current = { header: null, oldStart: 1, oldCount: 0, newStart: 1, newCount: 0, lines: [] };
            if (line === "\\ No newline at end of file") continue;
            const op = line[0];
            current.lines.push({ op, text: line.slice(1) });
        }
    }

    if (current) {
        if (!current.header) {
            current.oldCount = current.lines.filter(l => l.op !== "+").length;
            current.newCount = current.lines.filter(l => l.op !== "-").length;
        }
        hunks.push(current);
    }

    if (!hunks.length) return { ok: false, error: "patchContent could not be parsed as a diff" };
    return { ok: true, hunks, seenHunkHeader: sawHeader };
}

function _applySimplePatch(srcLines, hunk) {
    const pattern = hunk.lines.filter(l => l.op !== "+").map(l => l.text);
    if (pattern.length === 0) {
        return { ok: true, result: srcLines.concat(hunk.lines.filter(l => l.op === "+").map(l => l.text)) };
    }

    for (let start = 0; start <= srcLines.length - pattern.length; start++) {
        let match = true;
        for (let j = 0; j < pattern.length; j += 1) {
            if (srcLines[start + j] !== pattern[j]) {
                match = false;
                break;
            }
        }
        if (!match) continue;

        const dst = srcLines.slice(0, start);
        for (const line of hunk.lines) {
            if (line.op === "-") continue;
            dst.push(line.text);
        }
        dst.push(...srcLines.slice(start + pattern.length));
        return { ok: true, result: dst };
    }

    return { ok: false, error: "simple patch did not match any source context" };
}

function _simulatePatchApplication(content, patch) {
    const srcLines = content === "" ? [] : content.split(/\r?\n/);
    const hasTrailingNewline = content.endsWith("\n");

    if (patch.hunks.every(h => !h.header)) {
        let current = srcLines;
        for (const hunk of patch.hunks) {
            const result = _applySimplePatch(current, hunk);
            if (!result.ok) return result;
            current = result.result;
        }
        const output = current.join("\n") + (hasTrailingNewline ? "\n" : "");
        return { ok: true, result: output };
    }

    const dst = [];
    let cursor = 0;

    for (const hunk of patch.hunks) {
        const oldIdx = Math.max(0, hunk.oldStart - 1);
        if (oldIdx < cursor) return { ok: false, error: "patch hunks are overlapping or out of order" };
        dst.push(...srcLines.slice(cursor, oldIdx));
        let idx = oldIdx;

        for (const line of hunk.lines) {
            if (line.op === " ") {
                if (idx >= srcLines.length || srcLines[idx] !== line.text) {
                    return { ok: false, error: `patch context mismatch at source line ${idx + 1}` };
                }
                dst.push(line.text);
                idx += 1;
            } else if (line.op === "-") {
                if (idx >= srcLines.length || srcLines[idx] !== line.text) {
                    return { ok: false, error: `patch deletion mismatch at source line ${idx + 1}` };
                }
                idx += 1;
            } else if (line.op === "+") {
                dst.push(line.text);
            } else {
                dst.push(line.text);
            }
        }

        cursor = idx;
    }

    dst.push(...srcLines.slice(cursor));
    const result = dst.join("\n") + (hasTrailingNewline ? "\n" : "");
    return { ok: true, result };
}

function _summarizePatch(patchContent, validation) {
    const lines = patchContent.split(/\r?\n/);
    const added = lines.filter(l => l.startsWith("+") && !l.startsWith("+++ ")).length;
    const removed = lines.filter(l => l.startsWith("-") && !l.startsWith("--- ")).length;
    return {
        linesAdded: added,
        linesRemoved: removed,
        netChange: added - removed,
        targetExists: validation.exists,
        targetSize: validation.size,
    };
}

// ── Active file context ───────────────────────────────────────────────────────

/**
 * Validates that a target file is safe to patch.
 * Returns: { safe, reason, exists, size, lastModified }
 */
function validateFileTarget(filePath) {
    if (!filePath) return { safe: false, reason: "no file path provided" };
    const abs = _absPath(filePath);
    if (!_isPathInWorkspace(abs)) return { safe: false, reason: "file path is outside the current workspace", exists: false, size: 0, lastModified: null, absPath: abs };
    try {
        const stat = fs.statSync(abs);
        const size = stat.size;
        if (size > 2 * 1024 * 1024) return { safe: false, reason: `file too large (${Math.round(size / 1024)}KB)`, exists: true, size, lastModified: stat.mtimeMs, absPath: abs };
        return { safe: true, reason: "file valid", exists: true, size, lastModified: stat.mtimeMs, absPath: abs };
    } catch {
        return { safe: true, reason: "file does not exist — will create", exists: false, size: 0, lastModified: null, absPath: abs };
    }
}

// ── Patch preview ─────────────────────────────────────────────────────────────

/**
 * Generates a safe preview of a patch without applying it.
 */
function previewPatch(filePath, patchContent, opts = {}) {
    const validation = validateFileTarget(filePath);
    if (!validation.safe) return { ok: false, error: validation.reason };

    const key = _patchKey(validation.absPath, patchContent);
    const existing = _loadPatches().find(p => p.key === key);
    const duplicate = !!existing;

    const summary = _summarizePatch(patchContent, validation);
    const parsed = _parsePatchContent(patchContent);
    const preview = { ...summary, patchLines: Math.min(patchContent.split(/\r?\n/).length, MAX_PATCH_LINES) };

    if (parsed.ok) {
        const current = validation.exists ? fs.readFileSync(validation.absPath, "utf8") : "";
        const simulation = _simulatePatchApplication(current, parsed);
        preview.canApply = simulation.ok;
        if (!simulation.ok) preview.applyError = simulation.error;
        preview.hunks = parsed.hunks.slice(0, 5).map(h => ({ header: h.header, oldStart: h.oldStart, oldCount: h.oldCount, newStart: h.newStart, newCount: h.newCount, lines: h.lines.slice(0, 8).map(l => `${l.op}${l.text}`) }));
    } else {
        preview.canApply = null;
        preview.parseError = parsed.error;
    }

    return {
        ok:       true,
        filePath: validation.absPath,
        key,
        duplicate,
        duplicateWarning: duplicate ? `This patch was already applied at ${new Date(existing.ts).toISOString()}` : null,
        preview,
        sessionId: opts.sessionId || null,
        replayId:  opts.replayId  || null,
    };
}

// ── Safe patch application ────────────────────────────────────────────────────

/**
 * Applies a validated patch to a workspace file and records the edit.
 * Ensures idempotency, workspace containment, and patch simulation before write.
 */
function applyPatch(filePath, patchContent, opts = {}) {
    if (!filePath || !patchContent) return { ok: false, error: "filePath and patchContent required" };
    const validation = validateFileTarget(filePath);
    if (!validation.safe) return { ok: false, error: validation.reason };

    const key = _patchKey(validation.absPath, patchContent);
    const patches = _loadPatches();
    const dup = patches.find(p => p.key === key && p.status === "applied");
    if (dup) return { ok: false, duplicate: true, error: "patch already applied", appliedAt: new Date(dup.ts).toISOString() };

    const parsed = _parsePatchContent(patchContent);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    if (!validation.exists && parsed.hunks.some(h => h.lines.some(l => l.op === "-"))) {
        return { ok: false, error: "patch removes lines from a file that does not exist" };
    }

    const current = validation.exists ? fs.readFileSync(validation.absPath, "utf8") : "";
    const simulation = _simulatePatchApplication(current, parsed);
    if (!simulation.ok) return { ok: false, error: simulation.error };

    _ensureDirectory(validation.absPath);
    fs.writeFileSync(validation.absPath, simulation.result, "utf8");

    const summary = _summarizePatch(patchContent, validation);
    const entry = {
        key,
        filePath: validation.absPath,
        status: "applied",
        patchContent,
        patchSummary: summary,
        sessionId: opts.sessionId || null,
        replayId: opts.replayId || null,
        ts: Date.now(),
    };
    patches.push(entry);
    _savePatches(patches);

    return {
        ok: true,
        key,
        filePath: validation.absPath,
        status: "applied",
        ts: new Date().toISOString(),
        preview: { ...summary, canApply: true },
    };
}

function recordPatchApplication(filePath, patchContent, opts = {}) {
    if (!filePath || !patchContent) return { ok: false, error: "filePath and patchContent required" };
    const validation = validateFileTarget(filePath);
    if (!validation.safe) return { ok: false, error: validation.reason };

    const key = _patchKey(validation.absPath, patchContent);
    const patches = _loadPatches();
    const dup = patches.find(p => p.key === key);
    if (dup) return { ok: false, duplicate: true, error: "patch already recorded or applied", recordedAt: new Date(dup.ts).toISOString() };

    if (opts.apply) {
        return applyPatch(filePath, patchContent, opts);
    }

    const summary = _summarizePatch(patchContent, validation);
    const entry = {
        key,
        filePath: validation.absPath,
        status: "recorded",
        patchContent,
        patchSummary: summary,
        sessionId: opts.sessionId || null,
        replayId: opts.replayId || null,
        ts: Date.now(),
    };
    patches.push(entry);
    _savePatches(patches);
    return { ok: true, key, filePath: validation.absPath, ts: new Date().toISOString(), status: "recorded" };
}

// ── Replay-linked edits ───────────────────────────────────────────────────────

function listReplayEdits(replayId) {
    if (!replayId) return { ok: false, error: "replayId required" };
    const patches = _loadPatches().filter(p => p.replayId === replayId);
    return { ok: true, replayId, count: patches.length, patches };
}

// ── Debugging context continuity ──────────────────────────────────────────────

/**
 * Records the currently active debugging file context for session continuity.
 */
function saveEditorContext(sessionId, context) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const pw = _tryRequire("./persistentWorkspace.cjs");
    if (!pw) return { ok: false, error: "persistentWorkspace unavailable" };

    const workspaces = pw.listWorkspaces();
    const ws = workspaces.find(w => w.operatorId === (context.operatorId || "default"));
    if (!ws) return { ok: false, error: "no workspace for operator" };

    return pw.saveDebuggingContext(ws.id, {
        sessionId,
        activeFile:      context.activeFile      || null,
        openFiles:       (context.openFiles      || []).slice(0, 10),
        breakpoints:     (context.breakpoints    || []).slice(0, 20),
        watchExpressions:(context.watchExpressions || []).slice(0, 10),
        resolved:        false,
    });
}

// ── Contextual file targeting ─────────────────────────────────────────────────

/**
 * Finds the most relevant files for a given context/error string.
 */
function findContextualFiles(errorText, { projectPath = process.cwd(), limit = 5 } = {}) {
    if (!errorText) return { ok: false, error: "errorText required" };

    const files = [];
    // Extract file paths from error text (common Node.js error format)
    const filePattern = /(?:at .+? \()([^)]+\.(?:js|cjs|mjs|ts))(?::\d+:\d+)?/g;
    let m;
    while ((m = filePattern.exec(errorText)) !== null) {
        const fp = m[1];
        if (!files.includes(fp) && fs.existsSync(fp)) files.push(fp);
        if (files.length >= limit) break;
    }

    return {
        ok:    true,
        files: files.slice(0, limit),
        count: files.length,
        errorText: errorText.slice(0, 200),
    };
}

// ── Patch history ─────────────────────────────────────────────────────────────

function patchHistory({ sessionId, replayId, limit = 20 } = {}) {
    let patches = _loadPatches();
    if (sessionId) patches = patches.filter(p => p.sessionId === sessionId);
    if (replayId)  patches = patches.filter(p => p.replayId  === replayId);
    return { count: patches.length, patches: patches.slice(-limit) };
}

module.exports = {
    validateFileTarget, previewPatch, recordPatchApplication, applyPatch,
    listReplayEdits, saveEditorContext, findContextualFiles, patchHistory,
};
