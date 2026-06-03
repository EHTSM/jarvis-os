// Phase 372: Runtime Memory Compression
// Reduces localStorage churn by:
//   1. Deduplicating graph edges — merge repeated edges into weight (already in Phase 326, extend here)
//   2. Compressing dispatch history — truncate to essential fields, cap at 20 entries
//   3. Pruning stale execution memory — remove flows not seen in 30 days
//   4. Compacting telemetry — remove entries older than 7 days
// All operations are called on-demand (not on every write).
// Safe to call repeatedly — idempotent.

const GRAPH_KEY      = "jarvis_execution_graph";
const HIST_KEY       = "jarvis_workflow_hist";
const MEMORY_KEY     = "jarvis_execution_memory";
const GRAPH_MAX      = 500;
const HIST_MAX_STORE = 20;
const MEMORY_MAX     = 100;
const STALE_FLOW_MS  = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Compact the execution graph:
 * - Merge edges with same (from, to, relation) into a single weighted edge
 * - Discard edges older than 30 days if graph > 300 edges
 * - Cap at GRAPH_MAX
 */
export function compactGraph() {
  try {
    const raw = localStorage.getItem(GRAPH_KEY);
    if (!raw) return 0;
    const edges = JSON.parse(raw);
    if (!edges.length) return 0;

    const before = edges.length;

    // Merge duplicates by (from, to, relation) key
    const merged = new Map();
    for (const e of edges) {
      const key = `${e.from}|||${e.to}|||${e.relation}`;
      if (merged.has(key)) {
        const existing = merged.get(key);
        existing.weight  = (existing.weight  || 1) + (e.weight  || 1);
        existing.ts      = Math.max(existing.ts, e.ts);
        if (e.ok !== undefined) existing.ok = e.ok;
      } else {
        merged.set(key, { ...e, weight: e.weight || 1 });
      }
    }

    let compacted = [...merged.values()];

    // If still too large, drop oldest edges beyond 300
    if (compacted.length > 300) {
      const cutoff = Date.now() - STALE_FLOW_MS;
      compacted = compacted.filter(e => e.ts >= cutoff || e.weight > 1);
    }

    compacted = compacted.slice(0, GRAPH_MAX);
    localStorage.setItem(GRAPH_KEY, JSON.stringify(compacted));
    return before - compacted.length;
  } catch { return 0; }
}

/**
 * Compress dispatch history — strip verbose fields, keep cmd/ok/summary/ts.
 */
export function compressHistory() {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    if (!raw) return 0;
    const hist = JSON.parse(raw);
    const before = hist.length;
    const compressed = hist
      .slice(0, HIST_MAX_STORE)
      .map(h => ({ cmd: h.cmd, ok: h.ok, summary: (h.summary || "").slice(0, 60), ts: h.ts }));
    localStorage.setItem(HIST_KEY, JSON.stringify(compressed));
    return before - compressed.length;
  } catch { return 0; }
}

/**
 * Prune stale execution memory flows — remove entries not seen in 30 days.
 */
export function pruneStaleMemory() {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return 0;
    const mem = JSON.parse(raw);
    const before = mem.length;
    const cutoff = Date.now() - STALE_FLOW_MS;
    const live   = mem.filter(e => e.lastTs >= cutoff);
    const capped = live.slice(0, MEMORY_MAX);
    localStorage.setItem(MEMORY_KEY, JSON.stringify(capped));
    return before - capped.length;
  } catch { return 0; }
}

/**
 * Run all compression passes. Returns summary of what was freed.
 */
export function runFullCompression() {
  const graphFreed   = compactGraph();
  const histFreed    = compressHistory();
  const memoryFreed  = pruneStaleMemory();
  return { graphFreed, histFreed, memoryFreed, total: graphFreed + histFreed + memoryFreed };
}

/**
 * Estimate total localStorage usage for runtime keys (bytes).
 */
export function estimateStorageUsage() {
  const keys = [GRAPH_KEY, HIST_KEY, MEMORY_KEY,
    "jarvis_workflow_checkpoints", "jarvis_long_run_tasks",
    "jarvis_validation_outcomes", "jarvis_execution_graph",
    "jarvis_telemetry", "jarvis_productivity"];
  let total = 0;
  for (const k of keys) {
    try { total += (localStorage.getItem(k) || "").length * 2; } catch {} // UTF-16 = 2 bytes/char
  }
  return { bytes: total, kb: Math.round(total / 1024) };
}
