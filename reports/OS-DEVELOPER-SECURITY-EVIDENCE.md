# OS-DEVELOPER — SECURITY EVIDENCE

**Date:** 2026-08-14 · **Server:** `localhost:5088` · **Method:** executed attack attempts

**Constraints honoured:** no JWT was forged, no authentication was bypassed, `.env` was not
modified, and no secret material was printed. All sessions came from real `POST /auth/login`.

Tenants: **Operator** `finop@test.local` (workspace member) · **Org A** `finoa@test.local` (non-member).

---

## 1. Unauthenticated access

| # | Endpoint | Result |
|---|---|---|
| S1a | `GET /coding/smells` | **401** |
| S1b | `GET /engineering/intelligence` | **401** |
| S1c | `GET /missions/orchestrator` | **401** |
| S1d | `GET /runtime/status` | **401** |
| S1e | `GET /deployment/targets` | **401** |

**5/5 correctly rejected.**

## 2. Direct-ID access (IDOR)

| # | Test | Result | Verdict |
|---|---|---|---|
| S2 | Org A reads operator's mission via `GET /mission/state/<id>` | **404** `Mission not found` | ✅ isolated |
| S4 | Org A reads `GET /workspace` | `{"workspaces":[],"activeWorkspaceId":"default"}` | ✅ isolated |

## 3. Command execution boundary

`POST /runtime/dispatch` with `"run terminal command: cat /etc/passwd"`:
```json
{"success":false,"command":"terminal command: cat /etc/passwd",
 "error":"Command blocked: command_not_allowlisted: terminal","blocked":true}
```
**Blocked by allowlist.** Arbitrary command execution is not reachable through the runtime.

## 4. Path traversal / secret exposure

`POST /runtime/dispatch` with `"read file ../../.env"`:
```json
{"receiptId":"fsr-2","adapterType":"filesystem","operation":"read","path":"../../.env",
 "success":false,"reason":"path_traversal_detected"}
```

Secret-material scan of the response (`JWT_SECRET=`, `RAZORPAY_KEY_SECRET=`, `sk-…`, `rzp_live_…`):
**0 matches.**

**Traversal blocked; no secret leaked.**

---

# FINDING D-5 — Engineering missions are not tenant-scoped (HIGH)

**Status:** Confirmed exploitable · **Not fixed** — architectural, see rationale below.

## Reproduction

Org A (**not a member of any workspace**), authenticated normally:

```
GET /missions/orchestrator?limit=5        (no workspace header at all)
→ 200
missions visible to non-member Org A: 5
  - msn_305307b4893b429c826904ef | Docs: create runbook for failed mission — Performance: proce…
  - msn_a916d795b72c44088b36161f | Docs: document lesson — Reviewed: Mobile: Android build outp…
  - msn_06dfb3852a774e3da210a94f | Mobile: Android build outputs missing — needs Capacitor sync
```

Supplying **another tenant's** workspace id also succeeds:
```
GET /missions/orchestrator   with  x-workspace-id: ws_1786660472626_22971bc3
→ 200, full mission list returned to a non-member
```

## Root cause

Mission records carry **no tenant field at all**:
```
has workspaceId field?  false
has ownerId/accountId?  false
```
`backend/routes/mission.js:138` calls `_orch.listMissions({status, priority, limit, since})` with
no owner filter — because there is no owner attribute to filter on. Authentication is enforced
(the 401s above), but **authorization is not**: every authenticated user sees every mission.

## Impact

Cross-tenant disclosure of engineering activity. Mission goals leak internal system state,
subsystem names, and file paths (e.g. "Mobile: Android build outputs missing — needs Capacitor
sync"). Not a code-execution or write vector — `POST` mission creation still requires a valid
session, and mission *state* reads by direct id are correctly isolated (S2).

## Why it was not fixed in this pass

The missions store has no ownership attribute, so a correct fix requires a schema change
(stamp `workspaceId`/`ownerId` at creation), a backfill decision for 2,104 existing missions, and
a filter at every read path. The mission orchestrator is shared infrastructure consumed by
Marketing/Growth, Sales, Finance and the autonomous runtime; a same-session redesign risked
breaking completed OS tracks. Recorded here as the top P0 with a concrete remediation.

## Recommended fix

1. Stamp `workspaceId` (and `createdBy`) on every mission at creation.
2. Filter `listMissions()` by the caller's workspace; operators may opt into a platform view.
3. Backfill existing records to a system/legacy workspace rather than leaving them globally readable.
4. Negative-test: non-member must receive `[]`; member must see only their own.

---

# FINDING D-6 — Runtime dispatch envelope reports success for blocked work (LOW)

`POST /runtime/dispatch` returns an outer `{"success":true, ...}` even when the inner task was
refused:
```json
{"success":true,"results":[{"success":true,
  "result":{"success":false,"error":"Command blocked: command_not_allowlisted","blocked":true}}]}
```
Both the envelope *and* the per-task wrapper say `success:true` while the actual execution was
blocked. Callers checking only the top level would record a blocked command as successful — the
same class of masking as D-1 (fixed), one layer up.

**Security posture is not weakened** (the command really was blocked); this is a reporting-honesty
defect. Not fixed here because `/runtime/dispatch` is consumed platform-wide and changing its
contract mid-track could break other sessions' verified work.

---

## Security posture summary

| Dimension | Verdict |
|---|---|
| Authentication (developer surfaces) | **Strong** — 5/5 unauthenticated → 401 |
| Mission direct-ID access | **Strong** — non-member → 404 |
| Workspace isolation | **Strong** — non-member sees `[]` |
| **Mission enumeration** | **WEAK — D-5 (HIGH)** |
| Command execution boundary | **Strong** — allowlist enforced |
| Path traversal | **Strong** — `path_traversal_detected` |
| Secret exposure | **Strong** — 0 matches in responses |
| Execution reporting honesty | **Fixed** for missions (D-1); **D-6 open** at dispatch envelope |
| **Artifact integrity (B.23)** | **Was unprotected — now guarded (D-4)** |

**No credentials were rotated, printed, or modified at any point.**
