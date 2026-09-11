"use strict";
// V6 Phase 3: Docker Orchestration — /computer/docker/* client
import { _fetch } from "./_client";

// ── Dashboard / health / stats ──────────────────────────────────────────────

export async function getDashboard() {
  return _fetch("/computer/docker/dashboard");
}

export async function getHealth() {
  return _fetch("/computer/docker/health");
}

export async function getStats() {
  return _fetch("/computer/docker/stats");
}

export async function getHistory(limit = 50) {
  return _fetch(`/computer/docker/history?limit=${limit}`);
}

// ── Containers ───────────────────────────────────────────────────────────────

export async function listContainers(all = false) {
  return _fetch(`/computer/docker/containers${all ? "?all=true" : ""}`);
}

export async function inspectContainer(ref) {
  return _fetch(`/computer/docker/containers/${encodeURIComponent(ref)}/inspect`);
}

export async function getContainerLogs(ref, tail = 100) {
  return _fetch(`/computer/docker/containers/${encodeURIComponent(ref)}/logs?tail=${tail}`);
}

export async function getContainerStats(ref) {
  return _fetch(`/computer/docker/containers/${encodeURIComponent(ref)}/stats`);
}

export async function getContainerHealth(ref) {
  return _fetch(`/computer/docker/containers/${encodeURIComponent(ref)}/health`);
}

export async function startContainer(ref) {
  return _fetch(`/computer/docker/containers/${encodeURIComponent(ref)}/start`, { method: "POST" });
}

export async function stopContainer(ref) {
  return _fetch(`/computer/docker/containers/${encodeURIComponent(ref)}/stop`, { method: "POST" });
}

export async function restartContainer(ref) {
  return _fetch(`/computer/docker/containers/${encodeURIComponent(ref)}/restart`, { method: "POST" });
}

export async function removeContainer(ref, force = false) {
  return _fetch(`/computer/docker/containers/${encodeURIComponent(ref)}${force ? "?force=true" : ""}`, { method: "DELETE" });
}

export async function execInContainer(ref, cmd, args = []) {
  return _fetch(`/computer/docker/containers/${encodeURIComponent(ref)}/exec`, {
    method: "POST",
    body: JSON.stringify({ cmd, args }),
  });
}

// ── Images / build ────────────────────────────────────────────────────────────

export async function listImages() {
  return _fetch("/computer/docker/images");
}

export async function buildImage({ dockerfile, context, tag } = {}) {
  return _fetch("/computer/docker/build", {
    method: "POST",
    body: JSON.stringify({ dockerfile, context, tag }),
    _timeoutMs: 310_000,
  });
}

// ── Compose ────────────────────────────────────────────────────────────────────

export async function getComposeStatus(composeFile) {
  const qs = composeFile ? `?composeFile=${encodeURIComponent(composeFile)}` : "";
  return _fetch(`/computer/docker/compose/status${qs}`);
}

export async function getComposeLogs({ composeFile, service, tail = 100 } = {}) {
  const params = new URLSearchParams();
  if (composeFile) params.set("composeFile", composeFile);
  if (service) params.set("service", service);
  params.set("tail", tail);
  return _fetch(`/computer/docker/compose/logs?${params.toString()}`);
}

export async function composeUp({ composeFile, services, detach = true } = {}) {
  return _fetch("/computer/docker/compose/up", {
    method: "POST",
    body: JSON.stringify({ composeFile, services, detach }),
    _timeoutMs: 190_000,
  });
}

export async function composeDown({ composeFile, removeVolumes = false } = {}) {
  return _fetch("/computer/docker/compose/down", {
    method: "POST",
    body: JSON.stringify({ composeFile, removeVolumes }),
    _timeoutMs: 70_000,
  });
}

export async function composeRollback(snapshotId) {
  return _fetch(`/computer/docker/compose/rollback/${encodeURIComponent(snapshotId)}`, { method: "POST" });
}

// ── Networks / volumes ────────────────────────────────────────────────────────

export async function listNetworks() {
  return _fetch("/computer/docker/networks");
}

export async function listVolumes() {
  return _fetch("/computer/docker/volumes");
}
