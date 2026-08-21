"use strict";
/**
 * Gates a real git/fs operation's `cwd` to operator-only callers, and (as
 * defense in depth for that operator caller) rejects a handful of
 * always-sensitive absolute directories. Client-supplied `cwd` values reach
 * execSync({cwd}) and repo-walking file scanners across the coding-
 * assistant route family (codingAssistant.js, codingBundle.js,
 * codingDecisions.js) — this is the shared choke point for all three.
 *
 * Command Injection & Process Execution Deep Security Sweep (2026-08-21):
 * live-reproduced, an ordinary `requireAuth`-only customer could point
 * `cwd` at ANY real git repository elsewhere on the host (not just a
 * handful of system roots — any directory readable by the server process)
 * and have its commit log / diff / full file-content-derived "smells"
 * returned — either embedded in an AI prompt or, for GET /coding/context
 * and GET /coding/smells, directly in the HTTP response with no AI
 * round-trip required. There is no existing per-customer workspace-root
 * concept to scope `cwd` to, and the underlying feature (open a real local
 * project folder in the desktop IDE) is legitimate — so rather than
 * inventing a new workspace-boundary system, this reuses the codebase's
 * established operatorOnly role gate: `cwd` now only functions for the
 * operator account. An ordinary customer's request with a `cwd` is treated
 * as if no `cwd` were supplied (falls back to the server's own repo root),
 * not rejected outright, since most of these routes work fine without one.
 */
const path = require("path");
const os   = require("os");

const SENSITIVE_ROOTS = ["/", "/etc", "/root", "/var", "/System", "/private", "/usr", "/bin", "/sbin"];

function safeCwd(cwd, req) {
  if (!cwd) return cwd;
  if (req?.user?.role !== "operator") return null;
  const resolved = path.resolve(String(cwd));
  if (resolved === os.homedir()) return null; // the bare home directory itself, not a project folder inside it
  if (SENSITIVE_ROOTS.includes(resolved)) return null;
  return cwd;
}

module.exports = { safeCwd };
