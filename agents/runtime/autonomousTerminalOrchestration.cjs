"use strict";
/**
 * Phase 619 — Autonomous Terminal Orchestration
 *
 * Chained terminal execution with recovery awareness, process supervision,
 * restart coordination, validation checkpoints.
 * PREVENTS: runaway shell loops, hidden execution, unsafe process resurrection.
 * All destructive commands require explicit approval.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH     = path.join(__dirname, "../../data/autonomous-terminal.json");
const MAX_SEQUENCES  = 50;
const SEQ_TTL        = 24 * 60 * 60 * 1000;
const MAX_CHAIN_DEPTH = 10;

// Runaway prevention: max 3 restarts per process per session
const MAX_RESTARTS_PER_SESSION = 3;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { sequences: [], restartLog: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - SEQ_TTL;
    db.sequences = (db.sequences || []).filter(s => s.createdAt > cutoff).slice(0, MAX_SEQUENCES);
}

// ── Command safety classification ─────────────────────────────────────────────

const BLOCKED_PATTERNS = [
    /rm\s+-rf\s+[/~]/,
    /git\s+push\s+.*--force/,
    /curl.*\|\s*(bash|sh|zsh)/,
    /:\(\)\s*\{.*:\|:&\};/,
    /dd\s+if=/,
    /mkfs/,
    />\s*\/dev\/(sda|nvme|disk)/,
    /shutdown|reboot|halt/,
    /chmod\s+777\s+\//,
    /npm\s+publish\s+/,
    /forever\s+loop/,
];

const REQUIRES_APPROVAL = [
    /pm2\s+(restart|stop|delete)/,
    /npm\s+(install|uninstall|update)/,
    /git\s+(reset|rebase|merge|checkout)/,
    /systemctl\s+(start|stop|restart|enable|disable)/,
    /kill\s+/,
    /pkill/,
    /node\s+.*\.js/,
];

function classifyCommand(cmd = "") {
    if (BLOCKED_PATTERNS.some(p => p.test(cmd))) return { safe: false, blocked: true, level: "BLOCKED" };
    if (REQUIRES_APPROVAL.some(p => p.test(cmd))) return { safe: false, blocked: false, level: "REQUIRES_APPROVAL", requiresApproval: true };
    return { safe: true, level: "SAFE" };
}

// ── Sequence management ───────────────────────────────────────────────────────

function planSequence(opts = {}) {
    const { name = "", commands = [], sessionId = null, recoveryCommands = [] } = opts;
    if (!commands.length) return { ok: false, error: "commands required" };
    if (commands.length > MAX_CHAIN_DEPTH) return { ok: false, error: `Max chain depth ${MAX_CHAIN_DEPTH} exceeded` };

    const classified = commands.map((cmd, i) => ({
        order:     i,
        cmd:       (cmd || "").slice(0, 500),
        ...classifyCommand(cmd),
        status:    "pending",
        result:    null,
        checkpoint: false,
    }));

    const blocked = classified.filter(c => c.blocked);
    if (blocked.length > 0) {
        return { ok: false, error: "Sequence contains blocked commands", blocked: blocked.map(c => c.cmd) };
    }

    const sequenceId = crypto.randomUUID();
    const db         = _load(); _prune(db);

    db.sequences.unshift({
        id:               sequenceId,
        name:             (name || "").slice(0, 100),
        sessionId,
        commands:         classified,
        recoveryCommands: (recoveryCommands || []).slice(0, 5).map(c => ({ cmd: (c||"").slice(0,200), ...classifyCommand(c) })),
        status:           "planned",
        currentStep:      0,
        createdAt:        Date.now(),
        completedAt:      null,
        interrupted:      false,
    });
    _save(db);

    return {
        ok:           true,
        sequenceId,
        commandCount: commands.length,
        requiresApprovalSteps: classified.filter(c => c.requiresApproval).length,
        commands:     classified,
    };
}

function recordCommandResult(sequenceId, order, { result = null, success = true, approved = false } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.sequences.findIndex(s => s.id === sequenceId);
    if (idx === -1) return { ok: false, error: "sequence not found" };

    const seq = db.sequences[idx];
    if (seq.interrupted) return { ok: false, error: "sequence interrupted" };

    const cmd = seq.commands[order];
    if (!cmd) return { ok: false, error: "command not found" };

    if (cmd.requiresApproval && !approved) {
        return { ok: false, requiresApproval: true, cmd: cmd.cmd, level: cmd.level };
    }

    cmd.status    = success ? "completed" : "failed";
    cmd.result    = (typeof result === "string" ? result : JSON.stringify(result) || "").slice(0, 500);
    cmd.checkpoint = true;

    seq.currentStep = Math.max(seq.currentStep, order + 1);
    seq.status      = seq.currentStep >= seq.commands.length ? "completed" : "executing";
    if (seq.status === "completed") seq.completedAt = Date.now();

    db.sequences[idx] = seq;
    _save(db);

    return { ok: true, sequenceId, order, status: cmd.status, nextCommand: seq.commands[seq.currentStep] || null };
}

function interruptSequence(sequenceId, { reason = "" } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.sequences.findIndex(s => s.id === sequenceId);
    if (idx === -1) return { ok: false, error: "sequence not found" };

    db.sequences[idx].interrupted     = true;
    db.sequences[idx].status          = "interrupted";
    db.sequences[idx].interruptReason = (reason || "").slice(0, 200);
    db.sequences[idx].interruptAt     = Date.now();
    _save(db);

    return { ok: true, sequenceId, interrupted: true };
}

// ── Restart coordination ──────────────────────────────────────────────────────

function recordRestart(processName, sessionId, { approved = false } = {}) {
    if (!approved) return { ok: false, error: "Process restart requires approval" };

    const db  = _load(); _prune(db);
    const key = `${processName}:${sessionId}`;

    db.restartLog = (db.restartLog || []).filter(r => Date.now() - r.ts < 60 * 60 * 1000); // 1h window
    const recentRestarts = db.restartLog.filter(r => r.key === key).length;

    if (recentRestarts >= MAX_RESTARTS_PER_SESSION) {
        return { ok: false, error: `Restart limit (${MAX_RESTARTS_PER_SESSION}) reached for ${processName} — operator intervention required`, count: recentRestarts };
    }

    db.restartLog.push({ key, processName, sessionId, ts: Date.now() });
    _save(db);

    return { ok: true, processName, restartCount: recentRestarts + 1, limit: MAX_RESTARTS_PER_SESSION };
}

// ── Validation checkpoint ─────────────────────────────────────────────────────

function validationCheckpoint(sequenceId) {
    const db  = _load(); _prune(db);
    const seq = db.sequences.find(s => s.id === sequenceId);
    if (!seq) return { ok: false, error: "sequence not found" };

    const ts = _tryRequire("./terminalSupervisor.cjs");
    let runaway = null;
    if (ts) try { runaway = ts.detectRunaway(); } catch {}

    const completedSteps = seq.commands.filter(c => c.checkpoint).length;
    const totalSteps     = seq.commands.length;

    return {
        ok:             true,
        sequenceId,
        progress:       `${completedSteps}/${totalSteps}`,
        status:         seq.status,
        runawayDetected: runaway?.runawayCount > 0 || runaway?.staleCount > 0,
        runaway,
    };
}

function listSequences({ status = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.sequences
        .filter(s => !status || s.status === status)
        .slice(0, limit)
        .map(s => ({ id: s.id, name: s.name, status: s.status, currentStep: s.currentStep, total: s.commands.length, createdAt: s.createdAt }));
}

module.exports = { classifyCommand, planSequence, recordCommandResult, interruptSequence, recordRestart, validationCheckpoint, listSequences };
