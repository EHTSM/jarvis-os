"use strict";
/**
 * planningReplay — deterministic replay support.
 * Same task + same context always produce identical planning decisions.
 *
 * hash(task, context)       → deterministic hex string
 * replayFull(task, context) → { decomposition, simResult, feasibility, strategy }  (synchronous, no TCP)
 * record(task, context, result)  → { hash, stored:true }
 * replay(task, context)     → { hash, fresh, stored?, match?, diffs? }
 * compare(r1, r2)           → { match, diffs[] }
 * reset()
 */

const gd  = require("./goalDecomposer.cjs");
const ps  = require("./planSimulator.cjs");
const fsc = require("./feasibilityScorer.cjs");
const ss  = require("./strategySelector.cjs");

// hash → { hash, result, recordedAt }
const _store = new Map();

// ── _sortedJSON ───────────────────────────────────────────────────────
// Recursively sort object keys before serialisation for deterministic hashing.

function _sortedJSON(v) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return JSON.stringify(v);
    return "{" + Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${_sortedJSON(v[k])}`).join(",") + "}";
}

// ── hash ──────────────────────────────────────────────────────────────
// DJB2-XOR: deterministic, collision-resistant for small inputs.

function hash(task, context = {}) {
    const str = _sortedJSON({ context, task });
    let   h   = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) ^ str.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h).toString(16).padStart(8, "0");
}

// ── replayFull ────────────────────────────────────────────────────────
// Fully synchronous pipeline — no TCP port probing.
// Port conflicts are resolved via context.occupiedPorts only.

function replayFull(task, context = {}) {
    const decomp = gd.decompose(task);
    const plan   = decomp.plan;

    const depIssues   = ps.simulateMissingDeps(plan);
    const cycleIssues = ps.simulateCircularChains(plan);
    const orderIssues = ps.simulateInvalidOrder(plan);
    const cmdIssues   = ps.simulateUnsafeCommands(plan);
    const toolIssues  = ps.simulateUnavailableTools(plan, context);

    const portIssues = [];
    for (const step of (plan.steps ?? [])) {
        for (const port of (step.requiredPorts ?? [])) {
            if ((context.occupiedPorts ?? []).includes(port)) {
                portIssues.push({
                    type:     "port_conflict",
                    stepId:   step.id,
                    port,
                    severity: "blocker",
                    message:  `Step "${step.id}" requires port ${port} which is in use`,
                });
            }
        }
    }

    const all      = [...depIssues, ...cycleIssues, ...orderIssues, ...cmdIssues, ...toolIssues, ...portIssues];
    const blockers = all.filter(i => i.severity === "blocker");
    const simResult = {
        passed:     blockers.length === 0,
        issues:     all,
        blockers,
        warnings:   all.filter(i => i.severity === "warning"),
        highIssues: all.filter(i => i.severity === "high"),
        simSummary: { totalIssues: all.length, blockerCount: blockers.length, checksRun: 6 },
    };

    const feasibility = fsc.score(plan, simResult);
    const strategy    = ss.select(plan, feasibility, simResult);

    return { decomposition: decomp, simResult, feasibility, strategy };
}

// ── record ────────────────────────────────────────────────────────────

function record(task, context, result) {
    const h = hash(task, context);
    _store.set(h, { hash: h, result, recordedAt: new Date().toISOString() });
    return { hash: h, stored: true };
}

// ── replay ────────────────────────────────────────────────────────────

function replay(task, context = {}) {
    const h      = hash(task, context);
    const stored = _store.get(h) ?? null;
    const fresh  = replayFull(task, context);

    if (!stored) {
        _store.set(h, { hash: h, result: fresh, recordedAt: new Date().toISOString() });
        return { hash: h, fresh, stored: null, match: null, diffs: null };
    }

    const cmp = compare(stored.result, fresh);
    return { hash: h, fresh, stored: stored.result, match: cmp.match, diffs: cmp.diffs };
}

// ── compare ───────────────────────────────────────────────────────────

function compare(r1, r2) {
    const diffs = [];

    if (r1.strategy?.strategy !== r2.strategy?.strategy) {
        diffs.push({ field: "strategy", a: r1.strategy?.strategy, b: r2.strategy?.strategy });
    }
    if (r1.feasibility?.feasibility !== r2.feasibility?.feasibility) {
        diffs.push({ field: "feasibility", a: r1.feasibility?.feasibility, b: r2.feasibility?.feasibility });
    }
    if (r1.simResult?.passed !== r2.simResult?.passed) {
        diffs.push({ field: "simResult.passed", a: r1.simResult?.passed, b: r2.simResult?.passed });
    }
    const eo1 = JSON.stringify(r1.decomposition?.executionOrder ?? []);
    const eo2 = JSON.stringify(r2.decomposition?.executionOrder ?? []);
    if (eo1 !== eo2) {
        diffs.push({ field: "executionOrder", a: JSON.parse(eo1), b: JSON.parse(eo2) });
    }
    if (r1.feasibility?.confidence !== r2.feasibility?.confidence) {
        diffs.push({ field: "confidence", a: r1.feasibility?.confidence, b: r2.feasibility?.confidence });
    }

    return { match: diffs.length === 0, diffs };
}

function reset() { _store.clear(); }

module.exports = { hash, replayFull, record, replay, compare, reset };
