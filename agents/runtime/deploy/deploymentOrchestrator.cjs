"use strict";
/**
 * deploymentOrchestrator — full deployment lifecycle with health-check and rollback.
 *
 * deploy(config)             → DeploymentResult
 * rollback(deploymentId)     → RollbackResult
 * getStatus(deploymentId)    → deployment record or null
 * listDeployments()          → all deployment records
 * reset()
 *
 * config: {
 *   id?,            — auto-generated if omitted
 *   name,
 *   validate?,      — async fn → boolean (pre-deploy validation)
 *   deploy,         — async fn(ctx) → any  (the actual deployment)
 *   healthCheck?,   — async fn(ctx) → { healthy: bool }
 *   rollback?,      — async fn(ctx) → any  (rollback procedure)
 *   timeout?,       — ms before health-check considered failed
 * }
 */

const { nanoid }     = { nanoid: () => Math.random().toString(36).slice(2, 10) };
const pdv            = require("./preDeployValidator.cjs");

const _deployments = new Map();

const STATUS = {
    PENDING:    "pending",
    VALIDATING: "validating",
    DEPLOYING:  "deploying",
    VERIFYING:  "verifying",
    HEALTHY:    "healthy",
    FAILED:     "failed",
    ROLLEDBACK: "rolled_back",
};

function _record(id) { return _deployments.get(id) || null; }

function _ts() { return new Date().toISOString(); }

async function deploy(config) {
    const id  = config.id || `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const rec = {
        id,
        name:      config.name || id,
        status:    STATUS.PENDING,
        startedAt: _ts(),
        events:    [],
        ctx:       {},
        error:     null,
    };
    _deployments.set(id, rec);

    function emit(event, data = {}) {
        rec.events.push({ ts: _ts(), event, data });
    }

    try {
        // 1. Pre-deploy validation
        rec.status = STATUS.VALIDATING;
        emit("validation_start");
        if (typeof config.validate === "function") {
            const ok = await Promise.resolve(config.validate(rec.ctx));
            if (!ok) throw new Error("pre_deploy_validation_failed");
        }
        emit("validation_passed");

        // 2. Deploy
        rec.status = STATUS.DEPLOYING;
        emit("deploy_start");
        rec.ctx.deployResult = await Promise.resolve(config.deploy(rec.ctx));
        emit("deploy_complete", { result: rec.ctx.deployResult });

        // 3. Health check
        rec.status = STATUS.VERIFYING;
        emit("health_check_start");
        if (typeof config.healthCheck === "function") {
            const timeoutMs = config.timeout ?? 10_000;
            const hcResult  = await Promise.race([
                Promise.resolve(config.healthCheck(rec.ctx)),
                new Promise((_, rej) => {
                    const t = setTimeout(() => rej(new Error("health_check_timeout")), timeoutMs);
                    if (t.unref) t.unref();
                }),
            ]);
            if (!hcResult?.healthy) throw new Error("health_check_failed");
            rec.ctx.healthResult = hcResult;
        }
        emit("health_check_passed");

        rec.status    = STATUS.HEALTHY;
        rec.completedAt = _ts();
        emit("deployment_succeeded");

        return { id, success: true, status: rec.status, events: rec.events };

    } catch (e) {
        rec.status = STATUS.FAILED;
        rec.error  = e.message;
        emit("deployment_failed", { error: e.message });

        // Auto-rollback if rollback fn provided
        if (typeof config.rollback === "function") {
            emit("rollback_start");
            try {
                await Promise.resolve(config.rollback(rec.ctx));
                rec.status = STATUS.ROLLEDBACK;
                emit("rollback_complete");
            } catch (re) {
                emit("rollback_failed", { error: re.message });
            }
        }

        return { id, success: false, status: rec.status, error: e.message, events: rec.events };
    }
}

async function rollback(deploymentId) {
    const rec = _record(deploymentId);
    if (!rec) return { ok: false, reason: "deployment_not_found" };

    // Can rollback HEALTHY or FAILED deployments
    if (![STATUS.HEALTHY, STATUS.FAILED].includes(rec.status)) {
        return { ok: false, reason: `cannot rollback from status: ${rec.status}` };
    }

    rec.events.push({ ts: _ts(), event: "manual_rollback_triggered" });
    rec.status = STATUS.ROLLEDBACK;
    rec.events.push({ ts: _ts(), event: "rollback_complete" });

    return { ok: true, id: deploymentId, status: rec.status };
}

function getStatus(deploymentId) { return _record(deploymentId); }
function listDeployments()       { return [..._deployments.values()]; }
function reset()                 { _deployments.clear(); }

module.exports = { deploy, rollback, getStatus, listDeployments, reset, STATUS };
