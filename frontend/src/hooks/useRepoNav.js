// Phase 781: Repo navigation acceleration — lightweight local file/symbol index.
// Builds from execution history (file paths extracted from commands) and a small
// set of well-known project files. No filesystem access — purely from what the
// operator has actually touched. Bounded: max 200 entries, 24h TTL.

import { useState, useEffect, useCallback, useMemo } from "react";

const INDEX_KEY    = "jarvis_repo_nav_index";
const INDEX_MAX    = 200;
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;
const HIST_KEY     = "jarvis_workflow_hist";

// Known project anchors — always present regardless of history
const ANCHORS = [
  { path: "backend/server.js",          desc: "Backend entry point — Express routes + startup sequence" },
  { path: "backend/routes/runtime.js",  desc: "Runtime dispatch, queue, status, emergency routes" },
  { path: "backend/routes/index.js",    desc: "Route mounting — auth gating for /runtime/*" },
  { path: "agents/runtime/runtimeOrchestrator.cjs", desc: "Core task routing + execution engine" },
  { path: "agents/runtime/executionEngine.cjs",     desc: "Task execution loop + retry logic" },
  { path: "agents/runtime/executionHistory.cjs",    desc: "SQLite-backed execution history" },
  { path: "agents/runtime/runtimeEventBus.cjs",     desc: "SSE event emit + flood guard" },
  { path: "agents/runtime/bootstrapRuntime.cjs",    desc: "Agent registration at startup" },
  { path: "agents/runtime/deadLetterQueue.cjs",     desc: "Failed task DLQ — inspect for silent failures" },
  { path: "agents/taskQueue.cjs",                   desc: "JSON-backed task queue + stale recovery" },
  { path: "ecosystem.config.cjs",                   desc: "PM2 config — memory limits, restart policy" },
  { path: "backend/db/sqlite.cjs",                  desc: "SQLite singleton — WAL mode, schema migrations" },
  { path: "frontend/src/hooks/useRuntimeStream.js", desc: "SSE + polling hook — history, ops, tasks" },
  { path: "frontend/src/components/operator/WorkflowPanel.jsx",  desc: "Main dispatch panel — macros, chains, history" },
  { path: "frontend/src/components/operator/ExecLogPanel.jsx",   desc: "Execution log + retry + filter" },
  { path: "frontend/src/components/operator/GovernorPanel.jsx",  desc: "Emergency stop / resume / safe reboot" },
  { path: "frontend/src/api.js",   desc: "API barrel — all domain exports" },
  { path: "frontend/src/_client.js", desc: "Shared fetch client + execution tracking" },
  { path: "data/task-queue.json", desc: "Persisted task queue — check if corrupt after crashes" },
  { path: "data/jarvis.db",       desc: "SQLite database — execution history + task records" },
  { path: "logs/",                desc: "PM2 log directory — out + err logs" },
  { path: "RUNTIME_MAP.md",       desc: "Canonical runtime dependency map — all routes + agents" },
  { path: ".env",                 desc: "Environment variables — JWT_SECRET, GROQ_API_KEY, ports" },
];

// Extract file paths from a command string
function _extractPaths(cmd) {
  if (!cmd) return [];
  const paths = [];
  // Match file-like tokens: contains / or . with extension
  const tokens = cmd.split(/\s+/);
  for (const t of tokens) {
    if (/[./]/.test(t) && !/^-/.test(t) && t.length > 3) {
      // Normalize: strip leading ./
      const clean = t.replace(/^\.\//, "");
      if (clean.length > 3 && !clean.startsWith("http")) paths.push(clean);
    }
  }
  return paths;
}

// Load persisted index, pruning stale entries
function _loadIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw);
    const cutoff = Date.now() - INDEX_TTL_MS;
    return all.filter(e => !e.lastSeen || e.lastSeen > cutoff);
  } catch { return []; }
}

function _saveIndex(entries) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries.slice(0, INDEX_MAX)));
  } catch {}
}

// Build index from execution history — called once on mount
function _buildFromHistory() {
  try {
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    const seen = new Map(); // path → { count, lastSeen, fromCmd }

    for (const h of hist) {
      const paths = _extractPaths(h.cmd || "");
      for (const p of paths) {
        const existing = seen.get(p);
        if (existing) {
          existing.count++;
          if ((h.ts || 0) > existing.lastSeen) existing.lastSeen = h.ts || Date.now();
        } else {
          seen.set(p, { path: p, count: 1, lastSeen: h.ts || Date.now(), source: "history" });
        }
      }
    }

    return [...seen.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, INDEX_MAX - ANCHORS.length);
  } catch { return []; }
}

// Search the index — supports `file:` prefix and free text
export function searchRepoIndex(query, index) {
  if (!query || !index) return [];
  const q = query.replace(/^file:/i, "").toLowerCase().trim();
  if (!q) return [];

  const results = [];

  // Anchors first
  for (const a of ANCHORS) {
    if (a.path.toLowerCase().includes(q) || a.desc.toLowerCase().includes(q)) {
      results.push({ ...a, source: "anchor", score: 100 });
    }
  }

  // History index
  for (const e of index) {
    if (e.path.toLowerCase().includes(q)) {
      results.push({ path: e.path, desc: `Seen ${e.count}× in history`, source: "history", score: 50 + e.count });
    }
  }

  // Deduplicate by path (anchor wins over history)
  const seen = new Set();
  return results
    .filter(r => { if (seen.has(r.path)) return false; seen.add(r.path); return true; })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

export function useRepoNav() {
  const [index, setIndex] = useState(() => _loadIndex());

  // Rebuild from history on mount
  useEffect(() => {
    const fresh = _buildFromHistory();
    const existing = _loadIndex();

    // Merge: existing entries are authoritative for anchor paths
    const merged = new Map(existing.map(e => [e.path, e]));
    for (const e of fresh) {
      if (!merged.has(e.path)) merged.set(e.path, e);
      else {
        const ex = merged.get(e.path);
        merged.set(e.path, { ...ex, count: Math.max(ex.count || 0, e.count || 0) });
      }
    }

    const result = [...merged.values()].slice(0, INDEX_MAX);
    _saveIndex(result);
    setIndex(result);
  }, []);

  // Record a file access from a dispatched command
  const recordAccess = useCallback((cmd) => {
    if (!cmd) return;
    const paths = _extractPaths(cmd);
    if (!paths.length) return;

    setIndex(prev => {
      const map = new Map(prev.map(e => [e.path, e]));
      for (const p of paths) {
        const ex = map.get(p);
        if (ex) map.set(p, { ...ex, count: ex.count + 1, lastSeen: Date.now() });
        else map.set(p, { path: p, count: 1, lastSeen: Date.now(), source: "history" });
      }
      const updated = [...map.values()].slice(0, INDEX_MAX);
      _saveIndex(updated);
      return updated;
    });
  }, []);

  const search = useCallback((query) => searchRepoIndex(query, index), [index]);

  // Recent files — most recently accessed, not anchors
  const recentFiles = useMemo(() => {
    return index
      .filter(e => e.source === "history" && e.lastSeen)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, 6)
      .map(e => ({ path: e.path, count: e.count }));
  }, [index]);

  return { index, search, recordAccess, recentFiles };
}
