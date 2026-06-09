"use strict";
/**
 * Phase 679 — Engineering Priority Intelligence
 *
 * Tracks deployment urgency, debugging impact, workflow reliability,
 * runtime degradation, dependency instability, recovery effectiveness.
 * Generates priority rankings, operational-focus summaries, stabilization recommendations.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/eng-priority-intel.json");
const MAX_EVENTS = 200;
const TTL_MS     = 24 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { signals: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.signals = (db.signals || []).filter(s => s.ts > cutoff).slice(0, MAX_EVENTS);
}

// ── Priority ranking ──────────────────────────────────────────────────────────

function rankEngineeringPriorities({ windowMs = 4 * 60 * 60 * 1000 } = {}) {
    const factors = [];

    // Deployment urgency
    const sdc = _tryRequire("./smartDeploymentCoordination.cjs");
    if (sdc) {
        try {
            const stale = sdc.detectStaleDeploymentReplays();
            if (stale.staleCount > 0) factors.push({ domain: "deployment", factor: "stale-replays", urgency: 80, count: stale.staleCount });
        } catch {}
    }

    // Debugging impact
    const sdi = _tryRequire("./smartDebugIntelligence.cjs");
    if (sdi) {
        try {
            const repeated = sdi.detectRepeatedFailures({ windowMs, minCount: 2 });
            if (repeated.count > 0) factors.push({ domain: "debugging", factor: "repeated-failures", urgency: 90, count: repeated.count });
        } catch {}
    }

    // Workflow reliability
    const esi = _tryRequire("./executionStateIntelligence.cjs");
    if (esi) {
        try {
            const state = esi.executionStateSummary();
            if (!state.stable)                        factors.push({ domain: "workflow",    factor: "execution-unstable",   urgency: 85 });
            if (state.interrupted?.count > 0)         factors.push({ domain: "workflow",    factor: "interrupted-flows",    urgency: 70, count: state.interrupted.count });
        } catch {}
    }

    // Runtime degradation
    const apr = _tryRequire("./advancedPlatformResilience.cjs");
    if (apr) {
        try {
            const dm = apr.detectDegradedMode();
            if (dm.degraded) factors.push({ domain: "runtime",  factor: "degraded-mode", urgency: 95, pressureScore: dm.pressureScore });
        } catch {}
    }

    // Dependency instability
    const dae = _tryRequire("./dependencyAwareExecution.cjs");
    if (dae) {
        try {
            const stale = dae.detectStaleDependencyChains();
            if (stale.staleCount > 0) factors.push({ domain: "dependency", factor: "stale-chains", urgency: 65, count: stale.staleCount });
        } catch {}
    }

    // Recovery effectiveness
    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    if (arc) {
        try {
            const summary = arc.recoverySummary({ windowMs });
            if (summary.problematic.length > 0) factors.push({ domain: "recovery", factor: "stuck-paths", urgency: 75, count: summary.problematic.length });
        } catch {}
    }

    factors.sort((a, b) => b.urgency - a.urgency);
    const topDomain = factors[0]?.domain || "none";

    return {
        ok:        true,
        factors,
        primary:   factors[0] || null,
        topDomain,
        count:     factors.length,
        explainer: factors[0] ? `Top priority: '${factors[0].factor}' (urgency=${factors[0].urgency}, domain=${factors[0].domain})` : "No active priority signals",
    };
}

// ── Operational focus summary ─────────────────────────────────────────────────

function operationalFocusSummary() {
    const priorities = rankEngineeringPriorities();
    const epc = _tryRequire("./engineeringProductivityCoordination.cjs");
    let calmness = null;
    if (epc) { try { calmness = epc.operationalCalmnessScore(); } catch {} }

    const focus = priorities.primary
        ? { area: priorities.primary.domain, factor: priorities.primary.factor, urgency: priorities.primary.urgency }
        : { area: "general", factor: "monitoring", urgency: 0 };

    return {
        ok:         true,
        focus,
        calmness:   calmness?.level || "unknown",
        calmnessScore: calmness?.score || null,
        priorityCount: priorities.count,
        topDomain:  priorities.topDomain,
        summary:    `Focus: ${focus.area}/${focus.factor} — calmness=${calmness?.level || "?"} priorities=${priorities.count}`,
    };
}

// ── Stabilization recommendation ─────────────────────────────────────────────

function recommendStabilization(context = {}) {
    const priorities = rankEngineeringPriorities();
    const wsc = _tryRequire("./workflowStrategyCoordination.cjs");

    let chains = null;
    if (wsc) { try { chains = wsc.prioritizeStabilizationChains({ ...context, ...priorities.factors.reduce((a, f) => ({ ...a, [f.factor]: true }), {}) }); } catch {} }

    const steps = [];
    if (priorities.factors.some(f => f.domain === "runtime"))    steps.push({ step: "address-runtime-degradation",  priority: 95, autonomous: true  });
    if (priorities.factors.some(f => f.domain === "debugging"))  steps.push({ step: "run-debug-recovery",           priority: 90, autonomous: false, requiresApproval: true });
    if (priorities.factors.some(f => f.domain === "workflow"))   steps.push({ step: "resume-interrupted-workflows", priority: 80, autonomous: false, requiresApproval: true });
    if (priorities.factors.some(f => f.domain === "dependency")) steps.push({ step: "refresh-dependency-graphs",    priority: 65, autonomous: true  });
    if (priorities.factors.some(f => f.domain === "recovery"))   steps.push({ step: "clear-stuck-recovery-paths",   priority: 75, autonomous: false, requiresApproval: true });
    if (steps.length === 0) steps.push({ step: "validate-health", priority: 50, autonomous: true });

    steps.sort((a, b) => b.priority - a.priority);

    return {
        ok:              true,
        steps,
        chains:          chains?.stabilizationSteps || [],
        approvalRequired: steps.some(s => s.requiresApproval),
        explainer:       `Stabilization: ${steps.length} steps — first='${steps[0]?.step}'`,
    };
}

// ── Priority history recording ────────────────────────────────────────────────

function recordPrioritySignal(domain = "", factor = "", { urgency = 50, detail = "" } = {}) {
    const db = _load(); _prune(db);
    db.signals.unshift({ domain, factor, urgency, detail: detail.slice(0, 100), ts: Date.now() });
    _save(db);
    return { ok: true, domain, factor, urgency };
}

function priorityHistory({ limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.signals.slice(0, limit).map(s => ({ domain: s.domain, factor: s.factor, urgency: s.urgency, ageMs: Date.now() - s.ts }));
}

module.exports = { rankEngineeringPriorities, operationalFocusSummary, recommendStabilization, recordPrioritySignal, priorityHistory };
