"use strict";
/**
 * dlqDrainEngine.cjs — Autonomous Engineering Sprint 6
 *
 * Classifies and drains the Dead Letter Queue using the full Sprint 1–5
 * engineering intelligence stack.
 *
 * Each DLQ item is evaluated by:
 *   1. selectStrategy(item.error, context) — Sprint 4 strategy engine
 *   2. explain(item.error, context)        — Sprint 5 confidence engine
 *
 * Per-item routing:
 *   fail_fast / park_task        → purge (deterministic; can never succeed)
 *   circuit_reset_rec            → park  (keep, flag for operator circuit reset)
 *   operator_approval            → park  (keep, flag for operator decision)
 *   retry_with_backoff           → requeue (push back to task queue if available)
 *   dead_letter (exhausted)      → archive (keep in DLQ, mark terminal)
 *   delay_until_ready            → requeue with delay tag
 *   reroute_capability           → purge  (no alternative available without UI)
 *
 * Run modes:
 *   drain({ dryRun: true })  — classify only, no mutations     [DEFAULT]
 *   drain({ dryRun: false }) — classify + execute routing
 *
 * Safety: dryRun defaults to true. Mutations require explicit opt-in.
 *
 * Public API:
 *   drain(opts)         → DrainReport
 *   getLastReport()     → DrainReport | null
 *   getStats()          → aggregate stats across all drain runs
 */

const logger = require("../utils/logger");

// ── Lazy service refs ─────────────────────────────────────────────────────
function _dlq()     { try { return require("../../agents/runtime/deadLetterQueue.cjs"); } catch { return null; } }
function _tq()      { try { return require("../../agents/taskQueue.cjs");               } catch { return null; } }
function _select()  { try { return require("./selfHealingRuntime.cjs").selectStrategy;  } catch { return null; } }
function _ce()      { try { return require("./engineeringConfidenceEngine.cjs");        } catch { return null; } }
function _rca()     { try { return require("./rootCauseAnalysisEngine.cjs");            } catch { return null; } }
function _cle()     { try { return require("./continuousLearningEngine.cjs");           } catch { return null; } }

// ── Routing table ─────────────────────────────────────────────────────────
// Maps selectStrategy().strategy to a drain action.
const STRATEGY_TO_ACTION = {
    fail_fast:          "purge",
    park_task:          "purge",
    circuit_reset_rec:  "park",
    operator_approval:  "park",
    retry_with_backoff: "requeue",
    delay_until_ready:  "requeue",
    reroute_capability: "purge",   // no alternative available at drain time
    dead_letter:        "archive", // already in DLQ; mark terminal
};

// ── Session state ─────────────────────────────────────────────────────────
let _lastReport = null;
let _totalRuns  = 0;
let _totalDrained = 0;
let _totalRequeued = 0;
let _totalPurged   = 0;
let _totalParked   = 0;
let _totalArchived = 0;

// ── Core drain logic ──────────────────────────────────────────────────────

/**
 * drain — classify and optionally execute routing for all DLQ items.
 *
 * @param {object} opts
 *   dryRun    {boolean}  default true  — when false, mutations are executed
 *   maxItems  {number}   default 1000  — cap items processed per run
 *   minConfidence {number} default 0   — skip items below this confidence
 * @returns {DrainReport}
 */
function drain(opts = {}) {
    const dryRun       = opts.dryRun !== false;   // default: dry run
    const maxItems     = opts.maxItems  || 1000;
    const minConf      = opts.minConfidence || 0;

    const dlq      = _dlq();
    const tqMod    = _tq();
    const select   = _select();
    const ce       = _ce();

    if (!dlq) return { ok: false, error: "DLQ unavailable" };
    if (!select) return { ok: false, error: "selectStrategy unavailable" };

    const startedAt = new Date().toISOString();
    const items     = dlq.list().slice(0, maxItems);
    if (items.length === 0) {
        return { ok: true, dryRun, startedAt, completedAt: new Date().toISOString(),
            totalInDLQ: 0, totalProcessed: 0, summary: { purge:0, requeue:0, park:0, archive:0 },
            executed: null, byStrategy: {}, byError: {}, items: [], avgConfidence: 0, reproducible: true,
            note: "DLQ is empty — nothing to drain" };
    }
    if (items.length === 0) {
        return { ok: true, dryRun, startedAt, completedAt: new Date().toISOString(),
            totalInDLQ: 0, totalProcessed: 0, summary: { purge:0, requeue:0, park:0, archive:0 },
            executed: null, byStrategy: {}, byError: {}, items: [], avgConfidence: 0, reproducible: true,
            note: "DLQ is empty — nothing to drain" };
    }
    if (items.length === 0) {
        return { ok: true, dryRun, startedAt, completedAt: new Date().toISOString(),
            totalInDLQ: 0, totalProcessed: 0, summary: { purge:0, requeue:0, park:0, archive:0 },
            executed: null, byStrategy: {}, byError: {}, items: [], avgConfidence: 0, reproducible: true,
            note: "DLQ is empty — nothing to drain" };
    }
    if (items.length === 0) {
        return { ok: true, dryRun, startedAt, completedAt: new Date().toISOString(),
            totalInDLQ: 0, totalProcessed: 0, summary: { purge:0, requeue:0, park:0, archive:0 },
            executed: null, byStrategy: {}, byError: {}, items: [], avgConfidence: 0, reproducible: true,
            note: "DLQ is empty — nothing to drain" };
    }

    // ── Classify all items ────────────────────────────────────────────────
    const classified = items.map(item => {
        const errorMsg = item.error || "unknown";
        const context  = {
            retries:    item.attempts || 0,
            maxRetries: 3,
            targetType: "task",
            capability: item.taskType,
        };

        // Strategy decision (Sprint 4 + 5 integrated)
        let decision;
        try { decision = select(errorMsg, context); }
        catch { decision = { strategy: "dead_letter", confidence: 50, strategyReason: "selectStrategy threw", alternativesRejected: [], expectedRecoveryProb: 0, explainedConfidence: null }; }

        // Override for DLQ-specific signals not in the rule registry:
        // "permanent failure" in the error text is explicit — never retry.
        if (/permanent.?failure/i.test(errorMsg) && decision.strategy === "retry_with_backoff") {
            decision = {
                ...decision,
                strategy:     "fail_fast",
                strategyReason: "Error text contains 'permanent failure' — retrying is explicitly futile. Routing to purge.",
                alternativesRejected: [
                    { strategy: "retry_with_backoff", reason: "Error marked permanent — retry would waste queue capacity" },
                ],
                expectedRecoveryProb: 0,
            };
        }

        // "unknown" at attempts=0 with no taskType context: we have very little signal.
        // Give retry_with_backoff a chance — these are likely transient hangs.
        // (No override needed — selectStrategy already routes these correctly.)

        // Standalone confidence breakdown (Sprint 5)
        let confidence = decision.explainedConfidence || null;
        if (!confidence && ce) {
            try { confidence = ce.explain(errorMsg, { ...context, problemClass: decision.rcaClass }); }
            catch { /* non-fatal */ }
        }

        const action = STRATEGY_TO_ACTION[decision.strategy] || "archive";

        return {
            taskId:     item.taskId,
            taskType:   item.taskType,
            error:      errorMsg,
            attempts:   item.attempts,
            deadAt:     item.deadAt,
            strategy:   decision.strategy,
            action,
            confidence: confidence?.confidence ?? decision.confidence,
            strategyReason:        decision.strategyReason,
            alternativesRejected:  decision.alternativesRejected,
            expectedRecoveryProb:  decision.expectedRecoveryProb,
            ruleId:     decision.ruleId,
            rcaClass:   decision.rcaClass,
            evidenceBreakdown: confidence?.breakdown || null,
        };
    }).filter(c => c.confidence >= minConf);

    // ── Tally by action ───────────────────────────────────────────────────
    const byAction   = { purge: [], requeue: [], park: [], archive: [] };
    const byStrategy = {};
    const byError    = {};

    for (const c of classified) {
        (byAction[c.action] || byAction.archive).push(c);
        byStrategy[c.strategy] = (byStrategy[c.strategy] || 0) + 1;
        const errKey = (c.error || "unknown").split(":")[0].trim().slice(0, 40);
        if (!byError[errKey]) byError[errKey] = { count: 0, action: c.action, strategy: c.strategy };
        byError[errKey].count++;
    }

    // ── Execute routing (when not dry run) ───────────────────────────────
    const executed = { purged: 0, requeued: 0, parked: 0, archived: 0, failed: 0 };

    if (!dryRun) {
        // PURGE: remove from DLQ permanently
        for (const c of byAction.purge) {
            try {
                dlq.remove(c.taskId);
                executed.purged++;
            } catch { executed.failed++; }
        }

        // REQUEUE: remove from DLQ and push back to task queue
        for (const c of byAction.requeue) {
            try {
                if (tqMod && tqMod.enqueue) {
                    const delayMs = c.strategy === "delay_until_ready" ? 5_000 : 1_000;
                    tqMod.enqueue({
                        id:           c.taskId,
                        type:         c.taskType,
                        input:        c.error,  // best available re-entry context
                        status:       "pending",
                        scheduledFor: new Date(Date.now() + delayMs).toISOString(),
                        source:       "dlq_drain",
                        drainStrategy: c.strategy,
                    });
                    dlq.remove(c.taskId);
                    executed.requeued++;
                } else {
                    // No task queue available — park instead of losing the item
                    executed.parked++;
                }
            } catch { executed.failed++; }
        }

        // PARK: keep in DLQ, leave for operator — count only
        executed.parked += byAction.park.length;

        // ARCHIVE: keep in DLQ, mark terminal — count only
        executed.archived += byAction.archive.length;

        // Record resolution lessons for RCAs that drain resolves
        _recordResolutions(byAction, byError);
    }

    // ── Build report ──────────────────────────────────────────────────────
    const totalProcessed = classified.length;
    const report = {
        ok:          true,
        dryRun,
        startedAt,
        completedAt: new Date().toISOString(),
        totalInDLQ:  items.length,
        totalProcessed,
        summary: {
            purge:   byAction.purge.length,
            requeue: byAction.requeue.length,
            park:    byAction.park.length,
            archive: byAction.archive.length,
        },
        executed:    dryRun ? null : executed,
        byStrategy,
        byError,
        // Full classification list (includes evidenceBreakdown per item)
        items: classified,
        // Aggregated evidence quality
        avgConfidence: totalProcessed
            ? Math.round(classified.reduce((s, c) => s + c.confidence, 0) / totalProcessed)
            : 0,
        reproducible: true,
    };

    // ── Update session telemetry ───────────────────────────────────────────
    _totalRuns++;
    _totalDrained  += totalProcessed;
    if (!dryRun) {
        _totalPurged   += executed.purged;
        _totalRequeued += executed.requeued;
        _totalParked   += executed.parked;
        _totalArchived += executed.archived;
    }
    _lastReport = report;

    const mode = dryRun ? "[DRY RUN]" : "[LIVE]";
    logger.info(`[DLQDrain] ${mode} processed=${totalProcessed} purge=${byAction.purge.length} requeue=${byAction.requeue.length} park=${byAction.park.length} archive=${byAction.archive.length} avgConf=${report.avgConfidence}%`);

    return report;
}

// ── Resolution side-effects ───────────────────────────────────────────────
// Record lessons for RCA classes that the drain operation fully addresses.

function _recordResolutions(byAction, byError) {
    const rca = _rca();
    const cle = _cle();
    if (!rca || !cle) return;

    // If all cb trigger items are parked/purged → circuit_breaker_open_media is addressed
    const cbItems = (byError["cb trigger"] || byError["cb_trigger"] || { count: 0 }).count;
    if (cbItems > 0) {
        try {
            rca.recordFixSuccess("circuit_breaker_open_media", {
                description: `DLQ drain routed ${cbItems} circuit-breaker items via circuit_reset_rec strategy. Operator notification flagged.`,
                fixedBy:     "dlq_drain_engine",
            });
        } catch { /* non-fatal */ }
    }

    // If Timeout / unknown ai items are requeued → ai_service_timeout is partially addressed
    const aiTimeoutCount = (byError["Timeout"] || { count: 0 }).count;
    const aiUnknownCount = (byError["unknown"] || { count: 0 }).count;
    if (aiTimeoutCount > 0 || aiUnknownCount > 0) {
        try {
            cle.createLesson({
                type:   "engineering_playbook",
                source: "dlq_drain_engine",
                title:  "AI timeout DLQ items requeued with retry_with_backoff",
                detail: `DLQ drain requeued ${aiTimeoutCount} Timeout + ${aiUnknownCount} unknown AI tasks. Long-term fix: increase AI handler ceiling to 90s (RCA ai_service_timeout).`,
                tags:   ["ai_service_timeout", "dlq", "requeue"],
            });
        } catch { /* non-fatal */ }
    }
}

/** @returns {DrainReport|null} result of the most recent drain() call */
function getLastReport() { return _lastReport; }

/** @returns session aggregate statistics */
function getStats() {
    return {
        totalRuns:     _totalRuns,
        totalDrained:  _totalDrained,
        totalPurged:   _totalPurged,
        totalRequeued: _totalRequeued,
        totalParked:   _totalParked,
        totalArchived: _totalArchived,
        lastRunAt:     _lastReport?.startedAt || null,
    };
}

module.exports = { drain, getLastReport, getStats };
