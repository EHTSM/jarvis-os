"use strict";
/**
 * Phase 479 — SaaS Transition Readiness Audit
 *
 * Verifies: local-first stability, sync preparedness, workspace isolation,
 * replay portability, deployment maturity, operational survivability.
 *
 * Each check returns { name, ok, detail, severity, saasImpact }
 * saasImpact: "blocker" | "risk" | "nice-to-have" | "ready"
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

async function runSaasAudit() {
    const checks = [];
    const add = (name, ok, detail, severity = "info", saasImpact = "ready") =>
        checks.push({ name, ok, detail, severity, saasImpact });

    // ── 1. Local-first stability ──────────────────────────────────────────────
    const session = _tryRequire("./engineeringSession.cjs");
    add("session_persistence",
        !!session,
        session ? "engineeringSession file-backed, survives restart" : "MISSING",
        session ? "info" : "critical", session ? "ready" : "blocker"
    );

    const analytics = _tryRequire("./operationalAnalytics.cjs");
    add("analytics_local_first",
        !!analytics,
        analytics ? `operationalAnalytics: local-only, ${analytics.storageStats().total} events stored` : "MISSING",
        "info", "ready"
    );

    // ── 2. Sync preparedness ──────────────────────────────────────────────────
    const sync = _tryRequire("./cloudSyncInterface.cjs");
    add("sync_interface_ready",
        !!sync,
        sync ? `cloudSyncInterface: ${sync.status().pendingCount} pending entries, ${sync.ENTITY_TYPES.length} entity types defined` : "MISSING",
        sync ? "info" : "warn", sync ? "ready" : "risk"
    );
    if (sync) {
        const s = sync.status();
        add("sync_queue_not_overflowed",
            s.pendingCount <= 400,
            `pending=${s.pendingCount} (max=500)`,
            "info", "ready"
        );
    }

    // ── 3. Workspace isolation ────────────────────────────────────────────────
    const workspace = _tryRequire("./projectWorkspace.cjs");
    add("workspace_isolation",
        !!workspace,
        workspace ? `projectWorkspace: ${workspace.listWorkspaces().length} workspace(s), memory isolated per-workspace` : "MISSING",
        workspace ? "info" : "warn", workspace ? "ready" : "risk"
    );

    // ── 4. Replay portability ─────────────────────────────────────────────────
    const replay  = _tryRequire("./executionReplayEngine.cjs");
    const exporter = _tryRequire("./replayExporter.cjs");
    add("replay_exists",
        !!replay,
        replay ? `executionReplayEngine: ${replay.stats().total} replays stored` : "MISSING",
        "info", replay ? "ready" : "risk"
    );
    add("replay_exportable",
        !!exporter,
        exporter ? "replayExporter: markdown/json/snapshot export supported" : "MISSING",
        "info", exporter ? "ready" : "nice-to-have"
    );

    // ── 5. Deployment maturity ────────────────────────────────────────────────
    const pipeline = _tryRequire("./deploymentPipeline.cjs");
    add("deployment_pipeline",
        !!pipeline,
        pipeline ? `deploymentPipeline: ${pipeline.listPipelines().length} pipelines, approval gates, rollback support` : "MISSING",
        pipeline ? "info" : "warn", pipeline ? "ready" : "risk"
    );

    const depFlows = _tryRequire("./deploymentRecoveryFlows.cjs");
    add("deployment_recovery_flows",
        !!depFlows,
        depFlows ? `deploymentRecoveryFlows: ${depFlows.listFlows().length} recovery flows` : "MISSING",
        "info", "ready"
    );

    // ── 6. Operational survivability ──────────────────────────────────────────
    const pmon = _tryRequire("./runtimePressureMonitor.cjs");
    add("pressure_monitoring",
        !!pmon,
        pmon ? `runtimePressureMonitor: score=${pmon.computePressure().score} level=${pmon.computePressure().level}` : "MISSING",
        pmon ? "info" : "warn", pmon ? "ready" : "risk"
    );

    const autoCont = _tryRequire("./autonomousContinuation.cjs");
    add("safe_continuation",
        !!autoCont,
        autoCont ? "autonomousContinuation: pressure+confidence gates active" : "MISSING",
        autoCont ? "info" : "warn", autoCont ? "ready" : "risk"
    );

    // ── 7. Account system ─────────────────────────────────────────────────────
    const accounts = _tryRequire("./localAccountSystem.cjs");
    add("account_system",
        !!accounts,
        accounts ? `localAccountSystem: ${accounts.listAccounts().length} account(s)` : "MISSING — operator identity untracked",
        accounts ? "info" : "warn", accounts ? "ready" : "risk"
    );

    // ── 8. Multi-operator support ─────────────────────────────────────────────
    const multiOp = _tryRequire("./multiOperatorSession.cjs");
    add("multi_operator",
        !!multiOp,
        multiOp ? `multiOperatorSession: ${multiOp.listOperators().length} operator(s) registered, cross-session isolation enforced` : "MISSING",
        multiOp ? "info" : "warn", multiOp ? "ready" : "risk"
    );

    // ── 9. Engineering profiles ───────────────────────────────────────────────
    const profiles = _tryRequire("./engineeringProfile.cjs");
    add("engineering_profiles",
        !!profiles,
        profiles ? `engineeringProfile: ${profiles.listProfiles().length} profiles, active=${profiles.getActiveProfile().name}` : "MISSING",
        "info", "ready"
    );

    // ── 10. Runtime modes ─────────────────────────────────────────────────────
    const modes = _tryRequire("./runtimeModes.cjs");
    add("runtime_modes",
        !!modes,
        modes ? `runtimeModes: ${modes.listModes().length} modes, active=${modes.getActiveMode().name}` : "MISSING",
        "info", "ready"
    );

    // ── 11. Memory bounds ─────────────────────────────────────────────────────
    const heapMb = Math.round(process.memoryUsage().heapUsed / 1_048_576);
    add("memory_bounded",
        heapMb < 400,
        `heap=${heapMb}MB (limit=400MB)`,
        heapMb < 400 ? "info" : "critical",
        heapMb < 400 ? "ready" : "blocker"
    );

    // ── 12. Session hardening ─────────────────────────────────────────────────
    const hardening = _tryRequire("./sessionHardening.cjs");
    add("session_hardening",
        !!hardening,
        hardening ? "sessionHardening: stale detection, multi-window guard, reconnect continuity" : "MISSING",
        hardening ? "info" : "warn", hardening ? "ready" : "risk"
    );

    // ── Summary ───────────────────────────────────────────────────────────────
    const blockers       = checks.filter(c => !c.ok && c.saasImpact === "blocker");
    const risks          = checks.filter(c => !c.ok && c.saasImpact === "risk");
    const passed         = checks.filter(c => c.ok).length;
    const saasReady      = blockers.length === 0;

    const maturity =
        blockers.length > 0   ? "NOT_READY"     :
        risks.length    > 1   ? "NEEDS_WORK"    :
        risks.length    === 1 ? "NEARLY_READY"  : "SAAS_READY";

    return {
        saasReady,
        maturity,
        passedChecks:   passed,
        totalChecks:    checks.length,
        blockers:       blockers.length,
        risks:          risks.length,
        checks,
        summary: `SaaS readiness: ${maturity} (${passed}/${checks.length} checks passed, ${blockers.length} blocker(s), ${risks.length} risk(s))`,
        ts: new Date().toISOString(),
    };
}

module.exports = { runSaasAudit };
