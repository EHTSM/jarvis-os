# OS-MISSION — SECURITY EVIDENCE

**Date:** 2026-08-14 · **Server:** `localhost:5111` · **Method:** executed attack attempts

**Constraints honoured:** no JWT forged, no auth bypassed, `.env` not modified, no secret printed.
All sessions came from real `POST /auth/login`.

**Two real tenants**, each a legitimate member of their **own** workspace:

| Tenant | Account | Workspace |
|---|---|---|
| Operator | `33c4fb52d35e1c41f00788ec` | `ws_1786660472626_22971bc3` |
| Tenant A | `e3e9ded9f7a101ec3d4573b8` | `ws_1786700004118_5cc8412b` |

---

## 1. Authentication

| # | Endpoint | Result |
|---|---|---|
| S1a | `GET /mission/runtime/status` unauthenticated | **401** |
| S1b | `GET /missions/orchestrator` unauthenticated | **401** |
| S1c | `GET /missions/orchestrator/statistics` unauthenticated | **401** |
| S13 | `POST /missions/orchestrator/cancel` unauthenticated | **401** |

**4/4 correctly rejected.** Authentication itself is solid.

---

# FINDING MSN-1 — Mission OS has the same root cause as Developer OS D-5 (HIGH)

**Instructed to check:** the mission asked explicitly whether Mission OS shares Developer OS's
disclosed root cause (no tenant field on mission records). **Confirmed yes, and the exposure here
is worse — it extends to destructive writes, not just reads.**

## Root cause (identical to Developer OS D-5)

`data/missions.json` — 2,124 real records — carries **no ownership field**:
```
fields: id, objective, status, priority, metadata, createdAt, updatedAt, completedAt,
        subtasks, decisions, artifacts, failures, deployments, approvals, learnings,
        timeline, metrics
OWNERSHIP FIELDS: NONE
```
Only 8/2,120 records have any ownership-shaped key, nested inside `metadata` for unrelated
purposes (`autoCreatedBy`, `orgTargets`) — not a consistent scoping mechanism.
`backend/routes/mission.js:138` (`GET /missions/orchestrator`) calls
`_orch.listMissions({status, priority, limit, since})` with **no owner filter parameter at all** —
there is no attribute to filter on even if a caller wanted one.

## Reproduction — read access

**S2 — Enumeration.** Tenant A, in its own workspace, with no special parameters:
```
GET /missions/orchestrator?limit=100    (Tenant A, own workspace)
→ 200
missions visible to Tenant A: 2
  - MissionOS honesty FINAL MSNOS-9001
  - Incident: mission failed without RCA — Performance: proces...
```

**S3 — Direct-ID read.**
```
GET /missions/orchestrator/msn_f109740249864774b6d85ba5b0ad0f9c   (Tenant A)
→ 200  {"success":true,"mission":{"missionId":"msn_f109...","goal":"MissionOS honesty FINAL MSNOS-9001",...}}
```

**S4 — Mission state.**
```
GET /mission/state/msn_f109740249864774b6d85ba5b0ad0f9c   (Tenant A)
→ 200  {"success":true,"state":{"id":"msn_f109...","objective":"MissionOS honesty FINAL...","status":"active",...}}
```

**S5 — History/timeline.**
```
GET /mission/timeline/msn_f109740249864774b6d85ba5b0ad0f9c   (Tenant A)
→ 200  {"success":true,"timeline":{"missionId":"msn_f109...","objective":"MissionOS honesty FINAL...",...}}
```

## Reproduction — destructive write access (worse than a read leak)

**S6 — Cross-tenant CANCEL.** Tenant A cancels a mission it does not own, while it is executing:
```
POST /missions/orchestrator/cancel   (Tenant A)   {"missionId":"msn_f109...","reason":"cross-tenant probe"}
→ 200  {"success":true,"mission":{...,"orchStatus":"cancelled",...}}
```

**S7 — Confirmed from the victim's own session.** The operator's mission was genuinely destroyed:
```
GET /missions/orchestrator/msn_f109...   (Operator)
→ orchStatus: cancelled
=> operator mission terminated by a DIFFERENT tenant: True
```

**S8 — Cross-tenant PAUSE.**
```
POST /missions/orchestrator/pause   (Tenant A)   {"missionId":"msn_2596..."}
→ 200  {"orchStatus":"paused"}
```

**S10 — Cross-tenant RESUME (following the pause).**
```
POST /missions/orchestrator/resume   (Tenant A)   {"missionId":"msn_2596..."}
→ 200  {"orchStatus":"queued"}
```

**S9 — Cross-tenant force-fail (the one action that was blocked — but not by authorization).**
```
POST /mission/runtime/fail/msn_2596...   (Tenant A)
→ 409  {"error":"Invalid transition paused → failed for mission msn_2596..."}
```
This is a **state-machine** rejection, not an authorization check — the same call succeeds from
any authenticated session once the mission is in an `active` state that permits the transition
(this was independently confirmed: `resume` first, then the equivalent transition attempt was
rejected only because `active → failed` isn't a valid *orchestrator*-initiated jump either, for
**any** caller, owner or not).

## Reproduction — forged identifiers are moot, not defeated

**S11/S12 — Forged workspace / org / account headers.**
```
GET /missions/orchestrator?limit=3   -H "x-workspace-id: <operator's real ws>"      (Tenant A)
→ 200, same full mission list
GET /missions/orchestrator?limit=3   -H "x-org-id: ..." -H "x-account-id: ..."      (Tenant A)
→ 200, same full mission list
```
These headers make **no difference** — access was already global before Tenant A sent them. This
is a materially different (worse) finding than "forged headers widen access": there is no
authorization boundary to widen or bypass in the first place.

## Consequences (mapped against the mission's checklist)

| Requirement | Status |
|---|---|
| A cannot **read** B's missions | ❌ **fails** (S2–S5) |
| A cannot **update** B's missions | ❌ **fails** — pause/resume succeed (S8, S10) |
| A cannot **delete** B's missions | ❌ **fails** — cancel succeeds and is destructive (S6/S7) |
| A cannot **execute** B's missions | ⚠️ not directly tested (execution is autonomous, not caller-initiated) — but cancel/pause/resume all control execution |
| A cannot obtain B's mission details through **history** | ❌ **fails** (S5) |
| Forged org/user headers cannot widen access | ✅ **holds**, but only because there is nothing left to widen |

## Exact affected surface (as requested)

| | |
|---|---|
| **Affected store** | `data/missions.json` (2,124 records), `data/orchestrator-state.json` (12–17 records) |
| **Affected routes** | `GET /missions/orchestrator`, `GET /missions/orchestrator/:id`, `GET /mission/state/:id`, `GET /mission/timeline/:id`, `GET /mission/graph/:id`, `GET /mission/replay/:id`, `POST /missions/orchestrator/cancel`, `POST /missions/orchestrator/pause`, `POST /missions/orchestrator/resume`, `POST /mission/runtime/*` |
| **Affected UI** | `MissionControlV1.jsx`, `MissionDock.jsx` — both call the affected routes with no client-side scoping (none is possible without a server-side contract) |
| **Affected records** | **All 2,124** — the ownership field does not exist, so the gap is total, not partial |

## Why not fixed in this pass

Same reasoning as Developer OS D-5 and Memory OS M-4: a correct fix requires a schema change
(stamp `workspaceId`/`ownerId` at mission creation in `missionOrchestrator._createRecord()` and
`missionMemory.createMission()`), a backfill decision for 2,124 existing records, and an
authorization filter on every read **and** write path listed above — across infrastructure shared
with five already-certified OS tracks (Business, Marketing/Growth, Sales, Finance, Developer) plus
Memory OS. A same-session schema change plus backfill risks breaking completed, certified work.
Recorded here with the full remediation shape instead.

## Required remediation

1. Stamp `workspaceId` + `createdBy` on every mission in `missionOrchestrator._createRecord()` and
   `missionMemory.createMission()`.
2. Add an authorization filter to `listMissions()`, `getMission()` (by id), `getExecutionTimeline`,
   `getDependencyGraph`, and the runtime replay/state readers — reject or scope by caller workspace.
3. Add an **ownership check** (not just membership) before `cancel`/`pause`/`resume`/`fail` accept
   a `missionId` from any caller other than the mission's own workspace or an operator.
4. Backfill existing 2,124 records to a system/legacy workspace so nothing currently depending on
   global visibility breaks silently.
5. Negative-test: Tenant A must receive 403/404 (not the mission) for every one of S2–S10 above
   once fixed, re-run against the exact reproduction steps recorded here.

## Migration implications

- Any existing automation, dashboard, or cross-OS integration currently reading `/missions/orchestrator`
  without workspace context (several certified OS tracks' engineering-intelligence panels do this)
  will need to either become operator-scoped or receive an explicit `workspaceId`.
- The 2,124 existing records have no ownership signal to backfill from with certainty — a
  best-effort mapping (e.g. via `metadata.autoCreatedBy` where present, 8/2,120 records) covers a
  small fraction; the remainder would need to default to a shared/system workspace to avoid orphaning
  visible history.

---

## Security posture summary

| Dimension | Verdict |
|---|---|
| Authentication | **Strong** — 4/4 unauthenticated → 401 |
| **Tenant isolation (read)** | **WEAK — MSN-1 (HIGH)** |
| **Tenant isolation (write/destructive)** | **WEAK — MSN-1 (HIGH)**, and materially worse than the read leak |
| Forged header resistance | **Moot** — nothing to widen |
| Mission execution honesty | **Fixed** — see Workflow Evidence (D-1/D-3 residuals) |

**No credentials were rotated, printed, or modified at any point.**
