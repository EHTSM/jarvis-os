"use strict";
/**
 * distributedStateManager — multi-node state, leader election, and consistency scoring.
 *
 * addNode(nodeId, opts)                     → NodeResult
 * removeNode(nodeId)                        → RemovalResult
 * electLeader(nodeIds, opts)                → ElectionResult
 * syncState(nodeId, state)                  → SyncResult
 * detectSplitBrain(nodeGroups)              → SplitBrainResult
 * validateQuorum(participantIds, total)     → QuorumResult
 * repairDrift(nodeId, canonicalState)       → RepairResult
 * getConsistencyScore()                     → ConsistencyScore
 * reset()
 */

let _nodes     = new Map();   // nodeId → NodeState
let _leader    = null;
let _stateLog  = [];
let _elections = [];

// ── addNode ───────────────────────────────────────────────────────────

function addNode(nodeId, opts = {}) {
    if (!nodeId)                return { added: false, reason: "missing_node_id" };
    if (_nodes.has(nodeId))     return { added: false, reason: "already_exists" };

    const node = {
        nodeId,
        priority:    opts.priority ?? 1,
        state:       {},
        healthy:     opts.healthy !== false,
        joinedAt:    new Date().toISOString(),
        syncVersion: 0,
    };
    _nodes.set(nodeId, node);
    return { added: true, nodeId, node };
}

// ── removeNode ────────────────────────────────────────────────────────

function removeNode(nodeId) {
    if (!_nodes.has(nodeId)) return { removed: false, reason: "not_found" };
    const wasLeader = _leader === nodeId;
    _nodes.delete(nodeId);
    if (wasLeader) _leader = null;
    return { removed: true, nodeId, leaderCleared: wasLeader };
}

// ── electLeader ───────────────────────────────────────────────────────

function electLeader(nodeIds = [], _opts = {}) {
    const pool = nodeIds.length > 0
        ? nodeIds.map(id => _nodes.get(id)).filter(Boolean)
        : [..._nodes.values()];

    const candidates = pool.filter(n => n.healthy);
    if (candidates.length === 0) return { elected: false, reason: "no_healthy_candidates" };

    // Deterministic: highest priority wins; alphabetical nodeId breaks ties
    const sorted    = [...candidates].sort((a, b) => {
        const pd = b.priority - a.priority;
        return pd !== 0 ? pd : a.nodeId.localeCompare(b.nodeId);
    });
    _leader = sorted[0].nodeId;

    const rec = { leader: _leader, candidateCount: candidates.length, ts: new Date().toISOString() };
    _elections.push(rec);
    _stateLog.push({ type: "leader_elected", ...rec });
    return { elected: true, leader: _leader, candidateCount: candidates.length };
}

// ── syncState ─────────────────────────────────────────────────────────

function syncState(nodeId, state = {}) {
    const node = _nodes.get(nodeId);
    if (!node) return { synced: false, reason: "node_not_found" };

    node.state        = { ...node.state, ...state };
    node.syncVersion += 1;
    node.lastSyncAt   = new Date().toISOString();

    _stateLog.push({ type: "state_sync", nodeId, version: node.syncVersion, ts: new Date().toISOString() });
    return { synced: true, nodeId, version: node.syncVersion };
}

// ── detectSplitBrain ──────────────────────────────────────────────────

function detectSplitBrain(nodeGroups = []) {
    if (nodeGroups.length < 2) return { splitBrain: false, reason: "insufficient_groups" };

    // A partition has a "leader" if it has an explicit leader property,
    // or if the global _leader is one of its nodes
    const withLeader = nodeGroups.filter(g =>
        g.leader != null || (g.nodes ?? []).includes(_leader)
    );

    const splitBrain = withLeader.length > 1;
    return {
        splitBrain,
        groupCount:       nodeGroups.length,
        groupsWithLeader: withLeader.length,
        severity:         splitBrain ? "critical" : "none",
    };
}

// ── validateQuorum ────────────────────────────────────────────────────

function validateQuorum(participantIds = [], totalNodes = null) {
    const total       = totalNodes ?? _nodes.size;
    const quorumSize  = Math.floor(total / 2) + 1;
    const hasQuorum   = participantIds.length >= quorumSize;

    return {
        hasQuorum,
        participantCount: participantIds.length,
        quorumRequired:   quorumSize,
        total,
        deficit:          Math.max(0, quorumSize - participantIds.length),
    };
}

// ── repairDrift ───────────────────────────────────────────────────────

function repairDrift(nodeId, canonicalState = {}) {
    const node = _nodes.get(nodeId);
    if (!node) return { repaired: false, reason: "node_not_found" };

    const driftedKeys = [];
    for (const [key, val] of Object.entries(canonicalState)) {
        if (JSON.stringify(node.state[key]) !== JSON.stringify(val)) driftedKeys.push(key);
    }

    node.state        = { ...canonicalState };
    node.syncVersion += 1;
    node.lastRepairAt = new Date().toISOString();

    _stateLog.push({ type: "drift_repair", nodeId, driftedKeys, ts: new Date().toISOString() });
    return { repaired: true, nodeId, driftedKeys, driftCount: driftedKeys.length };
}

// ── getConsistencyScore ───────────────────────────────────────────────

function getConsistencyScore() {
    const nodes = [..._nodes.values()];
    if (nodes.length === 0) return { score: 0, grade: "F", reason: "no_nodes" };

    const healthyRatio = nodes.filter(n => n.healthy).length / nodes.length;
    const versions     = nodes.map(n => n.syncVersion);
    const maxVer       = Math.max(...versions);
    const syncRatio    = maxVer > 0
        ? nodes.filter(n => n.syncVersion >= maxVer - 1).length / nodes.length
        : 1;
    const leaderBonus  = _leader ? 10 : 0;

    const raw   = healthyRatio * 50 + syncRatio * 40 + leaderBonus;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    return {
        score,
        grade,
        healthyRatio: +healthyRatio.toFixed(3),
        syncRatio:    +syncRatio.toFixed(3),
        hasLeader:    _leader !== null,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _nodes     = new Map();
    _leader    = null;
    _stateLog  = [];
    _elections = [];
}

module.exports = {
    addNode, removeNode, electLeader, syncState,
    detectSplitBrain, validateQuorum, repairDrift, getConsistencyScore,
    reset,
};
