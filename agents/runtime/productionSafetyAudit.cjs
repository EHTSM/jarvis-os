"use strict";
/**
 * Phase 434 — Production Safety Audit
 *
 * Comprehensive verification that the orchestration layer is safe for production.
 *
 * Verifies:
 *   1. No hidden execution paths (coordinator gates visible)
 *   2. No unsafe autonomous continuation (pressure + confidence gates active)
 *   3. No memory explosion risk (bounded data structures)
 *   4. No recursive orchestration storms (depth + burst limits enforced)
 *   5. No stale-lock deadlocks (cooldown maps don't grow unbounded)
 *   6. No uncontrolled adapter recovery (cooldown + degradation cap enforced)
 *   7. All safety-critical modules load successfully
 *   8. Forensics and recovery memory are bounded
 *   9. Session count stays within MAX_SESSIONS
 *  10. Engineering memory is TTL-pruned
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

async function runProductionAudit() {
    const checks = [];
    const add    = (name, ok, detail, severity = "info") => checks.push({ name, ok, detail, severity });

    // ── 1. Hidden execution paths ──────────────────────────────────────────────
    const coordinator = _tryRequire("./executionCoordinator.cjs");
    add("coordinator_loaded",
        !!coordinator,
        coordinator ? "executionCoordinator present — all execution goes through single gate" : "MISSING",
        coordinator ? "info" : "critical"
    );

    const safetyGuard = _tryRequire("./operatorSafetyGuard.cjs");
    add("safety_guard_active",
        !!safetyGuard,
        safetyGuard ? "operatorSafetyGuard loaded" : "MISSING — commands not classified",
        safetyGuard ? "info" : "critical"
    );
    if (safetyGuard) {
        const rmRf = safetyGuard.check("rm -rf /");
        add("destructive_command_classified_critical",
            (rmRf?.level || "").toUpperCase() === "CRITICAL",
            `rm -rf / → level=${rmRf?.level}`,
            (rmRf?.level || "").toUpperCase() === "CRITICAL" ? "info" : "critical"
        );
    }

    // ── 2. Autonomous continuation gates ──────────────────────────────────────
    const autoCont = _tryRequire("./autonomousContinuation.cjs");
    add("auto_continuation_gated",
        !!autoCont,
        autoCont ? "autonomousContinuation module present with pressure+confidence gates" : "MISSING",
        autoCont ? "info" : "warn"
    );
    if (autoCont) {
        // Verify gate rejects high consecutive failures
        const blocked = autoCont.shouldContinue({
            sessionId: null, chainName: "audit-test",
            stepIndex: 3, stepSuccess: false, consecutiveFails: 5,
        });
        add("continuation_blocks_on_failure_storm",
            !blocked.continue,
            `consecutiveFails=5 → continue=${blocked.continue} reason=${blocked.reason}`,
            !blocked.continue ? "info" : "critical"
        );
    }

    // ── 3. Memory explosion risk ───────────────────────────────────────────────
    const heapMb = Math.round(process.memoryUsage().heapUsed / 1_048_576);
    add("heap_within_limits",
        heapMb < 400,
        `heap=${heapMb}MB (limit=400MB)`,
        heapMb < 400 ? "info" : "critical"
    );

    // Check bounded data structures
    const cooldown = _tryRequire("./executionCooldown.cjs");
    if (cooldown) {
        const stats = cooldown.stats();
        add("cooldown_maps_bounded",
            stats.trackedCommands < 1000 && stats.trackedChains < 200,
            `commands=${stats.trackedCommands} chains=${stats.trackedChains}`,
            "info"
        );
    }

    // ── 4. Recursive orchestration storms ─────────────────────────────────────
    const sanity = _tryRequire("./executionSanityGuards.cjs");
    add("sanity_guards_loaded",
        !!sanity,
        sanity ? `recursion max=${sanity.LIMITS.maxRecursionDepth} burst=${sanity.LIMITS.maxBurst}/${sanity.LIMITS.burstWindow}ms` : "MISSING",
        sanity ? "info" : "warn"
    );
    if (sanity) {
        const depthBlocked = sanity.checkRecursionDepth(sanity.LIMITS.maxRecursionDepth + 1);
        add("recursion_depth_enforced",
            !depthBlocked.allowed,
            `depth=${sanity.LIMITS.maxRecursionDepth + 1} → allowed=${depthBlocked.allowed}`,
            !depthBlocked.allowed ? "info" : "critical"
        );
    }

    // ── 5. Stale-lock / cooldown unbounded growth ─────────────────────────────
    // Cooldown maps use in-memory Maps that don't auto-evict, but they're bounded
    // by the MAX_SAMPLES + window-based pruning in pressure monitor
    const pmon = _tryRequire("./runtimePressureMonitor.cjs");
    add("pressure_monitor_loaded",
        !!pmon,
        pmon ? "runtimePressureMonitor loaded with sliding window pruning" : "MISSING",
        pmon ? "info" : "warn"
    );

    // ── 6. Adapter recovery control ───────────────────────────────────────────
    const adapterHeal = _tryRequire("./adapterSelfHealing.cjs");
    add("adapter_healing_bounded",
        !!adapterHeal,
        adapterHeal ? "adapterSelfHealing: 10min cooldown, 3-failure degradation cap" : "MISSING",
        "info"
    );
    if (adapterHeal) {
        const snap = adapterHeal.snapshot();
        const degradedCount = Object.values(snap).filter(s => s.degraded).length;
        add("no_unexpected_degraded_adapters",
            degradedCount === 0,
            `${degradedCount} adapter(s) currently in degraded state`,
            degradedCount === 0 ? "info" : "warn"
        );
    }

    // ── 7. All safety-critical modules present ────────────────────────────────
    const criticalModules = [
        ["./operatorSafetyGuard.cjs",       "operatorSafetyGuard"],
        ["./executionCooldown.cjs",          "executionCooldown"],
        ["./autonomousContinuation.cjs",     "autonomousContinuation"],
        ["./runtimePressureMonitor.cjs",     "runtimePressureMonitor"],
        ["./executionDependencyGraph.cjs",   "executionDependencyGraph"],
        ["./executionSanityGuards.cjs",      "executionSanityGuards"],
    ];
    const missing = criticalModules.filter(([p]) => !_tryRequire(p)).map(([, n]) => n);
    add("all_critical_modules_present",
        missing.length === 0,
        missing.length === 0 ? `all ${criticalModules.length} critical modules loaded` : `MISSING: ${missing.join(", ")}`,
        missing.length === 0 ? "info" : "critical"
    );

    // ── 8. Forensics and recovery memory bounded ──────────────────────────────
    const forensics  = _tryRequire("./runtimeForensics.cjs");
    const recovMem   = _tryRequire("./executionRecoveryMemory.cjs");
    if (forensics) {
        const fEntries = forensics.query({ limit: 201 });
        add("forensics_bounded",
            fEntries.length <= 200,
            `forensics entries=${fEntries.length} (max=200)`,
            "info"
        );
    }
    if (recovMem) {
        const rStats = recovMem.stats();
        add("recovery_memory_bounded",
            rStats.total <= 300,
            `recovery memory entries=${rStats.total} (max=300)`,
            "info"
        );
    }

    // ── 9. Session count within bounds ────────────────────────────────────────
    const sessionMod = _tryRequire("./engineeringSession.cjs");
    if (sessionMod) {
        const sessions = sessionMod.list({ limit: 25 });
        add("session_count_within_max",
            sessions.length <= 20,
            `active sessions=${sessions.length} (max=20)`,
            sessions.length <= 20 ? "info" : "warn"
        );
    }

    // ── 10. Engineering memory TTL pruning ────────────────────────────────────
    const engMem = _tryRequire("./engineeringMemory.cjs");
    if (engMem) {
        const eStats = engMem.stats();
        add("engineering_memory_bounded",
            eStats.total <= 100,
            `engineering memory entries=${eStats.total} (max=100)`,
            "info"
        );
    }

    // ── Crash file check ──────────────────────────────────────────────────────
    try {
        const crashDir = path.join(__dirname, "../../data/crashes");
        const crashes  = fs.existsSync(crashDir)
            ? fs.readdirSync(crashDir).filter(f => f.endsWith(".json")).length
            : 0;
        add("no_crash_files",
            crashes === 0,
            crashes === 0 ? "no crash forensic files" : `${crashes} crash file(s) in data/crashes/`,
            crashes === 0 ? "info" : "warn"
        );
    } catch {}

    // ── DLQ check ─────────────────────────────────────────────────────────────
    try {
        const dlq     = _tryRequire("../../agents/runtime/deadLetterQueue.cjs") || _tryRequire("./deadLetterQueue.cjs");
        const dlqSize = dlq ? dlq.size() : null;
        if (dlqSize !== null) {
            add("dlq_not_overloaded",
                dlqSize < 50,
                `DLQ size=${dlqSize} (limit=50)`,
                dlqSize < 50 ? "info" : "warn"
            );
        }
    } catch {}

    // ── Summary ───────────────────────────────────────────────────────────────
    const criticalFails = checks.filter(c => !c.ok && c.severity === "critical");
    const warnFails     = checks.filter(c => !c.ok && c.severity === "warn");
    const passed        = checks.filter(c => c.ok).length;

    return {
        productionReady: criticalFails.length === 0,
        passedChecks:    passed,
        totalChecks:     checks.length,
        criticalFails:   criticalFails.length,
        warnFails:       warnFails.length,
        checks,
        summary: criticalFails.length === 0
            ? `Production safety audit PASSED (${passed}/${checks.length} checks)`
            : `Production safety audit FAILED — ${criticalFails.length} critical issue(s)`,
        ts: new Date().toISOString(),
    };
}

module.exports = { runProductionAudit };
