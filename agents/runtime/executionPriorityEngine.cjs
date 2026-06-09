"use strict";
/**
 * Phase 661 — Execution Priority Engine
 *
 * Intelligently prioritizes workflows based on runtime health, deployment risk,
 * workflow trust, recovery urgency, dependency instability, replay survivability.
 * Explainable. Bounded. Operator-visible.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/execution-priority.json");
const MAX_HISTORY = 100;
const TTL_MS = 24 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { decisions: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.decisions = (db.decisions || []).filter(d => d.ts > cutoff).slice(0, MAX_HISTORY);
}

// ── Priority factors ──────────────────────────────────────────────────────────

function gatherPriorityFactors() {
    const factors = {};

    // Runtime health pressure
    const apr = _tryRequire("./advancedPlatformResilience.cjs");
    if (apr) {
        try {
            const wd = apr.watchdogSummary();
            factors.pressureScore = wd.pressureScore;
            factors.pressureLevel = wd.pressureLevel;
        } catch {}
    }

    // Deployment risk
    const eri = _tryRequire("./executionRiskIntelligence.cjs");
    if (eri) {
        try {
            const risk = eri.riskSummary({ windowMs: 24 * 60 * 60 * 1000 });
            factors.deploymentRisk = risk.overall;
            factors.maxRiskScore   = risk.maxScore;
        } catch {}
    }

    // Workflow trust
    const otl = _tryRequire("./operationalTrustLayer.cjs");
    if (otl) {
        try {
            const score = otl.getTrustScore();
            factors.trustScore = score.score;
        } catch {}
    }

    // Recovery urgency — check for repeated failures
    const sdi = _tryRequire("./smartDebugIntelligence.cjs");
    if (sdi) {
        try {
            const repeated = sdi.detectRepeatedFailures({ windowMs: 60 * 60 * 1000, minCount: 2 });
            factors.repeatedFailures = repeated.count;
        } catch {}
    }

    // Continuity health
    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    if (lhec) {
        try {
            const health = lhec.continuityHealth();
            factors.reconnectStorm = health.storm;
            factors.staleSessions  = health.staleSessions;
        } catch {}
    }

    return factors;
}

// ── Workflow catalog for prioritization ───────────────────────────────────────

const WORKFLOW_PRIORITY_MAP = {
    "critical-recovery":     { basePriority: 100, triggers: ["pressureLevel:critical", "repeatedFailures:>0", "reconnectStorm:true"] },
    "runtime-stabilize":     { basePriority: 90,  triggers: ["pressureLevel:stressed", "repeatedFailures:>0"] },
    "dep-verify":            { basePriority: 80,  triggers: ["deploymentRisk:high", "deploymentRisk:moderate"] },
    "debug-init":            { basePriority: 75,  triggers: ["repeatedFailures:>0"] },
    "deploy-readiness":      { basePriority: 70,  triggers: ["deploymentRisk:moderate"] },
    "startup-check":         { basePriority: 60,  triggers: [] },
    "health-scan":           { basePriority: 50,  triggers: [] },
    "runtime-health":        { basePriority: 45,  triggers: [] },
};

function evaluateTrigger(trigger, factors) {
    const [field, op, val] = trigger.includes(":>") ? [trigger.split(":>")[0], ">", trigger.split(":>")[1]] : trigger.split(":");
    const fval = factors[field];
    if (fval === undefined) return false;
    if (op === ">") return Number(fval) > Number(val);
    return String(fval) === val;
}

function prioritizeWorkflows(context = {}) {
    const factors = { ...gatherPriorityFactors(), ...context };
    const db = _load(); _prune(db);

    const prioritized = Object.entries(WORKFLOW_PRIORITY_MAP).map(([name, def]) => {
        const triggeredBy = def.triggers.filter(t => evaluateTrigger(t, factors));
        const urgencyBoost = triggeredBy.length * 10;
        const trustPenalty = factors.trustScore && factors.trustScore < 50 && name.includes("deploy") ? -15 : 0;
        const finalScore   = def.basePriority + urgencyBoost + trustPenalty;

        return { name, priority: finalScore, triggeredBy, basePriority: def.basePriority };
    }).sort((a, b) => b.priority - a.priority);

    const top = prioritized[0];
    db.decisions.unshift({ top: top.name, priority: top.priority, factors, ts: Date.now() });
    _save(db);

    return {
        ok:           true,
        top,
        ranked:       prioritized,
        factors,
        explainer:    `Top priority: '${top.name}' (score ${top.priority}) — triggers: ${top.triggeredBy.join(", ") || "base priority"}`,
    };
}

// ── Urgency check ─────────────────────────────────────────────────────────────

function checkRecoveryUrgency() {
    const factors = gatherPriorityFactors();
    const urgent  = [];

    if (factors.pressureLevel === "critical")  urgent.push({ signal: "critical-pressure",    severity: "critical", action: "run critical-recovery immediately" });
    if (factors.reconnectStorm)                urgent.push({ signal: "reconnect-storm",       severity: "critical", action: "stabilize continuity layer" });
    if (factors.repeatedFailures > 2)          urgent.push({ signal: "repeated-failures",     severity: "warning",  action: "run debug-init flow" });
    if (factors.deploymentRisk === "high")     urgent.push({ signal: "high-deployment-risk",  severity: "warning",  action: "run dep-verify before any deploy" });

    return {
        ok:       urgent.filter(u => u.severity === "critical").length === 0,
        urgent,
        critical: urgent.filter(u => u.severity === "critical").length,
        factors,
    };
}

function priorityHistory({ limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.decisions.slice(0, limit);
}

module.exports = { gatherPriorityFactors, prioritizeWorkflows, checkRecoveryUrgency, priorityHistory, WORKFLOW_PRIORITY_MAP };
