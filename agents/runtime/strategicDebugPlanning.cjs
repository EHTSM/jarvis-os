"use strict";
/**
 * Phase 676 — Strategic Debug Planning
 *
 * Root-cause prioritization, dependency-aware debugging, validation-first sequencing,
 * recovery-path comparison, replay-linked debug planning.
 * Explainable. Bounded depth. Confidence-aware.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/strategic-debug-plan.json");
const MAX_PLANS   = 50;
const TTL_MS      = 24 * 60 * 60 * 1000;
const MAX_DEPTH   = 6;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { plans: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.plans = (db.plans || []).filter(p => p.ts > cutoff).slice(0, MAX_PLANS);
}

// ── Root-cause prioritization ─────────────────────────────────────────────────

function prioritizeRootCauses(errorContext = "", { trustScore = 65 } = {}) {
    const causes = [];

    const sdi = _tryRequire("./smartDebugIntelligence.cjs");
    if (sdi && errorContext) {
        try {
            const pattern = sdi.identifyPattern(errorContext);
            if (pattern?.pattern) causes.push({ source: "pattern-match", cause: pattern.pattern, confidence: pattern.confidence || 70, autonomous: true });
        } catch {}
        try {
            const roots = sdi.prioritizeRootCauses(errorContext);
            if (roots.ok) causes.push(...roots.causes.slice(0, 3).map(c => ({ source: "debug-intel", ...c })));
        } catch {}
    }

    const omi = _tryRequire("./operationalMemoryIntelligence.cjs");
    if (omi && errorContext) {
        try {
            const recalled = omi.recallSuccessfulRecoveries(errorContext);
            if (recalled?.recoveries?.length > 0) causes.push({ source: "memory", cause: recalled.recoveries[0].trigger, confidence: 65, autonomous: true });
        } catch {}
    }

    causes.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const primary = causes[0] || { source: "default", cause: "unknown", confidence: 40, autonomous: true };

    return {
        ok:         true,
        errorContext: errorContext.slice(0, 100),
        causes:     causes.slice(0, 5),
        primary,
        confidence: primary.confidence,
        explainer:  `Primary cause: '${primary.cause}' (${primary.confidence}% confidence via ${primary.source})`,
    };
}

// ── Dependency-aware debug sequencing ────────────────────────────────────────

function buildDependencyAwareDebugSequence(services = [], errorContext = "") {
    const dae = _tryRequire("./dependencyAwareExecution.cjs");
    let order = services;

    if (dae && services.length > 0) {
        try {
            const deps = {};
            services.forEach(s => { deps[s] = []; });
            dae.registerDependencyGraph(`debug-seq-${Date.now()}`, deps);
        } catch {}
    }

    const steps = order.map((svc, i) => ({
        order: i + 1,
        step:  `diagnose-${svc}`,
        service: svc,
        autonomous: true,
        validationRequired: i > 0,
    }));

    return {
        ok:    true,
        services,
        steps,
        totalSteps: steps.length,
        explainer: `Debug sequence: ${steps.length} services in dependency order`,
    };
}

// ── Validation-first sequencing ───────────────────────────────────────────────

function buildValidationFirstPlan(errorContext = "", { depth = 0, replayId = null } = {}) {
    if (depth > MAX_DEPTH) return { ok: false, error: `Max planning depth (${MAX_DEPTH}) exceeded` };

    const rootCauses = prioritizeRootCauses(errorContext);

    const plan = {
        depth,
        replayId,
        phases: [
            { phase: 1, name: "validate",   steps: ["check-health", "validate-env", "inspect-logs"],   autonomous: true },
            { phase: 2, name: "diagnose",   steps: ["identify-pattern", "correlate-sessions", "check-deps"], autonomous: true },
            { phase: 3, name: "plan",       steps: ["prioritize-causes", "choose-recovery-path"],      autonomous: true  },
            { phase: 4, name: "execute",    steps: ["apply-recovery"],                                 autonomous: false, requiresApproval: true },
            { phase: 5, name: "verify",     steps: ["re-validate-health", "confirm-stable"],           autonomous: true  },
        ],
        primaryCause: rootCauses.primary,
        confidence:   rootCauses.confidence,
        explainer:    `Validation-first debug plan (depth=${depth}): ${5} phases — cause='${rootCauses.primary?.cause}' (${rootCauses.confidence}%)`,
        approvalRequired: true,
    };

    return { ok: true, plan };
}

// ── Recovery path comparison ──────────────────────────────────────────────────

function compareDebugRecoveryPaths(errorContext = "", { sessionId = null } = {}) {
    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    let chosen = null;
    if (arc) { try { chosen = arc.chooseRecoveryPath(errorContext, { sessionId }); } catch {} }

    const ede = _tryRequire("./engineeringDecisionEvolution.cjs");
    let ranked = null;
    if (ede) { try { ranked = ede.rankRecoveryStrategies(errorContext); } catch {} }

    const paths = [];
    if (chosen?.ok) paths.push({ source: "adaptive-coord", path: chosen.chosen?.path, confidence: chosen.chosen?.confidence });
    if (ranked?.ok) paths.push({ source: "decision-evo",   path: ranked.primary?.id,  confidence: ranked.primary?.adjustedScore });

    paths.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    return {
        ok:       true,
        paths,
        primary:  paths[0] || null,
        approvalRequired: chosen?.approvalRequired || false,
        explainer: paths[0] ? `Best recovery: '${paths[0].path}' (${paths[0].confidence}% via ${paths[0].source})` : "No recovery paths available",
    };
}

// ── Replay-linked debug plan ──────────────────────────────────────────────────

function buildReplayLinkedDebugPlan(replayId = "", errorContext = "") {
    if (!replayId) return { ok: false, error: "replayId required" };

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    let replayState = null;
    if (lhec) { try { replayState = lhec.restoreReplayContinuity(replayId); } catch {} }

    const plan = buildValidationFirstPlan(errorContext, { depth: 0, replayId });
    if (!plan.ok) return plan;

    return {
        ok:          true,
        replayId,
        replayState: replayState?.ok ? replayState : null,
        stale:       replayState?.stale || false,
        plan:        plan.plan,
        warning:     replayState?.stale ? "Replay state stale — validate before execution" : null,
    };
}

// ── Save and list plans ───────────────────────────────────────────────────────

function saveDebugPlan(planId, plan, { errorContext = "" } = {}) {
    const db = _load(); _prune(db);
    db.plans.unshift({ planId, plan, errorContext: errorContext.slice(0, 100), ts: Date.now() });
    _save(db);
    return { ok: true, planId };
}

function listDebugPlans({ limit = 10 } = {}) {
    const db = _load(); _prune(db);
    return db.plans.slice(0, limit).map(p => ({ planId: p.planId, errorContext: p.errorContext, ageMs: Date.now() - p.ts }));
}

module.exports = { prioritizeRootCauses, buildDependencyAwareDebugSequence, buildValidationFirstPlan, compareDebugRecoveryPaths, buildReplayLinkedDebugPlan, saveDebugPlan, listDebugPlans };
