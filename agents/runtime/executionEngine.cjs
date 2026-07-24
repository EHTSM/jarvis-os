"use strict";
/**
 * executionEngine — async task executor with:
 *   - context injection from memoryContext
 *   - capability-based agent routing via taskRouter + agentRegistry
 *   - exponential backoff retries (max 3 attempts)
 *   - circuit breaker enforcement (per AgentRecord)
 *   - execution history recording
 *   - per-task timeout (default 30s)
 *
 * Falls back to the existing executor.cjs if no registered agent matches.
 */

const logger   = require("../../backend/utils/logger");
const registry = require("./agentRegistry.cjs");
const router   = require("./taskRouter.cjs");
const history  = require("./executionHistory.cjs");
const memory   = require("./memoryContext.cjs");
const dlq      = require("./deadLetterQueue.cjs");

const MAX_ATTEMPTS   = 3;
const BASE_BACKOFF   = 1_000;   // ms
const MAX_BACKOFF    = 30_000;  // ms
const DEFAULT_TIMEOUT = 30_000; // ms

// Lazy-load the existing executor as the universal fallback
let _legacyExecutor = null;
function _getLegacy() {
    if (!_legacyExecutor) {
        try { _legacyExecutor = require("../executor.cjs"); } catch { _legacyExecutor = null; }
    }
    return _legacyExecutor;
}

// Lazy-load the agent instance registry (Universal Composition Engine
// Phase 4). Additive only — when a task carries no orgId, or no instance
// is registered for that org+capability, dispatch behaves exactly as
// before this existed.
let _instReg_ = null;
function _instReg() {
    if (!_instReg_) {
        try { _instReg_ = require("../../backend/services/agentInstanceRegistry.cjs"); } catch { _instReg_ = null; }
    }
    return _instReg_;
}

// Universal Composition Engine Phase 11 — the remaining lookups in the
// Goal->Plan->...->Execute->Verify->Telemetry->Memory/KPI chain. Every
// accessor below follows the same lazy try/catch convention as _instReg()
// and _getLegacy() above; every lookup is skip-safe (module unreachable
// or task not org-scoped -> behaves exactly as pre-Phase-11 dispatch).
function _skillReg()  { try { return require("../../backend/services/skillRegistry.cjs");       } catch { return null; } }
function _toolFabric() { try { return require("../../backend/services/toolExecutionLayer.cjs");  } catch { return null; } }
function _connReg()   { try { return require("../../backend/services/integrationConnectors.cjs"); } catch { return null; } }
function _approvalQ() { try { return require("../../backend/services/approvalQueue.cjs");        } catch { return null; } }
function _obsEngine()  { try { return require("../../backend/services/observabilityEngine.cjs"); } catch { return null; } }
function _vault()      { try { return require("../../backend/services/secretVault.cjs");         } catch { return null; } }

function _backoffMs(attempt) {
    return Math.min(BASE_BACKOFF * Math.pow(2, attempt), MAX_BACKOFF);
}

function _sleep(ms) {
    return new Promise(r => setTimeout(r, ms).unref());
}

function _withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms).unref()
        ),
    ]);
}

// Universal Composition Engine Phase 11 — steps 8 (emit telemetry) and 9
// (update memory/KPI). Called once per terminal outcome (success or final
// failure), not per retry attempt. Non-fatal by design: telemetry/memory
// recording must never be the reason a task's own success/failure result
// changes.
function _emitTelemetryAndMemory(task, { success, durationMs, error, agentInstanceId }) {
    try {
        _obsEngine()?.recordMetric?.("execution.task.completed", 1, {
            taskType: task.type, success: !!success, orgId: task.orgId || null,
        });
    } catch { /* non-fatal */ }
    if (task.orgId && agentInstanceId) {
        try {
            _instReg()?.recordObservation?.(agentInstanceId, {
                success: !!success, durationMs: durationMs || 0, taskType: task.type, error: error || null,
            });
        } catch { /* non-fatal */ }
    }
}

/**
 * Execute a single task object.
 *
 * @param {object} task    — planner task: { type, label, payload, input }
 * @param {object} options — { taskId, timeoutMs, retries, context }
 * @returns {Promise<{ success, result, agentId, durationMs, attempts, error }>}
 */
async function executeTask(task, options = {}) {
    const taskId     = options.taskId    || `t-${Date.now().toString(36)}`;
    const timeoutMs  = options.timeoutMs || DEFAULT_TIMEOUT;
    const maxRetries = options.retries   !== undefined ? options.retries : MAX_ATTEMPTS;

    // Inject memory context
    const ctx = options.context || memory.getContextForTask(task.input || task.label || "", task.type);

    const capability = router.resolveCapability(task.type);
    let   lastError  = null;

    // Agent Factory instance overlay (Universal Composition Engine Phase 4):
    // if this task is scoped to an org, look up whether that org has a
    // configured AgentInstance for this capability and merge its
    // config/memoryScope/credentialRefs/permissions into ctx. No task.orgId
    // or no matching instance -> ctx is unchanged, identical to pre-Phase-4
    // behavior.
    let instanceCtx = ctx;
    if (task.orgId) {
        const inst = _instReg()?.findForOrgAndArchetype?.(task.orgId, capability);
        if (inst) {
            instanceCtx = {
                ...ctx,
                agentInstanceId: inst.id,
                companyId: inst.companyId,
                departmentId: inst.departmentId,
                goals: inst.config.goals,
                policies: inst.config.policies,
                memoryScopeId: inst.config.memoryScopeId,
                kpiTargets: inst.config.kpiTargets,
                credentialRefs: inst.credentialRefs,
                agentPermissions: inst.permissions,
            };
            // Vault Security Hardening — Agent -> Connector -> Vault
            // Authorization: resolve each declared credentialRef into its
            // actual value, scoped to THIS task's own orgId (never a
            // caller-supplied org — task.orgId is the only org identity
            // an agent handler's ctx is ever built from). The handler
            // receives ctx.resolvedCredentials (a ref->value map for refs
            // it was genuinely authorized for), never raw vault access —
            // it cannot call secretVault.cjs itself to fetch anything
            // else. A ref that fails org authorization or doesn't exist
            // is simply absent from the map (fail closed, never throws).
            if (Array.isArray(inst.credentialRefs) && inst.credentialRefs.length > 0) {
                const vault = _vault();
                instanceCtx.resolvedCredentials = vault?.resolveCredentialRefs?.(inst.credentialRefs, { orgId: task.orgId }) || {};
            }
        }
    }

    // Skill/Tool/Connector/Approval resolution (Universal Composition
    // Engine Phase 11) — only meaningful for org-scoped tasks with a
    // registered skill for this capability; a task with no orgId or no
    // matching skill entry skips this entirely (identical to pre-Phase-11
    // dispatch). Never blocks execution on a lookup failure — these are
    // additive checks, not new hard gates, except the approval gate
    // itself, which is the one genuine block this phase introduces.
    const skill = _skillReg()?.getSkill?.(capability) || null;
    if (task.orgId && skill) {
        // Tool permission check: if the skill declares required tools,
        // confirm this org/instance is genuinely granted each one via the
        // Tool Fabric's scoped permission resolver (Phase 6) — denies
        // execution rather than silently proceeding when a tool is missing.
        const fabric = _toolFabric();
        if (fabric && Array.isArray(skill.requiredTools) && skill.requiredTools.length > 0) {
            for (const toolId of skill.requiredTools) {
                const allowed = fabric.resolvePermission?.(toolId, "run", { orgId: task.orgId, agentInstanceId: instanceCtx.agentInstanceId });
                if (allowed === false) {
                    const msg = `permission_denied: org ${task.orgId} is not granted tool "${toolId}" required by skill "${skill.id}"`;
                    logger.warn(`[ExecEngine] ${msg}`);
                    return { success: false, result: null, agentId: null, durationMs: 0, attempts: 1, error: msg };
                }
            }
        }

        // Connector health check: if the skill declares optional
        // connectors, surface their real composition status into ctx so
        // the handler can make an informed choice — never blocks
        // execution (these are optional by declaration), only informs.
        //
        // integrationConnectors.cjs's own probe/health state
        // (getCompositionStatus) is platform-wide by design (it answers
        // "is this connector's API reachable", not "does THIS org have
        // credentials for it") — redesigning it into a per-org probe
        // system is out of this mission's scope. What genuinely matters
        // for an org-scoped task is whether THIS org has its own vault
        // credential configured (Vault Security Hardening): overridden to
        // NEEDS_CREDENTIALS whenever the org has no org-scoped secret for
        // that connector, even if the platform-wide probe elsewhere shows
        // CONNECTED_VERIFIED for a DIFFERENT org's or the founder's own
        // credential — an org must never be told a connector is ready
        // because someone else's secret happens to exist.
        const connReg = _connReg();
        const vaultForConn = _vault();
        if (connReg && Array.isArray(skill.optionalConnectors) && skill.optionalConnectors.length > 0) {
            instanceCtx.connectorStatus = Object.fromEntries(
                skill.optionalConnectors.map(id => {
                    const platformStatus = connReg.getCompositionStatus?.(id)?.status || "NOT_CONFIGURED";
                    const orgHasCredential = vaultForConn?.listSecrets?.({ connectorId: id, orgId: task.orgId })?.length > 0;
                    return [id, orgHasCredential ? platformStatus : "NEEDS_CREDENTIALS"];
                })
            );
        }

        // Approval gate: a high-risk skill for an org-scoped task must be
        // approved before executing (Phase 10's Approval/Safety wiring,
        // reusing the same real approvalQueue as missionOrchestrator.cjs's
        // Approval node — single source of truth, no duplicate gate logic).
        // options.approved lets an already-approved re-dispatch (e.g. after
        // an operator approves via the real queue) skip re-requesting.
        if (skill.riskLevel === "high" && !options.approved) {
            const approvalQ = _approvalQ();
            if (approvalQ) {
                try {
                    const req = approvalQ.enqueue({
                        workflowId: `skill_${skill.id}`,
                        action: `Execute high-risk skill "${skill.id}" for org ${task.orgId}`,
                        reason: `Capability "${capability}" is classified riskLevel:high`,
                        risk: "high",
                        context: { orgId: task.orgId, taskId, capability },
                    });
                    if (!req.autoApproved) {
                        const msg = `approval_required: skill "${skill.id}" requires approval before execution (request ${req.reqId})`;
                        logger.warn(`[ExecEngine] ${msg}`);
                        return { success: false, result: null, agentId: null, durationMs: 0, attempts: 1, error: msg, approvalRequestId: req.reqId };
                    }
                } catch (err) {
                    logger.warn(`[ExecEngine] approval request failed for skill ${skill.id}: ${err.message}`);
                }
            }
        }
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (attempt > 0) {
            await _sleep(_backoffMs(attempt - 1));
            // Audit lineage: record retry with parent taskId
            try {
                const audit = require("../../backend/utils/auditLog.cjs");
                audit.recordRetry({ taskId: `${taskId}_r${attempt}`, originalTaskId: taskId,
                    reason: lastError?.message || "prior_attempt_failed", attempt });
            } catch {}
        }

        const agent = registry.findForCapability(capability);

        // If we have a registered agent, use it
        if (agent) {
            agent.acquireSlot();
            // Provide a way for the handler to signal liveness
            const extendedCtx = { ...instanceCtx, heartbeat: () => agent.heartbeat() };
            const t0 = Date.now();
            try {
                const result = await _withTimeout(
                    agent.handler(task, extendedCtx),
                    timeoutMs,
                    `${agent.id}/${task.type}`
                );
                const durationMs = Date.now() - t0;
                agent.recordSuccess(durationMs);
                history.record({
                    agentId: agent.id, taskType: task.type, taskId,
                    success: true, durationMs,
                    input:  task.input || task.label || "",
                    output: result?.message || result?.result || "",
                });
                _emitTelemetryAndMemory(task, { success: true, durationMs, agentInstanceId: instanceCtx.agentInstanceId });
                return { success: true, result, agentId: agent.id, durationMs, attempts: attempt + 1, error: null };
            } catch (err) {
                agent.recordFailure();
                lastError = err;
                history.record({
                    agentId: agent.id, taskType: task.type, taskId,
                    success: false, durationMs: Date.now() - t0,
                    input:  task.input || task.label || "",
                    error:  err.message,
                });
                logger.warn(`[ExecEngine] ${agent.id}/${task.type} attempt ${attempt + 1} failed: ${err.message}`);
            }
        } else {
            // No registered agent — try legacy executor (no circuit breaker)
            const legacy = _getLegacy();
            if (legacy?.execute) {
                const t0 = Date.now();
                try {
                    const result = await _withTimeout(
                        legacy.execute(task, instanceCtx),
                        timeoutMs,
                        `legacy/${task.type}`
                    );
                    const durationMs = Date.now() - t0;
                    // The legacy executor can return a soft failure
                    // (result.success === false) without throwing — e.g. an
                    // unrecognized capability falls through to a "no handler
                    // registered" response. Not throwing isn't the same as
                    // succeeding; trust the result's own success flag when present.
                    const softFailed = result && result.success === false;
                    history.record({
                        agentId: "legacy", taskType: task.type, taskId,
                        success: !softFailed, durationMs,
                        input:  task.input || task.label || "",
                        output: result?.message || result?.result || "",
                    });
                    if (softFailed) {
                        lastError = new Error(result?.error || result?.result || "legacy executor reported failure");
                        logger.warn(`[ExecEngine] legacy/${task.type} attempt ${attempt + 1} soft-failed: ${lastError.message}`);
                        // A guaranteed, deterministic failure (e.g. no handler
                        // registered for this capability) will not change
                        // between retries — bail immediately instead of
                        // burning backoff time on remaining attempts.
                        if (result.nonRetriable) {
                            return { success: false, result: null, agentId: "legacy", durationMs, attempts: attempt + 1, error: lastError.message };
                        }
                    } else {
                        return { success: true, result, agentId: "legacy", durationMs, attempts: attempt + 1, error: null };
                    }
                } catch (err) {
                    lastError = err;
                    history.record({
                        agentId: "legacy", taskType: task.type, taskId,
                        success: false, durationMs: Date.now() - t0,
                        input:  task.input || task.label || "",
                        error:  err.message,
                    });
                    logger.warn(`[ExecEngine] legacy/${task.type} attempt ${attempt + 1} failed: ${err.message}`);
                }
            } else {
                // Nothing can handle this — bail immediately, no retry
                const msg = `No handler for capability "${capability}" (type: ${task.type})`;
                const registeredIds = registry.listAll().map(a => a.id).join(", ") || "(none)";
                logger.warn(`[ExecEngine] ${msg} — registered agents: [${registeredIds}]`);
                return { success: false, result: null, agentId: null, durationMs: 0, attempts: 1, error: msg };
            }
        }
    }

    const finalError = lastError?.message || "unknown";
    logger.error(`[ExecEngine] ${task.type} FAILED after ${maxRetries} attempts: ${finalError}`);
    // Push to dead-letter queue so the failure is not silently lost
    try {
        dlq.push({ taskId, taskType: task.type, input: task.input || task.label || "", error: finalError, attempts: maxRetries, agentId: null });
    } catch { /* non-critical */ }
    _emitTelemetryAndMemory(task, { success: false, error: finalError, agentInstanceId: instanceCtx.agentInstanceId });
    return { success: false, result: null, agentId: null, durationMs: 0, attempts: maxRetries, error: finalError };
}

module.exports = { executeTask };
