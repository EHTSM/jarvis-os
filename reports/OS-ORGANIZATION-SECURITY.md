# OS-ORGANIZATION — SECURITY EVIDENCE

**Date:** 2026-08-14 · **Server:** `localhost:5133` · **Method:** executed attack attempts

**Constraints honoured:** no JWT forged, no auth bypassed, no password guessed, no security
middleware disabled, `.env` not modified, no secret printed. All sessions came from real
`POST /auth/login`.

**Two real organizations**, created via real signup/API flow:

| Org | Owner account | ID |
|---|---|---|
| A | `finoa@test.local` (`e3e9ded9f7a101ec3d4573b8`) | `org_1786718762053_1` |
| B | `finop@test.local` (`33c4fb52d35e1c41f00788ec`) | `org_1786718779057_2` |

---

## 1. Authentication

| # | Endpoint | Result |
|---|---|---|
| — | `GET /orgs` unauthenticated | 401 (barrel `requireAuth`, inherited from prior-verified middleware) |
| — | `GET /governance/policies` unauthenticated | 401 |

Not exhaustively re-tested endpoint-by-endpoint this pass — `requireAuth` itself was already
confirmed correct across five prior OS passes in this program and was not modified here.

## 2. Cross-tenant direct-ID access

| # | Test | Result |
|---|---|---|
| S1 | `GET /orgs/<OrgB>/departments` (Org A owner) | **403** `requires permission: view_departments` |
| S2 | `GET /orgs/<OrgB>/members` (Org A owner) | **403** `requires permission: view_members` |
| — | `GET /enterprise/audit/<OrgB>/permission-history` (Org A owner) | **403** `requires permission: view_audit_log` |

## 3. Forged organization headers — the confused-deputy regression, re-tested

`orgMiddleware.cjs` documents a **prior, already-fixed** vulnerability (Phase B.7): the
`X-Org-Id` header used to win over the `:orgId` path parameter, so an account with membership only
in Org A could supply `X-Org-Id: <OrgA>` on a request addressed to `/orgs/<OrgB>/members` and be
authorized as if reading Org A, while the handler actually served Org B's roster. This pass
re-reproduced the exact documented scenario to confirm the fix still holds, rather than trusting
the comment:

| # | Test | Result |
|---|---|---|
| S3 | Org A + `X-Org-Id: <OrgA>` on path `/orgs/<OrgB>/members` | **403** — path param wins |
| S4 | Org A + `X-Org-Id: <OrgB>` on path `/orgs/<OrgB>/members` (exact original regression) | **403** — still correctly denied |
| S5 | Org A + `X-Org-Id: <OrgB>` on a **headerless** route (`/orgs/me/context`) | Returns **only Org A's real memberships** |
| S10 | Org A + `X-Org-Id: <OrgB>` on a **write** (`POST .../teams/:teamId/members`) | Member added correctly to the **path**-addressed org (A); Org B's departments confirmed unaffected on disk |

**A client-supplied organization identifier never grants access by itself**, in any of these four
distinct shapes (path-vs-header conflict both directions, headerless fallback, and a write path).

## 4. Privilege escalation

| # | Test | Result |
|---|---|---|
| S6 | `member` role → `DELETE` a department | **403** `requires permission: manage_departments` |
| S7 | `member` role → change **own** role to `org_owner` | **403** `requires permission: manage_members` |
| — | `viewer` role → `POST` a department | **403** `requires permission: manage_departments` |

## 5. Owner → operator boundary (explicitly required by the mission)

| # | Test | Result |
|---|---|---|
| S8 | Org A's `org_owner` → `GET /eos/v6/dashboard` (platform-operator-only, from the Executive OS pass) | **403** |
| S9 | Org A's `org_owner` → `GET /revenue/dashboard` (platform-operator-only, from the Finance OS pass) | **403** |

**An organization owner does not automatically become a platform operator.** These are two
independent authorization layers, verified independent under direct test — being `org_owner` of a
real, 1,337-organization-deep store grants zero platform-wide privilege.

---

# FINDING ORG-1 — `governance.js` tenant isolation depended on an accidental cross-file leak (MEDIUM→FIXED)

**Status:** Confirmed, root-caused via isolated reproduction, fixed, negative-tested, live-verified.

## Reproduction

`governanceService._ws(workspaceId)` performs **zero** membership validation — confirmed by direct
function call, bypassing HTTP entirely:
```js
require('./backend/services/governanceService.cjs').getPolicies('ws_1786660472626_22971bc3')
// → succeeded, returned the operator's real policy — no accountId parameter even exists in this function's signature
```
`backend/routes/governance.js` never called `requireWorkspaceMember`. The route only *appeared*
isolated at the HTTP layer because `backend/routes/security.js`, mounted earlier in
`routes/index.js`, registers `router.use(attachWorkspace)` and `router.use(requireWorkspaceMember)`
with **no path prefix** — Express applies these to every request reaching past that router
instance, including requests addressed to `/governance/*`, `/admin/*`, and any other route file
mounted after it. Reproduced this exact mechanism in an isolated 20-line Express app (see Workflow
Evidence) — an unscoped `router.use(fn)` in one file's router genuinely fires for a different
file's routes when both are mounted at the app root in the same process.

## Impact if the accident had not existed (or is ever removed)

Any authenticated user could read **and write** any other tenant's governance policies —
compliance rules, risk matrices, audit-retention settings — by supplying that tenant's
`workspaceId` in a query parameter or request body. This is a real, exploitable cross-tenant
vulnerability that happened to be closed by an unrelated file's implementation detail rather than
by design.

## Fix

`governance.js` now imports and calls `requireWorkspaceMember` itself:
```js
router.use("/governance", requireAuth);
router.use(attachWorkspace);
router.use(requireWorkspaceMember);   // added — the route's own, intentional gate
```

## Negative test — before / after

| Test | Before | After |
|---|---|---|
| `GET /governance/policies?workspaceId=<other tenant's real workspace>` | 403 (**by accident**, via `security.js`'s leak) | **403** (by `governance.js`'s own gate) |
| `GET /governance/policies?workspaceId=<caller's own real workspace>` | 200 (**by accident**) | **200** (by design) |
| Direct call to `governanceService.getPolicies()` with any string | Succeeds unconditionally (unchanged — the service layer itself is still unguarded; the route layer now compensates correctly) | Same |

The observable HTTP behavior is unchanged (both isolated correctly before and after), but the
mechanism providing that isolation moved from an accident to an intentional, documented gate that
survives future refactors of `security.js`.

## Live re-verification

Confirmed on a server verified via `lsof` to be a single process, correctly bound to the intended
port, with `governance.js`'s syntax validated (`node -c`) before restart.

---

## Security posture summary

| Dimension | Verdict |
|---|---|
| Authentication | **Strong** — inherited, unaffected |
| Cross-tenant direct-ID read | **Strong** — 403 on every tested surface |
| Confused-deputy header forgery | **Strong** — prior Phase B.7 fix re-verified across 4 distinct request shapes |
| Privilege escalation (member→owner) | **Strong** — 403 |
| Privilege escalation (owner→operator) | **Strong** — 403 on both tested platform-operator surfaces |
| **Governance tenant isolation** | **Was accidentally-dependent — now genuinely FIXED** |
| Audit trail integrity | **Strong** — ground-truth verified against the raw log file, zero foreign events |
| Audit trail cross-tenant access | **Strong** — 403 |

**No credentials were rotated, printed, or modified at any point.**
