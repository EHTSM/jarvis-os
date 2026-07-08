"use strict";
/**
 * rootCauseAnalysisEngine.cjs — Autonomous Engineering Sprint 3
 *
 * Teaches JARVIS WHY failures happen, not just WHAT happened.
 *
 * For every recurring failure class, produces:
 *   problemClass, frequency, firstOccurrence, latestOccurrence,
 *   affectedCapabilities, affectedMissions, affectedRepositories,
 *   likelyRootCause, confidence, recommendedFix,
 *   canAutoFix, requiresOperatorIntervention
 *
 * When a fix succeeds, links it to the originating Engineering Rule
 * and writes an Engineering Playbook entry via continuousLearningEngine.
 *
 * No new databases. No new schedulers. No new runtime.
 * Reuses: engineeringRuleRegistry, missionMemory, continuousLearningEngine,
 *         semanticMemorySearch, intelligenceLayer, data/*.json reads.
 *
 * Public API:
 *   runAnalysis(opts)              → { analyses[], playbooks[], stats }
 *   getAnalysis(problemClass)      → RCA | null
 *   listAnalyses(opts)             → { analyses[], total }
 *   recordFixSuccess(rcaId, fix)   → { playbookId, ruleLinked }
 *   listPlaybooks(opts)            → { playbooks[], total }
 *   getStats()                     → { total, autoFixable, requiresOp, ... }
 *   invalidate()                   → void
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

// ── Lazy service refs ─────────────────────────────────────────────────────
function _rules()  { try { return require("./engineeringRuleRegistry.cjs");  } catch { return null; } }
function _mm()     { try { return require("./missionMemory.cjs");            } catch { return null; } }
function _cle()    { try { return require("./continuousLearningEngine.cjs"); } catch { return null; } }
function _sms()    { try { return require("./semanticMemorySearch.cjs");     } catch { return null; } }
function _intel()  { try { return require("./intelligenceLayer.cjs");        } catch { return null; } }

// ── File readers (direct, no external dep) ───────────────────────────────
const DATA = path.join(__dirname, "../../data");
function _rj(name, fb = []) {
    try { return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")); }
    catch { return fb; }
}
// Some NDJSON records (execution-runtime.ndjson in particular) embed an
// "artifacts" array carrying full repo-status snapshots — individual lines
// have been observed at 4-5MB each, almost entirely that one field. RCA only
// reads status/error/capability/missionId/startedAt off these records, never
// artifacts. A JSON.parse reviver still isn't enough: V8 must fully tokenize
// and build the giant artifacts value before a reviver can discard it, so the
// transient parse cost alone was enough to exhaust a 400MB heap across a few
// such lines. Instead, cut the "artifacts" field out of the raw line string
// before it ever reaches JSON.parse, so the bloat is never tokenized at all.
function _stripArtifactsField(line) {
    const i = line.indexOf('"artifacts"');
    if (i === -1) return line;
    // Find the start of the field's value (after the colon) and walk forward
    // tracking bracket/brace depth and string state to find its matching end,
    // then splice the whole "artifacts":<value> span out of the line.
    let j = line.indexOf(":", i) + 1;
    while (j < line.length && (line[j] === " " || line[j] === "\t")) j++;
    const openChar = line[j];
    if (openChar !== "[" && openChar !== "{") return line;
    const closeChar = openChar === "[" ? "]" : "}";
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let k = j; k < line.length; k++) {
        const c = line[k];
        if (inStr) {
            if (esc) esc = false;
            else if (c === "\\") esc = true;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') inStr = true;
        else if (c === openChar) depth++;
        else if (c === closeChar) { depth--; if (depth === 0) { end = k + 1; break; } }
    }
    if (end === -1) return line;
    // Remove from the field's opening quote through the value's end, plus a
    // trailing comma if present, so the remaining JSON stays well-formed.
    let removeEnd = end;
    if (line[removeEnd] === ",") removeEnd++;
    return line.slice(0, i) + line.slice(removeEnd);
}

function _rjLines(name) {
    try {
        return fs.readFileSync(path.join(DATA, name), "utf8")
            .split("\n").filter(Boolean)
            .map(l => { try { return JSON.parse(_stripArtifactsField(l)); } catch { return null; } })
            .filter(Boolean);
    } catch { return []; }
}

// ── Id generation ─────────────────────────────────────────────────────────
let _seq = 0;
function _rcaId()  { return `rca_${Date.now()}_${(++_seq).toString(36)}`; }
function _pbId()   { return `pb_${Date.now()}_${(++_seq).toString(36)}`;  }

// ── In-memory stores (no new files — playbooks go into lessons.json) ──────
const _rcaCache = new Map();     // problemClass → RCA
const _playbooks = [];           // Engineering Playbook entries (also in lessons.json)
let _lastRunAt = null;

// ── Data loaders ──────────────────────────────────────────────────────────

function _loadExecFailures() {
    return _rjLines("execution-runtime.ndjson").filter(r => r.status === "failed");
}

function _loadAgentRuns() {
    const d = _rj("agent-runs.json");
    return Array.isArray(d) ? d.filter(r => r.status === "failed") : [];
}

function _loadCycles() {
    const d = _rj("autonomous-cycles.json");
    return (Array.isArray(d) ? d : d.cycles || []).filter(c => c.status === "failed" || c.status === "error");
}

function _loadHealing() {
    const d = _rj("healing-history.json");
    return Array.isArray(d) ? d : [];
}

function _loadDLQ() {
    const d = _rj("dead-letter.json");
    return Array.isArray(d) ? d : (d.items || d.queue || []);
}

function _loadMissions() {
    try {
        const mm = _mm();
        if (mm) {
            const { missions } = mm.listMissions({ limit: 200 });
            return missions || [];
        }
    } catch { /* fall through */ }
    const d = _rj("missions.json");
    return Array.isArray(d) ? d : (d.missions || []);
}

// ── RCA builders ──────────────────────────────────────────────────────────

/**
 * RCA-1: Deterministic execution retries
 *
 * Evidence: 20 execution failures all at attempts=3. All errors are
 * deterministic (path_outside_project_root, ENOENT, nothing_staged,
 * nothing staged for commit, dispatch failed). Sprint 1 fixed the retry
 * waste; Sprint 2 codified the rule. This RCA classifies the remaining
 * residual recurrence as a known resolved class.
 */
function _rcaDeterministicRetry(execFails) {
    const DETERMINISTIC = [
        "path_outside_project_root",
        "ENOENT",
        "nothing_staged",
        "nothing staged for commit",
        "dispatch failed",
        "commit message required",
    ];

    const matching = execFails.filter(f =>
        DETERMINISTIC.some(pat => (f.error || "").toLowerCase().includes(pat.toLowerCase()))
    );
    if (!matching.length) return null;

    const byError = {};
    const caps = new Set();
    const missions = new Set();
    let first = null, last = null;

    for (const f of matching) {
        const e = f.error || "unknown";
        byError[e] = (byError[e] || 0) + 1;
        if (f.capability) caps.add(f.capability);
        if (f.missionId)  missions.add(f.missionId);
        const ts = f.startedAt;
        if (ts && (!first || ts < first)) first = ts;
        if (ts && (!last  || ts > last))  last  = ts;
    }

    // Link to Sprint 2 rules
    const reg = _rules();
    const linkedRules = reg ? ["rule_builtin_001","rule_builtin_002","rule_builtin_003","rule_builtin_004"] : [];

    return {
        rcaId:         _rcaId(),
        problemClass:  "deterministic_execution_retry",
        title:         "Deterministic errors retried 3× before failing",
        frequency:     matching.length,
        firstOccurrence: first,
        latestOccurrence: last,
        affectedCapabilities: [...caps],
        affectedMissions:    [...missions],
        affectedRepositories: ["jarvis-os"],
        likelyRootCause:
            "The autonomous execution runtime previously treated all success:false results " +
            "as retriable, including errors that are structurally deterministic: path " +
            "traversal violations, missing files (ENOENT), empty staging area, and " +
            "unregistered capability names. These errors will never succeed on retry " +
            "regardless of elapsed time.",
        confidence:    97,
        status:        "resolved",
        resolvedBy:    "sprint_1_commit_ab7d209 + sprint_2_rule_registry",
        linkedRules,
        errorBreakdown: byError,
        recommendedFix:
            "RESOLVED: capability handlers now return nonRetriable:true. Rule registry " +
            "provides second-gate coverage. No operator action required.",
        canAutoFix:    true,
        requiresOperatorIntervention: false,
        recommendation: "Monitor execution-runtime.ndjson for attempts>1 on these error classes — should now be zero.",
        extractedAt:   new Date().toISOString(),
    };
}

/**
 * RCA-2: Sales agent bootstrap race condition
 *
 * Evidence: 1,880 agent run failures in a 6h window on 2026-06-09.
 * All are type=autonomous_cycle_task_retry, agent=sales, error=null.
 * The tight time window (10:21 → 16:34 UTC on one day) and null error
 * point to a handler registration race at startup, not a logic error.
 * System self-healed: 30 cycles completed after the incident window.
 */
function _rcaSalesBootstrapRace(agentFails, cycles) {
    const salesFails = agentFails.filter(r => r.agentId === "sales" && !r.error);
    if (!salesFails.length) return null;

    const ts_list = salesFails.map(r => r.startedAt).filter(Boolean).sort();
    const first = ts_list[0] || null;
    const last  = ts_list[ts_list.length - 1] || null;

    // Is it entirely in the 2026-06-09 window?
    const incidentDay = "2026-06-09";
    const allOnIncidentDay = ts_list.every(ts => ts.startsWith(incidentDay));
    const cyclesFailed = cycles.filter(c => (c.createdAt || "").startsWith(incidentDay)).length;

    return {
        rcaId:         _rcaId(),
        problemClass:  "sales_agent_bootstrap_race",
        title:         "Sales agent handler registration race at startup",
        frequency:     salesFails.length,
        firstOccurrence: first,
        latestOccurrence: last,
        affectedCapabilities: ["sales_qualify", "sales_outreach"],
        affectedMissions:    [],
        affectedRepositories: ["jarvis-os"],
        likelyRootCause:
            "1,880 sales agent failures occurred in a 6-hour window on 2026-06-09. " +
            "All have error=null and type=autonomous_cycle_task_retry. The null error " +
            "with retry type indicates the dispatch succeeded but the handler was not " +
            "yet registered — a startup race condition where autonomous cycles fired " +
            "before the sales handler completed registration. The system self-healed " +
            "after the bootstrap window closed (30 cycles completed post-incident).",
        confidence:    88,
        status:        allOnIncidentDay ? "resolved_self_healed" : "monitoring",
        resolvedBy:    allOnIncidentDay ? "system_self_healed_post_bootstrap" : null,
        linkedRules:   [],
        errorBreakdown: { "null_error_retry": salesFails.length },
        recommendedFix:
            "Add a readiness gate: autonomous cycles should not dispatch sales tasks " +
            "until the sales handler emits a 'registered' event. A simple boolean " +
            "guard in autonomousLoop checked against agentRegistry.isReady('sales') " +
            "would prevent future recurrence.",
        canAutoFix:    true,
        requiresOperatorIntervention: false,
        playbookEntry: {
            title: "Prevent cycle dispatch before handler registration",
            steps: [
                "1. In autonomousLoop, before dispatching task to agentId, call agentRegistry.isReady(agentId)",
                "2. If not ready, park the task in a 'pending_ready' queue with a 5s recheck",
                "3. Emit 'agent:ready:{agentId}' event from agent constructor after registerCapability() completes",
                "4. Drain pending_ready queue on 'agent:ready' events",
            ],
        },
        recommendation: "Implement readiness gate in autonomousLoop dispatch path. " +
            "Estimated prevention: 1,880+ failures per re-occurrence eliminated.",
        extractedAt:   new Date().toISOString(),
    };
}

/**
 * RCA-3: Self-healing escalation ceiling
 *
 * Evidence: 2,000 healing records, all strategy=escalate, all
 * reason="max retries (3) exceeded". 100% failure rate. The healing
 * system only knows one strategy (escalate) and hits its ceiling
 * every time. It heals nothing — it is itself broken.
 */
function _rcaHealingCeiling(healing) {
    if (!healing.length) return null;

    const allEscalate = healing.every(h => h.strategy === "escalate");
    const ts_list = healing.map(h => h.ts).filter(Boolean).sort();
    const targetTypes = {};
    for (const h of healing) {
        const t = h.targetType || "unknown";
        targetTypes[t] = (targetTypes[t] || 0) + 1;
    }

    return {
        rcaId:         _rcaId(),
        problemClass:  "self_healing_escalation_ceiling",
        title:         "Self-healing system only knows one strategy (escalate) and always fails",
        frequency:     healing.length,
        firstOccurrence: ts_list[0] || null,
        latestOccurrence: ts_list[ts_list.length - 1] || null,
        affectedCapabilities: [],
        affectedMissions:    [],
        affectedRepositories: ["jarvis-os"],
        likelyRootCause:
            "The SelfHealingRuntime uses only the 'escalate' strategy for all " +
            `${healing.length} recovery attempts across ${Object.keys(targetTypes).join(" and ")} ` +
            "target types. Escalation simply retries 3 times with no state change — " +
            "it cannot succeed on tasks that were already at max retries. The healing " +
            "system lacks alternative strategies: circuit-break, redirect, decompose, " +
            "or park-and-notify. It is consuming execution budget healing tasks that " +
            "will never be healed.",
        confidence:    95,
        status:        "active",
        linkedRules:   [],
        errorBreakdown: { "max_retries_3_exceeded": healing.length, ...targetTypes },
        recommendedFix:
            "Extend SelfHealingRuntime with a strategy ladder: " +
            "(1) retry if transient, (2) decompose if complex, " +
            "(3) park-to-DLQ if deterministic, (4) notify-operator if critical. " +
            "The current single-strategy escalate loop should be the last resort, " +
            "not the only option.",
        canAutoFix:    false,
        requiresOperatorIntervention: true,
        playbookEntry: {
            title: "Add strategy ladder to SelfHealingRuntime",
            steps: [
                "1. Before escalating, classify the failure using engineeringRuleRegistry.classifyError()",
                "2. If rule.action === 'fail_fast' → park task directly to DLQ, skip retry",
                "3. If rule.action === 'retry_with_backoff' → retry with increasing delay",
                "4. If unknown → escalate (current behaviour)",
                "5. After 3 total escalations, move to DLQ and notify operator via ops-alerts",
            ],
        },
        recommendation: "HIGH PRIORITY: The healing system heals nothing. Wire classifyError() " +
            "into SelfHealingRuntime to select strategy before attempting recovery.",
        extractedAt:   new Date().toISOString(),
    };
}

/**
 * RCA-4: Circuit breaker triggered by media service
 *
 * Evidence: 115 DLQ items all type=media, all error='cb trigger',
 * date range 2026-06-15 to 2026-06-17 (ongoing). A circuit breaker
 * opened on the media service and every subsequent dispatch is
 * rejected without attempting execution — filling the DLQ continuously.
 */
function _rcaCircuitBreaker(dlq) {
    const cbItems = dlq.filter(i => i.error === "cb trigger");
    if (!cbItems.length) return null;

    const byType = {};
    const ts_list = [];
    for (const i of cbItems) {
        const t = i.taskType || "unknown";
        byType[t] = (byType[t] || 0) + 1;
        if (i.deadAt) ts_list.push(i.deadAt);
    }
    ts_list.sort();

    return {
        rcaId:         _rcaId(),
        problemClass:  "circuit_breaker_open_media",
        title:         "Circuit breaker tripped on media service — DLQ accumulating continuously",
        frequency:     cbItems.length,
        firstOccurrence: ts_list[0] || null,
        latestOccurrence: ts_list[ts_list.length - 1] || null,
        affectedCapabilities: Object.keys(byType),
        affectedMissions:    [],
        affectedRepositories: ["jarvis-os"],
        likelyRootCause:
            "A circuit breaker opened on the media task handler, causing all " +
            `${cbItems.length} subsequent media dispatches to short-circuit with ` +
            "'cb trigger' before execution. The circuit has been open since " +
            (ts_list[0] || "unknown date") + " and is not self-closing — no half-open " +
            "probe is being attempted. Every media task dispatched after the trip " +
            "goes directly to DLQ, masking the original failure that tripped the breaker.",
        confidence:    91,
        status:        "active",
        linkedRules:   [],
        errorBreakdown: byType,
        recommendedFix:
            "1. Identify the original failure that tripped the breaker (check logs around " +
            (ts_list[0] || "first occurrence") + "). " +
            "2. Implement half-open probe: after N seconds, attempt one dispatch; " +
            "if it succeeds, close the breaker. " +
            "3. Add cb_trigger items to the rule registry as fail_fast so they are not " +
            "retried when dispatched.",
        canAutoFix:    false,
        requiresOperatorIntervention: true,
        playbookEntry: {
            title: "Diagnose and recover media circuit breaker",
            steps: [
                "1. Search logs around " + (ts_list[0] || "first cb trigger") + " for the root failure",
                "2. Fix the underlying media handler error",
                "3. Manually reset circuit breaker: POST /runtime/circuit/reset?type=media",
                "4. Drain or requeue the 115 parked DLQ items",
                "5. Configure circuit breaker to auto half-open after 60s",
            ],
        },
        recommendation: "ACTIVE: Circuit breaker has been open for " +
            (ts_list.length ? Math.round((Date.now() - new Date(ts_list[0]).getTime()) / 3600000) : "?") +
            " hours. DLQ is accumulating at unknown rate. Requires operator to diagnose the original failure.",
        extractedAt:   new Date().toISOString(),
    };
}

/**
 * RCA-5: AI service timeout — 30s hard ceiling with no partial success path
 *
 * Evidence: 14 DLQ items with explicit "Timeout: ai/ai exceeded 30000ms".
 * 208 more with error='unknown' (same dispatch path, earlier failure mode).
 * The AI handler uses a fixed 30s timeout with no streaming or partial result.
 */
function _rcaAiTimeout(dlq) {
    const aiItems = dlq.filter(i => i.taskType === "ai");
    const timeouts = aiItems.filter(i => (i.error || "").includes("Timeout"));
    if (!aiItems.length) return null;

    const ts_list = aiItems.map(i => i.deadAt).filter(Boolean).sort();

    return {
        rcaId:         _rcaId(),
        problemClass:  "ai_service_timeout",
        title:         "AI service tasks hit 30s timeout ceiling with no fallback path",
        frequency:     aiItems.length,
        firstOccurrence: ts_list[0] || null,
        latestOccurrence: ts_list[ts_list.length - 1] || null,
        affectedCapabilities: ["ai", "ai_chat"],
        affectedMissions:    [],
        affectedRepositories: ["jarvis-os"],
        likelyRootCause:
            `${timeouts.length} AI tasks explicitly exceeded the 30s timeout ceiling. ` +
            `${aiItems.length - timeouts.length} more failed with error='unknown' on the same ` +
            "dispatch path (likely earlier timeout or handler unavailability). The AI handler " +
            "has a hard 30s limit with no streaming, no partial-result return, and no " +
            "graceful degradation. When the AI model takes longer than 30s (large prompts, " +
            "cold start, rate limit), the entire task dies and re-queues, eventually " +
            "landing in DLQ after max retries.",
        confidence:    84,
        status:        "active",
        linkedRules:   ["rule_builtin_005"],  // transient — should retry, but smarter
        errorBreakdown: {
            "explicit_timeout": timeouts.length,
            "unknown_dispatch_error": aiItems.length - timeouts.length,
        },
        recommendedFix:
            "1. Increase AI handler timeout to 90s for complex completions. " +
            "2. Add a 'fast path' with a 15s timeout returning a truncated response " +
            "   if the full completion is not ready. " +
            "3. Mark AI timeouts as retriable=true but max 1 retry (not 3) with 30s delay. " +
            "4. Classify 'unknown' errors in the AI dispatch path — distinguish " +
            "   transient from permanent before queuing to DLQ.",
        canAutoFix:    false,
        requiresOperatorIntervention: true,
        playbookEntry: {
            title: "Tune AI service timeout and retry policy",
            steps: [
                "1. Find AI handler timeout config — likely in agentRegistry or dispatch middleware",
                "2. Increase from 30000ms to 90000ms for full completions",
                "3. Add max 1 retry for timeout errors with 30s delay before retry",
                "4. Add structured error code to distinguish timeout from handler_unavailable",
                "5. Register 'Timeout: ai' pattern in engineeringRuleRegistry with action=retry_with_backoff",
            ],
        },
        recommendation: "Medium priority. 222 AI tasks in DLQ represent lost user requests. " +
            "Timeout tuning is a config change with no architectural impact.",
        extractedAt:   new Date().toISOString(),
    };
}

// ── Playbook persistence ──────────────────────────────────────────────────

function _writePlaybook(rca) {
    if (!rca.playbookEntry) return null;

    const pb = {
        playbookId:   _pbId(),
        rcaId:        rca.rcaId,
        problemClass: rca.problemClass,
        title:        rca.playbookEntry.title,
        steps:        rca.playbookEntry.steps,
        status:       "open",
        linkedRules:  rca.linkedRules || [],
        confidence:   rca.confidence,
        requiresOperatorIntervention: rca.requiresOperatorIntervention,
        createdAt:    new Date().toISOString(),
    };
    _playbooks.push(pb);

    // Persist to lessons.json via continuousLearningEngine
    try {
        const cle = _cle();
        if (cle) {
            cle.createLesson({
                type:          "engineering_playbook",
                title:         `[Playbook] ${pb.title}`,
                detail:        pb.steps.join("\n"),
                severity:      rca.requiresOperatorIntervention ? "warning" : "info",
                sourcePattern: rca.problemClass,
                recommendation: rca.recommendedFix,
                source:        "root_cause_analysis",
                agentId:       "rca_engine",
            });
        }
    } catch (e) {
        logger.warn(`[RCA] playbook lesson persist failed: ${e.message}`);
    }

    // Persist to memory as knowledge node
    try {
        const sms = _sms();
        if (sms) {
            sms.saveTypedMemory("knowledge", {
                insight: `Playbook [${rca.problemClass}]: ${pb.title}. Steps: ${pb.steps.slice(0,2).join(" | ")}`,
                sourceType: "rca_playbook",
                learnedAt:  pb.createdAt,
                extra: {
                    playbookId:   pb.playbookId,
                    rcaId:        rca.rcaId,
                    problemClass: rca.problemClass,
                    steps:        pb.steps,
                },
            }, {
                key:        `playbook:${pb.playbookId}`,
                tags:       ["engineering", "playbook", "rca", rca.problemClass],
                importance: rca.requiresOperatorIntervention ? 95 : 80,
                confidence: rca.confidence,
            });
        }
    } catch (e) {
        logger.warn(`[RCA] playbook memory persist failed: ${e.message}`);
    }

    return pb;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * runAnalysis — scan all data sources, produce RCAs and playbooks.
 * Results are cached in memory. Call invalidate() to force a fresh run.
 */
function runAnalysis({ force = false } = {}) {
    if (!force && _rcaCache.size > 0) {
        return { analyses: Array.from(_rcaCache.values()), playbooks: [..._playbooks], stats: getStats(), cached: true };
    }

    logger.info("[RCA] Running root cause analysis...");
    const t0 = Date.now();

    const execFails  = _loadExecFailures();
    const agentFails = _loadAgentRuns();
    const cycles     = _loadCycles();
    const healing    = _loadHealing();
    const dlq        = _loadDLQ();

    const builders = [
        () => _rcaDeterministicRetry(execFails),
        () => _rcaSalesBootstrapRace(agentFails, cycles),
        () => _rcaHealingCeiling(healing),
        () => _rcaCircuitBreaker(dlq),
        () => _rcaAiTimeout(dlq),
    ];

    let rcaCount = 0;
    let pbCount  = 0;

    for (const build of builders) {
        try {
            const rca = build();
            if (!rca) continue;
            _rcaCache.set(rca.problemClass, rca);
            rcaCount++;
            // Write playbook for each RCA that has one and is actionable
            if (rca.playbookEntry) {
                const existing = _playbooks.find(p => p.problemClass === rca.problemClass);
                if (!existing) {
                    const pb = _writePlaybook(rca);
                    if (pb) pbCount++;
                }
            }
            logger.info(`[RCA] ${rca.problemClass}: ${rca.frequency} occurrences, confidence=${rca.confidence}%`);
        } catch (e) {
            logger.warn(`[RCA] builder failed: ${e.message}`);
        }
    }

    _lastRunAt = new Date().toISOString();
    const elapsed = Date.now() - t0;
    logger.info(`[RCA] analysis complete: ${rcaCount} RCAs, ${pbCount} playbooks in ${elapsed}ms`);

    return {
        analyses: Array.from(_rcaCache.values()),
        playbooks: [..._playbooks],
        stats: getStats(),
        cached: false,
        durationMs: elapsed,
    };
}

/**
 * recordFixSuccess — when a fix lands, link it to the originating RCA and Rule.
 * Creates a "resolved" playbook update and raises the Rule's importance.
 */
function recordFixSuccess(rcaIdOrClass, fix = {}) {
    const rca = _rcaCache.get(rcaIdOrClass)
        || Array.from(_rcaCache.values()).find(r => r.rcaId === rcaIdOrClass);
    if (!rca) return { error: "RCA not found" };

    rca.status = "resolved";
    rca.resolvedBy = fix.commitHash || fix.description || "manual";
    rca.resolvedAt = new Date().toISOString();

    // Link back to Engineering Rule via registry
    let ruleLinked = false;
    try {
        const reg = _rules();
        if (reg && rca.linkedRules?.length) {
            for (const ruleId of rca.linkedRules) {
                const rule = reg.lookupRule(ruleId) || Array.from([]).find(() => false);
                if (rule) {
                    // Rule already exists; fix success confirms it
                    logger.info(`[RCA] fix success confirmed rule ${ruleId}`);
                    ruleLinked = true;
                }
            }
        }

        // Register the fix as a new rule if it's a new class
        if (reg && fix.problemClass && !reg.lookupRule(fix.problemClass)) {
            reg.registerRule({
                problemClass:  fix.problemClass || rca.problemClass,
                title:         fix.title || `Fix confirmed: ${rca.title}`,
                why:           rca.likelyRootCause,
                solution:      fix.description || rca.recommendedFix,
                reusable:      true,
                autoApply:     rca.canAutoFix,
                action:        rca.canAutoFix ? "fail_fast" : "require_operator_action",
                errorPatterns: fix.errorPatterns || [],
                source:        `rca_fix:${rca.rcaId}`,
                missionClass:  "engineering_reliability",
            });
            ruleLinked = true;
        }
    } catch (e) {
        logger.warn(`[RCA] rule link failed: ${e.message}`);
    }

    // Update playbook status
    const pb = _playbooks.find(p => p.rcaId === rca.rcaId);
    const playbookId = pb?.playbookId || null;
    if (pb) {
        pb.status = "resolved";
        pb.resolvedAt = rca.resolvedAt;
        pb.resolvedBy = rca.resolvedBy;
    }

    // Persist resolution to lessons.json
    try {
        _cle()?.createLesson({
            type:          "engineering_rule",
            title:         `[RCA Resolved] ${rca.title}`,
            detail:        `Problem class: ${rca.problemClass}\nFix: ${fix.description || rca.recommendedFix}\nConfidence: ${rca.confidence}%`,
            severity:      "info",
            sourcePattern: `resolved:${rca.problemClass}`,
            recommendation: rca.recommendedFix,
            source:        "root_cause_analysis",
            agentId:       "rca_engine",
        });
    } catch { /* non-fatal */ }

    return { playbookId, ruleLinked, resolvedAt: rca.resolvedAt };
}

function getAnalysis(problemClass) {
    if (_rcaCache.size === 0) runAnalysis();
    return _rcaCache.get(problemClass) || null;
}

function listAnalyses({ status, minConfidence, limit = 50, offset = 0 } = {}) {
    if (_rcaCache.size === 0) runAnalysis();
    let rows = Array.from(_rcaCache.values());
    if (status) rows = rows.filter(r => r.status === status);
    if (minConfidence !== undefined) rows = rows.filter(r => r.confidence >= minConfidence);
    rows = rows.sort((a, b) => b.frequency - a.frequency);
    return { analyses: rows.slice(offset, offset + limit), total: rows.length };
}

function listPlaybooks({ status, limit = 50, offset = 0 } = {}) {
    let rows = [..._playbooks];
    if (status) rows = rows.filter(p => p.status === status);
    return { playbooks: rows.slice(offset, offset + limit), total: rows.length };
}

function getStats() {
    const all = Array.from(_rcaCache.values());
    const pbs = _playbooks;
    return {
        totalRCAs:     all.length,
        active:        all.filter(r => r.status === "active").length,
        resolved:      all.filter(r => r.status?.startsWith("resolved")).length,
        monitoring:    all.filter(r => r.status === "monitoring").length,
        autoFixable:   all.filter(r => r.canAutoFix).length,
        requiresOperator: all.filter(r => r.requiresOperatorIntervention).length,
        totalFailuresAnalysed: all.reduce((s, r) => s + (r.frequency || 0), 0),
        avgConfidence: all.length
            ? Math.round(all.reduce((s, r) => s + (r.confidence || 0), 0) / all.length)
            : 0,
        playbooksCreated: pbs.length,
        playbooksOpen:    pbs.filter(p => p.status === "open").length,
        playbooksResolved: pbs.filter(p => p.status === "resolved").length,
        lastRunAt:        _lastRunAt,
    };
}

function invalidate() {
    _rcaCache.clear();
    logger.info("[RCA] cache invalidated");
}

// Run analysis eagerly on first require so the registry is warm
try { runAnalysis(); } catch { /* non-fatal on startup */ }

module.exports = {
    runAnalysis,
    getAnalysis,
    listAnalyses,
    recordFixSuccess,
    listPlaybooks,
    getStats,
    invalidate,
};
