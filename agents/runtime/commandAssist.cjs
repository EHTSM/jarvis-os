"use strict";
/**
 * Phase 498 — Operational Command Assist
 *
 * Safe command suggestions, recovery recommendations, deployment hints,
 * validation reminders, rollback awareness.
 *
 * Prevents: unsafe automation spam, repetitive suggestions, false-confidence execution.
 * All suggestions are approval-level annotated and deduplicated per session.
 */

const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// Tracks recently seen suggestion hashes to prevent repetitive output
// Map<sessionId, Set<hash>> — in-memory only, intentionally non-persistent
const _recentSuggestions = new Map();
const DEDUP_TTL_MS = 10 * 60 * 1000; // 10 min dedup window

function _hash(s) { return crypto.createHash("md5").update(s).digest("hex").slice(0, 8); }

function _isDuplicate(sessionId, key) {
    if (!sessionId) return false;
    if (!_recentSuggestions.has(sessionId)) _recentSuggestions.set(sessionId, new Map());
    const seen = _recentSuggestions.get(sessionId);
    const h    = _hash(key);
    const now  = Date.now();
    const last  = seen.get(h);
    if (last && now - last < DEDUP_TTL_MS) return true;
    seen.set(h, now);
    // Prune stale
    for (const [k, ts] of seen) { if (now - ts > DEDUP_TTL_MS) seen.delete(k); }
    return false;
}

// ── Command catalog ───────────────────────────────────────────────────────────

const SAFE_COMMANDS = [
    { label: "Check runtime pressure",    cmd: "GET /api/runtime/pressure",                  approvalLevel: "SAFE",    category: "monitoring" },
    { label: "View active sessions",      cmd: "GET /api/runtime/sessions",                  approvalLevel: "SAFE",    category: "monitoring" },
    { label: "Dashboard snapshot",        cmd: "GET /api/runtime/dashboard",                 approvalLevel: "SAFE",    category: "monitoring" },
    { label: "Check adapter health",      cmd: "GET /api/runtime/adapters/health",           approvalLevel: "SAFE",    category: "monitoring" },
    { label: "View deployment runs",      cmd: "GET /api/runtime/pipelines/runs",            approvalLevel: "SAFE",    category: "deployment" },
    { label: "SaaS readiness check",      cmd: "GET /api/runtime/saas-readiness",            approvalLevel: "SAFE",    category: "audit"      },
    { label: "Memory health report",      cmd: "GET /api/runtime/memory/health",             approvalLevel: "SAFE",    category: "memory"     },
    { label: "Search recovery workflows", cmd: "GET /api/runtime/search/workflows?q=recover", approvalLevel: "SAFE",   category: "recovery"   },
];

const RECOVERY_COMMANDS = [
    { label: "Backend restore workflow",  cmd: "POST /api/runtime/chains/execute {chain:'recover-backend'}", approvalLevel: "CAUTION", category: "recovery" },
    { label: "Frontend recovery",         cmd: "POST /api/runtime/chains/execute {chain:'recover-frontend-runtime'}", approvalLevel: "CAUTION", category: "recovery" },
    { label: "Dependency repair",         cmd: "POST /api/runtime/chains/execute {chain:'dependency-resolution'}", approvalLevel: "CAUTION", category: "recovery" },
    { label: "Git safe update",           cmd: "POST /api/runtime/chains/execute {chain:'git-safe-update'}",  approvalLevel: "CAUTION", category: "deployment" },
    { label: "Switch to safe-mode",       cmd: "POST /api/runtime/modes/activate {mode:'safe-mode'}",         approvalLevel: "CAUTION", category: "safety" },
];

const DEPLOYMENT_COMMANDS = [
    { label: "Environment warnings check", cmd: "GET /api/runtime/deployments/environment",       approvalLevel: "SAFE",    category: "deployment" },
    { label: "Preflight: standard-deploy", cmd: "GET /api/runtime/deployments/preflight/standard-deploy", approvalLevel: "SAFE", category: "deployment" },
    { label: "Create deployment run",      cmd: "POST /api/runtime/pipelines/runs {pipeline:'standard-deploy',approved:true}", approvalLevel: "CRITICAL", category: "deployment" },
    { label: "Rollback preview",           cmd: "GET /api/runtime/deployments/rollback-preview/:runId", approvalLevel: "SAFE", category: "deployment" },
];

// ── Contextual suggestion engine ──────────────────────────────────────────────

/**
 * Suggest commands based on context signals.
 * @param {{ sessionId?, goal?, pressureLevel?, recentFailures?, lastChain?, state? }} context
 */
function suggestCommands(context = {}) {
    const { sessionId, goal = "", pressureLevel = "nominal", recentFailures = 0, lastChain = "", state = "active" } = context;

    const suggestions = [];
    const goalLower   = goal.toLowerCase();

    const add = (cmd, reason, priority = 50) => {
        if (_isDuplicate(sessionId, cmd.label)) return;
        suggestions.push({ ...cmd, reason, priority });
    };

    // Always available: monitoring
    add(SAFE_COMMANDS[2], "Dashboard gives full runtime overview", 40);

    // Pressure-based
    if (pressureLevel === "high" || pressureLevel === "critical") {
        add(SAFE_COMMANDS[0], `Runtime pressure is ${pressureLevel} — check score`, 90);
        add(RECOVERY_COMMANDS[4], "High pressure: safe-mode reduces execution rate", 80);
    }

    // Failure-based
    if (recentFailures >= 3) {
        add(SAFE_COMMANDS[7], "Multiple failures — search for recovery workflow", 85);
        add(RECOVERY_COMMANDS[0], "3+ failures: backend restore may help", 75);
    } else if (recentFailures >= 1) {
        add(SAFE_COMMANDS[7], "Recent failure — check recovery workflows", 70);
    }

    // Goal-based
    if (goalLower.includes("deploy") || lastChain.includes("deploy")) {
        add(DEPLOYMENT_COMMANDS[0], "Pre-deployment environment check", 80);
        add(DEPLOYMENT_COMMANDS[1], "Run preflight before launching pipeline", 75);
        add(DEPLOYMENT_COMMANDS[3], "Know what rollback would do first", 60);
    }

    if (goalLower.includes("frontend") || goalLower.includes("nginx")) {
        add(RECOVERY_COMMANDS[1], "Frontend recovery workflow available", 75);
    }

    if (goalLower.includes("backend") || goalLower.includes("api") || goalLower.includes("crash")) {
        add(RECOVERY_COMMANDS[0], "Backend restore workflow available", 75);
    }

    if (goalLower.includes("git") || goalLower.includes("pull") || goalLower.includes("update")) {
        add(RECOVERY_COMMANDS[3], "Git safe update with conflict detection", 70);
    }

    if (goalLower.includes("depend") || goalLower.includes("module") || goalLower.includes("npm")) {
        add(RECOVERY_COMMANDS[2], "Dependency repair workflow available", 75);
    }

    // Stalled/blocked sessions
    if (state === "blocked") {
        add(SAFE_COMMANDS[4], "Check deployment runs — may have approval blocker", 80);
        add(SAFE_COMMANDS[3], "Check adapter health — may be root cause", 80);
    }

    return suggestions
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 5)
        .map(({ priority, ...s }) => s);
}

/**
 * Validate a proposed command before execution.
 * Returns { safe, approvalLevel, warnings }.
 */
function validateCommand(cmd) {
    const safetyGuard = _tryRequire("./operatorSafetyGuard.cjs");
    const warnings    = [];

    // Check against safety guard
    if (safetyGuard && cmd) {
        const result = safetyGuard.check(cmd);
        if (result && result.level === "CRITICAL") {
            warnings.push(`Safety guard: CRITICAL command — requires explicit approval`);
        }
    }

    // Detect CRITICAL API patterns
    const criticalPatterns = [/\/approve/, /\/rollback/, /\/prune/, /safe-mode/, /deploy.*approved:true/];
    const isCritical       = criticalPatterns.some(p => p.test(cmd));
    if (isCritical) warnings.push("This command modifies runtime state — verify before executing");

    return {
        cmd,
        safe:          warnings.length === 0,
        approvalLevel: isCritical ? "CRITICAL" : "CAUTION",
        warnings,
    };
}

/**
 * Deployment hints: sequenced pre-deploy checklist.
 */
function deploymentHints(pipelineName = "standard-deploy") {
    const deployUX = _tryRequire("./deploymentOperatorUX.cjs");
    if (!deployUX) return { hints: [], ready: false };

    const env      = deployUX.environmentWarnings();
    const preflight = deployUX.preflightSummary(pipelineName);
    const hints    = [];

    if (!env.clear) {
        env.warnings.forEach(w => hints.push({ step: "environment", message: w.message, severity: w.severity }));
    }

    if (preflight.ok) {
        if (preflight.confidence < 80) {
            preflight.warnings.forEach(w => hints.push({ step: "preflight", message: w, severity: "warning" }));
        }
    } else {
        preflight.blockers.forEach(b => hints.push({ step: "preflight", message: b, severity: "blocker" }));
    }

    if (hints.length === 0) hints.push({ step: "ready", message: `${pipelineName} is ready to launch`, severity: "info" });

    return {
        hints,
        ready:      env.clear && preflight.ok && preflight.confidence >= 60,
        confidence: preflight.ok ? preflight.confidence : 0,
    };
}

/**
 * Rollback awareness: should operator consider rollback right now?
 */
function rollbackAwareness() {
    const pipeline = _tryRequire("./deploymentPipeline.cjs");
    if (!pipeline) return { shouldConsider: false };

    const runs    = pipeline.listRuns({ limit: 5 });
    const failed  = runs.filter(r => r.state === "failed" && !r.rollbackTriggered);
    const running = runs.filter(r => r.state === "running");

    return {
        shouldConsider:   failed.length > 0,
        failedRuns:       failed.map(r => ({ id: r.id, pipeline: r.pipeline })),
        runningRuns:      running.map(r => ({ id: r.id, pipeline: r.pipeline })),
        recommendation:   failed.length > 0
            ? `${failed.length} failed deployment(s) without rollback — consider rollback-preview`
            : "No failed deployments requiring rollback",
    };
}

module.exports = { suggestCommands, validateCommand, deploymentHints, rollbackAwareness, SAFE_COMMANDS, RECOVERY_COMMANDS };
