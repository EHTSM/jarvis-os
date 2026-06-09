# V4 Phase 3 — Capability Matrix

**Date:** 2026-06-02

---

## Root Cause Analyzer

| Capability | Implemented | Notes |
|---|---|---|
| **Incident → cause mapping** | ✓ | ruleId → base category, errorCode → refinement |
| — deploy_regression | ✓ | `deploy_failed`, `deploy_rollback` |
| — database_error | ✓ | `DB_*`, `SQL_*`, `MIGRATION_*`, `POOL_*` errorCodes |
| — external_dependency | ✓ | `GATEWAY_*`, `STRIPE_*`, `TIMEOUT`, `/pay*` paths |
| — capacity_error | ✓ | `OOM`, `MEMORY_*`, `RATE_LIMIT*` |
| — config_error | ✓ | `CONFIG_*`, `ENV_*`, `MISSING_KEY` |
| — code_error | ✓ | Default for route/api failures without specific pattern |
| — unknown | ✓ | Fallback when no signal |
| **Deploy correlation** | ✓ | Last `completed` deploy within 10 min, gitHead, deltaMinutes |
| **Route-level impact analysis** | ✓ | Per-route total, errorCount, errorRate, topErrorCodes |
| **File-level impact analysis** | ✓ | route, service, validator, migration files via api-manifests |
| **Component analysis** | ✓ | features, tables, products via manifests |
| **Confidence scoring** | ✓ | 0–98, multi-signal accumulation, never claims 100% |
| **Root cause report generation** | ✓ | Full RcaReport persisted to `data/rca-reports.json` |
| **Recommendations** | ✓ | Cause-category-specific actionable items |
| **Report storage** | ✓ | Ring buffer max 200, atomic write |
| **listReports / getReport** | ✓ | Filter by incidentId, limit |
| **analyzeInline** | ✓ | Works without persisted incident (direct object) |
| **HTTP: POST /incidents/:id/analyze** | ✓ | Triggers pipeline, returns report |
| **HTTP: GET /incidents/:id/rca** | ✓ | Most recent report for incident |
| **HTTP: GET /rca-reports** | ✓ | All reports with filters |
| **HTTP: GET /rca-reports/:rcaId** | ✓ | Single report by ID |
| **Auth guard** | ✓ | All routes behind `requireAuth` + `operatorAudit` |
| **Reuses telemetryEngine** | ✓ | `getHistory()`, `getDeployHistory()` |
| **Reuses incidentEngine** | ✓ | `getIncident()` |
| **Reuses manifests** | ✓ | api, db, product manifests |
| **No new architecture** | ✓ | Single file, no new agents, no services |
| **No AI calls** | ✓ | Pure deterministic pattern matching |

---

## Verification Test Coverage

| Scenario | Signals Tested | Assertions |
|---|---|---|
| Failed deploy → deploy_regression | ruleId map, deploy correlation, gitHead | 9 |
| DB_ERROR codes → database_error | errorCode refinement, file analysis, component analysis | 7 |
| Route 100% failure → code_error | route analysis, errorRate, file mapping | 9 |
| GATEWAY_FAIL → external_dependency | path pattern matching, recommendations | 4 |
| Multi-signal confidence | accumulation, cap at 98, gitHead from prior deploy | 5 |
| analyzeInline | direct object input, manifest lookup, persistence | 7 |
| listReports / getReport | storage, filter by incidentId, getReport, null case | 7 |
| **Total** | | **54/54** |

---

## Data Flow

```
Incident (from incidentEngine)
       │
       ▼
rootCauseAnalyzer.analyze(incidentId)
       │
       ├── telemetryEngine.getHistory()        → raw events
       ├── telemetryEngine.getDeployHistory()  → deploy events
       │
       ├── Step 1: causeMapping
       │     ruleId → base { category, summary, detail, baseConfidence }
       │     errorCode patterns → refine category
       │
       ├── Step 2: deployCorrelation
       │     last completed deploy within 10 min → { correlated, gitHead, deltaMinutes }
       │
       ├── Step 3: routeAnalysis
       │     per-path { total, errors, errorRate, topErrorCodes }
       │
       ├── Step 4: fileAnalysis
       │     api-manifests × affectedRoutes → { filePath, role, feature }
       │
       ├── Step 5: componentAnalysis
       │     manifests × routes × blueprintId → { type, name, detail }
       │
       ├── Step 6: confidenceScoring
       │     accumulate signals → Math.min(sum, 98)
       │
       └── Step 7: reportGeneration
             assemble RcaReport → data/rca-reports.json
```

---

## V4 Stack — Phases 1–3

| Layer | Module | What it does |
|---|---|---|
| Event store | `telemetryEngine.cjs` | Records deploys, API events, page views. Ring buffer. Health summary. |
| Incident detection | `incidentEngine.cjs` | 10 rules. Dedup. Lifecycle. `data/incidents.json`. |
| Root cause analysis | `rootCauseAnalyzer.cjs` | Cause mapping. File/route/component impact. Confidence. `data/rca-reports.json`. |

**Full pipeline:**
```
recordDeploy() / recordApiError()
  → telemetryEngine._appendEvent()
      → _recomputeSummary()
      → [throttled] incidentEngine.detect()
          → 10 rules fire
          → incidents opened/updated/auto-resolved
          → POST /incidents/:id/analyze (operator-triggered or automated)
              → rootCauseAnalyzer.analyze()
                  → RcaReport { cause, confidence, routes, files, components, recommendations }
```

---

## Phase Completion Checklist

| Requirement | Done |
|---|---|
| Incident → probable cause mapping | ✓ 7 categories, errorCode refinement |
| File-level impact analysis | ✓ route/service/migration files via api-manifests |
| Route-level impact analysis | ✓ per-route error rates + error codes |
| Deployment correlation | ✓ 10-min window, gitHead, deltaMinutes |
| Confidence scoring | ✓ 0–98, multi-signal |
| Root cause report generation | ✓ full RcaReport, persisted |
| Verify: failed deploy analysis | ✓ Scenario 1 |
| Verify: API spike analysis | ✓ Scenarios 2, 4 |
| Verify: route failure analysis | ✓ Scenario 3 |
| Verify: confidence scoring | ✓ Scenario 5 |
| Implementation Report | ✓ `V4_PHASE3_IMPLEMENTATION_REPORT.md` |
| Execution Trace | ✓ `V4_PHASE3_EXECUTION_TRACE.md` |
| Updated Capability Matrix | ✓ this file |
