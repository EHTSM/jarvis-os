"use strict";
/**
 * strategyRouter — map a selected strategy to an execution routing configuration.
 *
 * routeConfig(strategy)   → { checkpoints, isolation, rollbackRequired, dryRun, stageByStage, description }
 * route(strategy, plan)   → { mode, config, stepsToExecute, stepsToSimulate, preflightActions, checkpointMode, isolatedMode }
 * ROUTE_CONFIGS
 * STRATEGIES
 */

const STRATEGIES = ["direct", "staged", "dry_run", "sandbox", "rollback_first"];

const ROUTE_CONFIGS = {
    direct: {
        checkpoints:      false,
        isolation:        false,
        rollbackRequired: false,
        dryRun:           false,
        stageByStage:     false,
        description:      "Execute directly without checkpoints",
    },
    staged: {
        checkpoints:      true,
        isolation:        false,
        rollbackRequired: false,
        dryRun:           false,
        stageByStage:     true,
        description:      "Execute stage-by-stage with checkpoints after each step",
    },
    dry_run: {
        checkpoints:      false,
        isolation:        false,
        rollbackRequired: false,
        dryRun:           true,
        stageByStage:     false,
        description:      "Simulate plan without executing any steps",
    },
    sandbox: {
        checkpoints:      false,
        isolation:        true,
        rollbackRequired: false,
        dryRun:           false,
        stageByStage:     false,
        description:      "Execute in isolated sandbox environment",
    },
    rollback_first: {
        checkpoints:      true,
        isolation:        false,
        rollbackRequired: true,
        dryRun:           false,
        stageByStage:     true,
        description:      "Pre-load rollback snapshot, then execute with checkpoints",
    },
};

function routeConfig(strategy) {
    return ROUTE_CONFIGS[strategy] ?? ROUTE_CONFIGS.direct;
}

function route(strategy, plan = {}) {
    const config = routeConfig(strategy);
    const steps  = plan.executionOrder ?? [];

    return {
        mode:             strategy,
        config,
        stepsToExecute:   config.dryRun ? [] : steps,
        stepsToSimulate:  config.dryRun ? steps : [],
        preflightActions: _preflight(strategy),
        checkpointMode:   config.checkpoints,
        isolatedMode:     config.isolation,
    };
}

function _preflight(strategy) {
    const actions = [];
    if (strategy === "rollback_first") actions.push({ action: "create_rollback_snapshot", priority: 1 });
    if (strategy === "sandbox")        actions.push({ action: "setup_sandbox_environment", priority: 1 });
    if (strategy === "staged")         actions.push({ action: "setup_checkpoints",         priority: 1 });
    return actions;
}

module.exports = { route, routeConfig, ROUTE_CONFIGS, STRATEGIES };
