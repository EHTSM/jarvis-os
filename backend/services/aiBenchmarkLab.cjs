"use strict";
/**
 * AI Benchmark Lab — compare every provider on speed, quality, cost, reliability.
 *
 * Runs synthetic benchmark tasks against live providers.
 * Stores results in data/benchmark-results.ndjson (append-only).
 * Provides leaderboard and comparison matrix.
 *
 * Reuses: usageMetering for cost tracking.
 */

const fs   = require("fs");
const path = require("path");
const aiRegistry = require("./aiRegistry.cjs");
const metering   = require("./usageMetering.cjs");
const logger     = require("../utils/logger");

const RESULTS_FILE = path.join(__dirname, "../../data/benchmark-results.ndjson");
const CACHE_FILE   = path.join(__dirname, "../../data/benchmark-cache.json");

// ── Benchmark task suite ──────────────────────────────────────────
const BENCHMARK_TASKS = {
  chat: {
    prompt: "Briefly describe a sorting algorithm in one sentence.",
    expectedLen: 20,  // min words expected
  },
  code: {
    prompt: "Write a JavaScript function to reverse a string.",
    expectedLen: 10,
  },
  reasoning: {
    prompt: "If all A are B, and all B are C, are all A also C? Answer yes or no with one reason.",
    expectedLen: 5,
  },
};

function _appendResult(r) {
  try {
    fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
    fs.appendFileSync(RESULTS_FILE, JSON.stringify(r) + "\n");
  } catch { /* non-fatal */ }
}

function _loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); }
  catch { return { runs: {}, lastRun: null }; }
}

function _saveCache(d) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}

function _loadHistory(limit = 500) {
  try {
    const raw = fs.readFileSync(RESULTS_FILE, "utf8");
    return raw.trim().split("\n").filter(Boolean).slice(-limit).map(l => JSON.parse(l));
  } catch { return []; }
}

/**
 * Score a benchmark run result.
 * Returns 0-100 quality score based on response length + success.
 */
function _score(result, taskId) {
  if (!result.success) return 0;
  const words = (result.output || "").split(/\s+/).filter(Boolean).length;
  const minWords = BENCHMARK_TASKS[taskId]?.expectedLen || 5;
  const lengthScore  = Math.min(1, words / minWords);
  return Math.round(lengthScore * 80 + (result.success ? 20 : 0));
}

/**
 * Run a single benchmark task against a provider.
 * Uses aiService for actual calls.
 *
 * Returns: { providerId, taskId, success, latencyMs, output, tokens, costUsd, qualityScore }
 */
async function runTask(providerId, taskId, opts = {}) {
  const task    = BENCHMARK_TASKS[taskId];
  if (!task) throw new Error(`Unknown task: ${taskId}`);

  let aiService;
  try { aiService = require("./aiService"); } catch { aiService = null; }

  const t0     = Date.now();
  let success  = false;
  let output   = "";
  let tokens   = 0;
  let errorMsg = null;

  if (aiService) {
    try {
      const result = await aiService.callAI([{ role: "user", content: task.prompt }], {
        provider: providerId, maxTokens: 200,
      });
      output  = result?.content || result?.text || String(result || "");
      tokens  = result?.usage?.total_tokens || Math.ceil(output.length / 4);
      success = !!output;
    } catch (e) {
      errorMsg = e.message;
    }
  } else {
    // Simulated result when aiService unavailable
    success = true;
    output  = `[simulated] Response for ${taskId} from ${providerId}`;
    tokens  = 50;
  }

  const latencyMs = Date.now() - t0;
  const provider  = aiRegistry.getProvider(providerId);
  const capDef    = provider?.capabilities?.[taskId === "chat" ? "chat" : "code"];
  const costPer1k = capDef?.costPer1k || 0;
  const costUsd   = (tokens / 1000) * costPer1k;
  const qualityScore = _score({ success, output }, taskId);

  const record = {
    id:           `bm-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    ts:           new Date().toISOString(),
    providerId,
    taskId,
    success,
    latencyMs,
    output:       output.slice(0, 200),
    tokens,
    costUsd:      parseFloat(costUsd.toFixed(6)),
    qualityScore,
    errorMsg,
  };

  _appendResult(record);
  if (success) {
    metering.record({ provider: providerId, model: capDef?.models?.[0] || "default",
                      requestType: `benchmark:${taskId}`, inputTokens: tokens * 0.3,
                      outputTokens: tokens * 0.7, latencyMs, estimatedCostUsd: costUsd, success });
  }

  return record;
}

/**
 * Run benchmark suite across all (or specified) providers + tasks.
 * Returns array of results.
 */
async function runSuite(opts = {}) {
  const providers = opts.providers || Object.keys(aiRegistry.BUILTIN).filter(id => id !== "stability" && id !== "elevenlabs" && id !== "playwright");
  const tasks     = opts.tasks    || ["chat","code","reasoning"];

  const results = [];
  for (const providerId of providers) {
    for (const taskId of tasks) {
      if (!BENCHMARK_TASKS[taskId]) continue;
      const r = await runTask(providerId, taskId, opts);
      results.push(r);
    }
  }

  // Cache results
  const cache = _loadCache();
  cache.lastRun = new Date().toISOString();
  for (const r of results) {
    const key = `${r.providerId}:${r.taskId}`;
    if (!cache.runs[key]) cache.runs[key] = [];
    cache.runs[key] = [r, ...cache.runs[key]].slice(0, 20);
  }
  _saveCache(cache);

  return results;
}

/**
 * Build leaderboard from historical results.
 * dimension: "speed" | "quality" | "cost" | "reliability"
 */
function leaderboard(dimension = "quality", taskId = null) {
  const history = _loadHistory(1000);
  const byProvider = {};

  for (const r of history) {
    if (taskId && r.taskId !== taskId) continue;
    const id = r.providerId;
    if (!byProvider[id]) byProvider[id] = { providerId: id, runs: 0, successes: 0, latencies: [], costs: [], qualities: [] };
    const p = byProvider[id];
    p.runs++;
    if (r.success) {
      p.successes++;
      p.latencies.push(r.latencyMs);
      p.costs.push(r.costUsd);
      p.qualities.push(r.qualityScore);
    }
  }

  const entries = Object.values(byProvider).map(p => {
    const reliability = p.runs > 0 ? p.successes / p.runs : 0;
    const avgLatency  = p.latencies.length ? p.latencies.reduce((a,b)=>a+b,0)/p.latencies.length : 0;
    const avgCost     = p.costs.length     ? p.costs.reduce((a,b)=>a+b,0)/p.costs.length         : 0;
    const avgQuality  = p.qualities.length ? p.qualities.reduce((a,b)=>a+b,0)/p.qualities.length  : 0;
    return { ...p, reliability, avgLatency, avgCost, avgQuality,
             score: dimension === "speed"       ? 1 - avgLatency / 10000
                  : dimension === "cost"        ? 1 - avgCost * 1000
                  : dimension === "reliability" ? reliability
                  :                              avgQuality / 100 };
  });

  return entries.sort((a, b) => b.score - a.score);
}

/**
 * Comparison matrix: providers × tasks → scores.
 */
function comparisonMatrix(taskIds = ["chat","code","reasoning"]) {
  const cache  = _loadCache();
  const providers = [...new Set(Object.keys(cache.runs || {}).map(k => k.split(":")[0]))];

  return providers.map(providerId => {
    const row = { providerId };
    for (const taskId of taskIds) {
      const key     = `${providerId}:${taskId}`;
      const runs    = cache.runs?.[key] || [];
      const latest  = runs[0];
      row[taskId]   = latest ? {
        latencyMs:    latest.latencyMs,
        costUsd:      latest.costUsd,
        qualityScore: latest.qualityScore,
        success:      latest.success,
      } : null;
    }
    return row;
  });
}

/**
 * Get cached leaderboard without running new tests.
 */
function getCachedLeaderboard() {
  return {
    speed:       leaderboard("speed"),
    quality:     leaderboard("quality"),
    cost:        leaderboard("cost"),
    reliability: leaderboard("reliability"),
  };
}

module.exports = { runTask, runSuite, leaderboard, comparisonMatrix, getCachedLeaderboard, BENCHMARK_TASKS };
