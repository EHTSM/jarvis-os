"use strict";
/**
 * recoveryCoordinator — multi-step recovery tree orchestration with quorum logic.
 *
 * buildRecoveryTree(incident)                  → RecoveryTree
 * executeStep(treeId, stepId)                  → StepResult
 * advanceTree(treeId)                          → AdvanceResult
 * checkQuorum(action, signals)                 → QuorumResult
 * getTreeStatus(treeId)                        → TreeStatus | null
 * getCoordinatorStats()                        → Stats
 * reset()
 */

const STEP_TYPES         = ["retry", "rollback", "stabilize", "escalate", "verify", "sandbox"];
const HIGH_RISK_ACTIONS  = new Set(["rollback", "escalate", "sandbox"]);
const QUORUM_THRESHOLD   = 0.6;   // fraction of signals that must agree
const MIN_QUORUM_SIGNALS = 2;     // minimum signals required for quorum

// Recovery templates keyed by incident type
const RECOVERY_TEMPLATES = {
    execution_failure: [
        { type: "retry",      maxAttempts: 2, riskLevel: "low"    },
        { type: "stabilize",  maxAttempts: 1, riskLevel: "low"    },
        { type: "rollback",   maxAttempts: 1, riskLevel: "high"   },
        { type: "escalate",   maxAttempts: 1, riskLevel: "high"   },
    ],
    memory_pressure: [
        { type: "stabilize",  maxAttempts: 2, riskLevel: "low"    },
        { type: "sandbox",    maxAttempts: 1, riskLevel: "medium" },
        { type: "rollback",   maxAttempts: 1, riskLevel: "high"   },
    ],
    cascade_failure: [
        { type: "stabilize",  maxAttempts: 1, riskLevel: "low"    },
        { type: "rollback",   maxAttempts: 2, riskLevel: "high"   },
        { type: "escalate",   maxAttempts: 1, riskLevel: "high"   },
    ],
    latency_spike: [
        { type: "retry",      maxAttempts: 3, riskLevel: "low"    },
        { type: "stabilize",  maxAttempts: 1, riskLevel: "low"    },
        { type: "rollback",   maxAttempts: 1, riskLevel: "high"   },
    ],
    default: [
        { type: "retry",      maxAttempts: 2, riskLevel: "low"    },
        { type: "rollback",   maxAttempts: 1, riskLevel: "high"   },
        { type: "escalate",   maxAttempts: 1, riskLevel: "high"   },
    ],
};

let _trees   = new Map();
let _counter = 0;

// ── buildRecoveryTree ─────────────────────────────────────────────────

function buildRecoveryTree(incident = {}) {
    const treeId       = incident.treeId      ?? `tree-${++_counter}`;
    const incidentType = incident.type        ?? "default";
    const template     = RECOVERY_TEMPLATES[incidentType] ?? RECOVERY_TEMPLATES.default;

    const steps = template.map((tmpl, idx) => ({
        stepId:      `${treeId}-step-${idx + 1}`,
        type:        tmpl.type,
        riskLevel:   tmpl.riskLevel,
        maxAttempts: tmpl.maxAttempts,
        attempts:    0,
        status:      "pending",   // pending | in_progress | completed | failed | skipped
        result:      null,
        requiresQuorum: HIGH_RISK_ACTIONS.has(tmpl.type),
    }));

    const tree = {
        treeId,
        incidentType,
        incidentId:  incident.incidentId ?? null,
        steps,
        cursor:      0,           // index of current step
        status:      "ready",     // ready | in_progress | completed | failed | escalated
        startedAt:   new Date().toISOString(),
        completedAt: null,
        reasoning:   `Recovery tree built for ${incidentType} incident; ${steps.length} steps planned`,
        telemetryBasis: { incidentType, stepCount: steps.length },
    };

    _trees.set(treeId, tree);
    return {
        treeId,
        incidentType,
        stepCount: steps.length,
        steps: steps.map(s => ({ stepId: s.stepId, type: s.type, riskLevel: s.riskLevel, requiresQuorum: s.requiresQuorum })),
        status: "ready",
        reasoning: tree.reasoning,
        confidenceLevel: "high",
    };
}

// ── executeStep ───────────────────────────────────────────────────────

function executeStep(treeId, stepId, opts = {}) {
    const tree = _trees.get(treeId);
    if (!tree)                             return { executed: false, reason: "tree_not_found" };
    if (tree.status === "completed")       return { executed: false, reason: "tree_completed" };
    if (tree.status === "failed")          return { executed: false, reason: "tree_failed" };

    const step = tree.steps.find(s => s.stepId === stepId);
    if (!step)                             return { executed: false, reason: "step_not_found" };
    if (step.status === "completed")       return { executed: false, reason: "step_already_completed" };

    // Quorum check for high-risk steps
    if (step.requiresQuorum && !opts.quorumApproved) {
        return {
            executed:        false,
            reason:          "quorum_required",
            stepId,
            stepType:        step.type,
            reasoning:       `Step "${step.type}" is high-risk and requires quorum approval before execution`,
            confidenceLevel: "high",
        };
    }

    step.attempts++;
    step.status   = "in_progress";
    tree.status   = "in_progress";

    // Simulate execution outcome: provided via opts, default success
    const success  = opts.success  ?? true;
    const resultData = opts.result ?? null;

    if (success) {
        step.status = "completed";
        step.result = resultData ?? { outcome: "success" };
    } else {
        if (step.attempts >= step.maxAttempts) {
            step.status = "failed";
            step.result = resultData ?? { outcome: "failed", attempts: step.attempts };
        } else {
            step.status = "pending";  // retry eligible
        }
    }

    // Advance tree cursor if this step succeeded
    if (step.status === "completed") {
        _advanceCursor(tree);
    }

    // Check if tree is done
    if (tree.steps.every(s => s.status === "completed" || s.status === "skipped")) {
        tree.status      = "completed";
        tree.completedAt = new Date().toISOString();
    } else if (tree.steps.some(s => s.status === "failed")) {
        const hasEscalate = tree.steps.find(s => s.type === "escalate" && s.status === "pending");
        tree.status = hasEscalate ? "in_progress" : "failed";
    }

    return {
        executed:    true,
        treeId,
        stepId,
        stepType:    step.type,
        success,
        stepStatus:  step.status,
        treeStatus:  tree.status,
        attempts:    step.attempts,
        reasoning:   `Step "${step.type}" ${success ? "completed successfully" : `failed (attempt ${step.attempts}/${step.maxAttempts})`}`,
        confidenceLevel: success ? "high" : "moderate",
    };
}

function _advanceCursor(tree) {
    while (tree.cursor < tree.steps.length && tree.steps[tree.cursor].status === "completed") {
        tree.cursor++;
    }
}

// ── advanceTree ───────────────────────────────────────────────────────

function advanceTree(treeId) {
    const tree = _trees.get(treeId);
    if (!tree) return { advanced: false, reason: "tree_not_found" };

    const currentStep = tree.steps[tree.cursor];
    if (!currentStep) {
        tree.status = "completed";
        return { advanced: false, reason: "no_more_steps", treeStatus: "completed" };
    }

    return {
        advanced:    true,
        treeId,
        nextStepId:  currentStep.stepId,
        nextStepType: currentStep.type,
        cursor:      tree.cursor,
        requiresQuorum: currentStep.requiresQuorum,
        treeStatus:  tree.status,
    };
}

// ── checkQuorum ───────────────────────────────────────────────────────

function checkQuorum(action, signals = []) {
    if (signals.length === 0) {
        return { quorum: false, reason: "no_signals", action };
    }
    if (signals.length < MIN_QUORUM_SIGNALS) {
        return {
            quorum:    false,
            reason:    `insufficient_signals: ${signals.length} < ${MIN_QUORUM_SIGNALS} required`,
            action,
            signalCount: signals.length,
            required:    MIN_QUORUM_SIGNALS,
        };
    }

    // Signals: [{ source, recommendation, confidence }]
    const recommending = signals.filter(s =>
        s.recommendation === action && (s.confidence ?? 0) >= 0.5
    ).length;

    const agreementRate = recommending / signals.length;
    const avgConfidence = signals.reduce((s, sig) => s + (sig.confidence ?? 0), 0) / signals.length;
    const quorumMet     = agreementRate >= QUORUM_THRESHOLD && avgConfidence >= 0.6;

    return {
        quorum:          quorumMet,
        action,
        agreementRate:   +agreementRate.toFixed(3),
        avgConfidence:   +avgConfidence.toFixed(3),
        signalCount:     signals.length,
        recommending,
        required:        Math.ceil(signals.length * QUORUM_THRESHOLD),
        reasoning:       quorumMet
            ? `Quorum achieved: ${recommending}/${signals.length} signals agree (${(agreementRate*100).toFixed(0)}%) with avg confidence ${avgConfidence.toFixed(2)}`
            : `Quorum not met: only ${recommending}/${signals.length} signals agree (need ${(QUORUM_THRESHOLD*100).toFixed(0)}% agreement)`,
        confidenceLevel: quorumMet ? "high" : "low",
    };
}

// ── getTreeStatus ─────────────────────────────────────────────────────

function getTreeStatus(treeId) {
    const tree = _trees.get(treeId);
    if (!tree) return null;
    const completed = tree.steps.filter(s => s.status === "completed").length;
    const failed    = tree.steps.filter(s => s.status === "failed").length;
    return {
        treeId:       tree.treeId,
        incidentType: tree.incidentType,
        status:       tree.status,
        progress:     `${completed}/${tree.steps.length}`,
        completedSteps: completed,
        failedSteps:    failed,
        totalSteps:     tree.steps.length,
        cursor:         tree.cursor,
    };
}

// ── getCoordinatorStats ───────────────────────────────────────────────

function getCoordinatorStats() {
    const trees = [..._trees.values()];
    const byStatus = {};
    for (const t of trees) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    return {
        totalTrees:       trees.length,
        byStatus,
        completedTrees:   trees.filter(t => t.status === "completed").length,
        failedTrees:      trees.filter(t => t.status === "failed").length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _trees   = new Map();
    _counter = 0;
}

module.exports = {
    STEP_TYPES, HIGH_RISK_ACTIONS, QUORUM_THRESHOLD, MIN_QUORUM_SIGNALS,
    RECOVERY_TEMPLATES,
    buildRecoveryTree, executeStep, advanceTree, checkQuorum,
    getTreeStatus, getCoordinatorStats, reset,
};
