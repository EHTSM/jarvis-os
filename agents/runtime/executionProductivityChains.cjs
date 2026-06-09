"use strict";
/**
 * Phase 710 — Execution Productivity Chains
 *
 * Startup environment flows, deployment preparation chains, debugging initialization
 * workflows, dependency recovery sequences, operational stabilization flows.
 * Replayable. Interruption-safe. Operator-controlled.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/exec-productivity-chains.json");
const TTL_MS     = 24 * 60 * 60 * 1000;
const MAX_CHAINS = 30;

const CHAIN_CATALOG = {
    "startup-env": {
        description: "Full startup environment restoration",
        steps: [
            { step: "workspace-health-check",       autonomous: true,  critical: true  },
            { step: "restore-instant-workspace",     autonomous: true,  critical: false },
            { step: "cross-env-summary",             autonomous: true,  critical: false },
            { step: "unstable-env-check",            autonomous: true,  critical: false },
            { step: "replay-discoverability",        autonomous: true,  critical: false },
        ],
    },
    "deployment-prep": {
        description: "Deployment preparation and readiness",
        steps: [
            { step: "env-readiness-scan",            autonomous: true,  critical: true  },
            { step: "trust-check",                   autonomous: true,  critical: true  },
            { step: "rollback-prep",                 autonomous: false, critical: true, requiresApproval: true },
            { step: "phased-sequence-build",         autonomous: false, critical: true, requiresApproval: true },
            { step: "operator-confirm-deploy",       autonomous: false, critical: true, requiresApproval: true },
        ],
    },
    "debug-init": {
        description: "Rapid debugging initialization",
        steps: [
            { step: "runtime-health-check",          autonomous: true,  critical: true  },
            { step: "dep-verification",              autonomous: true,  critical: false },
            { step: "replay-linkage-check",          autonomous: true,  critical: false },
            { step: "validation-first-plan",         autonomous: true,  critical: false },
            { step: "operator-confirm-debug",        autonomous: false, critical: false, requiresApproval: true },
        ],
    },
    "dep-recovery": {
        description: "Dependency recovery sequencing",
        steps: [
            { step: "identify-broken-deps",          autonomous: true,  critical: true  },
            { step: "rank-recovery-sequences",       autonomous: true,  critical: false },
            { step: "terminal-conflict-check",       autonomous: true,  critical: false },
            { step: "operator-approve-recovery",     autonomous: false, critical: true, requiresApproval: true },
            { step: "execute-recovery-plan",         autonomous: false, critical: true, requiresApproval: true },
            { step: "verify-deps-restored",         autonomous: true,  critical: false },
        ],
    },
    "op-stabilization": {
        description: "Operational stabilization flow",
        steps: [
            { step: "detect-unstable-states",        autonomous: true,  critical: true  },
            { step: "rank-stabilization-paths",      autonomous: true,  critical: false },
            { step: "suppress-noise",                autonomous: true,  critical: false },
            { step: "operator-approve-stabilize",    autonomous: false, critical: true, requiresApproval: true },
            { step: "apply-stabilization",           autonomous: false, critical: true, requiresApproval: true },
            { step: "verify-stable",                 autonomous: true,  critical: false },
        ],
    },
};

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { chains: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cut = Date.now() - TTL_MS;
    db.chains = (db.chains || []).filter(c => c.ts > cut).slice(0, MAX_CHAINS);
}

function startProductivityChain(chainType = "startup-env") {
    const catalog = CHAIN_CATALOG[chainType];
    if (!catalog) return { ok: false, error: `Unknown chain: ${chainType}`, available: Object.keys(CHAIN_CATALOG) };

    const chainId = crypto.randomUUID();
    const db      = _load(); _prune(db);

    const chain = {
        chainId, chainType,
        description: catalog.description,
        steps:       catalog.steps.map((s, i) => ({ ...s, index: i, status: "pending", completedAt: null })),
        currentStep: 0,
        status:      "running",
        ts:          Date.now(),
        updatedAt:   Date.now(),
    };

    db.chains.unshift(chain);
    _save(db);
    return { ok: true, chainId, chainType, description: catalog.description, stepCount: chain.steps.length, firstStep: chain.steps[0] };
}

function advanceChain(chainId, { operatorApproved = false, result = null } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.chains.findIndex(c => c.chainId === chainId);
    if (idx === -1) return { ok: false, error: "Chain not found" };

    const chain = db.chains[idx];
    const step  = chain.steps[chain.currentStep];
    if (!step) return { ok: false, error: "No current step" };
    if (!step.autonomous && !operatorApproved) return { ok: false, requiresApproval: true, step: step.step };

    step.status = "completed"; step.completedAt = Date.now(); step.result = result;
    chain.currentStep++; chain.updatedAt = Date.now();
    if (chain.currentStep >= chain.steps.length) chain.status = "completed";

    db.chains[idx] = chain; _save(db);
    const nextStep = chain.steps[chain.currentStep] || null;
    return { ok: true, chainId, completedStep: step.step, nextStep: nextStep?.step || null, status: chain.status };
}

function interruptChain(chainId) {
    const db  = _load(); _prune(db);
    const idx = db.chains.findIndex(c => c.chainId === chainId);
    if (idx === -1) return { ok: false, error: "Chain not found" };
    db.chains[idx].status    = "interrupted";
    db.chains[idx].updatedAt = Date.now();
    _save(db);
    return { ok: true, chainId, resumeFromStep: db.chains[idx].currentStep };
}

function resumeChain(chainId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };
    const db  = _load(); _prune(db);
    const idx = db.chains.findIndex(c => c.chainId === chainId);
    if (idx === -1) return { ok: false, error: "Chain not found" };
    if (db.chains[idx].status !== "interrupted") return { ok: false, error: "Chain not interrupted" };
    db.chains[idx].status    = "running";
    db.chains[idx].updatedAt = Date.now();
    _save(db);
    const currentStep = db.chains[idx].steps[db.chains[idx].currentStep];
    return { ok: true, chainId, resumingFrom: currentStep?.step || null };
}

function listProductivityChains({ status = null, limit = 10 } = {}) {
    const db = _load(); _prune(db);
    return db.chains.filter(c => !status || c.status === status).slice(0, limit)
        .map(c => ({ chainId: c.chainId, chainType: c.chainType, status: c.status, currentStep: c.currentStep, stepCount: c.steps.length }));
}

function catalogProductivityChains() {
    return Object.entries(CHAIN_CATALOG).map(([type, cfg]) => ({
        type, description: cfg.description, stepCount: cfg.steps.length,
        requiresApproval: cfg.steps.some(s => !s.autonomous),
        steps: cfg.steps.map(s => s.step),
    }));
}

module.exports = { startProductivityChain, advanceChain, interruptChain, resumeChain, listProductivityChains, catalogProductivityChains, CHAIN_CATALOG };
