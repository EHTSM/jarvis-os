"use strict";
/**
 * Phase 694 — Browser Operation Coordination
 *
 * Authenticated continuity, extraction-flow coordination, replay-linked browser chains,
 * operational-form protection, workflow-aware browsing.
 * PREVENTS: duplicate replay, stale-session continuation, unsafe automation.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/browser-op-coord.json");
const MAX_OPS    = 100;
const TTL_MS     = 8  * 60 * 60 * 1000;
const SESSION_STALE = 30 * 60 * 1000;
const DEDUP_MS   = 5  * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { sessions: [], chains: [], dedup: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.sessions = (db.sessions || []).filter(s => s.ts > cutoff).slice(0, 30);
    db.chains   = (db.chains   || []).filter(c => c.ts > cutoff).slice(0, MAX_OPS);
    db.dedup    = (db.dedup    || []).filter(d => d.ts > Date.now() - DEDUP_MS);
}

// ── Authenticated continuity ──────────────────────────────────────────────────

function registerAuthSession(sessionId, opts = {}) {
    const { url = "", user = "", expiresAt = null } = opts;
    const db  = _load(); _prune(db);
    const idx = db.sessions.findIndex(s => s.sessionId === sessionId);
    const record = { sessionId, url: url.slice(0, 200), user, expiresAt, status: "active", ts: Date.now() };
    if (idx >= 0) { db.sessions[idx] = record; }
    else          { db.sessions.unshift(record); }
    _save(db);
    return { ok: true, sessionId, url, user };
}

function checkAuthContinuity(sessionId = "") {
    const db     = _load(); _prune(db);
    const record = db.sessions.find(s => s.sessionId === sessionId);
    if (!record) return { ok: false, error: "Session not found — re-authenticate required" };

    const stale   = (Date.now() - record.ts) > SESSION_STALE;
    const expired = record.expiresAt && Date.now() > record.expiresAt;

    if (expired) return { ok: false, expired: true, error: "Session expired — re-authenticate" };
    if (stale)   return { ok: false, stale:   true, warning: "Session stale (>30min) — validate before use", sessionId };

    return { ok: true, sessionId, url: record.url, user: record.user, fresh: true };
}

// ── Extraction-flow coordination ──────────────────────────────────────────────

function coordinateExtractionFlow(flowId, steps = [], { sessionId = null } = {}) {
    if (!flowId) return { ok: false, error: "flowId required" };

    const db = _load(); _prune(db);
    const isDup = db.dedup.some(d => d.key === `extract:${flowId}`);
    if (isDup) return { ok: false, duplicate: true, error: "Extraction flow already active in dedup window" };
    db.dedup.push({ key: `extract:${flowId}`, ts: Date.now() });

    // Validate session if provided
    let sessionOk = true;
    if (sessionId) {
        const cont = checkAuthContinuity(sessionId);
        sessionOk  = cont.ok;
        if (!sessionOk) { _save(db); return { ok: false, sessionBlocked: true, reason: cont.error || cont.warning }; }
    }

    const coordinated = steps.map((s, i) => ({
        index:            i,
        action:           s.action || s,
        url:              s.url || null,
        selector:         s.selector || null,
        requiresApproval: s.requiresAuth || false,
        checkpoint:       i > 0,
    }));

    db.chains.unshift({ flowId, sessionId, steps: coordinated, status: "active", ts: Date.now() });
    _save(db);

    return {
        ok:              true,
        flowId,
        sessionId,
        steps:           coordinated,
        requiresApproval: coordinated.some(s => s.requiresApproval),
        explainer:       `Extraction flow '${flowId}': ${coordinated.length} steps`,
    };
}

// ── Replay-linked browser chains ──────────────────────────────────────────────

function buildReplayLinkedBrowserChain(replayId = "", steps = []) {
    if (!replayId) return { ok: false, error: "replayId required" };

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    let isDup  = false;
    if (lhec) { try { isDup = lhec.isDuplicateRecovery(`browser-chain:${replayId}`); } catch {} }
    if (isDup) return { ok: false, duplicate: true, error: "Browser replay chain blocked in dedup window" };

    const chain = steps.map((s, i) => ({
        index:    i,
        step:     s.step || s,
        url:      s.url || null,
        isForm:   s.isForm || false,
        requiresApproval: s.isForm || s.risky || false,
        checkpoint: i > 0,
    }));

    return {
        ok:              true,
        replayId,
        chain,
        requiresApproval: chain.some(s => s.requiresApproval),
        explainer:       `Replay browser chain '${replayId}': ${chain.length} steps`,
    };
}

// ── Operational-form protection ───────────────────────────────────────────────

function protectOperationalForm(formId, opts = {}) {
    const { action = "", hasPayment = false, isDestructive = false, hasConfirmation = false, irreversible = false } = opts;

    const risks = [];
    if (hasPayment)      risks.push({ factor: "payment",     severity: "critical" });
    if (isDestructive)   risks.push({ factor: "destructive", severity: "critical" });
    if (irreversible)    risks.push({ factor: "irreversible", severity: "high" });
    if (!hasConfirmation) risks.push({ factor: "no-confirm", severity: "medium" });

    const critical = risks.filter(r => r.severity === "critical").length;
    const blocked  = critical > 0;

    return {
        ok:              !blocked,
        formId,
        action,
        risks,
        blocked,
        requiresApproval: risks.length > 0,
        explainer:       blocked
            ? `Form '${formId}' BLOCKED: ${risks.map(r => r.factor).join(", ")}`
            : risks.length > 0 ? `Form '${formId}' requires approval` : `Form '${formId}' safe`,
    };
}

// ── Workflow-aware browsing ───────────────────────────────────────────────────

function buildWorkflowAwareBrowsingPlan(workflowId = "", urls = [], { sessionId = null } = {}) {
    if (!workflowId) return { ok: false, error: "workflowId required" };

    const plan = urls.slice(0, 20).map((url, i) => ({
        index: i,
        url,
        action:      "navigate",
        checkpoint:  i > 0,
        validateAfter: true,
        requiresApproval: false,
    }));

    return {
        ok:         true,
        workflowId,
        sessionId,
        plan,
        urlCount:   plan.length,
        explainer:  `Browsing plan for workflow '${workflowId}': ${plan.length} URLs`,
    };
}

// ── Stale session detection ───────────────────────────────────────────────────

function detectStaleBrowserSessions() {
    const db    = _load(); _prune(db);
    const stale = db.sessions.filter(s => (Date.now() - s.ts) > SESSION_STALE);
    return {
        ok:         stale.length === 0,
        staleCount: stale.length,
        stale:      stale.map(s => ({ sessionId: s.sessionId, url: s.url, ageMs: Date.now() - s.ts })),
        detail:     stale.length > 0 ? `${stale.length} stale browser session(s)` : "All sessions current",
    };
}

module.exports = { registerAuthSession, checkAuthContinuity, coordinateExtractionFlow, buildReplayLinkedBrowserChain, protectOperationalForm, buildWorkflowAwareBrowsingPlan, detectStaleBrowserSessions };
