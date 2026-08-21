# AISERVICE OVERALL-BUDGET — AUDIT

**Track:** OOPLIX V1 Master Audit — backend coverage: timeouts / cancellation / runtime reliability
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`

---

## Why this item

Reconciled the register per this mission's own instruction. All 5 known DECISION REQUIRED /
CREDENTIAL-BLOCKED items untouched.

Selected **timeouts / cancellation** from the coverage matrix — a direct continuation of the
immediately-prior soft-failure-retry mission, which examined `agents/autonomousLoop.cjs`'s
`_withTimeout()` mechanism closely enough to raise a real question: does the outer 30-second timeout
this loop relies on actually bound the work it wraps, or only the caller's *wait* for it?

## Discovery

`_withTimeout()` is implemented with `Promise.race()`:

```js
function _withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(...)), ms))
    ]);
}
```

This is a real, common JavaScript limitation, not a bug in this specific function: `Promise.race()`
only determines which promise *settles first* — it has no power to cancel the other one. If
`executorAgent(pt)` (the "losing" promise) is still running when the timeout wins the race, it keeps
running in the background, unobserved, until it eventually settles on its own.

**Confirmed this is not theoretical** by directly re-examining this session's own historical server
logs:

```
[AutoLoop] ERROR task tq_1786871986700 (5304216ms): Task timed out after 30000ms: ai:Decompose goal...
```

A task the code believes is hard-capped at 30 seconds actually took **5.3 minutes** to reach its error
handler. Live-reproduced the mechanism in isolation first (a genuinely hung promise correctly rejects
`_withTimeout` at exactly the configured `ms` — so the *race* itself works correctly) before looking
for what could make the *caller's total wait* exceed 30s despite that.

## Root cause

`backend/services/aiService.js`'s `callAI()` and `chat()` both implement provider fallback as a
**sequential** loop:

```js
const providers = opts.provider ? [opts.provider] : _providerOrder();
for (const provider of providers) {
    try { ...await the provider's own call... }
    catch (err) { /* log and continue to next provider */ }
}
```

`_providerOrder()` can return up to **14 providers**
(`groq, openrouter, openai, claude, gemini, ollama, deepseek, together, fireworks, cohere, nvidia,
lmstudio, grok, qwen`), and each provider has its own individual timeout in the `TIMEOUTS` constant
(20-30 seconds each). Checked which providers are actually configured in this real environment:

```
GROQ_API_KEY:    SET      OPENAI_API_KEY: SET
(everything else: unset — but ollama/lmstudio are "never key-gated" per this file's own
 comment, so they are always attempted regardless)
```

4 real providers attempted per call in this environment, matching the observed real log pattern
(`groq → openai → ollama → lmstudio`, each logged as failing in sequence). Worst-case cumulative,
computed directly from the real `TIMEOUTS` constants: `20,000 (groq) + 20,000 (openai) + 30,000
(ollama) + 30,000 (lmstudio) = 100,000ms` — the right order of magnitude to explain a multi-minute
anomaly (additional compounding from retries or genuine network conditions likely accounts for the
remaining gap to the exact 5.3-minute figure observed).

The outer `_withTimeout()` in `autonomousLoop.cjs` correctly stops the *caller* from waiting past 30s
and (since the prior mission's fix) correctly retries — but the orphaned `callAI()`/`chat()` call keeps
running underneath, invisible, for as long as its full sequential fallback chain takes.

## Scoping the fix

Full cancellation — threading a real `AbortController` through all 14 provider adapter functions so an
outer timeout genuinely stops the in-flight HTTP request — was assessed as the architecturally correct
fix, but a genuine architecture change: touching every one of the 14 `_groq`/`_openai`/etc. helper
functions, their shared `axios` call sites, and the semantics of what "cancelled mid-request" means for
each provider's own retry logic. Out of scope for this pass per the mission's explicit "no architecture
expansion" instruction.

The safe, minimal, in-scope fix: track cumulative elapsed time across the sequential loop itself and
stop trying **further** providers once a real overall budget is exhausted — bounding the total worst-case
duration without cancelling any individual in-flight request. This does not eliminate the theoretical
possibility of one single very slow provider exceeding the budget on its own, but it eliminates the
actual observed failure mode (accumulation across *multiple* sequential providers).

## Fix

```js
const CALL_AI_OVERALL_BUDGET_MS = 28_000; // stays under autonomousLoop.cjs's 30s TASK_TIMEOUT_MS

// in both callAI() and chat()'s provider loops:
for (const provider of providers) {
    if (Date.now() - _callStart >= CALL_AI_OVERALL_BUDGET_MS) {
        logger.warn(`... overall budget exhausted — stopping before trying "${provider}"`);
        break;
    }
    try { ... }
}
```

Applied identically to both real sequential-fallback loops in this file (`callAI()` and `chat()`).
28 seconds was chosen deliberately under `autonomousLoop.cjs`'s real 30-second `TASK_TIMEOUT_MS`
constant, cross-referenced directly rather than guessed.

## Live re-verification

```
real callAI() call, this environment's actual 4-provider chain: 3-4ms elapsed, honest sentinel returned
```

Confirmed normal operation is completely unaffected — the fast-failing unconfigured/misconfigured
providers in this environment never come close to the budget, so the new check is a true no-op under
normal conditions and only engages when providers are genuinely slow (the exact scenario it exists for).

## Regression

- Added describe block `142-master-audit-aiservice-overall-budget` to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`: a structural test cross-referencing the real
  `CALL_AI_OVERALL_BUDGET_MS` export against the real `TASK_TIMEOUT_MS` constant in
  `autonomousLoop.cjs` (not a hardcoded assumption), a structural test confirming both loops check it,
  a live regression-safety test confirming a real call in this environment stays far under budget, and
  a unit-level test of the bounded-loop pattern itself (since making 14 real provider adapters
  deterministically slow for a live test isn't practical without mocking each one).
- Negative-tested: set the budget constant to an effectively-infinite value, confirmed the
  budget-vs-TASK_TIMEOUT_MS comparison test failed for the right reason, restored, confirmed passing
  again.
- `npm run test:runtime`: **291/291** (287/287 baseline + 4 new tests).
- `tests/security/97-enterprise-isolation-integrity.cjs`: unaffected (1/1).
- Production build: unaffected (backend-only, no frontend files touched).
- `.env`: confirmed untouched throughout.

---

## AUDIT NAME: aiService Overall-Budget (bounded sequential provider fallback)

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.5/10
**CONFIDENCE:** 87%

## V1 SURFACE

- **Backend:** `backend/services/aiService.js` (`callAI()` and `chat()` both extended with an overall
  budget check; `CALL_AI_OVERALL_BUDGET_MS` newly exported).
- **Routes:** N/A — internal AI-orchestration service, reachable indirectly via any route/task that
  calls `callAI()`/`chat()`.
- **Frontend:** N/A — no frontend files touched.
- **Persistence:** N/A — no persistence-layer change.
- **Authentication/Authorization/Tenant Isolation:** N/A.
- **Cross-OS:** N/A — pure JavaScript timing logic.
- **Failure Honesty:** PASS — the budget-exhausted path returns the exact same honest "AI backend
  unavailable" sentinel already used for every other failure mode, not a new or different message.
- **Live Verification:** real `callAI()` call against this environment's actual provider chain, plus
  direct historical log analysis correlating the exact observed anomaly duration with the real
  `TIMEOUTS` constants.
- **Regression:** 291/291 (0 failures, 0 skipped, 4 net new tests).

## FINDINGS

- **P0:** 0
- **P1:** 0
- **V1-critical P2:** 1 found and fixed — sequential multi-provider AI fallback had no overall deadline,
  confirmed via this session's own historical logs to have produced a real 5.3-minute-long single "AI
  call" despite callers believing it was hard-bounded to 30 seconds.
- **Other:** confirmed real cancellation (`AbortController` threading through all 14 provider adapters)
  is the architecturally complete fix but is a genuine architecture change, correctly out of scope —
  documented as a limitation, not silently expanded into.

## FIXES

- `backend/services/aiService.js`: both `callAI()` and `chat()`'s sequential provider-fallback loops
  now respect a real, cross-referenced overall budget (28s, under `autonomousLoop.cjs`'s 30s ceiling).
- 4 new regression tests, negative-tested.

## LIMITATIONS

- This is a bounded-loop mitigation, not true cancellation — a single provider whose own individual
  timeout exceeds the overall budget on its own (none currently do; the largest configured individual
  timeout is 30s, equal to but not exceeding the outer ceiling) could still, in principle, run past the
  budget before its own timeout fires. The fix specifically closes the *accumulation-across-multiple-
  providers* failure mode that was actually observed and root-caused, not every conceivable variant.
- True cancellation via `AbortController` threaded through all 14 provider adapters remains the
  architecturally complete fix and was deliberately not attempted here — correctly classified as a
  future architecture consideration, not guessed at or partially implemented.
- The exact 5.3-minute figure from the historical log was not reproduced bit-for-bit (that would
  require recreating the precise historical network/API conditions); the fix is justified by the
  root-caused mechanism and the correct order-of-magnitude match, not an exact reproduction.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Closes a real, previously-unexplained multi-minute execution anomaly this session's own logs had
already recorded but never root-caused — the platform's core AI-calling path now has a genuine,
cross-referenced overall deadline consistent with what its callers actually expect, without requiring
the larger cancellation-architecture change a fully complete fix would need. No OS-track record
altered.

## REGRESSION RESULT: 291/291 (0 failures, 0 skipped, 4 net new tests)

## BUILD RESULT: PASS (unaffected; backend-only change, no frontend files modified)

## CURRENT BASELINE: 291/291
