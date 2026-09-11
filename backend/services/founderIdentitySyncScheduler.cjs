"use strict";
/**
 * Founder Identity Sync Scheduler — V7 Phase 5 (Founder Operating System).
 *
 * Survey found founderIdentityOS.cjs's runFullSystemScan() (real: rebuilds
 * the identity graph, re-discovers digital assets, rebuilds the
 * relationship graph, runs credential intelligence — all via
 * Promise.allSettled so one failing sub-scan can't abort the others, each
 * persisted to disk) was exclusively route-driven (POST /fdios/scan/full)
 * — no scheduling anywhere. Real detection value: catches newly-connected
 * accounts, newly-exposed secrets, and credentials due for rotation
 * without the founder having to remember to trigger a scan.
 *
 * Also wires runSecretDiscovery() (bounded scan over known sensitive file
 * locations — .env*, docker-compose, Dockerfile, ecosystem.config — never
 * a recursive repo walk) since it is not itself included inside
 * runFullSystemScan() but is the same class of real, cheap, security-
 * relevant detection.
 *
 * No new logic — this file only composes and schedules two already-built,
 * already-exported functions.
 */

const logger = require("../utils/logger");

function _try(fn) { try { return fn(); } catch { return null; } }
function _fio() { return _try(() => require("./founderIdentityOS.cjs")); }
function _obs() { return _try(() => require("./observabilityEngine.cjs")); }

async function runSyncCycle() {
    const t0 = Date.now();
    const fio = _fio();
    if (!fio) return { ok: false, error: "founderIdentityOS unavailable" };

    const result = { runAt: new Date().toISOString(), stages: {} };

    try {
        result.stages.fullScan = await fio.runFullSystemScan();
    } catch (e) { result.stages.fullScan = { error: e.message }; }

    try {
        const sec = await fio.runSecretDiscovery();
        result.stages.secretDiscovery = { scannedFiles: sec.scannedFiles, findings: sec.findings?.length ?? 0 };
    } catch (e) { result.stages.secretDiscovery = { error: e.message }; }

    result.durationMs = Date.now() - t0;

    const obs = _obs();
    if (obs) {
        obs.recordMetric("founder_identity.sync.duration_ms", result.durationMs);
        obs.recordMetric("founder_identity.sync.secret_findings", result.stages.secretDiscovery?.findings || 0);
    }

    if (result.stages.secretDiscovery?.findings > 0) {
        logger.warn(`[FounderIdentitySync] cycle complete in ${result.durationMs}ms — ${result.stages.secretDiscovery.findings} potential secret(s) found in tracked locations`);
    } else {
        logger.info(`[FounderIdentitySync] cycle complete in ${result.durationMs}ms`);
    }

    return result;
}

// 6h interval — matches the same cadence class as the self-improvement
// evolution cycle (identity/credential drift is daily-scale, not
// minute-to-minute, and runSecretDiscovery's filesystem reads are cheap
// but still real I/O not worth doing more often than that for a
// background sweep).
let _scheduleHandle = null;

function startIdentitySyncSchedule(intervalMs = 6 * 60 * 60 * 1000) {
    if (_scheduleHandle) return _scheduleHandle;
    _scheduleHandle = setInterval(() => {
        logger.info("[FounderIdentitySync] Identity sync tick — running runSyncCycle()");
        runSyncCycle().catch(err => {
            logger.error("[FounderIdentitySync] Scheduled sync cycle error:", err.message);
        });
    }, intervalMs);
    if (typeof _scheduleHandle.unref === "function") _scheduleHandle.unref();
    logger.info(`[FounderIdentitySync] Identity sync schedule started (${Math.round(intervalMs / 3_600_000)}h interval).`);
    return _scheduleHandle;
}

// Scheduler Reliability & Recovery Audit (2026-08-16): no way existed to
// stop this timer at all — confirmed via grep, unlike orgAutomationScheduler.
// stop()/browserScheduler.stop(), which both exist and are already wired
// into server.js's graceful shutdown sequence. .unref() means it never
// blocked process exit, but that's a different property from being able to
// cleanly stop it (e.g. before a controlled restart, or in a test that
// starts and needs to tear down its own timers). Same minimal
// clearInterval-and-null-out pattern as its two sibling schedulers.
function stopIdentitySyncSchedule() {
    if (!_scheduleHandle) return { ok: true, wasRunning: false };
    clearInterval(_scheduleHandle);
    _scheduleHandle = null;
    return { ok: true, wasRunning: true };
}

module.exports = { runSyncCycle, startIdentitySyncSchedule, stopIdentitySyncSchedule };
