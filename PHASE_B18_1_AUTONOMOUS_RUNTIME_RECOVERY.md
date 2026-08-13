# Phase B18.1 Autonomous Runtime Recovery

## Summary
The autonomous runtime was stuck in a churn loop because prerequisite failures (AI availability, local service reachability, and git health) were repeatedly causing new work to be re-queued instead of stopping cleanly. The fix preserves the existing runtime architecture while adding a bounded prerequisite gate that blocks new dispatches after repeated failures.

## Root cause
1. The loop continued to poll and process due tasks even when AI providers and git were failing.
2. Each failed execution could trigger retry or re-queue behavior, which repeatedly generated new work instead of converging.
3. The runtime had no short-circuit guard for repeated prerequisite failures, so it kept consuming CPU and producing noisy churn.

## What changed
- Added a prerequisite gate in [agents/runtime/prerequisiteGate.cjs](agents/runtime/prerequisiteGate.cjs) that tracks consecutive failures and temporarily blocks runtime dispatches after 3 failures.
- Wired the gate into [agents/autonomousLoop.cjs](agents/autonomousLoop.cjs) so the loop skips ticks when prerequisites are unavailable.
- Wired the gate into [agents/runtime/runtimeOrchestrator.cjs](agents/runtime/runtimeOrchestrator.cjs) so dispatches are rejected before they enter the execution path.
- Added regression coverage in [tests/runtime/09-prereq-gate.test.cjs](tests/runtime/09-prereq-gate.test.cjs).

## Verification
Verified with:
- `node --test tests/runtime/09-prereq-gate.test.cjs`
- `node --test tests/runtime/06-retry.test.cjs tests/runtime/09-prereq-gate.test.cjs`

Both commands completed successfully with 0 failures.

## Follow-up
- Monitor the runtime logs for the new gate message and confirm that the loop stays idle during persistent prerequisite failures.
- Re-enable normal execution once AI providers and git are healthy again.
