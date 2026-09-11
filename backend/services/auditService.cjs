"use strict";
/**
 * auditService.cjs — Enterprise & Physical Integration Mission, Module 3.
 *
 * Organization-scoped audit search and composed history views. Pure
 * read-side aggregation — no new logging mechanism, no new storage:
 *
 *   - Immutable audit trail:  backend/utils/auditLog.cjs's existing
 *     append-only NDJSON files (data/logs/audit*.ndjson) — already rotated
 *     at 20MB and retained 30 days. Modules 1/2 and this module's own
 *     instrumentation of organizationService.cjs's permission-mutating
 *     functions all write through auditLog.append()/recordAuth(), the same
 *     single entry point every other subsystem in this codebase uses.
 *   - AI action history:      usageMetering.cjs's real per-request ledger
 *     (data/usage-ledger.ndjson), queried by orgId — already exists, already
 *     org-scoped, already the source orgBudgets.cjs reads for spend caps.
 *   - Billing history:        organizationService.getOrgBillingOverview +
 *     billingService.getRecord — already the canonical per-org billing
 *     snapshot (see Module 5/6 of the Company Factory mission for the
 *     established call pattern).
 *
 * Export: reuses the same in-memory result set search() already built —
 * formats it as NDJSON or CSV, no separate export pipeline.
 */

const fs   = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "../../data/logs");

const _try = fn => { try { return fn(); } catch { return null; } };
const _org = () => _try(() => require("./organizationService.cjs"));
const _usage = () => _try(() => require("./usageMetering.cjs"));

// ── Raw audit-log scanning ─────────────────────────────────────────────────

/** Every audit*.ndjson file (current + rotated). Read order doesn't matter —
 * searchAuditLog sorts the combined result set by ts before truncating. */
function _auditFiles() {
  try {
    return fs.readdirSync(LOG_DIR)
      .filter(f => f === "audit.ndjson" || (f.startsWith("audit.") && f.endsWith(".ndjson")))
      .map(f => path.join(LOG_DIR, f));
  } catch { return []; }
}

/**
 * Scan every audit log file and return entries matching the given filters.
 * Bounded by maxScan (lines read per file) to keep this a real, finite
 * operation even against the full rotated history — mirrors
 * usageMetering.loadHistory's own bounded-read pattern.
 *
 * opts: { orgId, type, typePrefix, actorId, accountId, since, until, limit, maxScanPerFile }
 */
function searchAuditLog(opts = {}) {
  const { orgId, type, typePrefix, actorId, accountId, since, until, limit = 200, maxScanPerFile = 50_000 } = opts;
  const sinceMs = since ? new Date(since).getTime() : null;
  const untilMs = until ? new Date(until).getTime() : null;

  const results = [];
  for (const file of _auditFiles()) {
    let lines;
    try { lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean); }
    catch { continue; }
    const scanSlice = lines.slice(-maxScanPerFile);
    for (const line of scanSlice) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }

      if (orgId && entry.orgId !== orgId) continue;
      if (type && entry.type !== type) continue;
      if (typePrefix && !(entry.type || "").startsWith(typePrefix)) continue;
      if (actorId && entry.actorId !== actorId && entry.operator !== actorId) continue;
      if (accountId && entry.accountId !== accountId && entry.targetAccountId !== accountId) continue;
      if (sinceMs && new Date(entry.ts).getTime() < sinceMs) continue;
      if (untilMs && new Date(entry.ts).getTime() > untilMs) continue;

      results.push(entry);
    }
  }

  // Sort newest-first by ts, with seq as a tiebreaker — auditLog.cjs's ts has
  // only millisecond resolution, so multiple events from the same request
  // (e.g. organizationService's addMember + updateMemberRole calls in quick
  // succession) commonly land in the same millisecond; seq is a per-process
  // monotonic counter that preserves true write order within that tie.
  results.sort((a, b) => {
    const tsDiff = new Date(b.ts || 0) - new Date(a.ts || 0);
    if (tsDiff !== 0) return tsDiff;
    return (b.seq || 0) - (a.seq || 0);
  });
  return { entries: results.slice(0, limit), total: results.length, truncated: results.length > limit };
}

// ── Composed history views ──────────────────────────────────────────────────

function getLoginHistory(orgId, opts = {}) {
  return searchAuditLog({ orgId, typePrefix: "login", limit: opts.limit || 100, since: opts.since, until: opts.until });
}

function getSsoLoginHistory(orgId, opts = {}) {
  return searchAuditLog({ orgId, typePrefix: "sso.login", limit: opts.limit || 100, since: opts.since, until: opts.until });
}

function getPermissionHistory(orgId, opts = {}) {
  return searchAuditLog({ orgId, typePrefix: "permission.", limit: opts.limit || 100, since: opts.since, until: opts.until });
}

function getScimHistory(orgId, opts = {}) {
  return searchAuditLog({ orgId, typePrefix: "scim.", limit: opts.limit || 100, since: opts.since, until: opts.until });
}

/** Real AI usage ledger, not a copy — orgBudgets.cjs reads the exact same
 * source for spend enforcement. */
function getAiActionHistory(orgId, opts = {}) {
  const events = _usage()?.queryFromLedger?.({ orgId, since: opts.since, limit: opts.limit || 200 }) || [];
  return { entries: events, total: events.length };
}

/** Real per-org billing snapshot (subscription/quota state per member) via
 * the existing getOrgBillingOverview aggregation — billingService.js has no
 * change-event log of its own, only current state, so "history" here means
 * the current, real, org-wide billing snapshot rather than a fabricated
 * event stream. */
function getBillingHistory(orgId, requestingAccountId) {
  const overview = _org()?.getOrgBillingOverview?.(orgId, requestingAccountId);
  return { overview };
}

// ── Export ───────────────────────────────────────────────────────────────────

function _toCsv(entries) {
  if (!entries.length) return "ts,type,orgId,actorId,accountId,detail\n";
  const cols = ["ts", "type", "orgId", "actorId", "accountId", "targetAccountId"];
  const header = cols.join(",") + ",detail\n";
  const rows = entries.map(e => {
    const known = cols.map(c => JSON.stringify(e[c] ?? ""));
    const rest = Object.fromEntries(Object.entries(e).filter(([k]) => !cols.includes(k) && k !== "ts"));
    return [...known, JSON.stringify(JSON.stringify(rest))].join(",");
  });
  return header + rows.join("\n") + "\n";
}

/** format: "ndjson" | "csv" */
function exportAuditLog(orgId, opts = {}) {
  const { entries } = searchAuditLog({ orgId, ...opts, limit: opts.limit || 10_000 });
  if (opts.format === "csv") return { format: "csv", body: _toCsv(entries), count: entries.length };
  return { format: "ndjson", body: entries.map(e => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : ""), count: entries.length };
}

module.exports = {
  searchAuditLog,
  getLoginHistory,
  getSsoLoginHistory,
  getPermissionHistory,
  getScimHistory,
  getAiActionHistory,
  getBillingHistory,
  exportAuditLog,
};
