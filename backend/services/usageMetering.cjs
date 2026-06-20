"use strict";
/**
 * Usage Metering — records every AI request with full attribution.
 *
 * Each event: model, provider, tokens, latency, estimated cost,
 *             credits consumed, mission, workspace, accountId, ts.
 *
 * Storage: data/usage-ledger.ndjson (append-only) + in-memory ring buffer.
 * Aggregates on demand for analytics queries.
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const LEDGER_FILE  = path.join(__dirname, "../../data/usage-ledger.ndjson");
const BUFFER_MAX   = 2000; // in-memory ring

// ── Provider cost table (USD per 1K tokens, input / output) ──────
const PROVIDER_COSTS = {
  groq:        { input: 0.0001,  output: 0.0001  },
  openrouter:  { input: 0.0008,  output: 0.0008  },
  claude:      { input: 0.003,   output: 0.015   },
  openai:      { input: 0.0015,  output: 0.006   },
  gemini:      { input: 0.00025, output: 0.0005  },
  ollama:      { input: 0,       output: 0        },
};

const _buffer = [];

function _estimateCost(provider, inputTokens = 0, outputTokens = 0) {
  const p = PROVIDER_COSTS[provider] || { input: 0.002, output: 0.002 };
  return (inputTokens * p.input + outputTokens * p.output) / 1000;
}

function _appendFile(record) {
  try {
    fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
    fs.appendFileSync(LEDGER_FILE, JSON.stringify(record) + "\n");
  } catch (e) { logger.error("[UsageMetering] write failed:", e.message); }
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Record a completed AI request.
 */
function record(opts = {}) {
  const inputTokens  = opts.inputTokens  || opts.promptTokens   || 0;
  const outputTokens = opts.outputTokens || opts.completionTokens || 0;
  const estimatedCostUsd = opts.estimatedCostUsd ??
    _estimateCost(opts.provider || "groq", inputTokens, outputTokens);

  const event = {
    id:               `um-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ts:               new Date().toISOString(),
    accountId:        opts.accountId     || "unknown",
    workspaceId:      opts.workspaceId   || "default",
    missionId:        opts.missionId     || null,
    provider:         opts.provider      || "unknown",
    model:            opts.model         || "unknown",
    requestType:      opts.requestType   || "chat",
    inputTokens,
    outputTokens,
    totalTokens:      inputTokens + outputTokens,
    latencyMs:        opts.latencyMs     || 0,
    estimatedCostUsd: parseFloat(estimatedCostUsd.toFixed(6)),
    creditsConsumed:  opts.creditsConsumed || 0,
    creditType:       opts.creditType    || "free",
    success:          opts.success !== false,
    errorCode:        opts.errorCode     || null,
  };

  // In-memory ring buffer
  _buffer.push(event);
  if (_buffer.length > BUFFER_MAX) _buffer.shift();

  // Append to ndjson
  _appendFile(event);
  return event;
}

/**
 * Query events from buffer (fast, in-memory, last BUFFER_MAX events).
 */
function query(opts = {}) {
  let events = [..._buffer];
  if (opts.accountId)   events = events.filter(e => e.accountId   === opts.accountId);
  if (opts.workspaceId) events = events.filter(e => e.workspaceId === opts.workspaceId);
  if (opts.missionId)   events = events.filter(e => e.missionId   === opts.missionId);
  if (opts.provider)    events = events.filter(e => e.provider     === opts.provider);
  if (opts.since)       events = events.filter(e => new Date(e.ts) >= new Date(opts.since));
  return events.slice(-(opts.limit || 100));
}

/**
 * Aggregate cost by dimension.
 * dimension: "provider" | "accountId" | "workspaceId" | "missionId" | "model"
 */
function aggregateCost(dimension = "provider", opts = {}) {
  const events = query(opts);
  const agg = {};
  for (const e of events) {
    const key = e[dimension] || "unknown";
    if (!agg[key]) agg[key] = { key, requests: 0, tokens: 0, costUsd: 0, credits: 0, errors: 0 };
    agg[key].requests++;
    agg[key].tokens   += e.totalTokens;
    agg[key].costUsd  += e.estimatedCostUsd;
    agg[key].credits  += e.creditsConsumed;
    if (!e.success) agg[key].errors++;
  }
  return Object.values(agg).sort((a, b) => b.costUsd - a.costUsd);
}

/**
 * Summary statistics for a period.
 */
function summary(opts = {}) {
  const events = query(opts);
  const totalCostUsd = events.reduce((s, e) => s + e.estimatedCostUsd, 0);
  const totalTokens  = events.reduce((s, e) => s + e.totalTokens, 0);
  const totalCredits = events.reduce((s, e) => s + e.creditsConsumed, 0);
  const errors       = events.filter(e => !e.success).length;
  const latencies    = events.filter(e => e.latencyMs > 0).map(e => e.latencyMs).sort((a,b)=>a-b);
  const p50          = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95          = latencies[Math.floor(latencies.length * 0.95)] || 0;
  return {
    totalRequests: events.length,
    totalTokens,
    totalCostUsd:  parseFloat(totalCostUsd.toFixed(4)),
    totalCredits,
    errors,
    successRate:   events.length ? (1 - errors / events.length) : 1,
    avgLatencyMs:  latencies.length ? Math.round(latencies.reduce((s,v) => s+v,0) / latencies.length) : 0,
    p50LatencyMs:  p50,
    p95LatencyMs:  p95,
    byProvider:    aggregateCost("provider", opts),
  };
}

/**
 * Load from ndjson file (for full history queries).
 */
function loadHistory(limit = 1000) {
  try {
    const raw = fs.readFileSync(LEDGER_FILE, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map(l => JSON.parse(l)).reverse();
  } catch { return []; }
}

module.exports = { record, query, aggregateCost, summary, loadHistory, PROVIDER_COSTS };
