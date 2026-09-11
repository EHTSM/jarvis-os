# 10 — Agent Runtime (Phase 5)

## The claimed pipeline: REQUEST → PLAN → MISSION → AGENT → EXECUTE → TOOLS →
## OBSERVE → HANDLE FAILURE → RETRY → APPROVAL → CONTINUE → VERIFY → MEMORY → REPORT

Traced against real code, not simulated:

1. **PLAN**: `agents/planner.cjs`'s `plannerAgent(input, context)` and
   `buildTask(segment)` — real NL segmentation into typed tasks (confirmed via
   function-level read), not a stub.
2. **CREATE MISSION**: `backend/services/missionMemory.cjs`'s `createMission`,
   with real timeline (`_appendTimeline`), subtask ingestion
   (`_ingestSubtask`), decision recording (`recordDecision`), artifact
   recording (`recordArtifact`), and metrics recomputation
   (`_recomputeMetrics`) — a genuinely detailed state machine, not a flat log.
   `orgId` is optional by the file's own documented design (see
   `09_TENANT_ISOLATION.md`).
3. **SELECT AGENT / EXECUTE**: `agents/runtime/agentRegistry.cjs` +
   `agents/runtime/runtimeOrchestrator.cjs`'s `dispatch()` — real capability
   routing with backoff/circuit-breaker (per CLAUDE.md §5), plus a
   `_selfHeal()` function and `_consecutiveTickErrors` tripwire
   (`MAX_CONSECUTIVE_ERRORS = 5`) that are live safety mechanisms, not
   decorative.
4. **TOOLS**: `agents/toolAgent.cjs` delegates to
   `agents/runtime/agentRegistry.cjs`'s supervisor; command-execution tools
   route through `backend/core/safe-exec` (allowlisted, `shell:false` — see
   `07_SECURITY_MODEL.md`).
5. **OBSERVE / HANDLE FAILURE / RETRY**: `agents/autonomousLoop.cjs` — a real
   10-second poll loop with `node-cron` for recurring tasks, exponential-ish
   retry with `maxRetries`, a `_failureTracker` Map that logs a loud warning
   on the 3rd repeated failure of the same input prefix, a `_slowTasks` ring
   buffer (warns above 15s), and a documented, previously-fixed real
   incident: an unbounded `getDuePending()` sweep once ran 359 simultaneously
   overdue tasks sequentially, causing sustained 100%+ CPU — now capped at
   `MAX_TASKS_PER_TICK = 20`. This is evidence of genuine production
   incident history, not a theoretical design.
6. **REQUEST APPROVAL / CONTINUE**: 7 dedicated services —
   `approvalEngine.cjs`, `approvalQueue.cjs`, `approvalPolicy.cjs`,
   `approvalEvidence.cjs`, `approvalAnalytics.cjs`, `approvalPredictionEngine.cjs`,
   `approvalDashboard.cjs`. `approvalEngine.cjs`'s `generateApprovalPackage`/
   `requestApproval`/`rejectApproval` are real, persisted (`_load`/`_save`),
   confidence-scored functions — matches project memory's "POST-Ω P4 — 32
   Class B workflows covered, 13 approval types, one-tap→resume pipeline."
7. **VERIFY**: `executionRecovery.cjs`, `infrastructureRecoveryEngine.cjs` —
   real recovery-classification services, not simulated.
8. **RECORD MEMORY**: `missionMemory.cjs` (above) plus
   `memoryPersistenceLayer.cjs` / `continuousLearningEngine.cjs` (see
   `12_MEMORY_KNOWLEDGE.md`).
9. **REPORT RESULT**: mission timeline + dashboard surfaces
   (`MissionControlV1.jsx`).

## What is REAL vs. PARTIAL vs. SIMULATED

- **REAL**: task planning, mission state machine, agent dispatch with
  backoff/circuit-breaker, the 10s autonomous poll loop with real retry/backoff
  and documented incident-driven safety caps, the 7-service approval/HITL
  pipeline, execution recovery classification, real Docker CLI automation
  (`dockerController.cjs`, see `23_PRODUCT_REPLACEMENT_MATRIX.md`), real
  allowlisted terminal execution.
- **PARTIAL**: Automation OS's trigger model — only 2 of 6 declared trigger
  types (`manual`, `schedule`) have a real dispatcher; `event`/`threshold`/
  `webhook` accept validation but never fire (per `03_OOPLIX_OS_MAP.md`'s
  Automation OS entry). The approval→resume half of at least one flow
  (`automation:approval:required` is emitted with zero subscribers) does not
  exist.
- **KNOWN ARCHITECTURAL DRIFT, NOT A DEFECT**: four separate "execution
  engine" files exist with overlapping names (CLAUDE.md §5) —
  `agents/runtime/executionEngine.cjs`, `backend/services/autonomousExecutionEngine.cjs`,
  `backend/services/agentExecutionEngine.cjs`, `backend/services/computerExecutionEngine.cjs`
  — all four confirmed still present and independently sized (27.6KB, 21.2KB,
  10.2KB, 22.1KB respectively). The OS-layer audit's Runtime OS entry
  independently found evidence this layering is intentional (different files
  are required at different call sites for different purposes), supporting
  CLAUDE.md's instruction not to unify them unilaterally.

## Cross-reference: real production incidents already fixed in this layer

- `runtimeOrchestrator.cjs`'s `MAX_TASKS_PER_TICK` cap — fixed after a real
  359-task backlog incident.
- `agents/executor.cjs`/`executionEngine.cjs`/`autonomousLoop.cjs` fake-success
  chain — a handler *returning* `{success:false}` was never honored as failure
  upstream; fixed coordinately across all three files (per the OS-layer
  Runtime OS finding, RUNTIME-1).
- `agents/autonomousLoop.cjs` was found to run unconditionally on every server
  boot, writing real unattended data into the same JSON stores the CI
  regression/security suites assert against — root cause of a whole cluster of
  CI test failures (Tests 133/147/148/153/154 and 5 security tests), fixed via
  an opt-in `DISABLE_AUTONOMOUS_LOOP=1` guard used only in CI (Mission 65,
  2026-08-28; see `21_TESTING_STRATEGY.md`).

## Not scored as 10/10

No sub-area here is claimed at 10/10. The Runtime, Agent, Automation, and
Mission OS layers each carry live evidence of real defects found and mostly
fixed (see `03_OOPLIX_OS_MAP.md`), with at least one currently-open P0/HIGH
(Mission OS's cross-tenant cancel — MSN-1) that directly touches this
pipeline's mission layer.
