"use strict";
/**
 * metricsStore — persistent operational metrics.
 *
 * Appends time-series snapshots to data/metrics/ every FLUSH_MS.
 * Each file is one day's NDJSON. Files older than RETAIN_DAYS are pruned.
 *
 * Tracks: drift, reconnects, queue pressure, crash frequency.
 * Read by /runtime/burnin and the operator health dashboard.
 */

const fs   = require("fs");
const path = require("path");

const METRICS_DIR  = path.join(__dirname, "../../data/metrics");
const FLUSH_MS     = 5 * 60_000;   // flush every 5 min
const RETAIN_DAYS  = 7;
const MAX_SNAP_KB  = 500;          // max size per snapshot entry (bytes)

let _ref = null;
let _pending = [];   // in-memory buffer between flushes

function _todayFile() {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  return path.join(METRICS_DIR, `metrics_${stamp}.ndjson`);
}

function _prune() {
  try {
    const cutoff = Date.now() - RETAIN_DAYS * 86_400_000;
    for (const f of fs.readdirSync(METRICS_DIR)) {
      if (!f.startsWith("metrics_") || !f.endsWith(".ndjson")) continue;
      const full = path.join(METRICS_DIR, f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch {}
}

let _flushing = false;
function _flush() {
  if (_pending.length === 0 || _flushing) return;
  _flushing = true;
  try { fs.mkdirSync(METRICS_DIR, { recursive: true }); } catch {}
  const file  = _todayFile();
  const lines = _pending.map(s => JSON.stringify(s)).join("\n") + "\n";
  _pending = [];
  fs.appendFile(file, lines, "utf8", (err) => {
    _flushing = false;
    if (err) return; // non-fatal — next flush will retry
    _prune();
  });
}

function _snapshot() {
  const snap = { ts: Date.now() };

  // Drift
  try {
    snap.drift = require("./driftMonitor.cjs").getDriftReport();
  } catch {}

  // Burn-in / reconnects / SSE
  try {
    const bus = require("./runtimeEventBus.cjs");
    const bi  = bus.getBurnInMetrics?.();
    if (bi) {
      snap.reconnectsTotal    = bi.totalReconnects;
      snap.sseFloodSuppressed = bi.sseFloodSuppressed;
      snap.totalEventsEmitted = bi.totalEmitted;
      snap.heapDriftMb        = bi.heapDriftMb;
    }
    snap.degraded = bus.isDegraded?.() ?? false;
  } catch {}

  // Queue pressure
  try {
    const pq = require("./priorityQueue.cjs");
    snap.queueDepth = pq.size();
  } catch {}

  // Governor
  try {
    const orch = require("./runtimeOrchestrator.cjs");
    const st   = orch.status?.();
    snap.throttleLevel = st?.throttle?.level ?? "unknown";
    snap.execActive    = st?.governor?.active ?? null;
    snap.ratePerMin    = st?.throttle?.ratePerMin ?? null;
  } catch {}

  // Crash count from data dir
  try {
    const crashDir = path.join(__dirname, "../../data/crashes");
    snap.crashFiles = fs.existsSync(crashDir)
      ? fs.readdirSync(crashDir).filter(f => f.endsWith(".json")).length
      : 0;
  } catch {}

  // Memory
  const m = process.memoryUsage();
  snap.heapMb = +(m.heapUsed / 1_048_576).toFixed(1);
  snap.rssMb  = +(m.rss      / 1_048_576).toFixed(1);

  _pending.push(snap);
  _flush();
}

function start() {
  if (_ref) return;
  _prune(); // prune stale shards on startup so old files don't linger between restarts
  _ref = setInterval(_snapshot, FLUSH_MS);
  _ref.unref();
  // Take first snapshot after 30s (let runtime settle)
  setTimeout(_snapshot, 30_000).unref();
}

function stop() {
  if (_ref) { clearInterval(_ref); _ref = null; }
  _flush();
}

/**
 * Read last N snapshots from today's file (newest first).
 */
function recent(n = 50) {
  try {
    const text  = fs.readFileSync(_todayFile(), "utf8");
    const lines = text.split("\n").filter(Boolean);
    return lines
      .slice(-Math.min(n, 500))
      .reverse()
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

/**
 * List available metric files (date strings).
 */
function availableDates() {
  try {
    return fs.readdirSync(METRICS_DIR)
      .filter(f => f.startsWith("metrics_") && f.endsWith(".ndjson"))
      .map(f => f.replace("metrics_", "").replace(".ndjson", ""))
      .sort().reverse();
  } catch { return []; }
}

module.exports = { start, stop, recent, availableDates };
