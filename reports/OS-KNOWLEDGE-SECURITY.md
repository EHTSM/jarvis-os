# OS-KNOWLEDGE — SECURITY REPORT

**Date:** 2026-08-15 · **Server:** `localhost:5199` (isolated verification server, this session's
own process) · **Audit Track's own server (port 5050) confirmed running throughout — including
through its own legitimate self-initiated restarts, each independently verified healthy before this
session continued. No action targeting port 5050 or any of its PIDs was ever issued by this
session.**

No JWT was ever forged. No authentication middleware was ever bypassed or disabled. No credentials
were guessed or invented. `.env` was never modified. All sessions used real `POST /auth/login`
responses against real registered accounts, with real, uniquely-identifiable knowledge (real CRM
leads named `KNOWLEDGE-SECRET-A-<unique>` / `KNOWLEDGE-SECRET-B-<unique>`) populated on both
tenants before any isolation conclusion was drawn — never empty-vs-empty.

---

## 1. Unauthenticated access

| Endpoint | Method | Result |
|---|---|---|
| `/org-graph/:orgId` | GET | **401** |
| `/org-graph/:orgId/index` | POST | **401** |
| `/org-graph/:orgId/impact/:type/:id` | GET | **401** |
| `/graph/node/:type/:id` | GET | **401** |
| `/graph/stats` | GET | **401** |

All tested endpoints reject unauthenticated requests.

---

## 2. Cross-tenant isolation battery — populated-data testing (not empty-vs-empty)

| Test | Actor | Target | Pre-fix | Post-fix |
|---|---|---|---|---|
| Read org graph | B (non-member) | Org A's graph | 403 (already correct) | 403 |
| Index (write) org graph | B (non-member) | Org A | 403 (already correct) | 403 |
| **Impact analysis via own-org path + foreign resource id** | B (own org B, foreign lead id) | Org A's real lead | **200 — full leak of name/email/status/org name** | **404** |
| **Raw `/graph/node` — no org concept at all** | B (any authenticated account) | Org A's real lead | **200 — full leak** | **403 (operator-only)** |
| **Raw `/graph/impact`** | B | Org A's real lead | **200 — full leak** | **403** |
| **Raw `/graph/traverse`** | B | Org A's real lead | 200 (same class, not separately reproduced — same missing gate) | **403** |
| **Raw `/graph/edges` (read)** | B | any org's edges | 200 (same class) | **403** |
| **Raw `POST /graph/edges` (write)** | B | any org's graph | 200, could inject arbitrary edges (same class) | **403** |
| **Raw `DELETE /graph/edges/:edgeId`** | B | any org's edge | 200, could delete any edge platform-wide (same class) | **403** |
| Forged `X-Org-Id` header, `/org-graph/:orgId/*` | B | Org A (header), Org B (path) | N/A — route uses path param exclusively | Zero effect confirmed, both directions |
| Impact analysis on a genuinely nonexistent id | A | own org | 404 (honest, no existence oracle difference from the foreign-org case) | 404 (unchanged) |
| Data integrity after full battery | — | Org A's records | — | Byte-identical before/after, verified |

**Cross-tenant isolation: 2/9 discrete boundary tests failed on first measurement (both impact-
analysis-class defects); 9/9 pass after the two fixes.**

---

## 3. FINDING 1 — `orgKnowledgeGraph.getOrgImpact()` cross-org IDOR (P0)

### Severity rationale

Real, live, exploitable, no special access required beyond a normal account and membership in
*any* org (even one's own, brand-new, empty org). Discloses another organization's CRM lead name,
email, status, and organization name, plus (via the underlying `impactAnalysis`'s 3-hop traversal)
any other connected records — missions, opportunities — that happen to share an edge with the
targeted resource.

### Root cause

```js
function getOrgImpact(orgId, accountId, type, id) {
  _assertMember(orgId, accountId);      // verifies caller ∈ orgId
  return kg.impactAnalysis(type, id);   // type/id NEVER checked against orgId
}
```
The function's own doc comment described a "post-hoc org-membership filter" on the result that
never existed in the actual code — the gap between documented intent and shipped behavior is the
entire defect.

### Fix

Verify the analyzed resource has a real `belongs_to` edge to the requested org before running
analysis at all (reusing the exact same edge `getOrgGraph()`'s own — correctly isolated —
traversal already depends on); as defense in depth, also strip any node the multi-hop traversal
walks out to that resolves to a *different*, non-null orgId.

### Negative test

`tests/security/111-knowledge-os-impact-analysis-cross-org-idor.cjs` — confirmed genuinely failing
against the pre-fix code via `git stash` reproduction (3/6 Finding-1-specific assertions failed),
6/6 (later 27/27 combined with Finding 2's coverage) against the fix.

### Live verification

Full HTTP-level reproduction with real accounts and real secret-labeled data — see Workflow
Evidence report.

---

## 4. FINDING 2 — `graph.js` platform-wide routes had no tenant/operator gate (P0, broader reach)

### Severity rationale

More severe than Finding 1 in reach: reachable by literally any authenticated account (does not
even require the caller to supply a *real* org they're a member of, since the route has no org
parameter at all), and covers read AND write (arbitrary edge injection, arbitrary edge deletion)
across the entire platform's knowledge graph, not just impact analysis for one org.

### Root cause

`graph.js` mounts `router.use("/graph", requireAuth)` and nothing else at the router level; none of
`node`, `impact`, `traverse`, `related`, `edges` (GET/POST/DELETE), `export`, or `lookup/*` had any
additional gate. Unlike the 9-file unscoped-middleware pattern found in prior OS passes (an
*accidental* leak from another file), this route never had a gate to leak in the first place — it
is architecturally a platform-wide graph with no per-org concept to scope by.

### Fix

Added the existing `operatorOnly` middleware (`crm.js`'s own precedent for "cross-org operator
view" routes) to every route disclosing or mutating individual record content. Left the 6
aggregate/statistical routes any real frontend dashboard actually calls (`schema`, `stats`,
`reasoning`, `reasoning/critical`, `reasoning/executive`, `reasoning/recommendations`) on their
existing `requireAuth`-only gate, since they were confirmed (by reading their implementations) to
disclose only counts and top-N summaries, never individual record content.

### Negative test

Same test file, static-check + unit-level middleware verification — 12/12 gate-presence assertions
genuinely fail against the pre-fix code, 6/6 "must stay reachable" assertions correctly pass
unchanged in both states (proving the fix didn't over-gate real dashboard routes).

### Live verification

```
B, GET /graph/node/lead/<Org A's real lead>       → 403 post-fix (was 200)
B, GET /graph/reasoning/executive                  → 200 unaffected, both pre- and post-fix
```

---

## 5. AI context injection / mission context exposure

No AI-context-injection or mission-context-exposure vector exists to test, because no code path
connects the AI Workspace pipeline or the mission runtime to the knowledge graph for *reading* —
confirmed absent by direct grep, not assumed. This is the honest state of a genuine gap, not a
security finding: nothing can leak through an integration that doesn't exist.

---

## 6. Forged header / workspace-switching tests

| Test | Result |
|---|---|
| Forged `X-Org-Id` disagreeing with `/org-graph/:orgId/*`'s path param | Zero effect, both directions |
| Workspace-switching (no workspace concept in this graph — org-scoped only) | N/A — confirmed the graph has no workspace dimension to switch, so no widening vector exists at that layer |

---

## 7. Summary

| Category | Result |
|---|---|
| Unauthenticated access | 0 leaks / 5 tested |
| Cross-tenant isolation (populated data) | 2 found (both fixed), 7/9 already correct |
| Forged headers | 0 effective / 1 tested |
| Data integrity after all attacks | Unchanged, verified |

**Tenant isolation: 9/9** discrete boundary tests pass after this pass's two fixes; 7/9 were
already correct on first measurement.
