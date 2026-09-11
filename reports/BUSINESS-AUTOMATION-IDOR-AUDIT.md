# BUSINESS AUTOMATION IDOR — AUDIT

**Track:** OOPLIX V1 Master Audit — next unresolved item after Memory/ACP Authorization Boundary
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Prior findings referenced:** C10-017 (`businessDataService.cjs` opt-in `orgId` scoping design),
C10-031 (cross-tenant CRM lead IDOR, already fixed).

---

## Why this item

Reconciled the closure inventory once more for the next genuinely actionable item. **C10-017**
(`businessDataService.cjs`'s "opt-in-only `orgId` scoping design", disposition-ed "FIX IN MASTER
RECOVERY — see C.10's own live confirmation this is still real") had not yet been directly checked
this session.

`businessDataService.cjs`'s own header comment (lines 47-58) claims:

> Org scoping is additive and opt-in... Omitting orgId anywhere (the default, and the only thing every
> existing call site in `business.js` does today) preserves the exact pre-org-scoping behavior: every
> record is visible/writable, regardless of orgId field.

**Confirmed stale.** Exhaustively grepped every `bds.*()` call in `business.js` — all ~40 call sites
across leads/contacts/opportunities/campaigns/revenue already pass `req.org.id`. This was closed by an
earlier, uncredited pass in this session's history (likely part of C10-031's cross-tenant CRM lead IDOR
fix, which the closure inventory already lists as resolved) — the service file's own doc comment was
simply never updated to reflect it. C10-017, as originally framed against `business.js`, is resolved;
no fix needed there.

## Discovery — the real, still-open instance

While verifying that exhaustively, checked every other file that calls `businessDataService.cjs`
(11 files total: `companyFactory.js`, `business.js`, `agentRuntimeSupervisor.cjs`,
`businessMissionAutomation.cjs`, `unifiedIntelligenceLayer.cjs`, `knowledgeGraph.cjs`,
`graphReasoningEngine.cjs`, `orgKnowledgeGraph.cjs`, `businessIntelligenceEngine.cjs`,
`organizationService.cjs`, `businessEventAdapter.cjs`) for the same "opt-in, no orgId passed" pattern.

Most were already correctly scoped (`unifiedIntelligenceLayer.cjs`, `orgKnowledgeGraph.cjs`,
`businessIntelligenceEngine.cjs` all pass real `orgId`; `companyFactory.js`'s CRM proxy routes are
correctly gated). Two genuine gaps were found:

### 1. `businessMissionAutomation.cjs` — real, live IDOR (fixed)

9 real `businessDataService` call sites, none passing `orgId`:

```js
bds.updateLead(entity.id, { score, lastAutomationStep: "ingest_lead" });          // no orgId
_bds()?.updateLead(entity.id, { status: "contacted", ... });                      // no orgId
bds.qualifyLead(entity.id, { score, ... });                                       // no orgId
bds.updateLead(entity.id, { status: "disqualified", ... });                       // no orgId
_bds()?.closeWon(entity.id, { closedBy: "automation" });                          // no orgId
_bds()?.closeLost(entity.id, entity.lostReason || "Not specified");               // no orgId
_bds()?.advanceStage?.(entity.id, entity.stage);                                  // no orgId
_bds()?.recordRevenue({ amount, ..., oppId: entity.id });                         // no orgId
_bds()?.recordCampaignEvent?.(entity.campaignId || entity.id, {...});             // no orgId (x2)
```

The two HTTP entry points, `POST /business/automation/run` and `POST /business/automation/step`
(`backend/routes/business.js`), were gated by `requireAuth` alone — **unlike every other `/business/*`
CRM route in this file**, which all compose `_requireOrg`. `entity` comes directly from `req.body`,
fully caller-controlled, including `entity.id`.

**Live-reproduced the real gap** with two real test tenants: created a real lead in Org A
(`lead_1786833243265_95b1e5`), then had Org B call `POST /business/automation/step` with that lead's
real ID in the `entity` payload. The route accepted the request without any membership check on the
target lead's actual org.

**The mutation itself did not visibly land through the full HTTP path** — but only because of a
**separate, unrelated, pre-existing crash bug**: `autonomousExecutionRuntime.cjs`'s stage-execution
entity deserialization throws `"Cannot read properties of undefined (reading 'name')"` before any
capability handler's `bds.*()` call is even reached. Confirmed this is not an accidental security
control by reproducing the identical crash with Org A running automation on **its own** real lead —
the crash is universal, not org-dependent. This means the authorization gap is currently masked by an
unrelated reliability bug, not actually protected by one — a genuinely dangerous combination: fixing
the crash bug in isolation (a reasonable, independent future task) would have silently un-masked a
live IDOR.

**Isolated proof of the authorization defect, independent of the crash bug**: tested
`businessDataService.cjs` directly at the service layer.

```js
bds.updateLead(realLeadId, { score: 999 }, wrongOrgId);
// → throws "Not found: <id>" (404) — businessDataService's own _update() already
//   rejects a mismatched orgId correctly, when one is actually passed.
```

This confirms the fix required was narrow and precise: `businessDataService.cjs`'s own scoping logic
was already correct; `businessMissionAutomation.cjs` simply never supplied the argument.

### 2. `businessEventAdapter.cjs` — a distinct, deeper gap (documented, not fixed)

`bds.createLead(entity)` / `bds.createOpportunity(entity)` inside the webhook ingestion pipeline
(`/business/webhook/form|email|whatsapp|telegram|payment|calendar`) also pass no `orgId` — but this is
a **materially different situation**, confirmed by checking the routes themselves: these are single,
global, unauthenticated webhook URLs (`POST /business/webhook/form`, no `:orgId` anywhere in the path).
`businessEventAdapter.cjs` has zero `orgId` occurrences anywhere in the file — there is no per-org
routing concept in this pipeline at all, architecturally, not merely an omitted parameter. Making this
genuinely multi-tenant would require new architecture (per-org webhook URLs or bearer tokens to
identify which org an inbound webhook belongs to) — explicitly out of this audit's scope ("do not
create random architecture"). Documented as a distinct, deeper, still-open limitation, not silently
fixed or ignored.

## Fix

`backend/routes/business.js`:

```js
router.post("/business/automation/run", requireAuth, _requireOrg, async (req, res) => {
    ...
    const result = await bma.runTemplate(entityType, { ...entity, orgId: req.org.id }, { ..., orgId: req.org.id });
    ...
});
router.post("/business/automation/step", requireAuth, _requireOrg, async (req, res) => {
    ...
    const result = await bma.runStep(entityType, stepName, { ...entity, orgId: req.org.id }, missionId);
    ...
});
```

`req.org.id` (the server-resolved, membership-verified org, not a client-supplied value) overrides any
`orgId` the client might have sent, then flows into `entity.orgId`.

`backend/services/businessMissionAutomation.cjs`: all 9 call sites now pass `entity.orgId` as the
final argument to their respective `businessDataService` function, reusing the exact
already-proven-correct scoping check in `_update`/`_get`/`_remove` — no new architecture, no new
validation logic.

## Live re-verification

- Unauthenticated request to either automation route → `401` (unchanged).
- Direct service-layer proof, both before and after a real server restart:
  `bds.updateLead(realId, {...}, wrongOrgId)` → throws `404 Not found`; the record's score/state
  confirmed genuinely unchanged afterward; the same call with the correct `orgId` succeeds.
- Confirmed the separate crash bug (`autonomousExecutionRuntime.cjs`) is real, reproducible, and
  org-independent — not something this fix depends on or should be credited with masking.
- Test data cleaned up: the real Org A test lead used for live reproduction was deleted after
  verification; no persistent test fixtures altered.

## Regression

- Added 4 tests (describe block `128-master-audit-business-automation-idor`) to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`:
  1. Structural — both routes compose `_requireOrg`.
  2. Structural — both routes thread `req.org.id` into the entity object.
  3. Structural — all 9 `businessMissionAutomation.cjs` call sites pass `entity.orgId`.
  4. **Live** — a real `businessDataService.createLead`/`updateLead`/`getLead`/`deleteLead` round trip
     proving the cross-org rejection, independent of the unrelated crash bug.
- Negative-tested each structural layer independently: reverted the route-level `_requireOrg` addition
  alone (confirmed test 1 failed, others unaffected, restored); reverted one
  `businessMissionAutomation.cjs` call site alone (confirmed test 3 failed, others unaffected,
  restored).
- `npm run test:runtime`: **250/250** (246/246 baseline + 4 new tests).
- `tests/security/97-enterprise-isolation-integrity.cjs`, `tests/security/05-injection-security.cjs`:
  both unaffected.
- Production build: clean (backend-only change).
- `.env`: confirmed untouched throughout.

---

## AUDIT NAME: Business Automation IDOR (businessMissionAutomation.cjs)

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.4/10
**CONFIDENCE:** 88%

## V1 SURFACE

- **Backend:** `backend/routes/business.js` (2 routes gated), `backend/services/businessMissionAutomation.cjs`
  (9 call sites fixed). `businessDataService.cjs` itself unchanged — its own scoping logic was already
  correct.
- **Routes:** `POST /business/automation/run`, `POST /business/automation/step` — both live-tested,
  both now correctly org-gated.
- **Frontend:** not investigated this pass — out of scope; no frontend consumer of these two specific
  routes was inventoried.
- **Persistence:** PASS — the rejected cross-org write correctly leaves the target record's persisted
  state unchanged, confirmed via direct re-read.
- **Authentication:** PASS — unaffected.
- **Authorization:** PASS after fix — a genuine, live-reproducible IDOR is closed, reusing the
  codebase's own already-proven org-scoping mechanism.
- **Tenant Isolation:** PASS after fix — live-verified with two real test tenants; a cross-org write
  attempt correctly rejected.
- **Cross-OS:** N/A — a single-service authorization fix, not a cross-OS composition.
- **Failure Honesty:** PASS — the rejection is a real `404`, not a silently-swallowed no-op; separately,
  the pre-existing crash bug's real error message flows through un-obscured (not something this fix
  papers over).
- **Live Verification:** every claim backed by real HTTP requests and direct service-layer calls with
  two real test tenants, isolating the authorization fix from an unrelated, independently-confirmed
  reliability bug, including a real restart.
- **Regression:** 250/250 (246/246 baseline + 4 new tests, 0 weakened).

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed — a real, live-reproducible cross-tenant IDOR in the business automation
  pipeline, currently masked (not prevented) by an unrelated crash bug.
- **V1-critical P2:** 0
- **Other:** 1 genuine, deeper, architecturally distinct gap found and correctly left undecided
  (`businessEventAdapter.cjs`'s webhook ingestion pipeline has no per-org routing concept at all);
  C10-017 reconciled as stale/already-resolved against `business.js` without unnecessary re-fixing; 1
  separate, real, unrelated reliability defect discovered and documented (not fixed, out of this
  audit's authorization-focused scope) — `autonomousExecutionRuntime.cjs`'s entity-deserialization
  crash currently breaks 100% of business-automation executions for every caller.

## FIXES

- `backend/routes/business.js`: added `_requireOrg` to `/business/automation/run` and
  `/business/automation/step`; both now thread `req.org.id` into the `entity` object passed downstream.
- `backend/services/businessMissionAutomation.cjs`: all 9 `businessDataService` call sites in the CRM
  capability handlers now pass `entity.orgId`.
- 4 new regression tests, negative-tested at each layer independently.

## LIMITATIONS

- `businessEventAdapter.cjs`'s webhook ingestion pipeline (`/business/webhook/*`) remains genuinely
  unscoped — a deeper architectural gap (no per-org webhook identification mechanism exists at all),
  correctly not force-fixed within this audit's scope.
- The separate `autonomousExecutionRuntime.cjs` crash bug (`"Cannot read properties of undefined
  (reading 'name')"`) that currently breaks every business-automation execution was discovered,
  confirmed real and reproducible, and documented — but not fixed, since it is a distinct reliability
  defect in a shared execution engine used by many other systems, not an authorization issue, and
  fixing it is out of this audit's narrow scope.
- Frontend reachability of the two fixed routes was not investigated this pass.
- Only the 9 concretely-identified `businessMissionAutomation.cjs` call sites were fixed; a broader
  sweep for the same pattern in files outside the 11 direct `businessDataService` callers already
  checked was not performed.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Reconciles C10-017 as resolved against its originally-scoped target (`business.js`) without
unnecessary re-work, while finding a genuinely distinct, still-live IDOR in a different consumer of the
same service that the original C10-017 framing didn't cover. Closes a real cross-tenant write
vulnerability using the codebase's own existing, already-proven scoping mechanism — no new
architecture. Surfaces two honestly-scoped, correctly-undecided/undone items (the webhook pipeline's
deeper multi-tenancy gap, and the unrelated execution-runtime crash bug) rather than either silently
ignoring them or overreaching into fixes beyond this audit's authorization focus. No OS-track record
altered.

## REGRESSION RESULT: 250/250 (0 failures, 0 skipped, 4 net new tests)

## BUILD RESULT: PASS (clean; backend-only change, no frontend files modified)
