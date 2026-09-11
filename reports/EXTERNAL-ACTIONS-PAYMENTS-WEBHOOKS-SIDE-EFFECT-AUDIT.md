# EXTERNAL ACTIONS, PAYMENTS, WEBHOOKS & SIDE-EFFECT SECURITY AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-21 · **Branch:** `security/reality-completion`

---

## Scope

Razorpay payment routes (`payment.js`, `paymentService.js`), the Razorpay webhook handler
(`webhookController.js`), `/business/webhook/*` (7 routes), `billing.js`, `revenueOS.js`'s
subscription-mutation routes, and every credential/idempotency/replay/authorization property named in
the mission's 15-item checklist. No Stripe or PayPal implementation exists in this codebase — not
invented, per the mission's explicit rule.

## Pre-Audit Reconciliation — RECONFIRMED, not re-litigated

- **Razorpay webhook signature verification**: HMAC-SHA256 over the true raw request body (captured by
  `rawBody.js`, correctly mounted *before* `express.json()`), constant-time comparison, fails closed in
  production when the secret is unconfigured. Live re-verified: an unsigned forged `payment.captured`
  event attempting to activate an arbitrary account's billing is rejected `400 Invalid signature`.
- **`/business/webhook/*` (7 routes) rate limiting**: already fixed and certified by the "A-to-Z Backend
  Coverage Audit" mission (20/min per IP per route). Code unchanged.
- **`triggerFulfillment()`'s duplicate-webhook-delivery guard**: already fixed and certified (claim
  `onboardingDone` before the async WhatsApp send, not after — closes the exact TOCTOU window Razorpay's
  real retry-on-non-2xx behavior would otherwise exploit). Code unchanged, re-verified by direct read.
- **`revenueOS.js`'s subscription-lifecycle mutation routes** (`/revenue/subscriptions/:accountId/*`):
  already `operatorOnly`-gated at the router mount, not customer-reachable. Code unchanged.
- **Queue-layer refund idempotency** (`commercial.js`'s `credits.refund` via `approvalQueue`): already
  stress-tested clean (15×10 concurrent trials, exactly 1 success + 9 correct 409s) by the "Queue Layer
  Reliability & Safety Audit." Not webhook-reachable, out of this mission's scope.

## Genuine Defect Found and Fixed — 1, proven live, 2 call sites sharing the same root cause

**Unbounded external-API-cost payment mutation routes (P2).** `POST /payment/link` and
`POST /billing/upgrade` both make a real external Razorpay API call per request (payment-link
creation; subscription creation, plus a subscription-cancel call when a prior active subscription
exists) with zero rate limiting — the identical defect shape the "A-to-Z Backend Coverage Audit"
mission already fixed for `commercial.js`, `composer.js`, `legal.js`, `phase23.js`, and others, but
these two payment routes were not part of that earlier sweep. Live-reproduced: 16 rapid authenticated
calls to each route all reached the real external-call construction with zero throttling.

**Fixed** with the exact same established `rateLimiter` factory and magnitude convention already used
for equivalent single-shot external-API mutation routes elsewhere in this codebase (15/min per IP per
route) — no new framework, no architecture change.

**Live-verified**: the 16th rapid call to each route now correctly returns `429` with a real
`Retry-After` header; the Razorpay webhook's own separate, already-certified rate limiter (`30/min`,
distinct route, distinct purpose) is confirmed unaffected.

## Other Items Checked — Confirmed Clean, No Fix Needed

- **`billing.js`'s `/billing/activate` and `/billing/cancel`**: correctly authorization-scoped —
  `activate` requires `role === "operator"` before accepting a caller-supplied `accountId`; `cancel`
  self-scopes to `req.user.sub`, never client-controlled.
- **`/payment/link`'s `accountId`**: derived from the authenticated session (`req.user.sub`), never
  client-controlled — a customer cannot create a payment link or trigger billing activation for
  another account.
- **`/payment/link`'s unbounded `amount` parameter**: confirmed this is intentional product behavior,
  not a defect — the amount only sets what the link *asks for*; the caller isn't defrauding anyone by
  requesting an arbitrary sum for their own invoice/payment link, matching normal payment-link-creation
  products.
- **`billingService.activatePlan()`'s replay safety**: correct-by-design — it's an upsert to a fixed
  final state (`status:"active", plan:X`), not an accumulate/append operation, so replaying the
  identical webhook event multiple times produces no duplicate side effect (no double-charge, no
  duplicate credit grant).
- **`createRazorpaySubscription()`'s double-subscription prevention**: already correctly cancels any
  prior active Razorpay subscription before creating a new one on a plan change — confirmed present and
  unchanged, preventing concurrent double-billing.
- **Secrets never logged**: audited every `logger.*` call in `webhookController.js` and
  `paymentService.js` — only IDs, phone numbers, and amounts are logged; no API keys or webhook
  secrets appear in any log statement.
- **Generic-source webhook honesty** (`/business/webhook/*`'s 6 non-Razorpay sources): already
  correctly documented as deliberately unsigned generic ingestion points with no fixed shared secret to
  verify against — not conflated with Razorpay's genuinely HMAC-verified path.

## Limitations / Credential-Blocked

- **Live end-to-end Razorpay API verification** (payment-link creation, subscription creation) is
  credential-blocked in this environment: the configured `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`
  return `"Authentication failed"` against the real Razorpay API (placeholder/invalid test keys, not
  live sandbox credentials). This does not affect the rate-limit fix's validity — the fix operates at
  the route-middleware layer, before the external call is even attempted, and was proven live via real
  HTTP requests regardless of whether the downstream Razorpay call itself succeeds.
- No Stripe or PayPal implementation exists to audit — confirmed via full-repo search, not assumed;
  not invented as a missing feature per the mission's explicit rule.

## Regression

**Before:** 434/434 effective. **After:** 437/437 — a fully clean run with zero failures (including the
3 test blocks that flaked under load in the two immediately-prior missions, all passing cleanly this
run). **New tests:** 3 (block 167) — 2 structural + 1 live, covering both fixed routes and confirming
the webhook's own separate rate limiter is untouched. **Negative-tested**: reverted each fix
independently (`payment.js` first, confirmed the shared structural assertion and the `/payment/link`
live test both failed for the exact expected reason — `500 !== 429` — while the independent
webhook-rate-limiter test correctly still passed; then `billing.js`, confirmed the shared structural
assertion failed again for the `billing.js` half specifically), restored both, confirmed all 3 passed
again.

**Build:** PASS (`npm run build:frontend`, clean production build).
**Security suite:** `tests/security/97-enterprise-isolation-integrity.cjs` — 8/8 PASS (after waiting out
this environment's shared registration rate-limit window).
**Server:** restarted three times total (initial fix, negative-test revert, final restore — required
since `payment.js`/`billing.js` are `require()`-cached Express route modules), confirmed healthy after
each restart. **`.env`:** untouched. **No merge. No push.** Unrelated uncommitted work in the working
tree preserved throughout.