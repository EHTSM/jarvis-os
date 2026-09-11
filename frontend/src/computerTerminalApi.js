"use strict";
// Pre-Burn-In Certification: /computer/terminal/* client — terminalController.cjs
// (real execFileSync-based, no-shell command execution with a per-binary
// allowlist, real command history/retry/recover) had zero frontend consumer.
import { _fetch } from "./_client";

export async function getStats() {
  return _fetch("/computer/terminal/stats");
}

export async function listCommands({ status, limit = 50 } = {}) {
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  q.set("limit", limit);
  return _fetch(`/computer/terminal/commands?${q.toString()}`);
}

export async function run(cmd, { cwd, timeoutMs } = {}) {
  return _fetch("/computer/terminal/run", { method: "POST", body: JSON.stringify({ cmd, cwd, timeoutMs }) });
}

export async function getOutput(cmdId) {
  return _fetch(`/computer/terminal/output/${encodeURIComponent(cmdId)}`);
}

export async function retry(cmdId, maxAttempts = 3) {
  return _fetch(`/computer/terminal/retry/${encodeURIComponent(cmdId)}`, { method: "POST", body: JSON.stringify({ maxAttempts }) });
}
