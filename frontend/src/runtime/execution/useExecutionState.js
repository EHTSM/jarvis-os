// Phase 367: Unified execution state model.
// Owns: busy, execStart, elapsed, result, lastCompletion, cancellation.
// Single source of truth — WorkflowPanel reads these, never re-derives them.
// Phase 368: All rapid-tick state (elapsed 100ms) is isolated here so the heavy
// UI tree does not rerender at 10Hz. Only this hook re-renders at 100ms intervals
// during execution. Everything else is stable.

import { useState, useRef, useCallback, useEffect } from "react";

const RESULT_AUTO_CLEAR_OK_MS   = 6_000;
const RESULT_AUTO_CLEAR_FAIL_MS = 0;   // failures persist until cleared manually
const COMPLETION_SHOW_OK_MS     = 5_000;
const COMPLETION_SHOW_FAIL_MS   = 10_000;
const DISPATCH_FLOOD_MS         = 300;  // min ms between dispatches

export function useExecutionState() {
  const [busy,           setBusy]           = useState(false);
  const [execStart,      setExecStart]      = useState(null);
  const [elapsed,        setElapsed]        = useState(0);
  const [result,         setResult]         = useState(null); // { ok: bool, text: string }
  const [lastCompletion, setLastCompletion] = useState(null); // { ok, cmd, durationMs, ts }
  const [cancelledCmd,   setCancelledCmd]   = useState(null); // last cmd cancelled mid-flight

  const elapsedRef        = useRef(null);
  const resultTimerRef    = useRef(null);
  const completionTimerRef = useRef(null);
  const lastDispatchRef   = useRef(0);

  // 100ms elapsed ticker — only runs during active execution
  // Isolated here so WorkflowPanel JSX does not rerender at 10Hz
  useEffect(() => {
    if (busy && execStart) {
      elapsedRef.current = setInterval(() => {
        const ms = Date.now() - execStart;
        setElapsed(ms < 3000 ? parseFloat((ms / 1000).toFixed(1)) : Math.floor(ms / 1000));
      }, 100);
    } else {
      clearInterval(elapsedRef.current);
      setElapsed(0);
    }
    return () => clearInterval(elapsedRef.current);
  }, [busy, execStart]);

  // Cleanup timers on unmount
  useEffect(() => () => {
    clearInterval(elapsedRef.current);
    clearTimeout(resultTimerRef.current);
    clearTimeout(completionTimerRef.current);
  }, []);

  const startExecution = useCallback(() => {
    const now = Date.now();
    // Flood gate
    if (now - lastDispatchRef.current < DISPATCH_FLOOD_MS) return false;
    lastDispatchRef.current = now;
    setBusy(true);
    setExecStart(now);
    setResult(null);
    setCancelledCmd(null);
    return true;
  }, []);

  const finishExecution = useCallback((ok, text, cmd) => {
    setBusy(false);
    setResult({ ok, text });
    if (ok) {
      clearTimeout(resultTimerRef.current);
      resultTimerRef.current = setTimeout(() => setResult(null), RESULT_AUTO_CLEAR_OK_MS);
    }
    // Completion digest
    clearTimeout(completionTimerRef.current);
    setLastCompletion({ ok, cmd: (cmd || "").slice(0, 40), durationMs: Date.now() - (execStart || Date.now()), ts: Date.now() });
    completionTimerRef.current = setTimeout(
      () => setLastCompletion(null),
      ok ? COMPLETION_SHOW_OK_MS : COMPLETION_SHOW_FAIL_MS
    );
  }, [execStart]);

  const cancelExecution = useCallback((cmd) => {
    setBusy(false);
    setCancelledCmd(cmd || null);
    clearInterval(elapsedRef.current);
    setElapsed(0);
  }, []);

  const clearResult = useCallback(() => {
    clearTimeout(resultTimerRef.current);
    setResult(null);
  }, []);

  return {
    // State (read-only from consumer perspective)
    busy, execStart, elapsed, result, lastCompletion, cancelledCmd,
    // Actions
    startExecution, finishExecution, cancelExecution, clearResult,
  };
}
