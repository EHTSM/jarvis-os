# LOAD-TEST / CONCURRENT-WRITE COVERAGE — AUDIT

**Track:** OOPLIX V1 Master Audit — backend coverage: concurrency / persistence
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`

---

## Why this item

Reconciled the register per this mission's own instruction and built an evidence-based coverage
categorization. C10-005 and `/p18/memory/*` remain **DECISION REQUIRED**, `SENTRY_DSN` remains
**CREDENTIAL-BLOCKED** — neither touched.

**Load test** stood out as genuinely **UNVERIFIED**: B.23/B.24/B.25's own evidence matrices all listed
it as NOT MEASURED, and unlike its neighbors on those same lists (restore drill, invitation flow, org
deletion, 3 roles, automation — every one subsequently closed by a named mission this session), load
test was never picked up. C.3's own Performance Perfection Audit tested a single tenant, read-only, up
to 25 concurrent requests, and its own findings document explicitly recorded: *"Multi-tenant concurrent
load | Single audit tenant available."* Real multi-tenant concurrent **write** load had never been
tested at all.

## What was tested

Set up 2 real, distinct, freshly-registered tenant accounts. Fired 50 simultaneous
`POST /business/leads` from each (100 total concurrent writes) against the live running server on port
5050.

## The investigation — a false alarm caught before it became a false fix

**Initial measurement**: HTTP layer returned 100/100 `200` responses, but counting each tenant's
persisted leads via `GET /business/leads` (the ordinary, default-parameters call) showed only 0-50 of
100 actually present — varying between runs. This looked like a severe, real data-loss bug.

**Root-caused before accepting it**: `GET /business/leads` defaults to `limit: 50` and
`businessDataService.cjs`'s `_list()` returns `filtered.slice(0, limit)` — the **first** N items in
storage order (oldest-first, since new records are pushed to the end of the array). Both test tenants
had already accumulated 50+ leads from this session's own earlier, unrelated load-testing runs, so every
newly-created record was silently excluded from the default-limited response — the data was correctly
persisted the entire time; the *read* path's pagination was excluding it from what my test script was
counting.

**Corrected and re-measured**: using the response's own `total` field (unaffected by pagination) and a
raised `?limit=1000`, the exact same 100-concurrent-write scenario showed **100/100 genuinely
persisted, 0 cross-tenant leaks, `data/biz-leads.json` remained valid JSON throughout.** No live
data-loss defect exists in the concurrent write path.

This distinction matters and is stated plainly per the mission's explicit "do not inflate findings"
instruction: **the initial measurement was wrong, not the server.** An earlier version of this pass's
own fix-justification comments had already assumed the flawed measurement was real before this
correction was made — those comments were rewritten to reflect the honest, verified conclusion before
this report was finalized.

## What was genuinely found and fixed

While investigating the (ultimately false) data-loss alarm, a real, separate, evidence-driven gap was
found by direct source read: `businessDataService.cjs`'s `_writeStore()` — the shared write path for
all 5 business entity stores (leads, contacts, opportunities, campaigns, revenue) — called
`fs.writeFileSync()` **directly on the real target file**, with no atomic tmp-file-then-rename step at
all. This is a genuinely different, weaker posture than every sibling JSON store already hardened this
session (`taskQueue.cjs`, `missionMemory.cjs`, `authMiddleware.js`'s revoked-tokens ledger), which all
already had this class of protection against a crash or external file replacement occurring mid-write.

```diff
 function _writeStore(file, store) {
     if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
     store.updatedAt = new Date().toISOString();
-    fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(store, null, 2));
+    const target = path.join(DATA_DIR, file);
+    const tmp = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
+    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
+    fs.renameSync(tmp, target);
 }
```

While sweeping for the same pattern, `crmService.js` (the WhatsApp/webhook lead-ingestion pipeline —
a separate module from `businessDataService.cjs`, not the one `POST /business/leads` actually calls)
was also found using a fixed, non-unique `.tmp` path — the exact older, narrower defect class already
found and fixed in `taskQueue.cjs`'s own "Blocker #6" fix earlier this session. Fixed identically.

Both fixes are stated honestly as **genuine hardening against a real class of risk that was not,
itself, the cause of the measured symptom** — the same honest distinction this session's earlier
`sqlite.cjs`/`getDB()` and crash-mid-write missions already drew between "a live-reproduced defect" and
"a real, separately-justified hardening."

## Live re-verification

Restarted the server on the fixed code. Re-ran the identical 100-concurrent-write scenario (2 tenants,
50 writes each) with the corrected, `total`-based verification methodology:

- HTTP layer: 100/100 `200`
- Persistence: 100/100 genuinely present (verified via `total` and `?limit=1000`)
- Cross-tenant isolation: 0 leaks in either direction
- File integrity: `data/biz-leads.json` remained valid JSON throughout

Also ran a real `SIGKILL`-mid-write reproduction (spawning a subprocess looping `createLead()` 200
times, killed at a 10ms delay) — file remained valid, no data loss among pre-existing records, no
orphaned `.tmp` files — confirming the atomicity fix holds under a real crash, using the exact
methodology already proven correct in the prior crash-safety mission.

## Regression

- Added describe block `138-master-audit-business-data-service-write-atomicity` to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`: a structural test on the atomic-write pattern,
  a live 40-write (20 per tenant) concurrent-burst test proving correctness and isolation via direct
  in-process calls, and a live real-SIGKILL-mid-write reproduction.
- Negative-tested: reverted the atomicity fix, confirmed the structural test failed for the right
  reason (the two live tests correctly continued passing, since — consistent with the honest finding —
  there is no live-reproducible corruption/loss at the tested concurrency level for them to catch;
  the structural check is the correct, precise guard for this specific fix), restored, confirmed
  passing again.
- `npm run test:runtime`: **280/280** (277/277 baseline + 3 new tests).
- `tests/security/97-enterprise-isolation-integrity.cjs`: unaffected (1/1).
- Production build: unaffected (backend-only, no frontend files touched).
- `.env`: confirmed untouched throughout.

---

## AUDIT NAME: Load-Test / Concurrent-Write Coverage (businessDataService.cjs atomicity hardening)

**STATUS:** CERTIFIED
**SCORE:** 8.5/10
**CONFIDENCE:** 90%

## V1 SURFACE

- **Backend:** `backend/services/businessDataService.cjs` (write-path atomicity fix, affecting all 5
  entity stores), `backend/services/crmService.js` (same defect class, separate module, fixed on the
  same sweep).
- **Routes:** `POST /business/leads` and the other CRUD routes backed by `businessDataService.cjs`
  live-tested under real concurrent load.
- **Frontend:** N/A — no frontend files touched, no UI consumer in scope this pass.
- **Persistence:** PASS — the actual subject; live-verified with a real 100-concurrent-write burst
  across 2 real tenants (correctness, isolation) and a real SIGKILL-mid-write reproduction (crash
  safety).
- **Authentication:** N/A — unaffected.
- **Authorization:** N/A — no boundary touched; tenant isolation was verified as a byproduct, not
  changed.
- **Tenant Isolation:** PASS — confirmed 0 cross-tenant leaks under real concurrent load, both before
  and after the fix (the fix does not touch isolation logic at all).
- **Cross-OS:** N/A — POSIX `renameSync` atomicity assumptions match this session's existing precedent.
- **Failure Honesty:** PASS, and the central lesson of this pass — an initial, alarming-looking
  measurement was investigated rather than immediately "fixed," found to be a test-methodology
  artifact, and corrected before being reported as a defect.
- **Live Verification:** genuine multi-tenant concurrent HTTP load (100 real requests), a real
  subprocess SIGKILL reproduction, both before and after the fix, against the real running server.
- **Regression:** 280/280 (0 failures, 0 skipped, 3 net new tests).

## FINDINGS

- **P0:** 0
- **P1:** 0 — no live-reproducible defect found in the write path under concurrency.
- **V1-critical P2:** 1 found and fixed — `businessDataService.cjs`'s `_writeStore()` had no atomic
  write protection at all, a genuine gap relative to every sibling store in this codebase, fixed as
  hardening (not as a response to a confirmed live symptom).
- **Other:** `crmService.js`'s older, narrower tmp-path-collision variant of the same defect class,
  found on the same sweep and fixed identically. A flawed test-measurement methodology
  (default-paginated GET undercounting real data) was caught and corrected before being reported as a
  defect — the single most important outcome of this pass.

## FIXES

- `businessDataService.cjs`: `_writeStore()` now uses a per-call-unique tmp filename + `renameSync`,
  matching the proven pattern used throughout this codebase — applies to all 5 entity stores via one
  shared helper.
- `crmService.js`: `_write()` fixed identically for the older, fixed-`.tmp`-path variant.
- 3 new regression tests, negative-tested.

## LIMITATIONS

- This pass closes "load test" as a coverage item for the specific surface tested
  (`POST /business/leads`, 100 concurrent writes across 2 tenants) — it does not claim comprehensive
  load coverage across every mutating route in the platform; other high-traffic mutating endpoints were
  not individually load-tested this pass.
- The atomicity fix is real hardening but was not proven necessary by a live-reproduced trigger at the
  concurrency level tested — stated honestly rather than overclaimed, consistent with this session's
  own precedent for hardening-without-a-live-trigger findings.
- Sustained multi-hour soak testing and WAN-latency-inclusive load testing remain out of scope and
  unmeasured, as previously and consistently disclosed across this session's prior performance-related
  audits.

## FINAL CLASSIFICATION: **CERTIFIED**

## PROGRAMME IMPACT

Closes a coverage gap open since B.23 (multi-tenant concurrent load, NOT MEASURED across 3 certification
phases) with real, live, corrected evidence: the concurrent-write path is genuinely safe under real
multi-tenant load, and a real atomicity gap relative to this codebase's own established standard was
found and closed as hardening. Equally important as the fix itself: a flawed measurement that looked
like a severe P0 was caught and corrected before being reported, rather than shipping an inflated
finding. No OS-track record altered.

## REGRESSION RESULT: 280/280 (0 failures, 0 skipped, 3 net new tests)

## BUILD RESULT: PASS (unaffected; backend-only change, no frontend files modified)

## CURRENT BASELINE: 280/280
