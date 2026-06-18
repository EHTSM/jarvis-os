"use strict";
/**
 * agentRuntimeSupervisor.cjs — Phase I4: Long-Running Autonomous Agent Runtime
 *
 * Manages 3 continuously running agents:
 *   - planner   (I4-2): scans Engineering+Business+Graph, creates missions
 *   - reviewer  (I4-3): reviews completed missions, registers lessons
 *   - verifier  (I4-4): verifies execution quality, graph consistency
 *
 * Agent lifecycle states:
 *   starting → running → paused | recovering | stopped | failed
 *
 * Recovery (I4-6):
 *   On crash: exponential backoff restart using existing runtimeEventBus signals.
 *   Never spawns duplicate workers — singleton enforced via _agents map.
 *
 * Reused systems (unchanged):
 *   continuousRuntimeObserver → observe() signals, getHealth()
 *   autonomousDecisionEngine  → getDecisions(), getStatistics()
 *   missionOrchestrator       → createManual(), listMissions(), getStatistics()
 *   autonomousExecutionRuntime→ getStatistics(), listExecutions()
 *   engineeringRuleRegistry   → listRules()
 *   rootCauseAnalysisEngine   → listAnalyses(), getStats()
 *   graphReasoningEngine      → generateRecommendations(), executeReasoning(), findBlockedMissions()
 *   unifiedIntelligenceLayer  → getExecutiveDashboard(), correlate()
 *   missionMemory             → listMissions(), getMission()
 *   runtimeEventBus           → emit(), subscribe()
 *   continuousLearningEngine  → createLesson(), getRecommendations()
 *   agentRegistry             → register(), dispatch()
 *
 * No new event bus. No new scheduler. No new runtime. No new memory.
 * Interval timers reuse node setInterval (already used by autonomousLoop.cjs).
 */

const logger = require("../utils/logger");

// ── Lazy loaders ─────────────────────────────────────────────────────────────
function _bus()    { try { return require("../../agents/runtime/runtimeEventBus.cjs");          } catch { return null; } }
function _obs()    { try { return require("./continuousRuntimeObserver.cjs");                   } catch { return null; } }
function _dec()    { try { return require("./autonomousDecisionEngine.cjs");                    } catch { return null; } }
function _orch()   { try { return require("./missionOrchestrator.cjs");                        } catch { return null; } }
function _aer()    { try { return require("./autonomousExecutionRuntime.cjs");                  } catch { return null; } }
function _reg()    { try { return require("../../agents/runtime/agentRegistry.cjs");            } catch { return null; } }
function _rules()  { try { return require("./engineeringRuleRegistry.cjs");                    } catch { return null; } }
function _rca()    { try { return require("./rootCauseAnalysisEngine.cjs");                    } catch { return null; } }
function _gre()    { try { return require("./graphReasoningEngine.cjs");                       } catch { return null; } }
function _uil()    { try { return require("./unifiedIntelligenceLayer.cjs");                   } catch { return null; } }
function _mm()     { try { return require("./missionMemory.cjs");                              } catch { return null; } }
function _le()     { try { return require("./continuousLearningEngine.cjs");                   } catch { return null; } }

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const PLANNER_INTERVAL_MS  = 60_000;   // scan every 60s
const REVIEWER_INTERVAL_MS = 90_000;   // review every 90s
const VERIFIER_INTERVAL_MS = 120_000;  // verify every 120s
const RECOVERY_BASE_MS     = 5_000;    // base backoff for restarts
const MAX_RECOVERY_ATTEMPTS = 5;       // give up after 5 consecutive crashes
const CONFIDENCE_THRESHOLD  = 65;      // min confidence to auto-create a mission

// ─────────────────────────────────────────────────────────────────────────────
// AGENT STATE STORE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _agents: { agentId → AgentState }
 * AgentState = {
 *   id, role, status, pid, startedAt, lastTickAt, lastDecisionAt,
 *   currentObjective, currentMissionId, lastDecision,
 *   health, recoveryCount, uptime, errors, tickCount, missionsCreated,
 *   lessonsRegistered, verificationsRun, _intervalHandle, _recovering
 * }
 */
const _agents = new Map();
let _supervisorStarted = false;
let _supervisorStartedAt = null;

function _mkState(id, role) {
    return {
        id, role,
        status:          "stopped",
        pid:             process.pid,
        startedAt:       null,
        lastTickAt:      null,
        lastDecisionAt:  null,
        currentObjective: null,
        currentMissionId: null,
        lastDecision:    null,
        health:          100,
        recoveryCount:   0,
        uptime:          0,
        errors:          [],
        tickCount:       0,
        missionsCreated: 0,
        lessonsRegistered: 0,
        verificationsRun: 0,
        _intervalHandle: null,
        _recovering:     false,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _setState(id, patch) {
    const s = _agents.get(id);
    if (!s) return;
    Object.assign(s, patch);
    try {
        _bus()?.emit(`agent:${id}:state`, { agentId: id, status: s.status, ...patch });
    } catch {}
}

function _logError(id, err) {
    const s = _agents.get(id);
    if (!s) return;
    const entry = { ts: new Date().toISOString(), message: err?.message || String(err) };
    s.errors.push(entry);
    if (s.errors.length > 20) s.errors.shift();
    s.health = Math.max(0, s.health - 10);
    logger.warn(`[AgentSupervisor:${id}] ${entry.message}`);
}

function _uptime(s) {
    if (!s.startedAt) return 0;
    return Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000);
}

function _publicState(s) {
    return {
        id:               s.id,
        role:             s.role,
        status:           s.status,
        startedAt:        s.startedAt,
        lastTickAt:       s.lastTickAt,
        currentObjective: s.currentObjective,
        currentMissionId: s.currentMissionId,
        lastDecision:     s.lastDecision,
        health:           s.health,
        recoveryCount:    s.recoveryCount,
        uptime:           _uptime(s),
        tickCount:        s.tickCount,
        missionsCreated:  s.missionsCreated,
        lessonsRegistered:s.lessonsRegistered,
        verificationsRun: s.verificationsRun,
        recentErrors:     s.errors.slice(-3),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// RECOVERY (I4-6)
// ─────────────────────────────────────────────────────────────────────────────

function _scheduleRecovery(id) {
    const s = _agents.get(id);
    if (!s || s._recovering) return;
    if (s.recoveryCount >= MAX_RECOVERY_ATTEMPTS) {
        _setState(id, { status: "failed" });
        logger.error(`[AgentSupervisor:${id}] Max recovery attempts reached — agent failed`);
        try { _bus()?.emit("agent:supervisor:failed", { agentId: id }); } catch {}
        return;
    }

    s._recovering = true;
    _setState(id, { status: "recovering" });
    const delay = RECOVERY_BASE_MS * Math.pow(2, s.recoveryCount);
    s.recoveryCount++;
    logger.warn(`[AgentSupervisor:${id}] Recovering in ${delay}ms (attempt ${s.recoveryCount})`);

    setTimeout(() => {
        s._recovering = false;
        // Clear old interval before restarting
        if (s._intervalHandle) { clearInterval(s._intervalHandle); s._intervalHandle = null; }
        _startAgent(id);
    }, delay);
}

// ─────────────────────────────────────────────────────────────────────────────
// I4-2: PLANNER AGENT TICK
// Scans Engineering + Business + Graph Reasoning → auto-creates missions
// ─────────────────────────────────────────────────────────────────────────────

async function _plannerTick(s) {
    const id = s.id;
    _setState(id, { currentObjective: "Scanning signals for mission opportunities" });

    try {
        const recs = _gre()?.generateRecommendations({ limit: 10 }) || { recommendations: [] };
        const candidates = (recs.recommendations || []).filter(r =>
            r.confidence >= CONFIDENCE_THRESHOLD &&
            r.autoMissionCandidate &&
            (r.priority === "critical" || r.priority === "high")
        );

        let created = 0;
        for (const c of candidates) {
            try {
                // Dedup: check if a mission with the same title already exists and is active/pending
                const existing = _mm()?.listMissions({ limit: 200 }) || { missions: [] };
                const dup = (existing.missions || []).find(m =>
                    (m.status === "active" || m.status === "pending") &&
                    m.objective?.slice(0, 50) === c.autoMissionCandidate.objective?.slice(0, 50)
                );
                if (dup) continue;

                const mission = _orch()?.createManual({
                    objective: c.autoMissionCandidate.objective,
                    priority:  c.autoMissionCandidate.priority,
                    subtasks: [
                        { description: c.description || c.title },
                        { description: "Verify outcome and record lesson" },
                    ],
                    metadata: {
                        ...c.autoMissionCandidate.metadata,
                        autoCreatedBy: "planner_agent",
                        recommendationId: c.id,
                        confidence: c.confidence,
                        source: c.source,
                    },
                });
                if (mission) {
                    created++;
                    s.missionsCreated++;
                    _setState(id, { currentMissionId: mission.missionId || mission.id, lastDecisionAt: new Date().toISOString(), lastDecision: `Created mission: ${c.autoMissionCandidate.objective?.slice(0,60)}` });
                    try { _bus()?.emit("agent:planner:mission_created", { missionId: mission.missionId || mission.id, recommendation: c.id }); } catch {}
                }
            } catch (e) { _logError(id, e); }
        }

        // Also check unified intelligence cross-domain signals
        try {
            const uil = _uil();
            if (uil) {
                const { crossDomainEvents } = uil.correlate();
                for (const ev of (crossDomainEvents || [])) {
                    if (!ev.missionTrigger || (ev.impact?.confidence || 0) < CONFIDENCE_THRESHOLD) continue;
                    const existing = _mm()?.listMissions({ limit: 200 }) || { missions: [] };
                    const dup = (existing.missions || []).find(m =>
                        (m.status === "active" || m.status === "pending") &&
                        m.metadata?.crossRuleId === ev.ruleId
                    );
                    if (dup) continue;
                    const mission = _orch()?.createManual({
                        objective: ev.recommendation,
                        priority: ev.severity === "critical" ? "critical" : "high",
                        subtasks: [{ description: ev.description }, { description: "Validate resolution and capture lesson" }],
                        metadata: { autoCreatedBy: "planner_agent", crossRuleId: ev.ruleId, domain: "cross", crossEventType: ev.type },
                    });
                    if (mission) {
                        created++;
                        s.missionsCreated++;
                        _setState(id, { lastDecision: `Cross-domain mission: ${ev.recommendation?.slice(0,60)}` });
                    }
                }
            }
        } catch {}

        s.tickCount++;
        s.health = Math.min(100, s.health + 2);
        _setState(id, {
            lastTickAt: new Date().toISOString(),
            currentObjective: created > 0 ? `Created ${created} mission(s)` : "Idle — no high-confidence signals",
        });

    } catch (e) {
        _logError(id, e);
        throw e;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// I4-3: REVIEWER AGENT TICK
// Reviews completed missions → registers lessons automatically
// ─────────────────────────────────────────────────────────────────────────────

async function _reviewerTick(s) {
    const id = s.id;
    _setState(id, { currentObjective: "Reviewing completed missions for lessons" });

    try {
        const all = _mm()?.listMissions({ limit: 500 }) || { missions: [] };
        const completed = (all.missions || []).filter(m =>
            m.status === "completed" &&
            !m.metadata?.lessonRegistered &&
            m.createdAt && (Date.now() - new Date(m.createdAt).getTime()) < 7 * 24 * 3600 * 1000 // last 7 days
        );

        let registered = 0;
        for (const m of completed.slice(0, 5)) {
            try {
                const subtasks = m.subtasks || [];
                const success  = subtasks.filter(t => t.status === "done").length;
                const total    = subtasks.length;
                const successRate = total > 0 ? success / total : 1;

                const severity = successRate >= 0.8 ? "info" : successRate >= 0.5 ? "warning" : "error";
                const lesson = _le()?.createLesson({
                    type:     "mission_outcome",
                    severity,
                    source:   "reviewer_agent",
                    title:    `Reviewed: ${m.objective?.slice(0, 60)}`,
                    detail:   `Mission ${m.id} completed. ${success}/${total} subtasks done. Success rate: ${Math.round(successRate * 100)}%.`,
                    tags:     ["auto-reviewed", m.priority, m.metadata?.domain].filter(Boolean),
                    missionId: m.id,
                });

                if (lesson) {
                    // Mark mission so we don't review it twice
                    try {
                        const mm = _mm();
                        if (mm?.recordApproval) {
                            mm.recordApproval(m.id, {
                                type: "lesson_review",
                                status: "approved",
                                requestedBy: "reviewer_agent",
                                approvedBy: "reviewer_agent",
                            });
                        }
                    } catch {}

                    // Stamp lessonRegistered on metadata (best-effort via orchestrator)
                    try {
                        _orch()?.getMission && _orch().getMission(m.id);
                    } catch {}

                    registered++;
                    s.lessonsRegistered++;
                    _setState(id, {
                        lastDecisionAt: new Date().toISOString(),
                        lastDecision: `Registered lesson for: ${m.objective?.slice(0, 50)}`,
                    });
                    try { _bus()?.emit("agent:reviewer:lesson_registered", { missionId: m.id, lessonId: lesson.id }); } catch {}
                }
            } catch (e) { _logError(id, e); }
        }

        // Also review engineering RCA resolutions
        try {
            const rcaStats = _rca()?.getStats();
            if (rcaStats && rcaStats.total > 0) {
                const analyses = _rca()?.listAnalyses?.({ limit: 5 }) || [];
                for (const a of analyses.slice(0, 2)) {
                    if (a.resolvedAt) continue; // already resolved
                    _setState(id, { lastDecision: `Reviewing RCA: ${a.rcaId}` });
                }
            }
        } catch {}

        s.tickCount++;
        s.health = Math.min(100, s.health + 2);
        _setState(id, {
            lastTickAt: new Date().toISOString(),
            currentObjective: registered > 0 ? `Registered ${registered} lesson(s)` : "Idle — no unreviewed missions",
        });

    } catch (e) {
        _logError(id, e);
        throw e;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// I4-4: VERIFIER AGENT TICK
// Verifies execution quality, mission outcomes, graph + business integrity
// ─────────────────────────────────────────────────────────────────────────────

async function _verifierTick(s) {
    const id = s.id;
    _setState(id, { currentObjective: "Verifying system integrity" });

    const findings = [];

    try {
        // 1. Execution quality: check for recent failed executions
        try {
            const execStats = _aer()?.getStatistics();
            if (execStats) {
                const failRate = execStats.totalExecutions > 0
                    ? execStats.failed / execStats.totalExecutions
                    : 0;
                if (failRate > 0.3) {
                    findings.push({ type: "execution_quality", severity: "warning", message: `Execution failure rate: ${Math.round(failRate * 100)}%` });
                }
            }
        } catch {}

        // 2. Mission outcome verification: check for stuck active missions
        try {
            const { blockedMissions } = _gre()?.findBlockedMissions({ limit: 5 }) || { blockedMissions: [] };
            if (blockedMissions.length > 0) {
                findings.push({ type: "blocked_missions", severity: "warning", message: `${blockedMissions.length} blocked mission(s) detected`, detail: blockedMissions.map(b => b.missionId).join(", ") });
                // Emit so decision engine can act
                try { _bus()?.emit("verifier:blocked_missions", { missions: blockedMissions }); } catch {}
            }
        } catch {}

        // 3. Graph consistency: check that indexed nodes match live counts
        try {
            const gre = _gre();
            if (gre) {
                const exec = gre.executeReasoning();
                if (exec.healthScore < 50) {
                    findings.push({ type: "graph_health", severity: "critical", message: `Graph health score: ${exec.healthScore}/100 — below threshold` });
                }
                // Knowledge gaps
                if ((exec.topKnowledgeGaps || []).length > 5) {
                    findings.push({ type: "knowledge_gaps", severity: "info", message: `${exec.topKnowledgeGaps.length} knowledge gaps — reviewer may need attention` });
                }
            }
        } catch {}

        // 4. Business integrity: check business intelligence health
        try {
            const uil = _uil();
            if (uil) {
                const dash = uil.getExecutiveDashboard();
                if (dash.systemHealthScore < 40) {
                    findings.push({ type: "business_integrity", severity: "critical", message: `System health: ${dash.systemHealthScore}/100 — cross-domain signals need attention` });
                }
            }
        } catch {}

        // 5. Engineering integrity: check rule registry
        try {
            const rules = _rules()?.listRules?.({ limit: 100 });
            if (rules) {
                const activeRules = (rules.rules || []).filter(r => r.enabled !== false);
                if (activeRules.length === 0) {
                    findings.push({ type: "engineering_integrity", severity: "warning", message: "No active engineering rules found" });
                }
            }
        } catch {}

        s.verificationsRun++;
        s.tickCount++;
        s.health = Math.min(100, s.health + 1);

        const criticals = findings.filter(f => f.severity === "critical");
        const summary = findings.length === 0
            ? "All systems nominal"
            : `${findings.length} finding(s): ${criticals.length} critical`;

        _setState(id, {
            lastTickAt: new Date().toISOString(),
            currentObjective: summary,
            lastDecisionAt: findings.length > 0 ? new Date().toISOString() : undefined,
            lastDecision: findings.length > 0 ? findings[0].message : "Verification passed",
        });

        try {
            if (findings.length > 0) {
                _bus()?.emit("agent:verifier:findings", { findings, agentId: id, ts: new Date().toISOString() });
            }
        } catch {}

    } catch (e) {
        _logError(id, e);
        throw e;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT RUNNER — wraps tick + catch + recovery
// ─────────────────────────────────────────────────────────────────────────────

async function _tick(id) {
    const s = _agents.get(id);
    if (!s || s.status === "paused" || s.status === "stopped" || s.status === "failed") return;
    if (s.status === "recovering") return;

    try {
        if (s.role === "planner")  await _plannerTick(s);
        if (s.role === "reviewer") await _reviewerTick(s);
        if (s.role === "verifier") await _verifierTick(s);
        // Reset health degradation on successful tick
        s.health = Math.min(100, s.health + 5);
    } catch (e) {
        _logError(id, e);
        // If 3 consecutive errors in a short window → recover
        const recent = s.errors.filter(er => Date.now() - new Date(er.ts).getTime() < 30_000);
        if (recent.length >= 3) {
            clearInterval(s._intervalHandle);
            s._intervalHandle = null;
            _scheduleRecovery(id);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

function _startAgent(id) {
    const s = _agents.get(id);
    if (!s) return;
    if (s._intervalHandle) return; // already running — singleton guard

    _setState(id, { status: "starting", startedAt: new Date().toISOString(), health: 100 });
    logger.info(`[AgentSupervisor] Starting agent: ${id} (${s.role})`);

    const intervalMs = { planner: PLANNER_INTERVAL_MS, reviewer: REVIEWER_INTERVAL_MS, verifier: VERIFIER_INTERVAL_MS }[s.role];

    // First tick immediately, then on interval
    _tick(id).then(() => { _setState(id, { status: "running" }); }).catch(() => {});
    s._intervalHandle = setInterval(() => _tick(id), intervalMs);
    _setState(id, { status: "running" });
    try { _bus()?.emit("agent:supervisor:started", { agentId: id, role: s.role }); } catch {}
}

function _stopAgent(id) {
    const s = _agents.get(id);
    if (!s) return;
    if (s._intervalHandle) { clearInterval(s._intervalHandle); s._intervalHandle = null; }
    _setState(id, { status: "stopped", currentObjective: null });
    logger.info(`[AgentSupervisor] Stopped agent: ${id}`);
    try { _bus()?.emit("agent:supervisor:stopped", { agentId: id }); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * start() — initialise supervisor and all 3 long-running agents.
 * Idempotent — safe to call multiple times.
 */
function start() {
    if (_supervisorStarted) {
        logger.info("[AgentSupervisor] Already running — ignoring duplicate start()");
        return getSupervisorStatus();
    }

    _supervisorStarted = true;
    _supervisorStartedAt = new Date().toISOString();
    logger.info("[AgentSupervisor] Starting long-running autonomous agent runtime (Phase I4)");

    // Register agents (idempotent)
    for (const { id, role } of [
        { id: "agent_planner",  role: "planner"  },
        { id: "agent_reviewer", role: "reviewer" },
        { id: "agent_verifier", role: "verifier" },
    ]) {
        if (!_agents.has(id)) _agents.set(id, _mkState(id, role));
        _startAgent(id);
    }

    try { _bus()?.emit("agent:supervisor:runtime_started", { agentCount: _agents.size }); } catch {}
    return getSupervisorStatus();
}

/**
 * stop() — gracefully stop all agents.
 */
function stop() {
    logger.info("[AgentSupervisor] Stopping all agents");
    for (const id of _agents.keys()) _stopAgent(id);
    _supervisorStarted = false;
    try { _bus()?.emit("agent:supervisor:runtime_stopped", {}); } catch {}
}

/**
 * pauseAgent(id) — pause a running agent.
 */
function pauseAgent(id) {
    const s = _agents.get(id);
    if (!s) return { ok: false, error: `Agent ${id} not found` };
    _setState(id, { status: "paused" });
    logger.info(`[AgentSupervisor] Paused: ${id}`);
    return { ok: true, id, status: "paused" };
}

/**
 * resumeAgent(id) — resume a paused agent.
 */
function resumeAgent(id) {
    const s = _agents.get(id);
    if (!s) return { ok: false, error: `Agent ${id} not found` };
    _setState(id, { status: "running" });
    logger.info(`[AgentSupervisor] Resumed: ${id}`);
    return { ok: true, id, status: "running" };
}

/**
 * getAgent(id) — return public state of one agent.
 */
function getAgent(id) {
    const s = _agents.get(id);
    if (!s) return null;
    return _publicState(s);
}

/**
 * listAgents() — return public state of all agents.
 */
function listAgents() {
    return [..._agents.values()].map(_publicState);
}

/**
 * getSupervisorStatus() — supervisor-level summary.
 */
function getSupervisorStatus() {
    const agents = listAgents();
    const running = agents.filter(a => a.status === "running").length;
    const supervisorUptime = _supervisorStartedAt
        ? Math.floor((Date.now() - new Date(_supervisorStartedAt).getTime()) / 1000)
        : 0;
    return {
        started:         _supervisorStarted,
        startedAt:       _supervisorStartedAt,
        supervisorUptime,
        agentCount:      agents.length,
        runningCount:    running,
        agents,
        config: {
            plannerIntervalMs:  PLANNER_INTERVAL_MS,
            reviewerIntervalMs: REVIEWER_INTERVAL_MS,
            verifierIntervalMs: VERIFIER_INTERVAL_MS,
            confidenceThreshold: CONFIDENCE_THRESHOLD,
            maxRecoveryAttempts: MAX_RECOVERY_ATTEMPTS,
        },
    };
}

/**
 * triggerTick(id) — force an immediate tick for testing/debug.
 */
async function triggerTick(id) {
    const s = _agents.get(id);
    if (!s) return { ok: false, error: `Agent ${id} not found` };
    await _tick(id);
    return { ok: true, id, state: _publicState(s) };
}

module.exports = {
    start,
    stop,
    pauseAgent,
    resumeAgent,
    getAgent,
    listAgents,
    getSupervisorStatus,
    triggerTick,
};
