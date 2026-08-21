# SENTRY_DSN — BLOCKER INVESTIGATION

**Track:** OOPLIX V1 Master Audit — #1 remaining launch blocker (after GG-1 closure)
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Prior findings:** B.23 (B23-05, "SENTRY_DSN unset — production has no crash reporting"),
B.25 (blocker #1, "BLOCKS LAUNCH"), Master Final Gap Closure (C10-028, this session — wired the
code-level integration, left the credential itself correctly blocked).

---

## Dependency

**Why SENTRY_DSN is required:** to deliver real-time crash/error reports to a Sentry project via
Sentry's HTTP Envelope API (no SDK dependency — `sentryService.cjs` speaks the wire protocol
directly). Without it, the application has no external crash-visibility channel; errors are only
visible via local logs (`backend/utils/logger`, `data/logs/*.ndjson`) and the in-process
`errTracker`/`observabilityEngine` machinery, none of which alert a human outside an active session.

**Consumers** (3, all real, all confirmed via direct source read and live testing):
1. `backend/server.js` — the global Express error handler, `process.on("uncaughtException")`, and
   `process.on("unhandledRejection")` all call `sentryService.captureException()`. Wired in this
   session's own earlier C10-028 fix (Master Final Gap Closure), independently re-verified live this
   pass on the currently-running server.
2. `backend/services/integrationConnectors.cjs`'s `connectSentry()` — Phase L monitoring-connector
   inventory, reports real status (`READY`/`CONNECTED`/`PARTIAL`), never fakes `CONNECTED`.
3. `backend/services/pcsCredentials.cjs`'s `auditCrash()` — the credential-status audit surface,
   reports 5 real per-variable statuses (`sentry_dsn`, `sentry_env`, `sentry_release`,
   `sentry_auth_token`, `sentry_service`) plus a live-delivery-test result when configured.

**Configuration path:** `.env.example` documents all 5 variables (`SENTRY_DSN`, `SENTRY_AUTH_TOKEN`,
`SENTRY_ORG`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`) under a `# Monitoring` section. `.env` itself
has **zero** `SENTRY_DSN` line — genuinely absent, not merely empty. No startup validation blocks
boot on its absence (correct — Sentry is optional monitoring infrastructure, not a product
dependency); `/health`'s own service-degradation calculation deliberately excludes it (only
`ai`/`telegram`/`whatsapp`/`payments` count toward `"degraded"` status) — confirmed via source read,
consistent with treating monitoring infrastructure differently from product features.

**Current state:** code-level wiring is complete and correct (confirmed this pass, not merely cited
from the prior session). No route directly exposes `sentryService` to unauthenticated or
unauthorized callers — it's only reachable via the two `requireAuth`-gated connector/credential
audit surfaces and the server-internal error handlers.

## Verification

**Runtime:** Server boots cleanly with no Sentry-related warning or error in the boot log; `/health`
reports `"ok"` with no Sentry-related degradation. Confirmed via a real restart mid-investigation.

**HTTP:** Live-tested against the actual running server (not merely source-inspected):
- `POST /credentials/audit/crash` (authenticated) → `sentry_dsn: "missing"`, detail `"SENTRY_DSN not
  set"`; `sentry_service: "configured"` (correctly distinguishing "the integration code is loaded"
  from "the credential is present" — not conflated).
- Malformed-JSON request → still correctly `400`, confirming the global error handler's Sentry-capture
  addition doesn't interfere with the pre-existing early-return path.
- Direct call to `sentryService.captureException()` on the live process → honest
  `{"ok":false,"error":"SENTRY_DSN not set"}`.

**Configuration:** `.env.example` correctly documents the variable; `.env` correctly omits it; no
placeholder, fake, or example value exists anywhere in either file (verified without printing any
env line containing "SENTRY" from `.env` itself — the `.env.example` section is safe to quote since
it's a template with no real values).

**Failure honesty:** Every one of the 3 real consumers reports an honest, non-`CONNECTED`,
non-`"configured"` state when the DSN is absent:
- `sentryService.captureException/captureMessage/createRelease/verifyDelivery` → all return
  `{ok:false, error:"SENTRY_DSN not set"}` or equivalent.
- `connectSentry()` → reports `"READY"` (not `"CONNECTED"`) with `"SENTRY_DSN not set"`.
- `auditCrash()` → reports `"missing"` for `sentry_dsn`, with a real, correct remediation hint
  ("Create project at sentry.io → Settings → Client Keys → DSN").
- No code path anywhere fabricates a `CONNECTED`/`configured`/successful-delivery result without a
  real DSN and a real successful HTTP response from Sentry's own API.

**Regression:** 221/221 (`npm run test:runtime`) — was 218/218 at phase start, 3 new tests, 0 weakened.

**Build:** `CI=true npm run build` — clean, no frontend file touched.

---

## Genuine defect found (independent of the missing credential) and fixed

**`sentryService.cjs`'s own header comment claimed an `uploadSourcemap(version, files)` function
existed as a stub.** No such function was ever defined or exported — confirmed via `grep` and via
`typeof module.exports.uploadSourcemap === "undefined"`. This is a minor documentation-accuracy
defect (not a functional one — nothing calls the nonexistent function, so no runtime path was
affected), but it's exactly the kind of "claims a capability that doesn't exist" issue this whole
audit programme has repeatedly found and corrected in other subsystems. Fixed by removing the stale
doc line, replacing it with an explicit note of why it was removed.

This defect was **not** caused by the missing credential and would exist even with a real DSN
configured — it is a code/documentation correctness issue, appropriately fixed independently of the
credential question.

---

## AUDIT/BLOCKER: SENTRY_DSN — Crash Reporting Credential

**STATUS:** CREDENTIAL-BLOCKED / NOT RESOLVED (code-level integration itself: CORRECT)
**SCORE:** N/A (a missing external credential cannot be scored; the code wiring around it is CORRECT)
**CONFIDENCE:** 95% (high confidence in the finding — the blocker is genuinely and solely credential
absence, not a hidden code defect; the one real defect found was cosmetic/documentation-only)

## DEPENDENCY

- **Why SENTRY_DSN is required:** to deliver real-time crash/error events to an external Sentry
  project via HTTP; without it, there is no external, always-on crash-visibility channel.
- **Consumers:** `backend/server.js` (global error handler + 2 process-level handlers, wired this
  session, re-verified live), `integrationConnectors.cjs`'s `connectSentry()`, `pcsCredentials.cjs`'s
  `auditCrash()`.
- **Configuration path:** `.env.example` documents 5 variables; `.env` has none set; no startup
  validation gates boot on absence (correct, since this is optional monitoring infrastructure).
- **Current state:** code-level integration is complete, correct, and already live-wired
  (from this session's earlier C10-028 work) — independently re-verified this pass, not merely cited.

## VERIFICATION

- **Runtime:** Server boots and runs cleanly with no Sentry-related error; confirmed across a real restart.
- **HTTP:** Live-tested `POST /credentials/audit/crash` on the running server — honest `missing` status confirmed.
- **Configuration:** `.env.example` correct; `.env` genuinely has no DSN (not empty-but-present, genuinely absent).
- **Failure honesty:** PASS — every consumer honestly reports non-configured/non-connected state; zero fake success found anywhere in the 3 real consumers.
- **Regression:** 221/221 (218/218 baseline + 3 new tests, 0 weakened).
- **Build:** PASS.

## FINDINGS

- **P0:** 0
- **P1:** 0
- **V1-critical P2:** 0
- **Configuration/Credential blocker:** 1 — `SENTRY_DSN` is genuinely absent from `.env`, and per this
  mission's explicit instruction, was not fabricated, generated, or worked around. This is the sole
  remaining blocking condition; the code that depends on it is correct.
- **Other:** 1 minor documentation-accuracy defect found and fixed (stale `uploadSourcemap` doc
  claim) — independent of the credential question, does not affect the blocker's classification.

## FIXES

- `backend/services/sentryService.cjs`: removed the inaccurate `uploadSourcemap` doc-comment line
  (the function was never implemented or exported); replaced with an explanatory note.
- `tests/runtime/10-c10-cross-system-closure.test.cjs`: added 3 tests (describe block
  `117-master-audit-sentry-dsn-blocker`) locking in (a) the doc-accuracy fix, (b) `getConfig()`'s DSN
  truncation guarantee (never exposes a full value even with a real DSN present), (c) both
  `connectSentry()` and `auditCrash()`'s honest-status reporting. All 3 negative-tested; the first was
  explicitly reverted and confirmed to fail before being restored.

## LIMITATIONS

- **The credential itself remains genuinely unavailable.** `SENTRY_DSN` requires creating a real
  Sentry project (`sentry.io → Settings → Client Keys → DSN`) — an external action requiring account
  access this mission explicitly forbids performing or working around. No placeholder, fake, or
  synthetic DSN was created, generated, or suggested as a substitute.
- Live delivery (`verifyDelivery()`, `connectSentry()`'s real HTTP round-trip to Sentry's API) could
  not be exercised end-to-end, since doing so requires the real credential this pass must not
  fabricate. The code path that WOULD execute on a real DSN was read and reasoned about, not executed
  against a real Sentry endpoint.
- `SENTRY_AUTH_TOKEN`/`SENTRY_ORG` (required only for `createRelease()`, a separate, narrower
  capability from crash capture) are also absent — same credential-blocked disposition, lower
  priority than the DSN itself since release tracking is a smaller feature than crash visibility.

## FINAL CLASSIFICATION: **CREDENTIAL-BLOCKED / NOT RESOLVED**

Per the mission's explicit instruction: this blocker is established as genuinely credential-absence,
not a code defect, and is **not** falsely marked closed. No fake or synthetic credential was created.

## PROGRAMME IMPACT

The Audit Track's #1 launch blocker (`SENTRY_DSN`) remains open, honestly. Its code-level readiness
is now independently confirmed correct and complete (originally wired in this session's own
C10-028 work; this pass re-verified it live and found+fixed one small unrelated documentation
defect). When a real Sentry project is provisioned (the next programme phase — credential
provisioning — explicitly out of this pass's scope), the integration requires zero further code
changes to become live. No OS-track record altered.

## REGRESSION RESULT: 221/221 (0 failures, 0 skipped, 3 net new tests)

## BUILD RESULT: PASS (clean, no frontend file changed)
