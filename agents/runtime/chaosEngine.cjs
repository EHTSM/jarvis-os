"use strict";
/**
 * chaosEngine — controlled failure injection for reliability testing.
 *
 * injectFailure(wfId, stepName, opts)  — inject an error when step executes
 *   opts: { type, message, probability=1.0, maxHits=Infinity }
 *
 * injectLatency(wfId, stepName, delayMs) — inject sleep before step runs
 *
 * clearInjections(wfId)   — remove all injections for a workflow
 *
 * wrapStep(step, wfId)    → wrapped step with injection logic applied
 *
 * chaosReport()           → { wfId: { stepName: { failure?, latency?, hits } } }
 *
 * reset()                 — clear all injections
 */

// workflowId → Map<stepName, injection>
const _injections = new Map();

function _wfMap(workflowId) {
    if (!_injections.has(workflowId)) _injections.set(workflowId, new Map());
    return _injections.get(workflowId);
}

function injectFailure(workflowId, stepName, opts = {}) {
    const wf  = _wfMap(workflowId);
    const cur = wf.get(stepName) || { hits: 0 };
    wf.set(stepName, {
        ...cur,
        failure: {
            type:        opts.type        || "chaos_failure",
            message:     opts.message     || `chaos: injected failure on "${stepName}"`,
            probability: opts.probability ?? 1.0,
        },
        maxHits: opts.maxHits ?? Infinity,
    });
    return { workflowId, stepName, injected: "failure" };
}

function injectLatency(workflowId, stepName, delayMs = 100) {
    const wf  = _wfMap(workflowId);
    const cur = wf.get(stepName) || { hits: 0 };
    wf.set(stepName, { ...cur, latency: delayMs, maxHits: cur.maxHits ?? Infinity });
    return { workflowId, stepName, injected: "latency", delayMs };
}

function clearInjections(workflowId) {
    return _injections.delete(workflowId);
}

function wrapStep(step, workflowId) {
    const orig = step.execute;
    return {
        ...step,
        execute: async (ctx) => {
            const wf  = _injections.get(workflowId);
            const inj = wf?.get(step.name);

            if (inj && inj.hits < (inj.maxHits ?? Infinity)) {
                inj.hits = (inj.hits || 0) + 1;

                if (inj.latency) {
                    await new Promise(r => {
                        const t = setTimeout(r, inj.latency);
                        if (t.unref) t.unref();
                    });
                }

                if (inj.failure && Math.random() < (inj.failure.probability ?? 1)) {
                    const err  = new Error(inj.failure.message);
                    err.type   = inj.failure.type;
                    throw err;
                }
            }

            return orig(ctx);
        },
    };
}

function chaosReport() {
    const report = {};
    for (const [wfId, steps] of _injections) {
        report[wfId] = {};
        for (const [name, inj] of steps) {
            report[wfId][name] = {
                failure: inj.failure
                    ? { type: inj.failure.type, probability: inj.failure.probability }
                    : null,
                latency: inj.latency || null,
                hits:    inj.hits    || 0,
                maxHits: inj.maxHits === Infinity ? "unlimited" : inj.maxHits,
            };
        }
    }
    return report;
}

function reset() { _injections.clear(); }

module.exports = { injectFailure, injectLatency, clearInjections, wrapStep, chaosReport, reset };
