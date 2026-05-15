"use strict";
/**
 * replayEngine — re-execute a captured workflow snapshot.
 *
 * replay(snapshot, opts?)
 *   → { replayId, originalId, success, divergences[], durationMs, stepResults[] }
 *   Re-runs the captured steps with a fresh ctx clone.
 *   Detects divergences: steps that changed status vs. original.
 *
 * dryReplay(snapshot)
 *   → { replayId, steps[], simulatedSuccess }
 *   Simulates replay without executing steps.
 */

const { runWorkflow } = require("../autonomousWorkflow.cjs");

let _seq = 0;

async function replay(snapshot, opts = {}) {
    const replayId = `replay-${snapshot.snapshotId}-${++_seq}`;
    const steps    = snapshot._steps;

    if (!Array.isArray(steps) || steps.length === 0) {
        return {
            replayId,
            originalId:     snapshot.snapshotId,
            success:        false,
            divergences:    [],
            durationMs:     0,
            stepResults:    [],
            error:          "no_steps_in_snapshot",
        };
    }

    // Fresh ctx from snapshot (deep clone of captured state)
    let replayCtx;
    try { replayCtx = JSON.parse(JSON.stringify(snapshot.ctx || {})); }
    catch { replayCtx = {}; }
    replayCtx._replay = true;

    const t0 = Date.now();
    const result = await runWorkflow(
        `replay:${snapshot.name}`,
        steps,
        {
            maxRetries: opts.maxRetries ?? 1,
            ctx:        replayCtx,
            id:         replayId,
        }
    );

    const divergences = _findDivergences(snapshot.result?.stepDetails || [], result.stepDetails || []);

    return {
        replayId,
        originalId:  snapshot.snapshotId,
        success:     result.success,
        divergences,
        durationMs:  Date.now() - t0,
        stepResults: result.stepDetails || [],
    };
}

function dryReplay(snapshot) {
    const replayId = `dry-${snapshot.snapshotId}-${++_seq}`;
    const steps    = snapshot.stepMeta || [];

    // Predict success based on original result
    const simulatedSuccess = snapshot.result?.success ?? null;

    return {
        replayId,
        originalId:      snapshot.snapshotId,
        steps:           steps.map(s => ({ name: s.name, willExecute: s.hasExecute })),
        simulatedSuccess,
        note:            "dry_replay: no steps executed",
    };
}

function _findDivergences(originalDetails, replayDetails) {
    const divergences = [];
    const origMap     = new Map(originalDetails.map(s => [s.name, s]));
    const repMap      = new Map(replayDetails.map(s => [s.name, s]));

    const allNames = new Set([...origMap.keys(), ...repMap.keys()]);
    for (const name of allNames) {
        const orig = origMap.get(name);
        const rep  = repMap.get(name);
        if (!orig) { divergences.push({ step: name, type: "step_added_in_replay" });  continue; }
        if (!rep)  { divergences.push({ step: name, type: "step_missing_in_replay" }); continue; }
        if (orig.status !== rep.status) {
            divergences.push({ step: name, type: "status_changed", from: orig.status, to: rep.status });
        }
    }
    return divergences;
}

module.exports = { replay, dryReplay };
