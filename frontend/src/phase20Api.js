/**
 * Phase 20 API client — Autonomy Intelligence Layer
 * /p20/agents/*  — AgentFactoryAutomation
 * /p20/memory/*  — MemoryIntelligenceEngine
 * /p20/improve/* — ImprovementLoopEngine
 * /p20/ooplix/*  — OoplixAutonomyEngine
 */
import { _fetch } from "./_client";

// ── 20A Agent Factory Automation ──────────────────────────────────────
export async function listManagedAgents(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p20/agents${q ? "?" + q : ""}`);
}
export async function getManagedAgent(agentId) {
  return _fetch(`/p20/agents/${agentId}`);
}
export async function createManagedAgent(spec) {
  return _fetch("/p20/agents", { method: "POST", body: JSON.stringify(spec) });
}
export async function updateManagedAgent(agentId, patch) {
  return _fetch(`/p20/agents/${agentId}`, { method: "PATCH", body: JSON.stringify(patch) });
}
export async function deleteManagedAgent(agentId) {
  return _fetch(`/p20/agents/${agentId}`, { method: "DELETE" });
}
export async function getAgentFactoryStats() {
  return _fetch("/p20/agents/stats");
}

// ── 20B Memory Intelligence Engine ───────────────────────────────────
export async function getMemoryIntelligence(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p20/memory${q ? "?" + q : ""}`);
}
export async function analyzeMemoryPatterns() {
  return _fetch("/p20/memory/analyze", { method: "POST" });
}
export async function getMemoryInsights(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p20/memory/insights${q ? "?" + q : ""}`);
}
export async function optimizeMemory() {
  return _fetch("/p20/memory/optimize", { method: "POST" });
}

// ── 20C Improvement Loop Engine ───────────────────────────────────────
export async function getImprovementStatus() {
  return _fetch("/p20/improve/status");
}
export async function getImprovementHistory(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p20/improve/history${q ? "?" + q : ""}`);
}
export async function triggerImprovement(target, opts = {}) {
  return _fetch("/p20/improve/run", {
    method: "POST", body: JSON.stringify({ target, ...opts }),
  });
}

// ── 20D Ooplix Autonomy Engine ────────────────────────────────────────
export async function getAutonomyStatus() {
  return _fetch("/p20/ooplix/status");
}
export async function getAutonomyScore() {
  return _fetch("/p20/ooplix/score");
}
export async function getAutonomyHistory(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p20/ooplix/history${q ? "?" + q : ""}`);
}
export async function setAutonomyMode(mode) {
  return _fetch("/p20/ooplix/mode", {
    method: "POST", body: JSON.stringify({ mode }),
  });
}
