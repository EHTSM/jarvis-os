# OS-MEMORY — SECURITY & ISOLATION EVIDENCE

**Date:** 2026-08-14 · **Server:** `localhost:5099` · **Method:** executed attack attempts

**Constraints honoured:** no JWT forged, no auth bypassed, `.env` not modified, no secret printed.
All sessions came from real `POST /auth/login`.

**Two real tenants**, each a legitimate member of their **own** workspace (not a non-member — that
distinction matters, see §3):

| Tenant | Account | Workspace |
|---|---|---|
| Operator | `33c4fb52d35e1c41f00788ec` | `ws_1786660472626_22971bc3` |
| Tenant A | `e3e9ded9f7a101ec3d4573b8` | `ws_1786700004118_5cc8412b` |

---

## 1. Authentication

| # | Endpoint | Result |
|---|---|---|
| S1a | `GET /memory/stats` unauthenticated | **401** |
| S1b | `GET /memory/growth` unauthenticated | **401** |
| S1c | `GET /memory/timeline` unauthenticated | **401** |
| S2 | `GET /memory-index/summary` unauthenticated | **401** |

**4/4 correctly rejected.** `/memory/*` inherits the `ops.js` blanket gate; `/memory-index/*` has an
explicit `requireAuth`.

## 2. Workspace membership gate

| # | Test | Result |
|---|---|---|
| S3 | Tenant A (non-member) → `POST /memory/remember` on operator ws | **403** `Not a member of this workspace` |
| S4 | Tenant A (non-member) + **forged** `x-workspace-id` → `/memory/recall` | **403** |

**A forged workspace id does not widen access.** Membership is checked against the JWT identity.

## 3. Agent-level scoping — the one isolation primitive that works

Node saved with `agentIds:['agent-alpha']`:
```
alpha (owner) sees node: true
beta  (other) sees node: false
AGENT SCOPING ENFORCED
```
`memoryPersistenceLayer.recall()` and `list()` both honour `agentIds`. This is real and correct.

---

# FINDING M-4 — Memories are readable across tenants (HIGH)

**Status:** Confirmed exploitable, **bidirectionally** · **Not fixed** — architectural, see §Why.

Per the mission's instruction to prove intent before calling something a leak, I first checked the
product contract. `engineeringMemoryEngine`'s header documents a deliberately **shared** engineering
knowledge base ("Unifies all existing engineering memory sources", "nodes/edges across all
domains"). A platform-wide *engineering lesson* store being global is defensible.

**What is not defensible:** `POST /memory/remember` accepts **arbitrary user-authored content** into
that global store, and every other tenant can then read it verbatim. The write API is
tenant-facing; the read surface is global.

## Reproduction A — cross-tenant read via `/memory/recall`

Tenant A writes a confidential memory **in its own workspace**:
```json
POST /memory/remember   (Tenant A, ws_…5cc8412b)
{"type":"lesson","data":{"title":"TENANT-A-SECRET-9944",
  "detail":"Tenant A confidential: internal pricing model"}}
→ {"ok":true,"stored":true,"lessonId":"les_1786700012536_1z9"}
```

The **operator, in a different workspace**, recalls it:
```
POST /memory/recall {"query":"TENANT-A-SECRET-9944"}
→ 200
TENANT A secret visible to other workspace: True
  LEAKED title : TENANT-A-SECRET-9944
  LEAKED detail: Tenant A confidential: internal pricing model
  score        : 0.730
```

**Reverse direction also leaks** — Tenant A recalled the operator's `MEMOS-PROBE-ALPHA-7731`.

## Reproduction B — cross-tenant node **values** via `/p20/memory/rank`

```
GET /p20/memory/rank?limit=50   (Tenant A, own workspace)
→ 200, nodes returned to Tenant A: 50
sees operator-created node value: True
  key= MEMOS-PERSIST-PROBE-5512   value= {"secret": "tenant-scoped?"}
```
This endpoint backs `MemoryIntelligenceCenter`, so the leak is reachable from the **UI**, not just
the API, and it exposes full node `value` payloads.

## Root cause

Persisted memory records carry **no ownership attribute at all**:

```
lesson record fields : lessonId, type, title, detail, severity, sourcePattern,
                       recommendation, createdAt, source, applied, agentId, toolId
ownership fields     : NONE
```
```
node schema fields   : nodeId, key, value, type, tags, importance, confidence,
                       agentIds, createdAt, updatedAt, expiresAt, usageCount, lastUsedAt
owner/org/workspace  : NONE  (agentIds is agent scoping, not tenant scoping)
```

And `engineeringMemoryEngine.recall({ query, limit, sources })` accepts **no owner/tenant
parameter** — there is no filter to apply even if a caller wanted one.

## Consequences (all four share this single root cause)

| Requirement | Status |
|---|---|
| A cannot **read** B's memories | ❌ **fails** (Reproductions A & B) |
| A cannot **retrieve** B's memory through search | ❌ **fails** |
| A cannot obtain B's memory through **context injection** | ⚠️ same store feeds `contextBuilder` — same exposure |
| A cannot **update** B's memories | ❌ unenforceable (no owner to check) |
| A cannot **delete** B's memories | ❌ unenforceable (no owner to check) |
| Forged org/user ids cannot widen access | ✅ **holds** (S4 → 403) |

## Why it was not fixed in this pass

A correct fix requires stamping `workspaceId`/`ownerId` at write time, a backfill decision for
**2,000 existing lessons and 1,966 existing nodes**, a filter on every read path
(`recall`, `list`, `search`, `/p20/memory/rank`, `contextBuilder`), and a product decision about
which memory is *intentionally* platform-global (engineering lessons plausibly are) versus
tenant-private (anything written through the user-facing API).

This store is shared infrastructure consumed by the already-certified Business, Marketing/Growth,
Sales, Finance and Developer OS tracks. A same-session schema change plus backfill risked breaking
completed work, which the mission explicitly forbids. Recorded here as the top P0 with a concrete
remediation instead.

## Recommended fix

1. Decide the contract: mark memory `scope: "global" | "tenant"` at write time.
2. Stamp `workspaceId` + `createdBy` in `remember()` and `save()`.
3. Filter every read path by caller workspace, allowing `scope:"global"` through.
4. Backfill existing records to `scope:"global"` (preserving today's behaviour) so nothing breaks,
   and make **new** user-authored writes tenant-scoped by default.
5. Negative-test: Tenant A must not retrieve `TENANT-A-SECRET-9944` from another workspace, and
   `/p20/memory/rank` must not return other tenants' node values.

---

## Security posture summary

| Dimension | Verdict |
|---|---|
| Authentication | **Strong** — 4/4 unauthenticated → 401 |
| Workspace membership gate | **Strong** — non-member → 403 |
| Forged workspace id | **Strong** — does not widen access |
| Agent-level scoping | **Strong** — enforced in `recall`/`list` |
| **Cross-tenant memory read** | **WEAK — M-4 (HIGH)** |
| **Cross-tenant update/delete** | **WEAK — unenforceable, same root cause** |
| Write honesty | **Strong** — 3/3 failure modes report `stored:false` |
| Retrieval honesty | **Strong** — nonsense query returns 0, no fabrication |
| Memory durability | **Fixed** — was silently evicting authored memories in ~71 min |

**No credentials were rotated, printed, or modified at any point.**
