"use strict";
/**
 * Phase 650 — Browser Execution Intelligence
 *
 * Extraction validation, stale-session detection, workflow-state awareness,
 * form safety, replay-linked browser reasoning.
 * PREVENTS: duplicate execution, stale continuation, unsafe automation.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH   = path.join(__dirname, "../../data/browser-exec-intel.json");
const MAX_SESSIONS = 100;
const SESSION_TTL  = 8 * 60 * 60 * 1000;
const STALE_MS     = 30 * 60 * 1000;
const DEDUP_MS     = 5 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { sessions: [], extractions: [], dedup: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - SESSION_TTL;
    db.sessions    = (db.sessions    || []).filter(s => s.updatedAt > cutoff).slice(0, MAX_SESSIONS);
    db.extractions = (db.extractions || []).slice(-200);
    db.dedup       = (db.dedup       || []).filter(d => Date.now() - d.ts < DEDUP_MS);
}
function _fp(url, opType) { return crypto.createHash("md5").update(`${url}:${opType}`).digest("hex").slice(0, 10); }

// ── Dedup guard ───────────────────────────────────────────────────────────────

function isDuplicateOperation(url, opType) {
    const db  = _load();
    const fp  = _fp(url, opType);
    const hit = (db.dedup || []).find(d => d.fp === fp);
    if (hit && Date.now() - hit.ts < DEDUP_MS) return true;
    db.dedup = [...(db.dedup || []).filter(d => d.fp !== fp), { fp, ts: Date.now() }];
    _save(db);
    return false;
}

// ── Extraction schema validation ──────────────────────────────────────────────

function validateExtraction(data = {}, schema = {}) {
    if (!schema || Object.keys(schema).length === 0) return { ok: true, valid: true, warnings: [] };

    const warnings = [];
    const errors   = [];

    for (const [field, def] of Object.entries(schema)) {
        const value = data[field];
        if (def.required && (value === undefined || value === null || value === "")) {
            errors.push(`Missing required field: ${field}`);
            continue;
        }
        if (value === undefined) continue;
        if (def.type && typeof value !== def.type) warnings.push(`Field ${field}: expected ${def.type}, got ${typeof value}`);
        if (def.maxLength && typeof value === "string" && value.length > def.maxLength) warnings.push(`Field ${field}: too long (${value.length} > ${def.maxLength})`);
        if (def.pattern && typeof value === "string" && !new RegExp(def.pattern).test(value)) errors.push(`Field ${field}: pattern mismatch`);
    }

    const valid = errors.length === 0;
    return { ok: true, valid, errors, warnings, fieldCount: Object.keys(data).length, schemaFields: Object.keys(schema).length };
}

// ── Stale session detection ───────────────────────────────────────────────────

function detectStaleSessions() {
    const db = _load(); _prune(db);
    const now = Date.now();

    const stale = db.sessions.filter(s => {
        const age = now - s.updatedAt;
        return age > STALE_MS && s.status === "running";
    });

    return {
        ok:         true,
        staleCount: stale.length,
        stale:      stale.map(s => ({ sessionId: s.sessionId, url: s.url, ageMs: now - s.updatedAt, opType: s.opType })),
    };
}

// ── Session awareness ─────────────────────────────────────────────────────────

function registerSession(opts = {}) {
    const { sessionId, url = "", opType = "", authDomain = null } = opts;
    if (!sessionId) return { ok: false, error: "sessionId required" };

    if (isDuplicateOperation(url, opType)) return { ok: false, duplicate: true, error: "Duplicate operation blocked (5-min dedup window)" };

    const db = _load(); _prune(db);
    const idx = db.sessions.findIndex(s => s.sessionId === sessionId);

    const record = { sessionId, url: url.slice(0, 200), opType, authDomain, status: "running", stepCount: 0, updatedAt: Date.now(), startedAt: Date.now() };
    if (idx >= 0) { db.sessions[idx] = { ...db.sessions[idx], ...record, startedAt: db.sessions[idx].startedAt }; }
    else          { db.sessions.unshift(record); }
    _save(db);
    return { ok: true, sessionId };
}

function updateSession(sessionId, { status = null, stepCount = null } = {}) {
    const db  = _load();
    const idx = db.sessions.findIndex(s => s.sessionId === sessionId);
    if (idx === -1) return { ok: false, error: "session not found" };
    if (status)                     db.sessions[idx].status    = status;
    if (stepCount !== null)         db.sessions[idx].stepCount = stepCount;
    db.sessions[idx].updatedAt = Date.now();
    _save(db);
    return { ok: true, sessionId };
}

// ── Form safety gate ──────────────────────────────────────────────────────────

function checkFormSafety(formContext = {}) {
    const { hasSubmitAction = false, operatorApproved = false, url = "", fieldCount = 0 } = formContext;

    if (hasSubmitAction && !operatorApproved) {
        return {
            ok:       false,
            safe:     false,
            blocked:  true,
            reason:   "Form submission requires explicit operator approval",
            action:   "obtain-operator-approval",
        };
    }

    const warnings = [];
    if (fieldCount > 10) warnings.push("Large form — review fields before submitting");
    if (url.includes("payment") || url.includes("checkout")) warnings.push("Payment/checkout URL detected — verify carefully");

    return { ok: true, safe: true, blocked: false, warnings };
}

// ── Replay-linked browser reasoning ──────────────────────────────────────────

function replayBrowserContext(replayId, extractionKey = "") {
    const db = _load();
    const prevExtractions = db.extractions
        .filter(e => e.replayId === replayId && e.key === extractionKey)
        .sort((a, b) => b.ts - a.ts);

    if (prevExtractions.length === 0) return { ok: true, hasContext: false, replayId };

    const latest = prevExtractions[0];
    const stale  = Date.now() - latest.ts > 6 * 60 * 60 * 1000;

    return {
        ok:         true,
        hasContext: true,
        replayId,
        stale,
        latestExtraction: latest.summary,
        updatedAt:  latest.ts,
        warning:    stale ? "Replay context is stale (>6h) — re-extract recommended" : null,
    };
}

function recordExtraction(opts = {}) {
    const { sessionId = null, replayId = null, key = "", summary = {}, validated = false } = opts;
    const db = _load();
    db.extractions.push({ sessionId, replayId, key: (key || "").slice(0, 100), summary, validated, ts: Date.now() });
    db.extractions = db.extractions.slice(-200);
    _save(db);
    return { ok: true };
}

// ── Workflow state awareness ──────────────────────────────────────────────────

function workflowStateReport() {
    const db     = _load(); _prune(db);
    const active = db.sessions.filter(s => s.status === "running");
    const stale  = detectStaleSessions();

    return {
        ok:           true,
        activeSessions: active.length,
        staleSessions:  stale.staleCount,
        staleDetail:    stale.stale,
        dedupActive:    (db.dedup || []).length,
        warning:        stale.staleCount > 0 ? `${stale.staleCount} stale session(s) detected` : null,
    };
}

module.exports = { isDuplicateOperation, validateExtraction, detectStaleSessions, registerSession, updateSession, checkFormSafety, replayBrowserContext, recordExtraction, workflowStateReport };
