# OS-MEMORY — WORKFLOW EVIDENCE

**Date:** 2026-08-14 · **Server:** `localhost:5099` (dedicated Memory verification instance)
**Auth:** real `POST /auth/login` sessions only — no JWT forged, no auth bypassed.
**Tenants:** Operator `finop@test.local` (ws `…22971bc3`) · Tenant A `finoa@test.local` (ws `…5cc8412b`)

All output below is verbatim from executed requests or executed code paths. Persisted records were
independently read off disk rather than trusting API confirmations.

---

## Chain verified

```
Frontend (MemoryIntelligenceCenter / MemoryCenter / ContextSidebar)
  → phase18Api / phase20Api  (/p18/memory/stats, /p20/memory/rank, /p20/memory/conflicts)
  → Express route (/memory/*, /memory-index/*)
  → requireAuth (cookie JWT) → workspace membership gate
  → engineeringMemoryEngine / memoryPersistenceLayer / continuousLearningEngine
  → data/lessons.json + data/memory-store.json + data/memory-archive.json  (fs, tmp+rename)
  → JSON response
```

---

## W1 — CREATE memory (`POST /memory/remember`)

```json
{"ok":true,"type":"lesson","stored":true,"target":"continuousLearningEngine",
 "lessonId":"les_1786699959045_1wg"}
```
**HTTP 200.**

### Independent disk verification (anti-fake-success check)

`grep` located the id in `data/lessons.json`, and the record reads:
```json
{"lessonId":"les_1786699959045_1wg","type":"engineering_rule",
 "title":"MEMOS-PROBE-ALPHA-7731","detail":"Memory OS verification probe",
 "severity":"info","createdAt":"2026-08-14T09:32:39.045Z","source":"memory-os-verification",
 "applied":false,"agentId":null,"toolId":null}
```
**Genuinely persisted — not a fabricated confirmation.**

Ownership fields present on the persisted record: **NONE** (no `ownerId`/`accountId`/`orgId`/`workspaceId`).

## W2 — RETRIEVE (`POST /memory/recall`)

```json
{"ok":true,"query":"MEMOS-PROBE-ALPHA-7731","totalFound":11,
 "results":[{"source":"lesson","score":0.8333,"item":{"lessonId":"les_1786699959045_1wg",
   "title":"MEMOS-PROBE-ALPHA-7731",...}},
  {"source":"rca","score":0.062,"item":{"title":"Circuit breaker tripped on media service…"}}]}
```
**HTTP 200.** Real ranking: exact match 0.83, unrelated RCA 0.06.

## W3 — Write-failure honesty (Step 3)

| Request | Response | Verdict |
|---|---|---|
| `type:"decision"` | `{"stored":false,"note":"decisions derive from smell/analysis…"}` | ✅ honest |
| `type:"totally_unknown_type"` | `{"stored":false,"target":null}` | ✅ honest |
| `type:"lesson"` with no `title` | `{"stored":false,"target":null}` | ✅ honest |

**No misleading "remembered" confirmations.** Three separate failure modes all report truthfully.

## W4 — Node store CRUD (`memoryPersistenceLayer`)

```
store before: 1949 nodes, 2000 archived
save   -> {"nodeId":"mem_1786700089829_mssr3ohw","saved":true}
load   -> FOUND key=MEMOS-PERSIST-PROBE-5512 usageCount=1     (usage tracking real)
update -> importance 88                                        (70 → 88)
search -> 1 hit
```
`nodeId` and `createdAt` correctly immutable across update.

## W5 — Agent-level scoping (the one isolation primitive that exists)

Node saved with `agentIds:['agent-alpha']`, queried with a full result pool:
```
alpha pool: 1946   owner sees node: true
beta  pool: 1945   other sees node: false
AGENT SCOPING ENFORCED
```

---

## DEFECT M-1 — Recall ranking ignored relevance

While confirming W5 the exact-keyword node ranked **#82 of 1946**.

### Root cause

`memoryPersistenceLayer.recall()` scored `importance + hits * 10`. A keyword hit was worth only 10
points, while the live store holds **1,918 of 2,000 nodes at importance ≥ 95** (autonomous RCA
writer). Arithmetic:
```
our node : importance 88 + 1 hit(10)  = 98
top node : importance 100 + 0 hits    = 100   <-- unrelated node wins
```

### Measured impact
```
probe 0 recall@10: MISS
probe 1 recall@10: MISS
probe 2 recall@10: MISS
recall@10 = 0/3   (exact-keyword queries against memories written seconds earlier)
```

### Fix + negative test

Rank by match count first, importance only as tie-break. Storage, cap, schema and agent scoping
untouched.
```
probe 0/1/2 recall@10: FOUND   → recall@10 = 3/3
empty-query importances: 100,100,100,100,100 → descending: true   (no regression)
agent scoping: owner true | other false → ENFORCED
```

---

## DEFECT M-2 — Authored memories silently evicted in ~71 minutes

Re-querying `MEMOS-PROBE-ALPHA-7731` later returned only unrelated 0.06 matches. Disk check:
```
total lessons: 2000
probe present: 0            <-- gone
tenant-A probe present: 0   <-- gone
```
Both probes had returned `stored:true` and had been confirmed on disk.

### Root cause

`continuousLearningEngine._saveLessons()` was `_lessons.slice(-2000)` — pure FIFO. Autonomous
writers churn the store continuously:
```
lessons by source (cap 2000):
   960  businessIntelligenceEngine
   192  reviewer_agent
    45  ako_learning …
retention window: 70.7 minutes
```
A user memory therefore survived under ~71 minutes regardless of value.

### Fix + negative test

Two-tier retention at the **same 2000 cap** (the cap is a deliberate memory-leak fix and was
preserved): authored lessons get a reserved 500-slot slice; autonomous lessons still evict FIFO.
```
T1 cap respected      : true (len=2000)
T1 user memory kept   : true      <-- was FALSE before fix (survived 5000 machine writes)
T2 order preserved    : true
T3 under cap untouched: true
T4 all-machine bounded: true (oldest dropped)
T5 authored-only bound: true (no unbounded growth)
```

### Live re-verification (real autonomous churn)
```
lessons total: 2000 (cap held)
authored probe survived churn: YES
authored retained: 333 | machine: 1667
```

---

## DEFECT M-3 — 90% of retained memory was unreachable

After M-2 the memory survived on disk but recall still returned unrelated 0.06 matches.

### Root cause

`engineeringMemoryEngine.recall()` called `le.getLessons({ limit: 200 })` — scoring only the newest
**200 of 2,000** lessons:
```
lessons searched by recall: 200 of 2000 on disk
probe inside 200-window: false
probe present overall  : true
=> stored + retained, but UNREACHABLE
```
Cost measurement showed the narrow window bought nothing: **scoring all 2,000 takes ~5 ms.**

### Fix + live re-verification
```
Before: top score 0.062  "Circuit breaker tripped on media service…"   (wrong item)
After : top score 0.707  "MEMOS-RETENTION-PROBE-8812"
        lessonId les_1786703418041_1k8, latency 65 ms
```
Exact memory is now the **top hit**.

---

## W6 — Restart persistence (Step 5)

Written, then server killed and restarted; a **fresh process** re-read from disk:
```
probe survived restart : YES  key=RECALLFIX-PROBE-0-QQ importance=60
retrievable after restart: true
store total: 1966
```
**Genuine file-backed persistence, not an in-memory cache.**

## W7 — Delete / forget

```
before archive: load -> present
archive        -> {"nodeId":"mem_1786700194542_mssr5xax","archived":true}
after archive: load     -> gone from active store
after archive: recall   -> correctly removed
after archive: search   -> correctly removed
```
Disk: `archivedAt` written to `memory-archive.json`; node removed from `memory-store.json`.
**No stale memory after deletion, and no memory surviving that should not.**

## W8 — Frontend ↔ backend contract

| Endpoint (used by `MemoryIntelligenceCenter`) | Result |
|---|---|
| `/p18/memory/stats` | **200** — `total:1966, archived:2000, avgImportance:95, avgConfidence:89` |
| `/p20/memory/conflicts` | **200** — `conflicts:[], conflictCount:0` |
| `/p20/memory/rank?limit=5` | **200** — real nodes with keys/values |
| `/memory-index/summary` | **200** — `totalIndexed:167`, namespaces populated |
| `/memory-index/search?q=circuit` | **200** — `results:[]` (honest empty, not fabricated) |

## W9 — Context injection

`contextBuilder.buildQuick("circuit breaker failure")` returned **1,846 chars** of real context
(`ok:true`, category, `trustScore:67`, preference model) — genuine injection, not a stub.

## W10 — Retrieval honesty

Nonsense query `zzzqqq-nonexistent-term-91773-xyzzy`:
```
totalFound: 0     results returned: 0     -> honest, no fabrication
```

---

## Performance

| Workflow | Latency |
|---|---|
| `/p20/memory/rank` | 0.003 s |
| `/p18/memory/stats` | 0.004 s |
| `/memory/growth` | 0.028 s |
| `/memory/stats` | 0.040 s |
| `POST /memory/recall` | 0.023 s → **0.065 s** after M-3 (10× search coverage) |

The recall increase is the deliberate cost of searching the full store instead of 10% of it.

---

## Regression

| Suite | Baseline | After fixes |
|---|---|---|
| `npm run test:runtime` | **144/144** | **144/144** |
| `tests/runtime/14-memory-eviction` (covers `memoryPersistenceLayer`) | — | **6/6** |
| `tests/integration/02-semanticMemory` | — | **27/27** |
| `tests/security/68-shared-memory-fabric-crash` | — | **3/3** |
| `tests/integration/07-production-hardening` | — | **87/87** |
| `tests/integration/09-v1-engine-validation` | 55/56 | 55/56 (**pre-existing**) |

The single failure is `getCapabilityMatrix … returns 12 entries` — the same stale
capability-count test recorded in the Developer OS pass (registry legitimately registers 26).
Unrelated to memory. **No test was modified, skipped, or weakened.**
