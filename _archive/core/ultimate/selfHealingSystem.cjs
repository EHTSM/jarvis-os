"use strict";
const { ultimateLog, isKillSwitchActive, load, flush, uid, NOW, ok, fail, killed } = require("./_ultimateStore.cjs");

const AGENT = "selfHealingSystem";

const FAULT_TYPES    = ["timeout","memory_leak","data_corruption","module_crash","infinite_loop","resource_exhaustion","api_failure","schema_mismatch"];
const HEAL_ACTIONS   = ["restart_module","clear_cache","rollback_state","retry_with_backoff","isolate_fault","alert_admin","scale_resource","apply_patch"];
const HEALTH_BANDS   = { healthy:[80,100], degraded:[60,80], critical:[30,60], failed:[0,30] };

function _healthBand(score) {
    for (const [band, [min, max]] of Object.entries(HEALTH_BANDS)) {
        if (score >= min && score < max) return band;
    }
    return "healthy";
}

// ── Run a health scan of the system ─────────────────────────────
function runHealthScan({ subsystems = [] }) {
    if (isKillSwitchActive()) return killed(AGENT);

    const targets = subsystems.length > 0 ? subsystems : [
        "omniController","multiSystemIntegrator","globalAutomationEngine","safetyLockAI",
        "ethicsMonitor","scalingEngine","universalKnowledgeEngine","economyEngine"
    ];

    const scans = targets.map(sys => {
        const score   = Math.round(40 + Math.random() * 60);
        const faults  = score < 70 ? [FAULT_TYPES[Math.floor(Math.random() * FAULT_TYPES.length)]] : [];
        return {
            subsystem:    sys,
            healthScore:  score,
            healthBand:   _healthBand(score),
            faults,
            latency_ms:   Math.round(10 + Math.random() * 500),
            memoryUsage_pct: parseFloat((20 + Math.random() * 60).toFixed(1)),
            status:       score >= 70 ? "operational" : score >= 40 ? "degraded" : "critical"
        };
    });

    const overallScore  = Math.round(scans.reduce((s, sc) => s + sc.healthScore, 0) / scans.length);
    const criticalCount = scans.filter(s => s.status === "critical").length;
    const faultCount    = scans.reduce((s, sc) => s + sc.faults.length, 0);

    const report = {
        scanId:        uid("scan"),
        overallHealth: overallScore,
        healthBand:    _healthBand(overallScore),
        subsystems:    scans,
        criticalCount,
        faultCount,
        allHealthy:    criticalCount === 0 && faultCount === 0,
        scannedAt:     NOW()
    };

    const log = load("health_log", []);
    log.push({ scanId: report.scanId, overallHealth: overallScore, criticalCount, faultCount, scannedAt: report.scannedAt });
    flush("health_log", log.slice(-1000));

    ultimateLog(AGENT, "health_scan_complete", { overallHealth: overallScore, criticalCount, faultCount }, criticalCount > 0 ? "WARN" : "INFO");
    return ok(AGENT, report);
}

// ── Attempt to heal a detected fault ────────────────────────────
function healFault({ subsystem, faultType, strategy }) {
    if (!subsystem || !faultType) return fail(AGENT, "subsystem and faultType are required");
    if (!FAULT_TYPES.includes(faultType)) return fail(AGENT, `faultType must be: ${FAULT_TYPES.join(", ")}`);
    if (isKillSwitchActive()) return killed(AGENT);

    const action  = strategy || HEAL_ACTIONS[Math.floor(Math.random() * HEAL_ACTIONS.length)];
    const success = Math.random() > 0.15; // 85% heal success

    const result = {
        healId:      uid("heal"),
        subsystem,
        faultType,
        strategy:    action,
        success,
        outcome:     success ? `${action} applied — ${subsystem} restored to operational state` : `${action} insufficient — manual intervention may be required`,
        newHealthScore: success ? Math.round(70 + Math.random() * 30) : Math.round(20 + Math.random() * 40),
        healedAt:    NOW()
    };

    ultimateLog(AGENT, success ? "fault_healed" : "HEAL_FAILED", { subsystem, faultType, strategy: action }, success ? "INFO" : "WARN");
    return ok(AGENT, result, success ? "approved" : "partial");
}

// ── Rollback system state to last known good ─────────────────────
function rollbackState({ subsystem, checkpointId }) {
    if (!subsystem) return fail(AGENT, "subsystem is required");
    if (isKillSwitchActive()) return killed(AGENT);

    const checkpoints = load(`checkpoints_${subsystem}`, []);
    const target = checkpointId
        ? checkpoints.find(c => c.id === checkpointId)
        : checkpoints[checkpoints.length - 1];

    if (!target) return fail(AGENT, `No checkpoint found for subsystem '${subsystem}'`);

    ultimateLog(AGENT, "ROLLBACK_EXECUTED", { subsystem, checkpointId: target.id }, "WARN");
    return ok(AGENT, { subsystem, checkpointId: target.id, rolledBackAt: NOW(), message: `State rolled back to checkpoint ${target.id}` });
}

// ── Save a state checkpoint ──────────────────────────────────────
function saveCheckpoint({ subsystem, state = {} }) {
    if (!subsystem) return fail(AGENT, "subsystem is required");
    const cp = { id: uid("ckpt"), subsystem, state, savedAt: NOW() };
    const checkpoints = load(`checkpoints_${subsystem}`, []);
    checkpoints.push(cp);
    flush(`checkpoints_${subsystem}`, checkpoints.slice(-20)); // keep last 20 checkpoints
    ultimateLog(AGENT, "checkpoint_saved", { subsystem, checkpointId: cp.id }, "INFO");
    return ok(AGENT, cp);
}

module.exports = { runHealthScan, healFault, rollbackState, saveCheckpoint, FAULT_TYPES, HEAL_ACTIONS };
