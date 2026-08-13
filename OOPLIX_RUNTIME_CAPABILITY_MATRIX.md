# OOPLIX RUNTIME CAPABILITY MATRIX
**Phase C.1 Part 3 — functional verification by live execution**

Date: 2026-08-13
Method: 1,010 product GET endpoints executed against a live `backend/server.js` on `:5050`, authenticated as a real registered account (JWT cookie `jarvis_auth`, HS256).

---

## HEADLINE

**915 of 1,010 endpoints returned HTTP 200. Only 752 returned actual data.**

That gap — 163 endpoints returning valid-but-empty responses — is the entire point of this phase. A 200 is not proof of capability.

---

## Functional classification

| # | Class | Count | % of probed |
|---|---|---:|---:|
| 1 | **REAL + WORKING** (200, non-empty payload) | **752** | 74.5% |
| 2 | **REAL + EMPTY STATE** (200, structurally valid, no data) | **163** | 16.1% |
| 4 | REAL + PERMISSION BLOCKED (403) | 52 | 5.1% |
| 9 | NOT FOUND (404) | 20 | 2.0% |
| 4b | REAL + REQUIRES PARAMS (400) | 12 | 1.2% |
| 3 | REAL + CREDENTIAL/BILLING BLOCKED (402) | 7 | 0.7% |
| 5 | **REAL + BROKEN** (500 / hang) | **4** | 0.4% |
| 6 | STUB / PLACEHOLDER | 0 detected | — |

No endpoint returned the SPA HTML fallback *within the probed set* — every probed path was a genuine mounted route.

---

## The 4 genuinely broken endpoints

### 1. `GET /launch/onboarding/all` → 500, 100% failure rate
```
{"error":"Cannot read properties of undefined (reading 'filter')"}
```
**Root cause identified.** [onboardingEngine.cjs:195](backend/services/onboardingEngine.cjs#L195) does `s.steps.filter(...)` for every record in the store. Inspection of `data/onboarding-state.json`: **all 4 persisted records are arrays keyed `0,1,2…`, not objects with a `.steps` property.** Persisted-shape mismatch — the reader expects a shape the writer never produced. Fails every call, not intermittently.

### 2. `GET /computer/dashboard` → 500
```
{"success":false,"error":"Internal server error"}
```
[computerController.js:35](backend/routes/computerController.js#L35) — `_cc()?.getDashboard?.()` optional-chains away a missing controller, but something inside the resolved call throws. Needs a stack trace to pin down; reproduces reliably.

### 3. `GET /coding/smells` → 200 after **35 seconds**, 1.4 MB payload
Scans the entire repository synchronously with no `limit`, pagination, or cache. Returns successfully, so it is *not* broken by status — but it is unusable from a UI and will block a Node worker for 35s per call. Classified BROKEN on operator-usability grounds.

### 4. `GET /collab/active` → 13.2 s (serial, uncontended)
Real data, correct response, far outside interactive latency.

---

## Latency — measured, uncontended

| Percentile | Value |
|---|---:|
| p50 | **1,098 ms** |
| p95 | 2,711 ms |
| p99 | 6,244 ms |
| endpoints > 2 s | 116 |

**A p50 of ~1.1 s for simple reads is a platform-wide finding, not a per-endpoint one.** Over a hundred product endpoints exceed 2 s. This is not a blocker for correctness but is a material operator-experience problem, and it is the kind of thing that only appears under execution — no amount of source reading reveals it.

### Measurement correction worth recording
The first concurrent pass (12 parallel) reported **51 timeouts**. Serial retry showed **46 of those were contention artifacts** — `/collab/active` returns in 108 ms when uncontended, `/commercial/billing/status` in 106 ms. Only 1 genuine hang survived (`/coding/smells`). Reporting 51 broken endpoints would have been wrong. The single-threaded Node event loop under 12-way concurrency was the bottleneck, not the handlers.

---

## Blocked ≠ broken

**52 × HTTP 403 — correct behaviour.** All are operator-tier surfaces refusing a normal user:
```
/integrations, /integrations/summary, /integrations/failures, /integrations/phases
/vault/dashboard, /vault/audit, /vault/env/status, /vault/credential-types  (+44 more)
→ {"error":"Forbidden — operator access required"}
```
These are **working authorization**, not missing capability. A founder-tier account would see them.

**7 × HTTP 402 — working feature gating.** `/marketplace/*` and `/plugins` return `{"error":"feature_gated","featureId":"plugins.marketplace"}` on a trial plan. The billing gate functions as designed.

---

## Data authenticity

Of 915 successful responses, **67 contain residue from previous test runs** — markers like `Smoke Test 1785929196594`, `SimOK 1785929165047`, `Test Objective 1782591078055`, `Evo 1782591078055`.

Affected surfaces include `/aeo/v5/*` (evolutions, experiments, objectives, history, memory), `/ako/v4/objectives`, `/civ/v9/*`, `/eco/v8/*`, `/ent/summary`, `/browser/history`, `/commercial/usage/history`.

**This is not fabricated demo data injected to look impressive** — it is genuine persisted state left behind by smoke tests and the autonomous loop, which was observed actively running during probing (`[AutoLoop] tick — 1 task(s) due`). The distinction matters: the storage and retrieval paths are real and working. But an operator opening these panels today sees test artifacts, not their own business data.

**848 responses were clean** of test markers.

---

## What "REAL + EMPTY STATE" means (163 endpoints)

These returned correct structure with zero content, e.g.:
```json
/business/pipeline → {"success":true,"pipeline":{"prospect":{"count":0,"value":0}, …}}
/growth/dashboard  → {"ok":true,"dashboard":{"kpis":{"totalCampaigns":0,"totalAudiences":0, …}}}
```
**This is correct behaviour for a fresh tenant** — the probe account was created minutes earlier with no data. It is *not* evidence of a stub. But it also means these endpoints are unproven: an empty pipeline does not demonstrate that the pipeline aggregates correctly when populated. Verifying that requires seeded fixtures, which this phase did not create.

**Class 2 should be read as "unproven", not "working".**

---

## Verification boundary

- ✅ 1,010 parameterless product GETs — executed
- ❌ 426 parameterised GETs — not executed (need per-tenant entity IDs)
- ❌ 1,150 mutations — not executed (write safety)
- ❌ Frontend rendering — not verified (no browser automation in this phase)

**39% of the product endpoint surface has runtime proof. 61% does not.** No claim in this document extends beyond what was executed.
