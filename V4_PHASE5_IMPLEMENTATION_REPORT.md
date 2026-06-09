# V4 Phase 5 — Self-Healing Pipeline
## Implementation Report

**Date:** 2026-06-02  
**Branch:** cleanup/runtime-minimization  
**Status:** COMPLETE — 51/51 assertions pass, first run

---

## Mission

A fix plan becomes a verified deployment workflow. Three modes. Rollback on failure. Incident auto-resolved on success.

---

## What Was Built

### `agents/runtime/selfHealingPipeline.cjs`

Single file. Executes any FixPlan produced by `autoFixPlanner` end-to-end.

| Entry Point | Purpose |
|---|---|
| `execute(planId, opts)` | Load plan from store and execute |
| `executePlan(plan, opts)` | Execute a plan object directly |
| `approveRun(runId, opts)` | Resume a run halted at an approval gate |
| `getHealingRun(runId)` | Retrieve one run by ID |
| `listHealingRuns(opts)` | List runs (filter: planId, incidentId, outcome, status) |

**Reuses (all fail-safe, null-guarded):**
- `autoFixPlanner.getPlan()` / `updateStatus()` — load plan, mark done
- `patchAssistant.proposePatch()` / `applyPatch()` / `rollbackPatch()` — patch lifecycle
- `deploymentPipeline.createRun()` / `approveRun()` / `markRolledBack()` — pipeline runs
- `incidentEngine.resolve()` — auto-resolve incident on success

**Storage:** `data/healing-runs.json` — ring buffer max 100, atomic write

---

## Execution Modes

| Mode | Behavior | When to Use |
|---|---|---|
| `recommend_only` | Patch proposals created, nothing applied. All stages marked `skipped`. | CRITICAL risk plans, operator wants to review diffs first |
| `approval_required` | (default) Executes non-approval stages automatically, halts before any `approvalRequired=true` task. Operator calls `approveRun` to resume. | HIGH risk, production systems |
| `auto_heal` | All stages executed without pausing. Blocked on `HIGH`/`CRITICAL` risk plans. | LOW/MEDIUM risk, automated remediation |

---

## Stage Execution Map

| Task type | Executor behavior |
|---|---|
| `investigate` | Always passes. Records what was reviewed. |
| `run_command` | Records the command and intent. No shell exec (operator runs manually or via terminal agent). |
| `patch_file` | Calls `patchAssistant.proposePatch()`. In `auto_heal` / after approval: also calls `applyPatch()`. |
| `run_migration` | Always passes with intent note. Never auto-applied (DB migrations require explicit human action). |
| `redeploy` | Calls `deploymentPipeline.createRun()`. In `auto_heal`: also calls `approveRun()` on the pipeline run. |
| `verify` | Calls user-supplied `verifyFn` hook if provided. Otherwise passes with advisory note. |
| `notify` | Always passes. |

---

## Rollback Policy

On any stage failure **after at least one patch has been applied**:
1. `patchAssistant.rollbackPatch(patchId, { approved: true })` for each applied patch (reverse order)
2. `deploymentPipeline.markRolledBack(pipelineRunId, reason)` if a pipeline run exists
3. All rolled-back patch IDs and errors recorded in `rollbackLog[]`
4. Run `outcome` set to `"rolled-back"`, `status` to `"failed"`

---

## Outcome States

| Outcome | Meaning |
|---|---|
| `success` | All stages passed. Incident resolved. Plan marked `done`. |
| `awaiting-approval` | Paused at an approval gate. Call `approveRun` to resume. |
| `rolled-back` | A stage failed. Applied patches reverted. |
| `recommend-only` | Mode was `recommend_only`. No execution. Proposals available for review. |
| `failed` | Stage failed, rollback also failed or no patches to roll back. |

---

## Internal Flag Hygiene

`_applyPatches` and `_verifyFn` are set on the in-memory run object during execution but stripped before storage and return via `_publicRun()`. They never appear in persisted records or HTTP responses.

---

## HTTP Routes Added — `backend/routes/ops.js`

| Method | Path | Description |
|---|---|---|
| `POST` | `/fix-plans/:planId/execute` | Execute a fix plan (body: `{ mode, operatorId }`) |
| `POST` | `/healing-runs/:runId/approve` | Approve a halted run |
| `GET` | `/healing-runs` | List runs (filter: planId, incidentId, outcome, status) |
| `GET` | `/healing-runs/:runId` | Single run by ID |

---

## Files Changed

| File | Change |
|---|---|
| `agents/runtime/selfHealingPipeline.cjs` | New — ~360 lines |
| `backend/routes/ops.js` | +48 lines — 4 healing HTTP routes |
| `tests/runtime/self-healing-pipeline.test.cjs` | New — 9-scenario verification test |
