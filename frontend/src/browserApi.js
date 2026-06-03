"use strict";
import { _fetch } from "./_client";

// ── Library & Catalogue ───────────────────────────────────────────────────────

export async function getLibraryCatalogue() {
  return _fetch("/browser/library");
}

export async function runLibraryWorkflow(name, params = {}, opts = {}) {
  return _fetch("/browser/library/run", {
    method: "POST",
    body: JSON.stringify({ name, params, ...opts }),
    _timeoutMs: (opts.timeoutMs || 120_000) + 5000,
  });
}

// ── Templates ─────────────────────────────────────────────────────────────────

export async function listTemplates(filter = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined))
  ).toString();
  return _fetch(`/browser/templates${qs ? `?${qs}` : ""}`);
}

export async function saveTemplate(name, steps, meta = {}) {
  return _fetch("/browser/templates", {
    method: "POST",
    body: JSON.stringify({ name, steps, ...meta }),
  });
}

export async function getTemplate(id) {
  return _fetch(`/browser/templates/${id}`);
}

export async function deleteTemplate(id) {
  return _fetch(`/browser/templates/${id}`, { method: "DELETE" });
}

export async function cloneTemplate(id, newName) {
  return _fetch(`/browser/templates/${id}/clone`, {
    method: "POST",
    body: JSON.stringify({ name: newName }),
  });
}

export async function runTemplate(id, params = {}, opts = {}) {
  const { noRecord, ...rest } = opts;
  return _fetch(`/browser/templates/${id}/run`, {
    method: "POST",
    body: JSON.stringify({ params, ...rest, ...(noRecord ? { noRecord: true } : {}) }),
    _timeoutMs: (rest.timeoutMs || 120_000) + 5000,
  });
}

export async function getTemplateSteps(id, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return _fetch(`/browser/templates/${id}/steps${qs ? `?${qs}` : ""}`);
}

// ── History ───────────────────────────────────────────────────────────────────

export async function listHistory(opts = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined))
  ).toString();
  return _fetch(`/browser/history${qs ? `?${qs}` : ""}`);
}

export async function getExecution(id) {
  return _fetch(`/browser/history/${id}`);
}

export async function replayExecution(id, opts = {}) {
  return _fetch(`/browser/history/${id}/replay`, {
    method: "POST",
    body: JSON.stringify(opts),
    _timeoutMs: (opts.timeoutMs || 120_000) + 5000,
  });
}

export async function clearHistory(olderThanDays = 30) {
  return _fetch("/browser/history/clear", {
    method: "POST",
    body: JSON.stringify({ olderThanDays }),
  });
}

// ── Health ────────────────────────────────────────────────────────────────────

export async function getSystemHealth() {
  return _fetch("/browser/health/system");
}

export async function getWorkflowHealth(templateId) {
  return _fetch(`/browser/health/workflow/${templateId}`);
}

export async function getBrowserStatus() {
  return _fetch("/browser/status");
}

// ── Raw workflow run ──────────────────────────────────────────────────────────

export async function runWorkflowSteps(steps, opts = {}) {
  return _fetch("/browser/run", {
    method: "POST",
    body: JSON.stringify({ steps, ...opts }),
    _timeoutMs: (opts.timeoutMs || 120_000) + 5000,
  });
}

export async function cancelWorkflow(workflowId, reason) {
  return _fetch("/browser/cancel", {
    method: "POST",
    body: JSON.stringify({ workflowId, reason }),
  });
}

// ── Server-side Schedules ─────────────────────────────────────────────────────

export async function getServerSchedules() {
  return _fetch("/browser/schedules");
}

export async function getSchedulerStatus() {
  return _fetch("/browser/schedules/status");
}

export async function getScheduleRuns() {
  return _fetch("/browser/schedules/runs");
}

export async function saveServerSchedule(templateId, sched) {
  return _fetch(`/browser/schedules/${templateId}`, {
    method: "POST",
    body: JSON.stringify(sched || { freq: "manual" }),
  });
}

export async function removeServerSchedule(templateId) {
  return _fetch(`/browser/schedules/${templateId}`, { method: "DELETE" });
}
