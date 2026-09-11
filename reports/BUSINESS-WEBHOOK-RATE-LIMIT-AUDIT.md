# BUSINESS WEBHOOK RATE-LIMIT — AUDIT

**Track:** OOPLIX V1 Master Audit — backend coverage: webhooks / security
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`

---

## Why this item

Reconciled the register per this mission's own instruction. C10-005 and `/p18/memory/*` remain
**DECISION REQUIRED**, `SENTRY_DSN` remains **CREDENTIAL-BLOCKED** — neither touched.

Built the requested evidence-based coverage categorization across the mission's listed areas.
Investigated timeouts/cancellation first: zero `AbortController` usage anywhere in the backend, but
real per-call `axios` timeouts already exist for every AI provider call (`aiService.js`) — reasonably
covered, no actionable gap, moved past without inventing one.

Selected **webhooks** next: inventoried all 7 real `POST /business/webhook/*` routes
(`form`/`email`/`whatsapp`/`telegram`/`payment`/`calendar`/`:source` wildcard). This is the exact
surface a prior mission (Business Automation IDOR Audit) had already flagged: *"businessEventAdapter.cjs
... has zero orgId occurrences anywhere, and its routes are architecturally single global URLs with no
:orgId in the path at all — a deeper, genuine multi-tenancy gap in the webhook system's own design ...
explicitly out of this audit's scope, documented as a distinct limitation."* Never picked up since.

## Discovery

`business.js`'s own header comment claims these routes are *"protected by source validation."*
Live-verified this claim precisely: `businessEventAdapter.cjs`'s `normalize(source, raw)` only checks
that `source` matches a known key in its `_normalizers` map — a routing lookup, not an authenticity
check. There is no HMAC, no shared secret, no signature verification anywhere in this path, unlike the
separate, already-secured `/webhook/razorpay` (real `verifyWebhookSignature()` with a configured
`RAZORPAY_WEBHOOK_SECRET`).

**Live-reproduced the real consequence**, not just the theoretical gap:

```
POST /business/webhook/payment (no auth, no signature)
{
  "payment": {"amount": 100000000, "currency": "INR", "id": "fake_pay_123"},
  "customer_name": "Forged Attacker", "customer_email": "attacker@evil.com"
}

→ 200 {"success":true, "entityType":"deal", "missionId":"msn_9fe4b154af694b2fb95b571aecdc3951", "status":"ingested"}
```

The resulting mission was real: `status: "active"`, `priority: "high"`, real autonomous subtasks
already spawned ("Decompose goal", "Plan execution tasks", etc.), `orgId: null` — a genuine, real,
platform-global mission indistinguishable from a legitimate business event, created from a completely
fabricated ₹1,000,000 "payment" by an unauthenticated caller. Repeating this request has **no rate
limit at all** on any of the 7 routes.

## Scoping the fix

Two distinct problems exist here, and only one is code-controlled without a new decision:

1. **No authenticity verification** — closing this the same way `/webhook/razorpay` is closed would
   require a per-provider shared secret. The 6 generic routes (`form`/`email`/`whatsapp`/`telegram`/
   `calendar`/wildcard `:source`) are deliberately flexible multi-provider ingestion points with no
   single fixed secret configured — introducing one (per-source secrets? per-tenant tokens embedded in
   the URL?) is a genuine product/architecture decision this audit has no authority to invent. **Left
   as DECISION REQUIRED**, not guessed at.
2. **No rate limit** — this is the concrete, live-reproduced abuse vector actually exercised (free,
   unlimited, resource-consuming mission creation) and is closeable with existing, already-proven
   architecture with zero new decisions needed.

Fixed only (2), using the codebase's own already-proven `rateLimiter` middleware (1156+ existing call
sites elsewhere):

```diff
+const rateLimiter = require("../middleware/rateLimiter");
 ...
+const _webhookRL = rateLimiter(20, 60_000); // 20/min per IP per route
-router.post("/business/webhook/form",      (req, res) => _handleWebhook("form",      req, res));
+router.post("/business/webhook/form",      _webhookRL, (req, res) => _handleWebhook("form",      req, res));
 ... (identically for the other 6 routes)
```

20/min per IP per route was chosen to be generous enough for real burst traffic (a form page going
briefly viral, a WhatsApp provider's retry burst) while bounding the abuse vector actually measured.

## Live re-verification

```
POST /business/webhook/form × 22   → 20 × 200, then 2 × 429 (Retry-After, X-RateLimit-* correct)
POST /business/webhook/payment × 21 → 20 × 200, then 1 × 429
```

Confirmed on two independent routes, and again after a real server restart on the fix. Confirmed
`/health` and other unrelated routes remain unaffected (per-route bucketing, matching the middleware's
own documented isolation guarantee). Cleaned up all test-generated missions from live verification.

## Regression

- Added describe block `139-master-audit-business-webhook-rate-limit` to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`: a structural test confirming all 7 routes are
  gated by the shared rate limiter instance, and a live test exercising the real `rateLimiter` module
  directly (20 allowed, 5 rejected of 25 calls).
- An initial version of the live test drove 25 real HTTP requests through the actual running server —
  found to be slow (~17s, real mission-creation side effects requiring cleanup) and inconsistent with
  every other test in this file (which call services directly, none depend on a live server on :5050).
  Redesigned to call the middleware module directly instead — fast (under 5ms), zero side effects,
  proves the identical logic the routes are wired to.
- Negative-tested: reverted the fix, confirmed the structural test failed for the right reason (the
  middleware-direct test correctly still passed, since it tests the module's own behavior independent
  of wiring — expected and correct), restored, confirmed passing again.
- `npm run test:runtime`: **282/282** (280/280 baseline + 2 new tests).
- `tests/security/97-enterprise-isolation-integrity.cjs`: unaffected (1/1).
- Production build: unaffected (backend-only, no frontend files touched).
- `.env`: confirmed untouched throughout.
- A stale `.tmp` file left over from this session's own earlier heavy concurrent test runs
  (`task-queue.json.<pid>.<hash>.tmp`) was found during a full test-file re-run and removed as routine
  cleanup — confirmed non-corrupting (the real `task-queue.json` was intact and valid throughout); this
  was residue from prior legitimate SIGKILL testing, not a defect introduced by this mission.

---

## AUDIT NAME: Business Webhook Rate-Limit (7 unauthenticated ingestion routes)

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8/10
**CONFIDENCE:** 88%

## V1 SURFACE

- **Backend:** `backend/routes/business.js` (7 routes gated with a shared rate-limited middleware
  instance). `businessEventAdapter.cjs` read for root-cause confirmation, not modified.
- **Routes:** all 7 `/business/webhook/*` routes, live-tested with real HTTP against the running
  server.
- **Frontend:** N/A — these are external-system ingestion endpoints, no UI consumer.
- **Persistence:** N/A — no persistence-layer change; the fix is purely a rate-limiting gate.
- **Authentication:** N/A by design — these routes are intentionally public (external systems have no
  session); the gap addressed is authorization-adjacent (abuse prevention), not authentication.
- **Authorization:** N/A — no role/tenant boundary exists at this layer to widen or narrow.
- **Tenant Isolation:** Unaffected — the deeper `orgId: null` multi-tenancy gap remains open and is
  explicitly NOT claimed as fixed by this pass; correctly left as the prior mission's own documented,
  distinct limitation.
- **Cross-OS:** N/A — pure Express middleware, platform-independent.
- **Failure Honesty:** PASS — the new `429` response is real, honest, with correct
  `Retry-After`/`X-RateLimit-*` headers, matching the exact pattern already used 1156+ times elsewhere.
- **Live Verification:** real HTTP against the actual running server, on 2 independent routes, before
  and after a real restart, with real cleanup of test-generated side effects.
- **Regression:** 282/282 (0 failures, 0 skipped, 2 net new tests).

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed — 7 unauthenticated webhook routes had zero rate limiting, live-reproduced
  as a real abuse vector (free, unlimited, resource-consuming mission creation from a completely
  forged payload).
- **V1-critical P2:** 0
- **Other:** confirmed the "protected by source validation" claim in this file's own header comment
  means only a routing-key lookup, not authenticity verification — corrected understanding, not itself
  a code change.

## FIXES

- `backend/routes/business.js`: all 7 `/business/webhook/*` routes now composed with
  `rateLimiter(20, 60_000)`.
- 2 new regression tests (1 structural, 1 live), negative-tested.

## LIMITATIONS

- **No cryptographic authenticity check exists for the 6 generic-source routes** — correctly classified
  **DECISION REQUIRED**: closing this fully would need a product decision on the shared-secret model
  (per-source? per-tenant?) this audit has no authority to invent. Rate limiting bounds the abuse
  surface but does not eliminate the ability to inject a single forged event within the allowed rate.
- **The `orgId: null` multi-tenancy gap remains open**, exactly as the prior Business Automation IDOR
  Audit already documented and correctly deferred — not re-litigated or expanded in scope here.
- 20/min is a reasonable, evidence-informed default but was not tuned against real production traffic
  patterns for any specific customer's actual webhook volume — worth revisiting if a real integration
  is ever configured and found to legitimately exceed this rate.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Closes the concrete, live-reproduced portion of a webhook-security gap this session had already
identified but never acted on — unlimited, unauthenticated, resource-consuming mission creation is now
bounded. The remaining, larger question (authenticity + full multi-tenancy) is honestly left open as
DECISION REQUIRED / a distinct architectural limitation, not guessed at or silently expanded into. No
OS-track record altered.

## REGRESSION RESULT: 282/282 (0 failures, 0 skipped, 2 net new tests)

## BUILD RESULT: PASS (unaffected; backend-only change, no frontend files modified)

## CURRENT BASELINE: 282/282
