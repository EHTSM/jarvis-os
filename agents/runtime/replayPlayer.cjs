"use strict";
/**
 * Phase 486 — Execution Replay UX
 *
 * Step-by-step replay playback, validation visibility,
 * recovery timeline, execution comparison, export bundles.
 *
 * Wraps executionReplayEngine + replayExporter with
 * operator-friendly UX primitives.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const path = require("path");

// ── Helpers ───────────────────────────────────────────────────────────────────

function _getReplay(replayId) {
    const engine = _tryRequire("./executionReplayEngine.cjs");
    if (!engine) return null;
    return engine.get ? engine.get(replayId) : null;
}

function _labelStep(step) {
    if (!step) return "unknown";
    if (step.result === "success" || step.ok === true)  return "passed";
    if (step.result === "failure" || step.ok === false) return "failed";
    if (step.skipped) return "skipped";
    return "pending";
}

// ── Step-by-step playback ─────────────────────────────────────────────────────

/**
 * Get a replay with steps formatted for step-by-step display.
 * Returns a playback object the UI can paginate through.
 */
function getPlayback(replayId) {
    const replay = _getReplay(replayId);
    if (!replay) return { ok: false, error: "replay not found" };

    const steps = (replay.steps || []).map((step, idx) => ({
        index:          idx,
        label:          step.label || step.cmd || `Step ${idx + 1}`,
        cmd:            step.cmd   || null,
        approvalLevel:  step.approvalLevel || "SAFE",
        status:         _labelStep(step),
        output:         step.output ? String(step.output).slice(0, 500) : null,
        error:          step.error  ? String(step.error).slice(0, 300)  : null,
        durationMs:     step.durationMs || null,
        probeResult:    step.probeResult || null,
        retryCount:     step.retryCount  || 0,
        ts:             step.ts || null,
    }));

    const passed  = steps.filter(s => s.status === "passed").length;
    const failed  = steps.filter(s => s.status === "failed").length;
    const skipped = steps.filter(s => s.status === "skipped").length;

    return {
        ok:           true,
        replayId,
        sessionId:    replay.sessionId,
        goal:         replay.goal,
        state:        replay.state,
        totalSteps:   steps.length,
        passed,
        failed,
        skipped,
        steps,
        createdAt:    replay.createdAt,
        completedAt:  replay.completedAt || null,
        durationMs:   replay.completedAt ? replay.completedAt - replay.createdAt : null,
    };
}

/**
 * Get a single step from a replay.
 */
function getStep(replayId, stepIndex) {
    const pb = getPlayback(replayId);
    if (!pb.ok) return pb;
    const step = pb.steps[stepIndex];
    if (!step) return { ok: false, error: `step ${stepIndex} not found in replay` };
    return { ok: true, step, total: pb.totalSteps, replayId };
}

// ── Recovery timeline ─────────────────────────────────────────────────────────

/**
 * Build a linear timeline of recovery events from a replay.
 * Highlights transitions: pending → running → passed/failed/skipped.
 */
function getRecoveryTimeline(replayId) {
    const pb = getPlayback(replayId);
    if (!pb.ok) return pb;

    const events = [];
    events.push({ ts: pb.createdAt, type: "session-start",  label: `Started: ${pb.goal}` });

    pb.steps.forEach(step => {
        if (step.ts) {
            events.push({
                ts:    step.ts,
                type:  step.status === "failed" ? "step-failed" : step.status === "passed" ? "step-passed" : "step-skipped",
                label: `${step.status.toUpperCase()}: ${step.label}`,
                step:  step.index,
            });
        }
    });

    if (pb.completedAt) {
        events.push({ ts: pb.completedAt, type: "session-end", label: `Finished: ${pb.state}` });
    }

    events.sort((a, b) => (a.ts || 0) - (b.ts || 0));

    return {
        ok:        true,
        replayId,
        goal:      pb.goal,
        events,
        summary: `${pb.passed}/${pb.totalSteps} steps passed — ${pb.failed} failed, ${pb.skipped} skipped`,
    };
}

// ── Execution comparison ──────────────────────────────────────────────────────

/**
 * Compare two replays side-by-side.
 * Returns per-step diff: same/improved/regressed/added/removed.
 */
function compareReplays(replayIdA, replayIdB) {
    const pbA = getPlayback(replayIdA);
    const pbB = getPlayback(replayIdB);
    if (!pbA.ok) return { ok: false, error: `replay A: ${pbA.error}` };
    if (!pbB.ok) return { ok: false, error: `replay B: ${pbB.error}` };

    const maxLen = Math.max(pbA.steps.length, pbB.steps.length);
    const diff   = [];

    for (let i = 0; i < maxLen; i++) {
        const sA = pbA.steps[i];
        const sB = pbB.steps[i];
        if (!sA) { diff.push({ index: i, change: "added",   step: sB.label, statusB: sB.status }); continue; }
        if (!sB) { diff.push({ index: i, change: "removed", step: sA.label, statusA: sA.status }); continue; }

        const change =
            sA.status === sB.status   ? "same"      :
            sA.status === "failed" && sB.status === "passed" ? "improved"  :
            sA.status === "passed" && sB.status === "failed" ? "regressed" :
            "changed";

        diff.push({ index: i, change, label: sA.label, statusA: sA.status, statusB: sB.status });
    }

    const regressions = diff.filter(d => d.change === "regressed").length;
    const improvements = diff.filter(d => d.change === "improved").length;

    return {
        ok: true,
        replayA: { id: replayIdA, goal: pbA.goal, passed: pbA.passed, failed: pbA.failed },
        replayB: { id: replayIdB, goal: pbB.goal, passed: pbB.passed, failed: pbB.failed },
        diff,
        regressions,
        improvements,
        verdict: regressions > improvements ? "regressed" : improvements > regressions ? "improved" : "neutral",
    };
}

// ── Export bundle ─────────────────────────────────────────────────────────────

/**
 * Build a shareable export bundle for a replay.
 * Includes playback, timeline, and markdown for human reading.
 */
function exportBundle(replayId) {
    const exporter = _tryRequire("./replayExporter.cjs");
    const pb       = getPlayback(replayId);
    const timeline = getRecoveryTimeline(replayId);

    if (!pb.ok) return { ok: false, error: pb.error };

    const markdown = exporter && exporter.exportSessionMarkdown
        ? exporter.exportSessionMarkdown(pb.sessionId)
        : null;

    return {
        ok:          true,
        replayId,
        sessionId:   pb.sessionId,
        goal:        pb.goal,
        playback:    pb,
        timeline:    timeline.ok ? timeline : null,
        markdown,
        exportedAt:  new Date().toISOString(),
    };
}

/**
 * List available replays with summary for replay browser.
 */
function listReplays({ limit = 20, sessionId } = {}) {
    const engine = _tryRequire("./executionReplayEngine.cjs");
    if (!engine || !engine.list) return [];
    return engine.list({ limit, sessionId }).map(r => ({
        id:         r.id,
        sessionId:  r.sessionId,
        goal:       r.goal,
        state:      r.state,
        stepCount:  Array.isArray(r.steps) ? r.steps.length : 0,
        passed:     Array.isArray(r.steps) ? r.steps.filter(s => s.result === "success" || s.ok === true).length : 0,
        failed:     Array.isArray(r.steps) ? r.steps.filter(s => s.result === "failure" || s.ok === false).length : 0,
        createdAt:  r.createdAt,
        durationMs: r.completedAt ? r.completedAt - r.createdAt : null,
    }));
}

module.exports = {
    getPlayback, getStep, getRecoveryTimeline,
    compareReplays, exportBundle, listReplays,
};
