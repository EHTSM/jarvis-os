"use strict";
/**
 * observabilitySnapshotEngine — creates immutable point-in-time snapshots of
 * runtime observability state. Supports diff generation and bounded retention.
 *
 * captureSnapshot(spec)          → { captured, snapshotId }
 * getSnapshot(snapshotId)        → Snapshot | null
 * getLatestSnapshot(tag?)        → Snapshot | null
 * diffSnapshots(idA, idB)        → SnapshotDiff | null
 * listSnapshots(filter?)         → SnapshotRef[]
 * pruneSnapshots(maxAge?)        → { pruned, remaining }
 * getSnapshotMetrics()           → SnapshotMetrics
 * reset()
 *
 * Every snapshot payload is Object.freeze()'d — zero mutation after capture.
 * MAX_SNAPSHOTS = 500; oldest pruned automatically when capacity exceeded.
 */

const MAX_SNAPSHOTS     = 500;
const DEFAULT_MAX_AGE   = 3600000;   // 1 hour in ms

let _snapshots = new Map();   // snapshotId → Snapshot
let _counter   = 0;
let _order     = [];          // ordered snapshotIds for FIFO pruning

// ── _deepFreeze ────────────────────────────────────────────────────────

function _deepFreeze(obj) {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) {
        obj.forEach(item => _deepFreeze(item));
    } else {
        Object.keys(obj).forEach(k => _deepFreeze(obj[k]));
    }
    return Object.freeze(obj);
}

// ── captureSnapshot ────────────────────────────────────────────────────

function captureSnapshot(spec = {}) {
    const {
        tag         = null,
        source      = null,
        payload     = null,
        correlationId = null,
        timestamp   = new Date().toISOString(),
    } = spec;

    if (!source)  return { captured: false, reason: "source_required" };
    if (payload === null || payload === undefined)
        return { captured: false, reason: "payload_required" };

    // Prune if at capacity
    while (_order.length >= MAX_SNAPSHOTS) {
        const oldest = _order.shift();
        _snapshots.delete(oldest);
    }

    const snapshotId = `snap-${++_counter}`;
    const snapshot   = _deepFreeze({
        snapshotId, tag: tag ?? null, source,
        correlationId: correlationId ?? null,
        timestamp,
        payload: { ...payload },
    });

    _snapshots.set(snapshotId, snapshot);
    _order.push(snapshotId);

    return { captured: true, snapshotId, source, tag, timestamp };
}

// ── getSnapshot ────────────────────────────────────────────────────────

function getSnapshot(snapshotId) {
    if (!snapshotId) return null;
    return _snapshots.get(snapshotId) ?? null;
}

// ── getLatestSnapshot ──────────────────────────────────────────────────

function getLatestSnapshot(tag = null) {
    const candidates = [..._snapshots.values()];
    if (tag) {
        const tagged = candidates.filter(s => s.tag === tag);
        return tagged[tagged.length - 1] ?? null;
    }
    return candidates[candidates.length - 1] ?? null;
}

// ── diffSnapshots ──────────────────────────────────────────────────────

function diffSnapshots(idA, idB) {
    const a = _snapshots.get(idA);
    const b = _snapshots.get(idB);
    if (!a || !b) return null;

    const keysA = Object.keys(a.payload);
    const keysB = Object.keys(b.payload);
    const allKeys = new Set([...keysA, ...keysB]);

    const changed = {};
    const added   = {};
    const removed = {};

    for (const k of allKeys) {
        const inA = k in a.payload;
        const inB = k in b.payload;
        if (inA && !inB) { removed[k] = a.payload[k]; continue; }
        if (!inA && inB) { added[k]   = b.payload[k]; continue; }
        const va = JSON.stringify(a.payload[k]);
        const vb = JSON.stringify(b.payload[k]);
        if (va !== vb) changed[k] = { from: a.payload[k], to: b.payload[k] };
    }

    return {
        snapshotA: idA, snapshotB: idB,
        timestampA: a.timestamp, timestampB: b.timestamp,
        changed, added, removed,
        hasChanges: Object.keys(changed).length + Object.keys(added).length + Object.keys(removed).length > 0,
    };
}

// ── listSnapshots ──────────────────────────────────────────────────────

function listSnapshots(filter = null) {
    let list = [..._snapshots.values()];
    if (filter?.tag)    list = list.filter(s => s.tag    === filter.tag);
    if (filter?.source) list = list.filter(s => s.source === filter.source);
    return list.map(s => ({ snapshotId: s.snapshotId, tag: s.tag, source: s.source, timestamp: s.timestamp }));
}

// ── pruneSnapshots ─────────────────────────────────────────────────────

function pruneSnapshots(maxAgeMs = DEFAULT_MAX_AGE) {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const before = _snapshots.size;
    let pruned   = 0;

    for (const [id, snap] of _snapshots) {
        if (snap.timestamp < cutoff) {
            _snapshots.delete(id);
            _order.splice(_order.indexOf(id), 1);
            pruned++;
        }
    }
    return { pruned, remaining: _snapshots.size, before };
}

// ── getSnapshotMetrics ─────────────────────────────────────────────────

function getSnapshotMetrics() {
    const all    = [..._snapshots.values()];
    const bySrc  = {};
    const byTag  = {};
    for (const s of all) {
        bySrc[s.source] = (bySrc[s.source] ?? 0) + 1;
        if (s.tag) byTag[s.tag] = (byTag[s.tag] ?? 0) + 1;
    }
    return {
        totalSnapshots: all.length,
        capacity: MAX_SNAPSHOTS,
        bySource: bySrc,
        byTag,
    };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() {
    _snapshots = new Map();
    _order     = [];
    _counter   = 0;
}

module.exports = {
    MAX_SNAPSHOTS, DEFAULT_MAX_AGE,
    captureSnapshot, getSnapshot, getLatestSnapshot,
    diffSnapshots, listSnapshots, pruneSnapshots,
    getSnapshotMetrics, reset,
};
