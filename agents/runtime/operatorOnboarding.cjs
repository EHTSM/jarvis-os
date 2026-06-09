"use strict";
/**
 * Phase 481 — First-Run Operator Experience
 *
 * Guides a new operator through: health check, adapter verification,
 * workspace setup, profile initialization, recovery-mode intro,
 * and execution safety explanation.
 *
 * State persisted to data/onboarding-state.json.
 * Onboarding is idempotent — can be re-run any time.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/onboarding-state.json");

const STEPS = [
    "health_check",
    "adapter_verification",
    "workspace_setup",
    "profile_init",
    "recovery_intro",
    "safety_explanation",
];

function _loadState() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { completed: [], operatorId: null, startedAt: null, finishedAt: null }; }
}

function _saveState(s) {
    try { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); } catch {}
}

// ── Step implementations ──────────────────────────────────────────────────────

function _stepHealthCheck() {
    const pressure = _tryRequire("./runtimePressureMonitor.cjs");
    const modes    = _tryRequire("./runtimeModes.cjs");

    const p = pressure ? pressure.computePressure() : { score: 0, level: "unknown" };
    const m = modes    ? modes.getActiveMode()      : { name: "unknown" };

    const ok = p.level !== "critical";
    return {
        step: "health_check",
        ok,
        detail: `Runtime pressure: ${p.level} (score=${p.score}), mode: ${m.name}`,
        guidance: ok
            ? "Runtime is healthy. Safe to proceed."
            : "Runtime pressure is critical. Consider switching to safe-mode before operating.",
    };
}

function _stepAdapterVerification() {
    const bridge = _tryRequire("./adapterContextBridge.cjs");

    let adapterSummary = "adapter bridge unavailable";
    let ok = false;

    if (bridge) {
        try {
            const snap = bridge.snapshot ? bridge.snapshot() : null;
            if (snap) {
                const total    = snap.adapters ? snap.adapters.length : 0;
                const degraded = snap.adapters ? snap.adapters.filter(a => a.degraded).length : 0;
                ok = degraded === 0;
                adapterSummary = `${total} adapter(s), ${degraded} degraded`;
            } else {
                ok = true;
                adapterSummary = "adapter bridge active";
            }
        } catch {
            ok = true;
            adapterSummary = "adapter bridge loaded";
        }
    }

    return {
        step: "adapter_verification",
        ok,
        detail: adapterSummary,
        guidance: ok
            ? "Adapters are operational."
            : "Some adapters are degraded. Run recovery chain before heavy workflows.",
    };
}

function _stepWorkspaceSetup(operatorId) {
    const workspace = _tryRequire("./projectWorkspace.cjs");
    if (!workspace) return { step: "workspace_setup", ok: false, detail: "workspace module unavailable", guidance: "Check installation." };

    const active = workspace.getActiveWorkspace();
    const list   = workspace.listWorkspaces();

    return {
        step: "workspace_setup",
        ok: true,
        detail: `Active workspace: "${active.name}" (${list.length} workspace(s) available)`,
        guidance: `You are on workspace "${active.name}". Use /api/runtime/workspaces to create project-specific workspaces.`,
        activeWorkspace: active.name,
        workspaces: list.map(w => w.name),
    };
}

function _stepProfileInit() {
    const profiles = _tryRequire("./engineeringProfile.cjs");
    if (!profiles) return { step: "profile_init", ok: false, detail: "profile module unavailable", guidance: "Check installation." };

    const active = profiles.getActiveProfile();
    const list   = profiles.listProfiles();

    return {
        step: "profile_init",
        ok: true,
        detail: `Active profile: "${active.name}" (${list.length} profile(s) available)`,
        guidance: `Profile "${active.name}" sets your runtime presets, adapter config, and workflow collection. Switch via /api/runtime/profiles/activate.`,
        activeProfile: active.name,
    };
}

function _stepRecoveryIntro() {
    const flows   = _tryRequire("./deploymentRecoveryFlows.cjs");
    const chains  = _tryRequire("./executionChainPlanner.cjs");

    const flowCount  = flows  ? (flows.listFlows  ? flows.listFlows().length  : 0) : 0;
    const chainCount = chains ? (chains.listChains ? chains.listChains().length : 0) : 0;

    return {
        step: "recovery_intro",
        ok: true,
        detail: `${flowCount} recovery flow(s), ${chainCount} execution chain(s) available`,
        guidance: [
            "JARVIS recovery runs autonomously when the runtime detects degradation.",
            "Recovery chains are replayable and auditable.",
            "Use safe-mode during critical incidents: POST /api/runtime/modes/activate {mode:'safe-mode'}.",
            "Recovery history is stored in data/recovery-memory.json.",
        ].join(" "),
        recoveryChainsAvailable: chainCount,
        recoveryFlowsAvailable:  flowCount,
    };
}

function _stepSafetyExplanation() {
    return {
        step: "safety_explanation",
        ok: true,
        detail: "Execution safety model explained",
        guidance: [
            "SAFE commands run without confirmation.",
            "CAUTION commands require operator awareness.",
            "CRITICAL commands require explicit approval before pipeline execution.",
            "Destructive commands (rm -rf, DROP TABLE, etc.) are blocked by safetyGuard.",
            "Runtime pressure gates halt autonomous continuation at 'high' and 'critical' levels.",
            "All execution is auditable via /api/runtime/forensics.",
        ].join(" "),
        approvalLevels: {
            SAFE:     "Runs freely",
            CAUTION:  "Operator awareness required",
            CRITICAL: "Explicit approval required — use approveRun()",
        },
        blockedPatterns: ["rm -rf", "DROP TABLE", "format", "mkfs", "> /dev/"],
    };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Run the full onboarding sequence. Returns each step result. */
async function runOnboarding(operatorId = "default") {
    const state = _loadState();
    if (!state.startedAt) {
        state.startedAt  = Date.now();
        state.operatorId = operatorId;
    }

    const results = [];

    const stepFns = {
        health_check:        _stepHealthCheck,
        adapter_verification: _stepAdapterVerification,
        workspace_setup:     () => _stepWorkspaceSetup(operatorId),
        profile_init:        _stepProfileInit,
        recovery_intro:      _stepRecoveryIntro,
        safety_explanation:  _stepSafetyExplanation,
    };

    for (const stepName of STEPS) {
        const result = stepFns[stepName]();
        result.alreadyCompleted = state.completed.includes(stepName);
        results.push(result);
        if (!state.completed.includes(stepName)) {
            state.completed.push(stepName);
        }
    }

    const allOk = results.every(r => r.ok);
    if (allOk && !state.finishedAt) state.finishedAt = Date.now();
    _saveState(state);

    return {
        operatorId,
        complete:    state.completed.length === STEPS.length,
        allPassed:   allOk,
        steps:       results,
        completedAt: state.finishedAt ? new Date(state.finishedAt).toISOString() : null,
        summary:     `Onboarding ${allOk ? "COMPLETE" : "PARTIAL"}: ${results.filter(r => r.ok).length}/${STEPS.length} steps passed`,
    };
}

/** Get current onboarding state without running steps. */
function getOnboardingState() {
    const state = _loadState();
    return {
        operatorId:  state.operatorId,
        completed:   state.completed,
        remaining:   STEPS.filter(s => !state.completed.includes(s)),
        isComplete:  state.completed.length === STEPS.length,
        startedAt:   state.startedAt  ? new Date(state.startedAt).toISOString()  : null,
        finishedAt:  state.finishedAt ? new Date(state.finishedAt).toISOString() : null,
        steps:       STEPS,
    };
}

/** Reset onboarding (for re-run or new operator). */
function resetOnboarding() {
    _saveState({ completed: [], operatorId: null, startedAt: null, finishedAt: null });
    return { reset: true };
}

module.exports = { runOnboarding, getOnboardingState, resetOnboarding, STEPS };
