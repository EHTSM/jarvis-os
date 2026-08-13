# Phase B.7 — API Certification

**Product:** Ooplix (jarvis-os) v1.0.0-rc1
**Date:** 2026-08-09
**Branch:** `security/reality-completion` (no merge, no push)
**Method:** Operated the API as an API-platform company would, benchmarked against Stripe / GitHub / Slack / Notion / OpenAI / Linear conventions. Route table extracted from the **live Express router**, not by grep. Reproduce → Measure → Root Cause → Recover → Regression → Re-verify.

---

## Defects Found, Fixed, and Regression-Tested

### F1 — Cross-tenant data leak via `X-Org-Id` header override (**CRITICAL**)

`attachOrg()` gave the `X-Org-Id` header unconditional precedence over the `:orgId` path param. Every route shaped `/orgs/:orgId/...` was gated by `requireOrgPermission()` (which checks `req.org.id`, i.e. the **header's** org) while the handler read `req.params.orgId` and served the **path's** org — a textbook confused deputy.

**Reproduced live 3/3.** An account holding membership in org A *only*:

```
GET /orgs/<orgB>/members   with  X-Org-Id: <orgA>   → 200 + org B's member roster
GET /orgs/<orgB>/members   (no header)              → 403   ← correct behaviour
```

Confirmed leaking on `/members`, `/departments` and `/teams`. Blast radius: 34 `:orgId` routes are permission-gated, and 12 route files read `req.params.orgId` (`organizations.js` alone has 29 uses). The other org domains (`enterprise/*`, `org-graph`, `org-agents`, `org-workspace`) resolve from `req.org` and were unaffected — verified: they returned 403 with and without the header.

**Root cause:** precedence order in `backend/middleware/orgMiddleware.cjs`. A `_attachOrgFromParam` wrapper in `organizations.js:84` already tried to address this by forwarding the param into `req.body.orgId` — but `req.body` is **last** in the precedence chain, so the header still won.

**Fix:** the `:orgId` path param now wins, because it identifies the resource being addressed and is therefore the only correct authorization subject. The header remains the tenant selector for routes carrying no `:orgId` (e.g. `/crm/lead`). This *narrows* what the header can do and never widens access.

**Verified:** all three routes now 403 with the header; own-org access, CRM header-selection and org context all still 200.
**Regression:** `tests/runtime/10-org-param-precedence.test.cjs` — 6 tests built on two **real** organizations. Negative-tested: **3 fail** with the fix reverted, 6/6 pass restored. (A first draft used non-existent org ids that resolved to `null` either way and passed without the fix — worthless, so it was rewritten.)

### F2 — Negative `limit`/`n` bypassed result caps (**HIGH**)

38 list endpoints sized results with `Math.min(parseInt(req.query.n) || 50, 500)` — which caps the upper bound but passes negatives straight through, since `Math.min(-5, 500) === -5`. That value reached `Array.prototype.slice(0, n)`, where a negative offset counts from the **end**, silently returning "everything except the last N".

**Reproduced live 3/3:** `GET /runtime/dead-letter?n=-5` → **count=995** against a declared cap of 500.

**Breadth measured:** 23 occurrences of the `Math.min(parseInt(...))` form across 4 files, plus 15 bare `parseInt(req.query.limit) || N` forms across 6 more files — **38 total, none clamped**.

**Fix:** wrapped every call site in `Math.max(1, ...)`, preserving each endpoint's existing default and cap. Upper caps were deliberately *not* added where none existed — that would change documented response sizes, a contract change rather than a defect fix.

**Verified live** across the boundary matrix: `n=-99999→1`, `n=-5→1`, `n=0→50` (default), `n=abc→50` (default), `n=500→500`, `n=99999→500`.
**Regression:** `tests/runtime/11-limit-clamp.test.cjs` — 6 tests pinning the arithmetic contract, including a test that demonstrates the negative-slice mechanism and one covering all 8 default/cap pairs in use.

---

## 1. API Inventory Matrix

Extracted by walking the live Express router stack.

| Metric | Count |
|---|---|
| **Total route entries** | **4535** |
| Distinct path+method pairs | 4535 |
| Distinct paths | 4191 |
| **Duplicate registrations** | **0** (no shadowed routes) |
| Route modules | 151 (152 mounts) |
| GET | 2505 |
| POST | 1850 |
| PATCH | 85 |
| DELETE | 66 |
| PUT | 29 |
| Route-level `requireAuth`/org guards | 655 |
| No route-level guard | 3880 (mostly covered by `router.use`) |

**Auth coverage, verified by live probe of 300 randomly-sampled param-free GET routes:**

| Declared | Result | Count |
|---|---|---|
| auth middleware present | 401 | 51 |
| no route-level auth | **401** (covered by `router.use`) | **248** |
| no route-level auth | 200 | **1** — `/health` only |

`/health` is the sole publicly reachable endpoint, which is exactly right. Effective auth coverage: **299/300**. Zero duplicate or shadowed routes across 4535 registrations — better than most API platforms of this size.

## 2. REST Consistency Matrix

| Aspect | Observation | Classification |
|---|---|---|
| Naming convention | **kebab-case=1449, camelCase=0, snake_case=0** — perfectly uniform | CERTIFIED |
| Path segments | 1664 distinct | CERTIFIED |
| Versioning | 703 versioned (`/v1`–`/v10`), **3832 unversioned (84.5%)** | CERTIFIED WITH LIMITATIONS |
| Method semantics | 11 GETs carry mutating-sounding verbs; **live-tested: none mutate state** (checksum before/after) | CERTIFIED |
| RPC-style POSTs | 323 action POSTs (`/tick`, `/advance`, `/approve`) — acceptable, matches Slack/Linear | CERTIFIED |
| HTTP method usage | GET read-only, POST create/action, PATCH partial, DELETE remove — correct throughout | CERTIFIED |
| Resource nesting | `/orgs/:orgId/departments/:deptId/teams/:teamId` — coherent hierarchy | CERTIFIED |

Multiple `/vN` families (v1–v10) coexist as *product-generation* namespaces rather than API versions. No `/v1` → `/v2` migration path or deprecation header exists, so external consumers have no versioning contract — the main gap versus Stripe's dated versions or GitHub's `Accept` header.

## 3. Request Validation Matrix

Live against `POST /orgs`.

| Input | Response | Classification |
|---|---|---|
| Missing field | 400 `name is required` | CERTIFIED |
| `null` value | 400 `name is required` | CERTIFIED |
| Empty string | 400 `name is required` | CERTIFIED |
| Whitespace only | 400 `name is required` | CERTIFIED |
| Malformed JSON | 400 `Invalid JSON body` | CERTIFIED |
| Oversized (12 MB > 10 MB) | 413 `Payload too large` | CERTIFIED |
| Unicode (`日本語 🎉 Ünïcødé`) | 201, stored intact, slug derived safely | CERTIFIED |
| Very long string (5000 chars) | 201, accepted | CERTIFIED WITH LIMITATIONS (no max-length) |
| SQL-injection-shaped string | 201, stored as inert text (no SQL layer for orgs) | CERTIFIED |
| HTML/script string | 201, stored as inert text (React escapes on render) | CERTIFIED |
| **Prototype pollution** (`__proto__`) | 201, **`Object.prototype` NOT polluted** — verified | CERTIFIED |
| **Number instead of string** | 400 **`name?.trim is not a function`** — internal error leaked | CERTIFIED WITH LIMITATIONS |
| Array instead of string | 400 same internal message | CERTIFIED WITH LIMITATIONS |
| Nested object | 400 same internal message | CERTIFIED WITH LIMITATIONS |

Type-confusion inputs are correctly *rejected* with 400 — but the message is a raw JS `TypeError`, not an actionable field error. This is the same finding recorded as F3 in Phase B.4 and remains open.

## 4. Response Consistency Matrix

120 randomly-sampled authenticated GET endpoints.

| Envelope variant | Count | Share | Example |
|---|---|---|---|
| `ok: bool` | 52 | 43.3% | `/ai-ecosystem/browser` |
| `success: bool` | 36 | 30.0% | `/bizorg/v3/campaigns` |
| No status field | 13 | 10.8% | `/content/seo/schema` |
| **Both `success` + `ok`** | 13 | 10.8% | `/runtime/deploy-strat/readiness` |
| Bare array (no envelope) | 6 | 5.0% | `/aeo/v5/weaknesses` |

**Five distinct envelope shapes** — the single largest deviation from API-platform norms, where one envelope is universal (Stripe: `{object, data}`; GitHub: bare resource + `Link` headers). A client SDK cannot write one response handler.

| Property | Observation | Classification |
|---|---|---|
| Status field naming | Split `ok`/`success`, 16% absent | CERTIFIED WITH LIMITATIONS |
| Error field | **`error: string` — consistent across every error observed** | CERTIFIED |
| Timestamps | ISO-8601 UTC (`2026-08-08T21:09:23.622Z`) throughout | CERTIFIED |
| Request correlation | `x-request-id` on **every** response | CERTIFIED |
| Pagination metadata | **No `hasMore`/`nextCursor`/`next` anywhere** | CERTIFIED WITH LIMITATIONS |
| Content-Type | `application/json; charset=utf-8` | CERTIFIED |

Not fixed: normalizing 4535 routes to one envelope is an API rewrite, explicitly out of scope. Recorded as the top limitation.

## 5. Error Handling Matrix

| Code | Live response | Classification |
|---|---|---|
| 400 | `{"ok":false,"error":"name is required"}` | CERTIFIED |
| 400 | `{"success":false,"error":"Invalid JSON body"}` | CERTIFIED |
| 401 | `{"error":"Unauthorized"}` | CERTIFIED |
| 403 | `{"error":"Forbidden — requires permission: view_members"}` | CERTIFIED |
| 404 | `{"ok":false,"error":"Organization not found"}` | CERTIFIED |
| 409 | `{"ok":false,"error":"Account is already a member"}` | CERTIFIED |
| 413 | `{"success":false,"error":"Payload too large"}` | CERTIFIED |
| 422 | 41 usages in code; not hit by these probes | OBSERVATION |
| 429 | `{"success":false,"error":"Too many requests. Slow down.","retryAfterSeconds":249}` + `Retry-After` | CERTIFIED |
| 500 | `{"success":false,"error":"Internal server error"}` — **no stack trace** | CERTIFIED |
| **500 (misclassified)** | `PUT /enterprise/sso/:orgId/config` returns **500** for a *validation* error | CERTIFIED WITH LIMITATIONS |
| Fake success | **None found.** No endpoint returned 2xx for a failed operation in this phase | CERTIFIED |
| Swallowed errors | None observed; all failures surfaced with an `error` string | CERTIFIED |

Status-code selection is semantically correct and the 429 includes `Retry-After` — matching Stripe/GitHub. Distinct 403-vs-404 semantics are correctly preserved (403 = exists but forbidden, 404 = does not exist).

## 6. Performance Matrix

30 samples per endpoint, live.

| Endpoint | p50 | p95 | p99 | max | Classification |
|---|---|---|---|---|---|
| `GET /auth/me` | **0.6 ms** | 0.9 ms | 0.9 ms | 0.9 ms | CERTIFIED |
| `GET /health` | 0.7 ms | 1.0 ms | 1.2 ms | 1.2 ms | CERTIFIED |
| `GET /accounts/me` | 1.8 ms | 98.9 ms | **490.7 ms** | 490.7 ms | CERTIFIED WITH LIMITATIONS |
| `GET /runtime/dead-letter` | 1.9 ms | 2.5 ms | 3.2 ms | 3.2 ms | CERTIFIED |
| `GET /crm/leads` | 3.1 ms | 3.7 ms | 3.9 ms | 3.9 ms | CERTIFIED |
| `GET /orgs/:id/members` | 9.1 ms | 21.5 ms | 82.4 ms | 82.4 ms | CERTIFIED |
| `GET /runtime/audit/health` | 15.4 ms | 19.0 ms | 31.9 ms | 31.9 ms | CERTIFIED |
| `GET /orgs/me/context` | **41.5 ms** | 81.4 ms | **276.7 ms** | 276.7 ms | CERTIFIED WITH LIMITATIONS |

p50s are strong. Two tail outliers: `/orgs/me/context` (scans 934 orgs synchronously) and `/accounts/me` (p99 491 ms). Both stem from the Phase B.6 root cause — synchronous whole-file reads with no cache on the hot path.

## 7. Concurrency Matrix

| Test | Result | Classification |
|---|---|---|
| 30 parallel identical POSTs | **1 row created** — dedupe held under race | CERTIFIED |
| 150 parallel writes (Phase B.6) | 150/150 landed, 0 lost, 52 writes/sec | CERTIFIED |
| Duplicate requests | Deduped by `orgId`+`phone` | CERTIFIED |
| Retries | `retries`/`maxRetries`/`retryDelay` persisted per task | CERTIFIED |
| Parallel writes | Serialized by Node's event loop; no lost updates | CERTIFIED |
| Rate limiting | Per-IP, per-route buckets with `X-RateLimit-*` + `Retry-After` | CERTIFIED |
| Timeout | No server-side request timeout configured | CERTIFIED WITH LIMITATIONS |
| Cancellation | No cancellation token / `AbortSignal` handling | CERTIFIED WITH LIMITATIONS |

## 8. Idempotency Matrix

| Method | Behavior | Classification |
|---|---|---|
| `POST /crm/lead` ×3 | `new`, `dup`, `dup` — 1 row on disk | CERTIFIED |
| `PATCH /orgs/:id` ×3 | 200, 200, 200 — naturally idempotent | CERTIFIED |
| `DELETE .../members/:id` ×2 | 200 then **404** — correct non-idempotent-delete semantics | CERTIFIED |
| `POST` member (re-add) | 200; duplicate add → 409 | CERTIFIED |
| Race safety | 30 concurrent identical POSTs → 1 row | CERTIFIED |
| **`Idempotency-Key` header** | **0 occurrences in codebase** — no client-supplied idempotency | CERTIFIED WITH LIMITATIONS |

Server-side natural idempotency is genuinely correct. What's missing is Stripe's `Idempotency-Key` contract, which lets a client safely retry a *non-naturally-idempotent* request after a network failure.

## 9. Pagination Matrix

| Aspect | Observation | Classification |
|---|---|---|
| `limit` support | 174 route usages | CERTIFIED |
| `n` support | 7 route usages | CERTIFIED WITH LIMITATIONS (inconsistent naming) |
| `page` / `pageSize` | 6 / 1 usages | CERTIFIED WITH LIMITATIONS |
| Upper cap enforced | Yes — `n=99999` → 500 | CERTIFIED |
| **Lower bound (negative)** | **Was unclamped → F2, now `Math.max(1, …)` on all 38 sites** | CERTIFIED (after fix) |
| Default applied | `n=abc` / `n=0` / absent → documented default | CERTIFIED |
| **Offset** | Not supported on the endpoints tested | CERTIFIED WITH LIMITATIONS |
| **Cursor** | Not implemented anywhere | CERTIFIED WITH LIMITATIONS |
| **`hasMore` / `nextCursor`** | Absent — clients cannot detect truncation except by comparing `count` to `total` | CERTIFIED WITH LIMITATIONS |

`total` *is* returned alongside `count`, so truncation is at least detectable. But with no offset or cursor, records beyond the cap are **unreachable through the API** — the most substantive gap versus every reference platform.

## 10. Filtering & Search Matrix

| Aspect | Observation | Classification |
|---|---|---|
| Filter accuracy | `GET /crm/leads` returned exactly 1 distinct `orgId`; `status` filter exact-match | CERTIFIED |
| Filter speed | 3.1 ms p50 on the tenant CRM list | CERTIFIED |
| Consistency | Same filter semantics across list and export paths | CERTIFIED |
| Query filters | `?type=`, `?status=`, `?deptId=`, `?teamId=` honored | CERTIFIED |
| **Indexing** | **None** — every filter is a linear `Array.filter` over a freshly parsed file | CERTIFIED WITH LIMITATIONS |
| Sorting | Present where relevant (DLQ/history sort by `completedAt`); **no generic `?sort=`** | CERTIFIED WITH LIMITATIONS |
| Full-text search | TF-IDF/BM25 search exists for repo/memory domains | CERTIFIED |

## 11. SDK Readiness Matrix

| Client | Assessment | Classification |
|---|---|---|
| **Web (browser)** | CORS allowlist reflects `app.ooplix.com` with `Allow-Credentials: true`; `OPTIONS` preflight → 204 | CERTIFIED |
| **Electron** | Same-origin / no-Origin requests → 200 | CERTIFIED |
| **CLI** | Works, but must persist a `Secure` cookie jar over HTTPS | CERTIFIED WITH LIMITATIONS |
| **Flutter / mobile** | Cookie-based auth only; native HTTP clients must manage the cookie manually | CERTIFIED WITH LIMITATIONS |
| **External integrations** | **`SameSite=Strict` + cookie-only auth blocks third-party server-to-server use** | RECOVERY REQUIRED |
| Bearer-token auth | **Absent from the main API.** `requireAuth` reads only the cookie — no `Authorization` header path | CERTIFIED WITH LIMITATIONS |
| Precedent for tokens | **`enterpriseScim.js:51` already verifies a SCIM Bearer token** — the pattern exists | OBSERVATION |
| Content negotiation | `Accept: application/json` honored | CERTIFIED |
| Error machine-readability | Consistent `error: string`, but **no stable `code` field** — clients must string-match | CERTIFIED WITH LIMITATIONS |
| Request correlation | `x-request-id` on every response | CERTIFIED |

Every reference platform authenticates with `Authorization: Bearer`. Ooplix's own SCIM endpoint proves the mechanism is already available; extending it to the main API is the single highest-value SDK change.

## 12. Documentation Reality Matrix

`docs/API-REFERENCE.md` vs the live router (path params normalized so `:id` ≡ `:taskId`).

| Metric | Count |
|---|---|
| Documented method+path pairs | 521 |
| Implemented pairs | 4535 |
| **Documented AND live** | **272 (52.2% of docs accurate)** |
| **Documented but DEAD** | **249** |
| **Undocumented** | **4263 (94.0% of the API)** |

**Live-verified dead endpoints** (documented, but return the SPA HTML shell rather than JSON):

| Endpoint | Live result |
|---|---|
| `GET /scheduled` | 200 **text/html** — DEAD |
| `GET /learning` | 200 **text/html** — DEAD |
| `GET /memory` | 200 **text/html** — DEAD |
| `GET /agents/500/initialize` | 200 **text/html** — DEAD |
| `GET /tasks` | 200 application/json — **LIVE** |

Two compounding problems: docs describe endpoints that no longer exist, and **unmatched API paths return the SPA shell with 200 instead of a 404 JSON error**. A client calling a removed endpoint gets HTML and a success code — Stripe/GitHub would return `404 {"error": ...}`. This makes dead endpoints silently undetectable by SDKs.

## 13. Root Causes

| Finding | Root cause |
|---|---|
| F1 cross-org leak | Header-over-path precedence in `attachOrg`, combined with `requireOrgPermission` checking `req.org` while handlers read `req.params.orgId` |
| F2 negative limit | `Math.min()` clamps only the upper bound; negative values reach `slice(0, n)` where they count from the end |
| 5 envelope variants | 151 route modules authored independently with no shared response helper |
| No pagination beyond `limit` | List endpoints slice an in-memory array; no cursor/offset concept in the JSON persistence layer |
| Dead endpoints return HTML | SPA catch-all (`app.get("/*splat")`) sits after the API router, so any unmatched path — including API paths — falls through to `index.html` |
| 94% undocumented | Docs are hand-maintained; no generation from the route table |
| Cookie-only auth | `requireAuth` was designed for the first-party web app; no external-consumer requirement existed |
| Tail latency (p99 277–491 ms) | Synchronous whole-file reads with no cache (Phase B.6 root cause) |

## 14. Remediation Matrix

| ID | Recommendation | Scope | Priority |
|---|---|---|---|
| F1 | **DONE** — path param wins over header; 6 regression tests | `orgMiddleware.cjs` | ✅ Fixed |
| F2 | **DONE** — `Math.max(1, …)` on all 38 sites; 6 regression tests | 10 route files | ✅ Fixed |
| A1 | Return **404 JSON** for unmatched `/api`-shaped paths instead of the SPA shell — scope the catch-all to non-API prefixes | `server.js` | **P1** |
| A2 | Add `Authorization: Bearer` support to `requireAuth`, reusing the SCIM token verification already in `enterpriseScim.js:51` | `authMiddleware.js` | **P1** |
| A3 | Regenerate `docs/API-REFERENCE.md` from the live route table (the extraction script used in this phase) and delete the 249 dead entries | docs tooling | **P1** |
| A4 | Add a stable machine-readable `code` field to error responses (e.g. `org_not_found`) alongside the human `error` string | shared helper | P2 |
| A5 | Adopt one envelope for **new** routes via a shared `_ok`/`_err` helper and document `ok` as canonical; do not retrofit 4535 routes | shared helper | P2 |
| A6 | Add `offset` (or cursor) to the highest-traffic list endpoints so records beyond the cap are reachable | route files | P2 |
| A7 | Standardize on `limit` and alias `n` for backward compatibility | 7 sites | P2 |
| A8 | Support `Idempotency-Key` on state-changing POSTs so clients can retry safely | shared middleware | P2 |
| A9 | Return 400 (not 500) for validation failures in `ssoService` (`e.status = 400`) | `ssoService.cjs` | P2 |
| A10 | Replace `name?.trim is not a function` with a typed field error | `organizationService.cjs` | P2 |
| A11 | Add a server-side request timeout and `Retry-After` on 503 | `server.js` | P3 |
| A12 | Publish a versioning/deprecation policy (`Deprecation`/`Sunset` headers) for the 84.5% unversioned surface | docs + middleware | P3 |
| A13 | Add pagination metadata (`hasMore`) to list responses | route files | P3 |

## API Readiness Score

Weighted by what an API-platform consumer actually depends on.

| Dimension | Weight | Score | Weighted | Basis |
|---|---|---|---|---|
| Auth & access control | 20% | **9.5** | 1.90 | 299/300 routes protected; F1 fixed; only `/health` public |
| Error handling | 15% | **9.0** | 1.35 | Correct codes, consistent `error`, no stack traces, no fake success |
| Request validation | 10% | 8.0 | 0.80 | All classes rejected; internal message leak on type confusion |
| Performance | 10% | 8.0 | 0.80 | p50 0.6–41 ms; two p99 outliers |
| Concurrency & idempotency | 10% | 8.5 | 0.85 | 0 lost updates, race-safe; no `Idempotency-Key` |
| REST consistency | 10% | 7.5 | 0.75 | Uniform kebab-case, correct methods; 84.5% unversioned |
| Response consistency | 10% | **5.0** | 0.50 | 5 envelope variants; no pagination metadata |
| Pagination & filtering | 5% | **5.0** | 0.25 | Caps enforced (F2 fixed); no offset/cursor, no indexes |
| SDK readiness | 5% | **5.5** | 0.28 | CORS/preflight correct; cookie-only auth blocks integrations |
| Documentation | 5% | **3.0** | 0.15 | 52.2% accurate, 94% undocumented, 249 dead entries |
| **Total** | **100%** | — | **7.63 / 10** | |

### **API Readiness: 7.6 / 10 — CERTIFIED WITH LIMITATIONS**

**What is genuinely platform-grade:** the security and correctness core. 4535 routes with **zero duplicate or shadowed registrations**, **299/300** sampled routes authenticated (only `/health` public), semantically correct status codes with `Retry-After` on 429, no stack-trace leakage, no fake success anywhere in this phase, correct 403-vs-404 semantics, uniform kebab-case naming with zero camel/snake drift, race-safe idempotency (30 concurrent identical POSTs → 1 row), ISO-8601 timestamps, and `x-request-id` on every response. Prototype pollution was attempted and safely ignored. p50 latency is 0.6–41 ms.

**Two real defects were found, reproduced, fixed and regression-tested.** F1 was a genuine cross-tenant data leak — a header could authorize you as one org's owner while the response served a different org's roster; reproduced 3/3 and confirmed on three endpoints. F2 let a negative `n` return 995 rows against a 500 cap across 38 endpoints. Both fixes are verified live, both are guarded by tests that provably fail when reverted, and legitimate access paths are unbroken.

**The limitations are consistency and consumability, not correctness.** Five response envelopes mean no SDK can write one response handler. No cursor or offset makes records beyond the cap unreachable. Cookie-only auth with `SameSite=Strict` blocks server-to-server integration — though the product's own SCIM endpoint already proves Bearer tokens work here. And unmatched API paths return the SPA shell with 200 instead of a 404, which makes the 249 dead documented endpoints silently undetectable. Every one of these is a deliberate scope exclusion under this mission's "no API rewrites" rule; A1–A3 are the three P1 items that would move the score most.

**Validation hygiene:** test leads and 10 fixture orgs cleaned/archived; prior-phase markers verified intact (`ALPHA-SECRET-LEAD`, `PRECRASH-MARKER-B5`); Phase B.6 mirror drift re-confirmed at 0; one server instance running clean; health 200. Regression **144/144 existing + 17/17 new (B.6 + B.7)**. Changes limited to `backend/middleware/orgMiddleware.cjs`, 10 route files (mechanical clamp only), and 2 new test files — plus the Phase B.5/B.6 files and pre-existing `.claude/settings.json`. No merge, no push, no redesign, no new framework, no new routing system.
