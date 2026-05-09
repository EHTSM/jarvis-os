"use strict";
const { ultimateLog, isKillSwitchActive, load, flush, uid, NOW, ok, fail, blocked, killed } = require("./_ultimateStore.cjs");

const AGENT = "humanAssistController";

// Human-in-the-loop controller — ensures all critical flows include a human decision point.
// This is an ASSISTANCE system, not a replacement system. It routes tasks to humans or AI
// based on sensitivity, confidence, and user preference.

const ASSIST_MODES = ["full_auto","human_review","human_approval","human_only"];
const SENSITIVITY_LEVELS = {
    low:      { autoOk: true,  reviewRequired: false, approvalRequired: false },
    moderate: { autoOk: true,  reviewRequired: true,  approvalRequired: false },
    high:     { autoOk: false, reviewRequired: true,  approvalRequired: true  },
    critical: { autoOk: false, reviewRequired: true,  approvalRequired: true  }
};

function assessHandoff({ userId, task, sensitivityLevel = "moderate", confidence_pct = 80, preferredMode = "human_review" }) {
    if (!userId || !task) return fail(AGENT, "userId and task are required");
    if (!SENSITIVITY_LEVELS[sensitivityLevel]) return fail(AGENT, `sensitivityLevel must be: ${Object.keys(SENSITIVITY_LEVELS).join(", ")}`);
    if (!ASSIST_MODES.includes(preferredMode)) return fail(AGENT, `preferredMode must be: ${ASSIST_MODES.join(", ")}`);
    if (isKillSwitchActive()) return killed(AGENT);

    const policy     = SENSITIVITY_LEVELS[sensitivityLevel];
    const lowConf    = confidence_pct < 70;
    const needsHuman = policy.approvalRequired || lowConf || preferredMode === "human_only";

    const decision = {
        decisionId:       uid("hac"),
        userId,
        task:             (task || "").slice(0, 200),
        sensitivityLevel,
        confidence_pct,
        preferredMode,
        recommendation:   needsHuman ? "escalate_to_human" : "proceed_automated",
        humanRequired:    needsHuman,
        approvalRequired: policy.approvalRequired,
        reviewRequired:   policy.reviewRequired || lowConf,
        reasoning:        needsHuman
            ? `Sensitivity '${sensitivityLevel}' or low confidence (${confidence_pct}%) requires human oversight.`
            : `Task is within automated safety bounds. Human review optional.`,
        assistMode:       needsHuman ? "human_approval" : preferredMode,
        decidedAt:        NOW()
    };

    const log = load("handoff_log", []);
    log.push({ decisionId: decision.decisionId, userId, sensitivityLevel, humanRequired: needsHuman, decidedAt: decision.decidedAt });
    flush("handoff_log", log.slice(-2000));

    ultimateLog(AGENT, "handoff_assessed", { userId, sensitivityLevel, humanRequired: needsHuman, confidence_pct }, "INFO");
    return ok(AGENT, decision, needsHuman ? "human_required" : "approved");
}

function requestHumanInput({ userId, question, context = {}, timeoutMinutes = 30 }) {
    if (!userId || !question) return fail(AGENT, "userId and question are required");

    const request = {
        requestId:       uid("hreq"),
        userId,
        question,
        context,
        status:          "awaiting_human",
        expiresAt:       new Date(Date.now() + timeoutMinutes * 60000).toISOString(),
        requestedAt:     NOW()
    };

    const pending = load("human_input_requests", []);
    pending.push(request);
    flush("human_input_requests", pending.slice(-500));

    ultimateLog(AGENT, "human_input_requested", { requestId: request.requestId, userId }, "INFO");
    return ok(AGENT, { ...request, message: `Human input required. Request ID: ${request.requestId}. Awaiting response.` }, "awaiting_human");
}

function submitHumanResponse({ requestId, response, respondedBy }) {
    if (!requestId || !response) return fail(AGENT, "requestId and response are required");

    const pending = load("human_input_requests", []);
    const req     = pending.find(r => r.requestId === requestId);
    if (!req) return fail(AGENT, `Request '${requestId}' not found`);

    req.status      = "responded";
    req.response    = response;
    req.respondedBy = respondedBy || "human";
    req.respondedAt = NOW();
    flush("human_input_requests", pending);

    ultimateLog(AGENT, "human_response_received", { requestId, respondedBy }, "INFO");
    return ok(AGENT, { requestId, response, respondedBy, respondedAt: req.respondedAt });
}

function getAssistModes() {
    return ok(AGENT, { modes: ASSIST_MODES, sensitivityLevels: SENSITIVITY_LEVELS, note: "System operates as a human ASSISTANCE tool, never a replacement." });
}

module.exports = { assessHandoff, requestHumanInput, submitHumanResponse, getAssistModes };
