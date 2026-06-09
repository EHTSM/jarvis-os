"use strict";
/**
 * Phase 604 — Browser Workflow Maturity
 *
 * Matures browser automation: session continuity, auth-aware recovery,
 * structured extraction validation, workflow health scoring, operator visibility.
 *
 * Builds on browserWorkflowEngine (589) — does not replace it.
 * No browser API dependency. Models state from workflow engine + auth sessions.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Workflow health scoring ───────────────────────────────────────────────────

const HEALTH_WEIGHTS = {
    authContinuity:    0.25,
    stepCompletionRate:0.30,
    interruptRecovery: 0.20,
    extractionSuccess: 0.25,
};

function scoreWorkflowHealth(stats = {}) {
    const { authRate = 1, stepRate = 1, recoveryRate = 1, extractionRate = 1 } = stats;
    const score = Math.round(
        (authRate       * HEALTH_WEIGHTS.authContinuity    +
         stepRate       * HEALTH_WEIGHTS.stepCompletionRate +
         recoveryRate   * HEALTH_WEIGHTS.interruptRecovery  +
         extractionRate * HEALTH_WEIGHTS.extractionSuccess) * 100
    );
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
    return { score, grade, weights: HEALTH_WEIGHTS };
}

// ── Auth session continuity ───────────────────────────────────────────────────

const _authContinuity = new Map(); // domain -> { token, expiresAt, refreshCount }

function registerAuthSession(domain, token, ttlMs = 30 * 60 * 1000) {
    if (!domain || !token) return { ok: false, error: "domain and token required" };
    _authContinuity.set(domain, {
        domain,
        token:        token.slice(0, 32) + "…",
        expiresAt:    Date.now() + ttlMs,
        refreshCount: (_authContinuity.get(domain)?.refreshCount || 0) + 1,
        registeredAt: Date.now(),
    });
    return { ok: true, domain, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
}

function getAuthSession(domain) {
    const s = _authContinuity.get(domain);
    if (!s) return null;
    if (Date.now() > s.expiresAt) { _authContinuity.delete(domain); return null; }
    return s;
}

function listAuthSessions() {
    const now = Date.now();
    const sessions = [];
    for (const [domain, s] of _authContinuity) {
        if (now > s.expiresAt) { _authContinuity.delete(domain); continue; }
        sessions.push({ domain, expiresIn: Math.round((s.expiresAt - now) / 1000) + "s", refreshCount: s.refreshCount });
    }
    return sessions;
}

// ── Extraction validation ─────────────────────────────────────────────────────

/**
 * Validate an extraction result against a schema.
 * schema: { requiredFields: string[], minRows: number }
 */
function validateExtraction(data, schema = {}) {
    const { requiredFields = [], minRows = 1 } = schema;
    const errors = [];

    if (!data) { return { ok: false, errors: ["no data returned"] }; }

    // Array check
    const rows = Array.isArray(data) ? data : [data];
    if (rows.length < minRows) errors.push(`Expected ≥${minRows} rows, got ${rows.length}`);

    // Field presence
    if (requiredFields.length > 0) {
        const sample = rows[0] || {};
        requiredFields.forEach(f => {
            if (!(f in sample)) errors.push(`Missing field: ${f}`);
        });
    }

    return { ok: errors.length === 0, rowCount: rows.length, errors };
}

// ── Interrupt recovery audit ──────────────────────────────────────────────────

const STATE_PATH = path.join(__dirname, "../../data/browser-workflow-maturity.json");

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { interruptLog: [], recoveryLog: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}

function recordInterrupt(workflowId, stepIndex, reason = "") {
    const db = _load();
    db.interruptLog = [...(db.interruptLog || []), {
        workflowId,
        stepIndex,
        reason: (reason || "").slice(0, 200),
        ts: Date.now(),
    }].slice(-100);
    _save(db);
    return { ok: true, workflowId, stepIndex };
}

function recordRecovery(workflowId, success = true, strategy = "") {
    const db = _load();
    db.recoveryLog = [...(db.recoveryLog || []), {
        workflowId,
        success,
        strategy: (strategy || "").slice(0, 100),
        ts: Date.now(),
    }].slice(-100);
    _save(db);
    return { ok: true, workflowId, success };
}

// ── Workflow maturity report ──────────────────────────────────────────────────

function maturityReport() {
    const bwe  = _tryRequire("./browserWorkflowEngine.cjs");
    const db   = _load();

    const interrupts  = db.interruptLog || [];
    const recoveries  = db.recoveryLog  || [];
    const authSessions = listAuthSessions();

    const successfulRecoveries = recoveries.filter(r => r.success).length;
    const recoveryRate = recoveries.length > 0 ? successfulRecoveries / recoveries.length : 1;
    const authRate     = authSessions.length > 0 ? 1 : 0.8; // presence of active sessions = good signal

    // Pull from browser workflow engine if available
    let workflowStats = null;
    if (bwe) {
        try { workflowStats = bwe.workflowStats ? bwe.workflowStats() : null; } catch {}
    }

    const health = scoreWorkflowHealth({
        authRate,
        stepRate:       workflowStats?.completionRate || 0.85,
        recoveryRate,
        extractionRate: workflowStats?.extractionRate || 0.85,
    });

    return {
        ok: true,
        health,
        authSessions:   authSessions.length,
        interruptCount: interrupts.length,
        recoveryRate:   Math.round(recoveryRate * 100) + "%",
        workflowStats,
        summary: `Browser workflow maturity: ${health.grade} (${health.score}/100)`,
    };
}

// ── Workflow operator visibility ──────────────────────────────────────────────

/**
 * Returns a human-readable status for active browser workflows.
 */
function operatorView() {
    const bwe = _tryRequire("./browserWorkflowEngine.cjs");
    if (!bwe) return { ok: false, error: "browserWorkflowEngine unavailable" };

    let active = [];
    try { active = bwe.listActiveWorkflows ? bwe.listActiveWorkflows() : []; } catch {}

    return {
        ok: true,
        activeWorkflows: active.length,
        authSessions:    listAuthSessions(),
        workflows:       active.map(w => ({
            id:      w.id,
            name:    w.workflowName,
            step:    w.currentStep,
            total:   w.totalSteps,
            status:  w.status,
        })),
    };
}

module.exports = {
    scoreWorkflowHealth,
    registerAuthSession,
    getAuthSession,
    listAuthSessions,
    validateExtraction,
    recordInterrupt,
    recordRecovery,
    maturityReport,
    operatorView,
};
