# V4 Phase 4 — Auto-Fix Planner
## Implementation Report

**Date:** 2026-06-02  
**Branch:** cleanup/runtime-minimization  
**Status:** COMPLETE — 61/61 assertions pass

---

## Mission

A root cause report becomes a structured engineering fix plan. No AI. No new agents. Deterministic strategy mapping from cause category to ordered task graph.

---

## What Was Built

### `agents/runtime/autoFixPlanner.cjs` — 7-step planning pipeline

| Entry Point | Purpose |
|---|---|
| `plan(rcaId, opts)` | Generate fix plan for a stored RCA report |
| `planInline(rcaReport, opts)` | Same but accepts report object directly |
| `getPlan(planId)` | Retrieve one plan by ID |
| `listPlans(opts)` | List plans (filter: rcaId, incidentId, status) |
| `updateStatus(planId, newStatus)` | Advance plan lifecycle |

**Reuses:**
- `rootCauseAnalyzer.getReport()` — reads stored RCA as input
- `incidentEngine.getIncident()` — incident context (via RCA)
- `patchAssistant.proposePatch()` — registers patch proposals (optional, via `registerPatches` flag)
- `deploymentPipeline.PIPELINES` — pipeline names and labels for redeploy tasks
- `data/api-manifests.json` — route → file mapping for target identification
- `data/db-manifests.json` — table schema for migration targeting

**Storage:** `data/fix-plans.json` — ring buffer max 100, atomic write

---

## Planning Pipeline

```
planInline(rcaReport)
  │
  ├── 1. strategyMapping     — cause.category → { approach, rationale, suggestedChanges[] }
  ├── 2. targetFiles         — RCA affectedFiles + db-manifest migrations, sorted by priority
  ├── 3. taskGraph           — ordered tasks with type, dependsOn, estimatedMins, approvalRequired
  ├── 4. pipelineSelection   — safest pipeline per cause category
  ├── 5. confidenceScoring   — inherit RCA confidence, adjust for actionability
  ├── 6. riskAssessment      — HIGH of (cause risk, severity risk) + risk factors
  └── 7. planGeneration      — assemble FixPlan + persist to data/fix-plans.json
```

---

## Strategy Map

| Cause Category | Approach | Pipeline | Risk |
|---|---|---|---|
| `deploy_regression` | revert-or-fix | safe-update | HIGH |
| `database_error` | migration-repair | standard-deploy | HIGH |
| `external_dependency` | circuit-break-and-degrade | none | MEDIUM |
| `config_error` | env-fix-and-restart | safe-update | LOW |
| `code_error` | patch-and-redeploy | safe-update | MEDIUM |
| `capacity_error` | optimize-and-scale | safe-update | LOW |
| `unknown` | manual-triage | none | MEDIUM |

---

## Task Types

| Type | Description | Approval Required |
|---|---|---|
| `investigate` | Read logs, check status — no change | No |
| `run_command` | git, pm2, curl — shell command | Context-dependent |
| `patch_file` | Edit a source file | Always yes |
| `run_migration` | Apply DB migration | Always yes |
| `redeploy` | Trigger named pipeline | Always yes |
| `verify` | Health check or test run | No |
| `notify` | Alert the team | No |

---

## Task Graph Examples

**deploy_regression (gitHead=abc1234):**
```
1. investigate   — Review incident timeline           (no approval)
2. run_command   — git show abc1234 --stat            (no approval, dependsOn:[1])
3. run_command   — git revert abc1234 --no-edit       (APPROVAL, dependsOn:[2])
4. patch_file    — Fix regression in route file       (APPROVAL, dependsOn:[3])
5. patch_file    — Fix regression in service file     (APPROVAL, dependsOn:[4])
6. redeploy      — Run safe-update pipeline           (APPROVAL, dependsOn:[5])
7. verify        — GET /health, check incidents       (no approval, dependsOn:[6])
```

**database_error:**
```
1. investigate   — Review incident timeline           (no approval)
2. investigate   — Check database connectivity        (no approval, dependsOn:[1])
3. run_migration — Apply migration 001_plans.sql      (APPROVAL, dependsOn:[2])
4. patch_file    — Add connection error handling      (APPROVAL, dependsOn:[3])
5. redeploy      — Run standard-deploy pipeline       (APPROVAL, dependsOn:[4])
6. verify        — GET /health, check incidents       (no approval, dependsOn:[5])
```

---

## Confidence Scoring

Inherits RCA confidence as the base, then adjusts:

| Signal | Delta |
|---|---|
| ≥ 3 target files found | +5 |
| 0 target files found | -10 |
| Deploy correlated + gitHead present | +5 |
| ≥ 4 tasks generated | +5 |
| 0 affected routes | -5 |
| Cap | 98 |

---

## HTTP Routes Added — `backend/routes/ops.js`

| Method | Path | Description |
|---|---|---|
| `POST` | `/rca-reports/:rcaId/plan` | Generate fix plan from an RCA report |
| `GET` | `/fix-plans` | List plans (filter: rcaId, incidentId, status) |
| `GET` | `/fix-plans/:planId` | Single plan by ID |
| `PATCH` | `/fix-plans/:planId/status` | Update lifecycle status |

---

## Bug Fixed During Implementation

`autoFixPlanner.cjs` line 383: variable `tf` in outer `for...of` loop was shadowed by same name in inner `.filter()` callback:
```js
// Before (broken):
for (const tf of targetFiles.filter(f => f.action === "patch_file" && tf.role === "service"))
// After:
for (const tf of targetFiles.filter(f => f.action === "patch_file" && f.role === "service"))
```

---

## Files Changed

| File | Change |
|---|---|
| `agents/runtime/autoFixPlanner.cjs` | New — ~460 lines |
| `backend/routes/ops.js` | +48 lines — 4 fix-plan HTTP routes |
| `tests/runtime/auto-fix-planner.test.cjs` | New — 7-scenario verification test |
