"use strict";
/**
 * Prompt History — durable log of every orchestrated chat prompt/response
 * pair, for the "prompt history" requirement in the AI Provider Orchestration
 * mission. Nothing in the codebase persisted actual prompt/response text
 * before this — usageMetering.cjs records cost/latency/token metadata per
 * request but deliberately never stores the prompt or response content
 * itself (it's a billing ledger, not a conversation log).
 *
 * Storage: data/prompt-history.ndjson (append-only), same pattern as
 * usageMetering's ledger. Text fields are truncated to MAX_TEXT_LEN to keep
 * the file bounded — this is a history/audit log, not full conversation
 * storage (mission memory / chat transcripts already exist elsewhere for
 * that; this does not duplicate them).
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const HISTORY_FILE = path.join(__dirname, "../../data/prompt-history.ndjson");
const MAX_TEXT_LEN  = 4000; // per field — keeps the ledger bounded, not a transcript store
const BUFFER_MAX    = 500;  // in-memory ring for fast recent-history queries

const _buffer = [];

function _truncate(s) {
  if (typeof s !== "string") return "";
  return s.length > MAX_TEXT_LEN ? s.slice(0, MAX_TEXT_LEN) + `… [+${s.length - MAX_TEXT_LEN} chars truncated]` : s;
}

function _appendFile(record) {
  try {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(record) + "\n");
  } catch (e) { logger.error("[PromptHistory] write failed:", e.message); }
}

/**
 * Record one prompt/response pair.
 */
function record(opts = {}) {
  const entry = {
    id:               `ph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ts:               new Date().toISOString(),
    accountId:        opts.accountId   || "unknown",
    orgId:            opts.orgId       || null,
    workspaceId:      opts.workspaceId || "default",
    capability:       opts.capability  || "chat",
    provider:         opts.provider    || "unknown",
    model:            opts.model       || "unknown",
    prompt:           _truncate(opts.prompt),
    response:         _truncate(opts.response),
    latencyMs:        opts.latencyMs   || 0,
    estimatedCostUsd: opts.estimatedCostUsd || 0,
  };
  _buffer.push(entry);
  if (_buffer.length > BUFFER_MAX) _buffer.shift();
  _appendFile(entry);
  return entry;
}

/**
 * Query recent history from the in-memory ring (fast; last BUFFER_MAX entries).
 */
function query(opts = {}) {
  let entries = [..._buffer];
  if (opts.accountId)   entries = entries.filter(e => e.accountId   === opts.accountId);
  if (opts.orgId)       entries = entries.filter(e => e.orgId       === opts.orgId);
  if (opts.workspaceId) entries = entries.filter(e => e.workspaceId === opts.workspaceId);
  if (opts.provider)    entries = entries.filter(e => e.provider    === opts.provider);
  if (opts.capability)  entries = entries.filter(e => e.capability  === opts.capability);
  if (opts.since)       entries = entries.filter(e => new Date(e.ts) >= new Date(opts.since));
  entries.sort((a, b) => new Date(b.ts) - new Date(a.ts)); // newest first
  return entries.slice(0, opts.limit || 50);
}

/**
 * Full on-disk history (for queries beyond the in-memory ring, or across
 * restarts). Same filters as query().
 */
function loadHistory(opts = {}) {
  let entries;
  try {
    const raw = fs.readFileSync(HISTORY_FILE, "utf8");
    entries = raw.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
  } catch { entries = []; }

  if (opts.accountId)   entries = entries.filter(e => e.accountId   === opts.accountId);
  if (opts.orgId)       entries = entries.filter(e => e.orgId       === opts.orgId);
  if (opts.workspaceId) entries = entries.filter(e => e.workspaceId === opts.workspaceId);
  if (opts.provider)    entries = entries.filter(e => e.provider    === opts.provider);
  if (opts.capability)  entries = entries.filter(e => e.capability  === opts.capability);
  if (opts.since)       entries = entries.filter(e => new Date(e.ts) >= new Date(opts.since));

  entries.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return opts.limit ? entries.slice(0, opts.limit) : entries;
}

module.exports = { record, query, loadHistory };
