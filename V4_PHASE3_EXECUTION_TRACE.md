# V4 Phase 3 — Execution Trace

**Date:** 2026-06-02

---

## Step 1 — Audit Existing Code

**Found:**
- `evaluation/rootCauseGraph.cjs` — workflow-level causality graph (step A caused step B). Unrelated to operational telemetry. Not reused.
- `data/api-manifests.json` — real data: route → file mapping with migrations, feature names, tables. Usable.
- `data/db-manifests.json` — real data: table schemas with FK dependencies. Usable.
- `data/product-manifests.json` — real data: product readiness status. Usable.
- `data/page-manifests.json` — real data: page → API bindings. Not used in phase 3 (no page-level RCA needed yet).
- `agents/runtime/incidentEngine.cjs` — complete from Phase 2. `getIncident()` and `getHistory()` available.
- `agents/runtime/telemetryEngine.cjs` — complete. `getHistory()`, `getDeployHistory()` available.

**Gap:** No RCA engine. No HTTP routes for it.

---

## Step 2 — Design Decisions

**Cause refinement:** Base category comes from `ruleId` (deploy_failed → deploy_regression). Then errorCode patterns across all error events in the window can override it. This handles the common case where `api_error_spike` fired but the real cause is `database_error` because all errors carry `DB_CONNECTION_FAILED`.

**Deploy correlation:** Look for the last `completed` deploy before the incident opened (within 10 min). Not the `failed` deploy (that's the incident itself). Fixed during implementation after discovering that the failing deploy event was being selected as the "correlated" deploy, rendering gitHead null.

**File analysis:** Cross-reference affected route paths against `api-manifests.json`. Path matching uses prefix normalization (strip `/:param` suffixes) to handle parameterized routes. Returns route files, service files, validators, error middleware, and migrations.

**Confidence cap:** Hard-capped at 98. The engine never claims certainty because: (1) errorCode taxonomy is app-defined, not exhaustive; (2) manifest data may be stale; (3) timing correlation is probabilistic.

**No AI:** All logic is deterministic pattern matching. Output is reproducible given the same input state.

---

## Step 3 — Implementation

Written `agents/runtime/rootCauseAnalyzer.cjs` as a pure pipeline function. Each step receives the output of the previous step. No shared mutable state. Lazy `require()` of engines to avoid circular dependencies at module load time.

---

## Step 4 — HTTP Routes

Added 4 routes to `backend/routes/ops.js`:
- `POST /incidents/:id/analyze` — triggers the pipeline, returns the full report
- `GET /incidents/:id/rca` — reads back the most recent report
- `GET /rca-reports` — list with optional incidentId filter
- `GET /rca-reports/:rcaId` — single report

Pattern: `_rca` lazy-loaded at module init with null fallback — consistent with how `_inc` and `_autoAgent` are loaded in the same file.

---

## Step 5 — Verification Test

7 scenarios, 54 assertions. Data isolation via fs path remapping to `mkdtemp`. Synthetic `api-manifests.json` and `db-manifests.json` written to the tmp dir so file/component analysis can be tested without real production data.

**Test trace (Scenario 2 — DB_ERROR):**
```
tel.recordApiError({ errorCode: "DB_CONNECTION_FAILED", path: "/api/plans" }) × 4

incidentEngine.detect():
  api_error_spike opened [CRITICAL]
  api_repeated_error opened [MEDIUM]
  health_critical opened [CRITICAL]

rootCauseAnalyzer.analyze("api_error_spike_incident"):
  causeMapping:
    ruleId=api_error_spike → base category=code_error, baseConfidence=45
    errorEvents: 4× DB_CONNECTION_FAILED → matches /^DB_/ → database_error
    refinedCategory = database_error ✓
  deployCorrelation:
    no deploy in window → correlated=false
  routeAnalysis:
    /api/plans: total=8, errors=4, errorRate=50%, topErrorCodes=[{DB_CONNECTION_FAILED:4}]
  fileAnalysis:
    api-manifests match /api/plans → route, service, validator, migration files
  componentAnalysis:
    feature: "Plan Management"
    table: "plans"
    product: "TestProduct"
  confidenceScoring:
    base=45, codeMatch+10, fileFound+5 = 60
  recommendations:
    "Check database connectivity..."
    "Review migration files: backend/db/migrations/001_plans.sql"

Result: cause=database_error, confidence=60, 3 files, 3 components ✓
```

**Test trace (Scenario 5 — confidence accumulation):**
```
Prior deploy (ok=true, gitHead="deadbeef") written at t-3min
tel.recordDeploy({ phase:"failed", ok:false }) at t=now
3× DB_OOM errors on /api/plans

deploy_failed incident opened

rca.analyze():
  causeMapping: deploy_regression → refined by DB_OOM → database_error (DB_ prefix)
  deployCorrelation: prior completed deploy found at t-3min → correlated=true, gitHead="deadbeef"
  route: /api/plans 100% failing
  
  confidenceScoring:
    database_error baseConfidence=40  (api_repeated_error base is 40, but deploy_failed base=55)
    → actually deploy_failed base=55
    deployCorrelated +20
    failedDeploy +5
    route 100% +10
    codeMatch (DB_OOM→database_error, but cause=database_error) +10
    fileFound +5
    evidence depth +5
    Total: 55+20+5+10+10+5 = 105 → capped at 98 ✓
```

---

## Run the tests yourself

```bash
node tests/runtime/root-cause-analyzer.test.cjs
```

Expected output:
```
────────────────────────────────────────
ROOT CAUSE ANALYZER TEST RESULTS
  Passed: 54
  Failed: 0
  Total:  54
────────────────────────────────────────
All assertions passed.
```
