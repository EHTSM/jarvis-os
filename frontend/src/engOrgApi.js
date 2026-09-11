"use strict";
// A.8.3 recovery: /engorg/v2/* client — engineeringOrgState.cjs was fully
// built and wired to real routes (backend/routes/engineeringOrg.js) with real
// persisted data (data/engorg/state.json: 95 objectives, 66 epics, 243 work
// items, 36 blockers) but had zero frontend consumers. Same recovery pattern
// as customerOrgApi.js / productFactoryApi.js.
import { _fetch } from "./_client";

export async function listObjectives({ quarter, status } = {}) {
  const q = new URLSearchParams();
  if (quarter) q.set("quarter", quarter);
  if (status) q.set("status", status);
  const qs = q.toString();
  return _fetch(`/engorg/v2/objectives${qs ? "?" + qs : ""}`);
}

export async function createObjective({ title, description, quarter, kpis }) {
  return _fetch("/engorg/v2/objectives", { method: "POST", body: JSON.stringify({ title, description, quarter, kpis }) });
}

export async function listEpics({ objectiveId, status, priority } = {}) {
  const q = new URLSearchParams();
  if (objectiveId) q.set("objectiveId", objectiveId);
  if (status) q.set("status", status);
  if (priority) q.set("priority", priority);
  const qs = q.toString();
  return _fetch(`/engorg/v2/epics${qs ? "?" + qs : ""}`);
}

export async function createEpic({ title, description, objectiveId, priority, estimatedDays }) {
  return _fetch("/engorg/v2/epics", { method: "POST", body: JSON.stringify({ title, description, objectiveId, priority, estimatedDays }) });
}

export async function listWorkItems({ status, assignedTo, domain, epicId, priority, limit = 100 } = {}) {
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  if (assignedTo) q.set("assignedTo", assignedTo);
  if (domain) q.set("domain", domain);
  if (epicId) q.set("epicId", epicId);
  if (priority) q.set("priority", priority);
  q.set("limit", limit);
  return _fetch(`/engorg/v2/work-items?${q.toString()}`);
}

export async function createWorkItem({ title, description, epicId, domain, priority, estimatedHours, tags }) {
  return _fetch("/engorg/v2/work-items", { method: "POST", body: JSON.stringify({ title, description, epicId, domain, priority, estimatedHours, tags }) });
}

export async function getBacklog(engineerId) {
  return _fetch(`/engorg/v2/backlogs/${encodeURIComponent(engineerId)}`);
}

export async function listBlockers({ workItemId, resolved } = {}) {
  const q = new URLSearchParams();
  if (workItemId) q.set("workItemId", workItemId);
  if (resolved !== undefined) q.set("resolved", resolved);
  const qs = q.toString();
  return _fetch(`/engorg/v2/blockers${qs ? "?" + qs : ""}`);
}

export async function resolveBlocker(id, body = {}) {
  return _fetch(`/engorg/v2/blockers/${encodeURIComponent(id)}/resolve`, { method: "POST", body: JSON.stringify(body) });
}
