"use strict";
/**
 * escalationTrigger — automatically gate high-risk operations behind human approval.
 *
 * evaluate(operation, context?)
 *   → { shouldEscalate, reason, score, level }
 *
 * trigger(operation, context?, opts?)
 *   → { escalated, approved, reason, approvalId }
 *   Calls humanApproval.requestApproval and waits for decision.
 *
 * getHistory()   → escalation event log
 * reset()
 */

const os_          = require("../trust/operationScorer.cjs");
const ha           = require("../humanApproval.cjs");

const APPROVAL_TIMEOUT_MS = 30_000;

let _history = [];
let _seq     = 0;

function evaluate(operation, context = {}) {
    const type   = operation.type   || "command_exec";
    const detail = operation.detail || {};
    const cmd    = operation.command;

    const opScore  = os_.scoreOperation(type, detail);
    const cmdScore = cmd ? os_.scoreCommand(cmd) : { score: 0, factors: [] };

    // Take the higher of the two scores
    const score    = Math.max(opScore.score, cmdScore.score);
    const level    = opScore.level;
    const factors  = [...new Set([...opScore.factors, ...cmdScore.factors])];

    const shouldEscalate = os_.shouldEscalate(score);
    const reason = shouldEscalate
        ? `score=${score} (${level}); factors: ${factors.join(", ") || "base_score"}`
        : "score_below_threshold";

    return { shouldEscalate, reason, score, level, factors };
}

async function trigger(operation, context = {}, opts = {}) {
    const eval_ = evaluate(operation, context);

    if (!eval_.shouldEscalate) {
        return { escalated: false, approved: true, reason: "auto_approved_low_risk", approvalId: null };
    }

    const approvalId = `esc-${++_seq}-${Date.now()}`;
    ha.requestApproval(approvalId, operation.type || "operation", {
        score:     eval_.score,
        level:     eval_.level,
        factors:   eval_.factors,
        operation: operation.command || operation.type,
        context,
    }, { priority: eval_.level });

    const timeoutMs = opts.timeoutMs ?? APPROVAL_TIMEOUT_MS;
    const result    = await ha.waitForApproval(approvalId, timeoutMs);

    const entry = {
        ts:          new Date().toISOString(),
        approvalId,
        operation:   operation.type || operation.command || "unknown",
        score:       eval_.score,
        level:       eval_.level,
        approved:    result.approved,
        reason:      result.reason,
    };
    _history.push(entry);

    return {
        escalated:  true,
        approved:   result.approved,
        reason:     result.reason,
        approvalId,
    };
}

function getHistory() { return [..._history]; }

function reset() { _history = []; _seq = 0; ha.reset(); }

module.exports = { evaluate, trigger, getHistory, reset, APPROVAL_TIMEOUT_MS };
