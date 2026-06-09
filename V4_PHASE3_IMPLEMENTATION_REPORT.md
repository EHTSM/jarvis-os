# V4 Phase 3 — Root Cause Analyzer
## Implementation Report

**Date:** 2026-06-02  
**Branch:** cleanup/runtime-minimization  
**Status:** COMPLETE — 54/54 assertions pass

---

## Mission

An incident record becomes a probable root cause report. No AI. No new agents. Pure signal → structured analysis.

---

## What Was Built

### 1. Root Cause Analyzer — `agents/runtime/rootCauseAnalyzer.cjs`

Single new file (362 lines). Full RCA pipeline from incident → report.

**Entry points:**

| Function | Purpose |
|---|---|
| `analyze(incidentId, opts)` | Run full RCA for a persisted incident |
| `analyzeInline(incident, opts)` | Same but takes an object directly (no store lookup) |
| `listReports(opts)` | List persisted RCA reports |
| `getReport(rcaId)` | Retrieve one report by ID |

**Reuses (no new storage or agents):**
- `telemetryEngine.getHistory()` — raw events for route/file analysis
- `telemetryEngine.getDeployHistory()` — deploy correlation window
- `incidentEngine.getIncident()` — incident record lookup
- `data/api-manifests.json` — route → source file mapping
- `data/db-manifests.json` — table dependency graph
- `data/product-manifests.json` — product → feature mapping
- `data/page-manifests.json` — page → route binding

**Storage:** `data/rca-reports.json` — ring buffer, max 200, atomic write

---

## RCA Pipeline

```
analyze(incidentId)
  │
  ├── 1. causeMapping        — ruleId + errorCode patterns → cause category
  ├── 2. deployCorrelation   — last completed deploy within 10 min of incident open
  ├── 3. routeAnalysis       — per-route error counts, rates, top error codes
  ├── 4. fileAnalysis        — cross-ref routes with api-manifests → source files
  ├── 5. componentAnalysis   — features, tables, services from manifests
  ├── 6. confidenceScoring   — accumulate signals → 0-98 score
  └── 7. reportGeneration    — assemble + persist RcaReport
```

---

## Cause Categories

| Category | Trigger | Example errorCodes |
|---|---|---|
| `deploy_regression` | `deploy_failed`, `deploy_rollback` | — |
| `database_error` | `DB_*`, `SQL_*`, `MIGRATION_*`, `POOL_*` | `DB_CONNECTION_FAILED`, `DB_TIMEOUT` |
| `external_dependency` | `GATEWAY_*`, `STRIPE_*`, `RAZORPAY_*`, `TIMEOUT`, payment paths | `GATEWAY_TIMEOUT`, `GATEWAY_FAIL` |
| `capacity_error` | `OOM`, `MEMORY_*`, `RATE_LIMIT*`, `slow_api`, `deploy_slow` | `DB_OOM`, `RATE_LIMIT_EXCEEDED` |
| `config_error` | `CONFIG_*`, `ENV_*`, `MISSING_KEY` | `CONFIG_MISSING` |
| `code_error` | `route_failure`, `api_error_spike`, `api_repeated_error` (default) | `UNHANDLED_ERROR`, `NOT_FOUND` |
| `unknown` | No matching rule | — |

Category is first assigned from `ruleId` (base), then **refined** by majority errorCode pattern across all error events in the window. The most frequent pattern wins.

---

## Confidence Scoring

| Signal | Points |
|---|---|
| Base confidence (by ruleId) | +20–60 |
| Deploy correlated within 10 min | +20 |
| Correlated deploy was failed/rolled-back | +5 |
| Route with 100% failure rate (≥2 calls) | +10 |
| errorCode pattern matches inferred category | +10 |
| Affected source files found in manifests | +5 |
| Evidence depth ≥ 3 items | +5 |
| Incident occurrences ≥ 3 | +5 |
| Total error count ≥ 10 | +5 |
| **Cap** | 98 (never 100%) |

---

## Deploy Correlation Fix

Initial implementation picked the most recent deploy (any phase) — which could be the failing deploy itself (no gitHead). Fixed to prefer `phase: "completed"` deploys first (most informative for gitHead), falling back to failed/rolled-back. This correctly identifies the last stable deploy before an incident opened.

---

## HTTP Routes Added — `backend/routes/ops.js`

| Method | Path | Description |
|---|---|---|
| `POST` | `/incidents/:id/analyze` | Run RCA, return + persist report |
| `GET` | `/incidents/:id/rca` | Most recent RCA for an incident |
| `GET` | `/rca-reports` | List all RCA reports (filter: incidentId, limit) |
| `GET` | `/rca-reports/:rcaId` | Single report by ID |

All routes authenticated via existing `requireAuth` + `operatorAudit` gate. `_rca` loaded lazily with null-guard so missing module never crashes the server.

---

## RcaReport Schema

```json
{
  "rcaId":        "rca_1780394321927",
  "incidentId":   "inc_1780394321927",
  "analyzedAt":   "2026-06-02T10:00:00.000Z",
  "windowMins":   60,
  "incident":     { "ruleId": "deploy_failed", "title": "...", "severity": "HIGH", "status": "open", "openedAt": "..." },
  "cause": {
    "category":   "deploy_regression",
    "summary":    "Deploy failure — new code or config introduced a regression",
    "detail":     "..."
  },
  "confidence":   80,
  "deployCorrelation": {
    "correlated":     true,
    "deployId":       "tel_prior_1",
    "gitHead":        "abc1234",
    "deltaMinutes":   5,
    "deployOk":       true,
    "phase":          "completed",
    "productName":    "TestProduct"
  },
  "affectedRoutes": [
    { "path": "/api/plans", "total": 8, "errorCount": 4, "errorRate": 50, "topErrorCodes": [{"code": "DB_CONNECTION_FAILED", "count": 4}] }
  ],
  "affectedFiles": [
    { "filePath": "backend/routes/plan-management.js", "role": "route", "feature": "plan-management" },
    { "filePath": "backend/services/plan-management.js", "role": "service", "feature": "plan-management" },
    { "filePath": "backend/db/migrations/001_plans.sql", "role": "migration", "feature": "plan-management" }
  ],
  "affectedComponents": [
    { "type": "feature",  "name": "Plan Management", "detail": "GET /api/plans" },
    { "type": "table",    "name": "plans",            "detail": "accessed by /api/plans" },
    { "type": "product",  "name": "TestProduct",      "detail": "status: assembled" }
  ],
  "recommendations": [
    "Check database connectivity: pg_isready / mysql ping.",
    "Review migration status — a pending or failed migration may have left tables in inconsistent state.",
    "Review migration files: backend/db/migrations/001_plans.sql"
  ]
}
```

---

## Files Changed

| File | Change |
|---|---|
| `agents/runtime/rootCauseAnalyzer.cjs` | New — 362 lines |
| `backend/routes/ops.js` | +44 lines — 4 RCA HTTP routes |
| `tests/runtime/root-cause-analyzer.test.cjs` | New — 7 scenario verification test |
