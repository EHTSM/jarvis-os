"use strict";
/**
 * Phase 635 — Autonomous Browser Operations
 *
 * Authenticated operational continuity, replay-safe extraction,
 * workflow-linked recovery, bounded browsing, interruption-safe execution.
 * Anti-duplicate. Operator visibility. Replay continuity.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH   = path.join(__dirname, "../../data/autonomous-browser-ops.json");
const MAX_OPS      = 50;
const OPS_TTL      = 8 * 60 * 60 * 1000;
const DEDUP_WINDOW = 5 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { ops: [], authRegistry: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - OPS_TTL;
    db.ops = (db.ops || []).filter(o => o.createdAt > cutoff).slice(0, MAX_OPS);
}

// ── Auth continuity ───────────────────────────────────────────────────────────

function registerAuth(domain, token, { ttlMs = 30 * 60 * 1000, sessionId = null } = {}) {
    const db = _load(); _prune(db);
    db.authRegistry = (db.authRegistry || []).filter(a => a.domain !== domain && Date.now() < a.expiresAt);
    db.authRegistry.push({ domain, token: token.slice(0, 32) + "…", expiresAt: Date.now() + ttlMs, sessionId, registeredAt: Date.now() });
    _save(db);
    return { ok: true, domain, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
}

function getAuth(domain) {
    const db = _load();
    const a  = (db.authRegistry || []).find(x => x.domain === domain && Date.now() < x.expiresAt);
    return a || null;
}

// ── Dedup guard ───────────────────────────────────────────────────────────────

function _isDup(url, opType) {
    // Check recent ops
    const db = _load();
    const recent = (db.ops || []).filter(o => o.url === url && o.opType === opType && Date.now() - o.createdAt < DEDUP_WINDOW);
    return recent.length > 0;
}

// ── Operation types ───────────────────────────────────────────────────────────

const OP_CATALOG = {
    "extract":       { steps: ["navigate", "screenshot", "extract", "validate"], replaySafe: true,  submitBlocked: false },
    "auth-probe":    { steps: ["navigate", "check-auth", "screenshot"],          replaySafe: true,  submitBlocked: false },
    "health-probe":  { steps: ["navigate", "check-status", "screenshot"],        replaySafe: true,  submitBlocked: false },
    "form-review":   { steps: ["navigate", "screenshot", "inspect-fields"],      replaySafe: true,  submitBlocked: true  },
    "recovery-probe":{ steps: ["navigate", "screenshot", "check-recovery"],      replaySafe: true,  submitBlocked: false },
};

function startOperation(opts = {}) {
    const { opType = "health-probe", url = "", sessionId = null, replayId = null, authDomain = null } = opts;

    if (!url) return { ok: false, error: "url required" };
    if (_isDup(url, opType)) return { ok: false, duplicate: true, error: "Duplicate operation in last 5 minutes" };

    const catalog = OP_CATALOG[opType];
    if (!catalog) return { ok: false, error: `Unknown opType. Available: ${Object.keys(OP_CATALOG).join(", ")}` };

    const auth = authDomain ? getAuth(authDomain) : null;

    const opId = crypto.randomUUID();
    const db   = _load(); _prune(db);

    db.ops.unshift({
        id:           opId,
        opType,
        url:          (url || "").slice(0, 500),
        sessionId,
        replayId,
        authDomain,
        authValid:    !!auth,
        steps:        catalog.steps.map((s, i) => ({
            order:      i,
            action:     s,
            status:     "pending",
            blocked:    s === "submit",
            result:     null,
        })),
        currentStep:  0,
        status:       "active",
        interrupted:  false,
        replaySafe:   catalog.replaySafe,
        submitBlocked: catalog.submitBlocked,
        createdAt:    Date.now(),
        completedAt:  null,
    });
    _save(db);

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.record("session", { opId, opType, url: url.slice(0, 100), event: "browser-op-started" });

    return { ok: true, opId, opType, stepCount: catalog.steps.length, authValid: !!auth, replaySafe: catalog.replaySafe };
}

function advanceStep(opId, { stepResult = null } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.ops.findIndex(o => o.id === opId);
    if (idx === -1) return { ok: false, error: "operation not found" };

    const op   = db.ops[idx];
    if (op.interrupted) return { ok: false, error: "operation interrupted" };

    const step = op.steps[op.currentStep];
    if (!step) return { ok: false, allComplete: true };
    if (step.blocked) return { ok: false, blocked: true, reason: "Step permanently blocked — operator must act manually" };

    step.status    = "completed";
    step.result    = stepResult || { ts: Date.now() };
    op.currentStep++;

    if (op.currentStep >= op.steps.length) {
        op.status      = "completed";
        op.completedAt = Date.now();
    }

    db.ops[idx] = op;
    _save(db);

    return { ok: true, opId, completedStep: step.action, nextStep: op.steps[op.currentStep] || null, allComplete: op.status === "completed" };
}

function interruptOperation(opId, { reason = "" } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.ops.findIndex(o => o.id === opId);
    if (idx === -1) return { ok: false };

    db.ops[idx].interrupted   = true;
    db.ops[idx].status        = "interrupted";
    db.ops[idx].interruptAt   = Date.now();
    db.ops[idx].interruptReason = (reason || "").slice(0, 200);
    _save(db);

    const bwm = _tryRequire("./browserWorkflowMaturity.cjs");
    if (bwm) bwm.recordInterrupt(opId, db.ops[idx].currentStep, reason);

    return { ok: true, opId, interrupted: true };
}

function recoverOperation(opId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, error: "operator approval required to recover browser operation" };

    const db  = _load(); _prune(db);
    const idx = db.ops.findIndex(o => o.id === opId);
    if (idx === -1) return { ok: false, error: "operation not found" };

    const op = db.ops[idx];
    db.ops[idx].interrupted = false;
    db.ops[idx].status      = "active";
    _save(db);

    const bwm = _tryRequire("./browserWorkflowMaturity.cjs");
    if (bwm) bwm.recordRecovery(opId, true, "operator-recovery");

    return { ok: true, opId, currentStep: op.currentStep, nextStep: op.steps[op.currentStep] || null };
}

// ── Replay-safe extraction ────────────────────────────────────────────────────

function replaySafeExtract(url, { replayId = null, schema = {} } = {}) {
    if (_isDup(url, "extract")) return { ok: false, duplicate: true };

    const bwm = _tryRequire("./browserWorkflowMaturity.cjs");
    const plan = {
        url:       (url || "").slice(0, 500),
        replayId,
        steps:     ["navigate", "screenshot", "extract", "validate"],
        replaySafe: true,
        schema,
        ts:        Date.now(),
    };

    // Validate schema if provided
    if (schema && schema.requiredFields && bwm) {
        const validation = bwm.validateExtraction(null, schema);
        plan.schemaValid = validation.ok;
    }

    return { ok: true, plan };
}

function listOperations({ status = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.ops
        .filter(o => !status || o.status === status)
        .slice(0, limit)
        .map(o => ({ id: o.id, opType: o.opType, status: o.status, currentStep: o.currentStep, total: o.steps.length, authValid: o.authValid, createdAt: o.createdAt }));
}

module.exports = { registerAuth, getAuth, startOperation, advanceStep, interruptOperation, recoverOperation, replaySafeExtract, listOperations, OP_CATALOG };
