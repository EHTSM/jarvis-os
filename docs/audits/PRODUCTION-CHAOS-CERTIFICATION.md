# Production Resilience & Chaos Certification

Execution-only pass: simulate real failure conditions against real production
code (no mocked business logic — only network/IO boundaries are simulated),
verify recovery/fallback/idempotency/no-fake-success, fix only verified
defects, reuse existing architecture. Every finding has file evidence, every
fix is verified live with a before/after reproduction, every module gets a
full regression run and a permanent test.

## Scope discipline

This certification does **not** claim numbers for scenarios that require
infrastructure unavailable in this environment: no live AI provider
accounts, no real OAuth providers, no distributed cluster, no real browser
automation runtime, no code-signing/updater infrastructure, no 1000-node
load-testing rig. Where the original request asked for a numeric score
derived from a live test that can't actually run here (e.g. "1000 concurrent
missions," "Scalability Score"), this document says so explicitly instead of
fabricating a number — inventing a plausible-looking score would violate the
mission's own "never invent failures, never invent fixes" rule.

What *is* in scope: real chaos injection at the code boundary (mocking the
network/IO layer only, e.g. `axios.post` or a queue's timer, never the
business logic under test) against real production functions, run to
completion, with real before/after verification.

---

## Module C1 — AI Provider Failure Resilience (VERIFIED CLEAN, no fix needed)

### What was tested

`backend/services/aiService.js`'s `chat()` function — the single entrypoint
every AI-calling code path in this codebase goes through — under 8 real
failure-injection scenarios, mocking only the HTTP layer (`axios.post`) so
every retry/fallback/error-classification decision under test is real
production code:

| # | Scenario | Injection | Verified behavior |
|---|---|---|---|
| 1 | Timeout | `ETIMEDOUT` on primary provider | Falls back to next provider in chain |
| 2 | Rate limit (transient) | `429` once, then success | Retries exactly once (800ms backoff), succeeds |
| 3 | Rate limit (persistent) | `429` every call | Retries exactly once (not infinitely), then falls back to next provider |
| 4 | Invalid/revoked credentials | `401` | NOT retried (fails fast, no wasted retry budget on an auth error), falls back |
| 5 | Missing API key | env var unset, single provider explicitly requested | Throws immediately, no silent fake success |
| 6 | Provider fully offline | `ECONNREFUSED` on first 2 providers in chain | Falls through the whole chain to a working provider |
| 7 | Malformed response | response body missing expected `choices[0]` shape | Throws internally (real TypeError), falls back — never returns garbage as success |
| 8 | All providers fail | `ECONNREFUSED` on every provider | Throws a real, honest error (`"All AI providers failed — check your API keys."`) — no fake success, no silently empty response |

**Result: 8/8 PASS.** No fix needed — this is real, working resilience
infrastructure already in production, not aspirational.

### Evidence

- Per-provider timeout config: `backend/services/aiService.js:160-175`
  (`TIMEOUTS` object, one entry per provider, env-overridable).
- Retry classification: `backend/services/aiService.js:178-195`
  (`_isRetryable`/`_withRetry`) — retries only `ECONNRESET`/`ECONNREFUSED`/
  `ETIMEDOUT`/`ENOTFOUND`/429/503, explicitly excludes 4xx auth errors,
  retries exactly once with 800ms backoff.
- Fallback chain: `backend/services/aiService.js:728-791` (`chat()`) — a
  `for` loop over `_providerOrder()`, catches per-provider, records
  `_state.lastFailures[p]`, continues to next provider, only throws after
  every provider in the chain has failed.

### Telemetry gap (documented, not fixed — narrow, secondary)

`aiService.js` and `aiOrchestrator.cjs` record failures into in-memory state
(`_state.lastFailures`, pollable via `getProviderStatus()`, which IS exposed
via a real route — `backend/routes/phase27.js:351`) and persist real
cost/latency/success telemetry to `usageMetering`'s ledger on every call
(confirmed in the prior Production Blocker Elimination pass, Module 3/7).
What's genuinely missing: no real-time **push** event (via
`runtimeEventBus`) on provider failure or mid-request fallback — an
operator watching a live dashboard wouldn't see a fallback happen as it
happens, only on next poll of `getProviderStatus()`. This is a real,
verified gap (grepped for `runtimeEventBus`/`.emit(` in both files — zero
hits), but narrow: pollable telemetry already exists and satisfies "every
subsystem emits real telemetry, no fabricated metrics." Left undone in this
pass to prioritize the higher-severity findings below; flagged here with
exact file evidence for a future pass.

---

## Module C2 — Webhook Fulfillment Idempotency (CONFIRMED DEFECT, FIXED)

### Reproduce

Razorpay retries webhook delivery on any non-2xx response or timeout — this
makes duplicate `payment.captured` events for the same phone number a real,
expected production scenario, not a contrived edge case.

`backend/services/automationService.js`'s `triggerFulfillment(phone, name)`
checked `lead.onboardingDone`, then `await`ed a slow WhatsApp send
(`wa.sendMessage`), then marked `onboardingDone: true` only afterward — the
same check-then-await-then-write shape found and fixed in the credit engine
during the prior Production Blocker Elimination pass (Module 3).

Verified live against the real webhook controller, real CRM service, and a
mocked (but realistically slow, 25ms) WhatsApp send:

```
10 concurrent duplicate payment.captured webhooks for the same phone
  → before fix: 10/10 sent the WhatsApp welcome message (should be 1)
  → after fix:   1/10 sent the WhatsApp welcome message
```

Confirmed with an explicit before/after `git stash` A/B comparison against
the same test script — not assumed from reading the code alone.

### Root cause

`backend/services/automationService.js:231-256` (pre-fix) — `crm.getLead()`
check, `await wa.sendMessage(...)`, then `crm.updateLead(..., onboardingDone: true)`
committed only after the slow send. `crmService.updateLead()` itself is
fully synchronous (confirmed by reading `crmService.js` — plain `_read()`/
`.map()`/`_write()`, no `await` inside), so the race exists entirely in the
*caller's* ordering, not in `updateLead()` itself.

### Fix

`backend/services/automationService.js` — `triggerFulfillment()` now claims
`onboardingDone: true` via `crm.updateLead()` **before** starting the slow
WhatsApp send, closing the gap (since `updateLead()` is synchronous, the
claim is atomic per call under Node's single-threaded event loop — same
reasoning as `creditEngine.reserve()`). If the send itself throws, the claim
is released (`onboardingDone: false`) so a genuine retry (e.g. an operator
manually re-running fulfillment) isn't permanently blocked by a failed send.

### Regression

Full legacy suite (`node --test tests/legacy/*.test.cjs`): 83 pass / 72
fail — identical to the established baseline from the prior pass, no new
regressions.

### Permanent test

`tests/security/16-webhook-fulfillment-idempotency.cjs` (3/3 pass) — fires
10 concurrent duplicate webhook deliveries through the real HTTP route and
asserts exactly one WhatsApp send and a correct final `onboardingDone: true`
state.

### Audit trail

Every webhook event is already logged via `logger.info` with the event
type, payment id, and phone (`webhookController.js:35-42`) — sufficient
audit trail for this finding; no new logging needed.
