"use strict";
/**
 * Operator OS API — thin fetch wrappers over existing backend endpoints.
 * No new backend routes. All endpoints already exist.
 */

import { _fetch } from "../../_client";

async function get(path, params = {}) {
  const qs = Object.keys(params).length
    ? "?" + new URLSearchParams(params).toString()
    : "";
  return _fetch(`${path}${qs}`);
}

async function post(path, body = {}) {
  return _fetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Runtime ──────────────────────────────────────────────────────────
export const getRuntimeStatus   = ()     => get("/runtime/status");
export const getRuntimeMetrics  = ()     => get("/runtime/metrics");
export const getRuntimeHistory  = (n=20) => get("/runtime/history", { limit: n });
export const getRuntimeDiags    = ()     => get("/runtime/diagnostics");
export const getDeadLetterQueue = ()     => get("/runtime/dead-letter");
export const getAuditHealth     = ()     => get("/runtime/audit/health");
export const getCoordStatus     = ()     => get("/runtime/coordinator/status");
export const getTaskChains      = ()     => get("/runtime/chains");
export const getReplayList      = ()     => get("/runtime/replay");

// ── Agents ───────────────────────────────────────────────────────────
// getAgents/getAgentDetail: migrated off deprecated /p18/agents to the
// canonical /agents/runtime/registry (see backend/routes/index.js's
// _deprecate("/p18/", "/runtime/* or /agents/*")). Response shape differs
// (registry: [] vs agents: []) — normalized here so no consumer changes.
export const getAgents          = ()     => get("/agents/runtime/registry").then(r => ({ ...r, agents: r?.registry || [] }));
export const getAgentDetail     = (id)   => get(`/agents/runtime/registry/${id}/status`);
// No canonical replacement yet for per-agent run history/failures/execute/retry
// (agentsRuntime.js only exposes registry + health/status + supervisor tick/
// pause/resume) — left on the still-functional deprecated routes rather than
// silently dropped or faked. Revisit if/when agentsRuntime.js grows these.
export const getAgentHistory    = (id)   => get(`/p18/agents/${id}/history`);
export const getAgentFailures   = ()     => get("/p18/agents/failures");
// getP20Agents tracks a distinct self-improvement agent roster (phase20.js's
// "improve" system), not a duplicate of the registry above — no merge intended.
export const getP20Agents       = ()     => get("/p20/agents");
export const executeAgent       = (id, input) => post(`/agents/runtime/supervisor/${id}/tick`, { input });
export const retryAgentRun      = (runId)     => post(`/p18/agents/runs/${runId}/retry`);

// ── Task Graph (Mission Engine) ───────────────────────────────────────
export const getGraphList       = ()     => get("/p26/graph");
export const getGraphStats      = ()     => get("/p26/graph/stats");
export const getGraphDetail     = (id)   => get(`/p26/graph/${id}`);
export const createGraph        = (body) => post("/p26/graph", body);
export const executeGraph       = (id)   => post(`/p26/graph/${id}/execute`);
export const deleteGraph        = (id)   => _fetch(`/p26/graph/${id}`, { method: "DELETE" });

// ── Memory & Intelligence ─────────────────────────────────────────────
// getMemoryStats: migrated off deprecated /p18/memory/stats to the
// canonical /memory/stats (engineeringMemory.js) — same { stats: {...} } shape.
export const getMemoryStats     = ()     => get("/memory/stats");
export const getMemoryFailures  = ()     => get("/p26/memory/failures");
export const getMemorySuccesses = ()     => get("/p26/memory/successes");
export const getMemoryDecisions = ()     => get("/p26/memory/decisions");
export const getKnowledgeGraph  = ()     => get("/p26/memory/knowledge-graph");
export const searchP26Memory    = (q, type) => post("/p26/memory/search", { query: q, type });

// ── Reasoning & Risk ─────────────────────────────────────────────────
export const getRecommendations = ()     => get("/p26/observer/recommendations");
export const getObserverStatus  = ()     => get("/p26/observer/status");
export const triggerObserver    = (name) => post(`/p26/observer/trigger/${name}`);
export const calcRisk           = (body) => post("/p26/reason/risk", body);
export const calcConfidence     = (body) => post("/p26/reason/confidence", body);
export const getRootCause       = (body) => post("/p26/reason/root-cause", body);
export const getRollbackPlan    = (body) => post("/p26/reason/rollback", body);

// ── Deployments ───────────────────────────────────────────────────────
export const getDeployHistory   = ()     => get("/p25/deploy/history");
export const getDeployList      = ()     => get("/p25/deploy");
// getSystemMetrics: /p25/obs is deprecated in favor of /analytics/*, but
// analyticsService.cjs has no 1:1 "system metrics" equivalent (closest is
// getRuntimeCapacity() at /analytics/runtime, a different shape) — left as
// the still-functional deprecated route rather than guessing at a swap.
export const getSystemMetrics   = ()     => get("/p25/obs/metrics/system");

// ── Health & Ops ─────────────────────────────────────────────────────
export const getHealth          = ()     => get("/health");
export const getOps             = ()     => get("/ops");
export const getStats           = ()     => get("/stats");
export const emergencyStop      = ()     => post("/runtime/emergency/stop");
export const emergencyResume    = ()     => post("/runtime/emergency/resume");
export const recoverQueue       = ()     => post("/runtime/recover/queue");
export const recoverGovernor    = ()     => post("/runtime/recover/governor");

// ── Autonomy ─────────────────────────────────────────────────────────
// No canonical /agents or /runtime replacements exist yet for self-improvement
// stats, autonomous-cycle stats, or the action audit log — these still work on
// the deprecated routes (phase18.js/phase20.js remain mounted, only header-
// flagged). analytics/ai (getAIUtilization) is a related but different concept
// (AI provider usage) — not a safe swap for autonomy/cycle/action data.
export const getAutonomyScore   = ()     => get("/p20/improve/stats");
export const getCycleStats      = ()     => get("/p18/cycles/stats");
export const getActions         = ()     => get("/p18/actions");

// ── Jarvis (command dispatch) ─────────────────────────────────────────
export const dispatchJarvis     = (input, mode = "smart") =>
  post("/jarvis", { input, mode });
