# V4 Phase 5 — Capability Matrix

**Date:** 2026-06-02

---

## Self-Healing Pipeline

| Capability | Implemented | Notes |
|---|---|---|
| **Fix plan execution** | ✓ | `executePlan()` walks task graph in seq/dependsOn order |
| **Patch generation** | ✓ | `patch_file` tasks call `patchAssistant.proposePatch()` |
| **Patch application** | ✓ | `applyPatch()` called in `auto_heal` mode or after `approveRun` |
| **Patch approval gates** | ✓ | `approval_required` mode halts at `approvalRequired=true` tasks |
| **Approval resume** | ✓ | `approveRun(runId)` resumes from halted stage |
| **Verification execution** | ✓ | `verify` tasks call user-supplied `verifyFn` hook |
| **Deployment execution** | ✓ | `redeploy` tasks call `deploymentPipeline.createRun()` |
| **Rollback on failure** | ✓ | All applied patches reversed (reverse order) on stage failure |
| **Pipeline rollback** | ✓ | `deploymentPipeline.markRolledBack()` called on failure |
| **Incident auto-resolve** | ✓ | `incidentEngine.resolve()` called on `success` |
| **Plan status update** | ✓ | `autoFixPlanner.updateStatus("done")` called on success |
| **Healing history storage** | ✓ | `data/healing-runs.json`, max 100, atomic write |
| **recommend_only mode** | ✓ | Proposals only, nothing applied, all stages skipped |
| **approval_required mode** | ✓ | (default) Halts at approval gates |
| **auto_heal mode** | ✓ | Full automation, blocked on HIGH/CRITICAL risk |
| **auto_heal safety gate** | ✓ | Returns error for HIGH/CRITICAL risk — never auto-applies |
| **Internal flag hygiene** | ✓ | `_applyPatches`, `_verifyFn` stripped before storage/return |
| **dependsOn ordering** | ✓ | Stages skipped if dependencies not passed |
| **HTTP: POST /fix-plans/:planId/execute** | ✓ | Mode in request body |
| **HTTP: POST /healing-runs/:runId/approve** | ✓ | Resume halted run |
| **HTTP: GET /healing-runs** | ✓ | List with planId/incidentId/outcome/status filters |
| **HTTP: GET /healing-runs/:runId** | ✓ | Single run by ID |
| **Auth guard** | ✓ | All routes behind requireAuth + operatorAudit |
| **Reuses patchAssistant** | ✓ | proposePatch, applyPatch, rollbackPatch |
| **Reuses patchExecutionEngine** | ✓ | Available for multi-file batch (proposeBatch) |
| **Reuses deploymentPipeline** | ✓ | createRun, approveRun, markRolledBack |
| **Reuses autoFixPlanner** | ✓ | getPlan, updateStatus |
| **Reuses incidentEngine** | ✓ | resolve() on success |
| **No new architecture** | ✓ | Single file, no new agents |
| **No AI calls** | ✓ | Pure execution graph |

---

## Verification Test Coverage

| Scenario | What's Tested | Assertions |
|---|---|---|
| code_error auto_heal | All 6 stages pass, patchIds, pipelineRunId, field hygiene | 11 |
| deploy_regression auto_heal | run_command tasks, redeploy, pipeline run in dp store | 6 |
| database_error auto_heal | run_migration + patch_file + redeploy chain | 5 |
| approval_required halts | Stage 1 passes, stage 2 awaiting-approval, persisted | 5 |
| approveRun resumes | Resume from gate, all stages pass, patchIds after approve | 5 |
| Failed verify → rollback | outcome=rolled-back, rollbackLog, patchAssistant rollback | 6 |
| recommend_only | All skipped, no applied patches, patchIds array present | 5 |
| auto_heal blocked HIGH risk | Error returned, no run created | 3 |
| listHealingRuns / getHealingRun | List, filter, getById, null for missing | 5 |
| **Total** | | **51/51** |

---

## Complete V4 Pipeline — Phases 1–5

```
recordDeploy() / recordApiError()
  │
  ▼ [auto, throttled 60s]
incidentEngine.detect()
  │  10 rules, dedup, lifecycle
  ▼
incidents.json  ← open/escalated incidents
  │
  ▼ [operator: POST /incidents/:id/analyze]
rootCauseAnalyzer.analyze()
  │  cause, confidence, files, routes, components
  ▼
rca-reports.json
  │
  ▼ [operator: POST /rca-reports/:rcaId/plan]
autoFixPlanner.planInline()
  │  strategy, tasks, pipeline, risk, confidence
  ▼
fix-plans.json
  │
  ▼ [operator: POST /fix-plans/:planId/execute]
selfHealingPipeline.executePlan({ mode })
  │
  ├── recommend_only → patch proposals only, no execution
  ├── approval_required → halts at approval gates
  │     POST /healing-runs/:runId/approve → resume
  └── auto_heal (LOW/MEDIUM only) → full automation
        │
        ├── investigate stages → pass (record intent)
        ├── run_command stages → pass (stage for terminal)
        ├── patch_file stages → patchAssistant.applyPatch()
        ├── run_migration → pass (intent recorded)
        ├── redeploy → deploymentPipeline.createRun()
        └── verify → verifyFn hook / advisory
              │
              ├── PASS → incidentEngine.resolve()
              │         autoFixPlanner.updateStatus("done")
              │         healing-runs.json ← outcome=success
              └── FAIL → patchAssistant.rollbackPatch() (all, reverse order)
                         deploymentPipeline.markRolledBack()
                         healing-runs.json ← outcome=rolled-back
```

---

## Phase Completion Checklist

| Requirement | Done |
|---|---|
| Fix plan execution | ✓ |
| Patch generation | ✓ patchAssistant.proposePatch |
| Patch approval gates | ✓ approval_required mode, approveRun |
| Verification execution | ✓ verifyFn hook + advisory default |
| Deployment execution | ✓ deploymentPipeline.createRun |
| Rollback on failure | ✓ reverse-order patch rollback + pipeline markRolledBack |
| Healing history storage | ✓ data/healing-runs.json |
| recommend_only mode | ✓ |
| approval_required mode | ✓ |
| auto_heal mode | ✓ with HIGH/CRITICAL safety gate |
| Verify: code_error healing | ✓ Scenario 1 |
| Verify: deploy_regression healing | ✓ Scenario 2 |
| Verify: database_error healing | ✓ Scenario 3 |
| Verify: failed verification rollback | ✓ Scenario 6 |
| Verify: successful redeploy | ✓ Scenarios 1, 2, 3 (pipelineRunId set) |
| Implementation Report | ✓ `V4_PHASE5_IMPLEMENTATION_REPORT.md` |
| Capability Matrix | ✓ this file |
