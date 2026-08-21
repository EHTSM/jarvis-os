# RATE-LIMIT COMPLETENESS — AUDIT

**Track:** OOPLIX V1 Master Audit — high-value security assessment
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`

---

## Method

The Master Coverage Matrix flagged: 151 route files, ~131 without a visible `rateLimiter` call.
Investigated by first tracing the actual rate-limiting architecture, then classifying every file's real
risk rather than treating "no `rateLimiter(...)` call" as an automatic defect.

## Phase 1 — Inventory

Read `backend/middleware/rateLimiter.js`: a real, working per-IP+per-route in-memory limiter factory
(`rateLimiter(limit, windowMs, routeId)`), with proper bucketing (`${ip}:${routeId}:${windowMs}`),
`X-RateLimit-Limit`/`X-RateLimit-Remaining`/`X-RateLimit-Reset` headers on every response, and
`Retry-After` + `429` on breach. Confirmed **no global/app-level rate limiter exists anywhere in
`server.js`** — every protected route relies purely on an explicit, per-file call. 19 files already used
it directly at audit start (`accounts.js`, `ai.js`, `auth.js`, `browser.js`, `business.js`,
`codingAssistant.js`, `creativeStudio.js`, `crm.js`, `enterprisePolicy.js`, `founderAssistant.js`,
`founderVault.js`, `growthOS.js`, `jarvis.js`, `odi.js`, `orgAgents.js`, `orgAiBrain.js`, `phase27.js`,
`runtime.js`, `whatsapp.js`). 132 files had zero direct usage — matching the Matrix's "~131" figure.

Delegated the bulk classification of all 132 files to a sub-agent (breadth-first: auth gate, category,
one-line reason per file, plus a ranked "top candidates" shortlist), then **independently re-verified
every AI-cost claim against the actual backing service code** rather than trusting the label — this is
the step that caught 2 false positives before they became wasted fixes:

- `contentSEO.js` was labeled AI_TOKEN_COST, but `contentSEOEngine.cjs` has zero `aiService`/`axios`/
  `fetch` calls anywhere — it's pure local prompt/template-building logic, not execution. Excluded.
- `founderTwin.js` was labeled AI_TOKEN_COST, but none of its 5 backing engines
  (`digitalTwinEngine.cjs`, `founderProfileEngine.cjs`, `decisionLearningEngine.cjs`,
  `approvalPredictionEngine.cjs`, `workflowPreferenceEngine.cjs`) call any AI service. Excluded.
- Confirmed the remainder via direct source read: `codingBundle.js` → `repositoryEditingEngine.cjs` →
  real `aiService` calls; `aiEcosystem.js` → `aiOrchestrator.cjs`; `phase23.js` → `gitHubEngineeringAgent.cjs`
  (`require("https")`, real GitHub API calls) + `toolExecutionLayer.cjs` (same); `composer.js` →
  `aiComposerEngine.cjs`; `legal.js` → `legalDocumentEngine.cjs`; `launchPlatform.js` → `academyEngine.cjs`
  → real `aiService` calls (confirmed via its own header comment: "Reuses aiService.js's real callAI").

`phase24.js`'s `/p24/vscode/*` routes appeared to have no `requireAuth` per-route, but `router.use("/p24",
requireAuth)` at file scope covers all of them — confirmed correctly authenticated, not a gap.

## Phase 2-3 — Prioritization and fixes

**P0 (unauthenticated, zero rate limit):**

1. `payment.js` — `POST /webhook/razorpay`, `POST /razorpay-webhook`: unauthenticated by design
   (Razorpay calls these directly), HMAC-verified inside the handler, but a flood could exhaust
   webhook-processing capacity before the signature check runs. Added `rateLimiter(30, 60_000,
   "payment-webhook")`.
2. `phase21.js` — `GET /oauth/:provider/callback`: unauthenticated by design (the IdP redirects the
   browser here before any session exists). Added `rateLimiter(20, 60_000, "oauth-callback")`.
3. `workspace.js` — `GET /invite-preview/:token`: unauthenticated by design (the invitee may have no
   account yet). An invite-token enumeration/guessing surface. Added `rateLimiter(30, 60_000,
   "invite-preview")`.

**P1 (authenticated, high real-world risk):**

4-5. `commercial.js` — `POST /commercial/credits/consume`, `POST /commercial/credits/topup`: real
   financial mutations (credit consumption tracks real spend; topup adds real value). Refunds were
   excluded — they already route through `approvalQueue`, a real, existing approval gate, so a rate
   limiter there would be redundant. Added a shared `rateLimiter(120, 60_000,
   "commercial-credits-mutate")` — high enough not to block a normal working session's AI-request
   volume, low enough to bound abuse.
6-7. `founderIdentityOS.js` — `POST /fdios/secrets/scan`, `POST /fdios/credential-intelligence/run`:
   real filesystem/credential-surface scans, `requireAuth`-only (not `operatorOnly`, unlike its sibling
   `founderAutomation.js`). The auth-tier inconsistency itself is a pre-existing, already-flagged
   DECISION REQUIRED item from the Endpoint Authorization Sweep mission — out of scope to re-litigate
   here — but the rate-limit gap applies regardless of who can authenticate. Added a shared
   `rateLimiter(10, 60_000, "fdios-scan")`.
8. `ops.js` — `POST /runtime/reboot`: literally calls `process.exit(0)`. Already gated
   `operatorOnly`+`operatorAudit` at mount (real, existing defense), but zero rate limit meant a
   misclick or a compromised operator session could trigger a reboot loop. Added a tight
   `rateLimiter(3, 5 * 60_000, "runtime-reboot")` on top of the existing gates.
9. `composer.js` — `POST /composer/create`: real AI plan generation via `aiComposerEngine.cjs`. Added
   `rateLimiter(15, 60_000, "composer-create")`.
10. `legal.js` — `POST /legal/documents/generate`: real AI-drafted legal document generation. Added
   `rateLimiter(15, 60_000, "legal-doc-generate")` — placed **after** the existing
   `attachWorkspace`/`requireWorkspaceMember` chain specifically to preserve the exact middleware
   ordering a prior, already-certified test (`143-master-audit-legal-cross-tenant-idor`) asserts on
   (see Phase 8 below).
11. `launchPlatform.js` — `POST /launch/academy/paths/generate`: real AI-generated learning paths via
   `academyEngine.cjs`. Added `rateLimiter(15, 60_000, "academy-path-generate")`.
12. `phase23.js` — all `/p23/*` routes: every route in this file either calls the real GitHub API
   (`gitHubEngineeringAgent.cjs`, via Node's `https` module) or runs code-review/release analysis over
   real repo content. Applied a file-scoped `router.use("/p23", rateLimiter(30, 60_000,
   "p23-engineering"))`, matching the existing `phase27.js` precedent for a uniformly-external-calling
   route file.
13-14. `aiEcosystem.js` — `POST /ai-ecosystem/orchestrator/execute`, `.../execute/stream`: real
   AI-provider execution, already gated by `billing.requireUsageQuota` (a real, existing quota
   mechanism). Quota bounds spend per billing period but does not stop a rapid burst within that
   budget — the rate limiter is complementary, not redundant. Added a shared
   `rateLimiter(30, 60_000, "ai-ecosystem-orchestrator")`.

No new rate-limiting framework was introduced; every fix reuses the existing `rateLimiter.js` factory
unmodified.

## Phase 6 — Negative testing

Two rounds. First: reverted `workspace.js`'s invite-preview limiter and `composer.js`'s create limiter
simultaneously, restarted the server, confirmed both the structural test and the live 429-boundary test
failed for the correct reasons (3 of 4 new tests failed; the OAuth-callback smoke test correctly kept
passing, since it wasn't touched by this revert), restored both files, confirmed all tests passing again.

Second (triggered by the Phase 8 regression — see below): reverted the `legal.js` middleware reorder back
to its broken position, confirmed test `143-master-audit-legal-cross-tenant-idor`'s structural assertion
failed for the exact expected reason (`generate must require real workspace membership`), restored the
correct order, confirmed passing again.

## Phase 7 — Live verification

Restarted the server after every source change (5 restarts total across the mission). Verified:

- Unauthenticated routes remain reachable and behave correctly: `/webhook/razorpay` returns real `400
  Invalid signature` for an unsigned probe (not blocked by the new limiter), with genuine
  `X-RateLimit-Limit: 30` present on the response.
- `/invite-preview/:token` returns real `429` with `Retry-After` after exceeding 30 requests/minute.
- The OAuth callback route stays reachable and returns a clean error (not a 500) for an invalid/expired
  state — confirming the new limiter didn't break the handler chain.
- All 9 P1 authenticated routes correctly still return `401 Unauthorized` (via `requireAuth`) for
  unauthenticated probes — the rate limiter did not weaken or bypass any existing authentication gate.

**Investigated and correctly dispositioned an apparent unrelated defect during this phase**: an initial
probe against `/payment/webhook/razorpay` (note the `/payment` prefix) returned `401 Unauthorized`,
which looked like it could be a real, separate authorization bug. Root-caused with a temporary,
fully-removed debug trace (confirmed via `git diff` that zero instrumentation remains in
`authMiddleware.js` or `rateLimiter.js`) rather than assumed: the real, correct webhook URL has **no**
`/payment` prefix — confirmed via `paymentService.js`'s own `callback_url` construction
(`` `${_baseUrl}/webhook/razorpay` ``) and 4 other services (`rc2.cjs`, `productionWiring.cjs`,
`productionWiring2.cjs`, `revenueOS.cjs`) all referencing the same real, unprefixed path. The wrong,
`/payment`-prefixed path was falling through every registered route to `productFactory.js:64`'s bare,
unscoped `router.use((req, res, next) => requireAuth(...))` — the exact "an unscoped `router.use`
intercepts every unmatched cross-router request" hazard `server.js`'s own header comment already
documents (currently mitigated there only for static frontend assets, not for this case). Confirmed via 3
independent isolation tests — `payment.js` mounted alone, the real pre-`payment.js` middleware chain from
`index.js`, and the full live server — that the actual, correctly-pathed route behaves exactly as
intended. This was a testing-methodology error on this audit's own part, not a defect introduced by this
mission's changes; caught and corrected before being reported as a finding. The underlying
`productFactory.js:64` pattern is a genuine, pre-existing latent risk (any request to an unregistered
path that reaches this router in the chain gets auth-challenged instead of 404ing) but is an
authorization-architecture question, out of scope for a rate-limit-only mission — noted here for the
record, not fixed.

## Phase 8 — Full regression

First full run surfaced a real, self-caused regression: the initial `legal.js` fix placed the new rate
limiter between `requireAuth` and `attachWorkspace`/`requireWorkspaceMember`, which broke a pre-existing,
already-certified structural test from the Endpoint Authorization Sweep mission
(`143-master-audit-legal-cross-tenant-idor`) that asserts on the exact certified middleware sequence.
Root-caused immediately — not weakened or worked around — by reordering the rate limiter to run *after*
the membership check instead (preserves the certified auth ordering; rate limiting a request that's
about to be rejected 403 anyway costs nothing meaningful). Re-ran the full suite clean.

**305/305** (300/300 baseline + 5 new tests). Production build: PASS.
`tests/security/97-enterprise-isolation-integrity.cjs`: unaffected (8/8). `.env`: confirmed untouched.

---

## AUDIT NAME: Rate-Limit Completeness Audit

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.5/10
**CONFIDENCE:** 88%

## INVENTORY

- **Total route files:** 151
- **Already rate-limited (pre-existing):** 19
- **Inherited/shared protection:** 0 (no global limiter exists — confirmed architecturally; every
  protection is a real, explicit per-file call)
- **Legitimate exemptions (low-risk read-only, internal dashboards, health/status endpoints, etc.):**
  ~110 (the bulk of the 132 — CRUD reads, org-scoped dashboards, internal tracking, platform-wide
  `operatorOnly`-gated tooling with low call volume)
- **Genuinely missing, now fixed:** 12 gaps across 11 files (3 P0 unauthenticated, 9 P1 authenticated
  high-risk)
- **Decision required:** 0 new (the `founderIdentityOS.js`/`founderAutomation.js` auth-tier
  inconsistency and the `productFactory.js:64` bare-`router.use` pattern are both pre-existing/adjacent
  findings, not rate-limit decisions — noted, not adjudicated here)

## V1 SURFACE

- **Backend:** 11 route files modified, additive only (new `rateLimiter` import + middleware argument);
  zero removed functionality
- **Routes:** 12 specific routes/route-groups gained rate limiting; all other routes unchanged
- **Frontend:** N/A — no frontend files touched; rate limiting is server-enforced and transparent to
  legitimate client usage patterns (limits set well above normal single-session call volume)
- **Persistence:** N/A — the rate limiter is in-memory only (`_rateMap`), matching its pre-existing
  design; no new persistence introduced
- **Authentication:** unaffected — every `requireAuth`/`operatorOnly` gate on every fixed route verified
  unchanged and still returning `401`/`403` correctly for unauthenticated/under-privileged probes
- **Authorization:** unaffected, with one exception requiring active care: `legal.js`'s certified
  membership-check ordering (`requireAuth, attachWorkspace, requireWorkspaceMember`) was preserved
  exactly — the rate limiter was deliberately placed after it, not before, and this was proven correct
  via the Phase 8 regression + fix + negative-test cycle
- **Tenant Isolation:** unaffected — no tenant-scoping logic touched
- **Failure Honesty:** PASS — 429 responses are real (`X-RateLimit-*` headers genuinely reflect
  in-memory state, `Retry-After` is a real computed value), verified live, not simulated
- **Live Verification:** real `429` reproduced on `/invite-preview/:token`; real `X-RateLimit-Limit`
  header confirmed present on `/webhook/razorpay`'s real `400 Invalid signature` response; OAuth
  callback confirmed still reachable and not 500ing
- **Regression:** 305/305

## FINDINGS

- **P0:** 3 found and fixed — unauthenticated webhook/OAuth-callback/invite-preview routes with zero
  rate limit (resource-exhaustion and token-enumeration risk, not data-exposure — all 3 have separate,
  correct protections against the more severe risks: HMAC signature verification, OAuth state/nonce,
  and a real random token respectively)
- **P1:** 9 found and fixed — authenticated but high-cost (real financial mutation, expensive
  filesystem scan, process-killing endpoint, real AI-provider/external-API calls) routes with zero rate
  limit
- **V1-critical P2:** 1 — the `legal.js` middleware-ordering near-miss (caught and fixed before it
  reached the regression baseline, not shipped as a defect)
- **Other:** 2 false-positive AI-cost classifications caught and excluded before any wasted fix work
  (`contentSEO.js`, `founderTwin.js`); 1 pre-existing, adjacent, out-of-scope authorization pattern
  noted (`productFactory.js:64`'s bare `router.use`) but correctly not fixed under a rate-limit-only
  mandate; 1 pre-existing auth-tier inconsistency noted (`founderIdentityOS.js` vs
  `founderAutomation.js`) but correctly left to the already-open DECISION REQUIRED item from the prior
  Endpoint Authorization Sweep mission rather than re-litigated here

## FIXES

- `backend/routes/payment.js` — `rateLimiter(30, 60_000, "payment-webhook")` on both Razorpay webhook
  routes
- `backend/routes/phase21.js` — `rateLimiter(20, 60_000, "oauth-callback")` on the OAuth callback
- `backend/routes/workspace.js` — `rateLimiter(30, 60_000, "invite-preview")` on invite-preview
- `backend/routes/commercial.js` — shared `rateLimiter(120, 60_000, "commercial-credits-mutate")` on
  consume + topup
- `backend/routes/founderIdentityOS.js` — shared `rateLimiter(10, 60_000, "fdios-scan")` on both scan
  routes
- `backend/routes/ops.js` — `rateLimiter(3, 5 * 60_000, "runtime-reboot")` on `/runtime/reboot`
- `backend/routes/composer.js` — `rateLimiter(15, 60_000, "composer-create")` on `/composer/create`
- `backend/routes/legal.js` — `rateLimiter(15, 60_000, "legal-doc-generate")` on `/legal/documents/generate`,
  placed after the existing membership-check chain
- `backend/routes/launchPlatform.js` — `rateLimiter(15, 60_000, "academy-path-generate")` on academy
  path generation
- `backend/routes/phase23.js` — file-scoped `router.use("/p23", rateLimiter(30, 60_000,
  "p23-engineering"))`
- `backend/routes/aiEcosystem.js` — shared `rateLimiter(30, 60_000, "ai-ecosystem-orchestrator")` on
  both orchestrator execute routes, composed after the existing `billing.requireUsageQuota` gate

## LIMITATIONS

- The remaining ~110 "legitimate exemption" files were classified by risk category (auth gate + route
  purpose), not individually load-tested — consistent with the mission's own explicit permission not to
  manually test every endpoint when a safe representative classification establishes the architecture.
  A future traffic spike on any specific one of them would be a real, separate investigation, not
  something this audit can rule out with certainty.
- The rate limiter is in-memory only (pre-existing design, not changed here) — limits reset on process
  restart and are not shared across multiple server instances if this deployment is ever
  horizontally scaled. This is a real, pre-existing architectural constraint, not introduced or worsened
  by this mission.
- `founderIdentityOS.js`'s `requireAuth`-only (vs. `operatorOnly`) gating on secrets-scan and
  credential-intelligence routes remains an open, pre-existing authorization question — this mission
  added rate limiting regardless of that question's outcome, but did not resolve it. DECISION REQUIRED,
  inherited from the Endpoint Authorization Sweep mission, not newly raised here.
- `productFactory.js:64`'s bare, unscoped `router.use(requireAuth...)` is a genuine authorization-routing
  hazard (any unmatched request path reaching this point in the router chain gets a `401` instead of a
  `404`) — noted for the record during this mission's live-verification work, but authorization
  architecture is out of scope for a rate-limit-only mandate. Recommend a future authorization-focused
  pass audit every bare (non-path-scoped) `router.use(requireAuth...)` call across all 151 route files
  for the same hazard class.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Closes the Master Coverage Matrix's rate-limit gap with a small, precisely-targeted set of fixes rather
than a blanket sweep — 12 genuine gaps fixed out of 132 candidate files, with 2 false positives caught
and excluded before wasted work, and one self-introduced regression caught and fixed within the same
mission before it could reach the baseline. Surfaces two adjacent, pre-existing findings
(`productFactory.js:64`'s bare `router.use`, `founderIdentityOS.js`'s auth-tier gap) for a future pass
without attempting to fix them outside this mission's mandate. No new rate-limiting framework
introduced. No OS-track record altered.

## REGRESSION

**Before:** 300/300
**After:** 305/305
**New tests:** 5
**Failures:** 0
**Skipped:** 0

(One self-caused regression against a pre-existing certified test — `143-master-audit-legal-cross-tenant-idor`
— was introduced mid-mission by the first `legal.js` fix attempt, caught by the Phase 8 full regression
run, root-caused, fixed via reordering rather than weakening either test, and negative-tested; not
present in the final clean regression result above.)

## BUILD: PASS

## UPDATED REMAINING HIGH-VALUE COVERAGE

- The ~15-file MEDIUM-priority founder/ops endpoint-authorization cluster remains open (unchanged from
  the Endpoint Authorization Sweep mission).
- `founderIdentityOS.js` vs `founderAutomation.js` auth-tier inconsistency: DECISION REQUIRED (inherited,
  not new).
- New, adjacent finding for a future pass: audit all bare (non-path-scoped) `router.use(requireAuth...)`
  calls across the 151 route files for the same "intercepts unmatched cross-router requests" hazard
  class demonstrated live by `productFactory.js:64` during this mission's verification work.
- Credential blockers: `SENTRY_DSN`; operator-tier live verification for all prior `operatorOnly` fixes
  across this session (no real operator test account exists).
- Decision-required items: C10-005 (3 non-reconciled memory backends), `/p18/memory/*`
  (authorization/product-scope question) — both pre-existing, untouched.

## CURRENT BASELINE: 305/305

STOP.
