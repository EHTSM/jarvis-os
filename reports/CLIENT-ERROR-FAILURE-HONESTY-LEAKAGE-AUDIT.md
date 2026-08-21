# CLIENT ERROR / FAILURE-HONESTY LEAKAGE AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-21 · **Branch:** `security/reality-completion`

---

## Scope

Repo-wide customer/client-facing error responses across `backend/routes/*.js` (151 files) and their
service-layer callers, for leakage of raw exception text, stack traces, filesystem paths, SQL internals,
provider/API error bodies, credential/config details, internal module names, and inconsistent error
contracts. `backend/server.js`'s global Express error handler and its established safe-response shape.

## Baseline Reconnaissance

**No per-route safe-error convention exists anywhere in the codebase.** The only sanitization is
`backend/server.js`'s global error handler (`{ success:false, error:"Internal server error" }`, with
`err.message` only attached outside `NODE_ENV=production`, plus server-side `logger.error` +
`structuredLog` + `sentryService.captureException`) — but this is a last-resort catch for genuinely
*unhandled* exceptions that skip route-level try/catch. It was adopted as the template for this
mission's fixes, not replaced.

**Scale of the underlying pattern**: 1,303 occurrences of `error: e.message` / `error: err.message` /
`error: error.message` across 85 of 151 route files (56%). This is far too large to fix wholesale in
one bounded mission without redesigning the error architecture repo-wide — explicitly out of scope per
this mission's own rules. This audit instead traced actual HTTP reachability and content sensitivity to
find the highest-value genuine leaks, live-reproduced each, and fixed those narrowly using the existing
safe-response shape as the template — rather than attempting a blanket rewrite.

**No stack-trace leakage found** — zero occurrences of `.stack` reaching any client response.
**No SQL/SQLite-internals leak found** — `backend/db/sqlite.cjs`'s raw queries aren't wrapped by any
route-level catch that returns `e.message` to a client.

## Genuine Defects Found and Fixed — 2

### 1. Provider (Meta WhatsApp Graph API) raw error passthrough, including a real internal identifier (P1)

`whatsappService.js`'s `sendMessage()` returned Meta's raw Graph API error body
(`err.response?.data?.error?.message`) directly to the caller on both the auth/config-error path and
the retries-exhausted path. Reachable via `POST /whatsapp/send` (`requireAuth`-only, ordinary customer)
and indirectly via `POST /payment/link`'s phone-notify step.

**Live-reproduced** (direct invocation of the real `sendMessage()` function against this environment's
actual configured WhatsApp credentials, with a fresh cooldown scope to reach the genuine catch block):
the response contained Meta's exact error text, **including the real configured `WA_PHONE_ID` value
verbatim** (`"...Object with ID '935026979311321' does not exist..."`) — not merely a generic provider
complaint, but a real internal identifier from `.env`.

**Fixed** by returning a fixed, safe client-facing message on both paths (`"WhatsApp send failed —
configuration error, please contact support"` / `"WhatsApp send failed after multiple attempts"`) while
keeping the full raw detail in the existing `logger.error()` call, matching the global handler's
generic-message-plus-server-side-logging shape — no new logging infrastructure.

### 2. Raw Node `fs` error (absolute server path) leak in the AI coding assistant (P1)

`codingAssistant.js`'s `_applyPatchSpecs()` (the shared helper behind both `POST /coding/apply-patch`
and `POST /coding/refactor`, `requireAuth`-only, ordinary customer) called `fs.mkdirSync`/
`fs.writeFileSync`/`fs.readFileSync` directly inside the route's try/catch, with no wrapping — any real
filesystem failure (permission-denied, read-only mount, disk full) reached the client as Node's raw
error text, which always embeds the absolute path it operated on.

**Live-reproduced**: an ordinary authenticated customer's `POST /coding/apply-patch` targeting a
directory the process cannot create returned
`"ENOENT: no such file or directory, mkdir '/root/blocked_by_permissions'"` verbatim — a real absolute
server filesystem path disclosed to the client.

**Fixed** by wrapping the three filesystem calls in a small `_safeFsOp()` helper that converts any raw
`fs` exception into a fixed-shape message using `spec.targetFile` (the already-safe, caller-relative
name the customer themselves supplied) instead of the absolute path the raw error would have named — a
single change at the one place these calls happen, not duplicated across every route's catch block. The
pre-existing, already-safe custom errors in the same function (`"File not found: X"`,
`"patchTarget not found in X"`, both already using the relative name) were left untouched.

## Other Items Checked — Confirmed Clean or Out of Bounded Scope

- **`paymentService.js`'s Razorpay error passthrough** — architecturally the same passthrough pattern
  (`err.error?.description || err.message` returned to the client), but live-tested against this
  environment's actual configured (placeholder) Razorpay credentials, the real response is the generic
  `"Authentication failed"` — no sensitive detail currently leaks through it. Flagged for awareness, not
  fixed this mission, since no live-reproducible leak exists with the credentials available in this
  environment (per rule 6, "live-reproduce every genuine vulnerability before fixing" — a mechanism that
  is *capable* of leaking is not the same as one that currently *does*).
- **`paymentService.js`'s "Payments not configured" message** — names the exact `RAZORPAY_KEY_ID`/
  `RAZORPAY_KEY_SECRET` env-var identifiers. Low-severity internal-config-naming detail (not a live
  value), consistent with an intentional, actionable operator-facing message rather than a security
  leak. Not fixed — changing it would reduce operator debuggability for a P2-at-most finding.
- **`runtime.js`'s dynamic module-loader diagnostic** (`/runtime/health/deep`-style route) — already
  correctly sanitizes: `catch (e) { return { module: m, ok: false, error: "load_error" }; }`, no raw
  message reaches the client.
- **The 1,303-occurrence repo-wide `e.message`-in-response pattern** — confirmed real and widespread,
  but the large majority of sampled instances return harmless, already-safe validation text (e.g.
  `"Invalid plan. Choose: starter, growth, scale"`, `"amount required"`) where `e` is a
  deliberately-thrown, already-sanitized `Error`, not a passthrough of raw system/provider internals.
  Distinguishing genuine leakage from intentional safe messages (rule 4) is the reason this mission
  fixed 2 concretely-proven sites rather than mechanically touching all 1,303. A full sweep would also
  mean redesigning error handling across 85 files — explicitly prohibited by rule 2.

## Decision Required — None New

Both fixes reuse the existing safe-response shape (`server.js`'s global handler) and the existing
`logger` utility; no new architecture or product decision is raised.

## Limitations

The repo-wide `e.message`-in-response pattern (1,303 sites, 85 files) remains largely unaddressed by
this mission, by design — this audit prioritized narrow, evidence-based, live-reproduced fixes for
genuinely sensitive leaks over a blanket rewrite. A dedicated, larger-scoped future mission (with
architecture buy-in, since 85 files sharing one convention arguably warrants a shared response helper
rather than 85 individual edits) would be needed to close the pattern comprehensively.

## Regression

**Before:** 441/441 effective. **After:** 445/445 — a fully clean run with zero failures. **New tests:**
4 (block 170: 2 structural + 2 live). **Negative-tested**: reverted each fix independently — the
WhatsApp fix (confirmed both the structural assertion and the live test failed for the exact expected
reason, the raw Meta error text including the real phone-ID value present in the response) and the
codingAssistant fix (confirmed the structural assertion failed for the exact expected reason; the live
test's pass on the reverted-on-disk-but-not-yet-restarted server was expected and non-misleading, since
the structural assertion alone already conclusively proved the revert); restored both, confirmed all 4
tests passed again, then re-ran the full canonical `npm run test:runtime` (10 files, 445 tests) clean.

**Build:** PASS (`npm run build:frontend`, clean production build).
**Security suite:** `tests/security/97-enterprise-isolation-integrity.cjs` — 8/8 PASS (after waiting out
this environment's shared registration rate-limit window, exhausted by this mission's own live
cross-tenant testing).
**Server:** restarted twice total (initial fix application, final restore after negative-testing —
`codingAssistant.js`/`whatsappService.js` are `require()`-cached), confirmed healthy after each restart.
**`.env`:** untouched. **No merge. No push.** Unrelated uncommitted work in the working tree preserved
throughout. One test artifact created during live verification (`some/relative/nested/probe.txt`,
created by a relative-path apply-patch probe that legitimately succeeded) was found, unstaged from git,
and deleted — not a regression, a byproduct of proving the fix's happy path still works.
