// Phase 366: Execution Runtime
// Owns the full single-dispatch execution cycle: flood protection, dry-run,
// cache, dispatch, result handling, history recording, graph edge recording.
// WorkflowPanel calls run(cmd) and reads { busy, elapsed, result, lastCompletion }.
// No UI state here — pure execution logic + lifecycle.

import { useCallback, useRef } from "react";
import { safeDispatch as _apiDispatch } from "../../api";
import { useExecutionState } from "./useExecutionState";

// Phase 293: short-lived result cache for read-only observation commands (60s TTL)
const _CACHEABLE   = /^(pm2 list|pm2 status|git status|git log|git diff|df -h|ls |cat |pwd|npm run check-health)/i;
const _CACHE_TTL   = 60_000;
const _execCache   = new Map();

function _cacheGet(cmd) {
  const e = _execCache.get(cmd);
  if (!e) return null;
  if (Date.now() - e.ts > _CACHE_TTL) { _execCache.delete(cmd); return null; }
  return e.result;
}
function _cacheSet(cmd, result) {
  if (_CACHEABLE.test(cmd)) _execCache.set(cmd, { result, ts: Date.now() });
}

/**
 * useExecutionRuntime
 *
 * @param {object} opts
 * @param {Function} opts.addNotification
 * @param {Function} opts.onAction           — called after successful dispatch
 * @param {Function} opts.onRefresh          — called after every dispatch attempt
 * @param {Function} opts.addToHistory       — (cmd, ok, summary) → void
 * @param {Function} opts.addGraphEdge       — (from, to, relation, meta) → void
 * @param {Function} opts.recordMemoryFlow   — (cmd, meta) → void
 * @param {Function} opts.assistantAnalyzeFailure — (error) → void
 * @param {Function} opts.recordHesitationCancel  — () → void
 * @param {Function} opts.recordDispatchStart — () → void
 * @param {Function} opts.recordDispatchEnd   — (ok: bool) → void
 * @param {Function} opts.humanizeError       — (raw: string) → string
 * @param {string}   opts.dryRun
 * @param {string}   opts.priority
 * @param {string}   opts.timeout
 * @param {object}   opts.cmdAnalysis         — from useOperationalCalmness
 */
export function useExecutionRuntime({
  addNotification,
  onAction,
  onRefresh,
  addToHistory,
  addGraphEdge,
  recordMemoryFlow,
  assistantAnalyzeFailure,
  recordHesitationCancel,
  recordDispatchStart,
  recordDispatchEnd,
  humanizeError,
  dryRun,
  priority,
  timeout,
  cmdAnalysis,
}) {
  const execState = useExecutionState();
  const lastSuccessfulCmdRef = useRef(null);
  const lastDangerousDispatch = useRef(0);

  const run = useCallback(async (cmd) => {
    if (!cmd || execState.busy) return;

    // Dry-run short-circuit
    if (dryRun) {
      execState.finishExecution(true,
        `[DRY RUN] Would dispatch: ${cmd.slice(0, 80)} | Priority: ${priority} | Timeout: ${timeout}s | Risk: ${cmdAnalysis?.risk.label || "SAFE"}`,
        cmd
      );
      addNotification?.(`Dry run preview: ${cmd.slice(0, 30)}`, "info");
      return;
    }

    // Cached read-only result
    const cached = _cacheGet(cmd);
    if (cached) {
      execState.finishExecution(true, `[cached] ${cached.slice(0, 200)}`, cmd);
      return;
    }

    // Flood gate + start
    const allowed = execState.startExecution();
    if (!allowed) {
      addNotification?.("Dispatch flood detected – suppressed", "warn");
      return;
    }

    recordHesitationCancel?.();
    recordDispatchStart?.();

    try {
      const r = await _apiDispatch(cmd, parseInt(timeout) * 1000);

      if (!r || r.success === false) {
        const friendly = humanizeError?.(r?.error || "Dispatch failed") ?? (r?.error || "Dispatch failed");
        execState.finishExecution(false, friendly, cmd);
        addToHistory?.(cmd, false, friendly.slice(0, 40));
        addNotification?.(`Task failed: ${cmd.slice(0, 20)}`, "crit");
        assistantAnalyzeFailure?.(r?.error || "Dispatch failed");
        recordDispatchEnd?.(false);
      } else {
        const out = r.output || r.result || r.reply || "Dispatched";
        const raw = typeof out === "string" ? out : JSON.stringify(out);
        _cacheSet(cmd, raw);
        execState.finishExecution(true, raw.slice(0, 200) + (raw.length > 200 ? "… (truncated)" : ""), cmd);
        addToHistory?.(cmd, true, raw.slice(0, 40));
        addNotification?.(`Task succeeded: ${cmd.slice(0, 20)}`, "ok");

        if (cmdAnalysis?.risk.level === 3) lastDangerousDispatch.current = Date.now();
        recordMemoryFlow?.(cmd, { durationMs: Date.now() - (execState.execStart || Date.now()) });

        // Execution graph edge: record A → B relationship
        if (lastSuccessfulCmdRef.current && lastSuccessfulCmdRef.current !== cmd) {
          addGraphEdge?.(lastSuccessfulCmdRef.current, cmd, "followed_by", { ok: true });
        }
        lastSuccessfulCmdRef.current = cmd;
        onAction?.();
        recordDispatchEnd?.(true);
      }
    } catch (e) {
      const friendly = humanizeError?.(e.message) ?? e.message;
      execState.finishExecution(false, friendly, cmd);
      addToHistory?.(cmd, false, friendly.slice(0, 40));
      addNotification?.(`Dispatch error: ${e.message.slice(0, 40)}`, "crit");
      recordDispatchEnd?.(false);
    } finally {
      onRefresh?.();
    }
  }, [
    execState, dryRun, priority, timeout, cmdAnalysis,
    addNotification, onAction, onRefresh, addToHistory, addGraphEdge,
    recordMemoryFlow, assistantAnalyzeFailure, recordHesitationCancel,
    recordDispatchStart, recordDispatchEnd, humanizeError,
  ]);

  const lastDangerousDispatchTime = useCallback(() => lastDangerousDispatch.current, []);

  return {
    // Re-export execution state for direct access
    ...execState,
    // Actions
    run,
    lastDangerousDispatchTime,
  };
}
