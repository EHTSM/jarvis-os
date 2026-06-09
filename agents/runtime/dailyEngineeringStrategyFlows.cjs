"use strict";
/**
 * Phase 684 — Daily Engineering Strategy Flows
 *
 * Startup planning, deployment preparation plans, debugging-strategy generation,
 * dependency verification planning, runtime-health coordination.
 * Replayable. Interruption-safe. Operator-controlled.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/daily-eng-strategy-flows.json");
const MAX_FLOWS  = 30;
const TTL_MS     = 24 * 60 * 60 * 1000;

const FLOW_CATALOG = {
    "startup-plan": {
        description: "Morning startup: health, deps, context restore, priority triage",
        steps: [
            { step: "run-health-checks",    autonomous: true,  critical: true  },
            { step: "check-dep-readiness",  autonomous: true,  critical: true  },
            { step: "restore-context",      autonomous: true,  critical: false },
            { step: "triage-priorities",    autonomous: true,  critical: false },
            { step: "review-interrupted",   autonomous: true,  critical: false },
        ],
    },
    "deployment-prep": {
        description: "Pre-deployment: readiness, risk, dep checks, operator approval",
        steps: [
            { step: "deployment-readiness", autonomous: true,  critical: true  },
            { step: "risk-assessment",      autonomous: true,  critical: true  },
            { step: "dep-verification",     autonomous: true,  critical: true  },
            { step: "canary-planning",      autonomous: true,  critical: false },
            { step: "operator-approval",    autonomous: false, critical: true, requiresApproval: true },
        ],
    },
    "debug-strategy": {
        description: "Debug flow: identify pattern, prioritize causes, plan recovery",
        steps: [
            { step: "identify-error-pattern", autonomous: true,  critical: true  },
            { step: "correlate-sessions",     autonomous: true,  critical: false },
            { step: "prioritize-root-causes", autonomous: true,  critical: true  },
            { step: "build-recovery-plan",    autonomous: true,  critical: false },
            { step: "operator-confirm",       autonomous: false, critical: true, requiresApproval: true },
        ],
    },
    "dep-verification": {
        description: "Dependency audit: load graphs, validate services, confirm order",
        steps: [
            { step: "load-dep-graphs",       autonomous: true,  critical: true  },
            { step: "check-service-health",  autonomous: true,  critical: true  },
            { step: "validate-exec-order",   autonomous: true,  critical: false },
            { step: "report-stale-chains",   autonomous: true,  critical: false },
        ],
    },
    "runtime-health": {
        description: "Runtime health check: state, pressure, resilience, calmness",
        steps: [
            { step: "execution-state",       autonomous: true,  critical: true  },
            { step: "platform-resilience",   autonomous: true,  critical: true  },
            { step: "calmness-score",        autonomous: true,  critical: false },
            { step: "risk-summary",          autonomous: true,  critical: false },
            { step: "survivability-check",   autonomous: true,  critical: false },
        ],
    },
};

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { flows: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.flows = (db.flows || []).filter(f => f.ts > cutoff).slice(0, MAX_FLOWS);
}

// ── Flow management ───────────────────────────────────────────────────────────

function startFlow(flowType = "startup-plan") {
    const catalog = FLOW_CATALOG[flowType];
    if (!catalog) return { ok: false, error: `Unknown flow: ${flowType}`, available: Object.keys(FLOW_CATALOG) };

    const flowId = crypto.randomUUID();
    const db     = _load(); _prune(db);

    const flow = {
        flowId,
        flowType,
        description: catalog.description,
        steps: catalog.steps.map((s, i) => ({ ...s, index: i, status: "pending", startedAt: null, completedAt: null })),
        currentStep: 0,
        status:      "running",
        ts:          Date.now(),
        updatedAt:   Date.now(),
    };

    db.flows.unshift(flow);
    _save(db);

    return { ok: true, flowId, flowType, description: catalog.description, stepCount: flow.steps.length, firstStep: flow.steps[0] };
}

function advanceFlowStep(flowId, { operatorApproved = false, result = null } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.flows.findIndex(f => f.flowId === flowId);
    if (idx === -1) return { ok: false, error: "Flow not found" };

    const flow = db.flows[idx];
    const step = flow.steps[flow.currentStep];
    if (!step) return { ok: false, error: "No current step" };

    if (!step.autonomous && !operatorApproved) return { ok: false, requiresApproval: true, step: step.step };

    step.status      = "completed";
    step.completedAt = Date.now();
    step.result      = result;
    flow.currentStep++;
    flow.updatedAt = Date.now();

    if (flow.currentStep >= flow.steps.length) flow.status = "completed";

    db.flows[idx] = flow;
    _save(db);

    const nextStep = flow.steps[flow.currentStep] || null;
    return { ok: true, flowId, completedStep: step.step, nextStep: nextStep?.step || null, status: flow.status };
}

function interruptFlow(flowId) {
    const db  = _load(); _prune(db);
    const idx = db.flows.findIndex(f => f.flowId === flowId);
    if (idx === -1) return { ok: false, error: "Flow not found" };
    db.flows[idx].status    = "interrupted";
    db.flows[idx].updatedAt = Date.now();
    _save(db);
    return { ok: true, flowId, resumeFromStep: db.flows[idx].currentStep };
}

function resumeFlow(flowId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };
    const db  = _load(); _prune(db);
    const idx = db.flows.findIndex(f => f.flowId === flowId);
    if (idx === -1) return { ok: false, error: "Flow not found" };
    if (db.flows[idx].status !== "interrupted") return { ok: false, error: "Flow is not interrupted" };
    db.flows[idx].status    = "running";
    db.flows[idx].updatedAt = Date.now();
    _save(db);
    const currentStep = db.flows[idx].steps[db.flows[idx].currentStep];
    return { ok: true, flowId, resumingFrom: currentStep?.step || null };
}

function listFlows({ status = null, limit = 10 } = {}) {
    const db = _load(); _prune(db);
    return db.flows
        .filter(f => !status || f.status === status)
        .slice(0, limit)
        .map(f => ({ flowId: f.flowId, flowType: f.flowType, status: f.status, currentStep: f.currentStep, stepCount: f.steps.length }));
}

// ── Live flow orchestration ───────────────────────────────────────────────────

function runStartupPlan() {
    const results = [];

    const dec = _tryRequire("./dailyEngineeringCoordination.cjs");
    if (dec) { try { const r = dec.runStartupOrchestration(); results.push({ step: "startup-orch", ok: r.ok, detail: r.summary }); } catch {} }

    const epi = _tryRequire("./engineeringPriorityIntelligence.cjs");
    if (epi) { try { const r = epi.operationalFocusSummary(); results.push({ step: "priority-triage", ok: true, detail: r.summary }); } catch {} }

    const ecc = _tryRequire("./engineeringContextCoordination.cjs");
    if (ecc) { try { const r = ecc.reconnectInterruptedChains(); results.push({ step: "interrupted-review", ok: true, detail: r.detail }); } catch {} }

    const allOk = results.every(r => r.ok !== false);
    return { ok: allOk, results, summary: `Startup plan: ${results.filter(r => r.ok !== false).length}/${results.length} checks passed` };
}

function catalogFlows() {
    return Object.entries(FLOW_CATALOG).map(([type, cfg]) => ({
        type,
        description: cfg.description,
        stepCount:   cfg.steps.length,
        requiresApproval: cfg.steps.some(s => !s.autonomous),
        steps: cfg.steps.map(s => s.step),
    }));
}

module.exports = { startFlow, advanceFlowStep, interruptFlow, resumeFlow, listFlows, runStartupPlan, catalogFlows };
