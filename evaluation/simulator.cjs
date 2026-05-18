"use strict";
/**
 * simulator — pre-execution analysis and dry-run for workflow steps.
 *
 * Two-pass operation:
 *   1. Static analysis  — inspect step.execute source for risky patterns
 *   2. Dynamic simulate — run step.simulate(ctx) if defined (optional contract)
 *
 * Risk levels (computed from static analysis):
 *   high   — deletes files, force-kills processes, or modifies system dirs
 *   medium — installs packages, runs child processes with network access
 *   low    — reads/writes local project files only
 *
 * Steps opt into rich simulation by exporting a `simulate` method:
 *   step.simulate = async (ctx) => { willModify: [...], estimatedMs: n }
 */

// ── Static analysis ───────────────────────────────────────────────────

const RISK_PATTERNS = {
    high:   [/rmSync|rm\s+-rf|unlinkSync|fs\.rm\b|kill\s+-9|process\.exit/],
    medium: [/npm\s+install|yarn\s+add|spawnSync|execSync|spawn\b|exec\b/],
    low:    [/writeFileSync|writeFile\b|mkdirSync/],
};

function analyzeStep(step) {
    const src = typeof step.execute === "function" ? step.execute.toString() : "";

    const deletes  = RISK_PATTERNS.high[0].test(src);
    const spawns   = RISK_PATTERNS.medium[0].test(src);
    const installs = /npm\s+install|yarn\s+add/.test(src);
    const writes   = RISK_PATTERNS.low[0].test(src);
    const reads    = /readFileSync|readFile\b/.test(src);
    const netOps   = /fetch\b|axios\b|http\.get|https\.get|request\b/.test(src);

    let riskScore = 0;
    if (deletes)  riskScore += 4;
    if (installs) riskScore += 2;
    if (spawns)   riskScore += 2;
    if (netOps)   riskScore += 1;
    if (writes)   riskScore += 1;

    const riskLevel = riskScore >= 4 ? "high" : riskScore >= 2 ? "medium" : "low";

    return {
        stepName:            step.name,
        reads,
        writes,
        spawns,
        deletes,
        installs,
        netOps,
        riskScore,
        riskLevel,
        hasSimulate:         typeof step.simulate === "function",
        isOptional:          step.optional === true,
        maxRetries:          step.maxRetries,
    };
}

// ── Dynamic simulation ────────────────────────────────────────────────

async function simulateWorkflow(steps, ctx = {}) {
    const simCtx = { ...ctx, _simulationMode: true };
    const results = [];

    for (const step of steps) {
        const analysis = analyzeStep(step);
        let prediction = null;

        if (typeof step.simulate === "function") {
            try {
                prediction = await step.simulate(simCtx);
            } catch (e) {
                prediction = { error: e.message, simFailed: true };
            }
        }

        results.push({ ...analysis, prediction });
    }

    const highRisk    = results.filter(r => r.riskLevel === "high");
    const mediumRisk  = results.filter(r => r.riskLevel === "medium");
    const writeSteps  = results.filter(r => r.writes || r.deletes);
    const networkSteps = results.filter(r => r.netOps);

    return {
        steps:            results,
        highRiskSteps:    highRisk.map(r => r.stepName),
        mediumRiskSteps:  mediumRisk.map(r => r.stepName),
        requiresSandbox:  highRisk.length > 0,
        totalRiskScore:   results.reduce((s, r) => s + r.riskScore, 0),
        writeCount:       writeSteps.length,
        networkCount:     networkSteps.length,
        summary: [
            `${results.length} step(s)`,
            highRisk.length   > 0 ? `${highRisk.length} high-risk`   : null,
            mediumRisk.length > 0 ? `${mediumRisk.length} medium-risk` : null,
            writeSteps.length > 0 ? `${writeSteps.length} write`     : null,
        ].filter(Boolean).join(", "),
    };
}

// ── Destructive action guard ──────────────────────────────────────────

/**
 * Wraps a step's execute function so it no-ops in simulation mode.
 * Use when a step cannot provide its own simulate() but should be safe to skip.
 */
function guardDestructive(step) {
    const original = step.execute;
    return {
        ...step,
        execute: async (ctx, ...args) => {
            if (ctx._simulationMode) return { simulated: true, stepName: step.name };
            return original(ctx, ...args);
        },
    };
}

module.exports = { analyzeStep, simulateWorkflow, guardDestructive };
