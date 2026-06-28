"use strict";
/**
 * workspaceMesh.cjs — POST-Ω Sprint P9 Autonomous Workspace Mesh
 *
 * Primary entry point for the Autonomous Workspace Mesh.
 * Founder issues one command → Ooplix coordinates every connected workspace
 * as one distributed operating environment.
 *
 * Implements:
 *   - `execute(command)` — NL command → mesh-wide orchestration
 *   - `bootstrap()` — register all 12 workspace types
 *   - `getStatus()` — health + sync + coordination status
 *   - `recover(workspaceId)` — recover a failed workspace
 *   - `routeToWorkspace(capability, command)` — explicit routing
 *
 * Reuses: workspaceRegistry, workspaceCoordinator, workspaceSynchronization,
 *         workspaceHealth, computerController, approvalEngine,
 *         autonomousExecutionEngine, workforceManager, companyFactory.
 *
 * Storage: data/workspace-mesh.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "workspace-mesh.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _wr  = () => _try(() => require("./workspaceRegistry.cjs"));
const _wc  = () => _try(() => require("./workspaceCoordinator.cjs"));
const _ws  = () => _try(() => require("./workspaceSynchronization.cjs"));
const _wh  = () => _try(() => require("./workspaceHealth.cjs"));
const _cc  = () => _try(() => require("./computerController.cjs"));
const _ae  = () => _try(() => require("./approvalEngine.cjs"));
const _aee = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _wm  = () => _try(() => require("./workforceManager.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `mesh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ── Default workspace configurations ─────────────────────────────────────────

const DEFAULT_WORKSPACES = [
  { type: "local",        label: "Local Workspace",  config: { path: process.cwd() } },
  { type: "electron",     label: "Electron App",     config: { port: 3000 } },
  { type: "browser",      label: "Browser",          config: { defaultBrowser: "chrome" } },
  { type: "vscode",       label: "VS Code",          config: { extensionHost: true } },
  { type: "terminal",     label: "Terminal",         config: { shell: process.env.SHELL || "/bin/zsh" } },
  { type: "github",       label: "GitHub",           config: { org: "ooplix" } },
  { type: "vps",          label: "VPS / Server",     config: { provider: "hetzner" } },
  { type: "docker",       label: "Docker",           config: { socket: "/var/run/docker.sock" } },
  { type: "firebase",     label: "Firebase",         config: { project: "ooplix-prod" } },
  { type: "supabase",     label: "Supabase",         config: { project: "ooplix-db" } },
  { type: "cloudflare",   label: "Cloudflare",       config: { zone: "ooplix.app" } },
  { type: "google_cloud", label: "Google Cloud",     config: { project: "ooplix-gcp" } },
];

// NL command → domain mapping
const COMMAND_DOMAINS = [
  [/deploy|release|push.*prod/i,                  "deployment"],
  [/test|spec|coverage|jest|vitest/i,             "testing"],
  [/build|compile|bundle/i,                       "backend"],
  [/browser|screenshot|scrape|crawl/i,            "frontend"],
  [/edit|refactor|rename|create.*file/i,          "backend"],
  [/github|pr|issue|commit|merge/i,               "ci_cd"],
  [/docker|container|image/i,                     "deployment"],
  [/database|db|sql|migrate|seed/i,               "database"],
  [/monitor|alert|log|metric/i,                   "monitoring"],
  [/cloud|gcp|aws|firebase|supabase/i,            "cloud"],
];

function _inferDomain(command) {
  for (const [re, domain] of COMMAND_DOMAINS) {
    if (re.test(command)) return domain;
  }
  return "default";
}

function _inferSteps(command) {
  // Break a compound NL command into discrete steps
  // e.g. "run tests, build, and deploy to VPS"
  const parts = command
    .split(/,|\s+and\s+|;\s*|\s+then\s+/i)
    .map(s => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [{ action: command }];
  return parts.map(action => ({ action }));
}

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      bootstrapped: false,
      executions:   [],
      stats: { totalExecutions: 0, successfulExecutions: 0, totalMinutesSaved: 0, workspacesManaged: 0 },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.executions.length > 200) d.executions = d.executions.slice(-200);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

function bootstrap({ workspaces = DEFAULT_WORKSPACES } = {}) {
  const d = _load();
  const results = [];

  for (const ws of workspaces) {
    const r = _wr()?.register?.(ws) || { ok: false, error: "registry unavailable" };
    results.push({ type: ws.type, label: ws.label, ok: r.ok, registered: r.registered });
  }

  d.bootstrapped  = true;
  d.stats.workspacesManaged = _wr()?.list?.()?.length || workspaces.length;
  _save(d);

  return {
    ok:         true,
    registered: results.filter(r => r.registered).length,
    existing:   results.filter(r => !r.registered && r.ok).length,
    failed:     results.filter(r => !r.ok).length,
    workspaces: results,
  };
}

// ── Primary execution surface ─────────────────────────────────────────────────

async function execute(command, { missionId, founder, skipApproval = true, parallel = true } = {}) {
  if (!command) return { ok: false, error: "command required" };

  // Auto-bootstrap if not yet done
  const d = _load();
  if (!d.bootstrapped) bootstrap();

  const execId    = _id();
  const resolvedMissionId = missionId || execId;
  const domain    = _inferDomain(command);
  const steps     = _inferSteps(command);

  // Run via coordinator (handles dispatch, recovery, sync, evidence)
  const result = await _wc()?.run?.({
    missionId: resolvedMissionId,
    title:     command,
    domain,
    steps,
    founder,
    skipApproval,
  }) || { ok: false, error: "coordinator unavailable" };

  // Health check after execution
  const health = _wh()?.checkMesh?.() || { ok: true, healthy: 0, total: 0 };

  const exec = {
    id:         execId,
    command,
    domain,
    missionId:  resolvedMissionId,
    steps:      steps.length,
    status:     result.ok ? (result.status || "completed") : "failed",
    minutesSaved: result.minutesSaved || 0,
    recoveries:   result.recoveries  || 0,
    meshHealth: { healthy: health.healthy, total: health.total },
    ts:         _ts(),
  };

  d.executions.push(exec);
  d.stats.totalExecutions++;
  if (result.ok) d.stats.successfulExecutions++;
  d.stats.totalMinutesSaved += exec.minutesSaved;
  _save(d);

  return {
    ok:           result.ok,
    execId,
    missionId:    resolvedMissionId,
    command,
    domain,
    stepsCount:   steps.length,
    status:       exec.status,
    minutesSaved: exec.minutesSaved,
    recoveries:   exec.recoveries,
    evidence:     result.evidence || [],
    meshHealth:   exec.meshHealth,
  };
}

// ── Route to specific workspace ───────────────────────────────────────────────

async function routeToWorkspace(capability, command, { missionId } = {}) {
  const workspaces = _wr()?.list?.({ status: "active", capability }) || [];
  if (!workspaces.length) return { ok: false, error: `no active workspace with capability: ${capability}` };

  const ws   = workspaces[0];
  const result = await _wc()?.run?.({
    missionId: missionId || _id(),
    title:     command,
    domain:    "default",
    steps:     [{ action: command }],
    skipApproval: true,
  });

  return { ok: result?.ok || false, workspaceId: ws.id, workspaceType: ws.type, result };
}

// ── Recovery ──────────────────────────────────────────────────────────────────

async function recover(workspaceId) {
  const ws = _wr()?.get?.(workspaceId);
  if (!ws) return { ok: false, error: "workspace not found" };

  // Re-register to reset status
  const r = _wr()?.register?.({ type: ws.type, label: ws.label, config: ws.config, metadata: ws.metadata });
  if (!r?.ok) return { ok: false, error: "re-registration failed" };

  // Sync any pending state
  const active = _wr()?.list?.({ status: "active" }) || [];
  if (active.length > 0) {
    _ws()?.propagateContext?.({
      missionId:  `recovery_${workspaceId}`,
      context:    { recovered: true, workspaceId, ts: _ts() },
      sourceWorkspaceId: null,
    });
  }

  const d = _load();
  d.stats.totalExecutions++;   // count recovery as an execution
  _save(d);

  return { ok: true, workspaceId, workspaceType: ws.type, status: "recovered" };
}

// ── Status ────────────────────────────────────────────────────────────────────

function getStatus() {
  const d       = _load();
  const health  = _wh()?.checkMesh?.() || { ok: false };
  const botts   = _wh()?.detectBottlenecks?.() || { bottlenecks: [] };
  const syncStats = _ws()?.getStats?.() || {};
  const coordStats = _wc()?.getStats?.() || {};
  const regStats = _wr()?.getStats?.() || {};

  return {
    ok:          true,
    bootstrapped: d.bootstrapped,
    stats:       d.stats,
    workspaces:  regStats,
    health: {
      healthy:  health.healthy,
      degraded: health.degraded,
      critical: health.critical,
      total:    health.total,
    },
    bottlenecks: botts.bottlenecks || [],
    sync:        syncStats,
    coordination: coordStats,
    updatedAt:   d.updatedAt,
  };
}

function getStats() {
  return { ..._load().stats, updatedAt: _load().updatedAt };
}

function listExecutions({ status, domain, limit = 50 } = {}) {
  let execs = _load().executions;
  if (status) execs = execs.filter(e => e.status === status);
  if (domain) execs = execs.filter(e => e.domain === domain);
  return { ok: true, executions: execs.slice(-limit) };
}

module.exports = {
  DEFAULT_WORKSPACES,
  COMMAND_DOMAINS,
  bootstrap,
  execute,
  routeToWorkspace,
  recover,
  getStatus,
  getStats,
  listExecutions,
};
