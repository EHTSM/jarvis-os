"use strict";

// Defines and enforces sandbox policies for execution adapters.
// Policies control which commands are allowed, resource limits, and write permissions.

const DEFAULT_TIMEOUT_MS  = 30000;
const MAX_OUTPUT_BYTES    = 1024 * 1024; // 1 MB
const MAX_POLICIES        = 200;

// Built-in base allowlists by adapter type
const BASE_ALLOWLISTS = {
  terminal: new Set([
    "echo", "printf", "ls", "cat", "head", "tail", "grep", "find", "pwd",
    "whoami", "uname", "date", "which", "env", "printenv",
    "wc", "sort", "uniq", "tr", "cut", "diff", "stat", "basename",
    "dirname", "realpath", "true", "false", "test", "sleep",
    "node", "npm", "npx", "git",
  ]),
  git: new Set([
    "status", "log", "diff", "branch", "show", "remote", "rev-parse",
    "ls-files", "describe", "shortlog", "tag", "stash",
  ]),
  git_write: new Set(["add", "commit", "checkout", "switch", "merge", "pull", "push", "reset", "restore"]),
  vscode: new Set([
    "--version", "--list-extensions", "--status",
  ]),
  filesystem: new Set(["read", "list", "stat", "exists"]),
  filesystem_write: new Set(["write", "mkdir", "delete", "copy", "move"]),
};

// Patterns that are ALWAYS blocked regardless of allowlist
const GLOBAL_BLOCKED_PATTERNS = [
  /\bsudo\b/i,
  /\bsu\s/i,
  /;\s*rm\b/i,
  /&&\s*rm\b/i,
  /\|\s*rm\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bnc\b.*-[el]/i,
  />\s*\/etc\//i,
  />\s*\/usr\//i,
  />\s*\/bin\//i,
  />\s*\/sbin\//i,
];

let _policies = new Map();
let _counter  = 0;

// Register a named sandbox policy
function registerPolicy(policyId, {
  adapterType        = "terminal",
  allowedCommands    = null,  // null = use base allowlist for adapterType
  additionalAllowed  = [],
  blockedPatterns    = [],
  maxTimeoutMs       = DEFAULT_TIMEOUT_MS,
  maxOutputBytes     = MAX_OUTPUT_BYTES,
  writeAllowed       = false,
  networkAllowed     = false,
  sandboxRoot        = null,
  metadata           = {},
} = {}) {
  if (!policyId) return { registered: false, reason: "missing_policy_id" };
  if (_policies.size >= MAX_POLICIES) return { registered: false, reason: "policy_limit_reached" };

  const base = allowedCommands
    ? new Set(allowedCommands)
    : new Set([...(BASE_ALLOWLISTS[adapterType] ?? []), ...additionalAllowed]);

  if (writeAllowed && BASE_ALLOWLISTS[`${adapterType}_write`]) {
    for (const cmd of BASE_ALLOWLISTS[`${adapterType}_write`]) base.add(cmd);
  }

  _policies.set(policyId, Object.freeze({
    policyId, adapterType,
    allowedCommands:  base,
    blockedPatterns:  [...blockedPatterns].map(p => (p instanceof RegExp ? p : new RegExp(p, "i"))),
    maxTimeoutMs,
    maxOutputBytes,
    writeAllowed,
    networkAllowed,
    sandboxRoot:      sandboxRoot ?? null,
    metadata:         Object.freeze({ ...metadata }),
    createdAt:        new Date().toISOString(),
  }));

  return { registered: true, policyId, commandCount: base.size };
}

// Evaluate whether an execution is allowed under a policy
function evaluateExecution(policyId, { command, subcommand = null, path = null, timeoutMs = null } = {}) {
  const policy = _policies.get(policyId);
  if (!policy) return { allowed: false, reason: "policy_not_found" };

  // Determine the command to check
  const checkCmd = subcommand ?? (typeof command === "string" ? command.trim().split(/\s+/)[0] : command?.[0]);
  if (!checkCmd) return { allowed: false, reason: "missing_command" };

  // Allowlist check
  if (!policy.allowedCommands.has(checkCmd)) {
    return { allowed: false, reason: `command_not_in_allowlist: ${checkCmd}`, policyId };
  }

  // Global blocked patterns
  const fullCommand = typeof command === "string" ? command : (command ?? []).join(" ");
  for (const pattern of GLOBAL_BLOCKED_PATTERNS) {
    if (pattern.test(fullCommand)) {
      return { allowed: false, reason: "global_blocked_pattern", pattern: pattern.source, policyId };
    }
  }

  // Policy-specific blocked patterns
  for (const pattern of policy.blockedPatterns) {
    if (pattern.test(fullCommand)) {
      return { allowed: false, reason: "policy_blocked_pattern", pattern: pattern.source, policyId };
    }
  }

  // Timeout check
  if (timeoutMs && timeoutMs > policy.maxTimeoutMs) {
    return { allowed: false, reason: `timeout_exceeds_policy: ${timeoutMs} > ${policy.maxTimeoutMs}`, policyId };
  }

  // Path sandbox check
  if (path && policy.sandboxRoot) {
    const nodePath = require("path");
    const resolved = nodePath.resolve(policy.sandboxRoot, path);
    if (!resolved.startsWith(policy.sandboxRoot)) {
      return { allowed: false, reason: "path_outside_sandbox", path, sandboxRoot: policy.sandboxRoot };
    }
  }

  return {
    allowed: true, policyId,
    effectiveTimeoutMs: timeoutMs ?? policy.maxTimeoutMs,
    maxOutputBytes:     policy.maxOutputBytes,
    writeAllowed:       policy.writeAllowed,
    networkAllowed:     policy.networkAllowed,
  };
}

// Quick allowlist check (without full policy evaluation)
function isCommandAllowed(adapterType, command) {
  const base = BASE_ALLOWLISTS[adapterType];
  if (!base) return { allowed: false, reason: "unknown_adapter_type" };
  const cmd = typeof command === "string" ? command.trim().split(/\s+/)[0] : command;
  const allowed = base.has(cmd);
  return { allowed, command: cmd, adapterType };
}

// Check command against global blocked patterns only
function checkGlobalBlocked(command) {
  const full = typeof command === "string" ? command : command.join(" ");
  for (const pattern of GLOBAL_BLOCKED_PATTERNS) {
    if (pattern.test(full)) return { blocked: true, pattern: pattern.source };
  }
  return { blocked: false };
}

function getPolicy(policyId) {
  const p = _policies.get(policyId);
  if (!p) return { found: false };
  return { found: true, policyId: p.policyId, adapterType: p.adapterType,
    commandCount: p.allowedCommands.size, writeAllowed: p.writeAllowed,
    maxTimeoutMs: p.maxTimeoutMs, sandboxRoot: p.sandboxRoot };
}

function listPolicies() {
  return Array.from(_policies.values()).map(p =>
    ({ policyId: p.policyId, adapterType: p.adapterType, commandCount: p.allowedCommands.size }));
}

function removePolicy(policyId) {
  if (!_policies.has(policyId)) return { removed: false, reason: "policy_not_found" };
  _policies.delete(policyId);
  return { removed: true, policyId };
}

function getPolicyMetrics() {
  const byType = {};
  for (const [, p] of _policies) byType[p.adapterType] = (byType[p.adapterType] ?? 0) + 1;
  return { totalPolicies: _policies.size, byAdapterType: byType };
}

function reset() {
  _policies = new Map();
  _counter  = 0;
}

module.exports = {
  registerPolicy, evaluateExecution, isCommandAllowed, checkGlobalBlocked,
  getPolicy, listPolicies, removePolicy, getPolicyMetrics, reset,
  BASE_ALLOWLISTS, DEFAULT_TIMEOUT_MS, MAX_OUTPUT_BYTES,
};
