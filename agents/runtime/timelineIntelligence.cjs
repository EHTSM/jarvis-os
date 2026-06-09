"use strict";
/**
 * Phase 415 — Engineering Timeline Intelligence
 *
 * Processes raw session timelines into operator-readable intelligence:
 *   - Collapses repetitive/noisy events into summaries
 *   - Surfaces chain causality (what triggered what)
 *   - Highlights recoveries and their outcomes
 *   - Identifies quiet periods (operator inactivity gaps)
 *
 * Read-only: takes session data and returns enriched timeline.
 * Does NOT mutate session state.
 */

const NOISE_TYPES = new Set([
    "chain-finished",       // always paired with chain-started — collapse
    "session-created",      // implied context
    "state-active",         // implicit on create
]);

const COLLAPSE_REPEATS = 3; // if same type appears N+ times in a row, collapse

/**
 * Produce an intelligent timeline from raw session timeline events.
 *
 * @param {Array<{ type, ts, chainName?, goal?, reason?, confidence? }>} rawTimeline
 * @returns {{ entries: Array, causalChains: Array, recoveryDigest: object, quietPeriods: Array }}
 */
function analyze(rawTimeline) {
    if (!rawTimeline?.length) {
        return { entries: [], causalChains: [], recoveryDigest: { total: 0, succeeded: 0, failed: 0 }, quietPeriods: [] };
    }

    // Sort ascending by timestamp
    const sorted = [...rawTimeline].sort((a, b) => a.ts - b.ts);

    // 1. Collapse noise and repeated events
    const collapsed = _collapseNoise(sorted);

    // 2. Build causal chains (chain-started → chain-finished → recovery if any)
    const causalChains = _buildCausalChains(sorted);

    // 3. Recovery digest
    const recoveryDigest = _recoveryDigest(sorted);

    // 4. Quiet periods (gaps > 5 min between events)
    const quietPeriods = _findQuietPeriods(sorted, 5 * 60_000);

    return { entries: collapsed, causalChains, recoveryDigest, quietPeriods };
}

function _collapseNoise(events) {
    const result = [];
    let i = 0;
    while (i < events.length) {
        const e = events[i];

        // Skip pure noise events
        if (NOISE_TYPES.has(e.type)) { i++; continue; }

        // Detect runs of identical type
        let runEnd = i + 1;
        while (runEnd < events.length && events[runEnd].type === e.type) runEnd++;
        const runLen = runEnd - i;

        if (runLen >= COLLAPSE_REPEATS) {
            result.push({
                type:      e.type,
                ts:        e.ts,
                tsEnd:     events[runEnd - 1].ts,
                collapsed: runLen,
                summary:   `${e.type} × ${runLen}`,
            });
            i = runEnd;
        } else {
            result.push({ ...e });
            i++;
        }
    }
    return result;
}

function _buildCausalChains(events) {
    const chains = [];
    const starts = events.filter(e => e.type === "chain-started");

    for (const start of starts) {
        const chainName = start.chainName;
        // Find the matching chain-finished after this start
        const finish = events.find(e =>
            e.type === "chain-finished" &&
            e.ts > start.ts &&
            (!e.chainName || e.chainName === chainName)
        );
        // Find any recovery attempt in the window after chain start
        const endTs = finish?.ts ?? (start.ts + 5 * 60_000);
        const recovery = events.find(e =>
            (e.type === "recovery-succeeded" || e.type === "recovery-failed") &&
            e.ts >= start.ts && e.ts <= endTs + 30_000
        );

        chains.push({
            chainName,
            startTs:  start.ts,
            endTs:    finish?.ts ?? null,
            durationMs: finish ? finish.ts - start.ts : null,
            completed:  !!finish,
            recovery:   recovery ? { outcome: recovery.type, ts: recovery.ts } : null,
        });
    }
    return chains;
}

function _recoveryDigest(events) {
    const recoveries = events.filter(e => e.type === "recovery-succeeded" || e.type === "recovery-failed");
    const succeeded  = recoveries.filter(e => e.type === "recovery-succeeded").length;
    const failed     = recoveries.filter(e => e.type === "recovery-failed").length;
    return { total: recoveries.length, succeeded, failed, rate: recoveries.length ? Math.round(succeeded / recoveries.length * 100) : null };
}

function _findQuietPeriods(events, minGapMs) {
    if (events.length < 2) return [];
    const quiet = [];
    for (let i = 1; i < events.length; i++) {
        const gap = events[i].ts - events[i - 1].ts;
        if (gap >= minGapMs) {
            quiet.push({
                fromTs:      events[i - 1].ts,
                toTs:        events[i].ts,
                gapMs:       gap,
                gapMinutes:  Math.round(gap / 60_000),
            });
        }
    }
    return quiet;
}

/**
 * Produce a short human-readable summary of a session's timeline.
 * @param {Array} rawTimeline
 * @param {object} [session] — optional session header fields
 * @returns {string}
 */
function summarize(rawTimeline, session = {}) {
    const { causalChains, recoveryDigest, quietPeriods } = analyze(rawTimeline);
    const parts = [];
    if (causalChains.length) {
        const completed = causalChains.filter(c => c.completed).length;
        parts.push(`${completed}/${causalChains.length} chains completed`);
    }
    if (recoveryDigest.total > 0) {
        parts.push(`${recoveryDigest.succeeded}/${recoveryDigest.total} recoveries succeeded`);
    }
    if (quietPeriods.length) {
        const longestGap = Math.max(...quietPeriods.map(q => q.gapMinutes));
        parts.push(`longest quiet period: ${longestGap}min`);
    }
    const sessionLabel = session.goal ? `"${session.goal.slice(0, 40)}"` : "session";
    return parts.length ? `${sessionLabel}: ${parts.join("; ")}` : `${sessionLabel}: no chains run`;
}

module.exports = { analyze, summarize };
