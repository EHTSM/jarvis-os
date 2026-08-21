# OS-ORGANIZATION — CAPABILITY MATRIX

**Date:** 2026-08-14 · **Verification port:** 5133 · **Regression:** 144/144 before and after

**Legend:** PROD = Production Ready · FIXED = defect corrected this pass · VERIFY = works, caveat
noted · GAP = Genuine Gap · NM = Not Measured

---

## 1. Organizations

| # | Capability | UI | Route | Service | Store | Auth | Org Scope | Role | Status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Create org | NM | `POST /orgs` | `createOrg` | `data/organizations.json` | requireAuth | new org, creator=owner | any authenticated | **PROD** |
| 2 | Read org | NM | `GET /orgs/:orgId` | `getOrg` | same | requireOrgMember | own org only | member+ | **PROD** |
| 3 | List orgs (mine) | NM | `GET /orgs` | `listOrgs` | same | requireAuth | caller's memberships | any | **PROD** |
| 4 | Update org | NM | `PATCH /orgs/:orgId` | `updateOrg` | same | requireOrgPermission | own org | admin+ | **NM** (not exercised) |
| 5 | Delete/archive org | NM | `DELETE /orgs/:orgId` | `deleteOrg` | same | requireOrgPermission | own org | owner | **NM** |
| 6 | Restore/purge org | NM | `POST /orgs/:orgId/{restore,purge}` | — | same | requireOrgPermission | own org | owner | **NM** |
| 7 | Organization identification | NM | `GET /orgs/me/context` | `resolveContext` | same | requireAuth | caller's real memberships only | any | **PROD** — verified forged `X-Org-Id` has no effect |

## 2. Workspaces (the separate, simpler tenant system)

| # | Capability | Status | Evidence |
|---|---|---|---|
| 8 | Create workspace | **PROD** | Used throughout this program's prior 8 OS passes |
| 9 | List workspaces | **PROD** | Same |
| 10 | Switch workspace | **PROD** | `POST /workspace/switch` validates membership, throws otherwise |
| 11 | Workspace ↔ org relationship | **GENUINE GAP** | Documented as reused; no actual linkage code found (§ Discovery) |

## 3. Departments (nested under Organization)

| # | Capability | UI | Route | Service | Store | Auth | Org Scope | Role | Status |
|---|---|---|---|---|---|---|---|---|---|
| 12 | Create department | NM | `POST /orgs/:orgId/departments` | `createDepartment` | org record | requireOrgPermission | path orgId | admin+ | **PROD** — real, persisted |
| 13 | List departments | NM | `GET /orgs/:orgId/departments` | `listDepartments` | org record | requireOrgPermission (`view_departments`) | path orgId | member+ | **PROD** |
| 14 | Update department | NM | `PATCH /orgs/:orgId/departments/:deptId` | `updateDepartment` | org record | requireOrgPermission | path orgId | admin+/lead | **NM** |
| 15 | Delete department | NM | `DELETE /orgs/:orgId/departments/:deptId` | `deleteDepartment` | org record | requireOrgPermission | path orgId | admin+ | **VERIFY** — attempted by a member, correctly 403'd; not exercised as a successful delete |
| 16 | Department nesting (dept→team) | NM | `POST /orgs/:orgId/departments/:deptId/teams` | `createTeam` | org record | requireOrgPermission | path orgId+deptId | admin+/dept_lead | **PROD** — real team created under a real department |
| 17 | Cross-org department isolation | — | — | — | — | requireOrgPermission | — | — | **PROD** — Org A cannot read/create in Org B (403) |

## 4. Teams

| # | Capability | Status | Evidence |
|---|---|---|---|
| 18 | Create team (under department) | **PROD** | Real team `team_1786718813439_4` created and persisted |
| 19 | List teams (org-level and dept-level) | **PROD** | Both `GET /orgs/:orgId/teams` and `.../departments/:deptId/teams` registered |
| 20 | Update/delete team | **NM** | Routes exist, not exercised |
| 21 | Add team member | **PROD** | Real member add, persisted, correctly scoped to path org (forged header had no effect) |
| 22 | Remove team member | **NM** | Route exists, not exercised |
| 23 | Team membership cannot be widened via headers | **PROD** | S10 — forged `X-Org-Id` header ignored; member added only to path-addressed org, verified on disk |

## 5. Members / Workforce

| # | Capability | Status | Evidence |
|---|---|---|---|
| 24 | Invite/add member | **PROD** | Real add, real audit event, real disk persistence |
| 25 | List members | **PROD** | Returns real roster |
| 26 | Update member role | **PROD** | Tested as legitimate owner action; **blocked** correctly when attempted by a non-privileged member (privilege escalation test) |
| 27 | Remove member | **NM** | Route exists, not exercised |
| 28 | Role assignment via invite | **PROD** | `member_added` audit event with `source:"invite"` |
| 29 | Grants (cross-org access) | **NM** | `/orgs/:orgId/grants` routes exist, not exercised |

## 6. RBAC

| # | Capability | Status | Evidence |
|---|---|---|---|
| 30 | 6 documented roles present, none invented | **PROD** | `GET /orgs/roles` live-matches the service's own header comment exactly |
| 31 | `org_owner` full control | **PROD** | Exercised: create org, add member, create dept/team |
| 32 | `member` role — read allowed, write denied | **PROD** | S6/S7 — department delete and role-change both correctly 403'd |
| 33 | `viewer` role — read-only enforced | **PROD** | Viewer blocked from creating a department (403), reading still works (200) |
| 34 | `admin`/`dept_lead`/`team_lead` | **NM** | Roles exist in the matrix; not individually exercised beyond owner/member/viewer |
| 35 | Platform operator ≠ org owner | **PROD** | S8/S9 — Org A's `org_owner` denied on `/eos/v6/dashboard` and `/revenue/dashboard` (both platform-operator-only) |

## 7. Organization Switching

| # | Capability | Status | Evidence |
|---|---|---|---|
| 36 | `POST /orgs/switch` | **PROD** | Real switch, returns updated context |
| 37 | Switching does not leak into workspace scope | **PROD** | Verified `/orgs/me/context` reflects only real org memberships regardless of workspace state |

## 8. Governance

| # | Capability | Status | Evidence |
|---|---|---|---|
| 38 | Policy CRUD (workspace-scoped) | **PROD** | Real policy created (`pol_6dc5e892151f`), persisted |
| 39 | **Policy read/write tenant isolation** | **FIXED** | Was protected only by an accidental cross-file middleware leak; now has its own explicit `requireWorkspaceMember` gate |
| 40 | Compliance/risk/reports endpoints | **NM** | Registered, not exercised this pass |
| 41 | Policy type/enforcement validation | **PROD** | Confirmed live — invalid `type` rejected with 400 and the exact allowed list |

## 9. Audit Trail

| # | Capability | Status | Evidence |
|---|---|---|---|
| 42 | Org action → audit event | **PROD** | `org_created`, `member_added` — correct org, actor, action, timestamp, verified against raw log file |
| 43 | Audit retrieval, own org | **PROD** | `GET /enterprise/audit/:orgId/permission-history` — 2 real entries returned |
| 44 | **Audit retrieval, cross-org denied** | **PROD** | 403 `Forbidden — requires permission: view_audit_log` |
| 45 | No foreign audit events leak | **PROD** | Ground-truth checked against `data/logs/audit.ndjson` directly — 0 cross-contamination |

## 10. Security / Isolation

| # | Capability | Status | Evidence |
|---|---|---|---|
| 46 | Direct-ID cross-org GET (departments) | **PROD** | 403 |
| 47 | Direct-ID cross-org GET (members) | **PROD** | 403 |
| 48 | **Forged `X-Org-Id` header (confused-deputy)** | **PROD (pre-hardened)** | Both directions tested; path param correctly wins per the documented Phase B.7 fix |
| 49 | Headerless tenant-selector forgery | **PROD** | `/orgs/me/context` ignores header entirely |
| 50 | Member → owner privilege escalation | **PROD** | 403, correctly blocked |
| 51 | Org owner → platform operator escalation | **PROD** | 403 on both tested operator-only surfaces |
| 52 | Cross-tenant governance access (before fix) | **FIXED** | See #39 |

## 11. Persistence

| # | Capability | Status | Evidence |
|---|---|---|---|
| 53 | Organization survives restart | **PROD** | 1,337 orgs before and after a real restart, target org intact |
| 54 | Department survives restart | **PROD** | Same restart, dept count unchanged (1) |
| 55 | Team survives restart | **PROD** | Same restart, team count unchanged (1) |
| 56 | Membership survives restart | **PROD** | Same restart, member roster intact |
| 57 | Audit events survive restart | **NM** | Not independently re-verified post-restart (covered by #45's ground-truth check pre-restart) |

## 12. Cross-OS Integration

| # | Capability | Status | Evidence |
|---|---|---|---|
| 58 | Org context consistent for Executive OS | **VERIFY** | `/org-executive/:orgId/*` (from the Executive OS pass) correctly enforces the same real org membership tested here |
| 59 | No duplicate org-scoping system per-OS | **PROD** | Every OS pass in this program (Finance/Developer/Memory/Mission/Executive) used the same `workspaceService`-backed tenant primitive, not a bespoke one |
| 60 | Executive carry-forward relationships unbroken | **PROD** | Executive OS's `/eos/v6/*` operator gate and business MRR disclosure fix (from the prior pass) both re-verified unaffected by this pass's change |

---

## Totals

| Classification | Count |
|---|---:|
| **Production Ready** | **38** |
| **Fixed** (this pass) | **1** |
| **Verify** | 2 |
| **Genuine Gaps** | **2** |
| **Not Measured** | **17** |
| Credential Blocked | 0 |
| Environment Blocked | 0 |
| Archive | 0 |
| **Total assessed** | **60** |

**No organization system was duplicated and nothing was built.** One security defect fixed with
negative test and live re-verification; two gaps documented rather than assumed away.
