// Phase 344: Workflow runtime isolation — sequential workflow + conditional chain executor.
// Owns: activeWorkflow, workflowProgress, cancelRequested, lastFailedStep, chainLog, chainRunning.
// Cancellation and checkpoint logic are fully contained here.
// WorkflowPanel provides: addNotification, onAction, getPacing, saveCheckpoint, clearCheckpoint.

import { useState, useRef, useCallback, useEffect } from "react";
import { safeDispatch } from "../api";
import { bus } from "../runtime/execution/executionEventBus";

// Phase 241: conditional chain executor — async generator, no React deps
async function* _executeChain(chain, dispatch) {
  const steps = chain.steps || [];
  let idx = 0;
  const visited = new Set();

  while (idx !== null && idx >= 0 && idx < steps.length) {
    if (visited.has(idx)) { yield { idx, error: "Cycle detected — chain aborted.", aborted: true }; return; }
    visited.add(idx);
    const step = steps[idx];
    let result = null;
    let attempt = 0;
    const maxRetries = step.retries ?? 0;

    while (attempt <= maxRetries) {
      result = await dispatch(step.cmd);
      if (result.ok) break;
      attempt++;
      if (attempt <= maxRetries) await new Promise(r => setTimeout(r, 800 * attempt));
    }

    if (!result.ok && step.fallback) {
      const fbResult = await dispatch(step.fallback);
      yield { idx, step, result, fallbackUsed: true, fallbackResult: fbResult };
      idx = fbResult.ok ? (step.onSuccess ?? null) : (step.onFailure ?? null);
      continue;
    }

    yield { idx, step, result, attempts: attempt };
    idx = result.ok ? (step.onSuccess ?? null) : (step.onFailure ?? null);
  }
}

// Phase 344: hook — isolated execution runtime
export function useWorkflowExecutor({ addNotification, onAction, getPacing, saveCheckpoint, clearCheckpoint }) {
  const [activeWorkflow,    setActiveWorkflow]    = useState(null);  // null | stepCount
  const [workflowProgress,  setWorkflowProgress]  = useState(0);
  const [cancelRequested,   setCancelRequested]   = useState(false);
  const [lastFailedStep,    setLastFailedStep]    = useState(null);
  const [chainLog,          setChainLog]          = useState([]);
  const [chainRunning,      setChainRunning]      = useState(false);

  const workflowCancelRef = useRef(false);
  const chainCancelRef    = useRef(false);

  // Cancel in-flight workflow on unmount — prevents setState on unmounted component
  useEffect(() => () => { workflowCancelRef.current = true; }, []);

  const cancelWorkflow = useCallback(() => {
    workflowCancelRef.current = true;
    setCancelRequested(true);
  }, []);

  const cancelChain = useCallback(() => {
    chainCancelRef.current = true;
  }, []);

  // Phase 344: sequential workflow execution — checkpointed, cancellable, paced
  const executeWorkflow = useCallback(async (macros, resumeFromStep = 0) => {
    workflowCancelRef.current = false;
    setCancelRequested(false);
    setLastFailedStep(null);
    setActiveWorkflow(macros.length);
    const wfId = `wf-${Date.now()}`;
    const completedSteps = [];
    addNotification?.(`⛓ Starting workflow: ${macros.length} steps${resumeFromStep > 0 ? ` (resuming from step ${resumeFromStep + 1})` : ""}`, "info");

    for (let i = resumeFromStep; i < macros.length; i++) {
      if (workflowCancelRef.current) break;
      const macro = macros[i];
      setWorkflowProgress(i);

      try {
        const r = await safeDispatch(macro.cmd, parseInt(macro.timeout || 30) * 1000);
        if (!r || r.success === false) {
          addNotification?.(`✗ Workflow step ${i + 1} failed: ${macro.name}`, "crit");
          saveCheckpoint?.(wfId, i, completedSteps, macros.slice(i), { label: macro.name });
          setLastFailedStep(i);
          setActiveWorkflow(null);
          return;
        }
        completedSteps.push({ cmd: macro.cmd, result: "ok", ts: Date.now() });
        addNotification?.(`✓ Workflow step ${i + 1}: ${macro.name}`, "ok");

        if (!workflowCancelRef.current) {
          const stepDelay = getPacing?.() ?? 600;
          await new Promise(resolve => {
            const t = setTimeout(resolve, stepDelay);
            const check = setInterval(() => {
              if (workflowCancelRef.current) { clearTimeout(t); clearInterval(check); resolve(); }
            }, 100);
            setTimeout(() => clearInterval(check), stepDelay + 100);
          });
        }
      } catch (err) {
        addNotification?.(`✗ Workflow error at step ${i + 1}: ${err.message}`, "crit");
        saveCheckpoint?.(wfId, i, completedSteps, macros.slice(i), { label: macro.name });
        setLastFailedStep(i);
        setActiveWorkflow(null);
        return;
      }
    }

    setActiveWorkflow(null);
    setWorkflowProgress(0);
    clearCheckpoint?.(wfId);
    if (!workflowCancelRef.current) {
      addNotification?.("✓ Workflow completed successfully", "ok");
      bus.workflowCompleted(wfId, macros.length); // Phase 370
      onAction?.();
    }
  }, [addNotification, onAction, getPacing, saveCheckpoint, clearCheckpoint]);

  // Phase 344: conditional chain execution — branching, fallback, cycle detection
  const runChain = useCallback(async (chain) => {
    if (chainRunning) return;
    chainCancelRef.current = false;
    setChainRunning(true);
    setChainLog([]);
    addNotification?.(`⛓ Chain: ${chain.name} (${chain.steps.length} steps)`, "info");

    const dispatch = async (cmd) => {
      if (chainCancelRef.current) return { ok: false, error: "Cancelled" };
      try {
        const r = await safeDispatch(cmd, 30000);
        return { ok: !!(r?.success !== false), output: r?.output || r?.result || "", error: r?.error };
      } catch (e) { return { ok: false, error: e.message }; }
    };

    try {
      for await (const stepResult of _executeChain(chain, dispatch)) {
        if (chainCancelRef.current) break;
        setChainLog(log => [...log, stepResult]);
        if (stepResult.aborted) { addNotification?.("⚠ Chain aborted: " + stepResult.error, "warn"); break; }
        if (!stepResult.result?.ok && !stepResult.fallbackUsed) {
          addNotification?.(`✗ Chain step ${stepResult.idx + 1} failed: ${stepResult.step?.label || stepResult.step?.cmd?.slice(0, 30)}`, "warn");
        } else {
          addNotification?.(`✓ Chain step ${stepResult.idx + 1} done`, "ok");
        }
      }
    } catch { /* chain executor error */ }

    setChainRunning(false);
    if (!chainCancelRef.current) addNotification?.(`Chain "${chain.name}" finished`, "ok");
  }, [chainRunning, addNotification]);

  const clearChainLog = useCallback(() => setChainLog([]), []);

  return {
    activeWorkflow, workflowProgress, cancelRequested, lastFailedStep,
    chainLog, chainRunning,
    executeWorkflow, runChain, cancelWorkflow, cancelChain, clearChainLog,
  };
}
