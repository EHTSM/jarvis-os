"use strict";
/**
 * deploymentSimulator — safe deployment pipeline as composable workflow steps.
 * All steps are side-effect-free by default; real behaviour is injected via callbacks.
 *
 * preflightStep(checks[])        — run { name, fn } checks; fail if any fail
 * buildStep(buildFn?)            — call buildFn(ctx) or simulate
 * testStep(testFn?)              — call testFn(ctx); throw if result.failed > 0
 * rolloutStep(rolloutFn?)        — call rolloutFn(ctx); rollback sets rolloutState=rolled-back
 * healthCheckStep(checkFn?)      — call checkFn(ctx); throw if !result.healthy
 * buildDeploymentWorkflow(config) → composed steps array
 */

function preflightStep(checks = []) {
    return {
        name: "deployment-preflight",
        execute: async (ctx) => {
            const results = [];
            for (const check of checks) {
                try {
                    const ok = await Promise.resolve(check.fn(ctx));
                    results.push({ name: check.name, passed: !!ok });
                } catch (e) {
                    results.push({ name: check.name, passed: false, error: e.message });
                }
            }
            ctx.preflightResults = results;
            const failed = results.filter(r => !r.passed);
            if (failed.length > 0) {
                throw new Error(`preflight failed: ${failed.map(f => f.name).join(", ")}`);
            }
            return { passed: results.length, failed: 0 };
        },
    };
}

function buildStep(buildFn) {
    return {
        name: "deployment-build",
        execute: async (ctx) => {
            const result = await Promise.resolve(
                typeof buildFn === "function" ? buildFn(ctx) : { built: true, simulated: true }
            );
            ctx.buildOutput = result;
            return result;
        },
        rollback: async (ctx) => { ctx.buildOutput = null; },
    };
}

function testStep(testFn) {
    return {
        name: "deployment-test",
        execute: async (ctx) => {
            const result = await Promise.resolve(
                typeof testFn === "function"
                    ? testFn(ctx)
                    : { passed: 1, failed: 0, simulated: true }
            );
            if ((result.failed || 0) > 0) {
                throw new Error(`${result.failed} test(s) failed`);
            }
            ctx.testResults = result;
            return result;
        },
    };
}

function rolloutStep(rolloutFn) {
    return {
        name: "deployment-rollout",
        execute: async (ctx) => {
            ctx.rolloutState  = "in-progress";
            const result = await Promise.resolve(
                typeof rolloutFn === "function"
                    ? rolloutFn(ctx)
                    : { deployed: true, simulated: true }
            );
            ctx.rolloutState  = "complete";
            ctx.rolloutOutput = result;
            return result;
        },
        rollback: async (ctx) => {
            ctx.rolloutState  = "rolled-back";
            ctx.rolloutOutput = null;
        },
    };
}

function healthCheckStep(checkFn) {
    return {
        name: "deployment-health-check",
        execute: async (ctx) => {
            const result = await Promise.resolve(
                typeof checkFn === "function"
                    ? checkFn(ctx)
                    : { healthy: true, simulated: true }
            );
            if (!result.healthy) throw new Error("post-deployment health check failed");
            ctx.healthCheckResult = result;
            return result;
        },
    };
}

function buildDeploymentWorkflow(config = {}) {
    const steps = [];
    if (config.checks?.length)    steps.push(preflightStep(config.checks));
    if (config.build  !== false)  steps.push(buildStep(config.buildFn));
    if (config.test   !== false)  steps.push(testStep(config.testFn));
    if (config.rollout !== false) steps.push(rolloutStep(config.rolloutFn));
    if (config.healthCheck !== false) steps.push(healthCheckStep(config.healthCheckFn));
    return steps;
}

module.exports = {
    preflightStep, buildStep, testStep, rolloutStep, healthCheckStep,
    buildDeploymentWorkflow,
};
