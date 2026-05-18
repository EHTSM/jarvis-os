"use strict";
/**
 * debugReport — autonomous failure analysis report generator.
 *
 * Consumes a SuiteResult from evaluator.cjs and produces:
 *   - Structured text report (human-readable terminal output)
 *   - JSON report (machine-parseable for tracking)
 *
 * Both forms include:
 *   preflight status, simulation analysis, root cause graph,
 *   per-step recovery timeline, recommendations, and summary metrics.
 */

const { F } = require("../agents/runtime/recoveryEngine.cjs");

// ── Recommendation engine ─────────────────────────────────────────────

const RECOMMENDATIONS = {
    [F.SYNTAX]: [
        "Lint source files before running the workflow (eslint --fix or prettier).",
        "Consider adding a pre-commit hook to block syntax errors at commit time.",
    ],
    [F.DEPENDENCY]: [
        "Run `npm ci` for deterministic installs from lockfile.",
        "Check if the package name is correct — look for typos or scope mismatches.",
        "Add the missing package to package.json and commit the change.",
    ],
    [F.TIMEOUT]: [
        "Increase NODE_OPTIONS=--max-old-space-size for memory-constrained builds.",
        "Break the task into smaller steps to avoid timeout accumulation.",
        "Check if a downstream service is unresponsive.",
    ],
    [F.PERMISSION]: [
        "Verify file ownership: `ls -la <path>` and `chown` if needed.",
        "Run the process with appropriate privileges or adjust the target path.",
    ],
    [F.MISSING_FILE]: [
        "Verify the path is correct relative to the project root.",
        "Check if a build step that generates this file ran successfully.",
    ],
    [F.PROCESS_FAILURE]: [
        "Check the exit code: 127 = command not found, 126 = not executable.",
        "Verify the required binary is installed and in PATH.",
    ],
    [F.NETWORK]: [
        "Retry with exponential backoff — may be a transient network issue.",
        "Verify the target host is reachable: `curl -I <url>`.",
        "Check proxy settings if running in a corporate environment.",
    ],
    [F.PORT_CONFLICT]: [
        "Use ctx._port (set by recovery) as the actual bind port.",
        "Run `lsof -i :<port>` to identify and kill the occupying process.",
    ],
};

const HUMAN_INTERVENTION_TYPES = new Set([
    F.PERMISSION,
    F.PROCESS_FAILURE,
    F.UNKNOWN,
]);

function needsHumanIntervention(errorType) {
    return HUMAN_INTERVENTION_TYPES.has(errorType);
}

// ── Text report ───────────────────────────────────────────────────────

function generateTextReport(suiteResult) {
    const {
        suiteName, result, preflight, simulation, rootCause, metrics,
    } = suiteResult;

    const hr  = "═".repeat(62);
    const hr2 = "─".repeat(62);
    const ok  = (b) => b ? "✓" : "✗";
    const pad = (s, n) => String(s).padEnd(n);

    const lines = [
        hr,
        "  JARVIS AUTONOMOUS DEBUG REPORT",
        `  Suite   : ${suiteName}`,
        `  Run ID  : ${result?.id || "n/a"}`,
        `  Status  : ${result?.success ? "COMPLETED" : "FAILED"}`,
        `  Health  : ${result?.healthScore ?? "—"}/100`,
        `  Duration: ${result?.durationMs ?? 0}ms`,
        hr,
    ];

    // Preflight
    lines.push("", "  PREFLIGHT");
    if (preflight?.checks?.length) {
        for (const c of preflight.checks) {
            lines.push(`    ${ok(c.ok)} ${c.label}`);
        }
    } else {
        lines.push("    (skipped)");
    }

    // Simulation
    lines.push("", "  PRE-EXECUTION SIMULATION");
    if (simulation) {
        lines.push(
            `    Steps      : ${simulation.steps?.length ?? 0}`,
            `    High-risk  : ${simulation.highRiskSteps?.length > 0 ? simulation.highRiskSteps.join(", ") : "none"}`,
            `    Sandbox req: ${simulation.requiresSandbox ? "yes" : "no"}`,
            `    Summary    : ${simulation.summary}`,
        );
    } else {
        lines.push("    (skipped)");
    }

    // Step timeline
    lines.push("", "  EXECUTION TIMELINE");
    if (result?.stepDetails?.length) {
        for (const s of result.stepDetails) {
            const icon   = s.status === "completed" ? "✓" : s.status === "skipped" ? "⊘" : "✗";
            const recStr = s.recoveries > 0 ? ` (${s.recoveries} recovery)` : "";
            lines.push(`    ${icon} ${pad(s.name, 28)} [${s.status}] ${s.attempts} attempt(s)${recStr}`);
            if (s.error) lines.push(`        error: ${s.error.slice(0, 80)}`);
        }
    }

    // Root cause analysis
    lines.push("", "  ROOT CAUSE ANALYSIS");
    if (rootCause) {
        if (rootCause.primary?.length > 0) {
            lines.push("    Primary failures (root cause):");
            for (const n of rootCause.primary) {
                lines.push(`      • "${n.stepName}" — ${n.errorType}: ${n.errorMsg.slice(0, 70)}`);
            }
        }
        if (rootCause.cascading?.length > 0) {
            lines.push("    Cascading failures (consequence):");
            for (const n of rootCause.cascading) {
                lines.push(`      ↳ "${n.stepName}" caused by "${n.causedBy}" [${n.reason}]`);
            }
        }
        if (rootCause.total === 0) lines.push("    No failures recorded.");
    }

    // Recommendations
    const primaryTypes = (rootCause?.primary || []).map(n => n.errorType);
    const uniqueTypes  = [...new Set(primaryTypes)];
    if (uniqueTypes.length > 0) {
        lines.push("", "  RECOMMENDATIONS");
        for (const type of uniqueTypes) {
            const recs = RECOMMENDATIONS[type] || [];
            if (recs.length > 0) {
                lines.push(`    ${type}:`);
                recs.forEach(r => lines.push(`      → ${r}`));
            }
            if (needsHumanIntervention(type)) {
                lines.push(`      ⚠ HUMAN INTERVENTION likely required for "${type}"`);
            }
        }
    }

    // Metrics
    lines.push("", "  METRICS");
    if (metrics) {
        lines.push(
            `    Completion     : ${result?.success ? "yes" : "no"}`,
            `    Health score   : ${result?.healthScore ?? "—"}/100`,
            `    Steps completed: ${result?.steps?.completed ?? 0}/${result?.steps?.total ?? 0}`,
            `    Total recoveries: ${metrics.totalRecoveries ?? 0}`,
            `    Rollbacks      : ${metrics.rollbacks ?? 0}`,
            `    Human needed   : ${metrics.humanInterventionNeeded ? "yes" : "no"}`,
        );
    }

    lines.push("", hr);
    return lines.join("\n");
}

// ── JSON report ───────────────────────────────────────────────────────

function generateJsonReport(suiteResult) {
    const { suiteName, result, preflight, simulation, rootCause, metrics } = suiteResult;
    const primaryTypes = (rootCause?.primary || []).map(n => n.errorType);

    return {
        suiteName,
        runId:       result?.id,
        status:      result?.success ? "completed" : "failed",
        healthScore: result?.healthScore,
        durationMs:  result?.durationMs,
        preflight: {
            canProceed: preflight?.canProceed,
            passed:     preflight?.passed,
            failed:     preflight?.failed,
            warnings:   preflight?.warnings,
        },
        simulation: {
            requiresSandbox:  simulation?.requiresSandbox,
            highRiskSteps:    simulation?.highRiskSteps,
            totalRiskScore:   simulation?.totalRiskScore,
        },
        rootCause: {
            total:     rootCause?.total,
            primary:   rootCause?.primary,
            cascading: rootCause?.cascading,
        },
        metrics,
        recommendations: [...new Set(primaryTypes)]
            .flatMap(t => RECOMMENDATIONS[t] || []),
        humanInterventionNeeded: primaryTypes.some(t => needsHumanIntervention(t)),
        generatedAt: new Date().toISOString(),
    };
}

module.exports = { generateTextReport, generateJsonReport, needsHumanIntervention, RECOMMENDATIONS };
