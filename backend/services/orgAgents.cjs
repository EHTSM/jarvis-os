"use strict";
/**
 * orgAgents.cjs — V5 Global AI Organization Platform, Module 3:
 * Organization Agents.
 *
 * NOT a new agent runtime. agentRegistry.cjs (agents/runtime/) is the
 * real, general-purpose, capability-routed, circuit-breaker-protected
 * agent catalog; agentExecutionEngine.cjs is the real, persisted
 * execution-run history layer sitting on top of it (dispatches through
 * runtimeOrchestrator, records every run). Neither has an orgId concept —
 * agentExecutionEngine's run record shape only stores a fixed field set
 * (runId, agentId, input, type, status, ...), so passing orgId into
 * executeTask()'s opts would silently be dropped, not persisted (verified
 * by reading executeTask's destructuring before writing this file).
 * Modifying that shared engine's schema to add orgId was rejected —
 * agentExecutionEngine is used across this whole codebase, and widening
 * its persisted record shape is a platform-wide schema change for a
 * single mission's org-scoping need.
 *
 * Instead: a small, additive join store (data/org-agent-runs.json) records
 * which org submitted which real runId, alongside the real accountId that
 * submitted it. The actual run content — status, output, timing, success —
 * is never duplicated here; every read re-fetches it live from
 * agentExecutionEngine.getHistory(agentId) and filters down to this org's
 * runIds. Single source of truth stays in agentExecutionEngine; this file
 * only tracks org ownership of runIds it didn't create room for itself.
 */

const fs   = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "../../data/org-agent-runs.json");
const MAX_RECORDS = 5000;

const _try = fn => { try { return fn(); } catch { return null; } };
const _org = () => _try(() => require("./organizationService.cjs"));
const _engine = () => _try(() => require("./agentExecutionEngine.cjs"));

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { records: [] }; }
}
function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.records.length > MAX_RECORDS) d.records = d.records.slice(-MAX_RECORDS);
  const tmp = DATA + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, DATA);
}

function _assertCanUseAgents(orgId, accountId) {
  // Running an agent is real AI-adjacent execution work (same trust bar as
  // Module 1's ask()) — reuses the same use_ai action rather than adding a
  // second, functionally-identical permission.
  if (!_org()?.hasPermission?.(orgId, accountId, "use_ai")) {
    const e = new Error("Forbidden — requires permission: use_ai");
    e.status = 403;
    throw e;
  }
}

function _assertMember(orgId, accountId) {
  if (!_org()?.hasPermission?.(orgId, accountId, "view_members")) {
    const e = new Error("Forbidden — not a member of this organization");
    e.status = 403;
    throw e;
  }
}

/** Real, live agent catalog — direct passthrough, agents themselves are a
 * platform-wide resource (not org-owned), only usage/execution is
 * org-scoped. */
function listAgents(orgId, accountId) {
  _assertMember(orgId, accountId);
  return _engine()?.listAgents?.() || [];
}

/** Executes a real agent task via the real engine, then records org
 * ownership of the resulting real runId in the join store. */
async function runTask(orgId, accountId, agentId, input, opts = {}) {
  if (!orgId) throw new Error("orgId required");
  _assertCanUseAgents(orgId, accountId);
  const engine = _engine();
  if (!engine) throw new Error("agentExecutionEngine unavailable");

  const result = await engine.executeTask(agentId, input, opts);

  const d = _load();
  d.records.push({
    orgId, runId: result.runId, agentId, submittedBy: accountId,
    createdAt: new Date().toISOString(),
  });
  _save(d);

  return result;
}

/** Real run history for this org's agent usage — join-table runIds
 * cross-referenced against agentExecutionEngine's real, live run records
 * (never a stale copy: every call re-fetches from the engine). */
function getHistory(orgId, accountId, opts = {}) {
  _assertMember(orgId, accountId);
  const d = _load();
  const orgRecords = d.records.filter(r => r.orgId === orgId && (!opts.agentId || r.agentId === opts.agentId));
  const runIdSet = new Set(orgRecords.map(r => r.runId));
  if (!runIdSet.size) return { runs: [], total: 0, stats: { succeeded: 0, failed: 0, successRate: 0, avgMs: 0 } };

  const engine = _engine();
  // Pull each distinct agentId's full history once, filter down to this
  // org's runIds — agentExecutionEngine has no per-runId lookup exposed,
  // only per-agentId, so this is the real API surface available.
  const agentIds = [...new Set(orgRecords.map(r => r.agentId))];
  let allRuns = [];
  for (const aid of agentIds) {
    const { runs } = engine?.getHistory?.(aid, { limit: 5000 }) || { runs: [] };
    allRuns.push(...runs.filter(r => runIdSet.has(r.runId)));
  }
  allRuns.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  const total = allRuns.length;
  const succeeded = allRuns.filter(r => r.success === true).length;
  const failed = allRuns.filter(r => r.success === false).length;
  const avgMs = total ? Math.round(allRuns.reduce((s, r) => s + (r.durationMs || 0), 0) / total) : 0;
  const limit = opts.limit || 50;

  return {
    runs: allRuns.slice(0, limit),
    total,
    stats: { succeeded, failed, successRate: total ? Math.round(succeeded / total * 100) : 0, avgMs },
  };
}

module.exports = { listAgents, runTask, getHistory };
