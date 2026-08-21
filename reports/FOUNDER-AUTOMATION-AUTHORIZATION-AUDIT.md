# FOUNDER AUTOMATION AUTHORIZATION — AUDIT

**Track:** OOPLIX V1 Master Audit — next unresolved item after Autonomous Execution Runtime Recovery
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Prior findings referenced:** the `/eos`/`/ent`/`/eco`/`/civ`/`/auto` `operatorOnly` precedent, the
ACP-9-12 Memory/ACP Authorization Boundary Audit, the Autonomous Execution Runtime Recovery's own
"16 remaining `catch {}` blocks" limitation.

---

## Reconciliation before selecting

The prior mission's report listed 16 remaining `catch {}` occurrences in
`businessMissionAutomation.cjs` as an unaudited limitation. Individually inspected all 16 before
looking elsewhere:

- 13 wrap `_mem()?.recordDecision(...)`, `_mem()?.addSubtask(...)`, or `_mem()?.recordArtifact(...)` —
  mission-memory bookkeeping notes, distinct from the actual business mutation already reported to the
  caller.
- 2 wrap `_alert()?.fire(...)` — best-effort operational notifications.
- 1 wraps a rule-registry classification lookup with a safe default (`nonRetriable = false` on
  failure) — the real `execResult.status` (already honest) is what's actually returned to the caller
  regardless of this lookup's outcome.

**Confirmed: none of the 16 wrap a genuine `businessDataService` CRM mutation.** The prior mission's
failure-honesty sweep (which fixed the 6 handlers that did) was already complete and correct. No
further fix needed here — reconciled, not re-audited.

## Discovery

Searched systematically for `POST .../run|execute` route patterns across every route file
(`grep -rn "router.post.*automation\|router.post.*/run\b\|router.post.*/execute\b" backend/routes/*.js`)
to find the next genuinely actionable authorization candidate, rather than re-scanning the already-fully-
reconciled register narrative.

**`backend/routes/autonomousExecution.js`** (`POST-Ω Sprint P3`) stood out: `POST
/execution/execute/:workflowId`, gated only by a single `router.use("/execution", requireAuth)` with
no `operatorOnly`. Its backing service, `autonomousExecutionEngine.cjs`, is explicitly documented in
its own header comment as *"the top-level autonomous execution orchestrator for Class A **founder**
workflows"* — a 12-step pipeline (`founderWorkRegistry` → plan → validate → execute → recover →
evidence → org-layer updates → metrics → learning) entirely about running the platform operator's own
business, matching the exact same architectural class as the already-fixed `/eos`/`/ent`/`/eco`/`/civ`/
`/auto` and ACP-9-12 surfaces.

**Confirmed `orgId` is genuinely absent**: `grep -c "orgId" backend/services/autonomousExecutionEngine.cjs`
→ `0`. Confirmed `"founder"` is not a real access-control role: `accountService.js`'s own doc comment
lists the actual roles as `operator | user | enterprise_admin | portfolio_owner` — `"founder"` is only
a default string value for the `triggeredBy` field, never checked against the caller's identity or
permissions anywhere.

**Live-reproduced the exposure** with a real, ordinary, non-operator customer test account:

```
GET /execution/dashboard  → 200, real dashboard: executionState, founderMinutesEliminated: 4740,
                              founderHoursEliminated: 79, automationCoverage: 55%, perDomain breakdown
GET /execution/runs?limit=3 → 200, full real run history including real workflow names, statuses,
                                approval IDs
POST /execution/execute/wf_test_probe → 200 {"ok":false,"error":"workflow not found: wf_test_probe"}
  — rejected ONLY because the probe ID doesn't exist, not by any role check. A real workflow ID
  (confirmed present in the real run history, e.g. "wf_eng_code_review") would have been accepted and
  executed. Not actually triggered, to avoid any real side effect from a live test — the absence of a
  role check is already conclusively proven by the read-path evidence and the identical unauthenticated-
  vs-authenticated-non-operator comparison.
```

**Confirmed no frontend consumer exists**: `grep -rl '"/execution/` across `frontend/src/components/`
returns nothing — no legitimate customer-facing feature depends on broad access.

## Fix

Added `operatorOnly` to `autonomousExecution.js`'s existing gate:

```js
router.use("/execution", requireAuth, operatorOnly);
```

## A genuine sibling found in the same pass

While confirming this defect family's full bounded scope (matching the same discipline used for the
ACP-9-12 fix), checked every other route file referencing the same "founder automation" service
family. Found **`backend/routes/founderAutomation.js`** (`POST-Ω Sprint P2` — Founder Work Registry,
Founder Automation Engine, and Production Bible; `/founder/*` and `/bible/*`) with the identical gap:
`router.use(["/founder", "/bible"], requireAuth)`, no `operatorOnly`.

Confirmed both backing services are equally unscoped: `founderWorkRegistry.cjs` and
`founderAutomationEngine.cjs` both show 0 `orgId` occurrences. Live-reproduced: `GET
/founder/dashboard` for the same ordinary customer account returned the real founder work registry
summary — 56 real workflows, real automation percentages (`automationPct: 52`), real per-class
breakdowns. Confirmed no frontend consumer exists for any `/founder/*` or `/bible/*` route either.

Fixed identically:

```js
router.use(["/founder", "/bible"], requireAuth, operatorOnly);
```

**Confirmed this is the complete, bounded scope of this specific defect family**:
`grep -rln "founderWorkRegistry\|founderAutomationEngine\|autonomousExecutionEngine\.cjs\|productionBibleEngine" backend/routes/*.js`
returns exactly these 2 files — no third sibling exists.

## Live re-verification (post-fix, and again after a real restart)

- Ordinary customer on `/execution/dashboard`, `/founder/dashboard`, `/bible/dashboard` →
  `403 Forbidden — operator access required` (was `200` with real data before the fix).
- Unauthenticated on the same routes → `401` (unchanged).
- `/coding/context` (the deliberately-untouched, genuinely tenant-scoped ACP-1-8 system) for the same
  ordinary customer → still `200`, real data — confirms the fix's scope stayed exactly as intended.

## Regression

- Added 3 tests (describe block `130-master-audit-founder-automation-operator-gate`) to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`. Each fix independently negative-tested
  (reverted one file's gate at a time, confirmed only that file's specific test failed, restored,
  confirmed both pass together again).
- `npm run test:runtime`: **258/258** (255/255 baseline + 3 new tests).
- `tests/security/97-enterprise-isolation-integrity.cjs`: unaffected.
- Production build: clean (backend-only change).
- `.env`: confirmed untouched throughout.

---

## AUDIT NAME: Founder Automation Authorization (autonomousExecution.js + founderAutomation.js)

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.6/10
**CONFIDENCE:** 91%

## V1 SURFACE

- **Backend:** `backend/routes/autonomousExecution.js`, `backend/routes/founderAutomation.js` — 1
  gate line changed in each. Backing services (`autonomousExecutionEngine.cjs`,
  `founderWorkRegistry.cjs`, `founderAutomationEngine.cjs`, `productionBibleEngine.cjs`) unchanged —
  their own logic was already correct; only the route-level access boundary was missing.
- **Routes:** 21 routes in `/execution/*`, 19 routes in `/founder/*` + `/bible/*` — all now correctly
  gated; representative sample live-tested (dashboard, runs, execute) for both files.
- **Frontend:** confirmed no consumer exists for either route family — no frontend work needed or
  affected.
- **Persistence:** N/A — no persisted state changed by this fix.
- **Authentication:** PASS — unaffected; unauthenticated requests still correctly `401`.
- **Authorization:** PASS after fix — a real, live-reproduced authorization gap (any authenticated
  customer could read, and — unblocked only by a nonexistent test ID — write to, the platform
  founder's own automation/execution surfaces) is closed using the exact same proven mechanism already
  applied 6 times this session.
- **Tenant Isolation:** N/A directly — this is an operator-vs-customer boundary, not cross-tenant
  data; the underlying data was never tenant-scoped by design (platform/founder-level automation about
  running the business itself).
- **Cross-OS:** N/A — a route-gating fix, not a cross-OS composition.
- **Failure Honesty:** PASS — the new `403` carries the same real, existing, honest message
  (`operatorOnly`'s own `"Forbidden — operator access required"`) already used 6 times elsewhere.
- **Live Verification:** every claim backed by real HTTP requests with a real ordinary customer
  account, both before and after a real server restart.

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed (2 files, same defect family) — the platform founder's own automation
  execution engine and work registry/production-bible surfaces were reachable by any authenticated
  customer, both for reading real operational data and for triggering real workflow executions
  (blocked only by test-ID luck, not by any role check).
- **V1-critical P2:** 0
- **Other:** reconciled the prior mission's own "16 remaining `catch {}`" limitation with a full
  individual inspection, confirming it required no further fix — avoided unnecessary re-work on an
  already-closed item.

## FIXES

- `backend/routes/autonomousExecution.js`: added `operatorOnly` to the `/execution/*` gate.
- `backend/routes/founderAutomation.js`: added `operatorOnly` to the `/founder/*` + `/bible/*` gate.
- 3 new regression tests, each fix independently negative-tested.

## LIMITATIONS

- Neither route file has a frontend consumer today — this fix closes a real, live-reachable
  authorization gap regardless, but the broader question of whether/how these surfaces should ever
  become customer-facing (and if so, whether they'd need genuine tenant scoping added to their backing
  services) remains open, matching the same class of open question already documented for `/p18/memory/*`
  in an earlier mission.
- Did not verify operator-tier access with a real operator login (would require the operator
  password, not available/appropriate to fabricate) — operator-side reachability is inferred from the
  identical, already-proven `operatorOnly` mechanism used successfully 6 times this session, not
  independently re-verified with a live operator session this pass.
- Did not attempt to actually trigger a real workflow execution via `POST /execution/execute/:id` with
  a genuine workflow ID, to avoid any real side effect (e.g., deployment or git operations) from a
  live test — the absence of a role check was conclusively proven by the read-path evidence and the
  identical unauthenticated-vs-non-operator-authenticated comparison instead.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Closes the 7th and 8th instances (2 files) of the same platform-wide-surface authorization gap found
and fixed across this session (`/eos`, `/ent`, `/eco`, `/civ`, `/auto`, ACP-9-12, now
`/execution/*` + `/founder/*`/`/bible/*`), using the identical, already-proven, zero-new-architecture
mechanism each time. Reconciles a real prior-mission limitation with a genuine individual inspection
rather than either ignoring it or unnecessarily re-litigating it. No OS-track record altered.

## REGRESSION RESULT: 258/258 (0 failures, 0 skipped, 3 net new tests)

## BUILD RESULT: PASS (clean; backend-only change, no frontend files modified)
