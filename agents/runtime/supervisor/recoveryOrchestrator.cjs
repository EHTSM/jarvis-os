"use strict";
/**
 * recoveryOrchestrator — unified recovery strategy selection and coordinated execution.
 *
 * Recovery strategies: rollback | repair | reroute | sandbox | retry
 *
 * selectRecoveryStrategy(incident, context)      → StrategySelection
 * executeRecovery(strategyName, context)         → RecoveryResult
 * coordinateRecovery(incidents)                  → CoordinatedResult
 * scoreRecoveryOutcome(attempts)                 → RecoveryScore
 * getRecoveryHistory()                           → RecoveryRecord[]
 * reset()
 */

const RECOVERY_STRATEGIES = ["rollback", "repair", "reroute", "sandbox", "retry"];

// Decision matrix: incident type → ordered preference list
const STRATEGY_MATRIX = {
    security_violation:     ["sandbox",  "rollback"                    ],
    cascade_failure:        ["reroute",  "sandbox",  "rollback"        ],
    execution_failure:      ["retry",    "reroute",  "repair", "sandbox"],
    resource_exhaustion:    ["repair",   "reroute",  "retry"            ],
    performance_degradation:["reroute",  "retry",    "repair"           ],
    unknown:                ["retry",    "sandbox",  "reroute"          ],
};

const STRATEGY_LIMITS = {
    rollback: { maxRetries: 1 },
    repair:   { maxRetries: 2 },
    reroute:  { maxRetries: 3 },
    sandbox:  { maxRetries: 2 },
    retry:    { maxRetries: 3 },
};

let _history = [];
let _counter = 0;

// ── selectRecoveryStrategy ────────────────────────────────────────────

function selectRecoveryStrategy(incident = {}, context = {}) {
    const type       = incident.type     ?? "unknown";
    const severity   = incident.severity ?? "P3";
    const priorFails = context.priorFailedStrategies ?? [];

    const preferred  = STRATEGY_MATRIX[type] ?? STRATEGY_MATRIX.unknown;
    // Skip strategies that already failed in this recovery sequence
    const candidates = preferred.filter(s => !priorFails.includes(s));
    const selected   = candidates[0] ?? "sandbox";  // fallback to sandbox

    const escalated = priorFails.length >= 2;
    const maxRetries = STRATEGY_LIMITS[selected]?.maxRetries ?? 3;

    return {
        selected,
        type,
        severity,
        escalated,
        maxRetries,
        alternatives: candidates.slice(1),
        exhausted:    candidates.length === 0,
    };
}

// ── executeRecovery ───────────────────────────────────────────────────

function executeRecovery(strategyName, context = {}) {
    const recoveryId = `rec-${++_counter}`;
    if (!RECOVERY_STRATEGIES.includes(strategyName)) {
        return { executed: false, reason: "unknown_strategy", strategyName };
    }

    const steps = _buildSteps(strategyName, context);
    const failed = context.simulateFailure === true;

    const record = {
        recoveryId,
        strategy:  strategyName,
        steps,
        success:   !failed,
        context:   { ...context },
        executedAt: new Date().toISOString(),
    };
    _history.push(record);

    return {
        executed:  true,
        recoveryId,
        strategy:  strategyName,
        success:   !failed,
        steps,
    };
}

function _buildSteps(strategy, context) {
    const stepMap = {
        rollback: [
            { action: "snapshot_current_state" },
            { action: "revert_to_last_checkpoint" },
            { action: "validate_state_integrity"  },
        ],
        repair: [
            { action: "diagnose_root_cause"      },
            { action: "apply_targeted_fix"       },
            { action: "re_validate_execution"    },
        ],
        reroute: [
            { action: "identify_healthy_routes"  },
            { action: "redirect_traffic"         },
            { action: "confirm_reroute_success"  },
        ],
        sandbox: [
            { action: "isolate_execution_scope"  },
            { action: "run_in_sandbox_mode"      },
            { action: "monitor_sandbox_outcome"  },
        ],
        retry: [
            { action: "backoff_wait"             },
            { action: "retry_execution"          },
            { action: "verify_retry_outcome"     },
        ],
    };
    return stepMap[strategy] ?? [];
}

// ── coordinateRecovery ────────────────────────────────────────────────

function coordinateRecovery(incidents = []) {
    if (incidents.length === 0) return { coordinated: false, reason: "no_incidents" };

    const results = incidents.map(inc => ({
        incidentId: inc.incidentId ?? `auto-${Date.now()}`,
        selection:  selectRecoveryStrategy(inc),
    }));

    // Unify: if any incident needs sandbox, apply globally
    const needsSandbox = results.some(r => r.selection.selected === "sandbox");
    const strategies   = [...new Set(results.map(r => r.selection.selected))];

    return {
        coordinated:     true,
        incidentCount:   incidents.length,
        strategies,
        globalSandbox:   needsSandbox,
        results,
    };
}

// ── scoreRecoveryOutcome ──────────────────────────────────────────────

function scoreRecoveryOutcome(attempts = []) {
    if (attempts.length === 0) return { score: 0, grade: "F", reason: "no_attempts" };

    const successful  = attempts.filter(a => a.success !== false).length;
    const successRate = successful / attempts.length;
    const avgAttempts = attempts.reduce((s, a) => s + (a.attemptNumber ?? 1), 0) / attempts.length;

    // Penalize for needing many attempts
    const raw   = Math.max(0, successRate * 90 - (avgAttempts - 1) * 10);
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    return { score, grade, successRate: +successRate.toFixed(3), avgAttempts: +avgAttempts.toFixed(2), total: attempts.length };
}

// ── getRecoveryHistory / reset ────────────────────────────────────────

function getRecoveryHistory() { return [..._history]; }

function reset() {
    _history = [];
    _counter = 0;
}

module.exports = {
    RECOVERY_STRATEGIES, STRATEGY_MATRIX, STRATEGY_LIMITS,
    selectRecoveryStrategy, executeRecovery, coordinateRecovery,
    scoreRecoveryOutcome, getRecoveryHistory, reset,
};
