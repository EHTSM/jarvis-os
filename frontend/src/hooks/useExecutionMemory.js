// Phase 242: Execution memory layer — surfaces recurring patterns, accelerates repetitive actions.
// Reads from existing workflow history (jarvis_workflow_hist) and analytics.
// All state is localStorage-only — no external calls.

const HIST_KEY      = "jarvis_workflow_hist";
const MEMORY_KEY    = "jarvis_execution_memory";
const MEMORY_MAX    = 100; // max remembered flows

// Phase 242: load the raw execution memory store
function _loadMemory() {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]"); }
  catch { return []; }
}

function _saveMemory(entries) {
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(entries.slice(0, MEMORY_MAX))); } catch {}
}

// Phase 242: record a successful flow for memory
export function recordSuccessfulFlow(cmd, meta = {}) {
  try {
    const mem = _loadMemory();
    const existing = mem.find(e => e.cmd === cmd);
    if (existing) {
      existing.count++;
      existing.lastTs = Date.now();
      if (meta.durationMs) existing.avgDurationMs = Math.round((existing.avgDurationMs + meta.durationMs) / 2);
    } else {
      mem.unshift({ cmd, count: 1, firstTs: Date.now(), lastTs: Date.now(), avgDurationMs: meta.durationMs || null });
    }
    _saveMemory(mem);
  } catch {}
}

// Phase 242 + 313: detect recurring operator patterns — commands run ≥3 times successfully
// Phase 313: filter low-value patterns (too short, single-word, trivial status commands)
const _LOW_VALUE = /^(ls|pwd|cd|echo|true|false|exit|clear|reset)(\s|$)/i;
export function getRecurringPatterns() {
  try {
    const mem = _loadMemory();
    return mem
      .filter(e => e.count >= 3 && e.cmd.length > 5 && !_LOW_VALUE.test(e.cmd))
      .sort((a, b) => {
        // Phase 313: score = frequency weighted by recency (newer = higher priority)
        const recencyA = a.lastTs ? Math.max(0, 1 - (Date.now() - a.lastTs) / (7 * 86_400_000)) : 0.5;
        const recencyB = b.lastTs ? Math.max(0, 1 - (Date.now() - b.lastTs) / (7 * 86_400_000)) : 0.5;
        return (b.count * (0.5 + recencyB)) - (a.count * (0.5 + recencyA));
      })
      .slice(0, 6) // Phase 313: cap at 6 (was 8) — fewer, higher-quality suggestions
      .map(e => ({
        cmd: e.cmd,
        count: e.count,
        lastTs: e.lastTs,
        avgDurationMs: e.avgDurationMs,
        label: e.cmd.length > 50 ? e.cmd.slice(0, 47) + "…" : e.cmd,
      }));
  } catch { return []; }
}

// Phase 242: suggest next command based on current input prefix and memory
export function suggestFromMemory(inputPrefix) {
  if (!inputPrefix || inputPrefix.length < 3) return [];
  try {
    const mem = _loadMemory();
    const q = inputPrefix.toLowerCase();
    return mem
      .filter(e => e.cmd.toLowerCase().startsWith(q) || e.cmd.toLowerCase().includes(q))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(e => ({ cmd: e.cmd, count: e.count, label: e.cmd.length > 60 ? e.cmd.slice(0, 57) + "…" : e.cmd }));
  } catch { return []; }
}

// Phase 242: get the top N most-repeated workflows from history + memory combined
export function getTopWorkflows(n = 6) {
  try {
    const mem = _loadMemory();
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");

    // Merge: weight by count from memory + recency from hist
    const freqMap = {};
    mem.forEach(e => { freqMap[e.cmd] = (freqMap[e.cmd] || 0) + e.count; });
    hist.filter(h => h.ok).forEach(h => { freqMap[h.cmd] = (freqMap[h.cmd] || 0) + 1; });

    return Object.entries(freqMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, n)
      .map(([cmd, freq]) => ({ cmd, freq, label: cmd.length > 50 ? cmd.slice(0, 47) + "…" : cmd }));
  } catch { return []; }
}

// Phase 302: detect slow repetitive flows — commands run ≥3 times with high avg duration
// Returns flow suggestions: either a combined command or a note to macro-ize the sequence
export function detectSlowRepetitiveFlows() {
  try {
    const mem  = _loadMemory();
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");

    // Build sequence pairs — look for cmd A always followed by cmd B
    const pairMap = {};
    for (let i = 0; i < hist.length - 1; i++) {
      if (hist[i].ok && hist[i + 1]?.ok) {
        const key = `${hist[i].cmd}|||${hist[i + 1].cmd}`;
        pairMap[key] = (pairMap[key] || 0) + 1;
      }
    }

    // Slow flows: high avg duration + frequently repeated
    const slowFlows = mem
      .filter(e => e.count >= 3 && e.avgDurationMs && e.avgDurationMs > 8000)
      .map(e => ({
        cmd: e.cmd,
        count: e.count,
        avgDurationMs: e.avgDurationMs,
        suggestion: e.avgDurationMs > 30000
          ? "Consider splitting into smaller steps or adding a timeout guard"
          : "Save as a macro for one-click access",
      }));

    // Common sequential pairs — suggest combining or workflow-izing
    const frequentPairs = Object.entries(pairMap)
      .filter(([, count]) => count >= 3)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([key, count]) => {
        const [a, b] = key.split("|||");
        return {
          cmdA: a, cmdB: b, count,
          suggestion: `Run as workflow: "${a.slice(0, 30)}" → "${b.slice(0, 30)}"`,
          combined: `${a} && ${b}`,
        };
      });

    return { slowFlows, frequentPairs };
  } catch { return { slowFlows: [], frequentPairs: [] }; }
}

// Phase 242: React hook — exposes memory utilities reactively
import { useState, useEffect, useCallback } from "react";

export function useExecutionMemory() {
  const [patterns, setPatterns] = useState([]);
  const [topWorkflows, setTopWorkflows] = useState([]);
  const [flowAcceleration, setFlowAcceleration] = useState({ slowFlows: [], frequentPairs: [] }); // Phase 302

  // Refresh on mount — patterns don't change mid-session often
  useEffect(() => {
    setPatterns(getRecurringPatterns());
    setTopWorkflows(getTopWorkflows());
    setFlowAcceleration(detectSlowRepetitiveFlows()); // Phase 302
  }, []);

  const recordFlow = useCallback((cmd, meta) => {
    recordSuccessfulFlow(cmd, meta);
    setPatterns(getRecurringPatterns());
    setTopWorkflows(getTopWorkflows());
    setFlowAcceleration(detectSlowRepetitiveFlows()); // Phase 302
  }, []);

  const suggest = useCallback((prefix) => suggestFromMemory(prefix), []);

  return { patterns, topWorkflows, flowAcceleration, recordFlow, suggest };
}
