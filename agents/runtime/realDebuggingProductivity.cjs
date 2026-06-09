"use strict";
/**
 * Phase 725 — Real Debugging Productivity
 *
 * Runtime-failure diagnosis, dependency repair speed, replay-guided debugging,
 * workflow discoverability, recovery-chain usability.
 * Reduces: debugging friction, repeated recovery steps, unnecessary noise.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Runtime-failure diagnosis ─────────────────────────────────────────────────

function diagnoseRuntimeFailure(errorContext = "", { env = "vscode", trustScore = 65 } = {}) {
    const diagnosis = { errorContext: errorContext.slice(0, 300), env, phases: [] };

    // Phase 1: root cause prioritization
    const sdp = _tryRequire("./strategicDebugPlanning.cjs");
    if (sdp && errorContext) {
        try {
            const roots = sdp.prioritizeRootCauses(errorContext);
            diagnosis.phases.push({ phase: "root-causes", ok: roots.ok, count: roots.causes?.length || 0, primary: roots.primary?.cause });
        } catch {}
    }

    // Phase 2: runtime health
    const rdf = _tryRequire("./rapidDebuggingFlows.cjs");
    if (rdf) {
        try {
            const health = rdf.debugRuntimeHealthCheck();
            diagnosis.phases.push({ phase: "runtime-health", ok: health.ok, ready: health.readyForDebugging });
        } catch {}
    }

    // Phase 3: adaptive recovery path
    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    if (arc) {
        try {
            const r = arc.chooseRecoveryPath(errorContext);
            diagnosis.phases.push({ phase: "recovery-path", ok: r.ok, path: r.chosen?.path, confidence: r.chosen?.confidence });
        } catch {}
    }

    // Phase 4: dep-aware debug sequence
    if (sdp && errorContext) {
        try {
            const seq = sdp.buildDependencyAwareDebugSequence(errorContext, { trustScore });
            diagnosis.phases.push({ phase: "debug-sequence", ok: seq.ok, steps: seq.sequence?.length || 0 });
        } catch {}
    }

    const allOk = diagnosis.phases.every(p => p.ok !== false);
    return { ok: true, diagnosis, phases: diagnosis.phases.length, ready: allOk, detail: `Diagnosis: ${diagnosis.phases.length} phases, ready=${allOk}` };
}

// ── Dependency repair speed ───────────────────────────────────────────────────

function rapidDependencyRepair(target = "", { env = "vscode" } = {}) {
    const steps = [];

    // Check terminal conflicts
    const tci = _tryRequire("./terminalCoordinationIntelligence.cjs");
    if (tci) {
        try {
            const conflicts = tci.checkProcessConflicts([]);
            steps.push({ step: "terminal-conflicts", ok: (conflicts.conflicts?.length || 0) === 0, conflicts: conflicts.conflicts?.length || 0 });
        } catch {}
    }

    // Check VS Code stale files
    const vei = _tryRequire("./vsCodeExecutionIntelligence.cjs");
    if (vei) {
        try {
            const stale = vei.detectStaleFiles();
            steps.push({ step: "stale-files", ok: stale.staleCount === 0, staleCount: stale.staleCount });
        } catch {}
    }

    // Suggest recovery pattern from memory
    const emp = _tryRequire("./engineeringMemoryProductivity.cjs");
    if (emp) {
        try {
            const suggestion = emp.suggestRecoveryPattern(target, { env });
            steps.push({ step: "memory-suggestion", ok: true, count: suggestion.count, adaptive: suggestion.adaptive?.path });
        } catch {}
    }

    const allOk = steps.every(s => s.ok !== false);
    return { ok: allOk, steps, target, env, repairReady: allOk, detail: `Dep repair: ${steps.filter(s => s.ok !== false).length}/${steps.length} checks passed` };
}

// ── Replay-guided debugging ───────────────────────────────────────────────────

function replayGuidedDebugging(replayId, errorContext = "") {
    if (!replayId) return { ok: false, error: "replayId required" };

    // Restore replay context
    const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
    let replayCtx = null;
    if (lhpc) {
        try {
            const r = lhpc.restoreProductivitySession(replayId, { force: false });
            if (r.ok) replayCtx = { goal: r.record?.goal, progress: r.record?.progress, env: r.record?.env };
        } catch {}
    }

    // Build replay-linked debug flow
    const rdf = _tryRequire("./rapidDebuggingFlows.cjs");
    let replayFlow = null;
    if (rdf) {
        try { replayFlow = rdf.buildReplayLinkedDebugFlow(replayId, errorContext); } catch {}
    }

    // Pull repo context
    const rif = _tryRequire("./repoIntelligenceFoundation.cjs");
    let repoCtx = null;
    if (rif) {
        try { repoCtx = rif.recallRepoForReplay(replayId); } catch {}
    }

    return {
        ok:          true,
        replayId,
        replayCtx,
        replayFlow:  replayFlow ? { ok: replayFlow.ok, replayLinked: replayFlow.replayLinked } : null,
        repoCtx:     repoCtx?.ok ? { fileCount: repoCtx.files?.length, symbolCount: repoCtx.symbols?.length } : null,
        detail:      `Replay-guided debug: replayId=${replayId} context=${replayCtx ? "found" : "not found"}`,
    };
}

// ── Workflow discoverability for debugging ────────────────────────────────────

function discoverDebuggingWorkflows({ env = null } = {}) {
    const workflows = [];

    const ocf = _tryRequire("./oneClickEngineeringFlows.cjs");
    if (ocf) { try { workflows.push({ category: "one-click", flows: ocf.catalogOneClickFlows().filter(f => f.type.includes("debug")).map(f => f.type) }); } catch {} }

    const epc = _tryRequire("./executionProductivityChains.cjs");
    if (epc) { try { workflows.push({ category: "chains", flows: epc.catalogProductivityChains().filter(c => c.type.includes("debug")).map(c => c.type) }); } catch {} }

    const emp = _tryRequire("./engineeringMemoryProductivity.cjs");
    if (emp && env) {
        try {
            const flows = emp.environmentProductivityFlows(env);
            if (flows.topFlows?.length) workflows.push({ category: "memory-recall", flows: flows.topFlows.map(f => f.type) });
        } catch {}
    }

    const total = workflows.reduce((s, w) => s + w.flows.length, 0);
    return { ok: true, workflows, total, discoverable: total > 0, detail: `${total} debugging workflow(s) discoverable` };
}

// ── Recovery-chain usability ──────────────────────────────────────────────────

function assessRecoveryChainUsability(errorContext = "") {
    const chains = [];

    const odc = _tryRequire("./operationalDecisionCoordination.cjs");
    if (odc) {
        try {
            const sequences = odc.rankCrossEnvRecoverySequences(errorContext, { trustScore: 65 });
            if (sequences.primary) chains.push({ source: "operational-decision", path: sequences.primary.path, confidence: sequences.primary.confidence });
        } catch {}
    }

    const rdf = _tryRequire("./rapidDebuggingFlows.cjs");
    if (rdf) {
        try {
            const r = rdf.validationFirstRecovery(errorContext, { trustScore: 65 });
            if (r.recoveryPath) chains.push({ source: "rapid-debug", path: r.recoveryPath, phases: r.phases.length });
        } catch {}
    }

    const usable = chains.length > 0;
    return { ok: usable, chains, count: chains.length, usable, detail: `${chains.length} recovery chain(s) available` };
}

// ── Full debugging productivity summary ───────────────────────────────────────

function debuggingProductivitySummary(errorContext = "") {
    const diagnosis  = diagnoseRuntimeFailure(errorContext, {});
    const repair     = rapidDependencyRepair(errorContext, {});
    const workflows  = discoverDebuggingWorkflows({});
    const recovery   = assessRecoveryChainUsability(errorContext);

    return {
        ok:            diagnosis.ready && repair.repairReady,
        diagnosisPhases: diagnosis.phases,
        repairSteps:   repair.steps.length,
        workflowCount: workflows.total,
        recoveryChains: recovery.count,
        detail:        `Debug productivity: diagnosis=${diagnosis.phases} repair=${repair.repairReady} workflows=${workflows.total} recovery=${recovery.count}`,
    };
}

module.exports = { diagnoseRuntimeFailure, rapidDependencyRepair, replayGuidedDebugging, discoverDebuggingWorkflows, assessRecoveryChainUsability, debuggingProductivitySummary };
