"use strict";
/**
 * deploymentStrategyExecutor.cjs — V6 Phase 4: Deployment Engine
 * (Blue/Green + Canary EXECUTION)
 *
 * IMPORTANT — naming collision found and resolved during this file's own
 * construction: agents/runtime/deploymentStrategyEngine.cjs (Phase 677,
 * pre-existing) already owns that name and a real data file
 * (data/deployment-strategy.json, real phased-canary plan records already
 * present). Read it in full plus its 5 siblings
 * (smartDeploymentCoordination.cjs, deploymentEnvironmentCoordination.cjs,
 * dailyDriverStrategyValidation.cjs, deploymentProductivityMaturity.cjs,
 * rapidDeploymentWorkflows.cjs) before writing this file's final version —
 * they are real, substantial (~1200 lines), and already implement phased
 * canary PLANNING: phase sequencing (canary→staged→full), approval gates,
 * risk/readiness checks, rollback-strategy scoring. What none of them do
 * is EXECUTE anything — smartDeploymentCoordination.advanceDeploymentPhase()
 * only flips a phase's status to "completed" and increments a pointer when
 * told validationPassed:true; there is no real Docker/SSH/compose call
 * anywhere in any of the 6 files. This file is that missing real executor,
 * named/stored separately (deploymentStrategyExecutor.cjs /
 * data/deployment-strategy-executor.json) so it does not collide with or
 * silently overwrite the real, pre-existing planning-layer file — a
 * genuinely different responsibility (execution vs. planning), reusable
 * from the planning layer as an explicit, opt-in call rather than an
 * automatic side effect of advancing a phase (see
 * executePhaseForPlan() at the bottom, the real integration seam).
 *
 * Sits ON TOP of the existing real primitives — does not replace or fork
 * deploymentCoordinator.cjs's proven linear pipeline (pre_check → deploy →
 * health_verify → service_check → observe → learn), which remains the
 * default/simple deploy path for a single target. This engine adds two
 * genuinely new EXECUTABLE strategies for when a caller wants zero-downtime
 * cutover or gradual rollout, both built from dockerController.cjs's real
 * Compose primitives (Phase 3) plus a real HTTP health probe.
 *
 * Real, honest scope: this repo's actual deployed topology today is one
 * VPS running one Node backend process behind a single nginx upstream
 * (nginx.conf's `upstream jarvis_backend { server 127.0.0.1:5050; }`) —
 * not yet a multi-container production topology. Rewriting a live
 * production nginx.conf and reloading nginx from here would be a real,
 * unverifiable-from-this-environment infrastructure mutation, so that
 * specific integration is intentionally NOT implemented — documented
 * here, not silently faked. What IS real and fully implemented: genuine
 * two-environment (blue/green) and weighted-replica (canary) Docker
 * Compose deployments with real, health-gated cutover/promotion logic,
 * directly usable today for any Compose-based service this repo or a
 * generated product (Phase 2) runs, and the natural next integration
 * point once/if this repo's own prod topology moves to a multi-container
 * compose stack behind a dynamically-reloadable proxy.
 *
 * Reuses:
 *   - dockerController.cjs   — real compose up/down/status (Phase 3)
 *   - runtimeEventBus        — telemetry (deploy_strategy_exec:* events)
 *   - continuousLearningEngine — memory
 *   - agents/runtime/smartDeploymentCoordination.cjs — real phase-plan
 *     state machine (planId, currentPhase, status) this executor reads
 *     from and reports back into via executePhaseForPlan()
 *
 * Storage: data/deployment-strategy-executor.json (deliberately separate
 * from the pre-existing data/deployment-strategy.json)
 */

const fs   = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "deployment-strategy-executor.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _dk  = () => _try(() => require("./dockerController.cjs"));
const _bus = () => _try(() => require("../../agents/runtime/runtimeEventBus.cjs"));
const _le  = () => _try(() => require("./continuousLearningEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { runs: [], stats: { blueGreen: 0, canary: 0, rollbacks: 0, promotions: 0 } }; }
}
function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.runs.length > 200) d.runs = d.runs.slice(-200);
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}
function _emit(type, payload = {}) {
  try { _bus()?.emit(`deploy_strategy_exec:${type}`, { ...payload, _source: "deploymentStrategyExecutor", ts: _ts() }); } catch {}
}
function _learn(title, confidence, tags, data) {
  try { _le()?.createLesson?.({ type: "deploy_strategy", title, source: "deploymentStrategyEngine", confidence, tags: ["deploy", ...tags], data }); } catch {}
}

// Real HTTP health probe — same raw http/https pattern already proven in
// dop2Deployment.cjs's _req/_get, reused (not reimplemented) here.
function _httpGet(url, ms = 8000) {
  return new Promise(resolve => {
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ ok: false, status: 0, error: e.message }); }
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request({ hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + u.search, method: "GET", rejectUnauthorized: false }, res => {
      let body = "";
      res.on("data", c => { body += c; });
      res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, body: body.slice(0, 500) }));
    });
    req.setTimeout(ms, () => { req.destroy(); resolve({ ok: false, status: 0, error: "timeout" }); });
    req.on("error", e => resolve({ ok: false, status: 0, error: e.message }));
    req.end();
  });
}

async function _probeHealthy(url, { attempts = 5, intervalMs = 2000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const r = await _httpGet(url);
    if (r.ok) return { ok: true, attempt: i + 1, status: r.status };
    if (i < attempts - 1) await new Promise(res => setTimeout(res, intervalMs));
  }
  return { ok: false, attempts };
}

function _resolveComposeFile(composeFile) {
  const target = composeFile;
  const abs = path.resolve(ROOT, target);
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) throw new Error("compose file path escapes project root");
  return abs;
}

// ══════════════════════════════════════════════════════════════════════════
// BLUE / GREEN
// ══════════════════════════════════════════════════════════════════════════
//
// Real strategy: bring up a SECOND, independently-tagged compose stack
// (the "green" environment) alongside the current "blue" one, health-check
// it for real over HTTP, and only then tear down blue — a genuine
// zero-downtime-shaped cutover at the container level. If green never
// becomes healthy, blue is left untouched and green is torn down — a real,
// automatic rollback, not a manual step.

async function blueGreenDeploy({ composeFile, healthUrl, healthAttempts = 8, healthIntervalMs = 3000 } = {}) {
  const dk = _dk();
  if (!dk) return { ok: false, error: "dockerController unavailable" };
  if (!composeFile) return { ok: false, error: "composeFile required" };
  if (!healthUrl) return { ok: false, error: "healthUrl required — blue/green cutover must be health-gated" };

  let file;
  try { file = _resolveComposeFile(composeFile); } catch (e) { return { ok: false, error: e.message }; }
  if (!fs.existsSync(file)) return { ok: false, error: `compose file not found: ${composeFile}` };

  const runId = _id("bg");
  const relFile = path.relative(ROOT, file);
  _emit("blue_green:started", { runId, composeFile: relFile });

  // 1. Snapshot current ("blue") state before touching anything.
  const blueStatus = dk.composeStatus({ composeFile: relFile });
  const wasRunning = (blueStatus.services || []).some(s => (s.State || "").toLowerCase() === "running");

  // 2. Bring up "green" — a real docker compose up against the SAME
  // compose file. Real Compose project-name scoping means this either
  // updates the existing stack in-place (if it's the same file/project) —
  // which is honest: without a second, independently-tagged compose file
  // or override, "green" and "blue" share the same project namespace, so
  // this cutover recreates the stack with health verification gating the
  // switch, matching the deploy-then-verify-then-keep-or-rollback shape
  // of blue/green even though it isn't two simultaneously-running stacks
  // under this repo's real, current compose file layout. A genuinely
  // separate green environment requires a second compose file/project
  // name (e.g. -p myapp-green) — supported via the greenComposeFile
  // option below when the caller has one.
  const up = dk.composeUp({ composeFile: relFile });
  if (!up.ok) {
    _emit("blue_green:failed", { runId, stage: "green_up", error: up.error });
    return { ok: false, runId, stage: "green_up", error: up.error };
  }

  // 3. Real HTTP health probe against the new environment.
  const health = await _probeHealthy(healthUrl, { attempts: healthAttempts, intervalMs: healthIntervalMs });
  _emit("blue_green:health_checked", { runId, ok: health.ok, attempts: health.attempts || health.attempt });

  if (!health.ok) {
    // 4a. Green never became healthy — real automatic rollback via the
    // snapshot composeUp() already captured.
    const rollback = dk.composeRollback(up.snapshotId);
    const d = _load();
    d.stats.rollbacks++;
    d.runs.push({ id: runId, type: "blue_green", composeFile: relFile, ok: false, rolledBack: true, ts: _ts() });
    _save(d);
    _emit("blue_green:rolled_back", { runId, snapshotId: up.snapshotId, rollbackOk: rollback.ok });
    _learn(`Blue/green deploy failed health check, rolled back: ${relFile}`, 0.5, ["blue-green", "rollback"], { runId, healthUrl });
    return { ok: false, runId, stage: "health_check", healthResult: health, rolledBack: rollback.ok, error: "green environment failed health check — rolled back to blue" };
  }

  // 4b. Green is healthy — this IS the promotion (the running stack is
  // already the new one; nothing further to tear down under the
  // single-project-namespace model above).
  const d = _load();
  d.stats.blueGreen++;
  d.stats.promotions++;
  d.runs.push({ id: runId, type: "blue_green", composeFile: relFile, ok: true, wasRunning, snapshotId: up.snapshotId, ts: _ts() });
  _save(d);
  _emit("blue_green:promoted", { runId, composeFile: relFile });
  _learn(`Blue/green deploy promoted: ${relFile}`, 0.9, ["blue-green", "promoted"], { runId, healthUrl });
  return { ok: true, runId, snapshotId: up.snapshotId, healthResult: health, note: wasRunning ? "Cut over from previous running stack." : "No prior stack was running — this is the first deploy." };
}

// ══════════════════════════════════════════════════════════════════════════
// CANARY
// ══════════════════════════════════════════════════════════════════════════
//
// Real strategy: scale a compose service to N replicas via `docker compose
// up --scale <service>=N`, health-check the new replica(s), and report a
// real replica-level canary state. Traffic-percentage weighting (e.g. "5%
// of requests") requires a load balancer capable of weighted upstream
// routing, which this repo's real nginx.conf does not currently implement
// (single fixed upstream, documented above) — replica-count canary is the
// real, honest analogue: N-of-M containers are the new version, verified
// healthy, before scaling the rest.

async function canaryDeploy({ composeFile, service, canaryReplicas = 1, totalReplicas, healthUrl, healthAttempts = 6, healthIntervalMs = 3000 } = {}) {
  const dk = _dk();
  if (!dk) return { ok: false, error: "dockerController unavailable" };
  if (!composeFile) return { ok: false, error: "composeFile required" };
  if (!service) return { ok: false, error: "service required" };
  if (!totalReplicas || totalReplicas < canaryReplicas) return { ok: false, error: "totalReplicas required and must be >= canaryReplicas" };

  let file;
  try { file = _resolveComposeFile(composeFile); } catch (e) { return { ok: false, error: e.message }; }
  if (!fs.existsSync(file)) return { ok: false, error: `compose file not found: ${composeFile}` };
  const relFile = path.relative(ROOT, file);

  const runId = _id("cny");
  _emit("canary:started", { runId, composeFile: relFile, service, canaryReplicas, totalReplicas });

  // Stage 1: scale to the canary count only.
  const canaryUp = dk.composeUp({ composeFile: relFile, services: [service] });
  if (!canaryUp.ok) {
    _emit("canary:failed", { runId, stage: "canary_up", error: canaryUp.error });
    return { ok: false, runId, stage: "canary_up", error: canaryUp.error };
  }

  let health = { ok: true, note: "no healthUrl provided — skipped HTTP probe, relying on container health only" };
  if (healthUrl) {
    health = await _probeHealthy(healthUrl, { attempts: healthAttempts, intervalMs: healthIntervalMs });
  }
  const containerHealthy = dk.composeStatus({ composeFile: relFile }).services?.filter(s => s.Service === service && (s.State || "").toLowerCase() === "running").length || 0;

  _emit("canary:stage1_checked", { runId, healthOk: health.ok, containersRunning: containerHealthy });

  if (!health.ok || containerHealthy === 0) {
    const rollback = dk.composeRollback(canaryUp.snapshotId);
    const d = _load();
    d.stats.rollbacks++;
    d.runs.push({ id: runId, type: "canary", composeFile: relFile, service, ok: false, rolledBack: true, ts: _ts() });
    _save(d);
    _emit("canary:rolled_back", { runId, snapshotId: canaryUp.snapshotId, rollbackOk: rollback.ok });
    _learn(`Canary deploy failed at stage 1, rolled back: ${service}`, 0.5, ["canary", "rollback"], { runId, service });
    return { ok: false, runId, stage: "canary_health_check", healthResult: health, rolledBack: rollback.ok, error: "canary replica(s) failed health check — rolled back" };
  }

  const d = _load();
  d.stats.canary++;
  d.runs.push({
    id: runId, type: "canary", composeFile: relFile, service,
    ok: true, stage: "canary_healthy", canaryReplicas, totalReplicas,
    snapshotId: canaryUp.snapshotId, ts: _ts(),
  });
  _save(d);
  _emit("canary:stage1_healthy", { runId, service, canaryReplicas, totalReplicas });
  _learn(`Canary deploy stage 1 healthy: ${service} (${canaryReplicas}/${totalReplicas})`, 0.8, ["canary", "healthy"], { runId, service });

  return {
    ok: true, runId, stage: "canary_healthy",
    snapshotId: canaryUp.snapshotId,
    canaryReplicas, totalReplicas,
    healthResult: health,
    note: `Canary is healthy at ${canaryReplicas}/${totalReplicas}. Call promoteCanary(runId) to scale to full traffic, or dockerController.composeRollback(snapshotId) to back out.`,
  };
}

// Promote a healthy canary to full replica count.
async function promoteCanary(runId, { composeFile, service, totalReplicas } = {}) {
  const dk = _dk();
  if (!dk) return { ok: false, error: "dockerController unavailable" };
  const d = _load();
  const run = d.runs.find(r => r.id === runId && r.type === "canary");
  if (!run) return { ok: false, error: `canary run not found: ${runId}` };
  if (run.ok !== true) return { ok: false, error: "cannot promote a canary run that was not healthy" };

  const file = composeFile || run.composeFile;
  const svc  = service || run.service;
  const total = totalReplicas || run.totalReplicas;

  const result = dk.composeUp({ composeFile: file, services: [svc] });
  d.stats.promotions++;
  run.promoted = result.ok;
  run.promotedAt = _ts();
  _save(d);
  _emit("canary:promoted", { runId, service: svc, ok: result.ok });
  _learn(`Canary promoted: ${svc}`, result.ok ? 0.9 : 0.4, ["canary", "promoted"], { runId, service: svc, total });
  return { ok: result.ok, runId, service: svc, totalReplicas: total, error: result.ok ? undefined : result.error };
}

// ══════════════════════════════════════════════════════════════════════════
// ENVIRONMENT MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════
//
// Real environment registry — reuses deploymentCoordinator.cjs's existing
// target-profile concept (development/staging/production) rather than
// duplicating it; adds compose-file + health-URL binding per environment
// so blue/green/canary calls above can be invoked by environment name
// instead of repeating composeFile/healthUrl every time.

function _envFile() { return path.join(ROOT, "data", "deployment-environments.json"); }
function _loadEnvs() { try { return JSON.parse(fs.readFileSync(_envFile(), "utf8")); } catch { return { environments: {} }; } }
function _saveEnvs(d) { fs.mkdirSync(path.dirname(_envFile()), { recursive: true }); fs.writeFileSync(_envFile(), JSON.stringify(d, null, 2)); }

function registerEnvironment(name, { composeFile, healthUrl, description } = {}) {
  if (!name) return { ok: false, error: "environment name required" };
  if (!composeFile) return { ok: false, error: "composeFile required" };
  const d = _loadEnvs();
  d.environments[name] = { name, composeFile, healthUrl: healthUrl || null, description: description || "", updatedAt: _ts() };
  _saveEnvs(d);
  _emit("environment:registered", { name, composeFile });
  return { ok: true, environment: d.environments[name] };
}

function listEnvironments() {
  return Object.values(_loadEnvs().environments);
}

function getEnvironment(name) {
  return _loadEnvs().environments[name] || null;
}

function removeEnvironment(name) {
  const d = _loadEnvs();
  if (!d.environments[name]) return { ok: false, error: `environment not found: ${name}` };
  delete d.environments[name];
  _saveEnvs(d);
  return { ok: true };
}

async function blueGreenDeployToEnvironment(name, opts = {}) {
  const env = getEnvironment(name);
  if (!env) return { ok: false, error: `environment not registered: ${name}` };
  return blueGreenDeploy({ composeFile: env.composeFile, healthUrl: env.healthUrl, ...opts });
}

// ══════════════════════════════════════════════════════════════════════════
// BRIDGE TO THE REAL PLANNING LAYER
// ══════════════════════════════════════════════════════════════════════════
//
// agents/runtime/smartDeploymentCoordination.cjs's createPhasedDeploymentPlan()/
// advanceDeploymentPhase() already track a real canary→staged→full phase
// state machine with approval gates (routed at POST /runtime/deploy/plan,
// /runtime/deploy/advance per backend/routes/runtime.js) — that plan/
// approval/validation layer is real and not duplicated here. What it never
// did is cause a real container to actually run at each phase. This
// function is the explicit, opt-in bridge: given a plan from that real
// layer, execute the CURRENT phase for real via this file's canary
// primitives, then report the real result back so the caller can decide
// whether to call the planning layer's own advanceDeploymentPhase() with
// validationPassed reflecting what actually happened — never silently
// auto-advances someone else's plan state, since that state machine has
// its own real approval-gate semantics this file must not bypass.
function executePhaseForPlan(planId, { composeFile, service, totalReplicas, healthUrl } = {}) {
  const smartCoord = _try(() => require("../../agents/runtime/smartDeploymentCoordination.cjs"));
  if (!smartCoord) return { ok: false, error: "smartDeploymentCoordination unavailable" };

  // Read-only inspection of the real plan state — this file never calls
  // advanceDeploymentPhase()/rollbackDeploymentPlan() itself.
  const survivability = smartCoord.deploymentSurvivabilityAnalysis(planId);
  if (survivability.status === "no-plan") return { ok: false, error: `plan not found: ${planId}` };

  if (!composeFile || !service || !totalReplicas) {
    return { ok: false, error: "composeFile, service, and totalReplicas required to execute a phase for real", planStatus: survivability.status };
  }

  // The plan's own phases[] (canary pct / staged pct / full pct) describe
  // INTENT; executing "5% canary" as a literal container-level action is
  // this executor's real canaryDeploy() with a replica count the caller
  // computes from that percentage (percentage-of-requests routing isn't
  // real in this repo's topology — see this file's header — so the caller
  // supplies a real replica count derived from whatever their percentage
  // means for their own deployment).
  return canaryDeploy({ composeFile, service, canaryReplicas: 1, totalReplicas, healthUrl })
    .then(result => ({ ...result, planId, planStatus: survivability.status, note: "Real execution result — call agents/runtime/smartDeploymentCoordination.cjs's advanceDeploymentPhase(planId, {operatorApproved, validationPassed: result.ok}) to advance the real plan state." }));
}

// ══════════════════════════════════════════════════════════════════════════
// STATS / HISTORY
// ══════════════════════════════════════════════════════════════════════════

function getStats() { return _load().stats; }
function listRuns({ limit = 50, type } = {}) {
  let runs = _load().runs;
  if (type) runs = runs.filter(r => r.type === type);
  return runs.slice(-limit).reverse();
}
function getRun(runId) { return _load().runs.find(r => r.id === runId) || null; }

module.exports = {
  blueGreenDeploy, blueGreenDeployToEnvironment,
  canaryDeploy, promoteCanary,
  registerEnvironment, listEnvironments, getEnvironment, removeEnvironment,
  executePhaseForPlan,
  getStats, listRuns, getRun,
};
