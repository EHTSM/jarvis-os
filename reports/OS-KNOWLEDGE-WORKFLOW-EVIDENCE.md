# OS-KNOWLEDGE — WORKFLOW EVIDENCE

**Date:** 2026-08-15 · **Server:** `localhost:5199` · **Auth:** real `POST /auth/login` sessions
only — no JWT forged, no auth bypassed. **Audit Track's server (port 5050) confirmed running
throughout, including through its own legitimate self-initiated restarts, verified before/after
every process action this pass.**

**Accounts / tenants used (real, registered via `POST /accounts/register`):**

| Account | Org |
|---|---|
| `knowa@test.local` ("A") | `org_1786742565369_1` |
| `knowb@test.local` ("B") | `org_1786742565432_2` |

---

## Chain verified

```
Frontend (OrgAdminCenter.jsx)
  → POST /org-graph/:orgId/index  →  orgKnowledgeGraph.indexOrg()
      → indexCrm/indexConnectors/indexWorkflows/indexAiContext/indexDocuments
      → knowledgeGraph.addEdge()  →  data/knowledge-graph-edges.json (real file, append+dedupe)
  → GET  /org-graph/:orgId        →  orgKnowledgeGraph.getOrgGraph()
      → knowledgeGraph.traverse("org", orgId, {direction:"in"})
      → per-node _resolveNode() reads the REAL canonical store (businessDataService, etc.)
  → GET  /org-graph/:orgId/impact/:type/:id → orgKnowledgeGraph.getOrgImpact()
      → knowledgeGraph.impactAnalysis()
```

---

## W1 — Real knowledge creation and retrieval, with real identifiable secrets

```json
POST /business/leads  (A)
{"name":"KNOWLEDGE-SECRET-A-9f81c2","email":"secreta9f81c2@test.local","source":"test"}
→ {"success":true,"lead":{"id":"lead_1786742673403_673a6f","orgId":"org_1786742565369_1",...}}

POST /business/leads  (B)
{"name":"KNOWLEDGE-SECRET-B-7e42d1","email":"secretb7e42d1@test.local","source":"test"}
→ {"success":true,"lead":{"id":"lead_1786742679851_7f5bbc","orgId":"org_1786742565432_2",...}}

POST /org-graph/org_...1/index  (A)  → {"ok":true,"indexed":1,"byCategory":{"crm":1,...}}
POST /org-graph/org_...2/index  (B)  → {"ok":true,"indexed":1,"byCategory":{"crm":1,...}}

GET  /org-graph/org_...1  (A)
→ {"ok":true,"totalNodes":1,"byType":{"lead":[{"data":{
     "label":"KNOWLEDGE-SECRET-A-9f81c2","email":"secreta9f81c2@test.local",...}}]}}
```
Real, correctly org-scoped creation and retrieval, verified with content that could only have come
from the real record just created.

---

## THE FINDING — cross-tenant IDOR in impact analysis

### Reproduction (pre-fix, real HTTP, real accounts)

```
B (member of Org B ONLY) calls, using B's OWN org in the path:
GET /org-graph/org_1786742565432_2/impact/lead/lead_1786742673403_673a6f
                                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ Org A's real lead id

→ 200 {"ok":true,"rootType":"lead","rootId":"lead_1786742673403_673a6f",
        "rootData":{"label":"KNOWLEDGE-SECRET-A-9f81c2","status":"new",
                     "email":"secreta9f81c2@test.local"},
        "affected":{"org":[{"id":"org_1786742565369_1",
                             "data":{"label":"Knowledge Alpha's Organization","plan":"free"}}]},
        ...}
```
Org B's own membership check passed (it's their own org path), but the resource being analyzed
(`lead/lead_1786742673403_673a6f`) belongs entirely to Org A — genuinely disclosed, not a
hypothetical.

### Root cause

```js
function getOrgImpact(orgId, accountId, type, id) {
  _assertMember(orgId, accountId);          // checks the CALLER's membership in orgId
  return kg.impactAnalysis(type, id);       // type/id never checked against orgId at all
}
```
The function's own doc comment claimed a "post-hoc org-membership filter" that never existed in
the actual code.

### Fix

```js
const ownership = kg.getEdges({ fromType: type, fromId: id, toType: "org", toId: orgId, relation: kg.RELATIONS.BELONGS_TO });
if (!ownership.edges.length) {
  const e = new Error(`Not found in this organization's knowledge graph: ${type}/${id}`);
  e.status = 404;
  throw e;
}
const result = kg.impactAnalysis(type, id);
// + defense-in-depth: strip any affected node whose resolved orgId disagrees with the requested org
```

### Live re-verification (post-fix, real HTTP)

```
B, same request as above → 404 {"ok":false,"error":"Not found in this organization's knowledge graph: lead/lead_1786742673403_673a6f"}

A, own lead, own org path → 200, full real data (unaffected — legitimate access preserved)

B, own lead, own org path → 200, full real data (control test — unaffected)

B, forged X-Org-Id: <Org A> header, path still Org B's own org → 404 (header has zero effect)

B, using Org A's org directly in the path (no forgery, just requesting it) → 403 (pre-existing
  _assertMember gate, unaffected by this fix, still correctly blocks the more obvious vector)
```

---

## THE SECOND FINDING — raw platform-wide graph routes had zero tenant/operator gate

### Reproduction (pre-fix, real HTTP)

```
B (member of Org B ONLY, zero relationship to Org A) calls the RAW graph route directly:
GET /graph/node/lead/lead_1786742673403_673a6f

→ 200 {"ok":true,"type":"lead","id":"lead_1786742673403_673a6f",
        "data":{"label":"KNOWLEDGE-SECRET-A-9f81c2","status":"new","email":"secreta9f81c2@test.local"},
        "outEdges":[{"relation":"belongs_to","toType":"org","toId":"org_1786742565369_1",...}],
        ...}
```
No org check, no operator check — only `requireAuth`. This route has genuinely no per-org concept
(it is the platform-wide graph by design), so ANY authenticated account could read this.

### Fix

Added the same `operatorOnly` middleware `crm.js` already uses for its own identical-shape
"cross-org operator view" routes, to every route in `graph.js` that discloses individual record
content: `node`, `impact`, `traverse`, `related`, `edges` (GET/POST/DELETE), `export`, `lookup/*`,
and the two parametrized `reasoning/impact|dependencies/:type/:id` routes. Aggregate/statistical
routes (`schema`, `stats`, `reasoning`, `reasoning/critical`, `reasoning/executive`,
`reasoning/recommendations`) — confirmed via grep to be the ONLY `/graph/*` endpoints any real
frontend dashboard calls — were left reachable to any authenticated user, since they disclose
counts/summaries, not individual records.

### Live re-verification (post-fix)

```
B, GET /graph/node/lead/...       → 403 "Forbidden — operator access required"
B, GET /graph/impact/lead/...     → 403
B, GET /graph/traverse/lead/...   → 403
B, GET /graph/edges               → 403
B, GET /graph/reasoning/executive → 200 (unaffected — real dashboard-used route)
B, GET /graph/stats               → 200 (unaffected — aggregate only)
```

### Unit-level verification of the gate itself

```js
operatorOnly({user:{role:"operator"}}, res, next)  → next() called (passes through)
operatorOnly({user:{role:"user"}}, res, next)      → 403, next() NOT called
```

---

## Persistence — verified across a real restart

```
Before restart: A's graph = 1 node (real lead, real secret label)
[server confirmed stopped, Audit Track's port 5050 confirmed untouched, restarted clean]
After restart:  A's graph = 1 node, IDENTICAL data (label, email, status all intact)
Re-indexed 2 more times post-restart → still exactly 1 node (dedupe confirmed still working)
```

---

## Failure honesty — tested explicitly

```
GET /org-graph/:orgId/impact/lead/nonexistent-id     → 404, honest "not found" (not a fake 200)
GET /org-graph/not-a-real-org-id                      → 403, honest membership denial
POST /org-graph/<A's org>/index  (as B)               → 403, no partial/fake indexing occurred
DELETE the underlying lead, then re-read the graph    → node honestly disappears from results
                                                          (no stale fake data served)
```

---

## Build

```
CI=false npm run build:frontend → succeeds
```
No frontend file changed this pass.

---

## Regression

| Suite | Result |
|---|---|
| `npm run test:runtime` | **184/184** (baseline 181/181; the delta is the concurrent Audit Track's own C.9/C.10 work settling during this pass, unrelated to and unaffected by Knowledge OS) |
| `tests/security/111-knowledge-os-impact-analysis-cross-org-idor.cjs` (new) | **27/27** |
| `tests/runtime/18-knowledge-graph-dedupe.test.cjs` (pre-existing, Phase B.12) | **7/7** |
| `tests/security/08-v5-production-validation.cjs` (pre-existing, includes M2 `orgKnowledgeGraph.getOrgGraph` regression check) | **25/25** |
| `tests/security/97-enterprise-isolation-integrity.cjs` (pre-existing) | **6/6** |
| `tests/security/110-*` and `100-*` (prior OS passes' own tests) | Still passing, confirming no cross-pass disturbance |

Negative-test discipline: reverted both fix files via `git stash`, confirmed 15/33 new-test
assertions genuinely fail against the pre-fix code, restored the fixes, confirmed 27/27 (final
count after adding the graph.js coverage) pass. No test was modified, skipped, or weakened.

**Note on a transient, unrelated test failure observed mid-pass:** during this pass,
`npm run test:runtime` twice showed 2 failures in `tests/runtime/10-c10-cross-system-closure.test.cjs`
and `tests/runtime/09-c9-ai-experience-honesty.test.cjs` — both caused by the concurrent Audit
Track's own session actively fixing gaps (`developerOS.cjs` org scoping, `codingAssistant.js`
workspace gate) that those tests' own assertions still expected to be broken. Confirmed via `git
status` that Knowledge OS never touched either file. Both failures cleared on their own as the
concurrent session's work settled; the final regression run (184/184) reflects the settled state.
Not modified or worked around by this pass.
