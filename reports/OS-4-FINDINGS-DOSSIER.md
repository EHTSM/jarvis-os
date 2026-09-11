# OS-4 FINDINGS DOSSIER

Date: 2026-08-13

---

## OS4-001 — Distribution analytics reported fabricated engagement as measured
**HIGH — continuation of the OS-3 defect class, in the read path**

| Field | Value |
|---|---|
| **OS** | Marketing / Cloud (shared analytics surface) |
| **Workflow** | `GET /distrib/analytics` |
| **Reproduction** | Authenticated GET after OS-3's publish fix |
| **Evidence** | `{"totalReach":7280,"totalEngagement":306,"engagementRate":"4.20"}` — **4.20 IS the 0.042 multiplier**, echoed back as an observed rate |
| **Root cause** | OS-3 fixed `publishJob()` (the writer) but not `getDistributionAnalytics()` (the reader). It still summed pre-fix `stats.reach` and **re-derived** per-platform engagement/shares as `perPlatformReach × 0.042 / × 0.008` at [distributionEngine.cjs:741-745](backend/services/distributionEngine.cjs#L741). No platform analytics API is consumed anywhere in the module. |
| **Impact** | The dashboard presented invented reach, engagement, shares, clicks and an engagement rate as measured marketing performance. Reportable to an investor. |
| **Fix** | `totalReach/Engagement/Shares/Clicks/engagementRate/viralityScore` → `null`; added `measured:false` + `measurementNote`; pre-fix residue moved under `legacy` with an explicit note; per-platform derivation removed and `legacyReach` labelled. |
| **Verification** | Live: `{"totalReach":null,…,"measured":false,"measurementNote":"No platform analytics connector is configured…"}` |
| **Regression** | `93-os2-os3-fake-success-protection.cjs` — 2 new assertions |
| **Classification** | **FIXED** |

---

## OS4-002 — Product validation avgScore of 234 on a 0–100 scale
**MEDIUM — impossible metric surfaced on a dashboard**

| Field | Value |
|---|---|
| **OS** | Developer / Cloud (Product Factory) |
| **Workflow** | `GET /product-factory/dashboard` → `summary.avgValidationScore` |
| **Reproduction** | Authenticated GET; also `productValidationEngine.getStats()` |
| **Evidence** | `avgValidationScore: 234` — exceeds its own maximum |
| **Root cause** | 5 records written **2026-06-29** carry out-of-range dimension scores (`tests: 10000`, `security: 600`) from before the clamps in `_validateTests`/`_validateSecurity` existed. Their `overallScore` values (2193, 2058, 2053…) dominated the mean of 67 records. **The generator is already correct** — the newest record (2026-08-05) scores 87. Only the aggregate still reported the corrupt history. |
| **Impact** | A dashboard metric that cannot be true, undermining trust in every neighbouring figure. |
| **Fix** | Exclude out-of-range records from the mean and count them in `excludedOutOfRange`; recompute in `getStats()` on read so a stale stored value is not served. **Persisted audit history left untouched.** |
| **Verification** | Live: `avgValidationScore: 83`, `excludedOutOfRange: 5` |
| **Regression** | `93-…` — behavioural assertion that avgScore ∈ [0,100] or null |
| **Classification** | **FIXED** |

---

## OS4-003 — Ecosystem tenant count is real but ~52% test residue
**INFORMATIONAL — no code defect**

| Field | Value |
|---|---|
| **OS** | Cloud |
| **Evidence** | `/eco/v8/dashboard` reports 578 tenants; `data/ecosystem/state.json` holds **578 genuinely persisted records** |
| **Investigation** | I first suspected tick-loop fabrication (`tickCount: 2708`). **That was wrong** — `registerTenant()` writes real records via a real `POST /eco/v8/tenants`. |
| **Real issue** | ~**52%** carry test-harness names (`GetTest`, `UpdateTest`, `TenantDedup`, `DeployTenant`, `BlueprintA`). My first quantification said 6% — the regex was too narrow; corrected to 52%. |
| **Impact** | The count is accurate; its business meaning is nil. Nothing discloses that the population is benchmark residue. |
| **Fix** | **None applied.** Purging or labelling another subsystem's persisted records is a product decision, not a unilateral one. |
| **Classification** | **VERIFY** (product-intent question) |

---

## OS4-004 — Operator surfaces remain unverifiable
**INFORMATIONAL — correct authorization, not a defect**

12 surfaces return `403 "Forbidden — operator access required"`. `OPERATOR_PASSWORD_HASH` is set; the dev passthrough only fires when it is unset (verified: operator login → `401`, no cookie).

**No bypass attempted. `.env` untouched.** → **UNKNOWN** for all 12.

---

## Summary

| ID | Severity | Classification |
|---|---|---|
| OS4-001 | HIGH | FIXED |
| OS4-002 | MEDIUM | FIXED |
| OS4-003 | INFO | VERIFY |
| OS4-004 | INFO | UNKNOWN ×12 |
