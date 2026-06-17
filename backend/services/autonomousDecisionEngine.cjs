"use strict";
/**
 * autonomousDecisionEngine.cjs — I2: Autonomous Decision Engine
 *
 * The brain of JARVIS. Consumes normalized observer events from
 * runtimeEventBus, applies deterministic rule-based reasoning to
 * produce structured Decision objects, and publishes outcomes back
 * through runtimeEventBus for downstream execution systems.
 *
 * Does NOT execute work. Decides what should happen.
 *
 * Decision categories:
 *   Ignore | Monitor | Notify | Recommend | Retry | Escalate |
 *   CreateMission | PauseMission | ResumeMission | RequestApproval | AutoRecover
 *
 * Public API:
 *   start()                        → { started, rulesLoaded }
 *   stop()                         → void
 *   getDecisions(opts)             → { decisions[], total }
 *   getDecision(id)                → decision | null
 *   getStatistics()                → { throughput, byAction, byPriority, latencyMs }
 *   replayEvent(observerEventId)   → decision | null
 *   getRules()                     → rules[]
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const logger = require("../utils/logger");

// ── Lazy service loaders ───────────────────────────────────────────────────
function _getBus()       { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
function _getMissionRT() { try { return require("../../agents/runtime/missionRuntime.cjs"); } catch { return null; } }
function _getMissionMem(){ try { return require("./missionMemory.cjs"); } catch { return null; } }
function _getAiSvc()     { try { return require("./aiService.js"); } catch { return null; } }
function _getObs()       { try { return require("./observabilityEngine.cjs"); } catch { return null; } }
function _getLoop()      { try { return require("../../agents/autonomousLoop.cjs"); } catch { return null; } }

// ── Paths ──────────────────────────────────────────────────────────────────
const DATA_DIR      = path.join(__dirname, "../../data");
const DECISIONS_FILE = path.join(DATA_DIR, "decisions.ndjson");
const STATE_FILE    = path.join(DATA_DIR, "decision-engine-state.json");

// ── ID generators ──────────────────────────────────────────────────────────
let _dseq = 0;
function _did() { return `dec_${Date.now()}_${(++_dseq).toString(36)}`; }

// ── Priority levels (lower number = higher priority) ───────────────────────
const PRIORITY = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 };

// ── Decision ring buffer (bounded 2 000) ───────────────────────────────────
const RING_SIZE   = 2_000;
const _ring       = [];      // newest at tail
let   _totalDecisions = 0;

function _pushDecision(d) {
    if (_ring.length >= RING_SIZE) _ring.shift();
    _ring.push(d);
    _totalDecisions++;
}

// ── Statistics ─────────────────────────────────────────────────────────────
const _byAction   = {};
const _byPriority = {};
const _latencies  = [];       // last 200 decision latency samples (ms)
const MAX_LAT_SAMPLES = 200;

function _recordStats(d, latencyMs) {
    _byAction[d.recommendedAction]   = (_byAction[d.recommendedAction]   || 0) + 1;
    _byPriority[d.priority]          = (_byPriority[d.priority]          || 0) + 1;
    if (_latencies.length >= MAX_LAT_SAMPLES) _latencies.shift();
    _latencies.push(latencyMs);
}

// ── Deduplication (60-second window per source+action) ────────────────────
const _dedupDecisions = new Map();   // key → lastTs
const DECISION_DEDUP_MS = 60_000;
let   _dedupHits = 0;

function _dedupKey(ev) {
    return crypto.createHash("sha1")
        .update(`${ev.source}|${ev.entity}|${ev.action}|${ev.severity}`)
        .digest("hex").slice(0, 16);
}

function _isDuplicate(ev) {
    const k    = _dedupKey(ev);
    const now  = Date.now();
    const last = _dedupDecisions.get(k);
    if (last && (now - last) < DECISION_DEDUP_MS) { _dedupHits++; return true; }
    _dedupDecisions.set(k, now);
    return false;
}

// ── Async NDJSON persist ───────────────────────────────────────────────────
let _pQueue = [];
let _pBusy  = false;

function _persist(d) {
    _pQueue.push(JSON.stringify(d) + "\n");
    if (_pBusy) return;
    _pBusy = true;
    setImmediate(_drain);
}

function _drain() {
    if (!_pQueue.length) { _pBusy = false; return; }
    const batch = _pQueue.splice(0).join("");
    fs.appendFile(DECISIONS_FILE, batch, "utf8", err => {
        if (err) logger.warn(`[DecisionEngine] persist error: ${err.message}`);
        _pBusy = false;
        if (_pQueue.length) setImmediate(_drain);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// RULE ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Each rule: { id, name, description, match(ev), decide(ev) → decision-fields }
 * Rules are evaluated in order. First match wins.
 * Deterministic — no AI required. AI may enrich reason string when available.
 */
const RULES = [

    // ── CRITICAL severity always escalates ───────────────────────────────
    {
        id: "R001", name: "critical-escalate", priority: 0,
        description: "Any CRITICAL severity event triggers immediate escalation with approval required",
        match: ev => ev.severity === "CRITICAL",
        decide: ev => ({
            recommendedAction: "Escalate",
            priority:          "CRITICAL",
            confidence:        1.0,
            requiresApproval:  true,
            estimatedImpact:   "high",
            reason:            `CRITICAL severity detected from ${ev.source} on entity "${ev.entity}" (action: ${ev.action})`,
        }),
    },

    // ── PM2 offline process: auto-recover if restart count low ───────────
    {
        id: "R002", name: "pm2-offline-auto-recover", priority: 1,
        description: "PM2 process offline with low restart count → AutoRecover",
        match: ev => ev.source === "pm2" && ev.action === "fleet_state_change"
            && Array.isArray(ev.metadata?.offline) && ev.metadata.offline.length > 0
            && (ev.metadata?.highRestart?.length ?? 0) === 0,
        decide: ev => ({
            recommendedAction: "AutoRecover",
            priority:          "HIGH",
            confidence:        0.9,
            requiresApproval:  false,
            estimatedImpact:   "medium",
            reason:            `PM2 processes offline: [${ev.metadata.offline.join(", ")}]. Restart count within threshold — auto-recovery safe.`,
        }),
    },

    // ── PM2 high restart count: escalate ─────────────────────────────────
    {
        id: "R003", name: "pm2-crash-loop-escalate", priority: 1,
        description: "PM2 process in crash loop (high restart count) → Escalate with approval",
        match: ev => ev.source === "pm2" && ev.action === "fleet_state_change"
            && Array.isArray(ev.metadata?.highRestart) && ev.metadata.highRestart.length > 0,
        decide: ev => ({
            recommendedAction: "Escalate",
            priority:          "HIGH",
            confidence:        0.95,
            requiresApproval:  true,
            estimatedImpact:   "high",
            reason:            `PM2 crash loop detected: [${ev.metadata.highRestart.join(", ")}]. Manual investigation required.`,
        }),
    },

    // ── Test failure: retry once, then escalate ────────────────────────
    {
        id: "R004", name: "test-failure-retry", priority: 2,
        description: "Test suite failure → Retry (first occurrence) or Escalate (repeat)",
        match: ev => ev.source === "tests" && ev.action === "tests_failed",
        decide: ev => {
            const failures = ev.metadata?.fail ?? 0;
            return {
                recommendedAction: "Retry",
                priority:          failures > 10 ? "HIGH" : "MEDIUM",
                confidence:        0.85,
                requiresApproval:  false,
                estimatedImpact:   "medium",
                reason:            `Test suite reported ${failures} failure(s). Scheduling re-run to distinguish fluke from regression.`,
            };
        },
    },

    // ── Build missing: recommend build ────────────────────────────────
    {
        id: "R005", name: "build-missing-recommend", priority: 2,
        description: "Frontend build artifact missing → Recommend build",
        match: ev => ev.source === "build" && ev.action === "build_missing",
        decide: () => ({
            recommendedAction: "Recommend",
            priority:          "MEDIUM",
            confidence:        1.0,
            requiresApproval:  false,
            estimatedImpact:   "medium",
            reason:            "Frontend build artifact not found. Running npm run build:frontend is required before serving.",
        }),
    },

    // ── Stale build (>4h): notify ─────────────────────────────────────
    {
        id: "R006", name: "build-stale-notify", priority: 2,
        description: "Build artifact older than 4 hours → Notify",
        match: ev => ev.source === "build" && ev.action === "build_age_update"
            && (ev.metadata?.ageMins ?? 0) > 240,
        decide: ev => ({
            recommendedAction: "Notify",
            priority:          "LOW",
            confidence:        0.9,
            requiresApproval:  false,
            estimatedImpact:   "low",
            reason:            `Frontend build is ${ev.metadata.ageMins} minutes old. Consider rebuilding if recent changes need to be served.`,
        }),
    },

    // ── Log error spike: escalate if high, notify if moderate ─────────
    {
        id: "R007", name: "log-error-spike-escalate", priority: 2,
        description: "High log error rate → Escalate",
        match: ev => ev.source === "logs" && ev.action === "error_rate_change"
            && (ev.metadata?.errorsLast5Min ?? 0) > 10,
        decide: ev => ({
            recommendedAction: "Escalate",
            priority:          "HIGH",
            confidence:        0.9,
            requiresApproval:  true,
            estimatedImpact:   "high",
            reason:            `${ev.metadata.errorsLast5Min} execution errors in the last 5 minutes — above escalation threshold (10).`,
        }),
    },

    {
        id: "R008", name: "log-error-moderate-notify", priority: 2,
        description: "Moderate log error rate → Notify",
        match: ev => ev.source === "logs" && ev.action === "error_rate_change"
            && (ev.metadata?.errorsLast5Min ?? 0) > 3,
        decide: ev => ({
            recommendedAction: "Notify",
            priority:          "MEDIUM",
            confidence:        0.85,
            requiresApproval:  false,
            estimatedImpact:   "medium",
            reason:            `${ev.metadata.errorsLast5Min} execution errors in the last 5 minutes — above warning threshold (3).`,
        }),
    },

    // ── Git merge conflict: escalate ──────────────────────────────────
    {
        id: "R009", name: "git-merge-conflict-escalate", priority: 1,
        description: "Git merge conflicts detected → Escalate",
        match: ev => ev.source === "git" && ev.action === "status_change"
            && ev.severity === "ERROR",
        decide: ev => ({
            recommendedAction: "Escalate",
            priority:          "HIGH",
            confidence:        0.95,
            requiresApproval:  true,
            estimatedImpact:   "high",
            reason:            `Git repository has conflicts on branch "${ev.entity}". Manual resolution required before work can continue.`,
        }),
    },

    // ── Git large uncommitted diff: recommend commit ───────────────────
    {
        id: "R010", name: "git-large-diff-recommend", priority: 3,
        description: "Many uncommitted files → Recommend commit",
        match: ev => ev.source === "git" && ev.action === "status_change"
            && (ev.metadata?.changedFiles ?? 0) > 20 && ev.severity !== "ERROR",
        decide: ev => ({
            recommendedAction: "Recommend",
            priority:          "LOW",
            confidence:        0.8,
            requiresApproval:  false,
            estimatedImpact:   "low",
            reason:            `${ev.metadata.changedFiles} uncommitted files on branch "${ev.entity}". Consider committing work-in-progress.`,
        }),
    },

    // ── Task queue failure accumulation: create mission ───────────────
    {
        id: "R011", name: "task-failures-create-mission", priority: 1,
        description: "Multiple failed tasks → Create recovery mission",
        match: ev => ev.source === "tasks" && ev.action === "queue_state_change"
            && (ev.metadata?.failed ?? 0) > 5,
        decide: ev => ({
            recommendedAction: "CreateMission",
            priority:          "HIGH",
            confidence:        0.85,
            requiresApproval:  true,
            estimatedImpact:   "high",
            reason:            `Task queue has ${ev.metadata.failed} failed tasks. A recovery mission should be created to investigate root cause.`,
        }),
    },

    // ── Task queue non-empty with no failures: monitor ────────────────
    {
        id: "R012", name: "task-queue-active-monitor", priority: 4,
        description: "Tasks running normally → Monitor",
        match: ev => ev.source === "tasks" && ev.action === "queue_state_change"
            && (ev.metadata?.running ?? 0) > 0 && (ev.metadata?.failed ?? 0) === 0,
        decide: ev => ({
            recommendedAction: "Monitor",
            priority:          "NONE",
            confidence:        1.0,
            requiresApproval:  false,
            estimatedImpact:   "none",
            reason:            `${ev.metadata.running} task(s) running normally, ${ev.metadata.pending} pending.`,
        }),
    },

    // ── No AI providers configured: escalate ─────────────────────────
    {
        id: "R013", name: "ai-no-providers-escalate", priority: 1,
        description: "No AI providers configured → Escalate",
        match: ev => ev.source === "ai" && ev.action === "provider_state_change"
            && (ev.metadata?.configured ?? 0) === 0,
        decide: () => ({
            recommendedAction: "Escalate",
            priority:          "HIGH",
            confidence:        1.0,
            requiresApproval:  true,
            estimatedImpact:   "high",
            reason:            "No AI providers are configured. JARVIS cannot use AI capabilities until at least one provider is set up.",
        }),
    },

    // ── High system heap: auto-recover ────────────────────────────────
    {
        id: "R014", name: "system-high-heap-auto-recover", priority: 2,
        description: "Process heap >512MB → AutoRecover (GC hint)",
        match: ev => ev.source === "system" && ev.action === "resource_snapshot"
            && (ev.metadata?.heapMb ?? 0) > 512,
        decide: ev => ({
            recommendedAction: "AutoRecover",
            priority:          "MEDIUM",
            confidence:        0.75,
            requiresApproval:  false,
            estimatedImpact:   "medium",
            reason:            `Process heap at ${ev.metadata.heapMb}MB (threshold: 512MB). Triggering GC hint and monitoring for escalation.`,
        }),
    },

    // ── High load average: notify ─────────────────────────────────────
    {
        id: "R015", name: "system-high-load-notify", priority: 3,
        description: "1-minute load avg >2.0 → Notify",
        match: ev => ev.source === "system" && ev.action === "resource_snapshot"
            && (ev.metadata?.loadAvg ?? 0) > 2.0,
        decide: ev => ({
            recommendedAction: "Notify",
            priority:          "MEDIUM",
            confidence:        0.8,
            requiresApproval:  false,
            estimatedImpact:   "medium",
            reason:            `System 1-minute load average is ${ev.metadata.loadAvg} (threshold: 2.0). Monitor for sustained elevation.`,
        }),
    },

    // ── Extension crashed: auto-recover ──────────────────────────────
    {
        id: "R016", name: "extension-crashed-auto-recover", priority: 2,
        description: "Extension in crashed state → AutoRecover (restart)",
        match: ev => ev.source === "extensions" && ev.action === "extension_state_change"
            && (ev.metadata?.crashed ?? 0) > 0,
        decide: ev => ({
            recommendedAction: "AutoRecover",
            priority:          "MEDIUM",
            confidence:        0.85,
            requiresApproval:  false,
            estimatedImpact:   "medium",
            reason:            `${ev.metadata.crashed} extension(s) in crashed state. Scheduling restart via extensionRuntime.`,
        }),
    },

    // ── Plugin error: notify ──────────────────────────────────────────
    {
        id: "R017", name: "plugin-error-notify", priority: 3,
        description: "Plugin(s) in error state → Notify",
        match: ev => ev.source === "plugins" && ev.action === "plugin_state_change"
            && (ev.metadata?.errored ?? 0) > 0,
        decide: ev => ({
            recommendedAction: "Notify",
            priority:          "MEDIUM",
            confidence:        0.9,
            requiresApproval:  false,
            estimatedImpact:   "medium",
            reason:            `${ev.metadata.errored} plugin(s) reporting health errors. Review plugin manager for details.`,
        }),
    },

    // ── Mission idle when tasks are queued: resume/create ─────────────
    {
        id: "R018", name: "mission-idle-tasks-pending", priority: 2,
        description: "Mission idle but tasks are pending → Recommend resume or create",
        match: ev => ev.source === "missions" && ev.action === "mission_idle",
        decide: () => ({
            recommendedAction: "Recommend",
            priority:          "LOW",
            confidence:        0.7,
            requiresApproval:  false,
            estimatedImpact:   "low",
            reason:            "No active mission. Consider creating or resuming a mission to direct autonomous work.",
        }),
    },

    // ── File change in backend: monitor ───────────────────────────────
    {
        id: "R019", name: "backend-file-changed-monitor", priority: 5,
        description: "Backend source file changed → Monitor",
        match: ev => ev.source === "files" && ev.category === "filesystem"
            && (ev.entity?.startsWith("backend/") || ev.entity?.startsWith("agents/")),
        decide: ev => ({
            recommendedAction: "Monitor",
            priority:          "NONE",
            confidence:        0.95,
            requiresApproval:  false,
            estimatedImpact:   "none",
            reason:            `Source file changed: ${ev.entity}. Monitoring for build/test impact.`,
        }),
    },

    // ── Catch-all: INFO events → Ignore ───────────────────────────────
    {
        id: "R099", name: "default-info-ignore", priority: 99,
        description: "Default: INFO severity events with no specific rule → Ignore",
        match: ev => ev.severity === "INFO",
        decide: ev => ({
            recommendedAction: "Ignore",
            priority:          "NONE",
            confidence:        1.0,
            requiresApproval:  false,
            estimatedImpact:   "none",
            reason:            `Informational event from ${ev.source} (${ev.action}) — no action required.`,
        }),
    },

    // ── Catch-all: WARN events without specific rule → Notify ─────────
    {
        id: "R100", name: "default-warn-notify", priority: 99,
        description: "Default: WARN severity events with no specific rule → Notify",
        match: ev => ev.severity === "WARN",
        decide: ev => ({
            recommendedAction: "Notify",
            priority:          "LOW",
            confidence:        0.7,
            requiresApproval:  false,
            estimatedImpact:   "low",
            reason:            `Warning from ${ev.source}: ${ev.action} on entity "${ev.entity}". Monitoring recommended.`,
        }),
    },

    // ── Catch-all: ERROR events without specific rule → Escalate ──────
    {
        id: "R101", name: "default-error-escalate", priority: 99,
        description: "Default: ERROR severity events with no specific rule → Escalate",
        match: ev => ev.severity === "ERROR",
        decide: ev => ({
            recommendedAction: "Escalate",
            priority:          "HIGH",
            confidence:        0.75,
            requiresApproval:  true,
            estimatedImpact:   "high",
            reason:            `Error condition from ${ev.source}: ${ev.action} on entity "${ev.entity}". Manual review required.`,
        }),
    },
];

// Sort by rule priority ascending (lower = evaluated first)
RULES.sort((a, b) => a.priority - b.priority);

// ── AI enrichment (optional, non-blocking) ────────────────────────────────
// If an AI provider is available, we may enrich the reason string.
// Never blocks; never changes the deterministic action.
async function _maybeEnrichReason(decision, observerEvent) {
    if (decision.recommendedAction === "Ignore") return decision;  // skip enrichment for ignores
    try {
        const ai = _getAiSvc();
        if (!ai) return decision;
        const ps = ai.getProviderStatus();
        const hasProvider = Object.values(ps).some(p => p.configured);
        if (!hasProvider) return decision;

        // Fire-and-forget enrichment — 2s timeout
        const prompt = `You are JARVIS decision auditor. One-sentence elaboration ONLY (no markdown, <50 words): Why is "${decision.recommendedAction}" the right action for this event?\nEvent: source=${observerEvent.source}, entity=${observerEvent.entity}, action=${observerEvent.action}, severity=${observerEvent.severity}\nBase reason: ${decision.reason}`;
        const enriched = await Promise.race([
            ai.callAI(prompt, { maxTokens: 80 }),
            new Promise(r => setTimeout(() => r(null), 2000)),
        ]);
        if (enriched && typeof enriched === "string" && enriched.trim().length > 0) {
            return { ...decision, reason: decision.reason + " [AI: " + enriched.trim().slice(0, 200) + "]" };
        }
    } catch { /* non-fatal — deterministic decision stands */ }
    return decision;
}

// ── Core: evaluate an observer event → produce decision ───────────────────
async function _evaluate(observerEvent) {
    const t0 = Date.now();

    // Dedup — skip if same source+entity+action+severity decided recently
    if (_isDuplicate(observerEvent)) return null;

    // Find first matching rule
    const rule = RULES.find(r => { try { return r.match(observerEvent); } catch { return false; } });
    if (!rule) return null;   // no rule matches — rare given catch-alls

    // Build deterministic decision fields
    const fields = rule.decide(observerEvent);

    let decision = {
        decisionId:        _did(),
        sourceEventId:     observerEvent.id || null,
        ruleId:            rule.id,
        ruleName:          rule.name,
        reason:            fields.reason,
        confidence:        fields.confidence,
        priority:          fields.priority,
        severity:          observerEvent.severity,
        recommendedAction: fields.recommendedAction,
        requiresApproval:  fields.requiresApproval,
        estimatedImpact:   fields.estimatedImpact,
        affectedSubsystem: observerEvent.source,
        affectedEntity:    observerEvent.entity,
        createdAt:         new Date().toISOString(),
        status:            "pending",
        observerCategory:  observerEvent.category,
        workspace:         observerEvent.workspace || "jarvis-os",
        metadata:          { observerAction: observerEvent.action, observerMetadata: observerEvent.metadata },
    };

    // Optional AI enrichment (non-blocking, 2s cap)
    decision = await _maybeEnrichReason(decision, observerEvent);

    const latencyMs = Date.now() - t0;

    // Persist + stats
    _pushDecision(decision);
    _recordStats(decision, latencyMs);
    _persist(decision);

    // Fan-out: publish decision on runtimeEventBus so mission runtime can react
    try {
        _getBus()?.emit("decision", {
            decisionId:        decision.decisionId,
            recommendedAction: decision.recommendedAction,
            priority:          decision.priority,
            requiresApproval:  decision.requiresApproval,
            affectedSubsystem: decision.affectedSubsystem,
            reason:            decision.reason,
            createdAt:         decision.createdAt,
            latencyMs,
        });
    } catch { /* non-fatal */ }

    // Record metric in observabilityEngine
    try {
        _getObs()?.recordMetric(`decisions.${decision.recommendedAction}`, 1, { priority: decision.priority });
    } catch { /* non-fatal */ }

    // Side-effects for high-priority actionable decisions
    _sideEffect(decision).catch(() => { /* non-fatal */ });

    logger.debug?.(`[DecisionEngine] ${decision.decisionId} rule=${rule.id} action=${decision.recommendedAction} latency=${latencyMs}ms`);
    return decision;
}

// ── Side effects: some decisions trigger lightweight system calls ──────────
// These are the only points where the Decision Engine touches execution systems.
// All execution is delegated — never direct.
async function _sideEffect(decision) {
    switch (decision.recommendedAction) {
        case "AutoRecover": {
            // Enqueue a recovery task into autonomousLoop — execution is its job
            if (!decision.requiresApproval) {
                try {
                    const loop = _getLoop();
                    if (loop) {
                        loop.addTask({
                            input: `[DecisionEngine] AutoRecover: ${decision.reason}`,
                            type:  "auto_recover",
                        });
                    }
                } catch { /* non-fatal */ }
            }
            break;
        }
        case "CreateMission": {
            // Queue a mission-creation task (requires approval, so we just notify)
            // Actual mission creation waits for operator approval
            break;
        }
        default:
            break;
    }
}

// ── Bus subscription ───────────────────────────────────────────────────────
let _running    = false;
let _startedAt  = null;
const SUB_ID    = "decision_engine_i2";

function start() {
    if (_running) return { started: false, reason: "already_running" };
    _running   = true;
    _startedAt = Date.now();

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    // Subscribe to runtimeEventBus for observer events
    const bus = _getBus();
    if (bus) {
        try {
            bus.subscribe(SUB_ID, (envelope) => {
                // envelope = { seq, ts, type, payload }
                if (envelope.type !== "observer") return;
                const observerEvent = envelope.payload;
                if (!observerEvent || !observerEvent.source) return;
                // Evaluate async — never blocks subscriber
                _evaluate(observerEvent).catch(err => {
                    logger.warn(`[DecisionEngine] evaluate error: ${err.message}`);
                });
            });
        } catch (err) {
            logger.warn(`[DecisionEngine] could not subscribe to event bus: ${err.message}`);
        }
    } else {
        logger.warn("[DecisionEngine] runtimeEventBus unavailable — decisions will not be triggered by live events");
    }

    // Sweep dedup map every 90s
    setInterval(() => {
        const cutoff = Date.now() - DECISION_DEDUP_MS;
        for (const [k, ts] of _dedupDecisions) {
            if (ts < cutoff) _dedupDecisions.delete(k);
        }
    }, 90_000).unref?.();

    _saveState();
    logger.info(`[DecisionEngine] I2 started — ${RULES.length} rules loaded`);
    return { started: true, rulesLoaded: RULES.length };
}

function stop() {
    _running = false;
    try { _getBus()?.unsubscribe(SUB_ID); } catch { /* ok */ }
    logger.info("[DecisionEngine] stopped");
}

// ── Public: getDecisions ───────────────────────────────────────────────────
function getDecisions({ limit = 100, action, priority, status, subsystem, since } = {}) {
    let list = [..._ring];
    if (action)    list = list.filter(d => d.recommendedAction === action);
    if (priority)  list = list.filter(d => d.priority          === priority);
    if (status)    list = list.filter(d => d.status            === status);
    if (subsystem) list = list.filter(d => d.affectedSubsystem === subsystem);
    if (since)     list = list.filter(d => d.createdAt         >= since);
    const total = list.length;
    return { decisions: list.slice(-Math.min(limit, 500)).reverse(), total };
}

// ── Public: getDecision ────────────────────────────────────────────────────
function getDecision(id) {
    return _ring.find(d => d.decisionId === id) || null;
}

// ── Public: getStatistics ──────────────────────────────────────────────────
function getStatistics() {
    const avg = _latencies.length
        ? Math.round(_latencies.reduce((a, b) => a + b, 0) / _latencies.length)
        : 0;
    const p99 = _latencies.length
        ? _latencies.slice().sort((a, b) => a - b)[Math.floor(_latencies.length * 0.99)]
        : 0;
    return {
        running:       _running,
        totalDecisions: _totalDecisions,
        dedupHits:     _dedupHits,
        rulesLoaded:   RULES.length,
        ringFill:      _ring.length,
        byAction:      { ..._byAction },
        byPriority:    { ..._byPriority },
        latency:       { avgMs: avg, p99Ms: p99, samples: _latencies.length },
        uptimeSec:     _startedAt ? Math.round((Date.now() - _startedAt) / 1000) : 0,
    };
}

// ── Public: replayEvent ────────────────────────────────────────────────────
// Re-evaluate a past observer event by ID (for debugging/testing).
async function replayEvent(observerEventId) {
    // Pull from the observer's ring buffer
    try {
        const observer = require("./continuousRuntimeObserver.cjs");
        const { events } = observer.getEvents({ limit: 1000 });
        const ev = events.find(e => e.id === observerEventId);
        if (!ev) return null;
        // Force-clear dedup for this key so replay always runs
        _dedupDecisions.delete(_dedupKey(ev));
        return await _evaluate(ev);
    } catch (err) {
        logger.warn(`[DecisionEngine] replayEvent error: ${err.message}`);
        return null;
    }
}

// ── Public: getRules ──────────────────────────────────────────────────────
function getRules() {
    return RULES.map(r => ({
        id:          r.id,
        name:        r.name,
        description: r.description,
        priority:    r.priority,
    }));
}

// ── Persist state ─────────────────────────────────────────────────────────
function _saveState() {
    try {
        const tmp = STATE_FILE + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify({ startedAt: _startedAt, version: "I2", rulesLoaded: RULES.length }, null, 2));
        fs.renameSync(tmp, STATE_FILE);
    } catch { /* non-fatal */ }
}

module.exports = { start, stop, getDecisions, getDecision, getStatistics, replayEvent, getRules };
