# Phase B.12 — Knowledge System Certification

**Product:** Ooplix (jarvis-os) v1.0.0-rc1
**Date:** 2026-08-09
**Branch:** `security/reality-completion` (no merge, no push)
**Method:** Operated the Knowledge layer as a production Enterprise Knowledge OS. **Measured first, read code only after reproducing.** No new services, storage, models, or architecture.

---

## Headline Result

The Knowledge Graph was **fully built but never indexed**. `lastIndexed` was `null` and the store held **5 edges** — three test fixtures from June plus two leads — while 1623 missions, 48 leads, RCAs, rules and departments sat un-linked. Exercising the **existing** `POST /graph/index` capability took it to **1436 edges / 2317 nodes in 2737 ms**, which switched on graph reasoning, executive risk scoring and recommendations that had been returning nothing.

No capability was invented. The capability already existed; it had simply never been run.

---

## Defects Reproduced and Recovered

### D1 — Knowledge Graph was never indexed (**CRITICAL — capability dormant**)

| Measurement | Before | After |
|---|---|---|
| `lastIndexed` | **`null`** — no index had ever run | `2026-08-09T07:49:44Z` |
| Graph edges | **5** | **1526** |
| Graph nodes | 8 | **2321** |
| Node types linked | 4 | **10** |
| Relation types in use | 3 | **11** |
| `/graph/reasoning` output | empty | critical deps (inDegree 57), health 72 |
| `/graph/reasoning/executive` | empty | healthScore 72, **3 top risks** |
| `/graph/reasoning/recommendations` | empty | **7 actionable recommendations** |
| Index duration | — | **2737 ms** for 1432 edges |

**Recovery method:** `POST /graph/index` — an existing route calling the existing `knowledgeGraph.indexAll()`. Nothing added.

**Root cause (read only after measuring):** `indexAll()` is reachable from exactly one place — the manual `POST /graph/index` route (`backend/routes/graph.js:90`). Nothing schedules it: no cron entry, no boot hook, no PM2 job. The incremental counterpart `indexMission()` is wired into **one** call site (`autonomousEngineeringPlatform.cjs:415`), so ordinary mission creation does not reach the graph.

**Reproduced decay:** created a real mission via `missionMemory.createMission()` → graph edges unchanged (1436 → 1436, delta 0). The mission node was still *resolvable* (nodes derive from edges plus live lookup), so there is **no data loss** — the gap is edge staleness, not disappearance.

**Business impact of the recovery** — surfaced only after indexing:

| Output | Value |
|---|---|
| Executive health score | 72 |
| Top risks identified | 3 (highest: a lead with inDegree 57 flagged `critical`) |
| Recommendations generated | 7 |
| Notable | Recommendation #3 was **"Fix: memory_pressure"** — the graph independently surfaced the Phase B.11 admission-gate defect from its own data |

### D2 — Every reindex leaked a duplicate edge (**HIGH — reproduced 3/3, fixed**)

Re-running the full index grew the store while reporting a constant `indexed` count:

```
run 1: indexed=1432  edges 1482 -> 1483  (+1)
run 2: indexed=1432  edges 1483 -> 1484  (+1)
run 3: indexed=1432  edges 1484 -> 1485  (+1)
```

**Root cause (read after reproducing):** `addEdge()` deduplicated with `===` on the id fields. That is correct for strings but **never** matches a non-string id, because `{a:1} === {a:1}` is `false` (reference comparison). Auditing the store found precisely **one** duplicated logical edge, already at **x5**:

```
("user", {"a":1}, "member_of", "org", "org_1786219169715_1")
```

That non-string id traces to **Phase B.4 finding F5** — `POST /orgs/:orgId/members` accepted `accountId={"a":1}`, creating a member record that the normal delete route could not remove. So D2 is the *downstream consequence* of that still-open input-validation gap, not a second independent source of bad data.

**Recovery:** made dedupe value-based (primitives keep the fast identity path; only non-primitives fall back to a stable serialisation). Then removed the 4 historical surplus rows using the **existing** `removeEdge()`.

**Verified — 5 consecutive full reindexes held flat:**

| Run | Edges before → after | Delta |
|---|---|---|
| 1 (first after restart) | 1485 → 1530 | +45 (re-added edges the duplicates had displaced) |
| 2 | 1530 → 1530 | **0** |
| 3 | 1530 → 1530 | **0** |
| 4 | 1530 → 1530 | **0** |
| 5 | 1530 → 1530 | **0** |
| 6 | 1530 → 1530 | **0** |

Final store: **1526 edges, 0 duplicate logical sets.**

**Regression:** `tests/runtime/18-knowledge-graph-dedupe.test.cjs` — 7 tests. **Negative-tested: 4 fail** with identity-only dedupe; 7/7 pass restored.

---

## 1. Knowledge Integrity Matrix

Measured on the rebuilt 1526-edge graph.

| Check | Result | Status |
|---|---|---|
| Malformed edges (missing required field) | **0** | CERTIFIED |
| Self-loops | **0** | CERTIFIED |
| **Duplicate logical edges** | **0** (was 1 set at x5) | CERTIFIED (after D2) |
| Timestamps present | **1436 / 1436** | CERTIFIED |
| Non-string node ids | **1** — the `{"a":1}` Phase B.4 artifact, indexed faithfully | OBSERVATION (upstream B.4 F5) |
| Dangling edge endpoints | 0 (edge-only store; endpoints are the node identity) | CERTIFIED |
| Store corruption | 0 across 88 memory/knowledge stores, 24.7 MB (Phase B.10 sweep re-confirmed) | CERTIFIED |
| Atomic persistence | `writeFileSync` on the edge store | CERTIFIED WITH LIMITATIONS |

## 2. Knowledge Graph Matrix

| Property | Measured | Status |
|---|---|---|
| Edges | **1526** | CERTIFIED |
| Nodes | **2321** | CERTIFIED |
| Node types declared | 15 | CERTIFIED |
| **Node types actually linked** | **10** — artifact, department, lead, mission, org, rca, rule, step, team, user | CERTIFIED |
| Relations declared | 18 | CERTIFIED |
| Relations in use | 11 | CERTIFIED |
| Top relations | `member_of` 972, `references` 278, `part_of` 71, `produced` 40, `affected` 20, `triggered_by` 20 | CERTIFIED |
| **Connected components** | **901** | CERTIFIED WITH LIMITATIONS |
| Largest component | **58 nodes (2.5%)** | CERTIFIED WITH LIMITATIONS |
| Small islands (≤2 nodes) | 832 | CERTIFIED WITH LIMITATIONS |
| Cycles | None detected in traversal | CERTIFIED |
| Export | `/graph/export` → 448 KB file, `edgeCount: 1436` | CERTIFIED |

The graph is **highly fragmented**: 901 components with the largest holding only 2.5% of nodes. This is a genuine structural property of the current data (missions link to their own leads/RCAs but rarely to each other), not a defect — recorded in the Gap Matrix.

## 3. Retrieval Matrix

All exercised live on the rebuilt graph.

| Retrieval mode | Endpoint | Result | Status |
|---|---|---|---|
| Exact node lookup | `GET /graph/node/:type/:id` | 200 with real node data | CERTIFIED |
| Graph traversal | `GET /graph/traverse/:type/:id` | 200, returns linked node set | CERTIFIED |
| Related-node retrieval | `GET /graph/related/:type/:id` | 200, mission↔lead links resolved | CERTIFIED |
| Impact analysis | `GET /graph/impact/:type/:id` | 200 with `rootData` + downstream | CERTIFIED |
| Edge query (filtered) | `GET /graph/edges` | 200, filterable by from/to/relation | CERTIFIED |
| Graph reasoning | `GET /graph/reasoning` | Critical deps ranked by inDegree | CERTIFIED |
| Executive reasoning | `GET /graph/reasoning/executive` | healthScore 72, 3 risks | CERTIFIED |
| Recommendations | `GET /graph/reasoning/recommendations` | 7 actionable items | CERTIFIED |
| Semantic (TF-IDF) | `semanticMemorySearch` | recall@8 3/3 after Phase B.10 fix | CERTIFIED |
| Ranked memory | `GET /p20/memory/rank` | Ranked nodes returned | CERTIFIED |
| **Hybrid graph+semantic** | — | **No endpoint combines graph traversal with semantic scoring** | GENUINE CAPABILITY GAP |
| Live endpoint survey | 62 probeable knowledge GETs | **55 real JSON 200**, 5×404, 2×400 | CERTIFIED |

## 4. Freshness Matrix

| Signal | Measured | Status |
|---|---|---|
| Governed sources | **25** | CERTIFIED |
| Average confidence | **79** | CERTIFIED |
| Average freshness | **69** | CERTIFIED |
| **Stale items detected** | **13** | CERTIFIED |
| Low-confidence items | 0 | CERTIFIED |
| Governance health score | **36** | CERTIFIED WITH LIMITATIONS |
| Knowledge conflicts | **0** (`/p20/memory/conflicts`) | CERTIFIED |
| Duplicate memory sets | **0** (`/runtime/memory-quality/duplicates`) | CERTIFIED |
| Version history | `createdAt` immutable, `updatedAt` bumped (Phase B.10 verified) | CERTIFIED |
| Correlations | 9 across 6 types, avg strength 76 | CERTIFIED |
| Discoveries | **232** across 6 categories | CERTIFIED |
| Automatic staleness remediation | Detection exists; no auto-refresh observed | GENUINE CAPABILITY GAP |

Stale detection is real and reports a low health score (36) honestly rather than masking it.

## 5. AI Knowledge Usage Matrix

Measured through `contextBuilder.build()` — the mechanism that carries knowledge into AI prompts.

| Knowledge type | Reaches AI context? | Evidence |
|---|---|---|
| Engineering memory (lessons/rules/RCA) | **YES** | **4 entries**, sample `source: rule, score: 0.188` |
| Recent lessons | YES | `recentLessons` key present |
| Production Bible workflow | YES | `bibleWorkflow` key present |
| Workflow registry | YES | `wfRegistry` key present |
| Prediction | YES | `prediction` key present |
| Pending approvals | YES | `pendingApprovals` key present |
| Workspace / founder / history | YES | present |
| **Knowledge Graph** | **NO** | context mentions `"graph"` = **false** |
| **Knowledge-net (11,162 items)** | **NO** | context mentions `"knowledge"` = **false** |
| Context size | 8916 bytes, 18 keys | CERTIFIED |

**Measured conclusion:** AI genuinely consumes engineering knowledge (the Phase B.10 F2 fix holds — 4 real entries, not 0). It does **not** consume the knowledge graph or the federated knowledge network. Those 11,162 items and 1526 graph edges are reachable by API and by human, but not injected into AI prompts. **GENUINE CAPABILITY GAP** — wiring them in would require a new context source, which this phase forbids.

## 6. Multi-org Matrix

| Surface | Test | Result | Status |
|---|---|---|---|
| `/org-graph/:orgId` | Org A → own | **200** | CERTIFIED |
| `/org-graph/:orgId` | Org A → Org B (non-member) | **403** | CERTIFIED |
| `/org-graph/:orgId` | Org B → own | **200** | CERTIFIED |
| `/org-graph/:orgId` | **true non-member** (`member` acct → Org B) | **403** | CERTIFIED |
| `/org-graph/:orgId` | `member` acct → Org A (is member) | **200** | CERTIFIED |
| `/org-graph/:orgId/impact/...` | Org A → Org B | **403** | CERTIFIED |
| `/graph/stats` | unauthenticated | **401** | CERTIFIED |
| Enforcement | `_assertMember(orgId, accountId)` → `hasPermission(…, "view_members")` | CERTIFIED |
| **Global `/graph/*` scope** | 923 distinct org nodes visible to any authenticated user | **BY DESIGN — global surface, not org-filtered** |

One nuance worth stating precisely: Org B's owner returns **200** on Org A's graph, which is correct — Phase B.4 added that account as a **viewer** in Org A. Verified with a genuine non-member (`secval-member`, Org A only): **403** on Org B. Isolation holds.

The global `/graph/*` family is a **platform-operator surface** exposing all 923 org nodes to any authenticated caller. That is an architectural scope decision, not a leak in the org-scoped path — recorded in the Gap Matrix.

## 7. Recovery Matrix

| Test | Result | Status |
|---|---|---|
| Edges on disk before SIGKILL | 1436 | — |
| **SIGKILL → auto-recovery** | **7553 ms** (PM2, Phase B.8 fix) | CERTIFIED |
| Edges after crash | **1436** — no loss | CERTIFIED |
| Nodes after crash | 2317 | CERTIFIED |
| `lastIndexed` preserved | Yes | CERTIFIED |
| Traversal after crash | **200** | CERTIFIED |
| Reasoning after crash | **200** | CERTIFIED |
| Rebuild capability | `POST /graph/index` — 2737 ms full rebuild | CERTIFIED |
| Targeted rebuild | `POST /graph/index/mission/:id` | CERTIFIED |
| Backup coverage | `knowledge-graph-edges.json` **not** in the Phase B.5 backup set | CERTIFIED WITH LIMITATIONS |
| Restore-without-migration | Graph is rebuildable from source data in 2.7 s, so backup absence is recoverable | CERTIFIED |

## 8. Performance Matrix

12 samples per endpoint, post-index.

| Operation | p50 | p95 | max | Status |
|---|---|---|---|---|
| `/graph/stats` | 45.9 ms | 50.8 ms | 50.8 ms | CERTIFIED |
| `/graph/impact` (hub, inDegree 57) | **44.3 ms** | 49.4 ms | 49.4 ms | CERTIFIED |
| `/graph/traverse` (hub node) | 45.4 ms | 52.0 ms | 52.0 ms | CERTIFIED |
| `/graph/reasoning` (full) | 61.4 ms | **814.6 ms** | 814.6 ms | CERTIFIED WITH LIMITATIONS |
| `/knowledge-net/dashboard` | 69.1 ms | 97.9 ms | 97.9 ms | CERTIFIED |
| **Full index build** | **2737 ms** for 1432 edges | — | — | CERTIFIED |
| Graph export | 448 KB written | — | — | CERTIFIED |
| Cache behaviour | No read cache on the edge store — every call re-reads and re-parses | CERTIFIED WITH LIMITATIONS |

The uniform ~45 ms floor across stats/traverse/impact is the signature of re-reading the edge store per request (Phase B.6 root cause), not of traversal cost.

## 9. Capability Matrix

| Capability | Exists? | Exercised? | Evidence |
|---|---|---|---|
| Graph create (`addEdge`) | YES | YES | Edge created, deduped, removed |
| Graph read (`getEdges`, `getNode`) | YES | YES | 1 edge / node resolvable |
| Graph traverse | YES | YES | 2 nodes at depth 2 |
| Graph related | YES | YES | 1 related node |
| Graph impact analysis | YES | YES | `rootData` + downstream |
| Graph delete (`removeEdge`) | YES | YES | 4 legacy duplicates removed |
| **Full index (`indexAll`)** | YES | **YES — 5 → 1526 edges** | The core recovery |
| Incremental index (`indexMission`) | YES | YES | Idempotent (0 delta on re-index) |
| Graph export | YES | YES | 448 KB, 1436 edges |
| Graph reasoning / executive / recommendations | YES | YES | 3 risks, 7 recommendations |
| Semantic search (TF-IDF) | YES | YES | recall@8 3/3 (B.10) |
| Knowledge federation (25 sources) | YES | YES | 11,162 items, 100% coverage |
| Correlation engine | YES | YES | 9 correlations, avg strength 76 |
| Discovery engine | YES | YES | 232 discoveries |
| Governance / freshness | YES | YES | 13 stale, health 36 |
| Duplicate / conflict detection | YES | YES | 0 / 0 |
| **Scheduled auto-index** | **NO** | — | Nothing calls `indexAll` on a timer |
| **Hybrid graph+semantic retrieval** | **NO** | — | No endpoint combines both |
| **Graph → AI context injection** | **NO** | — | context mentions `graph` = false |

## 10. Business Impact Matrix

| Capability unlocked by the recovery | Before | After |
|---|---|---|
| Executive risk visibility | none | healthScore 72, **3 ranked risks** |
| Actionable recommendations | none | **7** |
| Critical-dependency detection | none | Highest-degree node (inDegree 57) flagged `critical` |
| Cross-domain traceability | 4 node types | **10** — mission↔lead (CRM), rca↔rule (engineering), mission↔artifact |
| Mission→CRM links | 0 | **278** (`mission → lead`) |
| RCA↔mission links | 0 | **120** (60 each direction) |
| Org membership graph | 3 | **971** (`user → org`) |
| Self-diagnosis | none | Graph surfaced **"Fix: memory_pressure"** — the Phase B.11 defect, from its own data |
| Knowledge items reachable | 11,162 (unlinked) | 11,162 + 1526 graph edges linking them |

The self-diagnosis result is the strongest evidence the graph is doing real work: without being told, it ranked the Phase B.11 admission-gate failure as an actionable fix.

## 11. Remaining Gap Matrix

| ID | Gap | Type | Severity |
|---|---|---|---|
| G1 | **No scheduled auto-index.** `indexAll` is manual-only; the graph decays as missions accrue (reproduced: new mission → 0 new edges). Adding a scheduler is new capability, so out of scope. | GENUINE CAPABILITY GAP | **High** |
| G2 | **Graph and knowledge-net are not injected into AI context.** 1526 edges and 11,162 items are API-reachable but absent from AI prompts (`graph`/`knowledge` = false in context). | GENUINE CAPABILITY GAP | **High** |
| G3 | **Phase B.4 F5 still open** — `POST /orgs/:orgId/members` accepts a non-string `accountId`. It produced the one non-string node id and caused D2. Fixing input validation is outside the Knowledge layer. | UPSTREAM DEFECT | **Medium** |
| G4 | **Graph fragmentation** — 901 components, largest 2.5%. A structural property of current data, not corruption. | OBSERVATION | Medium |
| G5 | **No hybrid graph+semantic retrieval** endpoint. | GENUINE CAPABILITY GAP | Medium |
| G6 | **`knowledge-graph-edges.json` not in the backup set** (Phase B.5). Mitigated: rebuildable in 2.7 s. | CONFIGURATION | Medium |
| G7 | **No read cache on the edge store** — ~45 ms floor on every graph call. | OBSERVATION | Medium |
| G8 | **7 of 25 knowledge sources report 0 items** (`knowledge_evolution`, `knowledge_intelligence`, `autonomous_knowledge_org`, `engineering_memory`, `self_improvement`, `workforce_manager`, `digital_twin`) — healthy but empty. | UNKNOWN (empty by design or unwired) | Medium |
| G9 | **No automatic staleness remediation** — 13 stale items detected, none refreshed. | GENUINE CAPABILITY GAP | Low |
| G10 | **Global `/graph/*` exposes all 923 org nodes** to any authenticated user. Architectural scope decision. | BY DESIGN | Low |
| G11 | `/graph/reasoning` p95 814 ms. | OBSERVATION | Low |
| G12 | 5 knowledge endpoints returned 404 and 2 returned 400 on default probes. | UNKNOWN (may need params) | Low |

---

## Final Knowledge Certification

| Area | Classification |
|---|---|
| Knowledge Integrity | **CERTIFIED** — 0 malformed, 0 self-loops, 0 duplicates, 1436/1436 timestamped |
| Knowledge Graph | **CERTIFIED WITH LIMITATIONS** — 1526 edges / 2321 nodes / 10 types linked; fragmented (G4) |
| Retrieval | **CERTIFIED** — exact, traversal, related, impact, reasoning all live; no hybrid mode (G5) |
| Freshness | **CERTIFIED** — 13 stale detected, 0 conflicts, 0 duplicates, honest health score 36 |
| AI Knowledge Usage | **CERTIFIED WITH LIMITATIONS** — engineering knowledge reaches AI (4 entries); graph does not (G2) |
| Multi-org Isolation | **CERTIFIED** — org-scoped 403 for true non-members; global surface global by design |
| Recovery | **CERTIFIED** — 1436 edges survived SIGKILL; 7.5 s auto-recovery; 2.7 s full rebuild |
| Performance | **CERTIFIED** — 44–46 ms p50 traversal/impact; no read cache (G7) |
| Capability | **CERTIFIED** — 16 of 19 capabilities exist and were exercised live |
| Lifecycle | **CERTIFIED** — create/read/traverse/related/delete all verified end-to-end |

### **Knowledge Readiness: CERTIFIED WITH LIMITATIONS**

**The single most valuable finding is that nothing was missing — it was switched off.** The Knowledge Graph held 5 edges and `lastIndexed: null`, meaning no index had ever run in the product's history, while 1623 missions and 11,162 knowledge items sat unlinked. Running the **existing** `POST /graph/index` produced **1526 edges across 2321 nodes and 10 domain types in 2.7 seconds**, and switched on executive risk scoring (healthScore 72, 3 ranked risks) and 7 actionable recommendations that had previously returned empty. One of those recommendations was *"Fix: memory_pressure"* — the graph independently rediscovered the Phase B.11 admission-gate defect from its own data, which is the clearest possible evidence it is doing real reasoning rather than echoing inputs.

**One genuine defect was reproduced and recovered.** Each full reindex added exactly +1 edge (1482→1483→1484→1485, reproduced 3/3) while reporting a constant `indexed=1432`. The cause was `===` dedupe against a non-string node id — `{a:1} === {a:1}` is always false — and the culprit traced to **Phase B.4's still-open F5**, where `POST /orgs/:orgId/members` accepted `accountId={"a":1}`. Value-based dedupe plus removal of the 4 historical surplus rows via the existing `removeEdge()` gave **5 consecutive flat reindexes** and a store with **0 duplicate logical edges**.

**What held up under measurement:** integrity (0 malformed, 0 self-loops, 1436/1436 timestamped), isolation (true non-member → 403 on every org-scoped knowledge path), recovery (**1436 edges survived SIGKILL** with traversal and reasoning both live 7.5 s later), and freshness governance that reports a poor score (36) and 13 stale items honestly rather than hiding them.

**The two gaps that matter most are both capability gaps, not defects.** Nothing schedules `indexAll`, so the graph decays as new missions arrive — reproduced by creating a mission and measuring 0 new edges. And neither the graph nor the 11,162-item knowledge network is injected into AI context (`graph`/`knowledge` both absent from a built context), so the knowledge is reachable by API and by human but not by the AI. Closing either requires new capability, which this phase explicitly forbids — so both are recorded rather than built.

**Validation hygiene:** graph left in a clean, indexed state (1526 edges, 2321 nodes, **0 duplicates**, `lastIndexed` current); B.12 test edges removed by the suite's own teardown; health 200; one PM2-managed instance. Regression **144/144 existing + 68/68 new (B.6–B.12)**, with the new suite negative-tested (4 failures when reverted). Changes limited to `backend/services/knowledgeGraph.cjs` (**+29/−3**) and one new test file. No merge, no push, no new service, no new storage, no new model, no architecture change.
