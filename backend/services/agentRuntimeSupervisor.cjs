"use strict";
/**
 * agentRuntimeSupervisor.cjs — Phase I4 + I5: Long-Running Autonomous Agent Runtime
 *
 * I4 agents (3):
 *   planner   — scans Engineering+Business+Graph, creates missions
 *   reviewer  — reviews completed missions, registers lessons
 *   verifier  — verifies execution quality, graph consistency
 *
 * I5 agents (7, pluggable via registry):
 *   developer     — detect engineering opportunities, suggest patches/tasks
 *   tester        — monitor regressions, benchmark health, verify missions
 *   security      — inspect secrets/routes/permissions/deps, create missions only, never modify code
 *   documentation — sync lessons/runbooks/architecture docs
 *   crm           — monitor lead pipeline/revenue/customer health
 *   marketing     — monitor campaigns/SEO/content recommendations
 *   executive     — synthesise engineering+business+org executive summaries
 *
 * I5-1 Agent Registry (pluggable workforce):
 *   registerAgent(spec)   → registers a new agent definition
 *   unregisterAgent(id)   → removes and stops an agent
 *   enableAgent(id)       → enable a disabled agent
 *   disableAgent(id)      → pause + disable
 *   getAgentStatus(id)    → full agent status
 *   getAgentHealth(id)    → health score + error summary
 *
 * Agent lifecycle states (I4):
 *   starting → running → paused | recovering | stopped | failed
 *
 * Recovery (I4-6):
 *   Exponential backoff restart. Singleton via _agents Map. _recovering flag prevents re-entry.
 *
 * Architecture constraints (STRICT):
 *   No new event bus     → runtimeEventBus
 *   No new scheduler     → setInterval (same as autonomousLoop.cjs)
 *   No new runtime       → autonomousExecutionRuntime
 *   No new supervisor    → this file IS the supervisor
 *   No new memory        → missionMemory + continuousLearningEngine
 *   No new reasoning     → graphReasoningEngine + unifiedIntelligenceLayer
 *
 * Reused systems:
 *   continuousRuntimeObserver, autonomousDecisionEngine, missionOrchestrator,
 *   autonomousExecutionRuntime, engineeringRuleRegistry, rootCauseAnalysisEngine,
 *   graphReasoningEngine, unifiedIntelligenceLayer, missionMemory, runtimeEventBus,
 *   continuousLearningEngine, agentRegistry (original),
 *   securityLayer, businessDataService, businessIntelligenceEngine,
 *   engineeringConfidenceEngine
 */

const logger = require("../utils/logger");

// ── Lazy loaders (all pre-existing services) ──────────────────────────────────
function _bus()    { try { return require("../../agents/runtime/runtimeEventBus.cjs");       } catch { return null; } }
function _orch()   { try { return require("./missionOrchestrator.cjs");                      } catch { return null; } }
function _aer()    { try { return require("./autonomousExecutionRuntime.cjs");               } catch { return null; } }
function _rules()  { try { return require("./engineeringRuleRegistry.cjs");                  } catch { return null; } }
function _rca()    { try { return require("./rootCauseAnalysisEngine.cjs");                  } catch { return null; } }
function _gre()    { try { return require("./graphReasoningEngine.cjs");                     } catch { return null; } }
function _uil()    { try { return require("./unifiedIntelligenceLayer.cjs");                 } catch { return null; } }
function _mm()     { try { return require("./missionMemory.cjs");                            } catch { return null; } }
function _le()     { try { return require("./continuousLearningEngine.cjs");                 } catch { return null; } }
function _sec()    { try { return require("./securityLayer.cjs");                            } catch { return null; } }
function _bds()    { try { return require("./businessDataService.cjs");                      } catch { return null; } }
function _bie()    { try { return require("./businessIntelligenceEngine.cjs");               } catch { return null; } }
function _ce()     { try { return require("./engineeringConfidenceEngine.cjs");              } catch { return null; } }

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const RECOVERY_BASE_MS      = 5_000;
const MAX_RECOVERY_ATTEMPTS = 5;
const CONFIDENCE_THRESHOLD  = 65;

// Default tick intervals per role (ms)
const ROLE_INTERVALS = {
    planner:       60_000,
    reviewer:      90_000,
    verifier:     120_000,
    developer:     75_000,
    tester:        90_000,
    security:     180_000,
    documentation:300_000,
    crm:          120_000,
    marketing:    180_000,
    executive:    240_000,
};

// ─────────────────────────────────────────────────────────────────────────────
// AGENT STATE STORE
// ─────────────────────────────────────────────────────────────────────────────

const _agents = new Map();   // agentId → AgentState
const _registry = new Map(); // agentId → AgentSpec  (I5-1)
let _supervisorStarted  = false;
let _supervisorStartedAt = null;

function _mkState(id, role, opts = {}) {
    return {
        id, role,
        label:           opts.label || role,
        description:     opts.description || "",
        enabled:         opts.enabled !== false,
        status:          "stopped",
        pid:             process.pid,
        startedAt:       null,
        lastTickAt:      null,
        lastDecisionAt:  null,
        nextTickAt:      null,
        currentObjective: null,
        currentMissionId: null,
        lastDecision:    null,
        health:          100,
        recoveryCount:   0,
        errors:          [],
        tickCount:       0,
        tickSuccesses:   0,
        missionsCreated: 0,
        lessonsRegistered: 0,
        verificationsRun:  0,
        // Resource counters (approximated, no OS calls)
        cpuMs:           0,   // cumulative tick duration ms (proxy for CPU)
        memKb:           0,   // snapshot at last tick (process.memoryUsage rss)
        _intervalHandle: null,
        _recovering:     false,
        _intervalMs:     opts.intervalMs || ROLE_INTERVALS[role] || 120_000,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _setState(id, patch) {
    const s = _agents.get(id);
    if (!s) return;
    Object.assign(s, patch);
    try { _bus()?.emit(`agent:${id}:state`, { agentId: id, status: s.status, ...patch }); } catch {}
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

function _successRate(s) {
    if (!s.tickCount) return null;
    return Math.round((s.tickSuccesses / s.tickCount) * 100);
}

function _publicState(s) {
    return {
        id:               s.id,
        role:             s.role,
        label:            s.label,
        description:      s.description,
        enabled:          s.enabled,
        status:           s.status,
        startedAt:        s.startedAt,
        lastTickAt:       s.lastTickAt,
        nextTickAt:       s.nextTickAt,
        currentObjective: s.currentObjective,
        currentMissionId: s.currentMissionId,
        lastDecision:     s.lastDecision,
        lastDecisionAt:   s.lastDecisionAt,
        health:           s.health,
        recoveryCount:    s.recoveryCount,
        uptime:           _uptime(s),
        tickCount:        s.tickCount,
        successRate:      _successRate(s),
        missionsCreated:  s.missionsCreated,
        lessonsRegistered: s.lessonsRegistered,
        verificationsRun:  s.verificationsRun,
        cpuMs:            s.cpuMs,
        memKb:            s.memKb,
        intervalMs:       s._intervalMs,
        recentErrors:     s.errors.slice(-3),
    };
}

// ── Mission dedup guard ───────────────────────────────────────────────────────
function _missionExists(objectivePrefix) {
    try {
        const all = _mm()?.listMissions({ limit: 300 }) || { missions: [] };
        return (all.missions || []).some(m =>
            (m.status === "active" || m.status === "pending") &&
            m.objective?.slice(0, 50) === objectivePrefix?.slice(0, 50)
        );
    } catch { return false; }
}

function _createMission(agentId, spec) {
    if (_missionExists(spec.objective)) return null;
    try {
        const s = _agents.get(agentId);
        const mission = _orch()?.createManual(spec);
        if (mission && s) {
            s.missionsCreated++;
            _setState(agentId, {
                currentMissionId: mission.missionId || mission.id,
                lastDecisionAt:   new Date().toISOString(),
                lastDecision:     `Created: ${spec.objective?.slice(0, 60)}`,
            });
            try { _bus()?.emit(`agent:${agentId}:mission_created`, { missionId: mission.missionId || mission.id }); } catch {}
        }
        return mission;
    } catch (e) { _logError(agentId, e); return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// RECOVERY (I4-6)
// ─────────────────────────────────────────────────────────────────────────────

function _scheduleRecovery(id) {
    const s = _agents.get(id);
    if (!s || s._recovering) return;
    if (s.recoveryCount >= MAX_RECOVERY_ATTEMPTS) {
        _setState(id, { status: "failed" });
        logger.error(`[AgentSupervisor:${id}] Max recovery attempts — agent failed`);
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
        if (s._intervalHandle) { clearInterval(s._intervalHandle); s._intervalHandle = null; }
        _startAgent(id);
    }, delay);
}

// ─────────────────────────────────────────────────────────────────────────────
// I4-2: PLANNER TICK
// ─────────────────────────────────────────────────────────────────────────────

async function _plannerTick(s) {
    const id = s.id;
    _setState(id, { currentObjective: "Scanning signals for mission opportunities" });

    const recs = _gre()?.generateRecommendations({ limit: 10 }) || { recommendations: [] };
    const candidates = (recs.recommendations || []).filter(r =>
        r.confidence >= CONFIDENCE_THRESHOLD &&
        r.autoMissionCandidate &&
        (r.priority === "critical" || r.priority === "high")
    );

    let created = 0;
    for (const c of candidates) {
        const m = _createMission(id, {
            objective: c.autoMissionCandidate.objective,
            priority:  c.autoMissionCandidate.priority,
            subtasks: [{ description: c.description || c.title }, { description: "Verify outcome and record lesson" }],
            metadata: { ...c.autoMissionCandidate.metadata, autoCreatedBy: "planner", recommendationId: c.id, confidence: c.confidence, source: c.source },
        });
        if (m) created++;
    }

    try {
        const { crossDomainEvents } = _uil()?.correlate() || {};
        for (const ev of (crossDomainEvents || [])) {
            if (!ev.missionTrigger || (ev.impact?.confidence || 0) < CONFIDENCE_THRESHOLD) continue;
            const m = _createMission(id, {
                objective: ev.recommendation,
                priority:  ev.severity === "critical" ? "critical" : "high",
                subtasks: [{ description: ev.description }, { description: "Validate resolution" }],
                metadata: { autoCreatedBy: "planner", crossRuleId: ev.ruleId, domain: "cross" },
            });
            if (m) created++;
        }
    } catch {}

    _setState(id, {
        lastTickAt: new Date().toISOString(),
        currentObjective: created > 0 ? `Created ${created} mission(s)` : "Idle — no high-confidence signals",
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// I4-3: REVIEWER TICK
// ─────────────────────────────────────────────────────────────────────────────

async function _reviewerTick(s) {
    const id = s.id;
    _setState(id, { currentObjective: "Reviewing completed missions for lessons" });

    const all = _mm()?.listMissions({ limit: 500 }) || { missions: [] };
    const completed = (all.missions || []).filter(m =>
        m.status === "completed" &&
        !m.metadata?.lessonRegistered &&
        m.createdAt && (Date.now() - new Date(m.createdAt).getTime()) < 7 * 24 * 3600 * 1000
    );

    let registered = 0;
    for (const m of completed.slice(0, 5)) {
        try {
            const subtasks = m.subtasks || [];
            const success  = subtasks.filter(t => t.status === "done").length;
            const total    = subtasks.length;
            const rate     = total > 0 ? success / total : 1;
            const lesson   = _le()?.createLesson({
                type: "mission_outcome", severity: rate >= 0.8 ? "info" : rate >= 0.5 ? "warning" : "error",
                source: "reviewer_agent",
                title: `Reviewed: ${m.objective?.slice(0, 60)}`,
                detail: `Mission ${m.id}: ${success}/${total} subtasks done (${Math.round(rate*100)}%)`,
                tags: ["auto-reviewed", m.priority, m.metadata?.domain].filter(Boolean),
                missionId: m.id,
            });
            if (lesson) {
                registered++;
                s.lessonsRegistered++;
                _setState(id, { lastDecisionAt: new Date().toISOString(), lastDecision: `Lesson for: ${m.objective?.slice(0, 50)}` });
            }
        } catch (e) { _logError(id, e); }
    }

    _setState(id, {
        lastTickAt: new Date().toISOString(),
        currentObjective: registered > 0 ? `Registered ${registered} lesson(s)` : "Idle — no unreviewed missions",
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// I4-4: VERIFIER TICK
// ─────────────────────────────────────────────────────────────────────────────

async function _verifierTick(s) {
    const id = s.id;
    _setState(id, { currentObjective: "Verifying system integrity" });
    const findings = [];

    try {
        const stats = _aer()?.getStatistics();
        if (stats && stats.totalExecutions > 0 && stats.failed / stats.totalExecutions > 0.3)
            findings.push({ type: "execution_quality", severity: "warning", message: `Execution failure rate ${Math.round(stats.failed/stats.totalExecutions*100)}%` });
    } catch {}

    try {
        const { blockedMissions } = _gre()?.findBlockedMissions({ limit: 5 }) || {};
        if (blockedMissions?.length > 0) {
            findings.push({ type: "blocked_missions", severity: "warning", message: `${blockedMissions.length} blocked mission(s)` });
            try { _bus()?.emit("verifier:blocked_missions", { missions: blockedMissions }); } catch {}
        }
    } catch {}

    try {
        const exec = _gre()?.executeReasoning();
        if (exec?.healthScore < 50)
            findings.push({ type: "graph_health", severity: "critical", message: `Graph health: ${exec.healthScore}/100` });
    } catch {}

    try {
        const dash = _uil()?.getExecutiveDashboard();
        if (dash?.systemHealthScore < 40)
            findings.push({ type: "system_health", severity: "critical", message: `System health: ${dash.systemHealthScore}/100` });
    } catch {}

    s.verificationsRun++;
    const summary = findings.length === 0 ? "All systems nominal" : `${findings.length} finding(s)`;
    _setState(id, {
        lastTickAt: new Date().toISOString(),
        currentObjective: summary,
        lastDecision: findings.length > 0 ? findings[0].message : "Verification passed",
        lastDecisionAt: findings.length > 0 ? new Date().toISOString() : s.lastDecisionAt,
    });
    if (findings.length > 0) { try { _bus()?.emit("agent:verifier:findings", { findings }); } catch {} }
}

// ─────────────────────────────────────────────────────────────────────────────
// I5-2: DEVELOPER TICK
// Detect engineering opportunities → generate implementation missions
// Reuses: graphReasoningEngine, engineeringRuleRegistry, rootCauseAnalysisEngine
// ─────────────────────────────────────────────────────────────────────────────

async function _developerTick(s) {
    const id = s.id;
    _setState(id, { currentObjective: "Scanning for engineering implementation opportunities" });

    let created = 0;

    // 1. Open RCAs with no linked mission → create a fix mission
    try {
        const rcaStats = _rca()?.getStats?.() || {};
        const analyses = _rca()?.listAnalyses?.({ limit: 10 }) || [];
        for (const a of analyses.slice(0, 3)) {
            if (a.resolvedAt) continue;
            const m = _createMission(id, {
                objective: `Fix: ${a.errorPattern || a.rcaId}`,
                priority:  (a.occurrences || 0) > 100 ? "high" : "medium",
                subtasks: [
                    { description: `Root cause: ${(a.possibleCauses || [a.rootCause || "unknown"])[0]}` },
                    { description: "Apply fix and run regression tests" },
                    { description: "Verify no new failures introduced" },
                ],
                metadata: { autoCreatedBy: "developer_agent", rcaId: a.rcaId, domain: "engineering" },
            });
            if (m) created++;
        }
    } catch {}

    // 2. Critical graph dependencies with no active engineering mission
    try {
        const { criticalDependencies } = _gre()?.findCriticalDependencies({ limit: 5 }) || {};
        for (const dep of (criticalDependencies || []).filter(d => d.risk === "critical").slice(0, 2)) {
            const m = _createMission(id, {
                objective: `Reduce dependency risk: ${dep.type}:${dep.id}`,
                priority:  "high",
                subtasks: [{ description: dep.explanation }, { description: "Add redundancy or decouple dependency" }],
                metadata: { autoCreatedBy: "developer_agent", depKey: dep.key, domain: "engineering" },
            });
            if (m) created++;
        }
    } catch {}

    // 3. High-priority engineering rules with recent violations
    try {
        const rulesResult = _rules()?.listRules?.({ limit: 50 });
        const violated = ((rulesResult?.rules || rulesResult) || [])
            .filter(r => r.enabled !== false && r.violationCount > 0)
            .sort((a, b) => (b.violationCount || 0) - (a.violationCount || 0))
            .slice(0, 2);
        for (const rule of violated) {
            const m = _createMission(id, {
                objective: `Address rule violations: ${rule.name || rule.id}`,
                priority:  rule.severity === "critical" ? "critical" : "medium",
                subtasks: [{ description: rule.description || rule.name }, { description: "Fix violations and add guard tests" }],
                metadata: { autoCreatedBy: "developer_agent", ruleId: rule.id, domain: "engineering" },
            });
            if (m) created++;
        }
    } catch {}

    _setState(id, {
        lastTickAt: new Date().toISOString(),
        currentObjective: created > 0 ? `Generated ${created} engineering task(s)` : "No urgent engineering tasks",
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// I5-3: TESTER TICK
// Monitor regressions, benchmark health, verify mission outcomes
// Reuses: autonomousExecutionRuntime, missionMemory, continuousLearningEngine
// ─────────────────────────────────────────────────────────────────────────────

async function _testerTick(s) {
    const id = s.id;
    _setState(id, { currentObjective: "Monitoring regression and benchmark health" });

    let created = 0;

    // 1. Check execution failure rate trends
    try {
        const stats = _aer()?.getStatistics?.();
        if (stats) {
            const failRate = stats.totalExecutions > 0 ? stats.failed / stats.totalExecutions : 0;
            if (failRate > 0.2) {
                const m = _createMission(id, {
                    objective: `Regression investigation: ${Math.round(failRate*100)}% execution failure rate`,
                    priority:  failRate > 0.4 ? "critical" : "high",
                    subtasks: [{ description: "Identify failing capabilities" }, { description: "Run targeted regression for failed stages" }, { description: "Record flaky patterns as lessons" }],
                    metadata: { autoCreatedBy: "tester_agent", failRate, domain: "quality" },
                });
                if (m) created++;
            }
        }
    } catch {}

    // 2. Missions completed but never verified
    try {
        const all = _mm()?.listMissions({ limit: 300 }) || { missions: [] };
        const unverified = (all.missions || []).filter(m =>
            m.status === "completed" &&
            !m.metadata?.verified &&
            m.createdAt && (Date.now() - new Date(m.createdAt).getTime()) < 3 * 24 * 3600 * 1000
        );
        if (unverified.length > 5) {
            const m = _createMission(id, {
                objective: `Verify ${unverified.length} recently completed missions`,
                priority:  "medium",
                subtasks: [{ description: "Review outcomes against objectives" }, { description: "Mark verified and capture any anomalies" }],
                metadata: { autoCreatedBy: "tester_agent", unverifiedCount: unverified.length, domain: "quality" },
            });
            if (m) created++;
        }
    } catch {}

    // 3. Knowledge gaps (from graph reasoning) → regression coverage gap
    try {
        const { knowledgeGaps } = _gre()?.findKnowledgeGaps({ limit: 5 }) || {};
        if ((knowledgeGaps || []).length >= 5) {
            const m = _createMission(id, {
                objective: `Add test coverage for ${knowledgeGaps.length} knowledge gap(s)`,
                priority:  "low",
                subtasks: [{ description: "Identify untested areas from knowledge gaps" }, { description: "Write regression tests for gap scenarios" }],
                metadata: { autoCreatedBy: "tester_agent", gapCount: knowledgeGaps.length, domain: "quality" },
            });
            if (m) created++;
        }
    } catch {}

    s.verificationsRun++;
    _setState(id, {
        lastTickAt: new Date().toISOString(),
        currentObjective: created > 0 ? `Created ${created} test task(s)` : "Tests nominal",
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// I5-4: SECURITY TICK
// Inspect secrets/routes/permissions/deps → create missions ONLY, never modify code
// Reuses: securityLayer, missionOrchestrator
// ─────────────────────────────────────────────────────────────────────────────

async function _securityTick(s) {
    const id = s.id;
    _setState(id, { currentObjective: "Inspecting security posture" });

    const findings = [];

    // 1. Security score from securityLayer
    try {
        const score = _sec()?.getSecurityScore?.();
        if (score != null && score < 60) {
            findings.push({ type: "security_score", severity: score < 40 ? "critical" : "warning", message: `Security score: ${score}/100`, score });
        }
    } catch {}

    // 2. Audit log — check for recent failures/suspicious entries
    try {
        const audit = _sec()?.getAuditLog?.({ limit: 50 }) || [];
        const suspicious = (Array.isArray(audit) ? audit : audit.entries || [])
            .filter(e => e.action === "failed_login" || e.action === "permission_denied" || e.severity === "error")
            .slice(0, 5);
        if (suspicious.length >= 3) {
            findings.push({ type: "suspicious_activity", severity: "warning", message: `${suspicious.length} suspicious audit entries in recent log` });
        }
    } catch {}

    // 3. Permission drift — check for revoked tokens still in use
    try {
        const tokens = _sec()?.getTokens?.() || [];
        const expired = (Array.isArray(tokens) ? tokens : tokens.tokens || []).filter(t => t.expiresAt && new Date(t.expiresAt) < new Date());
        if (expired.length > 0) {
            findings.push({ type: "permission_drift", severity: "warning", message: `${expired.length} expired token(s) found` });
        }
    } catch {}

    // 4. Create missions for each finding (never modify code directly)
    let created = 0;
    for (const f of findings) {
        const m = _createMission(id, {
            objective: `Security: ${f.message}`,
            priority:  f.severity === "critical" ? "critical" : "high",
            subtasks: [
                { description: `Finding type: ${f.type} — ${f.message}` },
                { description: "Review and remediate (human approval required before any code change)" },
                { description: "Verify remediation and update security score" },
            ],
            metadata: { autoCreatedBy: "security_agent", findingType: f.type, severity: f.severity, domain: "security", requiresHumanApproval: true },
        });
        if (m) created++;
    }

    _setState(id, {
        lastTickAt: new Date().toISOString(),
        currentObjective: findings.length === 0 ? "No security findings" : `${findings.length} finding(s) — created ${created} mission(s)`,
        lastDecision: findings.length > 0 ? findings[0].message : "Security posture nominal",
        lastDecisionAt: findings.length > 0 ? new Date().toISOString() : s.lastDecisionAt,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// I5-5: DOCUMENTATION TICK
// Sync lessons/runbooks/architecture — create lessons and document missions
// Reuses: continuousLearningEngine, missionMemory, graphReasoningEngine
// ─────────────────────────────────────────────────────────────────────────────

async function _documentationTick(s) {
    const id = s.id;
    _setState(id, { currentObjective: "Synchronising documentation and lessons" });

    let created = 0;

    // 1. Lessons without runbooks
    try {
        const lessons = _le()?.getLessons?.({ type: "mission_outcome", limit: 50 }) || { lessons: [] };
        const needsRunbook = (lessons.lessons || []).filter(l => !l.runbook && l.severity === "error").slice(0, 3);
        for (const lesson of needsRunbook) {
            const m = _createMission(id, {
                objective: `Write runbook: ${lesson.title?.slice(0, 60)}`,
                priority:  "medium",
                subtasks: [{ description: `Lesson: ${lesson.detail?.slice(0, 100)}` }, { description: "Draft runbook with steps and rollback" }, { description: "Update lesson with runbook reference" }],
                metadata: { autoCreatedBy: "documentation_agent", lessonId: lesson.id, domain: "documentation" },
            });
            if (m) created++;
        }
    } catch {}

    // 2. Knowledge gaps → documentation missions
    try {
        const { knowledgeGaps } = _gre()?.findKnowledgeGaps({ limit: 3 }) || {};
        for (const gap of (knowledgeGaps || []).filter(g => g.ageDays > 14).slice(0, 2)) {
            const m = _createMission(id, {
                objective: `Document: ${gap.objective?.slice(0, 60)}`,
                priority:  "low",
                subtasks: [{ description: `${gap.ageDays}d old mission with no documented lessons` }, { description: "Extract lessons and write architecture notes" }],
                metadata: { autoCreatedBy: "documentation_agent", missionId: gap.missionId, ageDays: gap.ageDays, domain: "documentation" },
            });
            if (m) created++;
        }
    } catch {}

    // 3. Register architecture summary as a lesson periodically
    try {
        const exec = _gre()?.executeReasoning();
        if (exec?.summary) {
            _le()?.createLesson?.({
                type: "architecture_snapshot",
                severity: exec.healthScore < 60 ? "warning" : "info",
                source: "documentation_agent",
                title: `Architecture snapshot — health ${exec.healthScore}/100`,
                detail: exec.summary,
                tags: ["architecture", "auto-doc"],
            });
            s.lessonsRegistered++;
        }
    } catch {}

    _setState(id, {
        lastTickAt: new Date().toISOString(),
        currentObjective: created > 0 ? `Created ${created} doc task(s)` : "Documentation current",
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// I5-6: CRM TICK
// Monitor lead pipeline/revenue/customer health → create follow-up missions
// Reuses: businessDataService, businessIntelligenceEngine
// ─────────────────────────────────────────────────────────────────────────────

async function _crmTick(s) {
    const id = s.id;
    _setState(id, { currentObjective: "Monitoring CRM pipeline and customer health" });

    let created = 0;

    // 1. Stale leads (created > 7 days ago, still "new")
    try {
        const leads = _bds()?.listLeads?.({ status: "new", limit: 50 }) || { leads: [] };
        const stale = (leads.leads || []).filter(l =>
            l.createdAt && (Date.now() - new Date(l.createdAt).getTime()) > 7 * 24 * 3600 * 1000
        );
        if (stale.length > 0) {
            const m = _createMission(id, {
                objective: `Follow up on ${stale.length} stale lead(s)`,
                priority:  "high",
                subtasks: [{ description: `Leads stale > 7 days: ${stale.slice(0,3).map(l=>l.name||l.email).join(", ")}` }, { description: "Qualify or disqualify each lead" }, { description: "Update CRM pipeline status" }],
                metadata: { autoCreatedBy: "crm_agent", staleCount: stale.length, domain: "crm" },
            });
            if (m) created++;
        }
    } catch {}

    // 2. Business intelligence recommendations
    try {
        const recs = _bie()?.getRecommendations?.({ limit: 10 }) || { recommendations: [] };
        const actionable = (recs.recommendations || []).filter(r => r.status === "open" && r.priority <= 2).slice(0, 2);
        for (const rec of actionable) {
            const m = _createMission(id, {
                objective: `CRM action: ${rec.title?.slice(0, 60)}`,
                priority:  rec.priority === 1 ? "critical" : "high",
                subtasks: [{ description: rec.detail || rec.description }, { description: "Execute and update business intelligence" }],
                metadata: { autoCreatedBy: "crm_agent", recId: rec.recId || rec.id, domain: "crm" },
            });
            if (m) created++;
        }
    } catch {}

    // 3. Revenue health check
    try {
        const revStats = _bds()?.getRevenueStats?.();
        if (revStats && revStats.totalRevenue === 0 && revStats.count === 0) {
            const m = _createMission(id, {
                objective: "Revenue pipeline empty — initiate outbound",
                priority:  "high",
                subtasks: [{ description: "No revenue recorded yet" }, { description: "Identify top 5 prospects and initiate contact" }],
                metadata: { autoCreatedBy: "crm_agent", domain: "crm" },
            });
            if (m) created++;
        }
    } catch {}

    _setState(id, {
        lastTickAt: new Date().toISOString(),
        currentObjective: created > 0 ? `Created ${created} CRM task(s)` : "Pipeline healthy",
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// I5-7: MARKETING TICK
// Monitor campaigns/SEO/content → create marketing missions
// Reuses: businessDataService, businessIntelligenceEngine
// ─────────────────────────────────────────────────────────────────────────────

async function _marketingTick(s) {
    const id = s.id;
    _setState(id, { currentObjective: "Monitoring marketing campaigns and content" });

    let created = 0;

    // 1. Campaigns with no recent events (stale)
    try {
        const campaigns = _bds()?.listCampaigns?.({ limit: 20 }) || { campaigns: [] };
        const stale = (campaigns.campaigns || []).filter(c =>
            c.status === "active" &&
            c.updatedAt && (Date.now() - new Date(c.updatedAt).getTime()) > 14 * 24 * 3600 * 1000
        );
        if (stale.length > 0) {
            const m = _createMission(id, {
                objective: `Revive ${stale.length} stale marketing campaign(s)`,
                priority:  "medium",
                subtasks: [{ description: `Campaigns inactive > 14 days: ${stale.slice(0,3).map(c=>c.name||c.id).join(", ")}` }, { description: "Review performance and update content" }],
                metadata: { autoCreatedBy: "marketing_agent", staleCount: stale.length, domain: "marketing" },
            });
            if (m) created++;
        }
    } catch {}

    // 2. Business intelligence marketing recommendations
    try {
        const recs = _bie()?.getRecommendations?.({ limit: 10 }) || { recommendations: [] };
        const marketing = (recs.recommendations || []).filter(r => r.status === "open" && (r.tags || []).includes("marketing")).slice(0, 2);
        for (const rec of marketing) {
            const m = _createMission(id, {
                objective: `Marketing: ${rec.title?.slice(0, 60)}`,
                priority:  "medium",
                subtasks: [{ description: rec.detail || rec.description }, { description: "Execute marketing action" }],
                metadata: { autoCreatedBy: "marketing_agent", recId: rec.recId || rec.id, domain: "marketing" },
            });
            if (m) created++;
        }
    } catch {}

    // 3. Opportunities with no campaign attribution (conversion gap)
    try {
        const opps = _bds()?.listOpportunities?.({ limit: 50 }) || { opportunities: [] };
        const noSource = (opps.opportunities || []).filter(o => !o.source && o.stage === "prospecting").length;
        if (noSource > 3) {
            const m = _createMission(id, {
                objective: `Attribute ${noSource} untracked opportunities to marketing channels`,
                priority:  "low",
                subtasks: [{ description: "Identify source for unattributed opportunities" }, { description: "Update CRM with channel attribution" }],
                metadata: { autoCreatedBy: "marketing_agent", noSourceCount: noSource, domain: "marketing" },
            });
            if (m) created++;
        }
    } catch {}

    _setState(id, {
        lastTickAt: new Date().toISOString(),
        currentObjective: created > 0 ? `Created ${created} marketing task(s)` : "Marketing pipeline nominal",
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// I5-8: EXECUTIVE TICK
// Synthesise Engineering+Business+Org → executive summary lessons
// Reuses: unifiedIntelligenceLayer, graphReasoningEngine, continuousLearningEngine
// ─────────────────────────────────────────────────────────────────────────────

async function _executiveTick(s) {
    const id = s.id;
    _setState(id, { currentObjective: "Generating executive synthesis" });

    // 1. Unified executive dashboard
    let execDash = null;
    try { execDash = _uil()?.getExecutiveDashboard(); } catch {}

    // 2. Graph reasoning executive report
    let reasoning = null;
    try { reasoning = _gre()?.executeReasoning(); } catch {}

    const healthScore = execDash?.systemHealthScore ?? reasoning?.healthScore ?? 0;
    const summary = reasoning?.summary || execDash?.summary || `System health: ${healthScore}/100`;

    // 3. Register executive summary as a lesson
    try {
        _le()?.createLesson?.({
            type:     "executive_summary",
            severity: healthScore < 40 ? "error" : healthScore < 70 ? "warning" : "info",
            source:   "executive_agent",
            title:    `Executive summary — health ${healthScore}/100`,
            detail:   summary,
            tags:     ["executive", "auto-summary"],
        });
        s.lessonsRegistered++;
    } catch {}

    // 4. Escalate critical cross-domain events as missions
    let created = 0;
    try {
        const topRisks = reasoning?.topRisks || [];
        for (const risk of topRisks.filter(r => r.severity === "critical" || r.risk === "critical").slice(0, 2)) {
            const m = _createMission(id, {
                objective: `Executive escalation: ${risk.explanation || risk.message || risk.type}`,
                priority:  "critical",
                subtasks: [{ description: `Risk type: ${risk.type}` }, { description: "Immediate executive review and remediation" }],
                metadata: { autoCreatedBy: "executive_agent", riskType: risk.type, domain: "executive", requiresHumanApproval: true },
            });
            if (m) created++;
        }
    } catch {}

    _setState(id, {
        lastTickAt: new Date().toISOString(),
        lastDecisionAt: new Date().toISOString(),
        lastDecision: `Health ${healthScore}/100 — ${summary?.slice(0, 80)}`,
        currentObjective: `Summary registered — health ${healthScore}/100`,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED _tick DISPATCHER
// ─────────────────────────────────────────────────────────────────────────────

async function _tick(id) {
    const s = _agents.get(id);
    if (!s || !s.enabled) return;
    if (s.status === "paused" || s.status === "stopped" || s.status === "failed" || s.status === "recovering") return;

    const t0 = Date.now();
    try {
        switch (s.role) {
            case "planner":       await _plannerTick(s);       break;
            case "reviewer":      await _reviewerTick(s);      break;
            case "verifier":      await _verifierTick(s);      break;
            case "developer":     await _developerTick(s);     break;
            case "tester":        await _testerTick(s);        break;
            case "security":      await _securityTick(s);      break;
            case "documentation": await _documentationTick(s); break;
            case "crm":           await _crmTick(s);           break;
            case "marketing":     await _marketingTick(s);     break;
            case "executive":     await _executiveTick(s);     break;
            default:
                if (typeof s._customTick === "function") await s._customTick(s);
        }
        const elapsed = Date.now() - t0;
        s.cpuMs   += elapsed;
        s.memKb    = Math.round(process.memoryUsage().rss / 1024);
        s.tickSuccesses++;
        s.health   = Math.min(100, s.health + 5);
        s.nextTickAt = new Date(Date.now() + s._intervalMs).toISOString();
    } catch (e) {
        _logError(id, e);
        const recent = s.errors.filter(er => Date.now() - new Date(er.ts).getTime() < 30_000);
        if (recent.length >= 3) {
            clearInterval(s._intervalHandle);
            s._intervalHandle = null;
            _scheduleRecovery(id);
        }
    } finally {
        s.tickCount++;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

function _startAgent(id) {
    const s = _agents.get(id);
    if (!s || !s.enabled) return;
    if (s._intervalHandle) return; // singleton guard

    _setState(id, { status: "starting", startedAt: new Date().toISOString(), health: 100 });
    logger.info(`[AgentSupervisor] Starting: ${id} (${s.role}) @ ${s._intervalMs}ms`);

    _tick(id).then(() => _setState(id, { status: "running" })).catch(() => {});
    s._intervalHandle = setInterval(() => _tick(id), s._intervalMs);
    _setState(id, { status: "running", nextTickAt: new Date(Date.now() + s._intervalMs).toISOString() });
    try { _bus()?.emit("agent:supervisor:started", { agentId: id, role: s.role }); } catch {}
}

function _stopAgent(id) {
    const s = _agents.get(id);
    if (!s) return;
    if (s._intervalHandle) { clearInterval(s._intervalHandle); s._intervalHandle = null; }
    _setState(id, { status: "stopped", currentObjective: null });
    logger.info(`[AgentSupervisor] Stopped: ${id}`);
    try { _bus()?.emit("agent:supervisor:stopped", { agentId: id }); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// I5-1: AGENT REGISTRY API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * registerAgent(spec) — register a new autonomous agent.
 * spec: { id, role, label?, description?, intervalMs?, enabled?, tickFn? }
 * If supervisor is already running, auto-starts the agent.
 * Idempotent — re-registering updates spec without restarting if already running.
 */
function registerAgent(spec = {}) {
    const { id, role, label, description, intervalMs, enabled = true, tickFn } = spec;
    if (!id || !role) return { ok: false, error: "id and role are required" };

    _registry.set(id, spec);

    if (_agents.has(id)) {
        // Update non-structural fields
        const s = _agents.get(id);
        if (label)       s.label       = label;
        if (description) s.description = description;
        if (intervalMs)  s._intervalMs = intervalMs;
        if (tickFn)      s._customTick = tickFn;
        logger.info(`[AgentSupervisor] Re-registered: ${id}`);
        return { ok: true, id, action: "updated" };
    }

    const state = _mkState(id, role, { label, description, intervalMs, enabled });
    if (tickFn) state._customTick = tickFn;
    _agents.set(id, state);

    if (_supervisorStarted && enabled) _startAgent(id);

    logger.info(`[AgentSupervisor] Registered: ${id} (${role})`);
    try { _bus()?.emit("agent:supervisor:registered", { agentId: id, role }); } catch {}
    return { ok: true, id, action: "registered" };
}

/**
 * unregisterAgent(id) — stop and remove an agent.
 */
function unregisterAgent(id) {
    if (!_agents.has(id)) return { ok: false, error: `Agent ${id} not found` };
    _stopAgent(id);
    _agents.delete(id);
    _registry.delete(id);
    logger.info(`[AgentSupervisor] Unregistered: ${id}`);
    try { _bus()?.emit("agent:supervisor:unregistered", { agentId: id }); } catch {}
    return { ok: true, id };
}

/**
 * enableAgent(id) — enable a disabled agent and start it.
 */
function enableAgent(id) {
    const s = _agents.get(id);
    if (!s) return { ok: false, error: `Agent ${id} not found` };
    s.enabled = true;
    if (_supervisorStarted) _startAgent(id);
    return { ok: true, id, enabled: true };
}

/**
 * disableAgent(id) — pause and disable an agent.
 */
function disableAgent(id) {
    const s = _agents.get(id);
    if (!s) return { ok: false, error: `Agent ${id} not found` };
    s.enabled = false;
    _stopAgent(id);
    return { ok: true, id, enabled: false };
}

/**
 * getAgentStatus(id) — full agent status including registry spec.
 */
function getAgentStatus(id) {
    const s = _agents.get(id);
    if (!s) return null;
    return { ...  _publicState(s), spec: _registry.get(id) || null };
}

/**
 * getAgentHealth(id) — health score + error summary.
 */
function getAgentHealth(id) {
    const s = _agents.get(id);
    if (!s) return null;
    return {
        id, health: s.health, status: s.status,
        recentErrors: s.errors.slice(-5),
        recoveryCount: s.recoveryCount,
        successRate: _successRate(s),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPERVISOR PUBLIC API (I4 + I5)
// ─────────────────────────────────────────────────────────────────────────────

const BUILTIN_AGENTS = [
    // I4 originals
    { id: "agent_planner",  role: "planner",  label: "Planner",  description: "Scans signals, creates missions" },
    { id: "agent_reviewer", role: "reviewer", label: "Reviewer", description: "Reviews missions, registers lessons" },
    { id: "agent_verifier", role: "verifier", label: "Verifier", description: "Verifies execution and system integrity" },
    // I5 new
    { id: "agent_developer",     role: "developer",     label: "Developer",     description: "Engineering opportunity detection and task generation" },
    { id: "agent_tester",        role: "tester",        label: "Tester",        description: "Regression monitoring and benchmark health" },
    { id: "agent_security",      role: "security",      label: "Security",      description: "Security posture inspection — creates missions only" },
    { id: "agent_documentation", role: "documentation", label: "Documentation", description: "Lesson/runbook/architecture synchronisation" },
    { id: "agent_crm",           role: "crm",           label: "CRM",           description: "Lead pipeline, revenue, and customer health" },
    { id: "agent_marketing",     role: "marketing",     label: "Marketing",     description: "Campaign, SEO, and content monitoring" },
    { id: "agent_executive",     role: "executive",     label: "Executive",     description: "Cross-domain executive summaries and escalation" },
];

function start() {
    if (_supervisorStarted) {
        logger.info("[AgentSupervisor] Already running — ignoring duplicate start()");
        return getSupervisorStatus();
    }

    _supervisorStarted   = true;
    _supervisorStartedAt = new Date().toISOString();
    logger.info("[AgentSupervisor] Starting autonomous agent runtime (I4+I5)");

    for (const spec of BUILTIN_AGENTS) {
        if (!_agents.has(spec.id)) _agents.set(spec.id, _mkState(spec.id, spec.role, spec));
        _registry.set(spec.id, spec);
        _startAgent(spec.id);
    }

    try { _bus()?.emit("agent:supervisor:runtime_started", { agentCount: _agents.size }); } catch {}
    return getSupervisorStatus();
}

function stop() {
    logger.info("[AgentSupervisor] Stopping all agents");
    for (const id of _agents.keys()) _stopAgent(id);
    _supervisorStarted = false;
    try { _bus()?.emit("agent:supervisor:runtime_stopped", {}); } catch {}
}

function pauseAgent(id) {
    const s = _agents.get(id);
    if (!s) return { ok: false, error: `Agent ${id} not found` };
    _setState(id, { status: "paused" });
    logger.info(`[AgentSupervisor] Paused: ${id}`);
    return { ok: true, id, status: "paused" };
}

function resumeAgent(id) {
    const s = _agents.get(id);
    if (!s) return { ok: false, error: `Agent ${id} not found` };
    _setState(id, { status: "running" });
    logger.info(`[AgentSupervisor] Resumed: ${id}`);
    return { ok: true, id, status: "running" };
}

function getAgent(id) {
    const s = _agents.get(id);
    return s ? _publicState(s) : null;
}

function listAgents() {
    return [..._agents.values()].map(_publicState);
}

function getSupervisorStatus() {
    const agents       = listAgents();
    const running      = agents.filter(a => a.status === "running").length;
    const supervisorUptime = _supervisorStartedAt
        ? Math.floor((Date.now() - new Date(_supervisorStartedAt).getTime()) / 1000)
        : 0;
    return {
        started:          _supervisorStarted,
        startedAt:        _supervisorStartedAt,
        supervisorUptime,
        agentCount:       agents.length,
        runningCount:     running,
        registeredRoles:  [...new Set(agents.map(a => a.role))],
        agents,
        config: {
            confidenceThreshold: CONFIDENCE_THRESHOLD,
            maxRecoveryAttempts: MAX_RECOVERY_ATTEMPTS,
            recoveryBaseMs:      RECOVERY_BASE_MS,
            roleIntervals:       ROLE_INTERVALS,
        },
    };
}

async function triggerTick(id) {
    const s = _agents.get(id);
    if (!s) return { ok: false, error: `Agent ${id} not found` };
    await _tick(id);
    return { ok: true, id, state: _publicState(s) };
}

module.exports = {
    // Supervisor lifecycle
    start,
    stop,
    pauseAgent,
    resumeAgent,
    getAgent,
    listAgents,
    getSupervisorStatus,
    triggerTick,
    // I5-1 Registry
    registerAgent,
    unregisterAgent,
    enableAgent,
    disableAgent,
    getAgentStatus,
    getAgentHealth,
};
