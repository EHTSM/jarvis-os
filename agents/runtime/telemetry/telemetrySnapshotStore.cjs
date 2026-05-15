"use strict";
/**
 * telemetrySnapshotStore — runtime state snapshots and telemetry-driven stabilization escalation.
 *
 * takeSnapshot(healthScore, metrics, context)      → Snapshot
 * getSnapshot(snapshotId)                          → Snapshot | null
 * getLatestSnapshot()                              → Snapshot | null
 * compareSnapshots(id1, id2)                       → ComparisonResult
 * checkEscalation(snapshot)                        → EscalationResult
 * getEscalationHistory()                           → EscalationRecord[]
 * listSnapshots(limit)                             → Snapshot[]
 * reset()
 */

// Escalation rules in priority order (first match wins)
const ESCALATION_RULES = [
    {
        id:        "critical_health",
        check:     s => s.healthScore.score < 40,
        level:     "critical",
        action:    "activate_recovery_mode",
        reason:    "health_below_critical_threshold",
    },
    {
        id:        "sustained_degradation",
        check:     (s, history) => {
            if (history.length < 3) return false;
            const last3 = history.slice(-3);
            return last3.every(h => h.healthScore.score < 60);
        },
        level:     "critical",
        action:    "escalate_to_recovery",
        reason:    "three_consecutive_degraded_snapshots",
    },
    {
        id:        "degraded_with_critical_metric",
        check:     s => s.healthScore.score < 60 && s.healthScore.hasCritical,
        level:     "degraded",
        action:    "trigger_stabilization",
        reason:    "degraded_health_with_critical_signal",
    },
    {
        id:        "warning_with_trend",
        check:     s => s.healthScore.score < 75 && s.context?.trend === "degrading",
        level:     "warning",
        action:    "increase_supervision_frequency",
        reason:    "warning_health_degrading_trend",
    },
];

const SNAPSHOT_CAP = 1000;

let _snapshots    = new Map();   // snapshotId → Snapshot
let _escalations  = [];
let _counter      = 0;

// ── takeSnapshot ──────────────────────────────────────────────────────

function takeSnapshot(healthScore = {}, metrics = [], context = {}) {
    const snapshotId = `snap-${++_counter}`;
    const snapshot = {
        snapshotId,
        healthScore: { ...healthScore },
        metrics:     [...metrics],
        context:     { ...context },
        metricCount: metrics.length,
        ts:          new Date().toISOString(),
    };

    if (_snapshots.size >= SNAPSHOT_CAP) {
        const oldest = _snapshots.keys().next().value;
        _snapshots.delete(oldest);
    }

    _snapshots.set(snapshotId, snapshot);
    return snapshot;
}

// ── getSnapshot ───────────────────────────────────────────────────────

function getSnapshot(snapshotId) {
    return _snapshots.get(snapshotId) ?? null;
}

// ── getLatestSnapshot ─────────────────────────────────────────────────

function getLatestSnapshot() {
    if (_snapshots.size === 0) return null;
    const ids = [..._snapshots.keys()];
    return _snapshots.get(ids[ids.length - 1]);
}

// ── listSnapshots ─────────────────────────────────────────────────────

function listSnapshots(limit = 50) {
    const all = [..._snapshots.values()];
    return all.slice(-limit);
}

// ── compareSnapshots ──────────────────────────────────────────────────

function compareSnapshots(id1, id2) {
    const s1 = _snapshots.get(id1);
    const s2 = _snapshots.get(id2);

    if (!s1 || !s2) return { compared: false, reason: !s1 ? "snapshot1_not_found" : "snapshot2_not_found" };

    const scoreDelta  = s2.healthScore.score - s1.healthScore.score;
    const direction   = scoreDelta > 5  ? "improved"  :
                        scoreDelta < -5 ? "worsened"  : "stable";
    const critChange  = (s2.healthScore.criticalCount ?? 0) - (s1.healthScore.criticalCount ?? 0);

    return {
        compared:     true,
        id1, id2,
        scoreDelta:   +scoreDelta.toFixed(1),
        direction,
        criticalCountChange: critChange,
        s1Score:      s1.healthScore.score,
        s2Score:      s2.healthScore.score,
        timeDeltaMs:  new Date(s2.ts).getTime() - new Date(s1.ts).getTime(),
    };
}

// ── checkEscalation ───────────────────────────────────────────────────

function checkEscalation(snapshot) {
    if (!snapshot) return { escalate: false, reason: "no_snapshot" };

    const history = listSnapshots(10);

    for (const rule of ESCALATION_RULES) {
        if (rule.check(snapshot, history)) {
            const record = {
                ruleId:      rule.id,
                snapshotId:  snapshot.snapshotId,
                level:       rule.level,
                action:      rule.action,
                reason:      rule.reason,
                healthScore: snapshot.healthScore.score,
                ts:          new Date().toISOString(),
            };
            _escalations.push(record);
            return { escalate: true, ...record };
        }
    }

    return { escalate: false, snapshotId: snapshot.snapshotId, healthScore: snapshot.healthScore.score };
}

// ── getEscalationHistory / reset ──────────────────────────────────────

function getEscalationHistory() { return [..._escalations]; }

function reset() {
    _snapshots   = new Map();
    _escalations = [];
    _counter     = 0;
}

module.exports = {
    ESCALATION_RULES,
    takeSnapshot, getSnapshot, getLatestSnapshot, listSnapshots,
    compareSnapshots, checkEscalation, getEscalationHistory, reset,
};
