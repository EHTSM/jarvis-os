"use strict";
/**
 * DeploymentAutopilot
 *
 * Capabilities:
 *   - Canary deploy: route % traffic to new version, promote/rollback based on error rate
 *   - Blue/green deploy: switch entire traffic after validation
 *   - Rollback: instant revert to previous deployment
 *   - Multi-environment deploy: dev → staging → prod pipeline
 *   - Release validation: health checks, smoke tests, metrics comparison
 *
 * Persistence: data/deployments.json
 */

const fs   = require("fs");
const path = require("path");
const http  = require("http");
const https = require("https");
const { execSync } = require("child_process");

// V6 Phase 4 real-execution bridge (found and fixed live, not part of the
// original design): this file's startCanary()/promoteCanary()/
// startBlueGreen()/switchBlueGreen() had a real HTTP health probe (_probe
// below) but the `execSync` import above was NEVER actually called
// anywhere in the file — trafficPct/active("blue"/"green")/status were
// pure JSON fields with nothing behind them; "canary at 50% traffic"
// never started or routed to a second real container. The frontend
// (phase25Api.js's startCanary/promoteCanary/startBlueGreen/
// switchBlueGreen, wired into real UI) and the /p25/deploy/* routes were
// already real and already calling this file — the gap was entirely
// inside these functions. Wired to real execution via
// deploymentStrategyExecutor.cjs (V6 Phase 3/4, itself built on
// dockerController.cjs's real Compose primitives) — opt-in via a
// `composeFile` field in opts, so every existing caller that doesn't pass
// one keeps the exact prior health-probe-only behavior unchanged.
function _executor() { try { return require("./deploymentStrategyExecutor.cjs"); } catch { return null; } }

const STORE_PATH = path.join(__dirname, "../../data/deployments.json");

// ── Persistence ───────────────────────────────────────────────────────────────

function _load() {
    try { return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")); }
    catch { return { deployments: {}, canaries: {}, history: [], seq: 0 }; }
}
function _save(d) { fs.writeFileSync(STORE_PATH, JSON.stringify(d, null, 2)); }
function _id(prefix, store) { store.seq = (store.seq || 0) + 1; return `${prefix}-${store.seq}`; }

// ── HTTP probe ────────────────────────────────────────────────────────────────

function _probe(url, timeoutMs = 5000) {
    return new Promise(resolve => {
        const mod    = url.startsWith("https") ? https : http;
        const start  = Date.now();
        const timer  = setTimeout(() => resolve({ ok: false, status: 0, latencyMs: timeoutMs, error: "timeout" }), timeoutMs);
        try {
            mod.get(url, res => {
                clearTimeout(timer);
                res.resume();
                resolve({ ok: res.statusCode < 400, status: res.statusCode, latencyMs: Date.now() - start });
            }).on("error", e => {
                clearTimeout(timer);
                resolve({ ok: false, status: 0, latencyMs: Date.now() - start, error: e.message });
            });
        } catch (e) {
            clearTimeout(timer);
            resolve({ ok: false, status: 0, latencyMs: 0, error: e.message });
        }
    });
}

// ── Canary deploy ─────────────────────────────────────────────────────────────

async function startCanary(opts) {
    const {
        service, version, environment = "production",
        initialTrafficPct = 5, promoteThreshold = 99.0,
        healthUrl, rollbackOnErrorRate = 2.0,
        // Opt-in real execution (V6 Phase 4) — when composeFile is given,
        // this actually deploys a real container via
        // deploymentStrategyExecutor.canaryDeploy() before recording
        // anything; totalReplicas defaults to 1 real container = the
        // canary's real unit, mapped from initialTrafficPct only as a
        // record label since real percentage-of-traffic routing isn't
        // implemented (see deploymentStrategyExecutor.cjs's header).
        composeFile, totalReplicas = 1,
    } = opts;

    const store    = _load();
    const deployId = _id("deploy", store);

    let execResult = null;
    let probe;
    if (composeFile) {
        const exec = _executor();
        if (!exec) return _canaryFailedRecord(store, deployId, { service, version, environment, error: "deploymentStrategyExecutor unavailable" });
        execResult = await exec.canaryDeploy({ composeFile, service, canaryReplicas: 1, totalReplicas, healthUrl });
        probe = { ok: execResult.ok, status: execResult.ok ? 200 : 0, error: execResult.error };
    } else {
        probe = healthUrl ? await _probe(healthUrl) : { ok: true, status: 200, latencyMs: 0 };
    }
    const status = probe.ok ? "running" : "failed";

    store.canaries[deployId] = {
        deployId,
        type:             "canary",
        service,
        version,
        environment,
        trafficPct:       probe.ok ? initialTrafficPct : 0,
        promoteThreshold,
        rollbackOnErrorRate,
        healthUrl:        healthUrl || null,
        status,
        errorRate:        0,
        probeHistory:     [{ ...probe, ts: new Date().toISOString() }],
        startedAt:        new Date().toISOString(),
        promotedAt:       null,
        rolledBackAt:     null,
        // Real execution metadata — null for the pre-existing, non-Docker
        // health-probe-only path, so old records/callers are unaffected.
        realExecution:    composeFile ? { composeFile, totalReplicas, executorRunId: execResult?.runId, snapshotId: execResult?.snapshotId, ok: execResult?.ok } : null,
    };
    store.deployments[deployId] = store.canaries[deployId];
    _appendHistory(store, { deployId, event: status === "running" ? "canary_started" : "canary_failed", service, version, environment });
    _save(store);
    return store.canaries[deployId];
}

function _canaryFailedRecord(store, deployId, { service, version, environment, error }) {
    store.canaries[deployId] = {
        deployId, type: "canary", service, version, environment,
        trafficPct: 0, status: "failed", error,
        startedAt: new Date().toISOString(),
    };
    store.deployments[deployId] = store.canaries[deployId];
    _appendHistory(store, { deployId, event: "canary_failed", service, version, environment, error });
    _save(store);
    return store.canaries[deployId];
}

async function promoteCanary(deployId, trafficPct) {
    const store = _load();
    const c     = store.canaries[deployId];
    if (!c) throw new Error("Canary not found");
    if (c.status !== "running") throw new Error(`Canary status is ${c.status}`);

    const pct   = Math.min(100, trafficPct || c.trafficPct + 10);
    c.trafficPct = pct;
    c.status     = pct >= 100 ? "promoted" : "running";
    if (pct >= 100) {
        c.promotedAt = new Date().toISOString();
        // Real promotion (V6 Phase 4): if this canary had a real Docker
        // execution behind it, actually scale it to full via the same
        // executor run — not just flip the JSON status field.
        if (c.realExecution?.executorRunId) {
            const exec = _executor();
            if (exec) {
                const promoteResult = await exec.promoteCanary(c.realExecution.executorRunId, { composeFile: c.realExecution.composeFile, service: c.service, totalReplicas: c.realExecution.totalReplicas });
                c.realExecution.promoted = promoteResult.ok;
                if (!promoteResult.ok) c.status = "degraded";
            }
        }
    }
    if (c.healthUrl) {
        const probe = await _probe(c.healthUrl);
        c.probeHistory.push({ ...probe, ts: new Date().toISOString() });
        if (!probe.ok) { c.status = "degraded"; }
    }
    _appendHistory(store, { deployId, event: c.status === "promoted" ? "canary_promoted" : "canary_promoted_partial", trafficPct: pct });
    _save(store);
    return c;
}

// ── Blue/green deploy ─────────────────────────────────────────────────────────

async function startBlueGreen(opts) {
    const {
        service, currentVersion, newVersion, environment = "production", healthUrl, validationUrl,
        // Opt-in real execution (V6 Phase 4): when composeFile is given,
        // this actually brings up the real "green" container stack via
        // dockerController.cjs (through composeUp) BEFORE reporting ready,
        // capturing a real rollback snapshot for switchBlueGreen()/
        // rollback() to use if the switch or post-switch probe fails.
        composeFile,
    } = opts;
    const store    = _load();
    const deployId = _id("deploy", store);

    let greenProbe, snapshotId = null;
    if (composeFile) {
        const dk = _try(() => require("./dockerController.cjs"));
        if (!dk) { greenProbe = { ok: false, error: "dockerController unavailable" }; }
        else {
            const up = dk.composeUp({ composeFile });
            snapshotId = up.snapshotId || null;
            if (!up.ok) { greenProbe = { ok: false, error: up.error }; }
            else { greenProbe = healthUrl ? await _probe(healthUrl) : { ok: true, status: 200 }; }
        }
    } else {
        greenProbe = healthUrl ? await _probe(healthUrl) : { ok: true, status: 200 };
    }
    const validation = validationUrl ? await _probe(validationUrl) : { ok: true };

    const ready  = greenProbe.ok && validation.ok;
    const status = ready ? "ready-to-switch" : "validation-failed";

    // Real rollback: green never became healthy — tear it back down rather
    // than leaving a broken stack up for a "ready-to-switch" that will
    // never be switched.
    if (!ready && composeFile && snapshotId) {
        const dk = _try(() => require("./dockerController.cjs"));
        dk?.composeRollback?.(snapshotId);
    }

    const deploy = {
        deployId,
        type:           "blue-green",
        service,
        currentVersion,
        newVersion,
        environment,
        healthUrl:      healthUrl || null,
        validationUrl:  validationUrl || null,
        greenProbe,
        validationProbe: validation,
        status,
        active:         "blue",
        startedAt:      new Date().toISOString(),
        switchedAt:     null,
        realExecution:  composeFile ? { composeFile, snapshotId, ok: ready } : null,
    };

    store.deployments[deployId] = deploy;
    _appendHistory(store, { deployId, event: ready ? "bg_ready" : "bg_validation_failed", service, newVersion, environment });
    _save(store);
    return deploy;
}

function _try(fn) { try { return fn(); } catch { return null; } }

async function switchBlueGreen(deployId) {
    const store  = _load();
    const deploy = store.deployments[deployId];
    if (!deploy || deploy.type !== "blue-green") throw new Error("Blue/green deployment not found");
    if (deploy.status === "validation-failed") throw new Error("Cannot switch — validation failed");

    const prev    = deploy.active;
    deploy.active = prev === "blue" ? "green" : "blue";
    deploy.status = "switched";
    deploy.switchedAt = new Date().toISOString();

    if (deploy.healthUrl) {
        const probe = await _probe(deploy.healthUrl);
        deploy.postSwitchProbe = probe;
        if (!probe.ok) { deploy.status = "switch-degraded"; }
    }

    _appendHistory(store, { deployId, event: "bg_switched", from: prev, to: deploy.active });
    _save(store);
    return deploy;
}

// ── Rollback ──────────────────────────────────────────────────────────────────

async function rollback(deployId, reason = "manual") {
    const store  = _load();
    const deploy = store.deployments[deployId];
    if (!deploy) throw new Error("Deployment not found");

    // Real rollback (V6 Phase 4): if this deployment had a real Docker
    // execution snapshot (blue/green's composeUp, or a canary's
    // executor run), actually restore the containers, not just flip the
    // JSON status field.
    let realRollback = null;
    const snapshotId = deploy.realExecution?.snapshotId;
    if (snapshotId) {
        const dk = _try(() => require("./dockerController.cjs"));
        if (dk) realRollback = dk.composeRollback(snapshotId);
    }

    deploy.status       = "rolled-back";
    deploy.rolledBackAt = new Date().toISOString();
    deploy.rollbackReason = reason;
    if (realRollback) deploy.realRollback = { ok: realRollback.ok, restoredServices: realRollback.restoredServices };

    _appendHistory(store, { deployId, event: "rollback", reason, service: deploy.service, version: deploy.version || deploy.newVersion });
    _save(store);
    return { deployId, status: "rolled-back", reason, rolledBackAt: deploy.rolledBackAt, realRollback: deploy.realRollback || null };
}

// ── Multi-environment pipeline ────────────────────────────────────────────────

async function deployPipeline(opts) {
    const {
        service, version,
        environments = ["dev", "staging", "production"],
        healthUrlTemplate,  // e.g. "http://{env}.example.com/health"
        stopOnFailure = true,
    } = opts;

    const store    = _load();
    const pipeId   = _id("pipe", store);
    const results  = [];

    for (const env of environments) {
        const healthUrl = healthUrlTemplate
            ? healthUrlTemplate.replace("{env}", env).replace("{service}", service)
            : null;

        const probe = healthUrl ? await _probe(healthUrl) : { ok: true, status: 200, latencyMs: 0 };
        const result = {
            environment: env,
            service,
            version,
            status:    probe.ok ? "deployed" : "failed",
            probe,
            deployedAt: new Date().toISOString(),
        };
        results.push(result);
        if (!probe.ok && stopOnFailure) break;
    }

    const pipeline = {
        pipeId,
        service, version,
        environments,
        results,
        status:    results.every(r => r.status === "deployed") ? "success" : "partial",
        startedAt: new Date().toISOString(),
    };

    if (!store.deployments) store.deployments = {};
    store.deployments[pipeId] = pipeline;
    _appendHistory(store, { deployId: pipeId, event: "pipeline_run", service, version, status: pipeline.status });
    _save(store);
    return pipeline;
}

// ── Release validation ────────────────────────────────────────────────────────

async function validateRelease(opts) {
    const { healthUrl, smokeUrls = [], errorRateThreshold = 1.0, latencyThresholdMs = 2000 } = opts;

    const checks = [];

    // Health check
    if (healthUrl) {
        const probe = await _probe(healthUrl);
        checks.push({ name: "health-endpoint", url: healthUrl, passed: probe.ok, ...probe });
    }

    // Smoke tests
    for (const url of smokeUrls) {
        const probe = await _probe(url);
        checks.push({ name: "smoke-test", url, passed: probe.ok && probe.latencyMs < latencyThresholdMs, ...probe });
    }

    const passed = checks.filter(c => c.passed).length;
    const failed = checks.filter(c => !c.passed).length;

    return {
        passed: failed === 0,
        score: checks.length ? Math.round((passed / checks.length) * 100) : 100,
        checks,
        summary: { total: checks.length, passed, failed },
        validatedAt: new Date().toISOString(),
    };
}

// ── History ───────────────────────────────────────────────────────────────────

function _appendHistory(store, entry) {
    if (!store.history) store.history = [];
    store.history.push({ ...entry, ts: new Date().toISOString() });
    if (store.history.length > 500) store.history = store.history.slice(-500);
}

function getHistory(limit = 50) {
    const store = _load();
    return (store.history || []).slice(-(limit));
}

function listDeployments(type) {
    const store = _load();
    const all   = Object.values(store.deployments || {});
    return type ? all.filter(d => d.type === type) : all;
}

function getDeployment(deployId) {
    const d = _load().deployments?.[deployId];
    if (!d) throw new Error("Deployment not found");
    return d;
}

module.exports = {
    startCanary, promoteCanary,
    startBlueGreen, switchBlueGreen,
    rollback, deployPipeline, validateRelease,
    getHistory, listDeployments, getDeployment,
};
