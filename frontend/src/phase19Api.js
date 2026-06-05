/**
 * Phase 19 API client — Autonomy Execution Layer
 * /p19/tools/*   — ToolExecutionLayer
 * /p19/coord/*   — MultiAgentCoordinator
 * /p19/heal/*    — SelfHealingRuntime
 * /p19/learn/*   — ContinuousLearningEngine
 */
import { _fetch } from "./_client";

// ── 19A Tool Execution Layer ──────────────────────────────────────────
export async function listTools() {
  return _fetch("/p19/tools");
}
export async function toolStatus() {
  return _fetch("/p19/tools/status");
}
export async function getToolFailures(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p19/tools/failures${q ? "?" + q : ""}`);
}
export async function getToolPermissions(toolId) {
  return _fetch(`/p19/tools/${encodeURIComponent(toolId)}/permissions`);
}
export async function setToolPermission(toolId, action, allowed) {
  return _fetch(`/p19/tools/${encodeURIComponent(toolId)}/permissions/${encodeURIComponent(action)}`, {
    method: "PUT", body: JSON.stringify({ allowed }),
  });
}
export async function executeTool(toolId, input, opts = {}) {
  return _fetch(`/p19/tools/${encodeURIComponent(toolId)}/execute`, {
    method: "POST", body: JSON.stringify({ input, ...opts }),
  });
}
export async function getToolUsage(toolId, params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p19/tools/${encodeURIComponent(toolId)}/usage${q ? "?" + q : ""}`);
}

// ── 19B Multi-Agent Coordinator ───────────────────────────────────────
export async function listCoordSessions(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p19/coord/sessions${q ? "?" + q : ""}`);
}
export async function getCoordSession(sessionId) {
  return _fetch(`/p19/coord/sessions/${sessionId}`);
}
export async function getCoordStats() {
  return _fetch("/p19/coord/sessions/stats");
}
export async function agentHandoff(fromAgentId, toAgentId, context = "", opts = {}) {
  return _fetch("/p19/coord/handoff", {
    method: "POST", body: JSON.stringify({ fromAgentId, toAgentId, context, ...opts }),
  });
}
export async function agentDelegate(fromAgentId, toAgentId, task, opts = {}) {
  return _fetch("/p19/coord/delegate", {
    method: "POST", body: JSON.stringify({ fromAgentId, toAgentId, task, ...opts }),
  });
}
export async function agentCollaborate(agentIds, goal, opts = {}) {
  return _fetch("/p19/coord/collaborate", {
    method: "POST", body: JSON.stringify({ agentIds, goal, ...opts }),
  });
}

// ── 19C Self-Healing Runtime ──────────────────────────────────────────
export async function getHealStatus() {
  return _fetch("/p19/heal/status");
}
export async function getHealHistory(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p19/heal/history${q ? "?" + q : ""}`);
}
export async function runProbe() {
  return _fetch("/p19/heal/probe", { method: "POST" });
}
export async function healTask(taskId, opts = {}) {
  return _fetch(`/p19/heal/task/${taskId}`, {
    method: "POST", body: JSON.stringify(opts),
  });
}
export async function healCycle(cycleId, opts = {}) {
  return _fetch(`/p19/heal/cycle/${cycleId}`, {
    method: "POST", body: JSON.stringify(opts),
  });
}
export async function circuitBreak(targetId, reason = "") {
  return _fetch("/p19/heal/circuit-break", {
    method: "POST", body: JSON.stringify({ targetId, reason }),
  });
}

// ── 19D Continuous Learning Engine ────────────────────────────────────
export async function getLessons(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p19/learn/lessons${q ? "?" + q : ""}`);
}
export async function getRecommendations(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p19/learn/recommendations${q ? "?" + q : ""}`);
}
export async function getLearningStats() {
  return _fetch("/p19/learn/stats");
}
export async function runFullAnalysis() {
  return _fetch("/p19/learn/analyze", { method: "POST" });
}
export async function analyzeFailures(params = {}) {
  return _fetch("/p19/learn/analyze/failures", {
    method: "POST", body: JSON.stringify(params),
  });
}
export async function createLesson(lesson) {
  return _fetch("/p19/learn/lessons", {
    method: "POST", body: JSON.stringify(lesson),
  });
}
export async function updateRecommendation(recId, patch) {
  return _fetch(`/p19/learn/recommendations/${recId}`, {
    method: "PATCH", body: JSON.stringify(patch),
  });
}
