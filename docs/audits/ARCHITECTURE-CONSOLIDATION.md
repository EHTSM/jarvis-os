# Final Architecture Consolidation

Execution-only pass: find real duplicated implementations/logic across the
repository, classify each as (A) intentional, (B) legacy compatibility, or
(C) real architectural debt, and consolidate only (C) findings by wiring to
the existing production implementation — never a new one, never a redesign.

## Method

Surveyed the categories the mission specified (duplicate services, retry
logic, RBAC, feature gates, AI routing/provider selection, event emitters,
schedulers, validation, constants/configuration, dead abstractions,
circular dependencies) using targeted greps for each concept's
characteristic function signatures/constants, then read every candidate
pair/group in full before classifying — a name match alone (e.g. two files
both having a function called `route()`) is not evidence of duplication;
several categories below were ruled out only after reading both
implementations and confirming they solve genuinely different problems.

## Real Consolidations (Class C — architectural debt, fixed)

### 1. `crmService.js` phone-normalization (6 inline duplicates → 1 function)

**Finding**: `String(x || "").replace(/\D/g, "")` was independently
inlined 6 times across `saveLead`, `updateLead`, and `getLead` — the exact
same identity-normalization operation, copy-pasted rather than shared.
This is the same operation that made phone matching subtle enough to
produce a real test-construction bug of my own during the prior chaos
certification pass (a normalization mismatch between a seeded lead and a
webhook payload's contact field) — a concrete illustration of why
duplicated identity logic is a real risk, not just a style nit: six
independent copies is six independent places a future edit could silently
diverge.

**Classification**: C — real debt. All six copies do the exact same
thing, in the same file, for the same purpose.

**Fix**: extracted to a single `_normalizePhone(value)` local helper,
replacing all 6 inline occurrences. Not extracted to a shared
`backend/utils/` file — this is single-file internal DRY, not a new
cross-cutting abstraction, keeping the change minimal per the mission's
"never add abstraction" constraint.

**Explicitly NOT consolidated**: `paymentService.js` and
`whatsappService.js` have a *similar-looking* `.replace(/\D/g, "").replace(/^0+/, "")`
pattern, but verified this is a genuinely different operation —
constructing an E.164-style international dialing format for an outbound
API call (`+${clean}`), where stripping a leading zero is semantically
required, versus `crmService.js`'s pure identity-equality comparison,
where it isn't. Consolidating these would conflate two different
operations that happen to share a regex prefix — verified this
distinction by reading the call sites (both callers immediately follow
the normalization with `` `+${clean}` `` construction for a live API
request; `crmService.js`'s callers never do). Classified A (intentional
divergence for a real reason), documented, not touched.

**Runtime verified**: captured full before/after behavior across 7
scenarios (formatted-phone save + lookup, cross-format dedup, cross-format
update, cross-format lookup, userId-only leads, org-scoped isolation ×2)
via a real reproduction script run before and after the refactor — outputs
identical except for the test's own randomly-generated phone digits
(expected, since each run uses a fresh timestamp). Also re-ran
`tests/security/16-webhook-fulfillment-idempotency.cjs` (the existing
permanent test that most heavily exercises `crmService.js`) — 3/3 still
pass.

**Regression**: full legacy suite (`node --test tests/legacy/*.test.cjs`):
83 pass / 72 fail — identical to the baseline established across all four
prior audit passes.

### 2. Orphaned duplicate pub/sub bus — `agents/automation/eventListener.cjs` (deleted)

**Finding**: a self-contained `on`/`off`/`once`/`emit` pub/sub
implementation (63 lines) with a real, wired counterpart already handling
this exact concern throughout the entire codebase:
`agents/runtime/runtimeEventBus.cjs` (flood damping, heartbeat, degraded-
mode detection, burn-in metrics — production hardening this duplicate
never received). First identified as unreachable during the Hidden
Capability Recovery pass and documented there as class B (superseded) but
deliberately left in place at the time, since that mission's instruction
was "archive, don't delete" for unproven cases.

**Classification**: C — real debt, now with a stronger basis to act than
the recovery pass had: this mission's mandate is specifically to remove
architectural friction from already-recovered ground, and the file has
zero references anywhere in the codebase (re-verified fresh, not assumed
from the prior pass's finding).

**Fix**: deleted. Nothing to "wire" to the existing implementation —
nothing ever called this file, so there's no caller to redirect.

### 3. Orphaned duplicate scheduler — `agents/automation/scheduler.cjs` (deleted)

**Finding**: a generic `setTimeout`-based delayed-task scheduler (74
lines) whose own doc comment admits it's a placeholder ("swap to
node-cron... in production"). The real, live equivalent is
`agents/taskQueue.cjs` + `agents/autonomousLoop.cjs`'s cron
re-registration (verified working, with restart recovery, in the
Production Operations Certification pass). Same disposition as #2 —
identified in the Hidden Capability Recovery pass, documented then, acted
on now.

**Classification**: C — real debt, zero references anywhere (re-verified
fresh; the one apparent grep hit, `backend/routes/index.js`, is a comment
describing an unrelated route path `/scheduler/status`, not a require of
this file — confirmed by reading the actual line).

**Fix**: deleted.

### Regression (deletions)

`node -e 'require("./backend/routes/index.js")'` — loads cleanly, no
missing-module errors. Full legacy suite: 83 pass / 72 fail, unchanged
baseline.

---

## False Positives (investigated, ruled out — not duplication)

### RBAC — three separate permission-check implementations

`backend/middleware/workspaceMiddleware.cjs` (`requireRole`),
`backend/services/organizationService.cjs` (`hasPermission`),
`backend/services/ecosystemState.cjs` (`checkPermission`). Read all
three in full: workspace-scoped role hierarchy (Owner>Admin>Operator>
Developer>Viewer), org-scoped action-permission lookup (role→allowed-
actions map + explicit grants), and cross-tenant marketplace routing
permission (Level Ω's multi-tenant resource-sharing grants) respectively
— three genuinely different authorization models for three non-overlapping
bounded contexts. Confirmed each serves a disjoint set of route files (9,
17, and 1 respectively, zero overlap). **Classification: A.**

### Retry logic — `aiService.js` vs `toolExecutionLayer.cjs`

Both define a function named `_withRetry`. Read both: `aiService.js`'s
version is a single-retry, HTTP-status-classified retry specific to AI
provider HTTP calls (429/503/connection-error only, explicitly never
retries 4xx auth errors). `toolExecutionLayer.cjs`'s version is a generic
multi-attempt exponential-backoff retry keyed on a `result.success`
field, for arbitrary tool executions that aren't necessarily HTTP calls at
all. Confirmed `toolExecutionLayer.cjs` has no dependency on `aiService.js`
— it isn't in a position to reuse the narrower, HTTP-specific retry even
if it wanted to. **Classification: A.**

### AI routing/provider selection — `aiOrchestrator.cjs`, `capabilityRouter.cjs`, `smartRouter.cjs`, `creativeRouter.cjs`

Verified via the dependency graph (not just name-matching): `aiOrchestrator.cjs`
explicitly reuses `capabilityRouter.detectCapability()`'s regex intent-
matching (own comment: "reuses capabilityRouter's intent patterns rather
than re-implementing regex matching") while independently handling its
own separate concerns (cost estimation, budget reservation, live
provider-reachability probing) that `capabilityRouter.cjs` doesn't do.
`capabilityRouter.cjs` and `smartRouter.cjs`/`aiRegistry.cjs` compose
(capabilityRouter requires and calls into smartRouter, not a parallel
reimplementation of it). No circular dependency (`capabilityRouter.cjs`
has no require of `aiOrchestrator.cjs`). **Classification: A** — layered
composition, not duplication.

### Feature gates

Only one implementation exists (`backend/services/featureGate.cjs`) — no
duplication to investigate.

### Plan/pricing/quota constants

`billingService.js`'s `PLAN_PRICES`/`PLAN_QUOTAS` (subscription tier
pricing and per-plan request quotas) and `creditEngine.cjs`'s
`PLAN_FREE_CREDITS` (daily AI credit allowance) each defined exactly once,
in their owning file — different concepts, no duplication.
`usageMetering.cjs`'s `PROVIDER_COSTS` is the single source of truth for
per-provider token pricing; confirmed `aiOrchestrator.cjs` imports it
rather than redefining it (this was fixed as part of the org-budget race
condition fix in the Production Chaos Certification pass, still holding).

### Telemetry/ledger recorders — `usageMetering.cjs` vs `promptHistory.cjs` vs `creditEngine.cjs`

All three define a `record`-shaped function and use an append-only ledger
file, which superficially looks like the same pattern reimplemented three
times. Read `promptHistory.cjs`'s own doc comment, which explicitly
addresses this: it exists specifically because `usageMetering.cjs`
deliberately never stores prompt/response text (a billing ledger, not a
conversation log), and explicitly notes it does not duplicate mission
memory / chat transcripts either. `creditEngine.cjs`'s ledger tracks a
different resource entirely (credit balance transactions, not cost/latency
telemetry or prompt content). Three different pieces of state, sharing an
append-only-ledger *storage pattern* by convention (which is itself a good
sign of consistency, not debt) but not the same *data or purpose*.
**Classification: A.**

### Circular dependencies

Spot-checked the pairing most likely to have one given this session's
prior findings (`aiOrchestrator.cjs` ↔ `capabilityRouter.cjs`) — confirmed
one-directional, no cycle. A systematic sweep across all 954 files would
need dependency-graph tooling (e.g. `madge`) not available in this
environment without installing new packages, which this mission's scope
doesn't call for unprompted. Given the codebase's pervasive use of lazy,
function-scoped `require()` (confirmed extensively during the Hidden
Capability Recovery pass — most cross-service dependencies are wrapped in
`try { require(...) } catch { return null }` inside functions rather than
resolved at module-load time), the specific failure mode circular
dependencies cause in Node (a partially-initialized export captured before
the cycle completes) is structurally unlikely here, since lazy requires
defer resolution until the function actually runs, by which point both
modules have fully initialized. Not exhaustively verified — flagged as a
real methodological limit, not a clean bill of health.

---

## Deliverables

### Single Sources Established

- Phone identity normalization within `crmService.js`: `_normalizePhone()`
  is now the one place this rule lives, for that file's purpose.
- (Already established by prior passes, reconfirmed still holding this
  pass: `runtimeEventBus.cjs` as the sole event bus, `usageMetering.PROVIDER_COSTS`
  as the sole provider-cost table, `taskQueue.cjs`/`missionMemory.cjs` as
  the sole task/mission persistence layers.)

### Architectural Debt Removed

- 6 duplicate phone-normalization call sites → 1 function
  (`crmService.js`).
- 2 orphaned duplicate implementations deleted
  (`agents/automation/eventListener.cjs`, `agents/automation/scheduler.cjs`)
  — both zero-reference, both superseded by real, live, already-verified
  systems.

### Legacy Paths Eliminated

None found this pass distinct from the two deletions above — no
"deprecated but still called" code paths were identified in the
categories investigated (the codebase's own `_deprecate()` middleware
pattern in `backend/routes/index.js`, e.g. for `/p18/`→`/runtime/*`
migrations, is an intentional, documented compatibility layer — class B,
correctly still serving real traffic, not touched).

### Real Consolidations

3 (see above) — 1 in-file DRY refactor, 2 dead-file removals.

### False Positives

6 categories investigated and ruled out with evidence (RBAC, retry logic,
AI routing/provider selection, feature gates, plan/pricing constants,
telemetry ledgers) — each read in full, each found to serve a genuinely
distinct concern despite surface-level naming similarity.

### Remaining External Blockers

None specific to this pass — consolidation work doesn't depend on external
infrastructure the way the chaos/resilience passes did. The one
methodological gap (no circular-dependency graphing tool available in this
environment) is noted above, not blocking, since the codebase's lazy-
require pattern makes the risk class it would detect structurally
unlikely here.
