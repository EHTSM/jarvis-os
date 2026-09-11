# OS-CIVILIZATION-DISCOVERY — What "Civilization OS" Actually Is

**Date:** 2026-08-15
**Scope:** Dedicated investigation per 25-OS Master Reconciliation, row 23 (Civilization OS).
**Method:** Full read of the route file and all three backing services, live execution of the
existing test suite, live inspection of the accumulated data files, and a full trace of every
mount point / auth gate / frontend consumer. No server was left running on a non-standard port;
port 5050 (pre-existing dev server, PID 45392) was never touched — confirmed both before and after.

---

## 1. What exists in code (full inventory)

### Route file
`backend/routes/civilizationOrg.js` — 151 lines, 62 route handlers. Requires three services lazily:

- `backend/services/civilizationOrg.cjs` (352 lines) — the **20-domain autonomous agent registry**
  ("Level 9"). Each domain (`civ_registry`, `civ_council`, `civ_governance`, `civ_constitution`,
  `civ_policy`, `civ_economy`, `civ_resource_exchange`, `civ_knowledge_network`,
  `civ_mission_network`, `civ_reputation`, `civ_trust`, `civ_diplomacy`, `civ_collaboration`,
  `civ_arbitration`, `civ_innovation`, `civ_research`, `civ_evolution`, `civ_analytics`,
  `civ_health`, `civ_director`) is a background tick registered with `agentRuntimeSupervisor`, firing
  every 180–600 seconds, forever, once the process starts.
- `backend/services/civilizationState.cjs` (976 lines) — the actual data model: members, alliances,
  council/proposals/votes, constitution (articles/amendments/precedents), economy (balances/trades/
  resource pools), network (channels/mission routes/knowledge routes/collaborations), reputation
  (scores/endorsements/badges), diplomacy (treaties/disputes/arbitrations/negotiations), innovation
  (research projects/innovations/evolution proposals), KPIs, memory, reports.
- `backend/services/civilizationWorkflow.cjs` (314 lines) — a 6-step pipeline
  (Intake → Governance → Resource Allocation → Ecosystem Dispatch → Cross-Org Coordination → Report)
  plus `negotiateBetweenOrgs`, `delegateToMember`, and `bootstrapCivilization` (seeds 6 constitutional
  articles + 5 channels on first registration).

### Data storage
Flat JSON files under `data/civilization/*.json` — **one single global dataset**, not per-tenant:
`registry.json`, `council.json`, `constitution.json`, `economy.json`, `network.json`,
`reputation.json`, `diplomacy.json`, `innovation.json`, `kpis.json`, `memory.json`, `reports.json`,
`context.json`. No sharding by `orgId`/`tenantId`/`accountId` — one flat in-process cache, written
straight to disk on every mutation.

### Mounting / auth
`backend/routes/index.js:166-167`:
```js
router.use("/civ", requireAuth);                 // gate all /civ/* routes
router.use(require("./civilizationOrg"));         // Level 9: /civ/status /civ/summary /civ/agents/:id /civ/v9/*
```
Routes ARE mounted and reachable (this was verified directly — my first pass assumed they weren't,
because no single-file grep for `routes/civilizationOrg` matched; the barrel file's `require("./civilizationOrg")`
uses the directory-relative bare specifier and only turned up on reading `routes/index.js` in full).
`requireAuth` means any authenticated user of any tenant can call every one of these 62 endpoints —
the same pattern as its Level 6/7/8 siblings (`eos`, `ent`, `eco`). There is **no tenant-derivation**
anywhere in `civilizationState.cjs` — `registerMember` accepts an optional free-text `tenantId` field
the caller can set to anything (or omit), but nothing in any handler filters reads/writes by the
calling user's own org. This is not a tenant-isolation bug in the traditional sense (like the P0s
found on Product OS or Customer Org) — it's that **the whole surface has no concept of "this tenant's
civilization" at all**. There is one civilization, globally, shared by every authenticated account.

### Server startup
`backend/server.js:1201-1207` registers the 20 background tick agents unconditionally on every server
boot (non-fatal try/catch, like all L6-L10 org levels):
```js
const civOrg = require('./services/civilizationOrg.cjs');
const civResult = civOrg.register();
```
This has been running continuously since the CIV V9 build (per file timestamps, since ~June 27) on
every server restart. `civ_director`'s tick (every 3 minutes) auto-delegates the oldest open mission
to the highest-reputation member — this is why `network.json` has grown to **12,116 `missionRoutes`
records** (7.6 MB) and `data/civilization/*.json` totals ~24 MB, entirely self-generated background
noise, not user activity.

### Frontend
`frontend/src/components/OrgLevelStatus.jsx` is a **generic, read-only status viewer** shared by all
six "org level" surfaces (Knowledge L4, Executive L6, Enterprise L7, Ecosystem L8, Civilization L9,
Autonomous L10). It fetches `/civ/summary` and `/civ/status` and renders a key-value grid + an agent
table. Its own code comment states the intent plainly:

> "V6-V10 Production Realization: executiveOrg/enterpriseOrg/ecosystemOrg/civilizationOrg/autonomousOrg
> ... had zero frontend surface. One reusable component instead of 5 near-identical dashboards..."

This is wired into `App.jsx` as a real command-palette-searchable tab (`orglevel-civ`, line 1579:
`{tab === "orglevel-civ" && <OrgLevelStatus level="civ" />}`). So the claim "Not confirmed" in the
25-OS master inventory row is now resolved: **there is a real, working frontend surface**, but it is
explicitly and only a read-only diagnostic dashboard — 20 rows of "agent running / stopped" plus
whatever top-level scalar fields the summary happens to expose. There is no UI for registering a
member, voting on a proposal, proposing a trade, opening a negotiation, or any of the ~50 other
mutating actions the backend supports. A tenant using the product has no path to any of this beyond
that one read-only tab.

---

## 2. Who actually writes this data

545 "members" exist in `registry.json`. Their names are exclusively synthetic test-fixture patterns:
`OrgA-<timestamp>`, `OrgB-<timestamp>`, `AgencyA-<timestamp>`, `BlueprintA-<timestamp>`,
`BPClone-<timestamp>`, `AutoCaps-<timestamp>`, `LowRep-<timestamp>`, etc. — 20 distinct naming
templates, each suffixed with a millisecond timestamp. This is the output of
`tests/runtime/civ-v9.test.cjs` (813 lines, 115 assertions) being run repeatedly over time, with no
test-data cleanup and no test isolation from the real `data/civilization/*.json` files the live
server also reads from. Every test run permanently adds ~5-10 more synthetic members to the same
files a real tenant's `requireAuth`-gated session would read from. This was independently confirmed
in this pass: running the suite live added new `OrgA-<newtimestamp>` entries to the same files.

There is no evidence in git history, mission memory, or the data itself of a single real founder,
tenant, or customer ever calling any `/civ/v9/*` endpoint with real business intent.

---

## 3. Live verification performed

- **Full read** of `civilizationOrg.js` (route file), `civilizationOrg.cjs`, `civilizationState.cjs`,
  `civilizationWorkflow.cjs` — all in full, not sampled.
- **Live test run**: `node tests/runtime/civ-v9.test.cjs` — **114/115 passed**. The one failure
  (`addConstitutionalArticle — ok: FAIL: addArticle failed: Article 100 already exists`) is a
  test-fixture collision from the shared-file problem above (a prior run already created "Article
  100"), not a logic defect — confirms the backend logic is functionally sound in isolation, and
  also independently confirms the shared-file contamination mechanism described in §2.
- **Mount/auth trace**: confirmed routes are live-mounted behind `requireAuth` (not `operatorOnly`,
  not tenant-scoped) — same posture as sibling L6-L8 org levels.
- **Frontend trace**: confirmed real, working, but exclusively read-only tab wiring via
  `OrgLevelStatus.jsx` + `App.jsx`.
- **Data model trace**: confirmed zero per-tenant partitioning anywhere in `civilizationState.cjs`;
  confirmed the 545 members / 12,116 mission routes are 100% synthetic/self-generated, not real usage.
- **Port discipline**: no server was started for this investigation beyond what already exists.
  Port 5050 (PID 45392, pre-existing) confirmed listening before and after via `lsof -i :5050` — same
  PID both times, no other process bound. No isolated port (5304) was needed since the test suite
  runs the services in-process without an HTTP server. `.env` untouched (git status clean).
- **No code was modified.** `git status` on all four civilization source files shows zero diff before
  and after this investigation.

---

## 4. What Civilization OS actually is, in plain terms

It's the ninth rung of a ten-level "OOPLIX Level" architecture (Executive L6 → Enterprise L7 →
Ecosystem L8 → **Civilization L9** → Autonomous L10) built during a June 2026 sprint sequence whose
own naming ("Level 9: 20 domains... member federation, council/constitution/economy/diplomacy/
innovation... commit 5a019fe") describes a simulated inter-organization confederation: a governance
layer for a hypothetical world where multiple AI-run companies ("members") federate, vote, trade
resources, sign treaties, and publish research to each other. Every domain concept (Council,
Constitution, Economy, Diplomacy, Innovation) targets **relationships between organizations**, not
anything a single tenant does inside their own company.

It was built as pure backend + a 115-test verification suite, with **no accompanying product
decision** about which real tenant workflow it serves. The one frontend touchpoint it later received
(this session's predecessor session, per the code comment) was explicitly scoped as "give the
already-built backend infrastructure *some* visibility, not build a product for it" — a read-only
diagnostic view, not a feature.

There is no evidence anywhere — not in the code, not in mission memory, not in the data, not in the
frontend — of an intended real-tenant use case: no signup flow into a "civilization," no plan/tier
that unlocks it, no onboarding, no way for a founder using the product to form an alliance or ratify
a treaty as an actual UI action. The `/civ/v9/command` full pipeline exists and works (verified: 6/6
steps pass in the test suite), but nothing in the product calls it — it is reachable only by a raw
authenticated HTTP client, i.e. by another developer or by an internal test.
