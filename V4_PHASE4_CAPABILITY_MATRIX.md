# V4 Phase 4 — Capability Matrix

**Date:** 2026-06-02

---

## Auto-Fix Planner

| Capability | Implemented | Notes |
|---|---|---|
| **RCA → fix strategy mapping** | ✓ | 7 cause categories, deterministic |
| — deploy_regression | ✓ | revert-or-fix, git show/revert tasks, safe-update pipeline |
| — database_error | ✓ | migration-repair, run_migration first, standard-deploy |
| — external_dependency | ✓ | circuit-break-and-degrade, retry/fallback tasks, no pipeline |
| — config_error | ✓ | env-fix-and-restart, .env patch + restart, LOW risk |
| — code_error | ✓ | patch-and-redeploy, handler patch + test run, safe-update |
| — capacity_error | ✓ | optimize-and-scale, query profiling tasks |
| — unknown | ✓ | manual-triage, debug logging, re-detect |
| **File-level patch targets** | ✓ | From RCA affectedFiles + db-manifests migrations |
| — Priority ordering | ✓ | migration→service→route→validator→middleware |
| — Action assignment | ✓ | run_migration for migrations, patch_file for code |
| **Task graph generation** | ✓ | Ordered, dependsOn chains, per-cause sequences |
| — Task types | ✓ | investigate, run_command, patch_file, run_migration, redeploy, verify, notify |
| — Approval flags | ✓ | patch_file/run_migration/redeploy always require approval |
| — estimatedMins | ✓ | Per task type defaults |
| — dependsOn wiring | ✓ | Linear chains within each cause block |
| **Pipeline selection** | ✓ | safe-update / standard-deploy / null by cause |
| — Reuses deploymentPipeline.PIPELINES | ✓ | Name + label resolved at plan time |
| **Confidence scoring** | ✓ | 10–98, inherits RCA base, adjusts for target availability |
| **Risk assessment** | ✓ | LOW/MEDIUM/HIGH/CRITICAL + risk factors |
| — Takes higher of cause-risk and severity-risk | ✓ | |
| — Risk factors list | ✓ | DB downtime, caller impact, customer impact |
| **suggestedChanges** | ✓ | 4–6 human-readable action items per strategy |
| **Patch registration (optional)** | ✓ | registerPatches=true calls patchAssistant.proposePatch |
| **Plan lifecycle** | ✓ | draft → approved → executing → done / abandoned |
| **Plan storage** | ✓ | data/fix-plans.json, ring buffer 100, atomic write |
| **HTTP: POST /rca-reports/:rcaId/plan** | ✓ | Generate plan from stored RCA |
| **HTTP: GET /fix-plans** | ✓ | List with rcaId/incidentId/status/limit filters |
| **HTTP: GET /fix-plans/:planId** | ✓ | Single plan by ID |
| **HTTP: PATCH /fix-plans/:planId/status** | ✓ | Lifecycle status update |
| **Auth guard** | ✓ | All routes behind requireAuth + operatorAudit |
| **Reuses rootCauseAnalyzer** | ✓ | getReport() as input |
| **Reuses patchAssistant** | ✓ | proposePatch() for patch registration |
| **Reuses deploymentPipeline** | ✓ | PIPELINES for pipeline selection |
| **Reuses api-manifests** | ✓ | Route → file mapping for targets |
| **Reuses db-manifests** | ✓ | Table → migration file mapping |
| **No AI calls** | ✓ | Pure deterministic rule mapping |
| **No new architecture** | ✓ | Single file, no new agents |

---

## Verification Test Coverage

| Scenario | Cause Tested | Assertions |
|---|---|---|
| deploy_regression plan | revert task, pipeline, git command, approval gates | 15 |
| database_error plan | migration priority, service patch, risk factors | 10 |
| code_error plan (route failure) | route+service patches, test task, ordering | 9 |
| external_dependency plan | no pipeline, retry tasks, MEDIUM risk | 7 |
| config_error plan | .env patch, restart command, LOW risk | 7 |
| Confidence scoring | high-signal 98, low-signal 20, cap | 4 |
| Storage + lifecycle | listPlans, getPlan, updateStatus, filter | 9 |
| **Total** | | **61/61** |

---

## Full V4 Stack — Phases 1–4

| Layer | Module | Output |
|---|---|---|
| Events | `telemetryEngine` | Ring buffer, health summary, auto-trigger |
| Detection | `incidentEngine` | 10 rules, dedup, lifecycle → `incidents.json` |
| Analysis | `rootCauseAnalyzer` | Cause, confidence, files, routes → `rca-reports.json` |
| Planning | `autoFixPlanner` | Tasks, pipeline, risk, patches → `fix-plans.json` |

**End-to-end pipeline:**
```
recordDeploy() / recordApiError()
  → incidentEngine.detect()              [auto, throttled]
      → incident opened (HIGH/CRITICAL)
          → rootCauseAnalyzer.analyze()  [operator or automated]
              → cause=deploy_regression, confidence=80
                  → autoFixPlanner.plan()
                      → FixPlan {
                          strategy: revert-or-fix,
                          risk: HIGH,
                          tasks: [investigate, git show, git revert, patch, redeploy, verify],
                          pipeline: safe-update,
                          targetFiles: [route.js, service.js],
                          confidence: 85
                        }
```

---

## Phase Completion Checklist

| Requirement | Done |
|---|---|
| RCA → fix strategy mapping | ✓ 7 categories |
| File-level patch targets | ✓ priority-ordered, action-typed |
| Task generation | ✓ typed, ordered, with dependsOn |
| Patch plan generation | ✓ full FixPlan with all required fields |
| Confidence scoring | ✓ inherits RCA, adjusts for actionability |
| Fix recommendation storage | ✓ data/fix-plans.json |
| Plan for deploy_regression | ✓ Scenario 1 |
| Plan for database_error | ✓ Scenario 2 |
| Plan for route_failure (code_error) | ✓ Scenario 3 |
| Plan for config_error | ✓ Scenario 5 |
| Plan for code_error | ✓ Scenario 3 |
| Plan for external_dependency | ✓ Scenario 4 |
| Verify: deploy regression plan | ✓ 15 assertions |
| Verify: API route failure plan | ✓ 9 assertions |
| Verify: database error plan | ✓ 10 assertions |
| Verify: confidence scoring | ✓ 4 assertions |
| Implementation Report | ✓ `V4_PHASE4_IMPLEMENTATION_REPORT.md` |
| Capability Matrix | ✓ this file |
