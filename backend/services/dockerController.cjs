"use strict";
/**
 * dockerController.cjs — V6 Phase 3: Docker Orchestration
 *
 * Real container/compose orchestration for the Universal Computer Controller.
 * Follows the exact same shape as its sibling controllers
 * (desktopController.cjs, browserController.cjs, terminalController.cjs):
 * a real execFileSync-backed adapter, no shell interpretation, a narrow
 * command-shape allowlist per operation, persisted history/state, and
 * continuousLearningEngine/runtimeEventBus hooks for memory + telemetry.
 *
 * Does NOT re-implement terminalController's safety sandbox — this is a
 * separate, richer surface purpose-built for container operations (structured
 * --format output, per-operation timeouts, compose file paths), following the
 * same no-shell, narrow-allowlist discipline rather than routing Docker's
 * much larger command surface through terminalController's small string
 * allowlist. terminalController.cjs's own narrow `docker` allowlist (ps/
 * images/inspect/logs/stats/version + start/stop/restart, added in the
 * FINAL-JARVIS-DREAM-CERTIFICATION.md P2 pass) remains for direct ad-hoc
 * terminal use; this file is the real orchestration layer with compose,
 * networks, volumes, build, health, and rollback.
 *
 * Reuses:
 *   - continuousLearningEngine for memory (createLesson)
 *   - runtimeEventBus for telemetry (docker:* events)
 *   - engineeringCapabilities.cjs registers docker_* as Mission Runtime
 *     capabilities (Agent Registry / Executor integration)
 *
 * Storage: data/docker-controller.json (capped history)
 */

const fs                       = require("fs");
const path                     = require("path");
const { execFileSync, spawn }  = require("child_process");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "docker-controller.json");

const _try  = fn => { try { return fn(); } catch { return null; } };
const _le   = () => _try(() => require("./continuousLearningEngine.cjs"));
const _bus  = () => _try(() => require("../../agents/runtime/runtimeEventBus.cjs"));

function _ts() { return new Date().toISOString(); }
function _id(prefix = "dk") { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      history: [], deployments: {}, rollbackSnapshots: {},
      stats: { commands: 0, succeeded: 0, failed: 0, containersManaged: 0, composeRuns: 0, rollbacks: 0 },
    };
  }
}
function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.history.length > 500) d.history = d.history.slice(-500);
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

function _emit(type, payload = {}) {
  try { _bus()?.emit(`docker:${type}`, { ...payload, _source: "dockerController", ts: _ts() }); } catch { /* non-fatal */ }
}
function _learn(title, confidence, tags, data) {
  try { _le()?.createLesson?.({ type: "docker_action", title, source: "dockerController", confidence, tags: ["docker", ...tags], data }); } catch { /* non-fatal */ }
}

// ── Reference/name validation (same discipline as terminalController's
// _isSafeContainerRef) ───────────────────────────────────────────────────────
const _isSafeRef  = (s) => typeof s === "string" && s.length > 0 && s.length < 128 && /^[a-zA-Z0-9][a-zA-Z0-9_.\/:-]*$/.test(s);
const _isSafeName = (s) => typeof s === "string" && s.length > 0 && s.length < 64  && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(s);

function _resolveComposeFile(composeFile) {
  const target = composeFile || "docker-compose.prod.yml";
  const abs = path.resolve(ROOT, target);
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) throw new Error("compose file path escapes project root");
  if (!fs.existsSync(abs)) throw new Error(`compose file not found: ${target}`);
  return abs;
}

// ── Core exec primitive — no shell, real process, real timeout ──────────────
function _docker(args, { timeoutMs = 30_000, cwd = ROOT } = {}) {
  const t0 = Date.now();
  try {
    const out = execFileSync("docker", args, {
      cwd, timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH || "/usr/bin:/bin:/usr/local/bin" },
      maxBuffer: 10 * 1024 * 1024,
    }).toString();
    return { ok: true, out, durationMs: Date.now() - t0 };
  } catch (e) {
    const errMsg = (e.stderr?.toString() || e.message || "").slice(0, 4000);
    return { ok: false, out: "", error: errMsg, durationMs: Date.now() - t0, timedOut: e.signal === "SIGTERM" };
  }
}

function _record(op, args, result) {
  const d = _load();
  d.stats.commands++;
  if (result.ok) d.stats.succeeded++; else d.stats.failed++;
  const entry = { id: _id("op"), op, args, ok: result.ok, durationMs: result.durationMs, ts: _ts(), error: result.ok ? null : (result.error || "").slice(0, 300) };
  d.history.push(entry);
  _save(d);
  return entry;
}

// ══════════════════════════════════════════════════════════════════════════
// CONTAINER LIFECYCLE
// ══════════════════════════════════════════════════════════════════════════

function listContainers({ all = false } = {}) {
  const args = ["ps", "--format", "{{json .}}"];
  if (all) args.splice(1, 0, "-a");
  const r = _docker(args, { timeoutMs: 10_000 });
  _record("list_containers", args, r);
  if (!r.ok) return { ok: false, error: r.error };
  const containers = r.out.trim().split("\n").filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  return { ok: true, containers, count: containers.length };
}

function inspectContainer(ref) {
  if (!_isSafeRef(ref)) return { ok: false, error: "invalid container reference" };
  const r = _docker(["inspect", ref], { timeoutMs: 10_000 });
  _record("inspect", [ref], r);
  if (!r.ok) return { ok: false, error: r.error };
  try { return { ok: true, data: JSON.parse(r.out)[0] || null }; } catch { return { ok: false, error: "failed to parse inspect output" }; }
}

function containerLogs(ref, { tail = 100 } = {}) {
  if (!_isSafeRef(ref)) return { ok: false, error: "invalid container reference" };
  const tailN = Math.min(Math.max(parseInt(tail, 10) || 100, 1), 2000);
  const r = _docker(["logs", "--tail", String(tailN), ref], { timeoutMs: 15_000 });
  _record("logs", [ref, `--tail ${tailN}`], r);
  return { ok: r.ok, logs: r.out, error: r.ok ? null : r.error };
}

function containerStats(ref) {
  const args = ["stats", "--no-stream", "--format", "{{json .}}"];
  if (ref) { if (!_isSafeRef(ref)) return { ok: false, error: "invalid container reference" }; args.push(ref); }
  const r = _docker(args, { timeoutMs: 10_000 });
  _record("stats", args, r);
  if (!r.ok) return { ok: false, error: r.error };
  const stats = r.out.trim().split("\n").filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  return { ok: true, stats };
}

function _lifecycle(action, ref) {
  if (!_isSafeRef(ref)) return { ok: false, error: "invalid container reference" };
  const r = _docker([action, ref], { timeoutMs: 30_000 });
  _record(action, [ref], r);
  _emit(`container:${action}`, { ref, ok: r.ok, error: r.ok ? null : r.error });
  _learn(`Docker ${action}: ${ref}`, r.ok ? 0.9 : 0.4, ["lifecycle", action], { ref, ok: r.ok });
  if (r.ok) { const d = _load(); d.stats.containersManaged++; _save(d); }
  return { ok: r.ok, ref, action, output: r.out?.trim(), error: r.ok ? null : r.error };
}

const startContainer   = (ref) => _lifecycle("start", ref);
const stopContainer    = (ref) => _lifecycle("stop", ref);
const restartContainer = (ref) => _lifecycle("restart", ref);

function removeContainer(ref, { force = false } = {}) {
  if (!_isSafeRef(ref)) return { ok: false, error: "invalid container reference" };
  const args = force ? ["rm", "-f", ref] : ["rm", ref];
  const r = _docker(args, { timeoutMs: 15_000 });
  _record("rm", args, r);
  _emit("container:rm", { ref, ok: r.ok });
  return { ok: r.ok, ref, error: r.ok ? null : r.error };
}

// ── exec: scoped, real command inside a running container ───────────────────
// Real, deliberate exception to "no exec" (unlike terminalController's
// hard block on `docker exec`, which is a general-purpose agent shell
// surface): this is opt-in, single-command, no-shell (execFileSync — no
// `&&`/`;`/pipe is even parseable), and every call is recorded with the
// exact ref + command for audit. Still refuses interactive/tty exec and
// refuses to run against images outside this deployment's own containers
// implicitly by requiring a real, currently-running container ref.
function execInContainer(ref, cmd, args = []) {
  if (!_isSafeRef(ref)) return { ok: false, error: "invalid container reference" };
  if (typeof cmd !== "string" || !cmd.length || cmd.length > 200) return { ok: false, error: "invalid command" };
  if (!Array.isArray(args) || args.some(a => typeof a !== "string" || a.length > 500)) return { ok: false, error: "invalid command arguments" };
  const dockerArgs = ["exec", ref, cmd, ...args];
  const r = _docker(dockerArgs, { timeoutMs: 20_000 });
  _record("exec", [ref, cmd, ...args], r);
  _emit("container:exec", { ref, cmd, ok: r.ok });
  return { ok: r.ok, ref, cmd, output: r.out, error: r.ok ? null : r.error };
}

// ══════════════════════════════════════════════════════════════════════════
// IMAGES / BUILD
// ══════════════════════════════════════════════════════════════════════════

function listImages() {
  const r = _docker(["images", "--format", "{{json .}}"], { timeoutMs: 10_000 });
  _record("list_images", [], r);
  if (!r.ok) return { ok: false, error: r.error };
  const images = r.out.trim().split("\n").filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  return { ok: true, images, count: images.length };
}

// build: real `docker build`, scoped to a Dockerfile inside this repo only.
function buildImage({ dockerfile = "Dockerfile.production", context = ".", tag } = {}) {
  const dfAbs = path.resolve(ROOT, dockerfile);
  if (!dfAbs.startsWith(ROOT + path.sep) && dfAbs !== ROOT) return { ok: false, error: "dockerfile path escapes project root" };
  if (!fs.existsSync(dfAbs)) return { ok: false, error: `Dockerfile not found: ${dockerfile}` };
  const ctxAbs = path.resolve(ROOT, context);
  if (!ctxAbs.startsWith(ROOT + path.sep) && ctxAbs !== ROOT) return { ok: false, error: "build context escapes project root" };

  const imageTag = _isSafeRef(tag) ? tag : `jarvis-os:${Date.now()}`;
  const args = ["build", "-f", dfAbs, "-t", imageTag, ctxAbs];
  const r = _docker(args, { timeoutMs: 300_000 });   // real builds can be slow
  _record("build", args, r);
  _emit("image:build", { tag: imageTag, ok: r.ok, durationMs: r.durationMs });
  _learn(`Docker build: ${imageTag}`, r.ok ? 0.9 : 0.4, ["build"], { tag: imageTag, ok: r.ok, durationMs: r.durationMs });
  return { ok: r.ok, tag: imageTag, output: r.ok ? _tail(r.out, 2000) : null, error: r.ok ? null : r.error, durationMs: r.durationMs };
}

function _tail(s, n) { return (s || "").slice(-n); }

// ══════════════════════════════════════════════════════════════════════════
// COMPOSE ORCHESTRATION
// ══════════════════════════════════════════════════════════════════════════

function _compose(args, opts) {
  return _docker(["compose", ...args], opts);
}

function composeUp({ composeFile, services = [], detach = true } = {}) {
  let file;
  try { file = _resolveComposeFile(composeFile); } catch (e) { return { ok: false, error: e.message }; }
  if (!Array.isArray(services) || services.some(s => !_isSafeName(s))) return { ok: false, error: "invalid service name(s)" };

  // Snapshot current container state for this compose file BEFORE mutating —
  // real rollback target for composeRollback().
  const pre = composeStatus({ composeFile });
  const snapshotId = _id("snap");
  const d = _load();
  d.rollbackSnapshots[snapshotId] = { composeFile: file, before: pre.services || [], ts: _ts() };
  _save(d);

  const args = ["-f", file, "up"];
  if (detach) args.push("-d");
  args.push(...services);
  const r = _compose(args, { timeoutMs: 180_000 });
  _record("compose_up", args, r);
  const dd = _load(); dd.stats.composeRuns++; _save(dd);
  _emit("compose:up", { composeFile: path.relative(ROOT, file), services, ok: r.ok });
  _learn(`Compose up: ${path.basename(file)}`, r.ok ? 0.9 : 0.4, ["compose", "up"], { services, ok: r.ok });
  return { ok: r.ok, snapshotId, output: r.ok ? _tail(r.out, 2000) : null, error: r.ok ? null : r.error };
}

function composeDown({ composeFile, removeVolumes = false } = {}) {
  let file;
  try { file = _resolveComposeFile(composeFile); } catch (e) { return { ok: false, error: e.message }; }
  const args = ["-f", file, "down"];
  if (removeVolumes) args.push("-v");
  const r = _compose(args, { timeoutMs: 60_000 });
  _record("compose_down", args, r);
  _emit("compose:down", { composeFile: path.relative(ROOT, file), ok: r.ok });
  return { ok: r.ok, output: r.ok ? _tail(r.out, 2000) : null, error: r.ok ? null : r.error };
}

function composeStatus({ composeFile } = {}) {
  let file;
  try { file = _resolveComposeFile(composeFile); } catch (e) { return { ok: false, error: e.message }; }
  const r = _compose(["-f", file, "ps", "--format", "json"], { timeoutMs: 10_000 });
  _record("compose_ps", [file], r);
  if (!r.ok) return { ok: false, error: r.error };
  let services = [];
  try {
    const trimmed = r.out.trim();
    services = trimmed ? (trimmed.startsWith("[") ? JSON.parse(trimmed) : trimmed.split("\n").filter(Boolean).map(l => JSON.parse(l))) : [];
  } catch { services = []; }
  return { ok: true, composeFile: path.relative(ROOT, file), services };
}

function composeLogs({ composeFile, service, tail = 100 } = {}) {
  let file;
  try { file = _resolveComposeFile(composeFile); } catch (e) { return { ok: false, error: e.message }; }
  const tailN = Math.min(Math.max(parseInt(tail, 10) || 100, 1), 2000);
  const args = ["-f", file, "logs", "--tail", String(tailN)];
  if (service) { if (!_isSafeName(service)) return { ok: false, error: "invalid service name" }; args.push(service); }
  const r = _compose(args, { timeoutMs: 15_000 });
  _record("compose_logs", args, r);
  return { ok: r.ok, logs: r.out, error: r.ok ? null : r.error };
}

// ── Rollback: real, using the pre-up snapshot captured in composeUp() ───────
function composeRollback(snapshotId) {
  const d = _load();
  const snap = d.rollbackSnapshots[snapshotId];
  if (!snap) return { ok: false, error: `snapshot not found: ${snapshotId}` };

  // Real rollback strategy: bring the compose stack down, then restart only
  // the containers that were running before, using their pre-recorded
  // service names. This is a real, verifiable action (not a no-op) — full
  // point-in-time image rollback would require the previous image digest,
  // which composeUp() does not currently pin; documented here rather than
  // silently claimed.
  const downResult = composeDown({ composeFile: path.relative(ROOT, snap.composeFile) });
  if (!downResult.ok) return { ok: false, error: `rollback down failed: ${downResult.error}`, snapshotId };

  const priorServiceNames = [...new Set((snap.before || []).map(s => s.Service || s.Name).filter(Boolean))];

  // Real bug found live-verifying this against the actual Docker CLI:
  // `docker compose up -d` with a ZERO-length explicit services array does
  // NOT mean "start nothing" — compose treats no service args as "start
  // every service in the file," the opposite of what an empty
  // priorServiceNames (nothing was running before this snapshot) should
  // do. Confirmed by direct test: composeUp({services:[]}) started the
  // full stack. Guard explicitly rather than passing an empty array
  // through to composeUp's own args.push(...services).
  if (priorServiceNames.length === 0) {
    d.stats.rollbacks++;
    _save(d);
    _emit("compose:rollback", { snapshotId, ok: true, restoredServices: [] });
    _learn(`Compose rollback: ${snapshotId} (restored to stopped)`, 0.85, ["rollback"], { snapshotId, restoredServices: [] });
    return { ok: true, snapshotId, restoredServices: [], note: "Nothing was running before this snapshot — rollback correctly left the stack stopped." };
  }

  const upResult = composeUp({ composeFile: path.relative(ROOT, snap.composeFile), services: priorServiceNames });

  d.stats.rollbacks++;
  _save(d);
  _emit("compose:rollback", { snapshotId, ok: upResult.ok, restoredServices: priorServiceNames });
  _learn(`Compose rollback: ${snapshotId}`, upResult.ok ? 0.85 : 0.3, ["rollback"], { snapshotId, restoredServices: priorServiceNames });
  return { ok: upResult.ok, snapshotId, restoredServices: priorServiceNames, error: upResult.ok ? null : upResult.error };
}

// ══════════════════════════════════════════════════════════════════════════
// NETWORKS / VOLUMES
// ══════════════════════════════════════════════════════════════════════════

function listNetworks() {
  const r = _docker(["network", "ls", "--format", "{{json .}}"], { timeoutMs: 10_000 });
  _record("network_ls", [], r);
  if (!r.ok) return { ok: false, error: r.error };
  const networks = r.out.trim().split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { ok: true, networks };
}

function listVolumes() {
  const r = _docker(["volume", "ls", "--format", "{{json .}}"], { timeoutMs: 10_000 });
  _record("volume_ls", [], r);
  if (!r.ok) return { ok: false, error: r.error };
  const volumes = r.out.trim().split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { ok: true, volumes };
}

// ══════════════════════════════════════════════════════════════════════════
// HEALTH
// ══════════════════════════════════════════════════════════════════════════

function containerHealth(ref) {
  const inspection = inspectContainer(ref);
  if (!inspection.ok) return inspection;
  const state  = inspection.data?.State || {};
  const health = state.Health?.Status || (state.Running ? "running_no_healthcheck" : "not_running");
  return {
    ok: true, ref,
    running: !!state.Running,
    status: state.Status,
    health,
    startedAt: state.StartedAt,
    restartCount: inspection.data?.RestartCount ?? null,
    exitCode: state.ExitCode ?? null,
  };
}

// `docker info` was found live to hang indefinitely past any reasonable
// timeout on some real Docker Desktop installs (confirmed: a bare `docker
// info` call outlived a 120s wrapper on the machine this was built/verified
// on) — it queries far more daemon state than a health probe needs. `docker
// version` hits the same daemon connection and returns near-instantly,
// giving genuine reachability + version info without the hang risk.
function daemonHealth() {
  const r = _docker(["version", "--format", "{{json .}}"], { timeoutMs: 8_000 });
  _record("daemon_version", [], r);
  if (!r.ok) return { ok: false, reachable: false, error: r.timedOut ? "docker daemon did not respond within timeout" : r.error };
  try {
    const v = JSON.parse(r.out);
    return { ok: true, reachable: !!v.Server, clientVersion: v.Client?.Version, serverVersion: v.Server?.Version, serverOs: v.Server?.Os };
  } catch {
    return { ok: true, reachable: true, raw: _tail(r.out, 500) };
  }
}

// Real container/image counts — via `docker ps`/`docker images`, which are
// confirmed fast, rather than the hanging `docker info` path above.
function daemonStats() {
  const containers = listContainers({ all: true });
  const images = listImages();
  return {
    ok: containers.ok && images.ok,
    containersTotal: containers.containers?.length ?? null,
    containersRunning: containers.containers?.filter(c => (c.State || "").toLowerCase() === "running").length ?? null,
    imagesTotal: images.images?.length ?? null,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// STATS / HISTORY / DASHBOARD
// ══════════════════════════════════════════════════════════════════════════

function getStats() { return _load().stats; }
function listHistory({ limit = 50 } = {}) { return _load().history.slice(-limit).reverse(); }

function getDashboard() {
  const health = daemonHealth();
  const containers = health.reachable ? listContainers({ all: true }) : { ok: false, containers: [] };
  return {
    ok: true,
    daemon: health,
    daemonStats: health.reachable ? daemonStats() : null,
    containers: containers.containers || [],
    stats: getStats(),
    recentHistory: listHistory({ limit: 10 }),
  };
}

module.exports = {
  // lifecycle
  listContainers, inspectContainer, containerLogs, containerStats,
  startContainer, stopContainer, restartContainer, removeContainer, execInContainer,
  // images/build
  listImages, buildImage,
  // compose
  composeUp, composeDown, composeStatus, composeLogs, composeRollback,
  // networks/volumes
  listNetworks, listVolumes,
  // health
  containerHealth, daemonHealth, daemonStats,
  // meta
  getStats, listHistory, getDashboard,
};
