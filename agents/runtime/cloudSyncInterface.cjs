"use strict";
/**
 * Phase 468 — Cloud Sync Interface Layer
 *
 * Clean abstraction layer for future SaaS sync. Does NOT implement
 * a cloud backend — provides the serialization and queueing contracts
 * so a cloud adapter can be dropped in later without touching core modules.
 *
 * Sync candidates: workflows, templates, replay sessions, operational
 * summaries, deployment presets.
 *
 * Local-first: all data lives locally. Sync queue is append-only.
 * Conflict policy: last-write-wins by timestamp.
 * Offline survival: queue is persisted, drained when sync is available.
 *
 * Storage: data/sync-queue.json (max 500 entries, 7-day TTL)
 */

const fs   = require("fs");
const path = require("path");

const QUEUE_PATH = path.join(__dirname, "../../data/sync-queue.json");
const MAX_QUEUE  = 500;
const TTL_MS     = 7 * 24 * 60 * 60 * 1000;

// Sync-able entity types
const ENTITY_TYPES = ["workflow-template", "replay-session", "op-summary", "deploy-preset", "recovery-path"];

function _load() {
    try { return JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8")); }
    catch { return { pending: [], synced: [], lastSyncAt: null, syncEnabled: false }; }
}

function _save(state) {
    try {
        const dir = path.dirname(QUEUE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(QUEUE_PATH, JSON.stringify(state, null, 2));
    } catch {}
}

function _prune(state) {
    const cutoff = Date.now() - TTL_MS;
    state.pending = state.pending.filter(e => e.ts > cutoff).slice(-MAX_QUEUE);
    state.synced  = state.synced.filter(e => e.ts > cutoff).slice(-100); // keep last 100 synced
    return state;
}

// ── Sync queue ────────────────────────────────────────────────────────────────

/**
 * Enqueue an entity for future sync.
 * @param {string} type     — one of ENTITY_TYPES
 * @param {string} entityId — unique ID of the entity
 * @param {object} payload  — serializable data (will be trimmed if large)
 * @param {object} [opts]   — { operatorId, conflictKey }
 */
function enqueue(type, entityId, payload, opts = {}) {
    if (!ENTITY_TYPES.includes(type)) throw new Error(`unknown entity type: ${type}`);
    const state = _prune(_load());
    // Deduplicate: replace existing pending entry for same entityId
    state.pending = state.pending.filter(e => e.entityId !== entityId);
    state.pending.push({
        id:         `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        type,
        entityId:   String(entityId).slice(0, 100),
        payload:    _trimPayload(payload),
        operatorId: (opts.operatorId || null),
        conflictKey: (opts.conflictKey || entityId),
        ts:         Date.now(),
    });
    _save(state);
}

function _trimPayload(payload) {
    if (!payload) return null;
    const json = JSON.stringify(payload);
    if (json.length <= 8192) return payload;
    // Too large — store a summary reference only
    return { _truncated: true, keys: Object.keys(payload), sizeBytes: json.length };
}

/**
 * Mark entries as synced (called by a future cloud adapter).
 * @param {string[]} ids — sync entry IDs that were successfully uploaded
 */
function markSynced(ids) {
    const state = _prune(_load());
    const idSet = new Set(ids);
    const justSynced = state.pending.filter(e => idSet.has(e.id));
    state.pending = state.pending.filter(e => !idSet.has(e.id));
    state.synced.push(...justSynced.map(e => ({ ...e, syncedAt: Date.now() })));
    state.lastSyncAt = Date.now();
    state.synced = state.synced.slice(-100);
    _save(state);
    return justSynced.length;
}

/** Get pending entries (for a sync adapter to upload). */
function getPending({ limit = 50 } = {}) {
    const state = _prune(_load());
    return state.pending.slice(0, Math.min(limit, MAX_QUEUE));
}

/** Enable or disable sync (operator-controlled). */
function setSyncEnabled(enabled) {
    const state = _load();
    state.syncEnabled = !!enabled;
    _save(state);
}

// ── Serialization contracts (used by future cloud adapter) ────────────────────

/**
 * Serialize a workflow template for sync.
 * @param {object} template — from operationalTemplates
 * @returns {object} sync-safe payload
 */
function serializeTemplate(template) {
    return {
        name:       template.name,
        goal:       template.goal,
        steps:      (template.steps || []).slice(0, 20).map(s => ({
            cmd:           s.cmd?.slice(0, 200),
            label:         s.label?.slice(0, 80),
            approvalLevel: s.approvalLevel || "SAFE",
            failBehavior:  s.failBehavior  || "continue",
        })),
        maxRetries: template.maxRetries || 0,
        source:     template.source || "custom",
        savedAt:    template.savedAt || Date.now(),
    };
}

/**
 * Serialize a session summary for sync.
 * @param {object} session — from engineeringSession.summary()
 * @returns {object} sync-safe payload
 */
function serializeSession(s) {
    return {
        id:                  s.id,
        goal:                s.goal?.slice(0, 300),
        state:               s.state,
        createdAt:           s.createdAt,
        updatedAt:           s.updatedAt,
        executionConfidence: s.executionConfidence,
        degradationState:    s.degradationState,
        workflowCount:       s.workflowCount,
        successfulWorkflows: s.successfulWorkflows,
        failedRecoveries:    s.failedRecoveries,
    };
}

/** Diagnostics. */
function status() {
    const state = _prune(_load());
    return {
        syncEnabled:  state.syncEnabled,
        pendingCount: state.pending.length,
        syncedCount:  state.synced.length,
        lastSyncAt:   state.lastSyncAt,
        entityTypes:  ENTITY_TYPES,
    };
}

module.exports = { enqueue, markSynced, getPending, setSyncEnabled, serializeTemplate, serializeSession, status, ENTITY_TYPES };
