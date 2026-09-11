# OS-MEMORY — DISCOVERY REPORT

**Track:** OOPLIX OS #6 — Memory OS
**Date:** 2026-08-14 · **Branch:** `security/reality-completion`
**Method:** Repository inspection BEFORE any change. **No memory architecture was invented.**
**Isolation:** Verification server on **port 5099** (dedicated), leaving :5050 to other sessions.

---

## 1. Method

Inventoried every memory artifact across `backend/services`, `backend/routes`, `frontend/src`,
`data/`, and `tests/`. Capability was never inferred from a filename — every claim below was
confirmed either by executing the code path or by reading the persisted record on disk.

---

## 2. Backend Inventory — Services

| Service | Lines | Role |
|---|---:|---|
| `engineeringMemoryEngine.cjs` | 938 | **Unified query surface** (ACP-10) — reads 8 existing stores, stores nothing new |
| `missionMemory.cjs` | 929 | Mission-scoped memory (subtasks/decisions/failures/learnings) |
| `semanticMemorySearch.cjs` | 649 | Semantic/TF-IDF search |
| `memoryPersistenceLayer.cjs` | 292 | **Node store** — save/load/update/archive/list/search/recall/stats |
| `memoryIntelligenceEngine.cjs` | 239 | Ranking, conflicts, staleness |
| `contextBuilder.cjs` | 223 | **Context injection** (`build`, `buildQuick`) |
| `browserMemory.cjs` | 186 | Browser-session memory |
| `designMemory.cjs` | 139 | Design-domain memory |
| `continuousLearningEngine.cjs` | — | **Lesson store** (write target of `/memory/remember`) |

## 3. Backend Inventory — Routes

| Route file | Mount | Auth |
|---|---|---|
| `engineeringMemory.js` | `/memory/*` — remember, recall, similar-problems, similar-patches, strategies, predict-solution/risk, compare-history, evolve, stats, timeline, growth, benchmark | via `ops.js` blanket gate (verified 401) |
| `unifiedMemoryIndex.js` | `/memory-index/*` — summary, search, lookup, rebuild, decisions, incidents, knowledge, workflow | explicit `requireAuth` |
| (phase APIs) | `/p18/memory/stats`, `/p20/memory/rank`, `/p20/memory/conflicts` | gated (verified) |

All confirmed registered in `backend/routes/index.js` (lines 107, 108).

## 4. Frontend Inventory — all wired, no orphans

| Component | Wired into |
|---|---|
| `MemoryIntelligenceCenter.jsx` | `App.jsx` |
| `MemoryCenter.jsx` | `DeveloperCopilotV2.jsx` |
| `EngineeringMemoryPanel.jsx` | `AutonomousAgentDashboard.jsx` |
| `ContextSidebar.jsx` | `ReliabilityCenter`, `ExecutionCenter`, `JarvisBrainCenter` |
| `KnowledgeCenter.jsx` | 3 references |

API modules: `phase18Api.js` (`/p18/memory/stats`), `phase20Api.js` (`/p20/memory/rank`, `/p20/memory/conflicts`).

## 5. Persistence Inventory (real data)

| File | Size | Contents |
|---|---:|---|
| `data/memory-store.json` | 2.6 MB | Active memory nodes (1,966 at verification) |
| `data/memory-archive.json` | 1.4 MB | Archived nodes (2,000 cap) |
| `data/memory-index.json` | 319 KB | Tag index |
| `data/lessons.json` | — | Lesson store, **2,000 cap** (write target of `/memory/remember`) |
| `data/unified-memory-index.json` | 43 KB | Cross-product index (167 indexed) |
| `data/browser-memory.json`, `context-history.json`, `context-snapshot.json` | — | Session/context memory |
| plus 15 further domain memory stores | — | mission, failure, recovery, knowledge, engineering |

## 6. Memory Node schema — ownership finding

`memoryPersistenceLayer` node shape:
`nodeId, key, value, type, tags, importance, confidence, agentIds, createdAt, updatedAt, expiresAt, usageCount, lastUsedAt`

Lesson record shape (persisted, read from `data/lessons.json`):
`lessonId, type, title, detail, severity, sourcePattern, recommendation, createdAt, source, applied, agentId, toolId`

**Neither carries `ownerId`, `accountId`, `orgId`, or `workspaceId`.** The only scoping primitive
that exists anywhere in the memory layer is `agentIds` on a memory node.

## 7. Key Discovery Findings

1. **Memory OS already exists and is substantial** — 9 services (~3,600 lines), 25+ routes,
   5 wired UI surfaces, 2.6 MB of real node data. Nothing needed inventing.
2. **M-1 (retrieval):** `recall()` ranked `importance + hits*10`, so an exact keyword match at
   importance 88 lost to unrelated nodes at importance 100. **Measured recall@10 = 0/3.**
3. **M-2 (retention):** `/memory/remember` returned `stored:true`, wrote to disk, and the record
   was then **silently evicted by FIFO within ~71 minutes**.
4. **M-3 (reachability):** `recall()` searched only the newest **200 of 2,000** lessons — 90% of
   retained memory was unreachable.
5. **M-4 (isolation, open):** no ownership field exists → memories are readable across tenants.
6. Write honesty is **correct** — unsupported types and missing fields return `stored:false`.

---

**Outcome:** Memory OS is a recovery/verification target. Three defects fixed; one architectural
isolation gap documented. **0 capabilities built.**
