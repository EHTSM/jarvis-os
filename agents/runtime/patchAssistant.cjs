"use strict";
/**
 * Phase 571 — Contextual Code Patch Assistance
 *
 * Targeted file patching with operator approval, diff preview,
 * rollback-safe application, and replay-linked change tracking.
 *
 * Prevents: blind overwrites, unreviewed changes, non-replayable patches.
 * State: data/patch-history.json
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const HISTORY_PATH = path.join(__dirname, "../../data/patch-history.json");
const MAX_HISTORY  = 200;

function _loadHistory() {
    try { return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8")); }
    catch { return { patches: [], patchSets: [] }; }
}

function _ensureSets(db) {
    if (!Array.isArray(db.patchSets)) db.patchSets = [];
}

function _saveHistory(db) {
    try {
        fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
        fs.writeFileSync(HISTORY_PATH, JSON.stringify(db, null, 2));
    } catch {}
}

function _prunHistory(db) {
    db.patches = db.patches.slice(0, MAX_HISTORY);
}

// ── Diff generation ──────────────────────────────────────────────────────────

/**
 * Generate a line-level unified diff preview between original and patched content.
 */
function generateDiff(original, patched, label = "patch") {
    const origLines   = (original || "").split("\n");
    const patchLines  = (patched  || "").split("\n");
    const hunks       = [];
    let changed       = 0;
    let added         = 0;
    let removed       = 0;

    const maxLen = Math.max(origLines.length, patchLines.length);
    let i = 0;
    while (i < maxLen) {
        const o = origLines[i] ?? null;
        const p = patchLines[i] ?? null;
        if (o !== p) {
            if (o !== null) { hunks.push(`- ${o}`); removed++; changed++; }
            if (p !== null) { hunks.push(`+ ${p}`); added++; }
        } else {
            hunks.push(`  ${o ?? ""}`);
        }
        i++;
    }

    return {
        label,
        linesAdded:   added,
        linesRemoved: removed,
        linesChanged: changed,
        preview:      hunks.slice(0, 120).join("\n"),
        truncated:    hunks.length > 120,
    };
}

// ── Patch proposal ────────────────────────────────────────────────────────────

/**
 * Propose a patch. Returns a patch record for operator approval.
 * Does NOT apply — operator must call applyPatch(patchId).
 *
 * @param {object} opts
 * @param {string} opts.filePath      — absolute path
 * @param {string} opts.patchedContent — full new file content
 * @param {string} opts.reason        — why this patch is needed
 * @param {string} [opts.sessionId]
 * @param {string} [opts.replayId]    — linked replay execution ID
 */
function proposePatch(opts) {
    const { filePath, patchedContent, reason, sessionId = null, replayId = null } = opts || {};
    if (!filePath || patchedContent === undefined) return { ok: false, error: "filePath and patchedContent required" };

    let originalContent = "";
    try { originalContent = fs.readFileSync(filePath, "utf8"); } catch { originalContent = ""; }

    const diff     = generateDiff(originalContent, patchedContent, path.basename(filePath));
    const patchId  = crypto.randomUUID();
    const checksum = crypto.createHash("sha256").update(patchedContent).digest("hex").slice(0, 16);

    const record = {
        id:               patchId,
        filePath,
        reason:           (reason || "").slice(0, 200),
        originalChecksum: crypto.createHash("sha256").update(originalContent).digest("hex").slice(0, 16),
        patchedChecksum:  checksum,
        diff,
        status:           "pending",
        sessionId,
        replayId,
        proposedAt:       Date.now(),
        appliedAt:        null,
        rolledBackAt:     null,
    };

    // Store pending patch with content snapshot
    const db = _loadHistory();
    db.patches.unshift({ ...record, _patchedContent: patchedContent, _originalContent: originalContent });
    _prunHistory(db);
    _saveHistory(db);

    return { ok: true, patchId, diff, requiresApproval: true, status: "pending" };
}

// ── Apply (operator-approved) ─────────────────────────────────────────────────

/**
 * Apply a previously proposed patch. Requires explicit operator approval flag.
 */
function applyPatch(patchId, { approved = false, operatorId = null } = {}) {
    if (!approved) return { ok: false, error: "Operator approval required: pass { approved: true }" };

    const db     = _loadHistory();
    const idx    = db.patches.findIndex(p => p.id === patchId);
    if (idx === -1) return { ok: false, error: `Patch ${patchId} not found` };

    const record = db.patches[idx];
    if (record.status !== "pending") return { ok: false, error: `Patch already ${record.status}` };

    // Verify file hasn't changed since proposal
    let current = "";
    try { current = fs.readFileSync(record.filePath, "utf8"); } catch {}
    const currentChecksum = crypto.createHash("sha256").update(current).digest("hex").slice(0, 16);
    if (currentChecksum !== record.originalChecksum && current !== "") {
        return { ok: false, error: "File changed since patch was proposed — re-propose required", stale: true };
    }

    try {
        fs.mkdirSync(path.dirname(record.filePath), { recursive: true });
        fs.writeFileSync(record.filePath, record._patchedContent);
    } catch (e) {
        return { ok: false, error: `Write failed: ${e.message}` };
    }

    record.status     = "applied";
    record.appliedAt  = Date.now();
    record.operatorId = operatorId;
    db.patches[idx]   = record;
    _saveHistory(db);

    // Emit to event bus if available
    const bus = _tryRequire("./runtimeEventBus.cjs");
    if (bus) bus.emit("patch:applied", { patchId, filePath: record.filePath, operatorId });

    return { ok: true, patchId, filePath: record.filePath, appliedAt: new Date(record.appliedAt).toISOString() };
}

// ── Rollback ─────────────────────────────────────────────────────────────────

/**
 * Roll back an applied patch, restoring the original content.
 */
function rollbackPatch(patchId, { approved = false } = {}) {
    if (!approved) return { ok: false, error: "Operator approval required for rollback" };

    const db     = _loadHistory();
    const idx    = db.patches.findIndex(p => p.id === patchId);
    if (idx === -1) return { ok: false, error: `Patch ${patchId} not found` };

    const record = db.patches[idx];
    if (record.status !== "applied") return { ok: false, error: `Cannot rollback: patch is ${record.status}` };

    try {
        fs.writeFileSync(record.filePath, record._originalContent);
    } catch (e) {
        return { ok: false, error: `Rollback write failed: ${e.message}` };
    }

    record.status       = "rolled-back";
    record.rolledBackAt = Date.now();
    db.patches[idx]     = record;
    _saveHistory(db);

    const bus = _tryRequire("./runtimeEventBus.cjs");
    if (bus) bus.emit("patch:rolled-back", { patchId, filePath: record.filePath });

    return { ok: true, patchId, filePath: record.filePath, rolledBackAt: new Date(record.rolledBackAt).toISOString() };
}

// ── Query ─────────────────────────────────────────────────────────────────────

function listPatches({ status = null, sessionId = null, limit = 20 } = {}) {
    const db = _loadHistory();
    return db.patches
        .filter(p => (!status || p.status === status) && (!sessionId || p.sessionId === sessionId))
        .slice(0, limit)
        .map(({ _patchedContent, _originalContent, ...safe }) => safe);
}

function getPatch(patchId) {
    const db  = _loadHistory();
    const rec = db.patches.find(p => p.id === patchId);
    if (!rec) return null;
    const { _patchedContent, _originalContent, ...safe } = rec;
    return safe;
}

/**
 * Dependency repair suggestions based on error patterns.
 */
function depairSuggestions(errorText = "") {
    const suggestions = [];
    const lower = errorText.toLowerCase();
    if (/cannot find module|module not found/.test(lower))
        suggestions.push({ action: "npm install", reason: "Missing module detected", confidence: 85 });
    if (/peer dep|peer dependency/.test(lower))
        suggestions.push({ action: "npm install --legacy-peer-deps", reason: "Peer dependency conflict", confidence: 70 });
    if (/enoent.*package\.json/.test(lower))
        suggestions.push({ action: "npm init -y", reason: "package.json missing", confidence: 80 });
    if (/gyp error|node-gyp/.test(lower))
        suggestions.push({ action: "npm install --ignore-scripts", reason: "Native build failure — skip scripts", confidence: 65 });
    if (suggestions.length === 0)
        suggestions.push({ action: "npm ci", reason: "Clean reinstall from lockfile", confidence: 60 });
    return suggestions;
}

// ── Post-patch verification ───────────────────────────────────────────────────

/**
 * Run a build/test command against an applied patch and return a structured result.
 *
 * Parses node --test TAP output (ℹ pass N / ℹ fail N),
 * npm exit codes, and raw stdout for build success/failure.
 *
 * @param {string} patchId
 * @param {object} opts
 * @param {string}   opts.command   — shell command to run (default: node --test fast suite)
 * @param {boolean}  opts.autoRollback — if true, rolls back automatically on FAIL
 * @returns {Promise<{ ok, verified, buildPassed, testsPassed, exitCode, pass, fail, durationMs, summary, rolledBack }>}
 */
async function verifyPatch(patchId, { command = "node --test tests/runtime/01-taskRouter.test.cjs", autoRollback = false } = {}) {
    const db  = _loadHistory();
    const idx = db.patches.findIndex(p => p.id === patchId);
    if (idx === -1) return { ok: false, error: "Patch not found" };

    const record = db.patches[idx];
    if (record.status !== "applied") return { ok: false, error: `Cannot verify: patch is ${record.status}` };

    const ta = _tryRequire("../terminalAgent.cjs");
    if (!ta) return { ok: false, error: "terminalAgent unavailable" };

    const result = await ta.run(command);
    const out    = (result.stdout || "") + "\n" + (result.stderr || "");

    // Parse node --test TAP output (ℹ prefix)
    const tapTests = parseInt(out.match(/ℹ tests (\d+)/)?.[1]  ?? "-1");
    const tapPass  = parseInt(out.match(/ℹ pass (\d+)/)?.[1]   ?? "-1");
    const tapFail  = parseInt(out.match(/ℹ fail (\d+)/)?.[1]   ?? "-1");
    const tapDur   = parseFloat(out.match(/ℹ duration_ms ([\d.]+)/)?.[1] ?? "0");
    const isTap    = tapTests >= 0;

    // Derive pass/fail counts — TAP format if available, else exitCode only
    const pass  = isTap ? tapPass : (result.exitCode === 0 ? 1 : 0);
    const fail  = isTap ? tapFail : (result.exitCode === 0 ? 0 : 1);

    const buildPassed = result.exitCode === 0;
    const testsPassed = buildPassed && fail === 0;
    const verdict     = testsPassed ? "PASS" : "FAIL";

    // Error extraction: first error line from stderr if any
    const firstError = (result.stderr || "").split("\n").find(l => /error|fail|exception/i.test(l))?.trim() || null;

    const summary = isTap
        ? `${verdict} — ${pass} passed, ${fail} failed, ${tapDur.toFixed(0)}ms (exit ${result.exitCode})`
        : `${verdict} — exit ${result.exitCode}${firstError ? ` — ${firstError.slice(0, 100)}` : ""}`;

    // Store verification result in patch record
    db.patches[idx].verification = {
        command, verdict, pass, fail,
        exitCode:   result.exitCode,
        durationMs: isTap ? tapDur : result.durationMs ?? null,
        firstError,
        verifiedAt: Date.now(),
    };
    _saveHistory(db);

    // Auto-rollback on failure if requested
    let rolledBack = false;
    if (!testsPassed && autoRollback) {
        const rb = rollbackPatch(patchId, { approved: true });
        rolledBack = rb.ok;
        db.patches[idx].status = "rolled-back";
    }

    const bus = _tryRequire("./runtimeEventBus.cjs");
    if (bus) bus.emit("patch:verified", { patchId, verdict, pass, fail, rolledBack });

    return {
        ok:          testsPassed,
        verified:    true,
        buildPassed,
        testsPassed,
        exitCode:    result.exitCode,
        pass,
        fail,
        durationMs:  isTap ? tapDur : null,
        summary,
        firstError,
        stdout:      result.stdout,
        stderr:      result.stderr,
        rolledBack,
    };
}

// ── Patch sets (multi-file atomic changes) ───────────────────────────────────
//
// A patch set groups multiple single-file patches under one setId.
// Apply and rollback are atomic: all succeed or none are committed.
// Verification runs once against the full set after all files are applied.
//
// Storage: db.patchSets[] in the same patch-history.json.
// Each entry stores only metadata + the patchId list — patch content
// remains in db.patches[] where it already lives.
//
// Atomic guarantee:
//   applySet:    if any individual apply fails → rollback all applied so far
//   rollbackSet: rolls back in reverse order (last applied first)

const MAX_SET_FILES = 20;
const MAX_SETS      = 50;

/**
 * Propose a set of patches across multiple files.
 *
 * @param {Array<{filePath, patchedContent, reason}>} files
 * @param {object} opts
 * @param {string} [opts.reason]      — overall reason for the change set
 * @param {string} [opts.operatorId]
 * @returns {{ ok, setId, patchIds[], fileCount, diffs[], requiresApproval }}
 */
function proposeSet(files, { reason = "", operatorId = null } = {}) {
    if (!Array.isArray(files) || files.length === 0)
        return { ok: false, error: "files array required" };
    if (files.length > MAX_SET_FILES)
        return { ok: false, error: `Too many files — max ${MAX_SET_FILES}` };

    const patchIds = [];
    const diffs    = [];
    const errors   = [];

    for (const f of files) {
        const result = proposePatch({
            filePath:       f.filePath,
            patchedContent: f.patchedContent,
            reason:         f.reason || reason,
        });
        if (!result.ok) { errors.push({ filePath: f.filePath, error: result.error }); continue; }
        patchIds.push(result.patchId);
        diffs.push({ filePath: f.filePath, patchId: result.patchId, diff: result.diff });
    }

    if (errors.length > 0)
        return { ok: false, error: "One or more proposals failed", errors };

    const setId = crypto.randomUUID();
    const db    = _loadHistory();
    _ensureSets(db);
    db.patchSets.unshift({
        setId,
        patchIds,
        reason:     (reason || "").slice(0, 200),
        operatorId,
        fileCount:  patchIds.length,
        status:     "pending",
        proposedAt: Date.now(),
        appliedAt:  null,
        rolledBackAt: null,
        verifiedAt: null,
    });
    if (db.patchSets.length > MAX_SETS) db.patchSets = db.patchSets.slice(0, MAX_SETS);
    _saveHistory(db);

    return {
        ok:               true,
        setId,
        patchIds,
        fileCount:        patchIds.length,
        diffs,
        requiresApproval: true,
        status:           "pending",
    };
}

/**
 * Apply all patches in a set. Atomic: on any failure, rolls back already-applied.
 *
 * @param {string} setId
 * @param {{ approved, operatorId }} opts
 * @returns {{ ok, setId, applied[], rolledBack, failedAt }}
 */
function applySet(setId, { approved = false, operatorId = null } = {}) {
    if (!approved) return { ok: false, error: "Operator approval required: pass { approved: true }" };

    const db  = _loadHistory();
    _ensureSets(db);
    const si  = db.patchSets.findIndex(s => s.setId === setId);
    if (si === -1) return { ok: false, error: `Patch set ${setId} not found` };

    const set = db.patchSets[si];
    if (set.status !== "pending") return { ok: false, error: `Patch set already ${set.status}` };

    const applied    = [];
    let   failedAt   = null;

    for (const patchId of set.patchIds) {
        const result = applyPatch(patchId, { approved: true, operatorId });
        if (!result.ok) {
            failedAt = { patchId, error: result.error };
            break;
        }
        applied.push(patchId);
    }

    if (failedAt) {
        // Atomic: roll back everything applied so far in reverse order
        for (const patchId of [...applied].reverse()) {
            rollbackPatch(patchId, { approved: true });
        }
        // Re-load so we don't overwrite individual patch statuses set by rollbackPatch
        const dbFail = _loadHistory(); _ensureSets(dbFail);
        const siFail = dbFail.patchSets.findIndex(s => s.setId === setId);
        if (siFail !== -1) { dbFail.patchSets[siFail].status = "failed"; _saveHistory(dbFail); }
        return { ok: false, setId, applied: [], rolledBack: applied, failedAt };
    }

    // Re-load after applyPatch calls so we don't overwrite their status updates
    const dbAfter = _loadHistory(); _ensureSets(dbAfter);
    const siAfter = dbAfter.patchSets.findIndex(s => s.setId === setId);
    if (siAfter !== -1) {
        dbAfter.patchSets[siAfter].status     = "applied";
        dbAfter.patchSets[siAfter].appliedAt  = Date.now();
        dbAfter.patchSets[siAfter].operatorId = operatorId;
    }
    _saveHistory(dbAfter);

    const bus = _tryRequire("./runtimeEventBus.cjs");
    if (bus) bus.emit("patchSet:applied", { setId, patchIds: applied, operatorId });

    return { ok: true, setId, applied, fileCount: applied.length, rolledBack: false, failedAt: null };
}

/**
 * Roll back all patches in a set in reverse order.
 *
 * @param {string} setId
 * @param {{ approved }} opts
 * @returns {{ ok, setId, rolledBack[] }}
 */
function rollbackSet(setId, { approved = false } = {}) {
    if (!approved) return { ok: false, error: "Operator approval required for rollback" };

    const db  = _loadHistory();
    _ensureSets(db);
    const si  = db.patchSets.findIndex(s => s.setId === setId);
    if (si === -1) return { ok: false, error: `Patch set ${setId} not found` };

    const set = db.patchSets[si];
    if (set.status !== "applied") return { ok: false, error: `Cannot rollback set: status is ${set.status}` };

    const rolledBack = [];
    const errors     = [];

    for (const patchId of [...set.patchIds].reverse()) {
        const r = rollbackPatch(patchId, { approved: true });
        if (r.ok) rolledBack.push(patchId);
        else errors.push({ patchId, error: r.error });
    }

    // Re-load after rollbackPatch calls to avoid overwriting their status updates
    const dbAfter = _loadHistory(); _ensureSets(dbAfter);
    const siAfter = dbAfter.patchSets.findIndex(s => s.setId === setId);
    if (siAfter !== -1) {
        dbAfter.patchSets[siAfter].status       = "rolled-back";
        dbAfter.patchSets[siAfter].rolledBackAt = Date.now();
    }
    _saveHistory(dbAfter);

    const bus = _tryRequire("./runtimeEventBus.cjs");
    if (bus) bus.emit("patchSet:rolled-back", { setId, rolledBack });

    return { ok: errors.length === 0, setId, rolledBack, errors, fileCount: rolledBack.length };
}

/**
 * Run verification against an applied patch set.
 * Runs the command once — applies to all files in the set together.
 *
 * @param {string} setId
 * @param {{ command, autoRollback }} opts
 * @returns {Promise<{ ok, verified, setId, buildPassed, testsPassed, summary, rolledBack }>}
 */
async function verifySet(setId, { command = "node --test tests/runtime/01-taskRouter.test.cjs", autoRollback = false } = {}) {
    const db  = _loadHistory();
    _ensureSets(db);
    const si  = db.patchSets.findIndex(s => s.setId === setId);
    if (si === -1) return { ok: false, error: `Patch set ${setId} not found` };

    const set = db.patchSets[si];
    if (set.status !== "applied") return { ok: false, error: `Cannot verify set: status is ${set.status}` };

    const ta = _tryRequire("../terminalAgent.cjs");
    if (!ta) return { ok: false, error: "terminalAgent unavailable" };

    const result = await ta.run(command);
    const out    = (result.stdout || "") + "\n" + (result.stderr || "");

    const tapTests = parseInt(out.match(/ℹ tests (\d+)/)?.[1]  ?? "-1");
    const tapPass  = parseInt(out.match(/ℹ pass (\d+)/)?.[1]   ?? "-1");
    const tapFail  = parseInt(out.match(/ℹ fail (\d+)/)?.[1]   ?? "-1");
    const tapDur   = parseFloat(out.match(/ℹ duration_ms ([\d.]+)/)?.[1] ?? "0");
    const isTap    = tapTests >= 0;

    const pass        = isTap ? tapPass : (result.exitCode === 0 ? 1 : 0);
    const fail        = isTap ? tapFail : (result.exitCode === 0 ? 0 : 1);
    const buildPassed = result.exitCode === 0;
    const testsPassed = buildPassed && fail === 0;
    const verdict     = testsPassed ? "PASS" : "FAIL";

    const summary = isTap
        ? `${verdict} — ${pass} passed, ${fail} failed, ${tapDur.toFixed(0)}ms (exit ${result.exitCode})`
        : `${verdict} — exit ${result.exitCode}`;

    db.patchSets[si].verification = { command, verdict, pass, fail, exitCode: result.exitCode, verifiedAt: Date.now() };
    db.patchSets[si].verifiedAt   = Date.now();
    _saveHistory(db);

    let rolledBack = false;
    if (!testsPassed && autoRollback) {
        const rb = rollbackSet(setId, { approved: true });
        rolledBack = rb.ok;
    }

    const bus = _tryRequire("./runtimeEventBus.cjs");
    if (bus) bus.emit("patchSet:verified", { setId, verdict, pass, fail, rolledBack });

    return {
        ok:          testsPassed,
        verified:    true,
        setId,
        patchIds:    set.patchIds,
        fileCount:   set.fileCount,
        buildPassed,
        testsPassed,
        exitCode:    result.exitCode,
        pass,
        fail,
        durationMs:  isTap ? tapDur : null,
        summary,
        stdout:      result.stdout,
        stderr:      result.stderr,
        rolledBack,
    };
}

/**
 * Get a patch set record (without patch content blobs).
 */
function getSet(setId) {
    const db  = _loadHistory();
    _ensureSets(db);
    return db.patchSets.find(s => s.setId === setId) ?? null;
}

/**
 * List patch sets.
 */
function listSets({ status = null, limit = 20 } = {}) {
    const db = _loadHistory();
    _ensureSets(db);
    return db.patchSets
        .filter(s => !status || s.status === status)
        .slice(0, limit);
}

module.exports = { proposePatch, applyPatch, rollbackPatch, verifyPatch, listPatches, getPatch, generateDiff, depairSuggestions, proposeSet, applySet, rollbackSet, verifySet, getSet, listSets };
