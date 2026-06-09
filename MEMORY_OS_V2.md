# MEMORY OS V2
**Phase:** 39 — Frontend Rebuild Strategy
**Date:** 2026-06-07
**Status:** Specification — No code written
**Scope:** Automate › Memory screens. Backend unchanged.

---

## 1. OVERVIEW

Memory OS covers all knowledge and memory management screens under **Automate → Memory**.

| New Screen | Old Tab IDs | Old Components |
|---|---|---|
| Memory | `memory`, `sharedmem`, `memoryintel` | `MemoryCenter.jsx`, `SharedMemoryCenter.jsx`, `MemoryIntelligenceCenter.jsx` |
| Knowledge | `knowledge` | `KnowledgeCenter.jsx` |

V2 merges these into a single **Memory** screen with internal sub-tabs, and a separate **Knowledge** screen.

---

## 2. MEMORY SCREEN V2

### 2.1 Purpose

Inspect and search the AI memory index. Understand what Jarvis knows. Not an editor — a viewer with search.

### 2.2 APIs Used

```javascript
// Phase memory APIs
getMemoryIndex()          // GET /memory (from phase APIs)
searchMemory(query)       // GET /memory/search?q=... (from phase APIs)
getMemoryStats()          // GET /memory/stats (from phase APIs)
```

Note: If these endpoints return 404 (not implemented), show "Memory index not available — start using Jarvis to build context" empty state. Never show fake data.

### 2.3 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Automate › Memory                                               │
│                                                                  │
│  Memory                                                          │
│  Jarvis's working knowledge and context                          │
│──────────────────────────────────────────────────────────────────│
│  [ Overview ] [ Index ] [ Shared ] [ Intelligence ]              │
│    ─────────                                                     │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  MEMORY OVERVIEW                                                 │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ Total Entries   │  │ Last Updated    │  │ Context Window  │  │
│  │ 2,847           │  │ 4 minutes ago   │  │ 84% used        │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                  │
│  RECENT MEMORY WRITES                                            │
│  ─────────────────────────────────────────────────────────────   │
│  14:33  [context]   Lead Raj Kumar qualified at ₹15k             │
│  14:28  [event]     WhatsApp sent to +91-XXXXXXXXXX              │
│  14:20  [error]     Workflow timeout — recorded for learning     │
│  13:00  [user]      Operator prefers INR pricing format          │
│  12:00  [summary]   Daily lead analysis complete — 124 reviewed  │
│                                                                  │
│  [ 🔍 Search memory… ]                                           │
│                                                                  │
│  ◎ Memory Editor — Coming Soon                                   │
│  Direct memory editing and pruning are under development.        │
└──────────────────────────────────────────────────────────────────┘
```

### 2.4 Sub-tabs

**Overview (default):** Stats + recent writes.

**Index:** Full paginated list of memory entries.
```
┌──────────────────────────────────────────────────────────────────┐
│  [ 🔍 Search memory entries… ]                                   │
│                                                                  │
│  TYPE ▾   DATE ▾                                                 │
│                                                                  │
│  [context]  Lead Raj Kumar qualified — Jun 6 14:33              │
│  [user]     Operator uses INR pricing format — Jun 4 12:00       │
│  [event]    WhatsApp batch: 12 sent — Jun 4 09:00               │
│  [summary]  Weekly analysis: 48 leads reviewed — Jun 2 08:00    │
│                                                                  │
│  Showing 20 of 2,847  [ Load more ]                             │
└──────────────────────────────────────────────────────────────────┘
```

Memory entry row:
```
[TYPE CHIP]  [description text — truncated at 80 chars]   [time]
```
Type chips: context (violet), user (teal), event (amber), summary (blue), error (red).
Click row: expands to show full content.

**Shared:** Contents from `SharedMemoryCenter` — multi-agent shared state.
```
◎ Shared Memory Fabric — Coming Soon
The cross-agent shared memory layer is under development.
```

**Intelligence:** Contents from `MemoryIntelligenceCenter` — pattern analysis.
```
◎ Memory Intelligence — Coming Soon
Pattern recognition and memory analytics are under development.
```

### 2.5 Search

Full-width search input at bottom of Overview tab.
On submit: calls `searchMemory(query)` → displays filtered results inline.
No result: "No memory entries match '[query]'. Try a broader term."

---

## 3. KNOWLEDGE SCREEN V2

### 3.1 Purpose

Operator-uploaded knowledge base — documents, FAQs, product specs that Jarvis references. Currently `KnowledgeCenter.jsx` is partial.

### 3.2 APIs Used

The Knowledge endpoints aren't confirmed active. Screen loads gracefully:
- Try to fetch knowledge index
- If 404/500: show Coming Soon banner + explain what this will do

### 3.3 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Automate › Knowledge                                            │
│                                                                  │
│  Knowledge Base                           [ + Upload ] (soon)   │
│  Documents and facts Jarvis can reference                        │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  ◎ Knowledge Base — Coming Soon                                  │
│  Upload documents, FAQs, and product specs to give Jarvis        │
│  context about your specific business. Existing UI preserved.    │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  WHAT YOU'LL BE ABLE TO DO                                       │
│                                                                  │
│  ✓  Upload PDF, DOCX, TXT files                                 │
│  ✓  Define FAQs for customer support automation                 │
│  ✓  Add product specs for pricing AI                            │
│  ✓  Jarvis auto-references these when answering questions        │
│                                                                  │
│  GET NOTIFIED                                                    │
│  We'll email you when this is available.                         │
│  Email: altamashjauhar@gmail.com                                 │
│  [ Notify me ] (tracks event to analytics)                      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

"Notify me" button: calls `track.event("knowledge_notify_me")` — analytics only, no backend call.

---

## 4. MEMORY ENTRY TYPE SYSTEM

Consistent visual language for memory entry types:

| Type | Color | Icon | Description |
|---|---|---|---|
| `context` | violet | Database | Business/lead context |
| `user` | teal | User | Operator preferences |
| `event` | amber | Zap | System events |
| `summary` | info-blue | FileText | Periodic summaries |
| `error` | red | AlertTriangle | Errors recorded for learning |
| `task` | green | CheckCircle | Completed task records |

All memory type chips use the `.chip--{type}` pattern from the Design System.

---

## 5. DATA LOADING STRATEGY

Memory data can be large. Use progressive loading:

1. On mount: fetch stats + last 20 entries
2. On tab switch to "Index": fetch first 20 entries paginated
3. "Load more": append next 20
4. On search: cancel pending fetches, fetch search results

Never load all memory into the browser — use server-side pagination via `?limit=20&offset=N`.

---

## 6. EMPTY AND ERROR STATES

### Memory not initialized (new account)

```
    [Database icon — 32px]
    Memory index is empty
    Start using Jarvis — commands, lead qualifications, and
    workflow runs are automatically stored in memory.
    [ Ask Jarvis something → ]
```

### API unavailable (endpoint not implemented)

```
    [AlertTriangle — 24px, dim]
    Memory API not available
    Memory indexing may not be enabled on this server.
    Contact your administrator.
```

### Search no results

```
No entries match "query"
Try searching for a lead name, date, or event type.
```
