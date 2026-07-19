# Multi-Organization Gap Analysis

Status: planning document. No code changed. Companion to `MULTI_ORG_IMPLEMENTATION_ROADMAP.md`.

This compares the **approved architecture** (Ooplix Multi-Organization Architecture Blueprint) against the **current repository state**, verified by direct code inspection on 2026-07-18. Every row below is grounded in a real file; nothing here is inferred from documentation or memory.

---

## 0. Headline finding: three parallel, unreconciled tenancy systems

Before the dimension-by-dimension table, one structural fact has to be stated up front because it changes the shape of every milestone downstream:

The repository does not have **one** tenancy model with gaps. It has **three independent, non-communicating models** that each partially resemble "tenant":

| System | File | Hierarchy | Keyed by | Storage |
|---|---|---|---|---|
| Organization | `backend/services/organizationService.cjs` (631 lines) | Org → Department → Team → Member | `orgId` | `data/organizations.json` |
| Workspace | `backend/services/workspaceService.cjs` (281 lines) | Workspace → Member (flat) | `accountId` | `data/workspaces.json` |
| Billing | `backend/services/billingService.js` (313 lines) | none (single entity) | `accountId` | `data/billing.json` |

Organization and Workspace have **separate 6-role and 5-role RBAC ladders that do not map onto each other**, are enforced by two separate middleware files (`orgMiddleware.cjs` vs `workspaceMiddleware.cjs`), and neither references the other's ID anywhere in either service file. A user today can be `org_admin` in an Organization and simultaneously `Owner` of a Workspace that has no relationship to that Organization at all. Billing is scoped to a third identifier (`accountId`) that both Org and Workspace incidentally also carry, but billing enforces neither.

This means the blueprint's "Organization" node is not a gap to fill — it's a **merge**. The roadmap (M1) treats Workspace-into-Organization reconciliation as the first and highest-risk milestone, ahead of anything else, because every later milestone (billing, connectors, memory) assumes one coherent tenant identifier and today there are three candidates.

---

## 1. Organization Model

**CURRENT**: Real and functional. `organizationService.cjs` exports `createOrg/getOrg/listOrgs/updateOrg/deleteOrg`, `addMember/removeMember/updateMemberRole/listMembers/getMemberRole`, `createDepartment/updateDepartment/deleteDepartment/listDepartments`, `createTeam/updateTeam/deleteTeam/listTeams/addTeamMember/removeTeamMember`, `hasPermission`, `resolveContext`, `createMissionForOrg/listOrgMissions/assertMissionOwnership`. Org shape: `{id, name, description, slug, plan, createdAt, updatedAt, members[], departments[], settings{}}`. Storage is whole-file `_read()`/`_write()` (lines 73-80) — no atomic rename, no lock, every mutating call does a full read-modify-write of `data/organizations.json`.

**TARGET**: Same hierarchy (blueprint Sheet 0 explicitly reuses this shape). Add a super-scope role (`portfolio_owner`) and an Enterprise Account node one level above Organization.

**GAP**:
- No `portfolio_owner` / Founder-owns-many-orgs indexing (today you'd scan all orgs and filter by member).
- No Enterprise Account node.
- Whole-file JSON read-modify-write has no concurrency protection — a real correctness gap independent of the multi-org work (two simultaneous `addMember` calls can lose a write).
- Workspace model exists in parallel and is unreconciled (see §0).

**IMPACT**: Medium-high. The hierarchy itself doesn't need a rewrite — it needs an index, two new scope levels, and a decision about what "Organization" means relative to "Workspace" before anything else proceeds.

**RISK**: Low to change (additive), but **high if skipped** — every other milestone assumes this is settled first.

---

## 2. Workspace Model

**CURRENT**: A genuinely separate system, not a synonym for Department/Team. `workspaceService.cjs` (281 lines), `workspaceMiddleware.cjs`, `routes/workspace.js`, `data/workspaces.json`. Own 5-role ladder (`Owner > Admin > Operator > Developer > Viewer`), members, invitations, activity log — keyed by `accountId`. Wired into `security.js`, `automation.js`, `plugins.js`, `analytics.js`, `governance.js`, `extensions.js`, `admin.js`, `marketplace.js` via `attachWorkspace`/`requireRole`.

(Note: `ElectronWorkspace.jsx` is an unrelated frontend UI component name for the desktop code-editor tab panel — not this system. No relation, no action needed there.)

**TARGET**: In the blueprint, Workspace is a node *inside* Organization (Org → Workspace → Team → Project). The blueprint's Workspace and the repo's Workspace share a name and nothing else.

**GAP**: The real Workspace today is a **sibling** tenancy root to Organization, not a child of it. Reconciling this is not a rename — it requires deciding, for every existing Workspace row, which Organization it now belongs to (including creating a default/shim Organization for Workspaces that have none), and rewriting eight route files' middleware chains.

**IMPACT**: High. This is the single largest structural gap in the entire analysis — larger than connectors or billing — because it's not "add an org_id column," it's "merge two independently-evolved RBAC systems used by eight live route files."

**RISK**: High. Wrong reconciliation breaks existing Workspace-based access control silently (a user who is a Workspace Owner today could lose effective access, or worse, a permission check could fail open). Requires its own milestone (M1) with a dry-run/shadow-mode rollout, not a quick migration script.

---

## 3. RBAC

**CURRENT**: Org side is real: `ROLE_HIERARCHY` (organizationService.cjs:98-105) `org_owner:0 > org_admin:1 > dept_lead:2 > team_lead:3 > member:4 > viewer:5`; `ACTIONS` map (lines 108-128) covers 13 actions (`delete_org`, `update_org`, `manage_members`, `view_members`, `manage_departments`, `view_departments`, `manage_teams`, `manage_own_team`, `view_teams`, `create_mission`, `view_missions`, `assign_mission`, `manage_billing`, `view_analytics`). Enforcement via `orgMiddleware.cjs`: `attachOrg` (lines 20-42), `requireOrgMember` (44-48), `requireOrgPermission(action)` (50-60).

**Known defect, found during this analysis**: `attachOrg` resolves `orgId` from `X-Org-Id` header → query → body, and if none of those are present falls back to the requester's own org via `resolveContext`. Critically, when an `orgId` **is** supplied by the client, `attachOrg` sets `req.org` **before checking whether the requester is a member of it** (line 26) — `req.orgRole` is simply `null` in that case. Any route that reads `req.org` fields without also applying `requireOrgMember`/`requireOrgPermission` downstream leaks that org's metadata (name, settings, department/team names) to any authenticated user who guesses or enumerates an `orgId`. This is not a multi-org-readiness gap, it's a **present-day cross-tenant information leak** and should be triaged independently of this roadmap's timeline.

Workspace side has its own separate 5-role ladder with no shared code path with `orgMiddleware.cjs`.

**TARGET**: One role ladder extended with `portfolio_owner` and `enterprise_admin`, scoped per `(actor, org_id)` triple.

**GAP**: Two RBAC systems to merge into one; the `attachOrg` leak needs fixing regardless of the merge; permission checks need to become indexed triples rather than array-scans for performance at real scale.

**IMPACT**: High (security-adjacent).

**RISK**: The `attachOrg` leak is low-risk to fix (add a membership check before setting `req.org`, or split `req.org` into a public-safe summary vs. full record) and should be pulled forward ahead of the milestone sequence — see Phase 7 note in the roadmap.

---

## 4. Connector Model

**CURRENT**: Real, substantial (`integrationConnectors.cjs`, 1278 lines, 40 `connect*` functions across AI/Git/infra/payments/messaging/auth/productivity/commerce/creative/automation/monitoring). Credential resolution via `_env(k)` (lines 70-84): vault lookup first (`secretVault.cjs` `ENV_MAP` reverse index, vault key format `connectorId::type`), else `process.env[k]`. Confirmed by grep: **zero** `orgId`/`tenantId` parameters anywhere in the file (`MICROSOFT_TENANT_ID` at line 729 is Azure AD's own OAuth parameter, unrelated). `secretVault.cjs` keys secrets via `_vkey(connectorId, type)` → `` `${connectorId}::${type}` `` (line 105) — a flat, process-global key-value store, one `data/vault.json`, single global `JWT_SECRET`-derived encryption key.

**TARGET**: Per blueprint — Connector Type (shared code) stays global; Connector Instance becomes one row per `(org_id, connector_type)` with its own vaulted credentials and quota.

**GAP**: Every one of the 40 `connect*` functions needs an `orgId` parameter threaded through, and `_vkey` needs `orgId` folded in (`` `${orgId}::${connectorId}::${type}` ``) with a migration for existing vault entries (which org do today's single global credentials belong to?). No existing namespacing hook to repurpose — this is new surface area, not a modification of existing scoping.

**IMPACT**: High — this is the sharpest actual security boundary the blueprint calls for (Agency mode explicitly requires it), and today there is none.

**RISK**: Medium. Additive (wrap, don't rewrite, the 40 functions — see Connector Isolation Plan), but the vault key migration for pre-existing single-tenant deployments needs a defined default-org assignment or every self-hosted/Electron single-user deployment breaks on upgrade.

---

## 5. Billing Model

**CURRENT**: Real, account-scoped only. `billingService.js`, schema `{accountId, plan, status, trialStart, trialEnd, activatedAt, cancelledAt, razorpaySubId, updatedAt}`, storage `{ [accountId]: BillingRecord }` in `data/billing.json`. `PLAN_QUOTAS` (`trial:200, starter:2000, growth:10000, scale:null`). `checkUsageQuota(accountId)` filters `usageMetering.cjs` history by `accountId` within the current calendar month. **No `orgId` field anywhere in the file.**

**TARGET**: Ledger-based, entity-scoped billing (Account for Individual/Startup, Organization for Business, Enterprise Account for Enterprise) per blueprint's Billing Architecture sheet.

**GAP**: Billing has no concept of Organization at all today. A Business-mode org with 10 members currently has 10 independent trial/plan records, one per `accountId`, with no shared pool, no per-department cost allocation, and no way to bill "the org" as an entity.

**IMPACT**: High for revenue correctness once Startup/Business modes ship — without this, a company can't be sold one seat-based plan; each employee hits their own personal trial limit.

**RISK**: Medium. Additive schema change (add `orgId`, introduce org-level plan records), but requires a real decision on how existing account-level trial/paid customers map onto their first Organization — a silent default could double-bill or under-meter existing paying customers.

---

## 6. Storage Model

**CURRENT**: Flat JSON files under `data/` (408 files, ~270MB), whole-file read-modify-write pattern in most services (confirmed for `organizationService.cjs`; `integrationConnectors.cjs`/`secretVault.cjs` are better — they write to `.tmp` then `fs.renameSync` for atomicity, `organizationService.cjs` does not). One `better-sqlite3` instance exists (`backend/db/sqlite.cjs`) scoped only to a task queue table. No ORM in `package.json` (Express 5, `better-sqlite3 ^12.10.0`, no Sequelize/Prisma/TypeORM/Knex).

**TARGET**: Indexed, queryable, per-tenant-safe storage — the blueprint's Row → Namespace → Schema → Deployment isolation tiers all assume this exists.

**GAP**: This is the ceiling under everything else. A 270MB `organizations.json` rewritten wholesale on every member add will not survive real multi-org write volume, let alone hundreds of Enterprise child orgs.

**IMPACT**: Critical — this is a prerequisite for M1 onward at any real scale, though the earliest milestones can proceed on JSON if org/workspace counts stay low (see Migration Plan for the threshold reasoning).

**RISK**: This is the single highest-risk item in the whole program if attempted as a big-bang rewrite. The Migration Plan treats it as an incremental, table-by-table migration, not a platform cutover.

---

## 7. AI Agent Memory Model

**CURRENT**: Multiple independent, globally-scoped stores. `missionMemory.cjs` (756 lines) stores missions in `data/missions.json` with atomic writes; mission schema has a free-form `metadata` object but **no dedicated `org_id` field** — `createMission({objective, priority, metadata})` doesn't validate or require one. `knowledgeGraph.cjs` opportunistically reads `mission.metadata?.orgId` (lines 213, 420, 477) to build graph edges, but this is a caller convention, never enforced at write time. `assertMissionOwnership` in `organizationService.cjs` (lines 543-557) is the **only** place tenant isolation is actively enforced against mission data — everywhere else, org tagging is optional. Other memory services (`memoryPersistenceLayer.cjs`, `engineeringMemoryEngine.cjs`, `semanticMemorySearch.cjs`, `memoryIntelligenceEngine.cjs`) have zero org/account/tenant references. Storage: one giant global `data/memory-store.json` (72,880 lines), plus `memory-index.json`, `unified-memory-index.json` (indexed by id/blueprint/type/namespace — no tenant dimension).

**TARGET**: Per blueprint's AI Isolation model — Organization AI has memory reach limited to that org's mission/KB/history only; Shared AI templates clone with fresh per-org state.

**GAP**: Total. There is no enforcement point today preventing one org's mission memory from being read by another org's agent — the only thing standing between orgs is that nothing currently queries memory *without* also filtering by mission ID obtained through an already-org-scoped route. This is an implicit, accidental isolation, not a designed one.

**IMPACT**: Critical for trust — this is the scenario ("does my AI remember another company's data") that breaks a multi-org SaaS pitch instantly if wrong even once.

**RISK**: High effort, because it touches ~5 independent memory services and a 72,880-line global file, but the actual *code change* per service is a straightforward add-a-filter-field pattern — see AI Isolation Plan.

---

## 8. Knowledge Model

**CURRENT**: Real but fragmented across ~17 services (`knowledgeGraph.cjs`, `autonomousKnowledgeOrg.cjs` — the "AKO" 20-department system, `engineeringMemoryEngine.cjs`, plus ~13 more `data/knowledge-*.json` files). All flat, singular, global JSON files, organized by **topic/department taxonomy** (engineering, business, etc.), not by tenant. `knowledgeGraph.cjs` is the only file with any org awareness, via the same optional `mission.metadata.orgId` passthrough noted in §7.

**TARGET**: Org KB with department namespaces (Business mode); Enterprise KB with per-org namespaces and access-listed sharing; Agency "template KB" that clones into new client orgs then diverges independently.

**GAP**: One global knowledge pool today serves every user of the deployment. There is no per-org namespace at all — a Business-mode customer's proprietary knowledge and another customer's proprietary knowledge live in the same `data/knowledge-base.json`.

**IMPACT**: Critical, same class of issue as §7 — this is customer data commingling, not a UX gap.

**RISK**: High effort (17 services), but namespacing is additive per-service; the harder problem is the retroactive question of "whose knowledge is already in that global file" for any deployment that has existing data — addressed in the Migration Plan as requiring manual/assisted triage, not an automated script, for pre-existing installs.

---

## 9. Deployment Model

**CURRENT**: Single-process, single-tenant-per-deployment, and — critically — **architecturally locked to that shape today**. `ecosystem.config.cjs` (PM2) hardcodes `instances: 1` with an explicit comment: in-process singletons (`taskQueue`, `learningSystem`, `contextEngine`) are **not cluster-safe** and instances must never exceed 1. `Dockerfile.production` + `docker-compose.prod.yml` run one backend container, one nginx proxy, one shared `data/` volume. `.env.example` has exactly one credential per connector type (one `GROQ_API_KEY`, one `RAZORPAY_KEY_ID`, etc.) — consistent with the connector findings in §4. The app also ships as a single-user Electron desktop build from the same codebase.

**TARGET**: Blueprint's isolation tiers go as far as "dedicated infrastructure per org" for the largest Enterprise/future Government accounts — which assumes horizontal scalability is at least possible.

**GAP**: It currently is not. The PM2 comment is a hard ceiling: in-process singleton state (not just config) blocks running more than one instance of this backend at all, which blocks even simple load-balanced scaling, independent of multi-org concerns.

**IMPACT**: High, but **not on the critical path for M1-M6** — Row-tier isolation (the tier every mode except large Enterprise needs) works fine on a single instance. This gap only bites when Enterprise-tier Schema/Deployment isolation or horizontal scaling for load (not tenancy) is attempted.

**RISK**: Deferred risk — flagged here so it isn't discovered late, but the roadmap sequences it last (M8+) rather than blocking early milestones on a singleton-state refactor nobody needs yet.

---

## Gap Severity Summary

| # | Area | Impact | Risk | Blocks other milestones? |
|---|---|---|---|---|
| 0 | Workspace/Org reconciliation | High | High | Yes — blocks nearly everything |
| 1 | Organization model extensions | Medium-High | Low | Blocks Founder/Enterprise modes |
| 2 | Workspace model | High | High | See #0 |
| 3 | RBAC merge + `attachOrg` leak | High | Low (leak fix) / Medium (merge) | Leak: fix independently, now |
| 4 | Connector isolation | High | Medium | Blocks Agency mode, safe billing |
| 5 | Billing org-scoping | High | Medium | Blocks Business/Enterprise billing |
| 6 | Storage substrate | Critical | Critical if big-banged | Ceiling on all of the above at scale |
| 7 | AI memory isolation | Critical | High (breadth) | Blocks any real multi-tenant trust claim |
| 8 | Knowledge isolation | Critical | High (breadth) | Same as #7 |
| 9 | Deployment/horizontal scale | High | Deferred | Not on critical path short-term |
