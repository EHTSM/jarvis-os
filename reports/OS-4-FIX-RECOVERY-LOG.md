# OS-4 FIX / RECOVERY LOG

Date: 2026-08-13
Policy: REPRODUCE → ROOT CAUSE → MINIMAL FIX → REGRESSION TEST → FULL REGRESSION → LIVE RE-VERIFY

---

## Fix 1 — `backend/services/distributionEngine.cjs` (OS4-001)

**Reproduced:** `GET /distrib/analytics` → `engagementRate "4.20"` (= the 0.042 multiplier).

**Root cause:** OS-3 fixed the writer; the reader still re-derived engagement/shares from a multiplier and summed fabricated reach.

**Minimal fix:**
- `totalReach`, `totalEngagement`, `totalShares`, `totalClicks`, `engagementRate`, `viralityScore` → `null`
- added `measured: false` + `measurementNote`
- pre-fix residue surfaced under `legacy` with an explanatory note
- per-platform `engagement`/`shares` derivation removed; reach renamed `legacyReach`
- `topPlatform` re-anchored on `legacyReach`

**No architecture change.** No new route, service, storage or model.

**Live re-verify:** `{"totalReach":null,"engagementRate":null,"measured":false,"measurementNote":"No platform analytics connector is configured…"}`

---

## Fix 2 — `backend/services/productValidationEngine.cjs` (OS4-002)

**Reproduced:** `avgValidationScore: 234` on the Product Factory dashboard.

**Root cause:** 5 legacy records (2026-06-29) with dimension scores predating the clamps; `getStats()` also returned a **stored** value that only refreshes on the next `validate()`.

**Minimal fix:**
- write path: average only records with `overallScore ∈ [0,100]`; count the rest in `excludedOutOfRange`
- read path: `getStats()` recomputes on read
- **persisted records untouched**

**Live re-verify:** `avgValidationScore: 83`, `excludedOutOfRange: 5`

---

## Test change — `tests/security/45-distribution-tenant-isolation.cjs`

**This is a re-anchor, not a weakening.** Three assertions used `traffic.totalReach === 0` as a proxy for "a new tenant sees nothing". After Fix 1, reach is `null` by design — reporting `0` would falsely assert zero *observed* reach.

Re-anchored onto `traffic.publishJobs`, a genuinely counted tenant-scoped value, and **added** an assertion that unmeasured reach is `null` and never fabricated. The isolation intent is unchanged; the signal is stronger (real records instead of a derived metric that used to be fabricated).

**Verified against live data** (suite itself was signup-rate-limited):
```
✓ B publishJobs === 0 (isolation)     ✓ A publishJobs > 0 (sees own)
✓ B totalReach === null (honest)      ✓ A totalReach === null (honest)
✓ B community totalMembers === 0
```

---

## Regression tests added

`tests/security/93-os2-os3-fake-success-protection.cjs` extended from 4 → **6 assertions**:
- distribution analytics reports null + measurement note, legacy residue separated
- no per-platform multiplier derivation remains
- `avgScore` ∈ [0,100] or null, with out-of-range records counted

---

## Not fixed — deliberately

| Item | Why not |
|---|---|
| 10 legacy distribution records (18,780 phantom reach) | Now quarantined under `legacy` and excluded from headline metrics. Purging persisted business data is the founder's call. |
| 5 out-of-range validation records | Excluded from the mean and counted visibly. History is audit data. |
| 578 ecosystem tenants (~52% test residue) | Real records owned by another subsystem. Purge/label is a product decision. |
