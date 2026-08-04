"use strict";
/**
 * Business Operations Scheduler — V7 Phase 4 (Autonomous Business Operations).
 *
 * Survey found 5 real batch/scan functions across the customer-org and
 * revenue stacks that were exclusively route-driven, with a real data
 * dependency chain: journey sync populates the data health-scoring reads,
 * health scoring populates the data automation-scanning reads, automation
 * scanning + revenue pipeline are the actual autonomous action layers, and
 * business-intelligence scan reads all of it for cross-cutting signals.
 * This composes them in that order — the same "thin composition, reuse
 * everything, write nothing new" shape as selfImprovementEngine.cjs's
 * runEvolutionCycle(). No new business logic; every stage is an existing,
 * already-built, already-tested function.
 *
 * Each stage is independently try/caught so one failing subsystem can't
 * abort the cycle — same discipline as runEvolutionCycle().
 */

const logger = require("../utils/logger");

function _try(fn) { try { return fn(); } catch { return null; } }

function _cje()  { return _try(() => require("./customerJourneyEngine.cjs")); }
function _che()  { return _try(() => require("./customerHealthEngine.cjs")); }
function _cae()  { return _try(() => require("./customerAutomationEngine.cjs")); }
function _rae()  { return _try(() => require("./revenueAutomationEngine.cjs")); }
function _bie()  { return _try(() => require("./businessIntelligenceEngine.cjs")); }
function _obs()  { return _try(() => require("./observabilityEngine.cjs")); }

async function runOperationsCycle() {
    const runAt = new Date().toISOString();
    const t0    = Date.now();
    const result = { runAt, stages: {} };

    // Stage 1: Journey sync — must run first, health scoring and automation
    // scanning both read journey/health data this stage populates.
    try {
        const r = _cje()?.syncJourneys?.();
        result.stages.journeySync = r ? { total: r.total ?? r.journeys?.length ?? null } : { skipped: true };
    } catch (e) { result.stages.journeySync = { error: e.message }; }

    // Stage 2: Health scoring — reads journey/CRM data just synced above.
    try {
        const r = _che()?.scoreAll?.();
        result.stages.healthScore = r ? { scored: r.scored ?? r.total ?? null, atRisk: r.atRisk ?? null } : { skipped: true };
    } catch (e) { result.stages.healthScore = { error: e.message }; }

    // Stage 3: Customer automation scan — the real autonomous action layer
    // (retention/onboarding/upsell/renewal triggers), reads fresh journey +
    // health data from stages 1-2. Approval-gated per automation type —
    // same RBAC design already used for every other autonomous trigger in
    // this codebase, unmodified here.
    try {
        result.stages.automationScan = await _cae()?.runAutomationScan?.();
    } catch (e) { result.stages.automationScan = { error: e.message }; }

    // Stage 4: Revenue pipeline — opportunity discovery, proposal generation,
    // at-risk renewal triggers. Reads customerHealthEngine.getStats().atRisk
    // from stage 2.
    try {
        result.stages.revenuePipeline = await _rae()?.runRevenuePipeline?.();
    } catch (e) { result.stages.revenuePipeline = { error: e.message }; }

    // Stage 5: Business intelligence scan — cross-cutting signal detection
    // over leads/deals/customers/campaigns, reads everything above.
    try {
        result.stages.biScan = _bie()?.scan?.();
    } catch (e) { result.stages.biScan = { error: e.message }; }

    result.durationMs = Date.now() - t0;

    const obs = _obs();
    if (obs) {
        obs.recordMetric("business_ops.cycle.duration_ms", result.durationMs);
        obs.recordMetric("business_ops.cycle.automations_triggered", result.stages.automationScan?.triggered || 0);
        obs.recordMetric("business_ops.cycle.at_risk", result.stages.healthScore?.atRisk || 0);
    }

    const errors = Object.entries(result.stages).filter(([, v]) => v?.error).map(([k]) => k);
    if (errors.length > 0) {
        logger.warn(`[BusinessOps] cycle completed with errors in: ${errors.join(", ")}`);
    } else {
        logger.info(`[BusinessOps] cycle complete in ${result.durationMs}ms — ${result.stages.automationScan?.triggered || 0} automation(s) triggered`);
    }

    return result;
}

// ── Continuous schedule ────────────────────────────────────────────────────
// 4h interval: frequent enough that churn/renewal/onboarding signals don't
// go stale for a full business day, but not so frequent that it re-triggers
// the same approval-gated automations before an operator has had a chance
// to act on the previous batch (trigger() itself is idempotent-per-type via
// its own status tracking, but there's no value re-scanning faster than an
// operator can realistically review approvals).
let _scheduleHandle = null;

function startOperationsSchedule(intervalMs = 4 * 60 * 60 * 1000) {
    if (_scheduleHandle) return _scheduleHandle;
    _scheduleHandle = setInterval(() => {
        logger.info("[BusinessOps] Operations schedule tick — running runOperationsCycle()");
        runOperationsCycle().catch(err => {
            logger.error("[BusinessOps] Scheduled operations cycle error:", err.message);
        });
    }, intervalMs);
    if (typeof _scheduleHandle.unref === "function") _scheduleHandle.unref();
    logger.info(`[BusinessOps] Operations schedule started (${Math.round(intervalMs / 3_600_000)}h interval).`);
    return _scheduleHandle;
}

module.exports = { runOperationsCycle, startOperationsSchedule };
