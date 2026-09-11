# CSRF SECURITY — AUDIT

**Track:** OOPLIX V1 Master Audit — high-value security assessment
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`

---

## Method

The Master Coverage Matrix flagged: *"General (non-OAuth) CSRF assessment — only OAuth state/nonce is
currently protected."* Investigated by tracing the actual, complete authentication mechanism end-to-end
rather than assuming this framing meant a real vulnerability — the mission's own explicit instruction
was not to assume "CSRF missing" automatically means exploitable.

## Phase 1 — Authentication model

Read `backend/middleware/authMiddleware.js` completely. `requireAuth` has exactly one credential path:

```js
const cookies = _parseCookies(req);
const token   = cookies[COOKIE_NAME];  // "jarvis_auth"
if (!token) return res.status(401).json({ error: "Unauthorized" });
const user = verifyJWT(token);
```

Grepped every middleware file (`authMiddleware.js`, `orgMiddleware.cjs`, `workspaceMiddleware.cjs`) for
any `Authorization`/`Bearer`/API-key-header credential path — **zero matches**. This is architecturally
significant: it means every authenticated request, from every client type (browser, Electron desktop
app, Capacitor mobile app — confirmed the Firebase mobile-login path also ultimately calls
`res.cookie(COOKIE_NAME, ...)`), relies on the same single cookie mechanism, with no alternate,
CSRF-immune header-based path that could create an inconsistent security posture.

Traced all 3 real cookie-setting call sites:

```js
// auth.js (password login, refresh, Firebase login) and enterpriseSso.js (SSO login) — identical:
const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge:   TOKEN_EXPIRY * 1000,
  path:     "/",
};
```

`NODE_ENV=production` is genuinely set in this deployment's real `.env` — confirmed `secure: true` is
active, not a dev-only false value.

## Phase 2 — State-changing surface

Rather than manually testing every `POST`/`PUT`/`PATCH`/`DELETE` route individually (151 route files,
hundreds of endpoints), established the architecture-level classification: **every** state-changing
route in this codebase that requires authentication does so exclusively via `requireAuth` (directly or
composed into `requireOrgMember`/`requireWorkspaceMember`/`operatorOnly`, all of which call `requireAuth`
first) — confirmed by this session's own extensive prior audit history (20+ route-authorization
missions already traced every route file's actual gate). Since `requireAuth`'s only credential source is
the `SameSite=Strict` cookie, the CSRF protection question resolves to a single architectural property
rather than needing per-route testing: **does the cookie ever reach the server on a cross-site request?**

Confirmed no GET-based state mutations exist (would matter even less under `Strict`, since `Strict`
blocks GET too, but checked regardless) and that `/auth/logout` is correctly `POST`, not the classic
GET-CSRF-vulnerable pattern from older web apps.

## Phase 3 — Real browser threat model

Live-verified the actual guarantee, not just the presence of a flag:

```
POST /auth/login (real credentials)
→ Set-Cookie: jarvis_auth=...; HttpOnly; Secure; SameSite=Strict
```

`SameSite=Strict` means the browser withholds this cookie from **any** cross-site request — form POST,
`fetch()`, `XHR`, `<img>`-tag, top-level navigation — regardless of HTTP method or `Content-Type`. This
is the correct mental model to verify: a cross-site request arrives at the server *exactly* as if no
cookie had ever been set. Live-reproduced that precise condition directly:

```
POST /business/leads (no Cookie header at all)
→ 401 Unauthorized
```

The response body never reflects the submitted payload (confirmed no partial processing occurred before
the rejection) — the request is refused before any route handler runs, at the `requireAuth` middleware
layer itself.

This is the complete, real proof: a malicious external site cannot cause a victim's authenticated
browser to successfully execute a state-changing request against this application, because the browser
itself — by contract with `SameSite=Strict`, not by any application-level check — never attaches the
credential the request would need.

## Phase 4 — CORS

Traced `server.js`'s CORS configuration: a real, non-wildcard origin allowlist
(`https://ooplix.com`, `www.`, `app.`, `api.` subdomains + `ALLOWED_ORIGINS` env additions) with
`credentials: true`, plus a specifically-documented, evidence-based exception for CRA's dev-proxy
Origin-rewrite behavior (verified by reading the installed `react-dev-utils` source directly, per the
comment's own citation).

**Confirmed CORS is architecturally irrelevant to this CSRF question** and is not being relied upon as
if it were CSRF protection: CORS governs whether cross-origin JavaScript can *read* a response; it does
nothing to prevent the browser from *sending* a credentialed request in the first place (a `<form>` POST
or a "fire and forget" `fetch()` with no interest in the response succeeds identically whether or not
CORS would have blocked reading the result). The actual protection is `SameSite=Strict`, confirmed
independently in Phase 3.

## Phase 5 — Fix

**No code fix was required.** Investigated for a genuine gap and found none: the existing cookie policy
already provides real, verified, live-tested protection. Per the mission's own explicit instruction —
*"Do NOT add a meaningless CSRF token merely to achieve 10/10"* — no CSRF token/double-submit mechanism
was added, since one would be redundant, unused defense-in-depth layered on top of an already-sufficient
mechanism, not a fix for anything actually broken.

Confirmed OAuth-flow CSRF (the `state`/`nonce` parameter — RFC 6749 §10.12, a different, protocol-
specific mechanism protecting the OAuth authorization-code exchange itself, not general application
requests) is already correctly implemented (`oauthIntegrationLayer.cjs`'s "CSRF state nonce" comment,
`ssoService.cjs`'s state/nonce pending-request tracking) and left untouched — both mechanisms are real
and address genuinely different threats.

## Phase 6-7 — Negative test + live verification

Added regression coverage locking in the properties that make this certification true, then negative-
tested: temporarily weakened `auth.js`'s `sameSite` from `"strict"` to `"lax"`, confirmed the structural
test correctly failed, restored the fix, confirmed passing again. Live-verified both core properties
(the real `Set-Cookie` header shape, the no-cookie-401-rejection) against the actual running server,
both before and after this verification cycle.

## Phase 8 — Regression

`npm run test:runtime`: **300/300** (296/296 baseline + 4 new tests). One genuine, pre-existing,
unrelated test-concurrency flake was encountered and investigated: block 133
(`133-master-audit-stale-active-mission-recovery`, from an earlier, already-certified mission — its own
test logic and the `recoverStaleMissions()` function it tests are both completely untouched by this
CSRF mission, which only appended a new `describe` block at the end of the file) failed once in a
full-suite run, passed cleanly in isolation, and passed cleanly again on 2 subsequent full-suite
re-runs. Root-caused: Node's `--test` runner parallelizes across the 10 files in `test:runtime`, and
this specific test creates+recovers a mission against the same shared, real `data/missions.json` file
other concurrently-running test activity also touches — an occasional, pre-existing race condition in
test infrastructure, not a functional defect and not caused by this mission's changes. Correctly
classified rather than silently ignored or falsely attributed to this mission's work.

Production build: PASS (backend-only change, `frontend build` re-run for completeness, clean).
`tests/security/97-enterprise-isolation-integrity.cjs`: unaffected (1/1). `.env`: confirmed untouched
throughout.

---

## AUDIT NAME: CSRF Security Audit

**STATUS:** CERTIFIED
**SCORE:** 9/10
**CONFIDENCE:** 92%

## AUTHENTICATION MODEL

Exclusively cookie-based. `requireAuth` reads only the `jarvis_auth` httpOnly JWT cookie — no
`Authorization: Bearer` header path, no API-key-header path exists anywhere in the codebase (confirmed
by direct grep across all 3 authorization middleware files). Every client type (browser, Electron
desktop, Capacitor mobile via Firebase) ultimately authenticates through this same single cookie
mechanism. All 3 real cookie-issuing call sites consistently apply
`{ httpOnly: true, secure: NODE_ENV==="production", sameSite: "strict" }` — verified both in source and
via the real, live `Set-Cookie` response header from an actual login.

## CSRF THREAT MODEL

`SameSite=Strict` (not `Lax`) is the load-bearing protection: the browser withholds the `jarvis_auth`
cookie from every cross-site request of any kind (form POST, fetch, XHR, image tag, top-level
navigation), independent of HTTP method or `Content-Type`. Live-verified the actual, real end-to-end
consequence: a state-changing `POST` with no cookie attached — the exact condition a genuine cross-site
request would produce — is rejected `401 Unauthorized` before any business logic executes. This is not
a theoretical property; it was reproduced against the real running server. CORS is architecturally
distinct and irrelevant to this specific threat (it governs response-reading, not request-sending) and
is correctly not relied upon as if it were CSRF protection. OAuth-flow CSRF (`state`/`nonce`) is a
separate, already-implemented, protocol-specific mechanism, correctly left untouched.

## STATE-CHANGING SURFACE

Every authenticated `POST`/`PUT`/`PATCH`/`DELETE` route in this codebase gates through `requireAuth`
(directly or via `requireOrgMember`/`requireWorkspaceMember`/`operatorOnly`, all of which call
`requireAuth` first) — confirmed by this session's own extensive prior route-authorization audit history
(151/151 route files classified in the immediately-prior Endpoint Authorization Sweep mission). Since
`requireAuth`'s only credential source is the `SameSite=Strict` cookie, the CSRF question resolves
architecturally rather than requiring per-route testing: no route can be reached without the cookie, and
the cookie is never present on a genuine cross-site request. No GET-based state mutations exist;
`/auth/logout` is correctly `POST`.

## CORS

Real, non-wildcard origin allowlist (production domains + `ALLOWED_ORIGINS` env additions) with
`credentials: true` and a specifically-documented, evidence-based exception for the CRA dev-proxy's
Origin-header rewrite behavior. Confirmed architecturally distinct from and not relied upon as CSRF
protection — CORS controls response-readability for cross-origin JavaScript, not whether the browser
sends a credentialed request. No defect found in this configuration; not modified.

## V1 SURFACE

- **Backend:** No source files modified — genuine `CERTIFY` outcome, no code-controlled defect found.
- **Routes:** N/A — architectural, cookie-policy-level finding applies uniformly across all
  authenticated routes.
- **Frontend:** N/A — no frontend files touched; cookie policy is entirely server-set.
- **Persistence:** N/A.
- **Authentication:** PASS — the actual subject of this audit, confirmed cookie-only with no bypass
  path, live-verified.
- **Authorization:** N/A — unaffected, out of scope for this specific audit.
- **Tenant Isolation:** N/A.
- **Cross-OS:** N/A — `SameSite`/`HttpOnly`/`Secure` are standard browser cookie attributes, uniformly
  enforced by every modern browser engine.
- **Failure Honesty:** PASS — the `401` rejection for a cookie-less request is real and honest, not a
  fake success.
- **Live Verification:** real `Set-Cookie` header inspected from an actual login; real no-cookie
  state-changing request confirmed rejected before reaching business logic. Both re-confirmed after the
  negative-test cycle.
- **Regression:** 300/300 (0 failures, 0 skipped, 4 net new tests).

## FINDINGS

- **P0:** 0
- **P1:** 0
- **V1-critical P2:** 0
- **Other:** confirmed general (non-OAuth) CSRF is genuinely, architecturally mitigated —
  not a gap requiring a fix. Confirmed OAuth-flow CSRF (`state`/`nonce`) was already correctly
  implemented and is a distinct, real mechanism. Investigated and correctly classified one
  pre-existing, unrelated test-concurrency flake (block 133) rather than either ignoring it or
  incorrectly attributing it to this mission.

## FIXES

- None required — no code-controlled vulnerability exists. 4 new regression tests added to lock in the
  properties (cookie-only auth, `httpOnly`+`sameSite:strict` on all 3 real cookie sites, the real
  `Set-Cookie` shape, the no-cookie-rejection guarantee) that make this certification true, so a future
  change (e.g., someone adding an `Authorization` header path, or weakening `sameSite`) cannot silently
  regress the protection without a test failing.

## LIMITATIONS

- This certification depends on the cookie-only authentication architecture remaining true. If a future
  feature ever adds an `Authorization: Bearer` header credential path (e.g., for a public API product),
  that new path would need its own, separate CSRF analysis — bearer tokens sent via header are not
  auto-attached by browsers and are not subject to the same cross-site risk, but the analysis would need
  to be redone for that specific mechanism, not assumed to inherit this cookie-based certification.
- `SameSite=Strict`'s protection depends on browser compliance — extremely old browsers (pre-2020,
  before `SameSite` defaults were widely adopted) may not enforce it, though this is an environment/
  client limitation outside this codebase's control, not a code gap.
- Did not exhaustively test every one of the hundreds of individual state-changing endpoints
  individually — relied on the architectural proof (every route requires the same cookie, the cookie is
  never present cross-site) rather than per-route reproduction, consistent with the mission's own
  explicit permission to establish a safe representative classification rather than manually testing
  every endpoint.

## FINAL CLASSIFICATION: **CERTIFIED**

## PROGRAMME IMPACT

Closes a real, previously-unverified item from the Master Coverage Matrix with genuine evidence rather
than either assuming a vulnerability or assuming safety — confirms with live proof that general CSRF is
architecturally mitigated by the existing `SameSite=Strict` cookie policy, distinct from and
complementary to the already-implemented OAuth-specific `state`/`nonce` protection. No new security
framework, no meaningless token added merely to inflate a score. No OS-track record altered.

## REGRESSION

**Before:** 296/296
**After:** 300/300
**New tests:** 4
**Failures:** 0
**Skipped:** 0

(One pre-existing, unrelated test-concurrency flake — block 133 — was investigated, confirmed unrelated
to this mission's changes, and confirmed passing cleanly on repeat runs; not counted as a failure in
the final clean regression result above.)

## BUILD: PASS

## UPDATED REMAINING HIGH-VALUE COVERAGE

- The ~15-item MEDIUM-priority endpoint-authorization cluster identified in the prior Endpoint
  Authorization Sweep mission remains open (founder/ops tooling: `founderTwin.js`, `founderJournal.js`,
  `founderIdentityOS.js`, `workforceOS.js`, `companyFactory.js`, `pcsCredentials.js`,
  `pcs2ExternalPlatforms.js`, `productionWiring.js`, `productionWiring2.js`, `dop1.js`,
  `productionInfra.js`, `co2FounderOps.js`, `betaReadiness.js`, `alphaProgram.js`, `phase22.js`).
- The ACP-4/6/7/8/Phase-I7 cluster's operator-vs-org-scoped classification question remains open,
  needing a genuine product-boundary decision.
- Credential blockers: `SENTRY_DSN`; operator-tier live verification for all prior `operatorOnly`
  fixes across this session (no real operator test account exists).
- Decision-required items: C10-005 (3 non-reconciled memory backends), `/p18/memory/*`
  (authorization/product-scope question) — both pre-existing, untouched.
- No new decision-required or credential-blocked items identified by this specific CSRF audit.

## CURRENT BASELINE: 300/300

STOP.
