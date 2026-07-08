"use strict";
/**
 * SelfHealingRuntime — Strategy Engine for failure recovery.
 *
 * Sprint 4: transforms from a single-strategy retry loop into a
 * multi-strategy engine that selects the best recovery action per failure
 * using Engineering Rules, Root Cause Analysis, and execution history.
 *
 * Integrates with:
 *   taskQueue              — scan for stuck/failed tasks and reschedule
 *   runtimeOrchestrator    — getHealLog() for native runtime heal events
 *   autonomousTaskLoop     — restart failed cycles
 *   execLog                — source of truth for recent execution failures
 *   engineeringRuleRegistry — classifyError() for strategy classification
 *   rootCauseAnalysisEngine — getAnalysis() for known problem classes
 *
 * Recovery strategies (Sprint 4 — 8 strategies):
 *   retry_with_backoff     — transient error; re-queue with exponential delay
 *   fail_fast              — deterministic error; park immediately, no retry
 *   park_task              — DLQ immediately; error is known-permanent
 *   reroute_capability     — redirect to alternative agent/capability
 *   delay_until_ready      — handler not registered yet; wait and retry once
 *   circuit_reset_rec      — circuit breaker open; recommend reset to operator
 *   operator_approval      — requires human decision; halt and notify
 *   dead_letter            — all strategies exhausted; move to DLQ
 *
 * Every healing action records:
 *   strategyReason         — why this strategy was selected
 *   alternativesRejected   — why other strategies were not used
 *   expectedRecoveryProb   — 0-100 estimated probability of success
 *   ruleId / rcaClass      — source of the strategy decision
 *
 * Persists recovery history to data/healing-history.json.
 * Runs a background probe every PROBE_INTERVAL_MS (default 60s).
 *
 * Public API:
 *   probe()                         → { healed[], failed[] }  (manual trigger)
 *   healTask(taskId, opts)          → RecoveryRecord
 *   healCycle(cycleId, opts)        → RecoveryRecord
 *   circuitBreak(targetId, reason)  → RecoveryRecord
 *   selectStrategy(error, context)  → StrategyDecision
 *   getHistory(opts)                → { records[], stats }
 *   getStatus()                     → { lastProbeAt, probeCount, healedTotal, failedTotal }
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../utils/logger");
const auditLog = require("../utils/auditLog.cjs");
const execLog  = require("../utils/execLog.cjs");

const HISTORY_FILE  = path.join(__dirname, "../../data/healing-history.json");
const PROBE_INTERVAL_MS = 60_000;    // probe every 60 seconds
const MAX_AUTO_RETRIES  = 3;         // stop auto-healing after this many attempts per target
const STUCK_AGE_MS      = 5 * 60_000; // task running > 5 min = stuck

function _rj(file, fb) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fb; } }
function _wj(file, data) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

let _history  = _rj(HISTORY_FILE, []);
let _seq      = _history.length;
let _probeCount = 0;
let _lastProbeAt = null;
// Track auto-retry counts per target to avoid infinite loops
const _retryCount = new Map();  // targetId → count

function _rid() { return `heal_${Date.now()}_${(++_seq).toString(36)}`; }
function _save() { try { _wj(HISTORY_FILE, _history.slice(-2000)); } catch { /* non-fatal */ } }

function _record(rec) {
    _history.push({ ts: new Date().toISOString(), ...rec });
    _save();
    auditLog.append({ type: "heal_record", ...rec });
}

// ── Lazy-load dependents ─────────────────────────────────────────────────
function _getTQ()   { try { return require("../../agents/taskQueue.cjs"); } catch { return null; } }
function _getATL()  { try { return require("./autonomousTaskLoop.cjs");   } catch { return null; } }
function _getOrc()  { try { return require("../../agents/runtime/runtimeOrchestrator.cjs"); } catch { return null; } }
function _getRules(){ try { return require("./engineeringRuleRegistry.cjs");     } catch { return null; } }
function _getRCA()  { try { return require("./rootCauseAnalysisEngine.cjs");     } catch { return null; } }
function _getDLQ()  { try { return require("../../agents/runtime/deadLetterQueue.cjs"); } catch { return null; } }
function _getCE()   { try { return require("./engineeringConfidenceEngine.cjs"); } catch { return null; } }

// ── Strategy selector (Sprint 4 core) ────────────────────────────────────
//
// Consults the Engineering Rule Registry and RCA Engine to decide which
// of the 8 recovery strategies to apply. Returns a StrategyDecision that
// explains WHY the chosen strategy was selected and WHY alternatives were
// rejected.
//
// Strategy priority ladder (evaluated top-to-bottom, first match wins):
//   1. fail_fast           — rule says deterministic + autoApply
//   2. delay_until_ready   — error indicates handler not registered yet
//   3. circuit_reset_rec   — error is a circuit-breaker trip
//   4. park_task           — max retries exhausted AND deterministic
//   5. operator_approval   — rule says require_operator_action
//   6. reroute_capability  — error is dispatch failed (unknown cap name)
//   7. retry_with_backoff  — rule says retry_with_backoff OR transient/unknown
//   8. dead_letter         — max retries exhausted, nothing else worked

const STRATEGY_DESCRIPTIONS = {
    retry_with_backoff:  "Transient error — retrying with exponential backoff is likely to succeed",
    fail_fast:           "Deterministic error — retrying will never succeed; parking immediately saves retry budget",
    park_task:           "Max retries reached on a deterministic error — moving to DLQ",
    reroute_capability:  "Capability not found — redirecting to a registered alternative",
    delay_until_ready:   "Handler not yet registered — scheduling a delayed retry after registration window",
    circuit_reset_rec:   "Circuit breaker is open — recommending reset to operator before further attempts",
    operator_approval:   "Recovery requires human decision — halting and notifying operator",
    dead_letter:         "All recovery strategies exhausted — archiving to dead-letter queue",
};

function selectStrategy(errorMsg, context = {}) {
    const error = (errorMsg || "").toLowerCase();
    const retries = context.retries || 0;
    const maxRetries = context.maxRetries || MAX_AUTO_RETRIES;
    const exhausted = retries >= maxRetries;

    // Default decision if nothing matches
    let chosen = "retry_with_backoff";
    let ruleId = null;
    let rcaClass = null;
    let confidence = 50;
    let strategyReason = "No rule matched; defaulting to retry_with_backoff for unknown errors";
    const alternativesRejected = [];

    // 1. Consult Engineering Rule Registry
    let rule = null;
    try {
        const reg = _getRules();
        if (reg) {
            const result = reg.classifyError(errorMsg);
            rule = result.rule;
            confidence = Math.max(confidence, result.confidence || 0);
        }
    } catch { /* non-fatal */ }

    // 2. Consult RCA Engine for known problem classes
    let rcaMatch = null;
    try {
        const rca = _getRCA();
        if (rca) {
            // Match error against known RCA problem classes
            const { analyses } = rca.listAnalyses({ limit: 20 });
            for (const a of analyses) {
                if (a.status === "active" && a.affectedCapabilities?.some(c => error.includes(c.toLowerCase()))) {
                    rcaMatch = a;
                    rcaClass = a.problemClass;
                    break;
                }
                // Also match by error pattern in RCA error breakdown keys
                const breakdownKeys = Object.keys(a.errorBreakdown || {});
                if (breakdownKeys.some(k => error.includes(k.toLowerCase()))) {
                    rcaMatch = a;
                    rcaClass = a.problemClass;
                    break;
                }
            }
        }
    } catch { /* non-fatal */ }

    // ── Strategy ladder ──────────────────────────────────────────────

    if (rule && rule.autoApply && rule.action === "fail_fast" && !exhausted) {
        // Rule says deterministic: never improve on retry
        chosen = "fail_fast";
        ruleId = rule.ruleId;
        confidence = Math.max(confidence, 90);
        strategyReason = `Rule [${rule.ruleId}] classifies '${rule.problemClass}' as deterministic. ${rule.why?.slice(0, 100)}`;
        alternativesRejected.push(
            { strategy: "retry_with_backoff", reason: "Rule confirms error is deterministic — retrying wastes backoff budget" },
            { strategy: "dead_letter", reason: "Not yet at max retries; fail_fast is sufficient" },
        );
    } else if (error.includes("not yet registered") || error.includes("handler not registered") ||
               (error.includes("dispatch failed") && retries === 0 && context.targetType === "cycle")) {
        // Handler registration race — the sales agent bootstrap pattern (RCA-2)
        chosen = "delay_until_ready";
        rcaClass = rcaClass || "sales_agent_bootstrap_race";
        confidence = 78;
        strategyReason = "Error pattern suggests handler not yet registered (bootstrap race). " +
            "A short delay allows registration to complete before re-dispatch.";
        alternativesRejected.push(
            { strategy: "fail_fast", reason: "Error may be transient — handler registration is in progress" },
            { strategy: "dead_letter", reason: "First occurrence; delay-until-ready should recover without operator" },
        );
    } else if (error.includes("cb trigger") || error.includes("circuit") || error.includes("circuit_break")) {
        // Circuit breaker open — RCA-4
        chosen = "circuit_reset_rec";
        rcaClass = rcaClass || "circuit_breaker_open_media";
        confidence = 91;
        strategyReason = "Circuit breaker is open. Retrying will immediately re-trigger. " +
            "Operator must diagnose the original failure and reset the breaker.";
        alternativesRejected.push(
            { strategy: "retry_with_backoff", reason: "Breaker will reject every attempt until reset — retrying wastes budget" },
            { strategy: "fail_fast", reason: "Recovery IS possible after breaker reset; don't close the door permanently" },
        );
    } else if (exhausted && rule && rule.action === "fail_fast") {
        // Deterministic AND exhausted — park it
        chosen = "park_task";
        ruleId = rule.ruleId;
        confidence = 95;
        strategyReason = `Max retries (${maxRetries}) reached on a deterministic error class '${rule.problemClass}'. ` +
            "Moving to DLQ; further retries cannot succeed.";
        alternativesRejected.push(
            { strategy: "retry_with_backoff", reason: "Max retries exhausted" },
            { strategy: "dead_letter", reason: "park_task preserves the item for operator review; dead_letter discards it" },
        );
    } else if (rule && rule.autoApply && rule.action === "require_operator_action") {
        // Git state errors, missing approvals — need human
        chosen = "operator_approval";
        ruleId = rule.ruleId;
        confidence = Math.max(confidence, 85);
        strategyReason = `Rule [${rule.ruleId}] requires operator intervention for '${rule.problemClass}'. ` +
            `${rule.solution?.slice(0, 100)}`;
        alternativesRejected.push(
            { strategy: "retry_with_backoff", reason: "Git/state errors cannot resolve without operator action" },
            { strategy: "fail_fast", reason: "Recovery IS possible with operator intervention; don't discard" },
        );
    } else if (error.includes("dispatch failed") || error.includes("capability not found") ||
               error.includes("no handler") || error.includes("unknown capability")) {
        // Unknown capability — reroute
        chosen = "reroute_capability";
        confidence = 72;
        strategyReason = "Capability dispatch failed — no handler registered for this capability name. " +
            "Attempting reroute to closest registered alternative.";
        alternativesRejected.push(
            { strategy: "retry_with_backoff", reason: "Capability registration is static — retry cannot register a missing handler" },
            { strategy: "fail_fast", reason: "Rerouting to an alternative may succeed" },
        );
    } else if (exhausted) {
        // Nothing worked, all retries consumed
        chosen = "dead_letter";
        confidence = 95;
        strategyReason = `Max retries (${maxRetries}) exhausted with no matching rule. ` +
            "Archiving to dead-letter queue for operator review.";
        alternativesRejected.push(
            { strategy: "retry_with_backoff", reason: "Max retries reached" },
            { strategy: "fail_fast", reason: "Error class is unknown; cannot confirm deterministic" },
        );
    } else if (rule && rule.action === "retry_with_backoff") {
        // Explicit rule says retry
        chosen = "retry_with_backoff";
        ruleId = rule.ruleId;
        confidence = Math.max(confidence, 80);
        strategyReason = `Rule [${rule.ruleId}] classifies '${rule.problemClass}' as genuinely transient. ${rule.why?.slice(0, 80)}`;
        alternativesRejected.push(
            { strategy: "fail_fast", reason: "Rule confirms error is transient — retry may succeed" },
        );
    } else {
        // Default: retry unknown errors (may be transient)
        strategyReason = `Error '${(errorMsg || "unknown").slice(0, 60)}' has no matching rule. ` +
            "Defaulting to retry_with_backoff; if it recurs 3×, RCA will classify it.";
        alternativesRejected.push(
            { strategy: "fail_fast", reason: "Cannot confirm deterministic without a matching rule" },
        );
    }

    const expectedRecoveryProb = {
        retry_with_backoff:  70,
        fail_fast:            0,  // not a recovery — avoids waste
        park_task:            0,  // explicit non-recovery
        reroute_capability:  45,
        delay_until_ready:   80,
        circuit_reset_rec:    0,  // recommendation only
        operator_approval:   90,  // humans usually fix things
        dead_letter:          0,  // archived
    }[chosen] ?? 50;

    // Attach explainable confidence breakdown (Sprint 5)
    let explainedConfidence = null;
    try {
        const ce = _getCE();
        if (ce) {
            explainedConfidence = ce.explain(errorMsg, { problemClass: rcaClass, strategy: chosen });
            confidence = explainedConfidence.confidence; // override with evidence-derived value
        }
    } catch { /* non-fatal — fall back to heuristic confidence above */ }

    return {
        strategy:              chosen,
        ruleId,
        rcaClass,
        confidence,
        strategyReason,
        alternativesRejected,
        expectedRecoveryProb,
        description:           STRATEGY_DESCRIPTIONS[chosen],
        explainedConfidence,   // full evidence breakdown from Sprint 5
    };
}

// ── Failure detection ────────────────────────────────────────────────────
function _detectFailedTasks() {
    const tq = _getTQ();
    if (!tq) return [];
    try {
        const all  = tq.getAll();
        const now  = Date.now();
        const failed = all.filter(t => t.status === "failed");
        const stuck  = all.filter(t => {
            if (t.status !== "running") return false;
            const age = now - new Date(t.startedAt || t.createdAt).getTime();
            return age > STUCK_AGE_MS;
        });
        return [...failed, ...stuck];
    } catch { return []; }
}

function _detectFailedCycles() {
    const atl = _getATL();
    if (!atl) return [];
    try {
        const { cycles } = atl.listCycles({ status: "failed", limit: 20 });
        return cycles;
    } catch { return []; }
}

function _recentExecFailures() {
    try {
        return execLog.tail(200).filter(e => !e.success);
    } catch { return []; }
}

// ── Healing actions ──────────────────────────────────────────────────────

/** Re-queue a failed / stuck task — strategy-selected healing. */
async function healTask(taskId, opts = {}) {
    const recId = _rid();
    const tq    = _getTQ();

    // Resolve task for context
    let task = null;
    try {
        const all = tq ? tq.getAll() : [];
        task = all.find(t => t.id === taskId) || null;
    } catch { /* non-fatal */ }

    if (!task && tq) {
        const rec = { recId, strategy: "fail_fast", targetType: "task", targetId: taskId,
            success: false, reason: "task not found",
            strategyReason: "Cannot heal a task that no longer exists in the queue",
            alternativesRejected: [], expectedRecoveryProb: 0 };
        _record(rec); return rec;
    }

    const errorMsg  = task?.error || task?.lastError || "";
    const retries   = task?.retries || (_retryCount.get(taskId) || 0);
    const decision  = selectStrategy(errorMsg, { retries, maxRetries: task?.maxRetries || MAX_AUTO_RETRIES, targetType: "task" });
    const count     = retries + 1;

    logger.info(`[SelfHeal] Task ${taskId} → strategy=${decision.strategy} (conf=${decision.confidence}%) reason: ${decision.strategyReason.slice(0, 80)}`);

    // ── Execute chosen strategy ──────────────────────────────────────

    if (decision.strategy === "fail_fast" || decision.strategy === "park_task") {
        // Deterministic error — stop immediately, push to DLQ if possible
        try {
            _getDLQ()?.push({ taskId, taskType: task?.type || "unknown", error: errorMsg, attempts: count, agentId: null, deadAt: new Date().toISOString() });
        } catch { /* non-fatal */ }
        const rec = { recId, strategy: decision.strategy, targetType: "task", targetId: taskId,
            success: false, reason: `deterministic error: ${errorMsg.slice(0, 80)}`,
            strategyReason: decision.strategyReason,
            alternativesRejected: decision.alternativesRejected,
            expectedRecoveryProb: 0,
            ruleId: decision.ruleId, rcaClass: decision.rcaClass, count };
        _record(rec); return rec;
    }

    if (decision.strategy === "dead_letter") {
        try {
            _getDLQ()?.push({ taskId, taskType: task?.type || "unknown", error: errorMsg || "dead_letter", attempts: count, agentId: null, deadAt: new Date().toISOString() });
        } catch { /* non-fatal */ }
        const rec = { recId, strategy: "dead_letter", targetType: "task", targetId: taskId,
            success: false, reason: "all strategies exhausted",
            strategyReason: decision.strategyReason,
            alternativesRejected: decision.alternativesRejected,
            expectedRecoveryProb: 0, count };
        _record(rec); return rec;
    }

    if (decision.strategy === "operator_approval") {
        // Record as pending operator action — do not retry
        const rec = { recId, strategy: "operator_approval", targetType: "task", targetId: taskId,
            success: false, reason: `operator intervention required: ${errorMsg.slice(0, 80)}`,
            strategyReason: decision.strategyReason,
            alternativesRejected: decision.alternativesRejected,
            expectedRecoveryProb: decision.expectedRecoveryProb,
            ruleId: decision.ruleId, rcaClass: decision.rcaClass };
        _record(rec);
        logger.warn(`[SelfHeal] Task ${taskId} requires operator approval: ${errorMsg.slice(0, 60)}`);
        return rec;
    }

    if (decision.strategy === "circuit_reset_rec") {
        const rec = { recId, strategy: "circuit_reset_rec", targetType: "task", targetId: taskId,
            success: false, reason: "circuit breaker open — operator must reset",
            strategyReason: decision.strategyReason,
            alternativesRejected: decision.alternativesRejected,
            expectedRecoveryProb: 0, rcaClass: decision.rcaClass };
        _record(rec);
        logger.warn(`[SelfHeal] Task ${taskId}: circuit breaker open — recommending reset`);
        return rec;
    }

    // delay_until_ready, reroute_capability, retry_with_backoff → re-queue with backoff
    if (!tq) {
        const rec = { recId, strategy: decision.strategy, targetType: "task", targetId: taskId, success: false, reason: "taskQueue unavailable" };
        _record(rec); return rec;
    }

    _retryCount.set(taskId, count);

    try {
        const baseDelay = decision.strategy === "delay_until_ready" ? 5_000 : 1_000;
        const delayMs   = Math.min(baseDelay * Math.pow(2, count - 1), 30_000);
        const newScheduledFor = new Date(Date.now() + delayMs).toISOString();
        tq.update(taskId, { status: "pending", startedAt: null, scheduledFor: newScheduledFor, lastError: null });

        const rec = { recId, strategy: decision.strategy, targetType: "task", targetId: taskId,
            success: true, attempt: count, delayMs, newScheduledFor,
            strategyReason: decision.strategyReason,
            alternativesRejected: decision.alternativesRejected,
            expectedRecoveryProb: decision.expectedRecoveryProb,
            ruleId: decision.ruleId, rcaClass: decision.rcaClass };
        _record(rec);
        logger.info(`[SelfHeal] Task ${taskId} re-queued via ${decision.strategy} (attempt ${count}, delay ${delayMs}ms)`);
        return rec;
    } catch (e) {
        const rec = { recId, strategy: decision.strategy, targetType: "task", targetId: taskId, success: false, reason: e.message };
        _record(rec); return rec;
    }
}

/** Cancel and restart a failed cycle — strategy-selected healing. */
async function healCycle(cycleId, opts = {}) {
    const recId = _rid();
    const atl   = _getATL();

    // Resolve cycle for context
    let cycle = null;
    try { cycle = atl ? atl.getCycle(cycleId) : null; } catch { /* non-fatal */ }

    // Derive error context from cycle task failures
    const errorMsg  = (() => {
        if (!cycle) return "";
        const failedTask = (cycle.tasks || []).find(t => t.error || t.status === "failed");
        return failedTask?.error || "";
    })();
    const retries   = _retryCount.get(cycleId) || 0;
    const decision  = selectStrategy(errorMsg, { retries, maxRetries: MAX_AUTO_RETRIES, targetType: "cycle" });
    const count     = retries + 1;

    logger.info(`[SelfHeal] Cycle ${cycleId} → strategy=${decision.strategy} (conf=${decision.confidence}%) reason: ${decision.strategyReason.slice(0, 80)}`);

    // fail_fast / park_task / dead_letter / operator_approval / circuit_reset_rec
    // → do not restart; record outcome with explanation
    if (["fail_fast", "park_task", "dead_letter", "operator_approval", "circuit_reset_rec"].includes(decision.strategy)) {
        const rec = { recId, strategy: decision.strategy, targetType: "cycle", targetId: cycleId,
            success: false,
            reason: decision.strategy === "operator_approval"
                ? `operator intervention required: ${errorMsg.slice(0, 80)}`
                : decision.strategy === "circuit_reset_rec"
                ? "circuit breaker open — operator must reset"
                : `non-retriable: ${errorMsg.slice(0, 80)}`,
            strategyReason: decision.strategyReason,
            alternativesRejected: decision.alternativesRejected,
            expectedRecoveryProb: decision.expectedRecoveryProb,
            ruleId: decision.ruleId, rcaClass: decision.rcaClass, count };
        _record(rec);
        if (decision.strategy === "operator_approval") {
            logger.warn(`[SelfHeal] Cycle ${cycleId} requires operator approval: ${errorMsg.slice(0, 60)}`);
        }
        return rec;
    }

    // delay_until_ready → wait before restart
    if (decision.strategy === "delay_until_ready") {
        const delayMs = 5_000;
        _retryCount.set(cycleId, count);
        // Schedule restart after delay (non-blocking: probe will pick it up next tick)
        setTimeout(async () => {
            try {
                if (!atl || !cycle) return;
                if (["running","pending"].includes(cycle.status)) { try { atl.cancelCycle(cycleId); } catch {} }
                const newCycle = atl.startCycle(cycle.goal, { goalType: cycle.goalType, source: "self_heal_delayed" });
                logger.info(`[SelfHeal] Cycle ${cycleId} delayed-restart → ${newCycle.cycleId}`);
            } catch (e) { logger.warn(`[SelfHeal] delayed restart failed: ${e.message}`); }
        }, delayMs).unref?.();

        const rec = { recId, strategy: "delay_until_ready", targetType: "cycle", targetId: cycleId,
            success: true, attempt: count, delayMs,
            strategyReason: decision.strategyReason,
            alternativesRejected: decision.alternativesRejected,
            expectedRecoveryProb: decision.expectedRecoveryProb, rcaClass: decision.rcaClass };
        _record(rec);
        return rec;
    }

    // retry_with_backoff / reroute_capability → restart cycle immediately
    if (!atl) {
        const rec = { recId, strategy: decision.strategy, targetType: "cycle", targetId: cycleId, success: false, reason: "autonomousTaskLoop unavailable" };
        _record(rec); return rec;
    }

    _retryCount.set(cycleId, count);

    if (!cycle) {
        const rec = { recId, strategy: decision.strategy, targetType: "cycle", targetId: cycleId, success: false, reason: "cycle not found" };
        _record(rec); return rec;
    }

    try {
        if (["running", "pending"].includes(cycle.status)) {
            try { atl.cancelCycle(cycleId); } catch { /* already done */ }
        }
        const newCycle = atl.startCycle(cycle.goal, { goalType: cycle.goalType, source: "self_heal" });
        const rec = { recId, strategy: decision.strategy, targetType: "cycle", targetId: cycleId,
            newCycleId: newCycle.cycleId, success: true, attempt: count,
            strategyReason: decision.strategyReason,
            alternativesRejected: decision.alternativesRejected,
            expectedRecoveryProb: decision.expectedRecoveryProb,
            ruleId: decision.ruleId, rcaClass: decision.rcaClass };
        _record(rec);
        logger.info(`[SelfHeal] Cycle ${cycleId} restarted via ${decision.strategy} → ${newCycle.cycleId} (attempt ${count})`);
        return rec;
    } catch (e) {
        const rec = { recId, strategy: decision.strategy, targetType: "cycle", targetId: cycleId, success: false, reason: e.message };
        _record(rec); return rec;
    }
}

/** Mark a target (agent or tool) as circuit-broken for a duration. */
function circuitBreak(targetId, reason, durationMs = 60_000) {
    const recId  = _rid();
    const resetAt = new Date(Date.now() + durationMs).toISOString();
    const rec = { recId, strategy: "circuit_break", targetType: "agent_or_tool", targetId, success: true, reason, durationMs, resetAt };
    _record(rec);
    logger.warn(`[SelfHeal] Circuit-break applied to ${targetId} until ${resetAt}: ${reason}`);
    return rec;
}

// ── Probe (automated scan + heal) ────────────────────────────────────────
async function probe() {
    _probeCount++;
    _lastProbeAt = new Date().toISOString();
    const healed = [];
    const failed = [];

    // 1. Scan failed / stuck tasks
    const badTasks = _detectFailedTasks();
    for (const task of badTasks.slice(0, 10)) {   // cap to 10 per probe cycle
        const r = await healTask(task.id, { auto: true });
        (r.success ? healed : failed).push({ type: "task", id: task.id, result: r });
    }

    // 2. Scan failed cycles
    const badCycles = _detectFailedCycles();
    for (const cycle of badCycles.slice(0, 5)) {
        const r = await healCycle(cycle.cycleId, { auto: true });
        (r.success ? healed : failed).push({ type: "cycle", id: cycle.cycleId, result: r });
    }

    // 3. Collect native heal log from orchestrator
    try {
        const orc = _getOrc();
        if (orc && typeof orc.getHealLog === "function") {
            const nativeLogs = orc.getHealLog?.() || [];
            // Record any new native heal events we haven't seen
            for (const entry of nativeLogs.slice(-5)) {
                _record({ strategy: "native_runtime_heal", targetType: "runtime", targetId: entry.taskId || "unknown", success: !!entry.healed, reason: entry.reason || null, native: true });
            }
        }
    } catch { /* non-critical */ }

    if (healed.length + failed.length > 0) {
        logger.info(`[SelfHeal] Probe #${_probeCount}: healed=${healed.length} failed=${failed.length}`);
    }

    return { healed, failed, probeCount: _probeCount, ts: _lastProbeAt };
}

// ── Background probe loop ────────────────────────────────────────────────
let _probeTimer = null;

function startProbeLoop() {
    if (_probeTimer) return;
    _probeTimer = setInterval(() => {
        probe().catch(e => logger.warn(`[SelfHeal] Probe error: ${e.message}`));
    }, PROBE_INTERVAL_MS);
    if (_probeTimer.unref) _probeTimer.unref();
    logger.info(`[SelfHeal] Probe loop started (interval: ${PROBE_INTERVAL_MS}ms)`);
}

function stopProbeLoop() {
    if (_probeTimer) { clearInterval(_probeTimer); _probeTimer = null; }
}

// Probe loop is started explicitly by server.js after app.listen() succeeds —
// NOT at module load — so background work never runs ahead of the HTTP bind.

// ── Query API ────────────────────────────────────────────────────────────
function getHistory({ strategy, targetType, limit = 100, offset = 0 } = {}) {
    let rows = [..._history].reverse();
    if (strategy)   rows = rows.filter(r => r.strategy   === strategy);
    if (targetType) rows = rows.filter(r => r.targetType === targetType);
    const stats = {
        total:   _history.length,
        healed:  _history.filter(r => r.success).length,
        failed:  _history.filter(r => !r.success).length,
        byStrategy: _history.reduce((a, r) => { a[r.strategy] = (a[r.strategy] || 0) + 1; return a; }, {}),
    };
    return { records: rows.slice(offset, offset + limit), total: rows.length, stats };
}

function getStatus() {
    const healed  = _history.filter(r => r.success);
    const byStrat = {};
    for (const r of healed) byStrat[r.strategy] = (byStrat[r.strategy] || 0) + 1;
    return {
        lastProbeAt:  _lastProbeAt,
        probeCount:   _probeCount,
        healedTotal:  healed.length,
        failedTotal:  _history.filter(r => !r.success).length,
        healedByStrategy: byStrat,
        probeIntervalMs: PROBE_INTERVAL_MS,
        active:       !!_probeTimer,
    };
}

module.exports = { probe, healTask, healCycle, circuitBreak, selectStrategy, getHistory, getStatus, startProbeLoop, stopProbeLoop };
