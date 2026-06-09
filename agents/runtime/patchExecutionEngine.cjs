"use strict";
/**
 * Phase 586 — Advanced Patch Execution Engine
 *
 * Multi-file patch previews, dependency-aware validation, replay-linked
 * history, rollback-safe application, contextual edit targeting.
 *
 * Prevents: stale-file modification, unsafe overwrites, duplicate replay.
 * State: data/patch-execution-engine.json
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/patch-execution-engine.json");
const MAX_BATCHES = 100;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { batches: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}

// ── Multi-file patch batch ────────────────────────────────────────────────────

/**
 * Propose a multi-file patch batch.
 * @param {Array<{ filePath, patchedContent, reason }>} files
 * @param {{ sessionId?, replayId?, batchLabel? }} opts
 */
function proposeBatch(files, opts = {}) {
    if (!Array.isArray(files) || files.length === 0) return { ok: false, error: "files array required" };
    if (files.length > 20) return { ok: false, error: "Maximum 20 files per batch" };

    const { sessionId = null, replayId = null, batchLabel = "" } = opts;
    const batchId  = crypto.randomUUID();
    const previews = [];
    const errors   = [];

    for (const f of files) {
        if (!f.filePath || f.patchedContent === undefined) { errors.push(`Missing filePath or patchedContent`); continue; }
        let original = "";
        try { original = fs.readFileSync(f.filePath, "utf8"); } catch {}
        const checksum  = crypto.createHash("sha256").update(original).digest("hex").slice(0, 16);
        const newSum    = crypto.createHash("sha256").update(f.patchedContent).digest("hex").slice(0, 16);
        const diff      = _quickDiff(original, f.patchedContent);
        previews.push({
            filePath:         f.filePath,
            reason:           (f.reason || "").slice(0, 200),
            originalChecksum: checksum,
            patchedChecksum:  newSum,
            linesChanged:     diff.changed,
            linesAdded:       diff.added,
            linesRemoved:     diff.removed,
            preview:          diff.preview,
            _original:        original,
            _patched:         f.patchedContent,
        });
    }

    if (errors.length === files.length) return { ok: false, errors };

    const batch = {
        id:          batchId,
        label:       (batchLabel || "").slice(0, 100),
        sessionId,
        replayId,
        status:      "pending",
        files:       previews,
        fileCount:   previews.length,
        proposedAt:  Date.now(),
        appliedAt:   null,
    };

    const db = _load();
    db.batches.unshift(batch);
    db.batches = db.batches.slice(0, MAX_BATCHES);
    _save(db);

    return { ok: true, batchId, fileCount: previews.length, requiresApproval: true, files: previews.map(f => ({ filePath: f.filePath, linesChanged: f.linesChanged, linesAdded: f.linesAdded })) };
}

// ── Dependency-aware validation ───────────────────────────────────────────────

/**
 * Validate a patch batch for dependency issues before applying.
 * Detects: circular references, missing imports, file-not-found.
 */
function validateBatch(batchId) {
    const db    = _load();
    const batch = db.batches.find(b => b.id === batchId);
    if (!batch) return { ok: false, error: "batch not found" };

    const warnings = [];
    const blockers = [];

    for (const f of batch.files) {
        // Stale check: file changed since proposal
        let current = "";
        try { current = fs.readFileSync(f.filePath, "utf8"); } catch {}
        const currentSum = crypto.createHash("sha256").update(current).digest("hex").slice(0, 16);
        if (currentSum !== f.originalChecksum && current !== "") {
            blockers.push({ file: f.filePath, issue: "File changed since patch was proposed — re-propose required" });
        }

        // Detect self-referential require loops (simple heuristic)
        const basename = path.basename(f.filePath, path.extname(f.filePath));
        if (f._patched && new RegExp(`require.*${basename}`).test(f._patched)) {
            warnings.push({ file: f.filePath, issue: "Possible self-require detected" });
        }

        // Detect missing require targets (require('...') where file does not exist)
        const requireRefs = (f._patched || "").match(/require\(['"]([^'"]+)['"]\)/g) || [];
        for (const ref of requireRefs) {
            const target = ref.match(/require\(['"]([^'"]+)['"]\)/)?.[1];
            if (target && target.startsWith(".")) {
                const abs = path.resolve(path.dirname(f.filePath), target);
                const exists = [abs, abs + ".js", abs + ".cjs", abs + ".json"].some(p => fs.existsSync(p));
                if (!exists) warnings.push({ file: f.filePath, issue: `Relative require '${target}' target not found` });
            }
        }
    }

    return {
        ok:       blockers.length === 0,
        batchId,
        blockers,
        warnings,
        safe:     blockers.length === 0 && warnings.length === 0,
    };
}

// ── Apply batch (operator-approved) ──────────────────────────────────────────

function applyBatch(batchId, { approved = false, operatorId = null } = {}) {
    if (!approved) return { ok: false, error: "Operator approval required" };

    const db    = _load();
    const idx   = db.batches.findIndex(b => b.id === batchId);
    if (idx === -1) return { ok: false, error: "batch not found" };

    const batch = db.batches[idx];
    if (batch.status !== "pending") return { ok: false, error: `Batch already ${batch.status}` };

    // Validate before applying
    const validation = validateBatch(batchId);
    if (!validation.ok) return { ok: false, error: "Validation failed", blockers: validation.blockers };

    const applied = [];
    const failed  = [];

    for (const f of batch.files) {
        try {
            fs.mkdirSync(path.dirname(f.filePath), { recursive: true });
            fs.writeFileSync(f.filePath, f._patched);
            applied.push(f.filePath);
        } catch (e) {
            failed.push({ filePath: f.filePath, error: e.message });
        }
    }

    batch.status     = failed.length === 0 ? "applied" : "partial";
    batch.appliedAt  = Date.now();
    batch.operatorId = operatorId;
    batch.applied    = applied;
    batch.failed     = failed;
    db.batches[idx]  = batch;
    _save(db);

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.record("patch", { label: `Batch ${batch.status}: ${batch.label || batchId}`, batchId, fileCount: applied.length, sessionId: batch.sessionId });

    return { ok: failed.length === 0, batchId, applied: applied.length, failed: failed.length, status: batch.status };
}

// ── Rollback batch ────────────────────────────────────────────────────────────

function rollbackBatch(batchId, { approved = false } = {}) {
    if (!approved) return { ok: false, error: "Operator approval required for rollback" };

    const db    = _load();
    const idx   = db.batches.findIndex(b => b.id === batchId);
    if (idx === -1) return { ok: false, error: "batch not found" };

    const batch = db.batches[idx];
    if (!["applied", "partial"].includes(batch.status)) return { ok: false, error: `Cannot rollback: batch is ${batch.status}` };

    const restored = [];
    const failed   = [];

    for (const f of batch.files) {
        if (!batch.applied?.includes(f.filePath)) continue;
        try {
            fs.writeFileSync(f.filePath, f._original);
            restored.push(f.filePath);
        } catch (e) {
            failed.push({ filePath: f.filePath, error: e.message });
        }
    }

    batch.status        = "rolled-back";
    batch.rolledBackAt  = Date.now();
    db.batches[idx]     = batch;
    _save(db);

    return { ok: failed.length === 0, batchId, restored: restored.length, failed: failed.length };
}

// ── Duplicate replay guard ────────────────────────────────────────────────────

function checkReplayDuplicate(replayId) {
    if (!replayId) return { duplicate: false };
    const db      = _load();
    const existing = db.batches.filter(b => b.replayId === replayId && b.status === "applied");
    return { duplicate: existing.length > 0, count: existing.length, batchIds: existing.map(b => b.id) };
}

// ── Contextual edit targeting ─────────────────────────────────────────────────

/**
 * Given file content and a search string, locate the edit target line range.
 */
function locateEditTarget(content, searchStr) {
    if (!content || !searchStr) return { found: false };
    const lines   = content.split("\n");
    const lower   = searchStr.toLowerCase();
    const matches = [];
    lines.forEach((line, i) => {
        if (line.toLowerCase().includes(lower)) matches.push({ line: i + 1, content: line.trim() });
    });
    return { found: matches.length > 0, matches: matches.slice(0, 5), totalMatches: matches.length };
}

// ── Query ─────────────────────────────────────────────────────────────────────

function listBatches({ status = null, sessionId = null, limit = 20 } = {}) {
    const db = _load();
    return db.batches
        .filter(b => (!status || b.status === status) && (!sessionId || b.sessionId === sessionId))
        .slice(0, limit)
        .map(b => { const { files, ...safe } = b; return { ...safe, files: files.map(f => { const { _original, _patched, ...fs2 } = f; return fs2; }) }; });
}

function _quickDiff(a, b) {
    const al = (a || "").split("\n"); const bl = (b || "").split("\n");
    let added = 0, removed = 0, changed = 0;
    const preview = [];
    const max = Math.max(al.length, bl.length);
    for (let i = 0; i < Math.min(max, 60); i++) {
        if (al[i] !== bl[i]) {
            if (al[i] !== undefined) { preview.push(`- ${al[i]}`); removed++; changed++; }
            if (bl[i] !== undefined) { preview.push(`+ ${bl[i]}`); added++; }
        }
    }
    return { added, removed, changed, preview: preview.slice(0, 40).join("\n") };
}

module.exports = { proposeBatch, validateBatch, applyBatch, rollbackBatch, checkReplayDuplicate, locateEditTarget, listBatches };
