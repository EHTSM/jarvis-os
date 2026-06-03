// Phase 262: Execution graph intelligence.
// Persists execution relationships, maps retry dependencies, provides lineage queries.
// Graph is a directed adjacency list stored in localStorage. No external calls.

const GRAPH_KEY = "jarvis_execution_graph";
const GRAPH_MAX = 500; // max edges

// Edge schema: { from, to, relation, ts, ok, retries? }
// Relations: "followed_by" | "retried_as" | "fallback_for" | "dependency_of"

function _loadGraph() {
  try { return JSON.parse(localStorage.getItem(GRAPH_KEY) || "[]"); }
  catch { return []; }
}

// Phase 345: debounced write — coalesces rapid multi-step workflow edge recording
let _graphSaveTimer = null;
function _saveGraph(edges) {
  clearTimeout(_graphSaveTimer);
  _graphSaveTimer = setTimeout(() => {
    try { localStorage.setItem(GRAPH_KEY, JSON.stringify(edges.slice(0, GRAPH_MAX))); } catch {}
  }, 250);
}

// Phase 262: record an execution relationship edge
export function recordEdge(from, to, relation = "followed_by", meta = {}) {
  try {
    const edges = _loadGraph();
    edges.unshift({ from, to, relation, ts: Date.now(), ...meta });
    _saveGraph(edges);
  } catch {}
}

// Phase 262: get all commands that directly follow `cmd` (adjacency)
export function getSuccessors(cmd) {
  try {
    return _loadGraph()
      .filter(e => e.from === cmd && e.relation === "followed_by")
      .reduce((acc, e) => {
        const existing = acc.find(a => a.cmd === e.to);
        if (existing) { existing.count++; existing.lastTs = Math.max(existing.lastTs, e.ts); }
        else acc.push({ cmd: e.to, count: 1, lastTs: e.ts, ok: e.ok });
        return acc;
      }, [])
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  } catch { return []; }
}

// Phase 262: get retry lineage — what commands were used as retries/fallbacks for `cmd`
export function getRetryLineage(cmd) {
  try {
    return _loadGraph()
      .filter(e => e.from === cmd && (e.relation === "retried_as" || e.relation === "fallback_for"))
      .map(e => ({ cmd: e.to, relation: e.relation, ts: e.ts }));
  } catch { return []; }
}

// Phase 262: get full execution lineage — all ancestors of `cmd`
export function getLineage(cmd, depth = 3) {
  try {
    const edges = _loadGraph();
    const visited = new Set();
    const result = [];
    let frontier = [cmd];

    for (let d = 0; d < depth; d++) {
      const next = [];
      for (const c of frontier) {
        if (visited.has(c)) continue;
        visited.add(c);
        const parents = edges.filter(e => e.to === c && e.relation === "followed_by").map(e => e.from);
        parents.forEach(p => { if (!visited.has(p)) { result.push({ cmd: p, depth: d + 1 }); next.push(p); } });
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return result;
  } catch { return []; }
}

// Phase 262: get most common execution sequences (2-step chains observed in history)
export function getCommonSequences(limit = 5) {
  try {
    const seqMap = {};
    const edges = _loadGraph().filter(e => e.relation === "followed_by" && e.ok !== false);
    edges.forEach(e => {
      const key = `${e.from} → ${e.to}`;
      seqMap[key] = (seqMap[key] || 0) + 1;
    });
    return Object.entries(seqMap)
      .sort(([,a],[,b]) => b - a)
      .slice(0, limit)
      .map(([seq, count]) => ({ seq, count, parts: seq.split(" → ") }));
  } catch { return []; }
}

// Phase 326: detect recurring operational loops — sequences that cycle repeatedly
// Returns top recurring loops (A → B → A patterns) with cycle count
export function detectRecurringLoops(limit = 3) {
  try {
    const edges = _loadGraph().filter(e => e.relation === "followed_by");
    // Find edges that form a back-edge (B → A where A → B also exists)
    const forward = new Set(edges.map(e => `${e.from}|||${e.to}`));
    const loopMap = {};
    edges.forEach(e => {
      const backKey = `${e.to}|||${e.from}`;
      if (forward.has(backKey)) {
        const loopKey = [e.from, e.to].sort().join(" ↔ ");
        loopMap[loopKey] = (loopMap[loopKey] || 0) + 1;
      }
    });
    return Object.entries(loopMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([loop, count]) => ({ loop, count, suggestion: "Consider combining into a single workflow step" }));
  } catch { return []; }
}

// Phase 326: strengthen edge recording — increment weight on repeated edges rather than duplicating
export function recordEdgeWeighted(from, to, relation = "followed_by", meta = {}) {
  try {
    const edges = _loadGraph();
    const existing = edges.find(e => e.from === from && e.to === to && e.relation === relation);
    if (existing) {
      existing.weight = (existing.weight || 1) + 1;
      existing.ts = Date.now();
      Object.assign(existing, meta);
    } else {
      edges.unshift({ from, to, relation, ts: Date.now(), weight: 1, ...meta });
    }
    _saveGraph(edges);
  } catch {}
}

// Phase 322: workflow continuation — predict the most likely next steps given last N commands
// Combines graph successors with frequency data for ranked continuation suggestions
export function getWorkflowContinuation(recentCmds = [], limit = 3) {
  if (!recentCmds.length) return [];
  try {
    const lastCmd = recentCmds[0];
    const successors = getSuccessors(lastCmd);

    // Exclude commands that were just run (last 3)
    const recentSet = new Set(recentCmds.slice(0, 3));

    const candidates = successors
      .filter(s => !recentSet.has(s.cmd))
      .map(s => ({
        cmd: s.cmd,
        score: s.count * (s.ok !== false ? 1.2 : 0.6), // penalize historically failing successors
        source: "graph",
        label: s.cmd.length > 55 ? s.cmd.slice(0, 52) + "…" : s.cmd,
      }));

    // Supplement with common sequences if not enough graph candidates
    if (candidates.length < limit) {
      const common = getCommonSequences(10);
      for (const seq of common) {
        if (seq.parts[0] === lastCmd && !recentSet.has(seq.parts[1]) && !candidates.find(c => c.cmd === seq.parts[1])) {
          candidates.push({
            cmd: seq.parts[1], score: seq.count * 0.8, source: "sequence",
            label: seq.parts[1].length > 55 ? seq.parts[1].slice(0, 52) + "…" : seq.parts[1],
          });
        }
      }
    }

    return candidates.sort((a, b) => b.score - a.score).slice(0, limit);
  } catch { return []; }
}

// Phase 322: detect incomplete operational sequence — multi-step workflows that were started but not finished
export function detectIncompleteSequence(recentCmds = []) {
  if (recentCmds.length < 2) return null;
  try {
    // Pattern: lint → (build missing) | build → (restart missing) | test → (push missing)
    const EXPECTED_FOLLOW = [
      { trigger: /npm run lint/i,    expected: /npm run build/i,          suggestion: "npm run build" },
      { trigger: /npm run build/i,   expected: /pm2 restart/i,            suggestion: "pm2 restart jarvis-backend" },
      { trigger: /npm test/i,        expected: /git push/i,               suggestion: "git push" },
      { trigger: /git pull/i,        expected: /npm install/i,            suggestion: "npm install" },
      { trigger: /npm install/i,     expected: /npm run build|npm test/i, suggestion: "npm run build" },
    ];

    for (const { trigger, expected, suggestion } of EXPECTED_FOLLOW) {
      const hasTriggered = recentCmds.slice(0, 6).some(c => trigger.test(c));
      if (!hasTriggered) continue;
      const hasCompleted = recentCmds.slice(0, 6).some(c => expected.test(c));
      if (!hasCompleted) return { suggestion, reason: "Detected incomplete workflow sequence" };
    }
    return null;
  } catch { return null; }
}

// Phase 362: Validation outcome store — records post-execution verification results
// Stored separately from edges to avoid polluting graph traversal.
const VALIDATION_KEY = "jarvis_validation_outcomes";
const VALIDATION_MAX = 200;

function _loadValidations() {
  try { return JSON.parse(localStorage.getItem(VALIDATION_KEY) || "[]"); }
  catch { return []; }
}

let _validationSaveTimer = null;
function _saveValidations(entries) {
  clearTimeout(_validationSaveTimer);
  _validationSaveTimer = setTimeout(() => {
    try { localStorage.setItem(VALIDATION_KEY, JSON.stringify(entries.slice(0, VALIDATION_MAX))); } catch {}
  }, 250);
}

// Record a post-execution verification result for a command
export function recordValidationOutcome(cmd, outcome) {
  // outcome: { verified: bool, falsePositive: bool, checks: [], summary: string }
  try {
    const entries = _loadValidations();
    entries.unshift({ cmd: cmd.slice(0, 200), ts: Date.now(), ...outcome });
    _saveValidations(entries);
  } catch {}
}

// Get recent validation outcomes for a command (most recent first)
export function getValidationHistory(cmd, limit = 10) {
  try {
    return _loadValidations()
      .filter(e => e.cmd === cmd)
      .slice(0, limit);
  } catch { return []; }
}

// Get commands with a history of false-positive successes (verification failed after reported success)
export function getFalsePositiveCommands(limit = 5) {
  try {
    const entries = _loadValidations();
    const counts = {};
    entries.filter(e => e.falsePositive).forEach(e => {
      counts[e.cmd] = (counts[e.cmd] || 0) + 1;
    });
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([cmd, count]) => ({ cmd, count }));
  } catch { return []; }
}

// Phase 262: React hook
import { useState, useEffect, useCallback } from "react";

export function useExecutionGraph() {
  const [commonSequences, setCommonSequences] = useState([]);

  useEffect(() => {
    setCommonSequences(getCommonSequences());
  }, []);

  const addEdge = useCallback((from, to, relation, meta) => {
    recordEdgeWeighted(from, to, relation, meta); // Phase 326: weighted to avoid edge bloat
  }, []);

  const successorsOf        = useCallback((cmd) => getSuccessors(cmd), []);
  const lineageOf           = useCallback((cmd) => getLineage(cmd), []);
  const getContinuation     = useCallback((recent) => getWorkflowContinuation(recent), []); // Phase 322
  const getIncomplete       = useCallback((recent) => detectIncompleteSequence(recent), []); // Phase 322
  const getLoops            = useCallback(() => detectRecurringLoops(), []);                 // Phase 326
  const recordValidation    = useCallback((cmd, outcome) => recordValidationOutcome(cmd, outcome), []); // Phase 362
  const getValidations      = useCallback((cmd) => getValidationHistory(cmd), []);           // Phase 362
  const getFalsePositives   = useCallback(() => getFalsePositiveCommands(), []);             // Phase 362

  return { commonSequences, addEdge, successorsOf, lineageOf, getContinuation, getIncomplete, getLoops,
           recordValidation, getValidations, getFalsePositives };
}
