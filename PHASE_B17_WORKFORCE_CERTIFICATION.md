# Phase B.17 — Team & Workforce Certification

**Product:** Ooplix (jarvis-os) v1.0.0-rc1
**Date:** 2026-08-09
**Branch:** `security/reality-completion` (no merge, no push)
**Method:** Operated as a real multi-company workforce OS. **Measured first, read source only after reproducing.** No new HR system, workforce model, or storage.

**Test rig:** five real accounts in five real organizations, then assembled into one 4-person company with four distinct roles — `org_owner`, `org_admin`, `dept_lead`, `team_lead` — plus a genuine non-member outsider, and a real Org → Department (with lead) → Team → Member hierarchy.

---

## Defect Reproduced and Recovered

### D1 — The sole org owner could demote themselves, stranding the company permanently (**CRITICAL**)

`removeMember()` has always refused to delete the org owner — *"Cannot remove the org owner — transfer ownership first"* — but `updateMemberRole()` had **no equivalent guard**. It blocked *promoting* anyone to `org_owner`, and never checked whether it was demoting the last one. The same protection was bypassable by demotion instead of removal.

**Reproduced live** on the real 4-member organization. The sole `org_owner` PATCHed itself to `viewer` and received **HTTP 200**:

```
members: 4  →  org_owner count: 0   >>> ORG IS OWNERLESS
```

**The organization was then permanently unmanageable** — every recovery path measured:

| Attempted recovery | Result |
|---|---|
| ex-owner `DELETE /orgs/:id` | **403** — no longer owner |
| ex-owner PATCH self back to `org_owner` | **403** |
| ex-owner `PATCH /orgs/:id` (update_org) | **403** |
| `org_admin` promotes anyone to owner | **400** `Use transferOwnership to assign org_owner` |
| `org_admin` `DELETE /orgs/:id` | **403** — `delete_org` is owner-only |

**And `transferOwnership` does not exist.** `organizationService` exports **39 functions** and none is named that — the identifier appears **only inside that error string**. `POST /orgs/:id/transfer-ownership`, `/transfer` and `/owner` all return **404**. So the instruction *both* guards give — "transfer ownership first" — is impossible to follow. Nothing in the product could recover the organization; I had to repair `data/organizations.json` by hand.

This is the workforce equivalent of losing the only key to the building: the company still exists, still holds members, departments, teams and missions, but no one can administer it, hand it over, or delete it.

**Recovery:** mirror the guard `removeMember` already has, scoped precisely to the **last** owner:

```js
if (m.orgRole === "org_owner" && newRole !== "org_owner") {
    const owners = org.members.filter(x => x.orgRole === "org_owner");
    if (owners.length <= 1) {
        throw new Error("Cannot demote the last org owner — transfer ownership first");
    }
}
```

Placed in the **service**, not the route, so every caller (HTTP, SCIM group-sync, scripts) passes through it. The route already defaults these errors to **400**, matching the DELETE guard's behaviour.

**Verified live — the fix is narrow, and legitimate workforce operations are untouched:**

| Operation | Result |
|---|---|
| **last owner → viewer** | **400** `Cannot demote the last org owner — transfer ownership first` |
| **last owner removal** (pre-existing guard) | **400** — unchanged |
| step-down **with a second owner present** | **200** — hand-over still works (verified: owners 2 → 1) |
| demote non-owner `team_lead → member` | **200** |
| promote `member → dept_lead` | **200** |
| demote / restore `org_admin` | **200 / 200** |
| invalid role (`emperor`) | **400** `Invalid orgRole` |
| direct promotion to `org_owner` | **400** — still blocked |

**Store-wide audit:** **0 of 933 active organizations** (1068 total) are ownerless — the one I created during reproduction was the only instance, and it is repaired.

**Regression:** `tests/runtime/23-workforce-ownership.test.cjs` — **11 tests, 11/11 pass**. **Negative-tested: 4 fail** with the fix reverted.

---

## 1. Workforce Inventory Matrix

| Surface | Routes | Store | Live probe | Reality |
|---|---|---|---|---|
| **Organizations** | 34 (`/orgs/*`) | `organizations.json` (617 KB) | **200** | **1068 orgs**, 933 active / 52 archived |
| **Members** | 4 | same (nested) | **200** | 1036+ memberships, `accountId`/`orgRole`/`joinedAt` |
| **Roles** | 2 (`/orgs/roles`, `/orgs/actions`) | code constants | **200** | 6 roles + explicit hierarchy + per-action role map |
| **Departments** | 4 | nested in org | **200** | `leadAccountId`, nested `teams`, `composition` |
| **Teams** | 6 | nested in dept | **200** | `memberIds`, `leadAccountId`, denormalized `deptId`/`deptName` |
| **Org missions** | 3 | missionMemory | **200** | `orgId`/`deptId`/`teamId`/`ownerId` attribution |
| **Grants (delegation)** | 4 | `org-grants.json` | **403** owner-gated | cross-account org access |
| **AI Workforce** | 32 (`/workforce-os/*`) | `workforce.json` (284 KB) | **200** | **39 agents**, 20 teams, skills, rankings |
| Approvals | 24 (`/approval/*`) | `approval-queue.json` (76 KB) | **200** | queue, evidence, predictions |
| Workforce planning | 15 (`/workforce/*`) | `workforce-plans.json` | **200** | capacity, escalations |
| Org network / civilization | 44 | `org-network-registry.json` | — | multi-org federation |
| Enterprise org/roles/teams | 9 | `enterprise-*.json` | — | 6 orgs / 6 roles / 4 teams |
| **Total workforce routes** | **241 in 39 files** | — | **8/10 probed → 200, 1 → 403** | 2 HTML fallbacks (`/orgs/:id/roles`, `/workforce` — no such routes) |

## 2. Employee Lifecycle Matrix

| Stage | Result | Status |
|---|---|---|
| **Invite / add member** | `POST /orgs/:id/members` → 200, role assigned at join | CERTIFIED |
| Join record | `accountId`, `orgRole`, `joinedAt` persisted | CERTIFIED |
| Org auto-created on registration | Each new account gets its own org + workspace | CERTIFIED |
| **Role change (promote)** | `member → dept_lead` → 200 | CERTIFIED |
| **Role change (demote)** | `team_lead → member` → 200 | CERTIFIED |
| Invalid role rejected | `emperor` → **400** `Invalid orgRole` | CERTIFIED |
| Direct promotion to owner | **400** `Use transferOwnership` | CERTIFIED |
| **Remove member** | `DELETE /orgs/:id/members/:acct` → 200 | CERTIFIED |
| **Last-owner removal blocked** | **400** "transfer ownership first" | CERTIFIED |
| **Last-owner demotion blocked** | Was **200 → ownerless**; now **400** | CERTIFIED (after D1) |
| Department assignment | `updateMemberDepartment` + SCIM variant | CERTIFIED |
| Team membership | add / remove team member → 200 | CERTIFIED |
| **Suspend / activate / deactivate / restore** | **404** on all 5 probes; no member `status` field exists (verified across 1036 memberships) | **GENUINE CAPABILITY GAP** |
| **Ownership transfer** | **No function, no route** — referenced only in an error string | **GENUINE CAPABILITY GAP** |
| Org archive / restore / purge | `archiveOrg`, `restoreOrg`, `purgeOrg` all exist | CERTIFIED |

## 3. Organization Matrix

| Capability | Measured | Status |
|---|---|---|
| **Org → Department → Team → Member** | Built end-to-end live and read back | CERTIFIED |
| Department creation | `POST /orgs/:id/departments` → 200 | CERTIFIED |
| Duplicate dept refused | **409** `A department named "…" already exists` | CERTIFIED |
| **Department lead** | `leadAccountId` assigned via PATCH → 200 | CERTIFIED |
| Team under department | `POST …/departments/:d/teams` → 200 | CERTIFIED |
| Team members | `memberIds: ["11504c21…"]` persisted | CERTIFIED |
| **Denormalized rollup** | `/orgs/:id/teams` returns `deptId` + `deptName` per team | CERTIFIED |
| Real hierarchy in store | 9 orgs with departments (Executive, Engineering, DevOps/Cloud, QA, Research) | CERTIFIED |
| Org status | 933 active / 52 archived | CERTIFIED |
| Org plan | `free` default, plan field present | CERTIFIED |
| Slug uniqueness | Enforced with **409** | CERTIFIED |
| **Atomic writes** | `.tmp` + rename with per-PID unique name (line 109) | **CERTIFIED** |
| Teams at org level | 0 orgs use org-level teams; all nested under departments | OBSERVATION |

## 4. RBAC Matrix

Measured live: 6 actions × 5 actors (owner, admin, dept_lead, member, outsider).

| Action | owner | admin | dept_lead | member | outsider |
|---|---|---|---|---|---|
| `view_members` | 200 | 200 | 200 | 200 | **403** |
| `manage_members` | 400¹ | 400¹ | **403** | **403** | **403** |
| `manage_departments` | 200 | 409² | **403** | **403** | **403** |
| `update_org` | 200 | 200 | **403** | **403** | **403** |
| `delete_org` | 200 | **403** | **403** | **403** | **403** |
| `view_departments` | 200 | 200 | 200 | 200 | **403** |

¹ `400 accountId required` — my probe payload lacked `accountId`; permission **passed**, validation refused. Not a denial.
² `409` duplicate department — the owner had already created that name; permission **passed**.

**Corrections recorded:** I initially read the `409` and `400` cells as RBAC anomalies. Both were my own probe payloads — verified by re-testing with a distinct department name (**200**) and by reading the 400 body (`accountId required`). RBAC is clean.

| Property | Result | Status |
|---|---|---|
| 6 declared roles | `org_owner, org_admin, dept_lead, team_lead, member, viewer` | CERTIFIED |
| **Explicit hierarchy** | 0…5 numeric precedence exposed via `/orgs/roles` | CERTIFIED |
| Per-action role map | `/orgs/actions` lists permitted roles per action | CERTIFIED |
| Enforcement matches declaration | **All 30 measured cells consistent** with the map | CERTIFIED |
| Outsider fully denied | **403 on every workforce surface** | CERTIFIED |
| `delete_org` owner-only | Admin **403** | CERTIFIED |
| Guard location | `_assertPermission` in the service, not only routes | CERTIFIED |
| Route middleware | `requireOrgPermission("…")` per route | CERTIFIED |
| Escalation via manage_members | Now blocked from stranding the org (D1) | CERTIFIED (after D1) |

## 5. Collaboration Matrix

| Capability | Measured | Status |
|---|---|---|
| **Org mission creation** | `POST /orgs/:id/missions` → 200 | CERTIFIED |
| **Workforce attribution** | `metadata: {orgId, deptId, teamId, ownerId, domain:"org"}` | CERTIFIED |
| Mission ownership assertion | `assertMissionOwnership` + `/missions/:id/ownership` | CERTIFIED |
| Mission listing per org | `view_missions` gated | CERTIFIED |
| `create_mission` for members | member → **200** (intentionally broad) | CERTIFIED |
| **Approval queue** | `/approval/queue` → 200; `approval-queue.json` 76 KB | CERTIFIED |
| Approval evidence | `approval-evidence.ndjson` 318 KB, indexed | CERTIFIED |
| Approval predictions | `approval-predictions.json` 31 KB | CERTIFIED |
| **Delegation (grants)** | `/orgs/:id/grants` — owner/enterprise-admin gated (**403** for admin) | CERTIFIED |
| Grant revoke / list | `revokeOrgAccess`, `listOrgGrants`, `listGrantsForAccount` | CERTIFIED |
| Escalation | `/workforce/:missionId/escalations` → 200 | CERTIFIED |
| Cross-org collaboration | `cross-org-collaborations.json`, `org-collaborations.json` (171 KB) | CERTIFIED |
| **Conversations / reviews on members** | ❌ no per-member thread or review record | GENUINE CAPABILITY GAP |
| **Human↔AI handoff on org missions** | Exists for agent missions (Phase I6), not wired to org member assignment | GENUINE CAPABILITY GAP |

## 6. Workforce Planning Matrix

Measured from the live AI-workforce dashboard.

| Metric | Value | Status |
|---|---|---|
| **Total agents** | **39** | CERTIFIED |
| Available / overloaded | 17 / 22 | CERTIFIED |
| Active teams | 20 | CERTIFIED |
| Queue depth | 20 | CERTIFIED |
| **Utilization rate** | **69%** = `(busy + overloaded) / total` | CERTIFIED |
| Overload rate | separate `overloadRate` metric | CERTIFIED |
| Missions run | 845 | CERTIFIED |
| Minutes saved | 27,165 | CERTIFIED |
| Auto-assigned | 1,811 | CERTIFIED |
| **Workload heatmap** | 5 buckets | CERTIFIED |
| **Bottlenecks** | **76** identified | CERTIFIED |
| Skill coverage | present | CERTIFIED |
| Performance rankings | present | CERTIFIED |
| Collaboration graph | present | CERTIFIED |
| **Human capacity planning** | ❌ planning covers AI agents only; no per-employee capacity, workload or utilization | **GENUINE CAPABILITY GAP** |

**Correction recorded:** I flagged `utilizationRate 69%` as inconsistent because neither `overloaded/total` nor `(total−available)/total` equalled it (both 56%). Reading `capacityPlanner.cjs:79` showed a third bucket — `busy` — that I had not modelled: `(busy + overloaded)/total`. **69% is correct**; my arithmetic model was incomplete. Not a defect.

## 7. Executive Matrix

| Report | Measured | Status |
|---|---|---|
| **Headcount** | `/orgs/:id/members` → exact member list + roles | CERTIFIED |
| Org-level rollup | `/orgs` per-account, 1068 orgs in store | CERTIFIED |
| **AI workforce summary** | 39 agents, 20 teams, 69% utilization, 76 bottlenecks | CERTIFIED |
| Productivity | `missionsRun 845`, `minutesSaved 27165`, `autoAssigned 1811` | CERTIFIED |
| Performance rankings | per-agent, present | CERTIFIED |
| Approvals visibility | queue + evidence + predictions | CERTIFIED |
| Executive intelligence | `/orgExecutiveIntelligence` (4 routes) | CERTIFIED |
| Org billing rollup | `/orgs/:id/billing`, `manage_billing` gated (B.14) | CERTIFIED |
| **Human productivity / utilization** | ❌ no per-employee metrics | GENUINE CAPABILITY GAP |
| **Headcount trend over time** | ❌ point-in-time only; no history | GENUINE CAPABILITY GAP |
| Department composition | `composition` field on departments | CERTIFIED |

## 8. Recovery Matrix

SIGKILL of the live process, measured before/after on the real 4-person org.

| Signal | Before | After | Status |
|---|---|---|---|
| **Recovery time** | — | **~12 s** (PM2) | CERTIFIED |
| Health | — | **200** | CERTIFIED |
| Members | 4 | **4** | CERTIFIED |
| Departments | 2 | **2** | CERTIFIED |
| Teams in department | 1 | **1** | CERTIFIED |
| Team member IDs | `["11504c21…"]` | **identical** | CERTIFIED |
| Total orgs | 985 | **985** | CERTIFIED |
| **Orphan members** (no `accountId`) | — | **0** | CERTIFIED |
| **Stale team / dept-lead refs** | — | **0** | CERTIFIED |
| Roles preserved | 4 distinct | **4 distinct** | CERTIFIED |
| **Atomic writes** | `.tmp`+rename, per-PID unique | CERTIFIED |
| Ownerless orgs after recovery | **0 of 933 active** | CERTIFIED |

The org store uses the same atomic write pattern as `agents/taskQueue.cjs` — **better durability than the support (B.15) and customer (B.16) stores**, which write whole-file without it.

## 9. Multi-org Matrix

Five real orgs, marker-verified.

| Probe | Result | Status |
|---|---|---|
| Outsider `GET /orgs/:otherOrg/members` | **403** | CERTIFIED |
| Outsider `GET /orgs` | **1 org — only their own** | CERTIFIED |
| Outsider on every workforce action | **403 × 6/6** | CERTIFIED |
| Real member (admin) on own org | **200** | CERTIFIED |
| `dept_lead` cannot manage members | **403** | CERTIFIED |
| `member` cannot manage departments | **403** | CERTIFIED |
| Grants owner-gated | admin **403** | CERTIFIED |
| Org missions scoped by `orgId` | metadata carries it | CERTIFIED |
| Cross-org org listing | no leakage of other orgs' names | CERTIFIED |
| Ownership stranding across orgs | Now impossible (D1) | CERTIFIED (after D1) |

**Workforce multi-org isolation is genuinely correct** — the strongest of the three domains certified in B.15–B.17. Unlike support tickets (B.15 G1) and derived customer data (B.16 G1), every workforce object is org-keyed at the storage level and every route is RBAC-gated.

## 10. Business Impact Matrix

| Impact | Before | After |
|---|---|---|
| **Company can always be administered** | **No** — the sole owner could self-demote to `viewer` and leave the org with **0 owners**, unmanageable and undeletable by anyone | Refused with 400 |
| **Recovery from stranding** | **None** — every path 403/400, and `transferOwnership` does not exist | Cannot occur |
| Ownership hand-over with a successor | Worked | **Unchanged** (verified 2 owners → step-down 200) |
| Non-owner role changes | Worked | **Unchanged** |
| Last-owner removal | Already blocked | **Unchanged** |
| Escalation via `manage_members` | An admin could strand the org | Blocked for admins too |
| RBAC enforcement | Correct across 30 measured cells | **Unchanged** |
| Multi-org isolation | Correct — outsiders 403 everywhere | **Unchanged** |
| Audit attribution | `permission.role_changed` with actor + `previousRole→newRole` | **Unchanged** |
| Durability | 4 members / 2 depts / 1 team / 0 orphans through SIGKILL in ~12 s | **Unchanged** |
| Store-wide integrity | — | **0 of 933 active orgs ownerless** |

## 11. Remaining Gap Matrix

| ID | Gap | Type | Severity |
|---|---|---|---|
| **G1** | **No ownership transfer exists.** Both last-owner guards instruct "transfer ownership first", but `transferOwnership` is not a function (39 exported, none named that) and not a route (3 probes → 404). A retiring owner has **no supported way to hand the company over** — the only path is editing `organizations.json`. Building it is new capability, so it is documented, not added. | **GENUINE CAPABILITY GAP** | **Critical** |
| **G2** | **No member suspend / deactivate / restore.** All 5 route probes 404 and no member `status` field exists across 1036 memberships — the only offboarding is hard removal, which loses the join record and role history. | **GENUINE CAPABILITY GAP** | **High** |
| **G3** | **Workforce planning covers AI agents only.** 39 agents get capacity, utilization, workload heatmap, bottlenecks and rankings; **human members get none of it** — no per-employee capacity, workload, or utilization anywhere. | **GENUINE CAPABILITY GAP** | **High** |
| G4 | **No human productivity or utilization reporting** for the executive view — headcount is exact, but there are no per-employee metrics. | GENUINE CAPABILITY GAP | High |
| G5 | **No headcount history** — org membership is point-in-time; no joiner/leaver trend, tenure, or attrition. | GENUINE CAPABILITY GAP | Medium |
| G6 | **No per-member conversations or reviews** — no 1:1 notes, performance review, or feedback record on a member. | GENUINE CAPABILITY GAP | Medium |
| G7 | **Human↔AI assignment not unified** — org missions carry `ownerId`, and the AI workforce auto-assigns 1,811 tasks, but a human member cannot be assigned from the workforce planner. | GENUINE CAPABILITY GAP | Medium |
| G8 | **No team-lead field populated** — `leadAccountId` exists on teams but was `null` on creation with no route to set it (only `manage_own_team` PATCH). | GENUINE CAPABILITY GAP | Medium |
| G9 | `/orgs/:orgId/roles` and `/workforce` return the **SPA HTML fallback** — no such routes despite the naming. | OBSERVATION | Low |
| G10 | **No org-level teams** — 0 of 1068 orgs use them; all teams nest under departments. `/orgs/:id/teams` flattens correctly. | OBSERVATION | Low |
| G11 | `data/organizations.json` holds **1068 orgs / 617 KB** in one whole-file store, read and rewritten on every membership change. No pagination on `/orgs`. | OBSERVATION | Low |
| G12 | **Test isolation:** `tests/runtime/09-mirror-reconcile.test.cjs` fails intermittently (~1 run in 8) when the whole new-suite directory runs concurrently, because `node --test` parallelises files against shared unlocked JSON stores. **Pre-existing** (Phase B.6) and **not a product defect** — it passes 3/3 without B.17 present and the full set passes 124/124 with `--test-concurrency=1`. | OBSERVATION | Low |
| G13 | Enterprise org/role/team stores (`enterprise-*.json`, 6/6/4 records) appear parallel to the main org model; relationship unverified. | UNKNOWN | Low |

---

## Final Workforce Certification

| Area | Classification |
|---|---|
| Workforce Inventory | **CERTIFIED** — 241 routes / 39 files, 1068 orgs, 39 AI agents, real data throughout |
| Employee Lifecycle | **CERTIFIED WITH LIMITATIONS** — invite/join/role-change/remove all work; no suspend/restore, no transfer |
| Organization Hierarchy | **CERTIFIED** — Org → Dept (with lead) → Team → Member built and verified end-to-end |
| **RBAC** | **CERTIFIED** — 30/30 measured cells match the declared action map; outsider 403 everywhere |
| Collaboration | **CERTIFIED WITH LIMITATIONS** — org missions with full attribution, approvals, grants, escalation; no member reviews |
| Workforce Planning | **CERTIFIED (AI) / GENUINE CAPABILITY GAP (human)** — 69% utilization, 76 bottlenecks for agents; nothing for employees |
| Approvals | **CERTIFIED** — queue, 318 KB evidence, predictions |
| Cross-system Linkage | **CERTIFIED** — missions carry org/dept/team/owner; billing rollup org-gated |
| **Multi-org Isolation** | **CERTIFIED** — every workforce object org-keyed, every route RBAC-gated |
| Executive Reporting | **CERTIFIED WITH LIMITATIONS** — exact headcount + full AI metrics; no human productivity |
| Recovery | **CERTIFIED** — 4 members / 2 depts / 1 team / **0 orphans, 0 stale refs** through SIGKILL in ~12 s, atomic writes |
| Audit | **CERTIFIED** — every workforce action recorded with actor, target, and role transition |
| Human Override | **CERTIFIED WITH LIMITATIONS** — role change and removal work, guarded; **no ownership transfer** |

### **Workforce Readiness: CERTIFIED WITH LIMITATIONS — with one critical residual gap (G1)**

**The defect I found is the most severe single failure across B.15–B.17, and it was one keystroke wide.** `removeMember` refuses to delete the last org owner; `updateMemberRole` had no matching check. So the sole owner of a real 4-person company demoted itself to `viewer` with **HTTP 200**, and the organization became permanently ownerless — the ex-owner could not restore itself (403), the `org_admin` could not promote a successor (400 *"Use transferOwnership"*), and **nobody** could delete the org, because `delete_org` is owner-only. Worse, `transferOwnership` **does not exist anywhere in the product**: 39 exported service functions, none named that, three route probes all 404, and the identifier present only inside the error string that tells users to use it. Both guards issue an instruction the product cannot satisfy. I had to repair the store by hand. The fix mirrors the guard that was already there, scoped to the last owner so a genuine hand-over with a successor still works — verified live, along with every other role operation staying green.

**What the workforce layer gets genuinely right is more than the other two domains I certified this session.** RBAC is real and consistent: 6 roles with a declared numeric hierarchy, a per-action role map exposed to clients, and **all 30 measured enforcement cells matching that declaration** — outsiders 403 on every surface, `delete_org` owner-only, `dept_lead` correctly barred from managing members. The Org → Department → Team → Member hierarchy assembled end-to-end and read back with denormalized `deptId`/`deptName` for reporting. Org missions carry full workforce attribution (`orgId`, `deptId`, `teamId`, `ownerId`). Every workforce mutation is audited with actor, target and `previousRole→newRole` — including my own self-demotion, captured as `org_owner->viewer`, which is exactly the forensic record you would want. And the org store uses **atomic `.tmp`+rename writes**, giving it better durability than the support and customer stores; recovery was clean with **0 orphan members and 0 stale team or dept-lead references**.

**Multi-org isolation here is correct**, and that is worth stating plainly against the previous two phases: where B.15 found support tickets fully cross-tenant and B.16 found derived customer data cross-tenant, every workforce object is org-keyed at the storage level and every route is permission-gated. A genuine non-member got 403 on all six actions and saw only its own org in `/orgs`.

**Three gaps are named in the verdict because they define what this is not yet.** There is **no ownership transfer** (G1) — the one operation both guards demand. There is **no suspend or restore** (G2): no member `status` field exists across 1036 memberships, so the only offboarding is hard deletion, which discards the join record and role history. And **workforce planning is AI-only** (G3): 39 agents receive capacity, utilization, a workload heatmap, 76 identified bottlenecks and performance rankings, while human members receive none of it — for a product positioned as a workforce OS, the humans are the least measured part of the workforce. All three would require building new capability, which this mission forbids.

**Two corrections to my own measurements**, both of which would have been false findings: I read `409` and `400` cells in the RBAC matrix as anomalies when both were my own probe payloads (a duplicate department name I had just created, and a missing `accountId`) — permission had passed in both cases, confirmed by re-testing; and I flagged `utilizationRate 69%` as inconsistent because I had modelled only `available` and `overloaded`, missing the `busy` bucket that `capacityPlanner.cjs:79` actually uses. A third, in my own test rather than the product: my first three regression fixtures were flaky because `node --test` parallelises files against a shared unlocked JSON store, so a concurrent suite could clobber my seeded org mid-call — I rewrote them to re-seed and retry on collision rather than let a wrong error count as a pass, and confirmed 6/6 clean runs.

**Validation hygiene:** the organization I stranded during reproduction was restored to `org_owner`; the 2 regression fixture orgs were removed; a store-wide scan confirms **0 of 933 active organizations are ownerless**. Regression **144/144 existing + 124/124 new (B.6–B.17, `--test-concurrency=1`)**, with the new suite negative-tested (**4 of 11 fail** with the fix reverted). One pre-existing suite (`09-mirror-reconcile`, Phase B.6) is intermittently flaky under parallel execution for the same shared-store reason — recorded as **G12**, not a product defect, and it passes without B.17 present. Change limited to `backend/services/organizationService.cjs` (**+28/−0**) plus one new test file. No merge, no push, no new HR system, no new workforce model, no new storage.
