# Phase B.10 — Memory Certification

**Product:** Ooplix (jarvis-os) v1.0.0-rc1
**Date:** 2026-08-09
**Branch:** `security/reality-completion` (no merge, no push)
**Method:** Operated the memory layer as a Memory Operating System. Every figure measured against the live stores and engines. Reproduce → Measure → Root Cause → Recover → Regression → Reverify.

---

## Defects Found, Fixed, and Regression-Tested

### F1 — Every new memory was destroyed by its own save (**CRITICAL**)

`memoryPersistenceLayer` caps the active store at `MAX_STORE_NODES = 2000` and evicts overflow ordered by **importance alone**. Measured on the live store:

| Fact | Value |
|---|---|
| Store occupancy | **2000 / 2000 — full** |
| **Minimum** importance present | **95** |
| Importance distribution | 95 × 1918, 99 × 44, 100 × 38 |
| `saveTypedMemory()` default importance | **60** |
| Existing nodes below 60 | **0** |

So any newly-learned memory was the lowest-ranked node in the map and was deleted inside the very same `_persist()` call that saved it — while `save()` still returned `{ saved: true }`.

**Reproduced deterministically** with a hard cutoff:

```
importance= 60  save->true  retrievable_after_save= *** NO — EVICTED ***
importance= 94  save->true  retrievable_after_save= *** NO — EVICTED ***
importance= 95  save->true  retrievable_after_save= YES
importance= 96  save->true  retrievable_after_save= YES
```

**Retrieval consequence, measured:** three distinctive memories written "successfully", then queried → **recall@8 = 0/3, precision@1 = 0/3**. Two of the three queries returned **zero** results. `memory-store.json` contained **0** matching entries.

**Why the store was saturated:** the autonomous RCA-playbook writer had written **1918 near-duplicate nodes at exactly importance 95** — 640 for `circuit_breaker_open_media` and 639 for `ai_service_timeout` alone. One subsystem's output had locked out all new learning.

**Fix** (`backend/services/memoryPersistenceLayer.cjs`) — no engine change, no cap change, no schema change:
1. **Grace window** — a node is never evicted for `EVICTION_GRACE_MS` (60 s) after creation, so a just-written memory is always readable back. Beyond the window, the original importance/age ordering applies unchanged.
2. **Usage recency added to ordering** — `usageCount` and `lastUsedAt` (already maintained by `load()`) now participate, which is what the surrounding comment ("frequently-recalled/important nodes survive longest") claimed but did not implement.
3. Falls back to the full node set if everything is inside the grace window, so the cap is still honoured rather than growing unbounded.

**Verified:**

| Check | Before | After |
|---|---|---|
| Save at importance 60/94/95 readable | NO / NO / YES | **YES / YES / YES** |
| recall@8 on 3 fresh memories | **0/3** | **3/3** |
| precision@1 | 0/3 | 2/3 |
| New memory rank in semantic search | MISS | **#1** |
| Store size | 2000 | 1999 (cap honoured) |
| Minimum importance in store | 95 | **1** — new memories can land |

**Regression:** `tests/runtime/14-memory-eviction.test.cjs` — 6 tests. **Negative-tested: 2 fail** with the original eviction; 6/6 pass restored.

### F2 — Recalled memory never reached the AI context (**HIGH**)

`contextBuilder.build()` has a dedicated "Engineering memory recall" step — the mechanism by which stored knowledge informs AI workflows. It read the result as:

```js
engineeringMemory = Array.isArray(recall) ? recall : [];
```

But `engineeringMemoryEngine.recall()` returns an **envelope**, never a bare array:

```json
{ "query": "...", "totalFound": 1, "results": [ ... ] }
```

So the guard always took the `[]` branch and **every recalled memory was discarded**.

**Reproduced across three queries** — `isArray=false` in all cases, including one reporting `totalFound=1` that still yielded `engineeringMemory=[]`. Memory was stored, durable and searchable; it simply never reached the AI that the field exists to inform.

**Fix:** accept the documented envelope (and still a bare array, in case another engine is swapped in) while keeping `engineeringMemory` an **array**, which is the shape `build()` promises its consumers.

**Verified end-to-end:** `recall('connection pool')` → `totalFound: 1` → contextBuilder `engineeringMemory` = **1 entry** (was always 0), carrying `source: "rule"` with a real score.

**Regression:** `tests/runtime/15-memory-context-injection.test.cjs` — 6 tests pinning the envelope contract on both sides. **Negative-tested: 2 fail** pre-fix; 6/6 pass restored.

---

## 1. Memory Inventory Matrix

| Subsystem | Implementation | Store | Size | Status |
|---|---|---|---|---|
| **Memory Fabric** | `memoryPersistenceLayer.cjs` | `memory-store.json` | 2.64 MB / 2000 nodes (cap) | CERTIFIED (after F1) |
| **Memory Archive** | same layer | `memory-archive.json` | 1.25 MB (cap 2000) | CERTIFIED |
| **Memory Intel** | `memoryIntelligenceEngine.cjs`, `memoryQuality.cjs`, `memoryRefinement.cjs` | — | — | CERTIFIED |
| **Memory OS / recall façade** | `unifiedMemoryEngine.cjs` (`index`, `search`, `lookup`, `crossRef`) | `unified-memory-index.json` | 0.05 MB | CERTIFIED |
| **Semantic search** | `semanticMemorySearch.cjs` — **TF-IDF cosine**, typed TAXONOMY | shares `memory-store.json` | — | CERTIFIED |
| **Knowledge Graph** | `knowledgeGraph.cjs` — 15 node types, 18 relations, **edge-only** | `knowledge-graph-edges.json` | 1.5 KB / 5 edges | CERTIFIED |
| **Org Knowledge Graph** | `orgKnowledgeGraph.cjs` — `_assertMember` + `BELONGS_TO org` | via graph edges | — | CERTIFIED |
| **Task Graph** | `taskGraph.cjs` | `task-graphs.json` | 2.50 MB / 500 graphs | CERTIFIED |
| **Mission Memory** | `missionMemory.cjs` (12 exports incl. `recordDecision`, `addLearning`) | `missions.json` | 10.75 MB / 1638 missions | CERTIFIED |
| **Context Store** | `contextBuilder.cjs`, `memoryContext.cjs`, `engineeringContextMemory.cjs` | — | — | CERTIFIED (after F2) |
| **Runtime Memory** | `engineeringMemoryEngine.cjs` — lessons/rules/RCA/patches/pipelines/missions | multiple | — | CERTIFIED |
| **Embeddings** | **None** — lexical TF-IDF only; no vector store | n/a | — | OBSERVATION (by design) |
| Domain memories | `eos/`, `civilization/`, `bizorg/`, `engorg/`, `ako/`, `ecosystem/`, `enterprise/`, `aeo/` | `*/memory.json` | 0.06–0.80 MB each | CERTIFIED |
| Totals | **54 memory engines** | **88 stores** | **24.7 MB** | — |

## 2. Retrieval Matrix

| Property | Before F1 | After F1 | Classification |
|---|---|---|---|
| **recall@8** (3 fresh memories) | **0/3** | **3/3** | CERTIFIED |
| **precision@1** | 0/3 | 2/3 | CERTIFIED |
| Exact retrieval (`mpl.load` by nodeId) | failed for new nodes | **OK** | CERTIFIED |
| Semantic retrieval | TF-IDF cosine over active nodes | OK | CERTIFIED |
| Ranking | New relevant memory ranks **#1** | OK | CERTIFIED |
| Typed retrieval | `searchFailures` / `searchSuccesses` / `searchDecisions` | OK, 0.2 ms p50 | CERTIFIED |
| **Duplicate memories** | **0 duplicate keys** across 2000 entries | — | CERTIFIED |
| Stale memories | 0 entries carry `expiresAt`; staleness handled by eviction, not TTL | — | CERTIFIED WITH LIMITATIONS |
| Conflicting memories | No contradiction detection | — | CERTIFIED WITH LIMITATIONS |
| Embedding-based recall | Not implemented (lexical only) | — | OBSERVATION |
| Cross-project search | `crossProjectSearch` present | OK | CERTIFIED |

## 3. Integrity Matrix

| Check | Result | Classification |
|---|---|---|
| **Corruption sweep** | **0 corrupted / 0 zero-byte across 88 memory stores (24.7 MB)** | CERTIFIED |
| Duplicate memory keys | **0** of 2000 | CERTIFIED |
| Graph linkage | **2000/2000** memories carry a `nodeId` | CERTIFIED |
| Schema validation | Typed TAXONOMY with required-field enforcement — rejected an incomplete `decision` write correctly | CERTIFIED |
| Atomic writes | `writeFileSync(tmp)` + `renameSync` | CERTIFIED |
| Store cap | 2000 enforced; archive 2000 enforced | CERTIFIED |
| Invalid embeddings | N/A — no embeddings stored | N/A |
| **Silent data loss** | **Was present (F1)** — save reported success while discarding | CERTIFIED (after F1) |
| Store saturation by one writer | 1918 of 2000 nodes from one subsystem at identical importance | CERTIFIED WITH LIMITATIONS |

## 4. Graph Matrix

| Check | Result | Classification |
|---|---|---|
| Node types | 15 (`MISSION`, `USER`, `TEAM`, `ORG`, `LEAD`, `LESSON`, `RCA`, `RULE`, …) | CERTIFIED |
| Relations | 18 (`OWNS`, `BELONGS_TO`, `MEMBER_OF`, `DEPENDS_ON`, `DERIVED_FROM`, …) | CERTIFIED |
| Knowledge graph edges | 5 edges / 8 nodes — genuinely low usage, not corruption | OBSERVATION |
| **Task graph scale** | **500 graphs / 3500 nodes / 3000 edges** | CERTIFIED |
| **Duplicate nodeIds within a graph** | **0** | CERTIFIED |
| **Dangling edge endpoints** | **0** | CERTIFIED |
| Self-loops | 0 | CERTIFIED |
| Orphan graphs (no nodes) | 0 | CERTIFIED |
| Graph traversal | `traverse(org, id, {depth})` — returns only that org's subgraph | CERTIFIED |
| Impact analysis | `impactAnalysis`, `findRelated` present and callable | CERTIFIED |
| Traversal latency | **1.4 ms p50** at depth 2 | CERTIFIED |
| Graph rebuild | `indexAll`, `indexMission` present | CERTIFIED |

An earlier pass of my own audit reported "3000 dangling endpoints / 1 distinct node id" — that was **my parser reading `id` instead of `nodeId`** and treating graph-local ids as global. Re-audited with the correct schema: **0 dangling, 0 duplicates**.

## 5. Isolation Matrix

Tested with two real organizations and three real accounts.

| Test | Result | Classification |
|---|---|---|
| Org A owner reads own graph | **200**, sees only `B10-LEAD-ALPHA` | CERTIFIED |
| Org B owner reads own graph | **200**, sees only `B10-LEAD-BETA` | CERTIFIED |
| Org A owner reads **Org B's** graph | **403**, 0 nodes | CERTIFIED |
| Org B owner reads **Org A's** graph | **403**, 0 nodes | CERTIFIED |
| Non-member account reads Org B's graph | **403**, 0 nodes | CERTIFIED |
| **Header override** (path=orgB, `X-Org-Id: orgA`) | **403** — B.7 fix holds | CERTIFIED |
| Engine-level traversal isolation | `traverse(org A)` returned only A's lead; `traverse(org B)` only B's | CERTIFIED |
| Enforcement mechanism | `_assertMember(orgId, accountId)` → `hasPermission(…, "view_members")` | CERTIFIED |
| Memory fabric scoping | **No org/account field on the 2000 entries** — global engineering knowledge (playbooks/RCAs/lessons), not tenant data | CERTIFIED (by design) |
| Tenant memory stores carrying `orgId` | 0 of the scanned memory stores — tenant scoping lives in the graph + CRM, not the fabric | OBSERVATION |

Zero cross-tenant node leakage in any of the six probes.

## 6. AI Context Matrix

| Workflow | Memory reaches the AI? | Classification |
|---|---|---|
| `contextBuilder.build()` — engineering memory | **Was always [] (F2)**; now carries every recalled entry | CERTIFIED (after F2) |
| Context assembly breadth | workspace, founder, history, categoryPreference, timingAdvice, approval history, learning lessons, Production Bible, engineering memory | CERTIFIED |
| Context size | 3681 bytes for a typical query | CERTIFIED |
| Context build latency | ~320–560 ms (includes recall across 6 sources) | CERTIFIED WITH LIMITATIONS |
| Recall sources | lessons, rules, rca, patches, pipelines, missions | CERTIFIED |
| Memory-source volume (live) | lessons 2000, rules 10, rcas 4, failuresAnalysed 2763, missions 1638, patches 27, pipelineRuns 20 | CERTIFIED |
| **`aiOrchestrator` memory injection** | **None** — the orchestrator does not inject memory; only `contextBuilder` consumers do | CERTIFIED WITH LIMITATIONS |
| Semantic store ↔ recall sources | `saveTypedMemory` writes the semantic store; `recall()` reads lessons/RCA/rules — **separate sources by design** | OBSERVATION |
| Permission scoping in context | `contextBuilder` is workflow-scoped, not org-scoped | CERTIFIED WITH LIMITATIONS |

A memory saved via `saveTypedMemory` is searchable through `semanticSearch` but is **not** among the sources `recall()` aggregates — so it will not appear in `contextBuilder` output. That is the current architecture, not a defect, and is recorded as a limitation rather than changed.

## 7. Performance Matrix

15 iterations each, measured in-process.

| Operation | p50 | p95 | max | Classification |
|---|---|---|---|---|
| `kg.getStats` | **0.0 ms** | 0.2 ms | 0.2 ms | CERTIFIED |
| `mpl.list` (paged, 50) | 0.1 ms | 0.8 ms | 0.8 ms | CERTIFIED |
| `searchFailures` (typed) | 0.2 ms | 0.6 ms | 0.6 ms | CERTIFIED |
| `kg.traverse` depth=2 | 1.4 ms | 10.2 ms | 10.2 ms | CERTIFIED |
| `semanticSearch` limit=50 | 10.8 ms | 11.0 ms | 11.0 ms | CERTIFIED |
| **`semanticSearch` over 2000-node corpus** | **11.7 ms** | 38.5 ms | 38.5 ms | CERTIFIED |
| `contextBuilder.build` (6 recall sources) | ~320 ms | ~560 ms | 563 ms | CERTIFIED WITH LIMITATIONS |
| Startup memory load | Included in the 7.5 s PM2 boot | CERTIFIED |
| Index rebuild | `unifiedMemoryEngine.index` atomic (`tmp`+`rename`) | CERTIFIED |

TF-IDF over 2000 nodes at 11.7 ms p50 is comfortably fast at this corpus size — which is the stated reason a vector store is not used.

## 8. Recovery Matrix

| Test | Result | Classification |
|---|---|---|
| Memory planted, then **SIGKILL** | Survived — on disk before **and** after | CERTIFIED |
| Auto-recovery time | **7528 ms** (PM2, from Phase B.8) | CERTIFIED |
| Retrievable after crash | **YES** — found via `semanticSearch` post-restart | CERTIFIED |
| Corruption after crash | 0 across 88 stores | CERTIFIED |
| Atomic write protection | `tmp` + `renameSync` on every `_persist()` | CERTIFIED |
| Archive restore path | `archive()` moves node out of active store; archive store retained (cap 2000) | CERTIFIED |
| Index rebuild | `unifiedMemoryEngine.index` present | CERTIFIED |
| Graph rebuild | `indexAll` / `indexMission` present | CERTIFIED |
| Backup coverage | `memory-store.json` **and** `missions.json` now in the backup set (Phase B.5 fix) | CERTIFIED |
| `memory-archive.json` in backups | **Not included** | CERTIFIED WITH LIMITATIONS |

## 9. Lifecycle Matrix

| Stage | Result | Classification |
|---|---|---|
| **create** | `saveTypedMemory("decision", …)` → `saved: true` with nodeId | CERTIFIED |
| **retrieve** | `mpl.load()` → node returned, `usageCount` incremented to 1 | CERTIFIED |
| **update** | `mpl.update()` → importance 85→90, confidence →99 | CERTIFIED |
| **versioning** | `createdAt` immutable, `updatedAt` bumped | CERTIFIED |
| **archive** | `mpl.archive()` → removed from active store, retained in archive | CERTIFIED |
| **expire** | No TTL enforcement — 0 entries carry `expiresAt`; eviction is the aging mechanism | CERTIFIED WITH LIMITATIONS |
| **delete** | Via archive; no hard-delete export in the layer's 8-method API | CERTIFIED WITH LIMITATIONS |
| **restore** | Archive store retained, but no `unarchive()` in the public API | CERTIFIED WITH LIMITATIONS |
| Schema enforcement | Required-field validation rejected a malformed write | CERTIFIED |

## Recovery Actions

| ID | Action | Scope | Status |
|---|---|---|---|
| F1 | Grace window + usage-recency in `_evictOverflow` — new memories survive their own save | `memoryPersistenceLayer.cjs` | ✅ Fixed, 6 regression tests, negative-tested |
| F2 | Unwrap the `recall()` envelope so memory reaches AI context | `contextBuilder.cjs` | ✅ Fixed, 6 regression tests, negative-tested |
| — | Graph integrity | none needed — 0 dangling, 0 duplicates | Verified |
| — | Isolation | none needed — 6/6 probes correct | Verified |
| — | Corruption | none needed — 0/88 stores | Verified |

## Remaining Limitations

| ID | Limitation | Severity |
|---|---|---|
| L1 | **One writer can saturate the store.** 1918 of 2000 nodes came from the RCA-playbook writer at identical importance 95 (640 + 639 for two error classes). The grace window prevents *loss*, but near-duplicate flooding still crowds out other memory. Per-source quota or duplicate-collapse would address it. | **High** |
| L2 | `saveTypedMemory` writes the semantic store, but `recall()` reads lessons/rules/RCA/patches — so a semantically-saved memory never reaches `contextBuilder` output. | **Medium** |
| L3 | `aiOrchestrator` performs no memory injection; only `contextBuilder` consumers get memory. | Medium |
| L4 | No TTL enforcement — 0 entries carry `expiresAt`; aging relies solely on eviction. | Medium |
| L5 | No conflicting-memory detection (two memories may assert contradictory resolutions). | Medium |
| L6 | Lexical TF-IDF only; no embeddings, so paraphrase recall depends on term overlap (precision@1 was 2/3, the miss ranking 4th). | Medium (by design) |
| L7 | `memory-archive.json` is not in the backup set. | Low |
| L8 | No `unarchive()` / hard-delete in the persistence layer's public API. | Low |
| L9 | `contextBuilder.build()` costs ~320–560 ms (6 recall sources, synchronous). | Low |
| L10 | Memory fabric is globally scoped — correct for engineering knowledge, but there is no tenant-scoped memory fabric if per-org AI memory is ever required. | Observation |

## Memory Readiness Score

| Dimension | Weight | Score | Weighted | Basis |
|---|---|---|---|---|
| **Integrity** | 20% | **9.5** | 1.90 | 0 corruption / 88 stores; 0 duplicate keys; 0 dangling edges; atomic writes |
| **Isolation** | 20% | **9.5** | 1.90 | 6/6 cross-tenant probes 403 with 0 node leakage, incl. header override |
| **Retrieval** | 15% | **8.0** | 1.20 | recall@8 0/3 → 3/3 after F1; precision@1 2/3; lexical only |
| Durability & recovery | 15% | **9.0** | 1.35 | Survived SIGKILL, retrievable after 7.5 s auto-recovery, 0 corruption |
| Performance | 10% | 9.0 | 0.90 | 11.7 ms p50 semantic search over 2000 nodes; 1.4 ms graph traversal |
| **AI context usage** | 10% | **6.5** | 0.65 | F2 fixed, but semantic store still outside recall sources; no orchestrator injection |
| Lifecycle & evolution | 5% | 7.5 | 0.38 | create/retrieve/update/archive/version all work; no TTL, no unarchive |
| Graph | 5% | 8.5 | 0.43 | 500 graphs / 3500 nodes / 3000 edges, 0 defects; knowledge graph barely used |
| **Total** | **100%** | — | **8.71 / 10** | |

### **Memory Readiness: 8.7 / 10 — CERTIFIED WITH LIMITATIONS**

**The most consequential finding of this phase is that the memory system was silently amnesiac.** The store had been saturated at 2000/2000 with a floor importance of 95 — mostly by one subsystem writing 1918 near-duplicate playbook nodes — while `saveTypedMemory` defaults to 60. Every newly-learned memory was therefore deleted inside the same call that saved it, and `save()` reported `{ saved: true }` throughout. Measured end to end: three memories written "successfully" gave **recall@8 = 0/3**, with two queries returning nothing at all. After the fix: **3/3, with the new memory ranking #1.** A Memory OS that cannot retain what it learns is the one failure mode that invalidates everything built on it, and it was invisible because the write path never complained.

**The second defect was the other half of the same story:** memory that *was* retained never reached the AI. `contextBuilder` guarded its recall with `Array.isArray(recall)` against an engine that returns `{ query, totalFound, results }` — so the field designed to carry engineering knowledge into AI prompts was **always empty**, including in a case reporting `totalFound: 1`. Both fixes reuse the existing engines, change no schema, no cap, and no storage, and each is guarded by regression tests that provably fail when reverted.

**What held up under real pressure:** integrity and isolation. **0 corrupted stores out of 88** (24.7 MB), 0 duplicate memory keys across 2000 entries, 0 dangling edge endpoints across 500 task graphs / 3500 nodes / 3000 edges, and **6/6 cross-tenant isolation probes returning 403 with zero node leakage** — including the `X-Org-Id` override path fixed in B.7. Memory survived a SIGKILL and was retrievable after a 7.5 s automatic recovery. Semantic search runs at 11.7 ms p50 over the full corpus, which is exactly why the lexical TF-IDF choice is defensible at this scale.

**Two corrections to my own analysis, worth stating** because either would have produced a false finding: an early graph audit reported "3000 dangling endpoints / 1 distinct node id" — that was my parser reading `id` instead of `nodeId` and treating graph-local ids as global; re-audited correctly, **0 dangling, 0 duplicates**. And a context-injection probe appeared to succeed because my own query term was echoed back in `ctx.command`, not because memory was recalled — `engineeringMemory` was in fact 0, which is what led to F2.

**The dominant remaining risk is L1:** the grace window stops memory *loss*, but one writer producing 1918 near-identical nodes still crowds the store. Per-source quota or duplicate collapse is the natural next step — deliberately not attempted here, since it changes retention policy rather than fixing a reproduced defect.

**Validation hygiene:** B.10 graph fixtures removed (edges back to 5), test memories aged out through normal eviction, `memory-store.json` valid at 1984 entries with the cap honoured and minimum importance now 1 (was 95). Prior-phase markers intact (`ALPHA-SECRET-LEAD`, `PRECRASH-MARKER-B5`); health 200; one PM2-managed instance. Regression **144/144 existing + 47/47 new (B.6–B.10)**. Changes limited to `backend/services/memoryPersistenceLayer.cjs`, `backend/services/contextBuilder.cjs`, and two new test files. No merge, no push, no memory-architecture redesign, no embedding replacement, no vector-database migration, no graph redesign.
