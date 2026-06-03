// Phase 251 + 301: Operator productivity acceleration — workflow intent prediction.
// Reads time-of-day patterns, recent history, and session context to predict next action.
// Phase 301 refinements: corrected follow-map direction, confidence-gated time hints,
//   repetition suppression, minimum confidence threshold.
// No external calls — all inference is local.

const HIST_KEY   = "jarvis_workflow_hist";
const MEMORY_KEY = "jarvis_execution_memory";

// Phase 301: minimum confidence to surface a prediction — suppresses noise
const MIN_CONFIDENCE = 25;

// Phase 251 + 301: predict what the operator is likely to do next
// Returns ranked list of predicted commands with confidence
export function predictNextAction({ lastCmd, sessionStartMs, recentCmds = [] } = {}) {
  try {
    const hist    = JSON.parse(localStorage.getItem(HIST_KEY)   || "[]");
    const mem     = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
    const hour    = new Date().getHours();
    const isEarly = hour >= 6  && hour < 10;
    const isMid   = hour >= 10 && hour < 17;

    const seen    = new Set(recentCmds);       // Phase 301: suppress recently used
    const seenCmds = new Set();                // Phase 301: dedup across sources
    const predictions = [];

    // Pattern: what command typically follows the last command?
    // Phase 301 fix: hist[i] is lastCmd → hist[i+1] is what came after
    if (lastCmd) {
      const followMap = {};
      for (let i = 0; i < hist.length - 1; i++) {
        if (hist[i].cmd === lastCmd && hist[i].ok && hist[i + 1]?.cmd) {
          const next = hist[i + 1].cmd;
          followMap[next] = (followMap[next] || 0) + 1;
        }
      }
      Object.entries(followMap)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .forEach(([cmd, count]) => {
          if (!seen.has(cmd)) {
            const conf = Math.min(90, 40 + count * 12);
            predictions.push({ cmd, confidence: conf, source: "follow_pattern" });
            seenCmds.add(cmd);
          }
        });
    }

    // Phase 301: frequency-based suggestions — high confidence from memory, shown before time hints
    mem
      .filter(e => e.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .forEach(e => {
        if (!seen.has(e.cmd) && !seenCmds.has(e.cmd)) {
          const conf = Math.min(75, 25 + e.count * 6);
          predictions.push({ cmd: e.cmd, confidence: conf, source: "frequency" });
          seenCmds.add(e.cmd);
        }
      });

    // Phase 301: time-of-day hints only fill remaining slots and only if confidence threshold met
    // Suppressed if we already have 4+ high-confidence predictions from history/memory
    const historyConfident = predictions.filter(p => p.confidence >= 50).length;
    if (historyConfident < 3) {
      const timeHints = isEarly
        ? ["npm run check-health", "pm2 list", "pm2 logs --lines 20 --noprefix"]
        : isMid
        ? ["npm run build", "npm test", "npm run lint"]
        : ["pm2 logs --lines 30 --noprefix", "pm2 list", "npm run check-health"];
      timeHints.forEach((cmd, i) => {
        if (!seen.has(cmd) && !seenCmds.has(cmd)) {
          predictions.push({ cmd, confidence: 28 - i * 3, source: "time_pattern" });
          seenCmds.add(cmd);
        }
      });
    }

    return predictions
      .filter(p => p.confidence >= MIN_CONFIDENCE)   // Phase 301: noise gate
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5)
      .map(p => ({ ...p, label: p.cmd.length > 55 ? p.cmd.slice(0, 52) + "…" : p.cmd }));
  } catch { return []; }
}

// Phase 308: detect repetitive single-command sessions — operator runs same command repeatedly
export function detectRepetitiveTask() {
  try {
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    if (hist.length < 4) return null;
    const recent = hist.slice(0, 8);
    const freq = {};
    recent.forEach(h => { if (h.ok) freq[h.cmd] = (freq[h.cmd] || 0) + 1; });
    const top = Object.entries(freq).sort(([, a], [, b]) => b - a)[0];
    if (!top || top[1] < 3) return null;
    return { cmd: top[0], count: top[1], suggestion: "Save this as a macro for one-click access" };
  } catch { return null; }
}

// Phase 251: React hook
import { useState, useEffect, useCallback } from "react";

export function useOperatorIntent({ lastCmd, recentCmds } = {}) {
  const [predictions, setPredictions] = useState([]);
  const [repetitiveTask, setRepetitiveTask] = useState(null); // Phase 308

  useEffect(() => {
    setPredictions(predictNextAction({ lastCmd, recentCmds }));
    setRepetitiveTask(detectRepetitiveTask()); // Phase 308
  }, [lastCmd]);

  const refresh = useCallback(() => {
    setPredictions(predictNextAction({ lastCmd, recentCmds }));
    setRepetitiveTask(detectRepetitiveTask());
  }, [lastCmd, recentCmds]);

  // Phase 308: highest-confidence single contextual action (for prominent quick-action chip)
  const contextualAction = predictions[0] && predictions[0].confidence >= 50 ? predictions[0] : null;

  return { predictions, refresh, repetitiveTask, contextualAction };
}
