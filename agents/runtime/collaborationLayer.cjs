"use strict";
/**
 * collaborationLayer.cjs — J5 Human–AI Collaboration Layer
 *
 * Integrates: Mission Runtime, Mission Memory, Agent Collaboration,
 * Reasoning Engine, Executive Reasoning, AI Service, Runtime Event Bus.
 *
 * All state is stored on existing mission objects via missionMemory.
 * No new storage files. No new observers. No new timers.
 *
 * Actions available per mission:
 *   ask_ai, ask_agent, explain_decision, explain_risk, explain_confidence,
 *   compare_alternatives, accept_recommendation, reject_recommendation,
 *   request_replan, escalate_operator
 *
 * Every interaction is recorded to the mission timeline via:
 *   missionMemory.recordDecision()  — for AI/agent messages
 *   missionMemory.recordApproval()  — for accept/reject
 *   missionMemory.addLearning()     — for replan + escalations
 *   missionMemory.updateMission()   — to store _collaboration state
 *
 * Exposed API:
 *   getSession(missionId)
 *   getHistory(missionId, opts)
 *   sendMessage(missionId, from, body, opts)     → ask_ai / ask_agent
 *   performAction(missionId, action, payload)    → all 10 actions
 *   requestReplan(missionId, reason)
 *   approve(missionId, itemId, approvedBy)
 *   reject(missionId, itemId, reason, rejectedBy)
 */

const logger = require("../../backend/utils/logger");

// ── Lazy service refs ────────────────────────────────────────────────────────
let _mm  = null, _re  = null, _er  = null, _ac  = null,
    _mr  = null, _ai  = null, _bus = null, _ap  = null;

function _getMM()  { if (!_mm)  try { _mm  = require("../../backend/services/missionMemory.cjs");     } catch {} return _mm;  }
function _getRE()  { if (!_re)  try { _re  = require("../../backend/services/reasoningEngine.cjs");   } catch {} return _re;  }
function _getER()  { if (!_er)  try { _er  = require("../../backend/services/executiveReasoning.cjs"); } catch {} return _er; }
function _getAC()  { if (!_ac)  try { _ac  = require("./agentCollaboration.cjs");                     } catch {} return _ac;  }
function _getMR()  { if (!_mr)  try { _mr  = require("./missionRuntime.cjs");                         } catch {} return _mr;  }
function _getAI()  { if (!_ai)  try { _ai  = require("../../backend/services/aiService.js");          } catch {} return _ai;  }
function _getBus() { if (!_bus) try { _bus = require("./runtimeEventBus.cjs");                        } catch {} return _bus; }
function _getAP()  { if (!_ap)  try { _ap  = require("../../backend/services/autonomousPlanning.cjs"); } catch {} return _ap; }

// ── Helpers ──────────────────────────────────────────────────────────────────
function _uid(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

function _emit(type, missionId, payload = {}) {
    const bus = _getBus();
    if (bus) bus.emit(type, { missionId, ...payload, _ts: Date.now() });
}

function _getCollab(mission) {
    return mission._collaboration || {
        sessionId:   _uid("csn"),
        startedAt:   new Date().toISOString(),
        messages:    [],
        actions:     [],
        pendingItems: [],
    };
}

function _saveCollab(missionId, collab) {
    const mm = _getMM();
    if (mm) {
        mm.updateMission(missionId, { _collaboration: collab });
    }
}

function _missionContext(mission) {
    return {
        missionId:   mission.id,
        title:       mission.title || mission.goal || "Untitled",
        status:      mission.status,
        progress:    mission.metrics?.progress ?? 0,
        subtasks:    (mission.subtasks || []).length,
        decisions:   (mission.decisions || []).length,
        failureCount:(mission.failures  || []).length,
    };
}

// ── Action implementations ────────────────────────────────────────────────────

async function _askAI(mission, body, opts = {}) {
    const ai = _getAI();
    const context = _missionContext(mission);
    const systemPrompt =
        `You are Jarvis AI assistant collaborating on a mission.\n` +
        `Mission: "${context.title}" | Status: ${context.status} | Progress: ${context.progress}%\n` +
        `Be concise. Answer directly. Focus on actionable insights.`;

    let reply = "AI backend unavailable.";
    if (ai) {
        try {
            reply = await ai.callAI(body, {
                system:  systemPrompt,
                history: (opts.history || []).slice(-6),
            });
        } catch (err) {
            logger.warn(`[CollabLayer] AI call failed: ${err.message}`);
            reply = `AI unavailable: ${err.message}`;
        }
    }
    return { type: "ask_ai", reply, agent: "jarvis-ai" };
}

async function _askAgent(mission, body, agentId, opts = {}) {
    const ac = _getAC();
    if (ac) {
        try {
            await ac.startCollaboration(mission.id);
            const msg = ac.postMessage(mission.id, opts.from || "operator", agentId, body, {
                type:     "question",
                metadata: { collaborationLayer: true },
            });
            // Also invoke AI with agent persona for immediate reply
            const ai = _getAI();
            let reply = `${agentId}: Question received and queued for processing.`;
            if (ai) {
                try {
                    reply = await ai.callAI(body, {
                        system: `You are the ${agentId} agent in Jarvis OS. Answer in character. Mission: "${mission.title || mission.goal}". Be concise and technical.`,
                    });
                } catch {}
            }
            return { type: "ask_agent", agentId, messageId: msg.id, reply };
        } catch (err) {
            logger.warn(`[CollabLayer] ask_agent failed: ${err.message}`);
        }
    }
    return { type: "ask_agent", agentId, reply: `${agentId}: Agent collaboration unavailable.` };
}

function _explainDecision(mission, decisionId) {
    const decisions = mission.decisions || [];
    const dec = decisionId
        ? decisions.find(d => d.id === decisionId)
        : decisions[decisions.length - 1];

    if (!dec) return { type: "explain_decision", explanation: "No decisions recorded on this mission yet." };

    const re = _getRE();
    let riskSummary = null;
    if (re) {
        try {
            const r = re.analyzeRisk({ title: dec.description, type: dec.type }, { missionSuccessRate: mission.metrics?.successRate || 50 });
            riskSummary = r;
        } catch {}
    }

    return {
        type: "explain_decision",
        decision: dec,
        riskSummary,
        explanation:
            `Decision "${dec.description}" (type: ${dec.type}) was recorded at ${dec.timestamp}. ` +
            (dec.rationale ? `Rationale: ${dec.rationale}.` : "No explicit rationale recorded.") +
            (dec.outcome   ? ` Outcome: ${dec.outcome}.`   : ""),
    };
}

function _explainRisk(mission, context) {
    const er = _getER();
    const re = _getRE();

    const ctx = {
        missionId:   mission.id,
        title:       mission.title || mission.goal,
        status:      mission.status,
        failureCount: (mission.failures || []).length,
        decisionCount:(mission.decisions || []).length,
        ...context,
    };

    let strategicRisk = null;
    let technicalRisk = null;

    if (er) {
        try { strategicRisk = er.assessStrategicRisk(ctx); } catch {}
    }
    if (re) {
        try {
            technicalRisk = re.analyzeRisk(
                { title: mission.title || mission.goal, type: "mission" },
                { missionSuccessRate: mission.metrics?.successRate ?? 50 }
            );
        } catch {}
    }

    return {
        type: "explain_risk",
        missionId:    mission.id,
        strategicRisk,
        technicalRisk,
        summary: [
            strategicRisk ? `Strategic risk: ${strategicRisk.level} — ${strategicRisk.summary || ""}` : null,
            technicalRisk ? `Technical risk: ${technicalRisk.level} — ${technicalRisk.summary || technicalRisk.primaryRisk || ""}` : null,
            (mission.failures || []).length > 0
                ? `${mission.failures.length} failure(s) on record for this mission`
                : "No recorded failures",
        ].filter(Boolean).join(". "),
    };
}

function _explainConfidence(mission, recId) {
    const re  = _getRE();

    // If a recId was given, try to get a full explanation from reasoningEngine
    if (recId && re) {
        try {
            const ex = re.explainRecommendation(recId, {
                context: { missionId: mission.id, missionSuccessRate: mission.metrics?.successRate ?? 50 }
            });
            if (ex) {
                return {
                    type: "explain_confidence",
                    recId,
                    confidence: ex.confidence,
                    factors:    ex.confidenceFactors || [],
                    reasoning:  ex.reasoning || ex.explanation,
                };
            }
        } catch {}
    }

    // Fallback: score confidence from mission signals
    let conf = null;
    if (re) {
        try {
            conf = re.scoreConfidence({
                lessonCount:           (mission.learnings  || []).length,
                recurrenceRate:        0.3,
                historicalSuccessRate: (mission.metrics?.successRate ?? 50) / 100,
                dataFreshnessMs:       Date.now() - new Date(mission.createdAt || Date.now()).getTime(),
                severity:              (mission.failures || []).length > 2 ? "high" : "medium",
            });
        } catch {}
    }

    return {
        type: "explain_confidence",
        recId: null,
        confidence: conf?.overall ?? null,
        factors:    conf?.factors   ? Object.entries(conf.factors).map(([k, v]) => `${k}: ${v}`) : [],
        reasoning:  conf ? `Mission confidence scored at ${conf.overall}% based on learnings and historical performance.` : "Confidence data unavailable.",
    };
}

function _compareAlternatives(mission, plans) {
    const er = _getER();

    if (!plans || plans.length === 0) {
        // Auto-generate two basic alternatives from mission context
        plans = [
            { id: "plan_a", name: "Current trajectory", description: mission.goal, estimatedHours: 8,  risk: "medium", effort: "medium" },
            { id: "plan_b", name: "Accelerated approach", description: `Fast-track: ${mission.goal}`, estimatedHours: 4, risk: "high",   effort: "high" },
        ];
    }

    let comparison = null;
    if (er) {
        try {
            comparison = er.compareExecutionPlans(plans);
        } catch {}
    }

    return {
        type: "compare_alternatives",
        plans,
        comparison,
        recommendation: comparison?.winner?.id || plans[0]?.id,
        summary: comparison?.summary || `Compared ${plans.length} alternative plan(s). Review rationale for details.`,
    };
}

// ── Session management ────────────────────────────────────────────────────────

function getSession(missionId) {
    const mm = _getMM();
    if (!mm) throw new Error("missionMemory unavailable");
    const mission = mm.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const collab = _getCollab(mission);

    return {
        missionId,
        sessionId:    collab.sessionId,
        startedAt:    collab.startedAt,
        messageCount: collab.messages.length,
        actionCount:  collab.actions.length,
        pendingCount: collab.pendingItems.length,
        mission:      _missionContext(mission),
    };
}

function getHistory(missionId, opts = {}) {
    const mm = _getMM();
    if (!mm) throw new Error("missionMemory unavailable");
    const mission = mm.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const collab   = _getCollab(mission);
    const limit    = Math.min(opts.limit || 50, 200);
    const messages = collab.messages.slice(-limit);
    const actions  = collab.actions.slice(-limit);

    // Merge messages + actions into unified timeline
    const timeline = [
        ...messages.map(m => ({ ...m, _kind: "message" })),
        ...actions.map(a => ({ ...a, _kind:  "action"  })),
    ].sort((a, b) => new Date(a.ts || a.timestamp) - new Date(b.ts || b.timestamp)).slice(-limit);

    return {
        missionId,
        sessionId:   collab.sessionId,
        timeline,
        pending:     collab.pendingItems || [],
        totals: {
            messages: collab.messages.length,
            actions:  collab.actions.length,
            pending:  collab.pendingItems.length,
        },
    };
}

// ── sendMessage ───────────────────────────────────────────────────────────────
async function sendMessage(missionId, from = "operator", body, opts = {}) {
    const mm = _getMM();
    if (!mm) throw new Error("missionMemory unavailable");
    const mission = mm.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const collab = _getCollab(mission);
    const msgId  = _uid("cmsg");
    const ts     = new Date().toISOString();

    // Route: ask specific agent vs ask AI
    let result;
    if (opts.agentId) {
        result = await _askAgent(mission, body, opts.agentId, { from, history: collab.messages });
    } else {
        result = await _askAI(mission, body, { history: collab.messages });
    }

    const entry = { id: msgId, from, to: opts.agentId || "jarvis-ai", body, reply: result.reply, ts, type: opts.type || "message", agent: result.agentId || result.agent || null };

    collab.messages.push(entry);
    if (collab.messages.length > 300) collab.messages = collab.messages.slice(-300);
    _saveCollab(missionId, collab);

    // Record to mission timeline
    try {
        mm.recordDecision(missionId, {
            type:        "collaboration_message",
            description: `[${from} → ${entry.to}] ${body.slice(0, 120)}`,
            rationale:   result.reply?.slice(0, 200) || null,
            outcome:     null,
        });
    } catch {}

    _emit("collaboration:message", missionId, { msgId, from, to: entry.to, type: entry.type });

    return { ...entry, result };
}

// ── performAction ─────────────────────────────────────────────────────────────
async function performAction(missionId, action, payload = {}) {
    const mm = _getMM();
    if (!mm) throw new Error("missionMemory unavailable");
    const mission = mm.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const VALID_ACTIONS = [
        "ask_ai", "ask_agent", "explain_decision", "explain_risk",
        "explain_confidence", "compare_alternatives",
        "accept_recommendation", "reject_recommendation",
        "request_replan", "escalate_operator",
    ];
    if (!VALID_ACTIONS.includes(action)) {
        throw new Error(`Unknown action: ${action}. Valid: ${VALID_ACTIONS.join(", ")}`);
    }

    const collab = _getCollab(mission);
    const actId  = _uid("cact");
    const ts     = new Date().toISOString();

    let result = {};

    switch (action) {
        case "ask_ai":
            result = await _askAI(mission, payload.body || payload.message || "", { history: collab.messages });
            break;

        case "ask_agent":
            result = await _askAgent(mission, payload.body || payload.message || "", payload.agentId || "developer", { from: payload.from });
            break;

        case "explain_decision":
            result = _explainDecision(mission, payload.decisionId);
            break;

        case "explain_risk":
            result = _explainRisk(mission, payload.context || {});
            break;

        case "explain_confidence":
            result = _explainConfidence(mission, payload.recId);
            break;

        case "compare_alternatives":
            result = _compareAlternatives(mission, payload.plans || []);
            break;

        case "accept_recommendation": {
            const recId   = payload.recId || payload.id;
            const reason  = payload.reason || "Operator accepted";
            try {
                mm.recordApproval(missionId, {
                    type:        "recommendation_approval",
                    status:      "approved",
                    requestedBy: payload.requestedBy || null,
                    approvedBy:  payload.approvedBy  || payload.by || "operator",
                });
                mm.addLearning(missionId, {
                    insight: `Recommendation ${recId || "accepted"} approved by operator: ${reason}`,
                    source:  "operator_approval",
                    confidence: 90,
                });
            } catch {}
            // Remove from pending
            collab.pendingItems = (collab.pendingItems || []).filter(p => p.id !== recId);
            result = { type: "accept_recommendation", recId, status: "approved", reason };
            break;
        }

        case "reject_recommendation": {
            const recId  = payload.recId || payload.id;
            const reason = payload.reason || "Operator rejected";
            try {
                mm.recordApproval(missionId, {
                    type:        "recommendation_rejection",
                    status:      "rejected",
                    requestedBy: payload.requestedBy || null,
                    approvedBy:  payload.rejectedBy  || payload.by || "operator",
                });
                mm.addLearning(missionId, {
                    insight: `Recommendation ${recId || "rejected"} rejected by operator: ${reason}`,
                    source:  "operator_rejection",
                    confidence: 85,
                });
            } catch {}
            collab.pendingItems = (collab.pendingItems || []).filter(p => p.id !== recId);
            result = { type: "reject_recommendation", recId, status: "rejected", reason };
            break;
        }

        case "request_replan": {
            const reason = payload.reason || "Operator requested re-plan";
            const ap     = _getAP();
            let planResult = null;
            if (ap) {
                try { planResult = await ap.refreshHorizon("immediate"); } catch {}
            }
            try {
                mm.addLearning(missionId, {
                    insight: `Re-plan requested: ${reason}`,
                    source:  "operator_replan",
                    confidence: 75,
                });
                mm.recordDecision(missionId, {
                    type:        "replan_requested",
                    description: `Operator requested re-plan: ${reason}`,
                    rationale:   reason,
                    outcome:     planResult ? "Planning horizon refreshed" : null,
                });
            } catch {}
            _emit("collaboration:replan", missionId, { reason });
            result = { type: "request_replan", reason, planRefreshed: !!planResult };
            break;
        }

        case "escalate_operator": {
            const message  = payload.message || payload.reason || "Operator escalation";
            const priority = payload.priority || "HIGH";
            try {
                mm.recordDecision(missionId, {
                    type:        "operator_escalation",
                    description: `Escalated to operator: ${message}`,
                    rationale:   `Priority: ${priority}`,
                    outcome:     null,
                });
                mm.addLearning(missionId, {
                    insight: `Mission escalated to operator (${priority}): ${message}`,
                    source:  "escalation",
                    confidence: 95,
                });
            } catch {}
            _emit("collaboration:escalation", missionId, { message, priority });
            result = { type: "escalate_operator", message, priority, escalatedAt: ts };
            break;
        }

        default:
            result = { type: action, error: "unhandled" };
    }

    // Record action to collab state
    const actEntry = { id: actId, action, payload, result, ts, by: payload.by || payload.from || "operator" };
    collab.actions.push(actEntry);
    if (collab.actions.length > 200) collab.actions = collab.actions.slice(-200);
    _saveCollab(missionId, collab);

    _emit("collaboration:action", missionId, { actId, action, by: actEntry.by });

    return { actionId: actId, action, missionId, result, ts };
}

// ── requestReplan ─────────────────────────────────────────────────────────────
async function requestReplan(missionId, reason = "Operator requested") {
    return performAction(missionId, "request_replan", { reason });
}

// ── approve ───────────────────────────────────────────────────────────────────
async function approve(missionId, itemId, approvedBy = "operator") {
    return performAction(missionId, "accept_recommendation", { recId: itemId, approvedBy });
}

// ── reject ────────────────────────────────────────────────────────────────────
async function reject(missionId, itemId, reason = "Rejected", rejectedBy = "operator") {
    return performAction(missionId, "reject_recommendation", { recId: itemId, reason, rejectedBy });
}

module.exports = {
    getSession,
    getHistory,
    sendMessage,
    performAction,
    requestReplan,
    approve,
    reject,
};
