# B.21 — Real Company Simulation Certification

**Branch:** `security/reality-completion`
**Baseline HEAD:** `6863391a49c09cea089f86e004b28c4fc4d928ee`
**B.21 commit:** `35d4daa2`
**Date:** 2026-08-13
**Scope:** Audit + recovery only. No merge. No push. `.env` untouched.

---

## 1. Executive summary

Ooplix was operated as a real company end-to-end. The company was created
through the **real signup flow** — no forged tokens, no seeded fixtures — and a
second real company was created alongside it so that every isolation claim
below is measured between two genuinely separate tenants.

The core lifecycle works: organization → departments → teams → leads → qualify →
deals → campaigns → support → billing → executive reporting, all persisting
across a backend restart and correctly scoped to the owning company.

**Two cross-tenant data leaks were found and fixed.** Both were invisible to
single-tenant testing and only appeared because two real companies were run
side by side:

1. **Business pipeline reported a platform-wide total as the company's own.**
   Both companies saw the identical figure `lead: 17` — belonging to neither.
2. **Support tickets were global, plus a direct IDOR.** Both companies received
   the *same* 50-ticket list, containing other tenants' tickets and neither
   company's own; any ticket could be read by id across tenants.

The AI path is **CREDENTIAL BLOCKED** and fails honestly (502, "Check provider
API keys"), never fabricating output. Two capability gaps are disclosed rather
than built.

---

## 2. Company used

| Field | Atlas Works (subject) | Borealis Rival Co (isolation control) |
| --- | --- | --- |
| Account | `4623bcf56b87c066c0f950c3` | created via same flow |
| Email | `founder@atlasworks-sim.test` | `rival@borealis-sim.test` |
| Organization | `org_1786639353429_2` | `org_1786639393105_7` |
| Workspace | `ws_1786639353372_d860cd1c` | `ws_1786639393050_6513a10e` |
| Departments | Engineering, Sales | — |
| Teams | Platform Team (under Engineering) | — |
| Role | `org_owner` | `org_owner` |

Created with `POST /accounts/register` → `POST /api/auth/login` (real cookie
session) → `POST /workspace` → `POST /orgs` → `POST /orgs/:id/departments` →
`.../teams`.

---

## 3. Workflow trace

| # | Phase | Route(s) | Observed | Status |
| --- | --- | --- | --- | --- |
| 1 | Company tenant | `/accounts/register`, `/api/auth/login`, `/workspace`, `/orgs` | Account `201`, login `200` + `jarvis_auth` cookie, org + workspace + 2 depts + 1 team created | **PRODUCTION READY** |
| 1 | Persistence | restart backend, re-read | Org, both departments, team and workspaces all survived | **PRODUCTION READY** |
| 1 | Isolation | cross-tenant reads | 403 on org, departments, workspace members; lists exclude the other company | **PRODUCTION READY** |
| 2 | Company setup | `PATCH /orgs/:id`, `/orgs/:id/members`, `PATCH /accounts/me` | Profile updates persisted; owner role correct | **PRODUCTION READY** |
| 5 | CRM leads | `POST /crm/lead`, `GET /crm/leads` | 3 leads created; Atlas sees exactly 3 of 64 global records; Borealis sees 0 | **PRODUCTION READY** |
| 5 | Sales lifecycle | `/business/leads`, `/qualify`, `/disqualify` | 2 qualified (with `qualifiedAt`), 1 disqualified — real state transitions | **PRODUCTION READY** |
| 5 | Deals | `POST/GET /business/deals` | Created and read back with correct value/stage/orgId | **FIXED** (was leaking) |
| 6 | Marketing | `POST/GET /business/campaigns` | Campaign created and persisted, org-scoped | **PRODUCTION READY** (creation) |
| 6 | Delivery | — | No send attempted — no channel credentials configured | **CREDENTIAL BLOCKED** |
| 8 | Support | `/customer-org/support/ticket`, `/tickets` | Ticket created, listed, scoped; IDOR closed | **FIXED** (was leaking) |
| 9 | Finance | `/billing/status`, `/business/revenue` | `plan:trial, status:trialing, daysLeft:7`; revenue `total:0` honestly empty | **PRODUCTION READY** (read) |
| 11 | AI | `POST /ai/chat` | `502 {"error":"AI backend unavailable. Check provider API keys…"}` | **CREDENTIAL BLOCKED** |
| 12 | Executive | `/business/dashboard`, `/business/stats` | Atlas `leads:6, campaigns:1`; Borealis `0,0`; global store 66 | **PRODUCTION READY** |

---

## 4. Bugs found and fixed

### B21-F1 — Business pipeline showed a platform-wide total as the company's own
**Classification: FIXED · Severity: high (cross-tenant disclosure)**

**Reproduced live.** Two separate companies, same response:

```
ATLAS    bizMissions: {"lead":{"total":17,...}}
BOREALIS bizMissions: {"lead":{"total":17,...}}
```

Neither company had 17 leads (Atlas had 3, Borealis 0).

**Root cause.** `GET /business/pipeline` combined two blocks with different
scoping:

```js
const pipeline    = bds.getPipelineSummary(req.org.id);  // org-scoped
const bizMissions = bem?.getPipelineSummary?.() || {};   // NO org argument
```

`businessEntityModel.getPipelineSummary()` read
`missionMemory.listMissions({ limit: 1000 })` with no tenant filter. It could
not scope even in principle: **285 of 285 business missions in the live store
carried no `orgId` at all** (verified directly against `data/missions.json`).

The figure was also a *windowed* platform total — `limit: 1000` over a
2,082-mission store — so it was misleading twice over.

**Fix (minimal, existing mechanism).** Stamp `orgId` into the mission metadata
that already exists, at creation; filter on it when reading:

- `createBusinessMission()` — stamps `opts.orgId || entity.orgId`
- `getPipelineSummary(orgId)` / `listBusinessMissions({orgId})` — filter
- 4 create routes + 4 list routes pass `req.org?.id`

Legacy rows with no `orgId` are **excluded** from a scoped read rather than
attributed to whoever asks.

**Live re-verification:**
```
ATLAS sees   : ATLAS-deal[3429_2], b21-eviction-probe[3429_2]
BOREALIS sees: BOREALIS-deal[3105_7]
NO LEAK — each org sees only its own deals
```

---

### B21-F2 — Support tickets were global, plus a direct IDOR
**Classification: FIXED · Severity: high (cross-tenant disclosure + IDOR)**

**Reproduced live:**

```
ATLAS sees tickets   : 50
BOREALIS sees tickets: 50
identical lists?     : true
Atlas ticket customerIds: ["support_test_1","support_test_2","escalation_test",…]
```

Both companies received the same 50 tickets, belonging to other tenants, and
**neither company's own ticket appeared**.

**Root cause.** Two independent defects:
- `customerSupportEngine.createTicket()` accepted no tenant field, so tickets
  carried none; `listTickets()` applied no org filter.
- `routes/customerOrg.js` mounted only `requireAuth` — `attachOrg` never ran,
  so no org was available to scope by.
- `getTicket(id)` was a straight IDOR: any authenticated caller could read any
  ticket by id.

**Fix.** `attachOrg` added to the router — this **verifies real membership**
(`req.orgRole`), so a forged `X-Org-Id` header cannot widen access; `orgId`
stamped on tickets; list filtered; id-fetch returns **404** (not 403, so it
does not confirm the ticket exists).

**Live re-verification:**
```
ATLAS list   : 1 -> cst_1786640982511_omyl
BOREALIS list: 1 -> cst_1786640982615_i3d4
BOREALIS fetching ATLAS ticket by id: 404 {"ok":false,"error":"ticket not found"}
```

---

## 5. Cross-OS data map (Phase 13)

Traced the same company across OSes. **Similarly named entities are not the
same entity** — this was measured, not assumed:

| Layer | Canonical store | Tenant key | Atlas count |
| --- | --- | --- | --- |
| CRM lead | `data/leads.json` (`crmService`) | `orgId` on record | 3 |
| Business lead | `businessDataService` | `orgId` | 3 |
| Business **deal** | `missionMemory` (mission with `metadata.entityType="deal"`) | `metadata.orgId` *(added by B21-F1)* | 2 |
| CRM **deal/opportunity** | `businessDataService` opportunities | `orgId` | 0 |
| Campaign | `businessDataService` | `orgId` | 1 |
| Support ticket | `customerSupportEngine` | `orgId` *(added by B21-F2)* | 1 |
| Executive dashboard | derives from `businessDataService` | `req.org.id` | leads 6, campaigns 1 |

**Two genuinely separate deal models exist.** `GET /business/pipeline` returns
`pipeline` (CRM opportunities — 0 for Atlas) beside `bizMissions.deal`
(mission-layer — 2 for Atlas). This is a **legitimate separate data model**,
documented in the source as "Mission-layer aliases", not a bug — but the two
are easily mistaken for one another, and the unscoped half was the leak in
B21-F1.

---

## 6. Tenant isolation evidence

All measured between two real companies.

| Check | Result |
| --- | --- |
| Cross-org read (`GET /orgs/:otherId`) | **403** "Not a member of this organization" |
| Cross-org departments | **403** "requires permission: view_departments" |
| Cross-workspace members | **403** "Not a member of this workspace" |
| Workspace list | Atlas 2, none belonging to Borealis |
| Org list | Atlas 2, none belonging to Borealis |
| CRM leads | Global store 64; Atlas sees 3; Borealis sees 0 and none of Atlas's |
| Business deals *(after fix)* | Atlas 2 own, Borealis 1 own, no overlap |
| Support tickets *(after fix)* | Atlas 1 own, Borealis 1 own (was 50 identical) |
| Ticket IDOR *(after fix)* | **404** across tenants |
| Executive dashboard | Atlas `6/1/0`, Borealis `0/0/0`, global 66 — **no global total shown as a company total** |

---

## 7. Persistence evidence

Backend restarted (`kill` + relaunch) mid-simulation:

```
org survives  : 200 Atlas Works Simulation
depts survive : 200 Engineering(1 teams), Sales(0 teams)
workspaces    : 200 ["Atlas Works Founder's Organization","Atlas Works Simulation"]
```

CRM leads, business leads, qualification states, campaign and support ticket
all re-read correctly after restart.

---

## 8. Credential blockers

| Capability | Blocker | Evidence |
| --- | --- | --- |
| AI generation / agent output | No provider API keys | `502 {"error":"AI backend unavailable. Check provider API keys in your .env file."}` — honest, no fabricated reply |
| Marketing delivery (email/SMS/WhatsApp/push) | No channel credentials configured | No send attempted. **No campaign is reported as "sent."** |
| Payment execution | Would create an external side effect | Not executed — read-only billing state verified only |

A credential blocker is **not** counted as a code failure.

---

## 9. Genuine gaps (disclosed, not built)

### G1-B21 — Logout does not invalidate the session server-side
`POST /api/auth/logout` returns 200 and calls `res.clearCookie`, but the JWT
remains valid. **Measured: a retained cookie still returned 200 on a protected
route after logout.** Auth is stateless with an 8-hour expiry
(`TOKEN_EXPIRY = 8 * 60 * 60`) and there is no denylist, session store, or
token-version mechanism anywhere in `authMiddleware.js` / `auth.js`.

Closing this requires a revocation mechanism — new architecture, which this
phase forbids. **Disclosed, not built.**

### G2-B21 — Mission store evicts records under a terminal cap
`missionMemory` caps terminal missions at `MAX_TERMINAL_MISSIONS = 1000`, and
the store is exactly at that limit (live: 1,091 live + 1,000 terminal).
Business missions created during the simulation were observed disappearing from
`GET /business/deals` between reads, because reads use a 500-record window and
each deal spawns sub-missions that push older records out.

This is **existing, deliberate retention behaviour** (documented in-source as a
B.1 fix for a 483 ms event-loop stall), not a defect introduced here — but it
means mission-backed business records are **not durable** as a system of record.
**Disclosed.**

---

## 10. Regression

| Suite | Before B.21 | After B.21 |
| --- | --- | --- |
| `npm run test:runtime` | **144 / 144** | **144 / 144** — unchanged |
| `30-b20-chaos-recovery` | 8/8 | **8 / 8** |
| `31-b21-business-tenant-scoping` (new) | — | **8 / 8** |
| `32-b21-support-tenant-scoping` (new) | — | **7 / 7** |
| `25 / 27 / 28 / 29` (a11y) | 9/16/14/12 | unchanged |
| `26-accessibility-foundation` | 21/22 | 21/22 — pre-existing `G1-B193` |

No existing test modified, weakened, or skipped.

### Negative testing

Both new guards were proven to fail against un-fixed code:

| Guard | With fix | Fix removed |
| --- | --- | --- |
| Business tenant scoping | 8 pass / 0 fail | **6 pass / 2 fail** |
| Support tenant scoping | 7 pass / 0 fail | **5 pass / 2 fail** |

---

## 11. Capability matrix

| Area | Status | Evidence |
| --- | --- | --- |
| A. Company setup | **PRODUCTION READY** | Org/dept/team created, persisted, isolated |
| B. Product lifecycle | **UNKNOWN** | Not exercised — Product OS routes not driven in this run |
| C. Engineering lifecycle | **CREDENTIAL BLOCKED** | Plan→patch requires AI generation (502) |
| D. Sales lifecycle | **FIXED** | Leads→qualify→deals works; deal view was leaking, now scoped |
| E. Marketing lifecycle | **PARTIAL** — created/persisted **PRODUCTION READY**; delivery **CREDENTIAL BLOCKED** | Campaign persisted; no send attempted |
| F. Customer lifecycle | **VERIFY** | Journey/health endpoints exist but were not driven end-to-end |
| G. Support lifecycle | **FIXED** | Create/list/get scoped; IDOR closed |
| H. Finance lifecycle | **PRODUCTION READY** (read) / **BLOCKED** (execution) | Billing state real; no money moved |
| I. Automation | **UNKNOWN** | Not exercised in this run |
| J. AI/Agent/Mission | **CREDENTIAL BLOCKED** | Honest 502 |
| K. Executive reporting | **PRODUCTION READY** | Per-company totals, no global bleed |
| L. Cross-OS consistency | **PRODUCTION READY (documented)** | Two deal models identified and mapped |
| M. Tenant isolation | **FIXED** | 2 leaks closed, 10 checks pass |
| N. Persistence | **PRODUCTION READY** | Survives restart |
| O. Failure honesty | **PRODUCTION READY** | No fabricated success observed anywhere |
| P. Credential blockers | 3 recorded | §8 |
| Q. Genuine gaps | 2 recorded | §9 |

---

## 12. Score

| Dimension | Score | Basis |
| --- | --- | --- |
| Company setup | **10 / 10** | Full hierarchy, persisted, isolated |
| Sales lifecycle | **9 / 10** | Complete; one leak found and fixed |
| Support lifecycle | **9 / 10** | Complete; leak + IDOR found and fixed |
| Executive reporting | **10 / 10** | Per-company, no global bleed |
| Tenant isolation | **8 / 10** | 2 real leaks existed at baseline; now closed and guarded |
| Persistence | **10 / 10** | Survives restart |
| Failure honesty | **10 / 10** | No fabricated success in any probe |
| Cross-OS consistency | **8 / 10** | Mapped and documented; two deal models remain easy to confuse |
| Marketing / Finance / AI | **NOT SCORED** | Credential blocked |
| Product / Automation / Customer | **NOT SCORED** | Not exercised — UNKNOWN, not assumed passing |
| **Overall B.21** | **7.5 / 10** | |

**Not higher, deliberately.** Three areas (Product, Automation, Customer
lifecycle) were **not exercised** and are recorded UNKNOWN rather than assumed
working; three more are credential-blocked. Scoring unobserved workflows would
be fabricating a result.

---

## 13. Certification

> **CERTIFIED WITH LIMITATIONS — 7.5 / 10.**
>
> Ooplix genuinely operates the scoped company lifecycle: a real company was
> created, staffed, given customers, progressed through a sales pipeline,
> supported, billed and reported on — with data persisting across restart and
> correctly scoped to its owner.
>
> Certification is **limited**: two cross-tenant leaks existed at baseline and
> were only found by running two real companies side by side; three capability
> areas were not exercised (UNKNOWN); three are credential-blocked; and two
> genuine gaps (server-side logout invalidation, mission-store eviction) remain
> disclosed and unbuilt.

---

## B.21 STATUS

```
Company:               PRODUCTION READY — org/dept/team created, persisted, isolated
Product:               UNKNOWN — not exercised
Engineering:           CREDENTIAL BLOCKED — AI generation unavailable
Sales:                 FIXED — lifecycle works; cross-tenant deal leak closed
Marketing:             PARTIAL — creation READY, delivery CREDENTIAL BLOCKED
Customer:              VERIFY — endpoints exist, not driven end-to-end
Support:               FIXED — ticket lifecycle works; leak + IDOR closed
Finance:               PRODUCTION READY (read) / BLOCKED (execution)
Automation:            UNKNOWN — not exercised
AI:                    CREDENTIAL BLOCKED — honest 502, no fabrication
Executive:             PRODUCTION READY — per-company totals, no global bleed
Cross-OS consistency:  PRODUCTION READY — two deal models mapped and documented
Security:              FIXED — 2 cross-tenant leaks + 1 IDOR closed, membership-verified
Regression:            144/144 unchanged · 23/23 new · both guards negative-tested
Score:                 7.5 / 10
Confidence:            HIGH on what was measured; UNKNOWN is recorded, not assumed
Certification:         CERTIFIED WITH LIMITATIONS
Remaining blockers:    G1-B21 logout does not invalidate server-side (8h JWT, no denylist)
                       G2-B21 mission store evicts at 1000 terminal records
                       AI / marketing delivery / payment execution — credentials
                       Product, Automation, Customer lifecycle — UNKNOWN, need a run
```

---

*Phase B.21 · Ooplix V1 · Confidential*
