// Phase 341: Workflow continuity intelligence — extracted from WorkflowPanel.
// Owns: active goal inference, context shift detection, interrupted intent,
//       graph-based continuation suggestions, incomplete sequence detection.
// All state is derived from recentCmds (passed in) — no internal timers or subscriptions.

import { useMemo } from "react";
import { getWorkflowContinuation, detectIncompleteSequence } from "./useExecutionGraph";
import { inferActiveGoal, detectContextShift, detectInterruptedIntent } from "./useExecutionContext";

// Phase 341: hook — stable memo boundaries, all continuity signals in one place
// recentCmds: string[] — last N commands from dispatch history (caller slices to desired depth)
export function useWorkflowContinuity(recentCmds = []) {
  // Active goal + context shift — depend only on recentCmds (array ref changes on new dispatch)
  const activeGoal = useMemo(() => inferActiveGoal(recentCmds), [recentCmds]);
  const contextShift = useMemo(() => detectContextShift(recentCmds), [recentCmds]);

  // Interrupted intent — reads localStorage once per recentCmds change; no polling
  const interruptedIntent = useMemo(() => detectInterruptedIntent(), [recentCmds]);

  // Graph continuation: what to run next based on execution graph successors
  const workflowContinuation = useMemo(
    () => getWorkflowContinuation(recentCmds),
    [recentCmds]
  );

  // Pattern-based: detects lint→build, build→restart, etc. started but not finished
  const incompleteSequence = useMemo(
    () => detectIncompleteSequence(recentCmds),
    [recentCmds]
  );

  return { activeGoal, contextShift, interruptedIntent, workflowContinuation, incompleteSequence };
}
