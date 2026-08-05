// Workforce OS API — connects workforceOS.cjs routes (POST-Ω Sprint P7
// Autonomous Workforce OS: skillEngine's 36-agent AGENT_CATALOGUE, real
// team-building, capacity planning, and performance tracking). Backend was
// fully built (36 routes) but had zero frontend callers — this file closes
// that gap using the same thin _fetch wrapper pattern as every other
// domain API file in this directory.
import { _fetch } from "./_client";

export async function getWorkforceAgents({ org, skill, available, teamType, limit } = {}) {
  try {
    const q = new URLSearchParams();
    if (org) q.set("org", org);
    if (skill) q.set("skill", skill);
    if (available !== undefined) q.set("available", String(available));
    if (teamType) q.set("teamType", teamType);
    if (limit) q.set("limit", String(limit));
    const qs = q.toString();
    return await _fetch(`/workforce-os/agents${qs ? "?" + qs : ""}`);
  } catch (err) { return { ok: false, error: err.message, agents: [] }; }
}

export async function getWorkforceAgentCard(agentId) {
  return _fetch(`/workforce-os/agents/${agentId}`);
}

export async function getWorkforceAgentPerformance(agentId) {
  return _fetch(`/workforce-os/agents/${agentId}/performance`);
}

export async function getWorkforceDashboard() {
  return _fetch("/workforce-os/dashboard");
}

export async function getWorkforceStats() {
  return _fetch("/workforce-os/stats");
}

export async function runWorkforceMission({ title, description, domain, priority, requiredSkills, teamType, minAgents, maxAgents, dryRun } = {}) {
  return _fetch("/workforce-os/mission/run", {
    method: "POST",
    body: JSON.stringify({ title, description, domain, priority, requiredSkills, teamType, minAgents, maxAgents, dryRun }),
  });
}

export async function listWorkforceMissions({ status, domain, limit } = {}) {
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  if (domain) q.set("domain", domain);
  if (limit) q.set("limit", String(limit));
  const qs = q.toString();
  return _fetch(`/workforce-os/missions${qs ? "?" + qs : ""}`);
}

export async function getWorkforceReport() {
  return _fetch("/workforce-os/report");
}

export async function getWorkforceTeams({ status, type, limit } = {}) {
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  if (type) q.set("type", type);
  if (limit) q.set("limit", String(limit));
  const qs = q.toString();
  return _fetch(`/workforce-os/teams${qs ? "?" + qs : ""}`);
}

export async function getWorkforceCapacity() {
  return _fetch("/workforce-os/capacity");
}

export async function getWorkforcePerformanceRankings({ org, limit } = {}) {
  const q = new URLSearchParams();
  if (org) q.set("org", org);
  if (limit) q.set("limit", String(limit));
  const qs = q.toString();
  return _fetch(`/workforce-os/performance/rankings${qs ? "?" + qs : ""}`);
}

export async function getWorkforceSkillCoverage() {
  return _fetch("/workforce-os/skills/coverage");
}
