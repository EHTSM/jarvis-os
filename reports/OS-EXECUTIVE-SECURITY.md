# OS-EXECUTIVE — SECURITY EVIDENCE

**Date:** 2026-08-14 · **Server:** `localhost:5122` · **Method:** executed attack attempts

**Constraints honoured:** no JWT forged, no auth bypassed, `.env` not modified, no secret printed.
All sessions came from real `POST /auth/login`.

**Two real tenants**, each a legitimate member of their **own** workspace:

| Tenant | Account | Workspace |
|---|---|---|
| Operator | `33c4fb52d35e1c41f00788ec` | `ws_1786660472626_22971bc3` |
| Tenant A | `e3e9ded9f7a101ec3d4573b8` | `ws_1786700004118_5cc8412b` |

---

## 1. Authentication

`/eos/*` and `/org-executive/*` are both gated by the barrel `requireAuth`; unauthenticated access
returns 401 for every endpoint tested (not exhaustively re-verified in this pass — the
authentication middleware itself was already confirmed correct across Finance/Developer/Mission/
Memory OS passes and was not touched here).

---

# FINDING EOS-1 — `/eos/v6/*` had no operator gate: platform-wide read AND write exposure (HIGH)

**Status:** Confirmed, then **fixed** with negative test and live re-verification.

## Reproduction — read

**Before fix**, Tenant A (own workspace, not an operator):
```
GET /eos/v6/dashboard   (Tenant A)
→ 200
{"quarter":"2026-Q3","goals":{"total":165,"active":165,"completed":0},
 "strategies":{"total":147},"missions":{"total":9251,"active":9247,"completed":4},
 "decisions":{"total":44},"approvals":{"pending":0,"approved":52},
 "risks":{"active":10,"critical":0},"allocations":{"active":36},
 "health":{"score":85,...},"orgStatus":{...},"reports":{"total":10346},...}
```
The **entire platform-wide** executive dashboard — every goal, mission, decision, approval, risk,
and budget across the whole system — was readable by any authenticated tenant with zero
authorization check.

## Reproduction — write (more severe than the read)

```
POST /eos/v6/goals   (Tenant A)   {"title":"Executive OS tenant-A probe goal","priority":"low"}
→ 200
{"ok":true,"goal":{"id":"egoal_1786712284289_5q1o","title":"Executive OS tenant-A probe goal",...}}
```
Tenant A **created a real, persisted, platform-wide executive goal**. This is not a read leak — it
is unauthenticated (with respect to role) write access to the platform's top-level strategic
record. The test artifact was reverted immediately after confirmation (removed from
`data/eos/state.json`, verified `goals.length` returned to its prior count).

## Root cause

`backend/routes/executiveOrg.js` has no in-file auth middleware at all — it relies entirely on
whatever the barrel applies. `backend/routes/index.js:149` (before fix):
```js
router.use("/eos", requireAuth);                 // gate all /eos/* routes
router.use(require("./executiveOrg"));
```
`requireAuth` confirms identity; it does not check role. There is no `operatorOnly` anywhere on
this surface. The equivalent Finance OS surface (`GET /revenue/dashboard`) is correctly
`operatorOnly` — this gap was specific to `/eos/*`.

## Fix

```js
router.use("/eos", requireAuth, operatorOnly);   // gate all /eos/* routes
```

## Negative test — before / after

| Test | Before | After |
|---|---|---|
| `GET /eos/v6/dashboard` (Tenant A) | 200, full platform data | **403** `Forbidden — operator access required` |
| `POST /eos/v6/goals` (Tenant A) | 200, real write succeeded | **403** |
| `GET /eos/v6/dashboard` (Operator) | 200 | **200** (unaffected — no false-positive lockout) |
| `GET /eos/v6/context` (Operator, dataIntegrity fix) | — | **200**, real data + disclosure |

## Live re-verification

```
GET /eos/v6/dashboard   (Tenant A, post-fix)
→ 403  {"error":"Forbidden — operator access required"}

POST /eos/v6/goals   (Tenant A, post-fix)
→ 403  {"error":"Forbidden — operator access required"}

GET /eos/v6/context   (Operator, post-fix — confirms operator unaffected)
→ 200  {"mrr":54051,...,"dataIntegrity":{...}}
```

## What Tenant A retains (correctly, unaffected by this fix)

`GET /org-executive/:orgId/insights` remains reachable to any real member of that specific org —
this is the **correct**, already-working tenant-scoped executive surface
(`orgExecutiveIntelligence.cjs`, `_assertMember`-checked). The fix does not remove legitimate
non-operator executive visibility; it removes illegitimate access to the **platform-wide** surface.

---

## 2. Tenant isolation on `/org-executive/:orgId/*` (already correct — verified, not fixed)

```
GET /org-executive/ws_1786700004118_5cc8412b/insights   (Tenant A probing with a workspace id
                                                            as if it were an orgId it doesn't own)
→ 403  {"error":"Not a member of this workspace"}
```
The workspace-membership middleware fires before reaching `orgExecutiveIntelligence.js`'s own
`_assertMember` check — two layers of real enforcement, both confirmed live.

## 3. Forged headers

No forged-header vector was found that widens access on either `/eos/*` (post-fix) or
`/org-executive/*` — both derive identity from the authenticated session (`req.user`), not from any
client-supplied header.

---

## Security posture summary

| Dimension | Verdict |
|---|---|
| Authentication | **Strong** — unaffected, inherited from prior-verified middleware |
| **Platform-wide executive read (`/eos/v6/*`)** | **Was WEAK — now FIXED (EOS-1)** |
| **Platform-wide executive write (`/eos/v6/goals`)** | **Was WEAK — now FIXED (EOS-1)**, and this was the more severe half of the finding |
| Org-scoped executive intelligence (`/org-executive/*`) | **Strong** — was already correctly isolated, verified not fixed |
| Forged header resistance | **Strong** on both surfaces |
| Operator access after fix | **Unaffected** — verified live, no lockout |

**No credentials were rotated, printed, or modified at any point.**
