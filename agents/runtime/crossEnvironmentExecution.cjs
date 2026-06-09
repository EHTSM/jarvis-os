"use strict";
/**
 * Phase 691 — Cross-Environment Execution Coordination
 *
 * Coordinates execution across VS Code, terminal, browser, deployment runtime, local services.
 * Shared execution context, replay-safe coordination, interruption-safe execution,
 * environment-aware recovery. Bounded depth. Operator visibility.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/cross-env-exec.json");
const MAX_CTX    = 50;
const TTL_MS     = 24 * 60 * 60 * 1000;
const MAX_DEPTH  = 5;
const DEDUP_MS   = 5 * 60 * 1000;

const ENVIRONMENTS = ["vscode", "terminal", "browser", "deployment", "local-service"];

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { contexts: [], dedup: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.contexts = (db.contexts || []).filter(c => c.ts > cutoff).slice(0, MAX_CTX);
    db.dedup    = (db.dedup    || []).filter(d => d.ts > Date.now() - DEDUP_MS);
}

// ── Shared execution context ──────────────────────────────────────────────────

function saveExecutionContext(ctxId, opts = {}) {
    if (!ctxId) return { ok: false, error: "ctxId required" };
    const { env = "vscode", goal = "", depth = 0, replayId = null, linkedEnvs = [], state = null } = opts;

    if (!ENVIRONMENTS.includes(env)) return { ok: false, error: `Unknown env: ${env}. Valid: ${ENVIRONMENTS.join(", ")}` };
    if (depth > MAX_DEPTH) return { ok: false, error: `Max depth (${MAX_DEPTH}) exceeded` };

    const db  = _load(); _prune(db);
    const idx = db.contexts.findIndex(c => c.ctxId === ctxId);

    const record = {
        ctxId,
        env,
        goal:       goal.slice(0, 200),
        depth,
        replayId,
        linkedEnvs: (linkedEnvs || []).filter(e => ENVIRONMENTS.includes(e)).slice(0, 4),
        state,
        createdAt:  idx >= 0 ? db.contexts[idx].createdAt : Date.now(),
        ts:         Date.now(),
    };

    if (idx >= 0) { db.contexts[idx] = record; }
    else          { db.contexts.unshift(record); }
    _save(db);
    return { ok: true, ctxId, env, linkedEnvs: record.linkedEnvs };
}

function restoreExecutionContext(ctxId) {
    const db     = _load(); _prune(db);
    const record = db.contexts.find(c => c.ctxId === ctxId);
    if (!record) return { ok: false, error: "Context not found" };

    const ageMs = Date.now() - record.ts;
    const stale = ageMs > 8 * 60 * 60 * 1000;
    return { ok: true, ctxId, record, ageMs, stale, warning: stale ? "Context stale (>8h)" : null };
}

function listContextsByEnv(env = null) {
    const db = _load(); _prune(db);
    return db.contexts
        .filter(c => !env || c.env === env)
        .map(c => ({ ctxId: c.ctxId, env: c.env, goal: c.goal, ageMs: Date.now() - c.ts }));
}

// ── Replay-safe coordination ──────────────────────────────────────────────────

function coordinateReplaySafe(coordinationId, { envs = [], goal = "", operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };
    if (!coordinationId) return { ok: false, error: "coordinationId required" };

    const db = _load(); _prune(db);
    const isDup = db.dedup.some(d => d.key === `coord:${coordinationId}`);
    if (isDup) return { ok: false, duplicate: true, error: "Coordination already active in dedup window" };

    db.dedup.push({ key: `coord:${coordinationId}`, ts: Date.now() });
    _save(db);

    const validEnvs = (envs || []).filter(e => ENVIRONMENTS.includes(e));
    return {
        ok:           true,
        coordinationId,
        envs:         validEnvs,
        goal,
        plan: validEnvs.map((e, i) => ({ order: i + 1, env: e, step: `coordinate-${e}`, requiresApproval: e === "deployment" })),
        approvalRequired: validEnvs.includes("deployment"),
    };
}

// ── Interruption-safe execution record ───────────────────────────────────────

function recordInterruption(ctxId, { env = "", step = null, reason = "" } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.contexts.findIndex(c => c.ctxId === ctxId);
    if (idx === -1) return { ok: false, error: "Context not found" };

    db.contexts[idx].interrupted = { step, reason: reason.slice(0, 100), env, ts: Date.now() };
    db.contexts[idx].ts = Date.now();
    _save(db);
    return { ok: true, ctxId, resumeFrom: step };
}

// ── Environment-aware recovery ────────────────────────────────────────────────

function recoverEnvironment(env = "", errorContext = "") {
    if (!ENVIRONMENTS.includes(env)) return { ok: false, error: `Unknown env: ${env}` };

    const recovery = {
        vscode:          { steps: ["validate-file-state", "reload-workspace", "restore-context"],   autonomous: true  },
        terminal:        { steps: ["check-process-state", "validate-deps", "restart-shell"],         autonomous: true  },
        browser:         { steps: ["check-session", "clear-stale-state", "re-authenticate"],        autonomous: false, requiresApproval: true },
        deployment:      { steps: ["check-deployment-state", "validate-rollback", "notify-operator"], autonomous: false, requiresApproval: true },
        "local-service": { steps: ["health-check", "restart-service", "validate-endpoints"],        autonomous: true  },
    };

    const plan = recovery[env];
    const arc  = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    let recoveryPath = null;
    if (arc && errorContext) { try { recoveryPath = arc.chooseRecoveryPath(errorContext); } catch {} }

    return {
        ok:              true,
        env,
        plan:            plan.steps,
        autonomous:      plan.autonomous,
        recoveryPath:    recoveryPath?.chosen || null,
        approvalRequired: !plan.autonomous,
        explainer:       `Recovery for '${env}': ${plan.steps.length} steps — autonomous=${plan.autonomous}`,
    };
}

// ── Cross-environment summary ─────────────────────────────────────────────────

function crossEnvSummary() {
    const db = _load(); _prune(db);
    const byEnv = {};
    ENVIRONMENTS.forEach(e => { byEnv[e] = 0; });
    db.contexts.forEach(c => { if (byEnv[c.env] !== undefined) byEnv[c.env]++; });

    return {
        ok:        true,
        totalCtx:  db.contexts.length,
        byEnv,
        environments: ENVIRONMENTS,
        interrupted: db.contexts.filter(c => c.interrupted).length,
        summary:   `Cross-env: ${db.contexts.length} contexts across ${ENVIRONMENTS.length} environments`,
    };
}

module.exports = { saveExecutionContext, restoreExecutionContext, listContextsByEnv, coordinateReplaySafe, recordInterruption, recoverEnvironment, crossEnvSummary, ENVIRONMENTS };
