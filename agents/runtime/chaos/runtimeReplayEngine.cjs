"use strict";
/**
 * runtimeReplayEngine — deterministic execution replay and divergence detection.
 *
 * createSession(executions, opts)               → ReplaySession
 * replay(sessionId, fingerprint, opts)          → ReplayResult
 * compareFingerprints(fp1, fp2, entries)        → ComparisonResult
 * detectDivergence(session, replayResult)       → DivergenceResult
 * scoreVerification(session, replayResult)      → VerificationScore
 * getSession(sessionId)                         → ReplaySession | null
 * reset()
 */

let _sessions = new Map();
let _counter  = 0;

// ── createSession ─────────────────────────────────────────────────────

function createSession(executions = [], opts = {}) {
    const sessionId = opts.sessionId ?? `replay-${++_counter}`;

    const snapshot = [...executions].sort((a, b) =>
        new Date(a.ts ?? 0).getTime() - new Date(b.ts ?? 0).getTime()
    );

    const session = {
        sessionId,
        fingerprints:  [...new Set(snapshot.map(e => e.fingerprint ?? "unknown"))],
        executions:    snapshot,
        totalCount:    snapshot.length,
        successCount:  snapshot.filter(e => e.success).length,
        createdAt:     new Date().toISOString(),
        opts:          { ...opts },
    };
    _sessions.set(sessionId, session);
    return session;
}

// ── replay ────────────────────────────────────────────────────────────

function replay(sessionId, targetFingerprint = null, _opts = {}) {
    const session = _sessions.get(sessionId);
    if (!session) return { replayed: false, reason: "session_not_found" };

    const entries = targetFingerprint
        ? session.executions.filter(e => e.fingerprint === targetFingerprint)
        : session.executions;

    if (entries.length === 0) {
        return { replayed: false, reason: "no_entries_for_fingerprint" };
    }

    const startTs  = new Date(entries[0].ts ?? new Date()).getTime();
    const timeline = entries.map((e, i) => ({
        index:       i,
        fingerprint: e.fingerprint ?? "unknown",
        success:     e.success,
        durationMs:  e.durationMs ?? 0,
        relativeMs:  new Date(e.ts ?? startTs).getTime() - startTs,
        strategy:    e.strategy    ?? "safe",
        retryCount:  e.retryCount  ?? 0,
    }));

    const successRate = timeline.length > 0
        ? timeline.filter(t => t.success).length / timeline.length
        : 0;

    return {
        replayed:      true,
        sessionId,
        fingerprint:   targetFingerprint,
        timeline,
        replayedCount: timeline.length,
        successRate:   +successRate.toFixed(3),
    };
}

// ── compareFingerprints ───────────────────────────────────────────────

function compareFingerprints(fp1, fp2, entries = []) {
    const e1 = entries.filter(e => e.fingerprint === fp1);
    const e2 = entries.filter(e => e.fingerprint === fp2);

    const sr1 = e1.length > 0 ? e1.filter(e => e.success).length / e1.length : 0;
    const sr2 = e2.length > 0 ? e2.filter(e => e.success).length / e2.length : 0;
    const ad1 = e1.length > 0 ? e1.reduce((s, e) => s + (e.durationMs ?? 0), 0) / e1.length : 0;
    const ad2 = e2.length > 0 ? e2.reduce((s, e) => s + (e.durationMs ?? 0), 0) / e2.length : 0;

    return {
        fp1, fp2,
        successRateDelta: +(sr1 - sr2).toFixed(3),
        avgDurationDelta: +(ad1 - ad2).toFixed(1),
        fp1Count: e1.length,
        fp2Count: e2.length,
        equivalent: Math.abs(sr1 - sr2) < 0.1 && Math.abs(ad1 - ad2) < 500,
    };
}

// ── detectDivergence ──────────────────────────────────────────────────

function detectDivergence(session, replayResult) {
    if (!session || !replayResult?.replayed) {
        return { diverged: false, reason: "invalid_inputs" };
    }

    const originalRate = session.successCount / Math.max(1, session.totalCount);
    const delta        = Math.abs(originalRate - replayResult.successRate);
    const diverged     = delta > 0.1;
    const severity     = delta > 0.3 ? "high" : delta > 0.1 ? "medium" : "none";

    return {
        diverged,
        severity,
        originalSuccessRate: +originalRate.toFixed(3),
        replayedSuccessRate: replayResult.successRate,
        delta:               +delta.toFixed(3),
    };
}

// ── scoreVerification ─────────────────────────────────────────────────

function scoreVerification(session, replayResult) {
    if (!session || !replayResult?.replayed) {
        return { score: 0, grade: "F", reason: "invalid_inputs" };
    }

    const originalRate = session.successCount / Math.max(1, session.totalCount);
    const delta        = Math.abs(originalRate - replayResult.successRate);
    const score        = Math.max(0, 100 - delta * 200);
    const grade        = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    return { score: +score.toFixed(1), grade, delta: +delta.toFixed(3), verified: score >= 75 };
}

// ── getSession / reset ────────────────────────────────────────────────

function getSession(sessionId) { return _sessions.get(sessionId) ?? null; }

function reset() {
    _sessions = new Map();
    _counter  = 0;
}

module.exports = {
    createSession, replay, compareFingerprints,
    detectDivergence, scoreVerification, getSession, reset,
};
