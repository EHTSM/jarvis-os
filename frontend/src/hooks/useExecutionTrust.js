// Phase 341: Execution trust intelligence — extracted from WorkflowPanel.
// Owns: rollback probability, workflow risk score, reliability scoring, overload signal, trust stabilizer.
// All reads are localStorage-only. No external calls. No timers.

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  estimateRollbackProbability,
  scoreWorkflowRisk,
  detectOperatorOverload,
} from "./useAdaptiveExecution";

const HIST_KEY = "jarvis_workflow_hist";
const MIN_HIST_FOR_RELIABILITY = 3;

function _loadHist() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); } catch { return []; }
}

// Reliability: reads history for a specific cmd — stable dep-key prevents per-keystroke churn
function _scoreReliability(cmd) {
  if (!cmd) return null;
  const hist = _loadHist().filter(h => h.cmd === cmd);
  if (hist.length < MIN_HIST_FOR_RELIABILITY) return null;
  const successCount = hist.filter(h => h.ok).length;
  const rate = Math.round((successCount / hist.length) * 100);
  const lastRun = hist[0]?.ts
    ? new Date(hist[0].ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const retryRisk = rate < 45 ? "high" : rate < 75 ? "medium" : "low";
  const color = retryRisk === "high" ? "var(--op-red)" : retryRisk === "medium" ? "var(--op-amber)" : "var(--op-green)";
  return { rate, runs: hist.length, retryRisk, color, lastRun };
}

// Trust: rollback probability + risk score, stabilized against single-char oscillation
function _scoreTrust(cmd, isInformational, overloadHigh, prevRef) {
  if (!cmd) { prevRef.current = null; return null; }
  if (isInformational) { prevRef.current = null; return null; }

  const rollback  = estimateRollbackProbability(cmd);
  const riskScore = scoreWorkflowRisk([cmd]);
  if (rollback.probability < 10 && riskScore.label === "safe") { prevRef.current = null; return null; }

  // Stabilizer: skip update if cmd differs by only 1 char from last stable state
  const prevCmd = prevRef.current?.cmd || "";
  const cmdDelta = Math.abs(cmd.length - prevCmd.length);
  const sameRoot = prevCmd.length > 2 && cmd.startsWith(prevCmd.slice(0, -1));
  if (cmdDelta <= 1 && sameRoot && prevRef.current) return prevRef.current.trust;

  const rbColor = rollback.probability >= 50 ? "var(--op-red)"
                : rollback.probability >= 20  ? "var(--op-amber)"
                : "var(--op-green)";
  const safetyLabel = riskScore.label === "safe"     ? "Safe to run"
                    : riskScore.label === "moderate" ? "Low impact"
                    : riskScore.label === "elevated" ? "Review before running"
                    : "High impact — confirm first";
  const trust = { rollback, riskScore, rbColor, safetyLabel, degraded: overloadHigh };
  prevRef.current = { cmd, trust };
  return trust;
}

// Phase 341: hook — all trust intelligence in one stable surface
export function useExecutionTrust({ debouncedCmd = "", busy = false, isInformational = false, dispatchHist = [] } = {}) {
  const prevTrustRef = useRef(null);

  // Overload: recompute when dispatch history changes (cheap localStorage read)
  const overloadState = useMemo(
    () => detectOperatorOverload(),
    [dispatchHist]
  );

  // Reliability: stable dep-key prevents recompute on every hist entry push
  const _relDepKey = `${debouncedCmd}|${busy}`;
  const workflowReliability = useMemo(() => {
    if (busy) return null;
    return _scoreReliability(debouncedCmd);
  }, [_relDepKey]);

  // Trust: stabilized by prevTrustRef, gated by debounced cmd
  const executionTrust = useMemo(() => {
    if (busy) { prevTrustRef.current = null; return null; }
    return _scoreTrust(debouncedCmd, isInformational, overloadState?.level === "high", prevTrustRef);
  }, [debouncedCmd, busy, isInformational, overloadState]);

  return { executionTrust, workflowReliability, overloadState };
}
