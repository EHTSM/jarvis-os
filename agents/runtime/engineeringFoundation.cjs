"use strict";
/**
 * Phase 585 — AI-Assisted Engineering Foundation Complete
 *
 * Single entry-point for the phases 571-585 engineering platform.
 * Aggregates status, runs foundation health check, reports readiness.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const MODULES = {
    patchAssistant:            "./patchAssistant.cjs",
    taskUnderstanding:         "./taskUnderstanding.cjs",
    terminalWorkflows:         "./terminalWorkflows.cjs",
    browserWorkflows:          "./browserWorkflows.cjs",
    executionConfidence:       "./executionConfidence.cjs",
    debugAssistMode:           "./debugAssistMode.cjs",
    deploymentAssist:          "./deploymentAssist.cjs",
    engineeringContextMemory:  "./engineeringContextMemory.cjs",
    productivityChainEngine:   "./productivityChainEngine.cjs",
    dailyEngineeringValidation:"./dailyEngineeringValidation.cjs",
    executionCalmness:         "./executionCalmness.cjs",
    executionTimeline:         "./executionTimeline.cjs",
    resilienceTest:            "./resilienceTest.cjs",
    platformAudit:             "./platformAudit.cjs",
};

/**
 * Check which modules load successfully.
 */
function moduleHealth() {
    const results = {};
    for (const [name, p] of Object.entries(MODULES)) {
        const mod = _tryRequire(p);
        results[name] = mod !== null ? "ok" : "unavailable";
    }
    const available  = Object.values(results).filter(v => v === "ok").length;
    const total      = Object.keys(results).length;
    return { available, total, modules: results, healthy: available === total };
}

/**
 * Foundation health — module load + resilience + platform audit.
 */
function foundationHealth() {
    const health    = moduleHealth();
    const resilTest = _tryRequire("./resilienceTest.cjs");
    const audit     = _tryRequire("./platformAudit.cjs");
    const validation= _tryRequire("./dailyEngineeringValidation.cjs");

    let resilience  = null;
    let auditResult = null;
    let todayStats  = null;

    if (resilTest) { try { resilience  = resilTest.runAll(); } catch {} }
    if (audit)     { try { auditResult = audit.runAudit();  } catch {} }
    if (validation){ try { todayStats  = validation.todayReport(); } catch {} }

    const overallOk = health.healthy
        && (resilience  ? resilience.survivability  >= 75 : true)
        && (auditResult ? auditResult.clean : true);

    return {
        foundation:  "phases-571-585",
        ok:          overallOk,
        modules:     health,
        resilience:  resilience  ? { passed: resilience.passed,  total: resilience.total,  survivability: resilience.survivability }  : null,
        audit:       auditResult ? { passed: auditResult.passed, total: auditResult.total, clean: auditResult.clean } : null,
        today:       todayStats,
        summary:     _buildSummary(health, resilience, auditResult),
    };
}

function _buildSummary(health, resilience, audit) {
    const parts = [
        `Modules: ${health.available}/${health.total}`,
    ];
    if (resilience) parts.push(`Resilience: ${resilience.survivability}%`);
    if (audit)      parts.push(`Audit: ${audit.passed}/${audit.total}`);
    return parts.join(" | ");
}

/**
 * Platform capabilities index.
 */
function capabilities() {
    return [
        { phase: 571, name: "Code Patch Assistance",      module: "patchAssistant",            features: ["propose", "diff-preview", "apply", "rollback"] },
        { phase: 572, name: "Task Understanding",         module: "taskUnderstanding",          features: ["intent-classify", "dependency-map", "urgency"] },
        { phase: 573, name: "Terminal Workflows",         module: "terminalWorkflows",          features: ["command-classify", "sequences", "validation-reminders", "anti-loop"] },
        { phase: 574, name: "Browser Operations",         module: "browserWorkflows",           features: ["extraction-plans", "form-guidance", "replay-safe", "checkpoints"] },
        { phase: 575, name: "Execution Confidence",       module: "executionConfidence",        features: ["patch-score", "deploy-score", "recovery-score", "replay-trust"] },
        { phase: 576, name: "Debug Assist Mode",          module: "debugAssistMode",            features: ["root-cause", "dep-detection", "overlay-suppression", "recovery-plan"] },
        { phase: 577, name: "Deployment Assist",          module: "deploymentAssist",           features: ["preflight", "rollback-recommendation", "dep-integrity", "stale-guard"] },
        { phase: 578, name: "Engineering Context Memory", module: "engineeringContextMemory",   features: ["debug-chains", "recovery-workflows", "deploy-repairs", "outcomes"] },
        { phase: 579, name: "Productivity Chains",        module: "productivityChainEngine",    features: ["debug-startup", "env-bootstrap", "deploy-prep", "stabilization"] },
        { phase: 580, name: "Daily Validation",           module: "dailyEngineeringValidation", features: ["debug-rate", "deploy-rate", "patch-rate", "trust-score"] },
        { phase: 581, name: "Execution Calmness",         module: "executionCalmness",          features: ["warn-dedup", "overlay-dedup", "recovery-collapse", "log-filter"] },
        { phase: 582, name: "Execution Timeline",         module: "executionTimeline",          features: ["record", "search", "replay-thread", "recovery-progression"] },
        { phase: 583, name: "Resilience Tests",           module: "resilienceTest",             features: ["debug-loop", "reconnect-storm", "patch-rollback", "confidence-bounds"] },
        { phase: 584, name: "Platform Audit",             module: "platformAudit",              features: ["patch-safety", "replay-integrity", "runaway-chains", "autonomous-check"] },
        { phase: 585, name: "Foundation Complete",        module: "engineeringFoundation",      features: ["module-health", "foundation-health", "capabilities"] },
    ];
}

module.exports = { foundationHealth, moduleHealth, capabilities };
