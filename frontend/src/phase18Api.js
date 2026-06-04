/**
 * Phase 18 API client — Runtime Execution Layer
 * Calls /p18/* endpoints backed by the four backend engines.
 */
import { _fetch } from "./_client";

// ── 18A Runtime Action Engine ─────────────────────────────────────────
export async function executeAction(input, opts = {}) {
  return _fetch("/p18/actions/execute", {
    method: "POST", body: JSON.stringify({ input, ...opts }),
  });
}
export async function queueAction(input, opts = {}) {
  return _fetch("/p18/actions/queue", {
    method: "POST", body: JSON.stringify({ input, ...opts }),
  });
}
export async function retryAction(actionId) {
  return _fetch(`/p18/actions/${actionId}/retry`, { method: "POST" });
}
export async function cancelAction(actionId) {
  return _fetch(`/p18/actions/${actionId}`, { method: "DELETE" });
}
export async function listActions(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p18/actions${q ? "?" + q : ""}`);
}
export async function getActionAuditTrail(limit = 100) {
  return _fetch(`/p18/actions/audit?limit=${limit}`);
}

// ── 18B Agent Execution Engine ────────────────────────────────────────
export async function executeAgentTask(agentId, input, opts = {}) {
  return _fetch(`/p18/agents/${agentId}/execute`, {
    method: "POST", body: JSON.stringify({ input, ...opts }),
  });
}
export async function retryAgentRun(runId) {
  return _fetch(`/p18/agents/runs/${runId}/retry`, { method: "POST" });
}
export async function listAgents() {
  return _fetch("/p18/agents");
}
export async function getAgent(agentId) {
  return _fetch(`/p18/agents/${agentId}`);
}
export async function getAgentHistory(agentId, params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p18/agents/${agentId}/history${q ? "?" + q : ""}`);
}
export async function getAgentFailures(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p18/agents/failures${q ? "?" + q : ""}`);
}

// ── 18C Memory Persistence Layer ──────────────────────────────────────
export async function saveMemoryNode(node) {
  return _fetch("/p18/memory", { method: "POST", body: JSON.stringify(node) });
}
export async function loadMemoryNode(nodeId) {
  return _fetch(`/p18/memory/${nodeId}`);
}
export async function updateMemoryNode(nodeId, patch) {
  return _fetch(`/p18/memory/${nodeId}`, { method: "PATCH", body: JSON.stringify(patch) });
}
export async function archiveMemoryNode(nodeId) {
  return _fetch(`/p18/memory/${nodeId}`, { method: "DELETE" });
}
export async function listMemoryNodes(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p18/memory${q ? "?" + q : ""}`);
}
export async function searchMemory(query) {
  return _fetch(`/p18/memory/search?q=${encodeURIComponent(query)}`);
}
export async function memoryStats() {
  return _fetch("/p18/memory/stats");
}
export async function recallMemory(agentId, input, limit = 10) {
  return _fetch(`/p18/memory/recall?agentId=${encodeURIComponent(agentId)}&input=${encodeURIComponent(input)}&limit=${limit}`);
}

// ── 18D Autonomous Task Loop ──────────────────────────────────────────
export async function startCycle(goal, goalType = "general", source = "ui") {
  return _fetch("/p18/cycles", {
    method: "POST", body: JSON.stringify({ goal, goalType, source }),
  });
}
export async function getCycle(cycleId) {
  return _fetch(`/p18/cycles/${cycleId}`);
}
export async function listCycles(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p18/cycles${q ? "?" + q : ""}`);
}
export async function cancelCycle(cycleId) {
  return _fetch(`/p18/cycles/${cycleId}`, { method: "DELETE" });
}
export async function cycleStats() {
  return _fetch("/p18/cycles/stats");
}
export async function getLearningLog(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p18/cycles/learning${q ? "?" + q : ""}`);
}
