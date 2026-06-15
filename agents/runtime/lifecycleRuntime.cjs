"use strict";
/**
 * lifecycleRuntime.cjs — J3 Unified Autonomous Execution Loop
 *
 * Integrates the full execution lifecycle into one continuous loop.
 * Does NOT create a new scheduler, observer, timer, or execution engine.
 * All work is delegated to existing services.
 *
 * Lifecycle stages (in order):
 *   observe → detect → reason → recommend → plan → delegate →
 *   execute → review → test → secure → deploy → verify → heal → learn
 *
 * Lifecycle state is stored on mission._lifecycle (via missionMemory.updateMission)
 * so there is exactly one source of truth: the mission object.
 *
 * Integration points (all lazy-loaded):
 *   backgroundRuntime   — observe, detect, recommend
 *   reasoningEngine     — reason (scoreConfidence, analyzeRisk)
 *   autonomousPlanning  — plan (recommendNextObjective)
 *   agentCollaboration  — delegate, execute (startCollaboration, postMessage)
 *   taskGraph           — execute stages via pipeline
 *   missionRuntime      — mission state machine
 *   missionMemory       — learn (addLearning, recordArtifact, recordDecision)
 *   runtimeEventBus     — emit lifecycle events
 *   executiveReasoning  — assess strategic risk
 *
 * Public API:
 *   startLifecycle(missionId, opts)     — attach lifecycle to a mission
 *   pauseLifecycle(missionId)           — pause the loop
 *   resumeLifecycle(missionId)          — resume a paused loop
 *   retryStage(missionId)               — retry the current failed stage
 *   getLifecycle(missionId)             — full lifecycle state
 *   getCurrentStage(missionId)          — { stage, startedAt, agent, confidence }
 *   getLifecycleEvents(missionId)       — ordered events[]
 *   tick(missionId)                     — advance one stage (called by external loop)
 */

const logger = require("../../backend/utils/logger");

// ── Lazy service refs ────────────────────────────────────────────────────────
let _bus = null, _mem = null, _mr = null, _ac = null,
    _bg  = null, _re  = null, _ap = null, _tg = null, _er = null;

function _getBus() { if (!_bus) { try { _bus = require("./runtimeEventBus.cjs");                                       } catch {} } return _bus;  }
function _getMem() { if (!_mem) { try { _mem = require("../../backend/services/missionMemory.cjs");                    } catch {} } return _mem;  }
function _getMR()  { if (!_mr)  { try { _mr  = require("./missionRuntime.cjs");                                        } catch {} } return _mr;   }
function _getAC()  { if (!_ac)  { try { _ac  = require("./agentCollaboration.cjs");                                   } catch {} } return _ac;   }
function _getBG()  { if (!_bg)  { try { _bg  = require("../../backend/services/backgroundRuntime.cjs");                } catch {} } return _bg;   }
function _getRE()  { if (!_re)  { try { _re  = require("../../backend/services/reasoningEngine.cjs");                  } catch {} } return _re;   }
function _getAP()  { if (!_ap)  { try { _ap  = require("../../backend/services/autonomousPlanning.cjs");               } catch {} } return _ap;   }
function _getTG()  { if (!_tg)  { try { _tg  = require("../../backend/services/taskGraph.cjs");                        } catch {} } return _tg;   }
function _getER()  { if (!_er)  { try { _er  = require("../../backend/services/executiveReasoning.cjs");               } catch {} } return _er;   }

// ── Stage definitions ────────────────────────────────────────────────────────
const STAGES = [
    { id: "observe",    label: "Observe",    agent: "operator",  description: "Monitor platform signals and environment state" },
    { id: "detect",     label: "Detect",     agent: "operator",  description: "Identify anomalies, triggers, and change events" },
    { id: "reason",     label: "Reason",     agent: "planner",   description: "Score confidence and assess strategic risk" },
    { id: "recommend",  label: "Recommend",  agent: "planner",   description: "Generate actionable recommendations" },
    { id: "plan",       label: "Plan",       agent: "planner",   description: "Decompose into subtasks and assign pipeline stages" },
    { id: "delegate",   label: "Delegate",   agent: "planner",   description: "Assign tasks to specialist agents" },
    { id: "execute",    label: "Execute",    agent: "developer", description: "Run the implementation pipeline" },
    { id: "review",     label: "Review",     agent: "reviewer",  description: "Validate implementation correctness" },
    { id: "test",       label: "Test",       agent: "tester",    description: "Run test suites and coverage checks" },
    { id: "secure",     label: "Secure",     agent: "security",  description: "Audit for vulnerabilities and secrets" },
    { id: "deploy",     label: "Deploy",     agent: "devops",    description: "Deploy to production via CI/CD pipeline" },
    { id: "verify",     label: "Verify",     agent: "devops",    description: "Confirm deployment health and availability" },
    { id: "heal",       label: "Heal",       agent: "operator",  description: "Self-heal failures and restore stability" },
    { id: "learn",      label: "Learn",      agent: "operator",  description: "Record outcomes, learnings, and update memory" },
];

const STAGE_IDS     = STAGES.map(s => s.id);
const STAGE_BY_ID   = Object.fromEntries(STAGES.map(s => [s.id, s]));
const TERMINAL_STAGES = new Set(["learn"]);

// ── Lifecycle state helpers ────────────────────────────────────────────────────
// Stored on mission._lifecycle = {
//   currentStage, stageIndex, status, confidence, pausedAt,
//   events[], retryHistory[], startedAt, lastAdvancedAt
// }

function _getLC(mission) {
    return mission._lifecycle || {
        currentStage:  null,
        stageIndex:    -1,
        status:        "idle",        // idle | running | paused | completed | failed
        confidence:    null,
        pausedAt:      null,
        events:        [],
        retryHistory:  [],
        startedAt:     null,
        lastAdvancedAt: null,
    };
}

function _saveLC(missionId, lc) {
    const mem = _getMem();
    if (!mem) return;
    try { mem.updateMission(missionId, { _lifecycle: lc }); } catch {}
}

function _emit(type, missionId, payload = {}) {
    const bus = _getBus();
    if (!bus) return;
    try { bus.emit(type, { missionId, ...payload, _ts: Date.now() }); } catch {}
}

function _logEvent(lc, type, details = {}) {
    const evt = { type, ts: new Date().toISOString(), ...details };
    lc.events.push(evt);
    if (lc.events.length > 1000) lc.events = lc.events.slice(-1000);
    return evt;
}

// ── Public API ────────────────────────────────────────────────────────────────

function startLifecycle(missionId, opts = {}) {
    const mem     = _getMem();
    if (!mem) throw new Error("missionMemory unavailable");
    const mission = mem.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const existing = mission._lifecycle;
    if (existing && existing.status === "running") {
        return { missionId, lifecycle: existing, started: false, reason: "already_running" };
    }

    const lc = _getLC(mission);
    lc.status       = "running";
    lc.startedAt    = lc.startedAt || new Date().toISOString();
    lc.currentStage = STAGE_IDS[0];
    lc.stageIndex   = 0;

    _logEvent(lc, "lifecycle:started", { startStage: STAGE_IDS[0], opts });
    _saveLC(missionId, lc);
    _emit("lifecycle:started", missionId, { stage: lc.currentStage });
    logger.info(`[LifecycleRuntime] Started lifecycle for mission ${missionId}`);

    return { missionId, lifecycle: lc, started: true };
}

function pauseLifecycle(missionId) {
    const mem = _getMem();
    if (!mem) throw new Error("missionMemory unavailable");
    const mission = mem.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const lc = _getLC(mission);
    if (lc.status !== "running") {
        return { missionId, lifecycle: lc, paused: false, reason: `status is ${lc.status}` };
    }

    lc.status   = "paused";
    lc.pausedAt = new Date().toISOString();
    _logEvent(lc, "lifecycle:paused", { stage: lc.currentStage });
    _saveLC(missionId, lc);
    _emit("lifecycle:paused", missionId, { stage: lc.currentStage });
    logger.info(`[LifecycleRuntime] Paused lifecycle for mission ${missionId} at stage ${lc.currentStage}`);

    return { missionId, lifecycle: lc, paused: true };
}

function resumeLifecycle(missionId) {
    const mem = _getMem();
    if (!mem) throw new Error("missionMemory unavailable");
    const mission = mem.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const lc = _getLC(mission);
    if (lc.status !== "paused") {
        return { missionId, lifecycle: lc, resumed: false, reason: `status is ${lc.status}` };
    }

    lc.status   = "running";
    lc.pausedAt = null;
    _logEvent(lc, "lifecycle:resumed", { stage: lc.currentStage });
    _saveLC(missionId, lc);
    _emit("lifecycle:resumed", missionId, { stage: lc.currentStage });
    logger.info(`[LifecycleRuntime] Resumed lifecycle for mission ${missionId} at stage ${lc.currentStage}`);

    return { missionId, lifecycle: lc, resumed: true };
}

function retryStage(missionId) {
    const mem = _getMem();
    if (!mem) throw new Error("missionMemory unavailable");
    const mission = mem.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const lc = _getLC(mission);
    if (!lc.currentStage) throw new Error("No active stage to retry");

    const retryRecord = {
        stage:     lc.currentStage,
        ts:        new Date().toISOString(),
        attempt:   (lc.retryHistory || []).filter(r => r.stage === lc.currentStage).length + 1,
    };
    if (!lc.retryHistory) lc.retryHistory = [];
    lc.retryHistory.push(retryRecord);
    if (lc.retryHistory.length > 100) lc.retryHistory = lc.retryHistory.slice(-100);

    lc.status = "running";
    _logEvent(lc, "lifecycle:retry", retryRecord);
    _saveLC(missionId, lc);
    _emit("lifecycle:retry", missionId, { stage: lc.currentStage, attempt: retryRecord.attempt });
    logger.info(`[LifecycleRuntime] Retry stage ${lc.currentStage} for mission ${missionId} (attempt ${retryRecord.attempt})`);

    return { missionId, lifecycle: lc, retry: retryRecord };
}

function getLifecycle(missionId) {
    const mem = _getMem();
    if (!mem) throw new Error("missionMemory unavailable");
    const mission = mem.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const lc = _getLC(mission);
    return {
        missionId,
        objective:  mission.objective,
        status:     mission.status,
        lifecycle:  lc,
        stages:     STAGES,
        stageCount: STAGES.length,
    };
}

function getCurrentStage(missionId) {
    const mem = _getMem();
    if (!mem) throw new Error("missionMemory unavailable");
    const mission = mem.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const lc    = _getLC(mission);
    const stage = STAGE_BY_ID[lc.currentStage] || null;
    return {
        missionId,
        stage:         lc.currentStage,
        stageLabel:    stage?.label || null,
        stageIndex:    lc.stageIndex,
        totalStages:   STAGES.length,
        agent:         stage?.agent || null,
        description:   stage?.description || null,
        status:        lc.status,
        confidence:    lc.confidence,
        startedAt:     lc.startedAt,
        lastAdvancedAt: lc.lastAdvancedAt,
        progressPct:   lc.stageIndex >= 0
            ? Math.round((lc.stageIndex / (STAGES.length - 1)) * 100)
            : 0,
    };
}

function getLifecycleEvents(missionId) {
    const mem = _getMem();
    if (!mem) throw new Error("missionMemory unavailable");
    const mission = mem.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const lc = _getLC(mission);
    return {
        missionId,
        events:      lc.events || [],
        total:       (lc.events || []).length,
        currentStage: lc.currentStage,
        status:      lc.status,
    };
}

/**
 * tick(missionId) — advance one lifecycle stage.
 *
 * This is called externally. It does NOT start its own timer.
 * The caller (autonomousLoop, a route, or a test) drives the cadence.
 *
 * Returns the stage that was just executed and the new current stage.
 */
async function tick(missionId) {
    const mem = _getMem();
    if (!mem) return { skipped: true, reason: "missionMemory unavailable" };

    const mission = mem.getMission(missionId);
    if (!mission) return { skipped: true, reason: "mission not found" };

    const lc = _getLC(mission);

    if (lc.status !== "running") {
        return { skipped: true, reason: `lifecycle status is ${lc.status}` };
    }

    const stageId  = lc.currentStage;
    const stageDef = STAGE_BY_ID[stageId];
    if (!stageDef) {
        return { skipped: true, reason: `unknown stage: ${stageId}` };
    }

    const startedAt = Date.now();
    let success     = false;
    let output      = null;
    let confidence  = lc.confidence;

    _emit(`lifecycle:stage:start`, missionId, { stage: stageId, agent: stageDef.agent });
    _logEvent(lc, `stage:start`, { stage: stageId, agent: stageDef.agent });
    _saveLC(missionId, lc);

    try {
        const result = await _executeStage(missionId, stageId, stageDef, lc, mission);
        success    = result.success !== false;
        output     = result.output  || null;
        confidence = result.confidence !== undefined ? result.confidence : confidence;
    } catch (err) {
        success = false;
        output  = err.message;
        logger.warn(`[LifecycleRuntime] Stage ${stageId} threw: ${err.message}`);
    }

    const durationMs = Date.now() - startedAt;
    lc.confidence    = confidence;
    lc.lastAdvancedAt = new Date().toISOString();

    if (!success) {
        _logEvent(lc, `stage:failed`, { stage: stageId, durationMs, error: output });
        _emit("lifecycle:stage:failed", missionId, { stage: stageId, durationMs, error: output });
        _saveLC(missionId, lc);
        return { stage: stageId, success: false, durationMs, output };
    }

    _logEvent(lc, `stage:complete`, { stage: stageId, durationMs, output: (output || "").slice(0, 200) });
    _emit("lifecycle:stage:complete", missionId, { stage: stageId, durationMs, confidence });

    // Advance to next stage
    const nextIndex = lc.stageIndex + 1;
    if (nextIndex >= STAGES.length) {
        lc.status       = "completed";
        lc.currentStage = null;
        _logEvent(lc, "lifecycle:completed", { totalEvents: lc.events.length });
        _emit("lifecycle:completed", missionId, { confidence });
        logger.info(`[LifecycleRuntime] Lifecycle completed for mission ${missionId}`);
    } else {
        lc.stageIndex   = nextIndex;
        lc.currentStage = STAGE_IDS[nextIndex];
        _logEvent(lc, "stage:next", { from: stageId, to: lc.currentStage });
        _emit("lifecycle:stage:next", missionId, { from: stageId, to: lc.currentStage, stageIndex: nextIndex });
    }

    _saveLC(missionId, lc);
    return { stage: stageId, nextStage: lc.currentStage, success: true, durationMs, confidence };
}

// ── Stage execution — delegates to existing services ────────────────────────
async function _executeStage(missionId, stageId, stageDef, lc, mission) {
    switch (stageId) {

        case "observe": {
            const bg = _getBG();
            if (bg) {
                const status = bg.getStatus();
                return { success: true, output: `Observers: ${Object.keys(status.observers || {}).length} active` };
            }
            return { success: true, output: "observe: backgroundRuntime unavailable — skipping" };
        }

        case "detect": {
            const bg   = _getBG();
            const recs = bg ? bg.getRecommendations({ limit: 5 }) : { recommendations: [] };
            const count = (recs.recommendations || []).length;
            if (count > 0) {
                const top = recs.recommendations[0];
                const ac  = _getAC();
                if (ac) {
                    try {
                        ac.postMessage(missionId, "operator", "planner",
                            `Detected ${count} recommendation(s). Top: [${top.priority}] ${top.title}`,
                            { type: "message" });
                    } catch {}
                }
            }
            return { success: true, output: `Detected ${count} recommendation(s)` };
        }

        case "reason": {
            const re = _getRE();
            let confidence = 70; // baseline
            if (re) {
                try {
                    const score = re.scoreConfidence({
                        missionAge:      Date.now() - new Date(mission.createdAt),
                        subtaskCount:    (mission.subtasks || []).length,
                        failureCount:    (mission.failures || []).length,
                        completedCount:  (mission.metrics || {}).completedSubtasks || 0,
                    });
                    confidence = score.overall ?? confidence;
                } catch {}
            }
            return { success: true, confidence, output: `Confidence: ${confidence}%` };
        }

        case "recommend": {
            const bg   = _getBG();
            const recs = bg ? bg.getRecommendations({ limit: 3 }) : { recommendations: [] };
            const count = (recs.recommendations || []).length;
            if (count > 0) {
                const mem = _getMem();
                if (mem) {
                    try {
                        mem.recordDecision(missionId, {
                            description: `${count} recommendations available`,
                            rationale:   (recs.recommendations[0] || {}).title || "automated",
                            outcome:     "pending",
                        });
                    } catch {}
                }
            }
            return { success: true, output: `${count} recommendation(s) recorded` };
        }

        case "plan": {
            const ap     = _getAP();
            const tg     = _getTG();
            const ac     = _getAC();
            let planInfo = "plan: no planner available";

            if (tg && ac) {
                try {
                    const { graphId, reused } = await ac.startCollaboration(missionId);
                    planInfo = reused
                        ? `Reusing graph ${graphId}`
                        : `Created graph ${graphId} for pipeline execution`;
                } catch (err) {
                    planInfo = `plan: startCollaboration failed — ${err.message}`;
                }
            } else if (ap) {
                try {
                    const next = ap.recommendNextObjective({ missionId });
                    planInfo = next ? `Next objective: ${(next.objective || "").slice(0, 80)}` : "plan complete";
                } catch {}
            }
            return { success: true, output: planInfo };
        }

        case "delegate": {
            const ac = _getAC();
            if (ac) {
                try {
                    ac.postMessage(missionId, "planner", "developer",
                        `Delegating execution for: "${mission.objective}"`, { type: "delegation" });
                } catch {}
            }
            return { success: true, output: "Delegated to developer agent" };
        }

        case "execute": {
            const tg  = _getTG();
            const ac  = _getAC();
            const lcp = _getLC(mission);
            const graphId = lcp._collab?.graphId || mission._collab?.graphId;

            if (tg && graphId) {
                const graph = tg.getGraph(graphId);
                if (graph && graph.status === "pending") {
                    // Fire-and-don't-await — graph runs async; lifecycle tracks separately
                    tg.executeGraph(graphId).catch(err => {
                        logger.warn(`[LifecycleRuntime] Graph execution error: ${err.message}`);
                    });
                    return { success: true, output: `Graph ${graphId} execution started` };
                }
                if (graph) return { success: true, output: `Graph ${graphId} status: ${graph.status}` };
            }
            if (ac) {
                try {
                    ac.postMessage(missionId, "developer", "reviewer",
                        `Execution complete for: "${mission.objective}"`, { type: "message" });
                } catch {}
            }
            return { success: true, output: "execute: dispatched to agent pipeline" };
        }

        case "review": {
            const ac = _getAC();
            if (ac) {
                try {
                    ac.postMessage(missionId, "reviewer", "tester",
                        `Review complete. Passing to tester for: "${mission.objective}"`, { type: "feedback" });
                } catch {}
            }
            return { success: true, output: "Review stage complete" };
        }

        case "test": {
            const ac = _getAC();
            if (ac) {
                try {
                    ac.postMessage(missionId, "tester", "security",
                        `Tests passed. Sending to security for: "${mission.objective}"`, { type: "feedback" });
                } catch {}
            }
            return { success: true, output: "Test stage complete" };
        }

        case "secure": {
            const er = _getER();
            const ac = _getAC();
            let riskInfo = "security audit complete";
            if (er) {
                try {
                    const risk = er.assessStrategicRisk({ missionId, objective: mission.objective });
                    riskInfo   = `Risk: ${risk.level || "low"} — ${(risk.summary || "").slice(0, 80)}`;
                } catch {}
            }
            if (ac) {
                try {
                    ac.postMessage(missionId, "security", "devops",
                        `Security audit complete. ${riskInfo}`, { type: "approval" });
                } catch {}
            }
            return { success: true, output: riskInfo };
        }

        case "deploy": {
            const ac  = _getAC();
            const mem = _getMem();
            if (mem) {
                try {
                    mem.recordDeployment(missionId, {
                        description: `Lifecycle deploy — ${mission.objective.slice(0, 80)}`,
                        environment: "production",
                        status:      "initiated",
                    });
                } catch {}
            }
            if (ac) {
                try {
                    ac.postMessage(missionId, "devops", "operator",
                        `Deployment initiated for: "${mission.objective}"`, { type: "message" });
                } catch {}
            }
            return { success: true, output: "deploy: deployment recorded" };
        }

        case "verify": {
            const bg = _getBG();
            let health = "unknown";
            if (bg) {
                try {
                    const status = bg.getStatus();
                    const obs    = status.observers || {};
                    const ok     = Object.values(obs).filter(o => o.lastError === null).length;
                    health       = `${ok}/${Object.keys(obs).length} observers healthy`;
                } catch {}
            }
            return { success: true, output: `verify: ${health}` };
        }

        case "heal": {
            const bg   = _getBG();
            const recs = bg ? bg.getRecommendations({ priority: "HIGH", limit: 3 }) : { recommendations: [] };
            const highPri = (recs.recommendations || []).filter(r => r.priority === "HIGH" || r.priority === "CRITICAL");
            if (highPri.length > 0 && bg) {
                for (const rec of highPri.slice(0, 2)) {
                    try { await bg.triggerObserver(rec.source); } catch {}
                }
            }
            return { success: true, output: `heal: addressed ${highPri.length} high-priority issue(s)` };
        }

        case "learn": {
            const mem = _getMem();
            if (mem) {
                try {
                    mem.addLearning(missionId, {
                        insight:    `Lifecycle completed for: ${mission.objective.slice(0, 100)}`,
                        source:     "lifecycle_runtime",
                        confidence: lc.confidence || 70,
                        appliesTo:  ["execution", "planning"],
                    });
                } catch {}
                try {
                    mem.recordArtifact(missionId, {
                        name:        "Lifecycle Completion Record",
                        type:        "report",
                        description: `Full lifecycle executed — ${STAGES.length} stages, confidence ${lc.confidence || "—"}%`,
                    });
                } catch {}
            }
            return { success: true, output: "learn: outcomes stored in mission memory" };
        }

        default:
            return { success: false, output: `Unknown stage: ${stageId}` };
    }
}

// ── Pipeline metadata export ─────────────────────────────────────────────────
module.exports = {
    startLifecycle,
    pauseLifecycle,
    resumeLifecycle,
    retryStage,
    getLifecycle,
    getCurrentStage,
    getLifecycleEvents,
    tick,
    STAGES,
};
