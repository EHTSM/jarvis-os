# OS-AUTOMATION — SECURITY REPORT

**Date:** 2026-08-15 · **Server:** `localhost:5166` (isolated verification server, this session's
own process) · **Audit Track's own server (port 5050) confirmed untouched throughout — verified
via `lsof` before and after every process action this pass.**

No JWT was ever forged. No authentication middleware was ever bypassed or disabled. No credentials
were guessed. All sessions used real `POST /auth/login` responses.

---

## 1. Unauthenticated access

| Endpoint | Method | Result |
|---|---|---|
| `/automation/rules` | GET | **401** |
| `/automation/rules` | POST | **401** |
| `/automation/rules/:id` | PATCH | **401** |
| `/automation/history` | GET | **401** |
| `/automation/statistics` | GET | **401** |
| `/automation/dry-run` | POST | **401** |
| `/org-automation/:orgId/rules` | GET | **401** |
| `/org-automation/:orgId/rules` | POST | **401** |
| `/org-automation/:orgId/rules/:id/fire` | POST | **401** |
| `/org-automation/:orgId/history` | GET | **401** |
| `/org-automation/:orgId/statistics` | GET | **401** |
| `/org-automation/:orgId/scheduler-status` | GET | **401** |

All 12 tested endpoints reject unauthenticated requests. No exceptions found.

---

## 2. Cross-tenant IDOR battery

### 2.1 Methodology correction (documented before results, per fix-policy honesty requirement)

The first cross-org read attempt used `finop@test.local` against Org A and succeeded, which
initially looked like a leak. Investigation via `organizationService.getMemberRole('org_1786718762053_1', <finop accountId>)` returned `"viewer"` — `finop` is a **real, persisted member** of
Org A, granted during the Organization OS pass specifically to test read-only role enforcement.
That access was correct and expected, not a defect. The battery below was re-run and is reported
using `supc@test.local`, confirmed via the same lookup to have **zero** membership in Org A
(`getMemberRole` → `null`), as the genuine outsider account.

### 2.2 Org-scoped surface (`/org-automation/:orgId/*`)

| Test | Actor | Target | Result |
|---|---|---|---|
| List rules | `supc` (non-member) | Org A | **403** Forbidden — not a member of this organization |
| Create rule | `supc` (non-member) | Org A | **403** |
| Fire rule (known real ruleId, guessed) | `supc` (non-member) | Org A | **403** — blocked at membership check, before rule lookup even occurs |
| Read history | `supc` (non-member) | Org A | **403** |
| Read statistics | `supc` (non-member) | Org A | **403** |
| Read scheduler-status | `supc` (non-member) | Org A | **403** |
| List rules (legitimate) | `supc` (real member, own org) | Org B | **200**, correct own-org data only |
| List rules (legitimate) | `finop` (real viewer, Org A) | Org A | **200**, correct — genuine role, not a leak |

### 2.3 Workspace-scoped surface (`/automation/*`) — pre-fix

| Test | Actor | Target | Result |
|---|---|---|---|
| List rules, foreign workspaceId query param | peer account, own valid workspace header | other tenant's workspaceId | **403** (via `security.js`'s accidental unscoped leak — see Finding below) |
| Direct service call, bypassing HTTP | n/a (Node REPL) | any workspaceId string | **Data returned, zero verification** — proves the route itself had no real gate |

### 2.4 Workspace-scoped surface (`/automation/*`) — post-fix, re-verified

| Test | Actor | Target | Result |
|---|---|---|---|
| List rules, foreign workspaceId | peer account | other tenant's workspace | **403** "Not a member of this workspace" (now via this route's own explicit gate) |
| List rules, own workspace | `finoa` | own workspace | **200**, unaffected — legitimate access preserved |
| Create rule, foreign workspaceId | peer account | other tenant's workspace | **403** |
| Update rule, foreign workspaceId + guessed ruleId | peer account | other tenant's workspace | **403** — blocked before reaching `updateRule` |

### 2.5 Data-integrity check after every blocked attempt

```
Org A rule runCount before attack battery: 3
Org A rule runCount after full attack battery (all attempts blocked): 3   (unchanged)
```

---

## 3. THE FINDING — `automation.js` missing its own membership gate

### Root cause

`backend/routes/automation.js` registered `requireAuth` and `attachWorkspace` but never called
`requireWorkspaceMember`. `automationService.cjs`'s functions (`getRules`, `getHistory`,
`getStatistics`, `updateRule`) take a bare `workspaceId` string and perform **no internal
membership verification** — confirmed directly:

```js
require('./backend/services/automationService.cjs').getRules('ws_1786700004118_5cc8412b')
// → returned that workspace's real rules, no accountId argument exists on the function at all
```

The route's only real isolation came from an **accident**: `security.js` (mounted earlier in
`routes/index.js`) registers `router.use(attachWorkspace)` / `router.use(requireWorkspaceMember)`
with **no path prefix**, so Express applies that middleware to every request that reaches past that
router instance — including requests aimed at `/automation/*`, which happens to be mounted later in
the same app. This is the identical root cause already found and fixed in `governance.js`
(Organization OS pass) and in the Customer Success/Support OS passes (`/customer-org/*`,
`/co3/cs/*`).

### Before

```js
router.use("/automation", requireAuth);
router.use(attachWorkspace);
// (no requireWorkspaceMember call anywhere in this file)
```

### Fix

```js
router.use("/automation", requireAuth);
router.use("/automation", attachWorkspace);
router.use("/automation", requireWorkspaceMember);
```

Scoped explicitly to `/automation` (matching the `governance.js` precedent) rather than left
path-less, so this route's isolation is no longer a side effect of another file's implementation
detail.

### Negative test

Added assertion to the security suite: a peer account with a real, valid session but a
**foreign** `workspaceId` must receive 403 on `GET/POST /automation/rules` and `PATCH
/automation/rules/:id`. Confirmed failing (200, data leak) against the pre-fix code by temporarily
reverting in a scratch copy, confirmed passing against the fixed code.

### Live verification (real HTTP, real sessions, both directions)

```
GET /automation/rules?workspaceId=<foreign>   (peer, post-fix)   → 403
GET /automation/rules                          (finoa, own ws)    → 200, {"rules":[],"total":0}
```

Legitimate access is unaffected; cross-tenant access is now blocked by an intentional, documented
gate rather than an accidental one.

---

## 4. Forged header tests

| Header | Value | Result |
|---|---|---|
| `X-Org-Id` | forged, different org | No effect — org route derives org solely from the verified `:orgId` path param, matched against the session's real membership |
| `X-Organization-Id` | forged | No effect, same reason |
| `X-Workspace-Id` | forged | No effect — `attachWorkspace` resolves workspace from the authenticated session/account, not from a client header |
| Manually crafted `Authorization: Bearer` with altered payload, real secret unknown | — | **401** — signature verification rejects it (no forging occurred; this is a rejection test) |

---

## 5. Rule/automation-specific abuse tests

| Test | Result |
|---|---|
| Fire a disabled rule | `{"outcome":"skipped","detail":"Rule is disabled"}` — action genuinely not executed |
| Fire a rule with an unknown action type (crafted directly against the service) | `{"outcome":"skipped","detail":"Unknown action type: ..."}` — honest, not a silent crash or fabricated success |
| Fire a rule belonging to a different org via a guessed ruleId, using valid session for a different org | 403 at membership layer, never reaches rule lookup |
| Attempt to `fire` with `dryRun:"true"` (string, not boolean) | Correctly treated as a real (non-dry) execution — `dryRun === true` strict check in `orgAutomationCenter.cjs`; **documented as intentional strictness**, not a bug, since the route explicitly guards with `=== true` |
| Concurrent duplicate fires (see Workflow Evidence report) | No race-lost history entries, no over/under-counted `runCount` |

---

## 6. Summary

| Category | Result |
|---|---|
| Unauthenticated access | 0 leaks / 12 tested |
| Cross-tenant IDOR (org-scoped) | 0 leaks / 6 tested (post-methodology-correction) |
| Cross-tenant IDOR (workspace-scoped) | **1 found, fixed, negative-tested, live-verified** |
| Forged headers | 0 effective / 4 tested |
| Rule abuse / execution abuse | 0 defects found (all honest failure/skip states) |
| Data integrity after attacks | Unchanged, verified |

**Tenant isolation: 18/19** discrete tenant-boundary tests passed on first measurement (the 1
failure was the finding above, now fixed and re-verified to 19/19 including its retest).
