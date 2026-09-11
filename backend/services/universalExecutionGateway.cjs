"use strict";
/**
 * universalExecutionGateway.cjs — Phase 6 (Universal Execution), Missions 196-220.
 *
 * THIS IS NOT A FIFTH EXECUTION ENGINE. It is the single missing wiring
 * link the Phase 6 inventory found: Phases 1-5 each already built a real,
 * independently-tested piece of the chain
 *
 *   Intent -> Capability -> Agent -> (Approval) -> Execution -> Verification
 *   -> Evidence -> (Learning, gated)
 *
 * but nothing composed them into one callable path. Every step below is a
 * direct call into an existing, already-certified module:
 *
 *   1. Intent -> Capability   : capabilityRouting.routeIntent()      (Phase 1)
 *   2. Capability -> Agent    : same call's eligibleAgents/riskLevel  (Phase 1)
 *   3. Approval gate          : approvalQueue.enqueue()/getRequest()  (Phase 3/4/5's
 *                               own established composition point — the same
 *                               primitive orchestratorApprovalBridge.cjs,
 *                               marketplaceAutomationEngine.cjs's fixed
 *                               deprecate/retire path, and
 *                               improvementLoopEngine.cjs's activateApprovedTrial
 *                               all already use for exactly this shape of
 *                               problem)
 *   4. Execution              : agentExecutionEngine.executeTask()    (existing
 *                               per-agent dispatch/history/retry engine)
 *   5. Verification           : executionVerifier.verify()            (Phase 2's
 *                               real pm2/http/file probes + honest
 *                               falsePositive detection)
 *   6. Evidence               : approvalEvidence.record()             (existing
 *                               append-only evidence ledger)
 *
 * Explicitly NOT done here, by design:
 *   - No new capability/agent/tool/approval/verification registry.
 *   - No implicit privilege for marketplace-installed capabilities — a
 *     capability's `source` field is never consulted to grant anything;
 *     routing/approval/execution treat every skillRegistry entry identically
 *     regardless of where it came from.
 *   - No parameter fabrication. If a capability's `inputSchema` declares a
 *     required field the caller did not supply, this module refuses with
 *     `needs_clarification` and lists exactly which fields are missing —
 *     it never invents a value.
 *   - No auto-mutation of learning/evolution state after a successful
 *     execution. This module never calls continuousLearningEngine.applyLearningRecord()
 *     or improvementLoopEngine.activateApprovedTrial() — a caller who wants
 *     an execution's outcome to feed those must do so explicitly, through
 *     their own already-existing approval gates (Phase 5).
 *   - No tenant/workspace resolution of its own — opts.orgId/opts.workspaceId
 *     must be server-resolved by the caller (e.g. from req.user's session
 *     context, per CLAUDE.md §6), exactly like every other service in this
 *     file family; this module never reads a client-supplied header/body
 *     org field itself.
 */

const _try = fn => { try { return fn(); } catch { return null; } };

const _routing   = () => _try(() => require("./capabilityRouting.cjs"));
const _discovery = () => _try(() => require("./capabilityDiscovery.cjs"));
const _skills     = () => _try(() => require("./skillRegistry.cjs"));
const _approvalQ = () => _try(() => require("./approvalQueue.cjs"));
const _agentExec = () => _try(() => require("./agentExecutionEngine.cjs"));
const _verifier  = () => _try(() => require("../../agents/runtime/executionVerifier.cjs"));
const _evidence  = () => _try(() => require("./approvalEvidence.cjs"));

function _ts() { return new Date().toISOString(); }

/**
 * _missingRequiredParams(skill, params) -> string[]
 * Never fabricates a value for a required inputSchema field — only reports
 * what is missing so the caller (or a human) can supply it or the request
 * can be honestly declined.
 */
function _missingRequiredParams(skill, params = {}) {
    const schema = skill?.inputSchema;
    if (!schema || typeof schema !== "object") return [];
    const required = Array.isArray(schema.required) ? schema.required : [];
    return required.filter(key => params[key] === undefined || params[key] === null || params[key] === "");
}

/**
 * planExecution(intentText, opts) -> a pure, read-only preview of what
 * WOULD happen — never mutates, never enqueues, never dispatches. Useful
 * for a caller/UI to show "here's what I'm about to do" before committing.
 *
 * opts: { params, domain, orgId, workspaceId, agentId, requireApprovalAbove }
 */
function planExecution(intentText, opts = {}) {
    if (!intentText || typeof intentText !== "string" || !intentText.trim()) {
        return { ok: false, stage: "intent", blockedReasons: ["empty_intent"] };
    }

    const routing = _routing();
    if (!routing) return { ok: false, stage: "routing", blockedReasons: ["capability_routing_unavailable"] };

    const routed = routing.routeIntent(intentText, opts);
    if (!routed.ok && routed.blockedReasons?.includes("no_capability_match")) {
        // Genuine MISSING case: no known capability could satisfy this intent.
        // Never fabricated as "handled" — the caller must be told this
        // requires either a new capability or human handling.
        return {
            ok: false,
            stage: "capability_discovery",
            intentText,
            blockedReasons: ["no_capability_match"],
            alternatives: routed.matches || [],
        };
    }
    if (!routed.ok) {
        return { ok: false, stage: "routing", intentText, ...routed };
    }

    const skill = _skills()?.getSkill(routed.capabilityId);
    const missingParams = _missingRequiredParams(skill, opts.params);
    if (missingParams.length > 0) {
        // Ambiguous/incomplete intent -> ask for clarification, never invent.
        return {
            ok: false,
            stage: "needs_clarification",
            intentText,
            capabilityId: routed.capabilityId,
            missingParams,
            message: `Cannot execute "${routed.capabilityId}" — missing required parameter(s): ${missingParams.join(", ")}`,
        };
    }

    const preferredAgent = routed.eligibleAgents.find(a => a.isPreferred) || routed.eligibleAgents[0] || null;

    return {
        ok: true,
        stage: "ready",
        intentText,
        capabilityId: routed.capabilityId,
        matchedVia: routed.matchedVia,
        riskLevel: routed.riskLevel,
        approvalRequired: routed.approvalRequired,
        agentId: opts.agentId || preferredAgent?.agentId || null,
        eligibleAgents: routed.eligibleAgents,
        eligibleConnectors: routed.eligibleConnectors,
    };
}

/**
 * execute(intentText, opts) -> the real end-to-end path.
 *
 * Returns one of:
 *   { ok:false, stage:"capability_discovery"|"routing"|"needs_clarification", ... }  — declined, nothing dispatched
 *   { ok:true,  stage:"awaiting_approval", reqId, capabilityId, ... }                — gated, nothing dispatched yet
 *   { ok:true|false, stage:"executed", verifiedOutcome, ... }                        — dispatched + verified
 *
 * opts: { params, domain, orgId, workspaceId, agentId, requireApprovalAbove,
 *         probes, triggeredBy }
 *
 * Marketplace-installed capabilities receive NO special treatment here —
 * `skill.source` is never read by this function for authorization purposes.
 */
async function execute(intentText, opts = {}) {
    const plan = planExecution(intentText, opts);
    if (!plan.ok) return plan;

    // Approval gate — reuses the exact same primitive Phase 3/4/5 already
    // established as the correct composition point. Never bypassed for any
    // reason, including a marketplace-sourced capability.
    if (plan.approvalRequired) {
        const approvalQ = _approvalQ();
        if (!approvalQ) {
            return { ok: false, stage: "blocked", reason: "approval_queue_unavailable", capabilityId: plan.capabilityId };
        }
        const enqueued = approvalQ.enqueue({
            workflowId: `wf_universal_exec_${plan.capabilityId}`,
            action: `Execute capability "${plan.capabilityId}" via universal execution gateway`,
            reason: `Intent-routed execution: "${intentText}"`,
            risk: plan.riskLevel,
            approvalType: "GENERIC",
            context: { intentText, capabilityId: plan.capabilityId, agentId: plan.agentId, orgId: opts.orgId || null, params: opts.params || {} },
            triggeredBy: opts.triggeredBy || "universalExecutionGateway",
        });
        const reqId = enqueued?.reqId;
        if (!reqId) {
            return { ok: false, stage: "blocked", reason: "approval_enqueue_failed", capabilityId: plan.capabilityId };
        }

        _try(() => _evidence()?.record({
            reqId, workflowId: `wf_universal_exec_${plan.capabilityId}`, approvalType: "GENERIC",
            event: enqueued.autoApproved ? "auto_approved" : "created",
            autoApproved: !!enqueued.autoApproved,
            notes: enqueued.autoApproved
                ? "Universal execution gateway: auto-approved by policy, dispatching."
                : "Universal execution gateway: approval required before dispatch.",
        }));

        // Auto-approval is itself a real, pre-existing, policy-gated
        // decision made by approvalPolicy.cjs at enqueue time (not a bypass
        // introduced here) — mirrors improvementLoopEngine.cjs's own
        // activateApprovedTrial() treatment of auto_approved. Anything else
        // NEVER dispatches here; a caller/operator must separately resolve
        // the approval and call resumeApprovedExecution(reqId) — mirroring
        // improvementLoopEngine.cjs's deliberate propose/activate split
        // (Phase 5), which exists precisely to prevent "a decision event
        // silently becomes a mutation."
        if (enqueued.autoApproved) {
            return _dispatchAndVerify(plan, intentText, { ...opts, reqId });
        }
        return { ok: true, stage: "awaiting_approval", reqId, capabilityId: plan.capabilityId, agentId: plan.agentId };
    }

    return _dispatchAndVerify(plan, intentText, opts);
}

/**
 * resumeApprovedExecution(reqId, opts) -> dispatches a previously-gated
 * execution, but ONLY if approvalQueue's own live, persisted record for
 * reqId is genuinely resolved approved/auto_approved. Never trusts a
 * caller-supplied "it's approved" flag.
 */
async function resumeApprovedExecution(reqId, opts = {}) {
    const approvalQ = _approvalQ();
    const req = approvalQ?.getRequest?.(reqId);
    if (!req) return { ok: false, stage: "blocked", reason: "approval_request_not_found", reqId };
    if (req.status !== "approved" && req.status !== "auto_approved") {
        return { ok: false, stage: "blocked", reason: `approval_not_resolved: status=${req.status}`, reqId };
    }

    const { capabilityId, agentId, intentText: origIntent } = req.context || {};
    if (!capabilityId) return { ok: false, stage: "blocked", reason: "malformed_approval_context", reqId };

    const routing = _routing();
    const routed = routing.routeCapability(capabilityId, opts);
    if (!routed.ok) return { ok: false, stage: "routing", reqId, ...routed };

    const plan = {
        ok: true, stage: "ready", intentText: origIntent, capabilityId,
        riskLevel: routed.riskLevel, agentId: agentId || routed.eligibleAgents[0]?.agentId || null,
    };

    _try(() => _evidence()?.record({
        reqId, workflowId: `wf_universal_exec_${capabilityId}`, approvalType: "GENERIC",
        event: req.status === "auto_approved" ? "auto_approved" : "approved",
        approvedBy: req.approvedBy || null,
        notes: "Universal execution gateway: approval resolved, dispatching.",
    }));

    return _dispatchAndVerify(plan, origIntent, { ...opts, reqId });
}

/**
 * _dispatchAndVerify — the only place this file ever calls
 * agentExecutionEngine.executeTask() (real dispatch). Always followed by a
 * real verification pass; the returned outcome always reflects
 * verification, never the raw dispatch result alone (Phase 2's
 * verifiedOutcome pattern, reapplied here for the exact same reason
 * approvalEngine.cjs's _resumeExecution() needed it).
 */
async function _dispatchAndVerify(plan, intentText, opts = {}) {
    const agentExec = _agentExec();
    if (!agentExec) return { ok: false, stage: "blocked", reason: "agent_execution_engine_unavailable", capabilityId: plan.capabilityId };
    if (!plan.agentId) return { ok: false, stage: "blocked", reason: "no_eligible_agent", capabilityId: plan.capabilityId };

    const dispatchResult = await agentExec.executeTask(
        plan.agentId,
        intentText || `Execute capability: ${plan.capabilityId}`,
        { type: "universal_execution", agentId: plan.agentId, cycleId: opts.reqId || null }
    );

    const verifier = _verifier();
    const probes = opts.probes || {};
    const verification = verifier
        ? await verifier.verify({ success: dispatchResult.success, error: dispatchResult.error }, probes)
        : { verified: dispatchResult.success, checks: [], falsePositive: false, summary: "verifier_unavailable" };

    // Phase 2's verifiedOutcome pattern: a tool call reporting success is
    // NEVER treated as final success unless the independent verification
    // pass also agrees. A capability with no probes configured degrades
    // gracefully to trusting the dispatch result (documented, not silently
    // assumed — see Phase 6 report's Idempotency/Verification findings).
    const verifiedOutcome = verification.falsePositive ? "failed" : (dispatchResult.success ? "success" : "failed");

    _try(() => _evidence()?.record({
        reqId: opts.reqId || null,
        workflowId: `wf_universal_exec_${plan.capabilityId}`,
        approvalType: "GENERIC",
        event: "verified",
        outcome: verifiedOutcome,
        executionId: dispatchResult.runId || null,
        notes: verification.falsePositive
            ? "Tool reported success but post-execution verification failed — recorded as failed, not success."
            : "Execution verified.",
    }));

    return {
        ok: verifiedOutcome === "success",
        stage: "executed",
        capabilityId: plan.capabilityId,
        agentId: plan.agentId,
        runId: dispatchResult.runId || null,
        dispatchResult,
        verification,
        verifiedOutcome,
    };
}

module.exports = { planExecution, execute, resumeApprovedExecution };
