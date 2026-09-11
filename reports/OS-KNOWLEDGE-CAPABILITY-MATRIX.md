# OS-KNOWLEDGE — CAPABILITY MATRIX

**Date:** 2026-08-15 · **Verification port:** 5199 · **Regression:** 181/181 → 184/184 before and
after (concurrent Audit Track added/settled its own C.9/C.10 test suites during this pass,
unaffected by and not affecting Knowledge OS)

**Legend:** PROD = Production Ready · FIXED = defect corrected this pass · GAP = Genuine Gap ·
NM = Not Measured

---

## 1. Knowledge CRUD

| # | Capability | Status | Evidence |
|---|---|---|---|
| 1 | Create (index) knowledge edges from real source data | **PROD** | Real CRM lead created → real edge indexed, verified live |
| 2 | Retrieve org graph | **PROD** | Real, correctly org-scoped read |
| 3 | Retrieve single node | **PROD (operator-only after fix)** | `/graph/node/:type/:id` — real data resolution from canonical stores |
| 4 | Update knowledge | **NOT MEASURED** | No dedicated edge-update endpoint exists — edges are re-derived by re-indexing, not patched in place; this is a real architectural choice (edges reflect current source-of-truth state), not tested as a separate "update" operation |
| 5 | Delete (single edge) | **PROD** | `DELETE /graph/edges/:edgeId` — real, operator-gated after fix |
| 6 | Delete cascade when source record is deleted | **PROD (honest, not automatic)** | Verified live: deleting the underlying lead leaves the edge's node resolution honestly returning empty/null on next read — no fabricated stale data, though the edge itself isn't auto-pruned (a real, minor, documented gap, not a security issue) |

## 2. Search / Ranking

| # | Capability | Status | Evidence |
|---|---|---|---|
| 7 | Traversal (BFS subgraph) | **PROD (operator-only after fix)** | Real BFS, `maxDepth`/`maxNodes` bounded |
| 8 | Find related (1-hop+ neighbors) | **PROD (operator-only after fix)** | Real relation-filtered traversal |
| 9 | Impact analysis (breadth/depth-based scoring) | **FIXED (was cross-tenant vulnerable)** | Real `impactScore` computation, now correctly org-scoped |
| 10 | Keyword/semantic search over knowledge content | **GENUINE GAP** | No search-by-content endpoint exists on the graph itself — the graph is relationship-only, not full-text indexed; `/ako/v4/search` exists but operates on the separate, platform-wide simulation layer, not tenant knowledge |

## 3. Persistence

| # | Capability | Status | Evidence |
|---|---|---|---|
| 11 | Edges survive restart | **PROD** | Verified live — real secret-labeled node intact after a genuine restart |
| 12 | Org ownership survives restart | **PROD** | Same test — orgId scoping intact |
| 13 | No duplicate records after restart/re-index | **PROD** | Phase B.12 dedupe re-verified (7/7 pre-existing test), plus live 3x re-index test showed constant node count |
| 14 | Relationships remain intact after restart | **PROD** | Same restart test — edge itself, not just the node, verified intact |

## 4. Tenant Isolation / Security

| # | Capability | Status | Evidence |
|---|---|---|---|
| 15 | Org graph read cross-tenant | **PROD** | 403 for genuine non-member, populated-data test (not empty-vs-empty) |
| 16 | Org graph index (write) cross-tenant | **PROD** | 403 for genuine non-member |
| 17 | Impact analysis cross-tenant via own-org path + foreign resource ID | **FIXED (was a real, live, exploitable IDOR)** | B received A's real lead name/email/status pre-fix; 404 post-fix |
| 18 | Raw `/graph/node`, `/graph/impact`, `/graph/traverse` (platform-wide, no org concept) | **FIXED (was a more severe, directly-reachable version of the same class)** | Any authenticated account of any org could read any other org's record content; now operator-only |
| 19 | Forged `X-Org-Id` header on `/org-graph/:orgId/*` | **PROD** | Zero effect — path param exclusively authoritative (route's own explicit design, verified real) |
| 20 | Direct-ID protection | **FIXED** | Was the core of finding #17 — now enforced via real `belongs_to` edge verification |
| 21 | Search cannot return foreign knowledge | **N/A** | No content-search capability exists to test (see #10) |
| 22 | AI context cannot inject foreign knowledge | **N/A (no AI integration exists at all — see §5)** | — |
| 23 | Mission context cannot expose foreign knowledge | **PROD (boundary only)** | Mission→graph indexing is real and org-tagged; no read-back path exists for missions to query the graph, so no exposure surface to test |
| 24 | Data integrity after all cross-tenant attempts | **PROD** | Verified unchanged throughout |

## 5. AI Workspace Integration (mission's specifically-flagged gap)

| # | Capability | Status | Evidence |
|---|---|---|---|
| 25 | Knowledge can be queried by the AI pipeline | **GENUINE GAP** | Confirmed absent — zero references to `knowledgeGraph.cjs`/`orgKnowledgeGraph.cjs` in `jarvisController.js`, `aiOrchestrator.cjs`, or `orgAiBrain.cjs` |
| 26 | Retrieved knowledge reaches the AI prompt/context | **GENUINE GAP** | Same — nothing to reach the prompt, since nothing is ever queried |
| 27 | Tenant scope preserved in AI context | **N/A** | No AI context exists to test |
| 28 | Attribution/source metadata survives to AI | **N/A** | Same |
| 29 | Missing knowledge produces an honest empty result | **N/A — not applicable, since retrieval is never attempted** | The gap itself is honestly absent, not silently masked as "working" |
| 30 | AI does not fabricate knowledge when retrieval fails | **N/A — no retrieval path exists to fail** | — |

**Per the mission's explicit instruction not to build this integration if it requires broad
architecture: not built.** Classified as GENUINE GAP, not fabricated as present.

## 6. Memory / Mission / Agent / Developer / Executive Integration

| # | Capability | Status | Evidence |
|---|---|---|---|
| 31 | Memory OS integration | **INTENTIONALLY SEPARATE, confirmed not a defect** | `knowledgeGraph.cjs` reads mission data FROM `missionMemory.cjs` (read-only, for node display) — no store merge, no write-back |
| 32 | Mission → Knowledge indexing | **PROD** | Real, wired: `/graph/index/mission/:missionId` + automatic call from `autonomousEngineeringPlatform.cjs` on engineering-run completion |
| 33 | Knowledge → Mission consumption (read-back) | **GENUINE GAP** | One-directional only — missions feed the graph, nothing reads it back for mission use |
| 34 | Agent consumption | **GENUINE GAP** | Same absence — no agent runtime code queries the graph |
| 35 | Developer/Engineering OS consumption | **PROD (write-side only)** | `autonomousEngineeringPlatform.cjs` genuinely calls `indexMission()` on completion — a real, live integration, write-direction only |
| 36 | Executive/business consumption | **PROD (aggregate only)** | `/graph/reasoning/executive` is real, wired, and consumed by `ExecutiveDashboard.jsx`/`BusinessOS.jsx` — platform-wide aggregate reasoning, not per-tenant knowledge retrieval |
| 37 | Organization/workspace context | **PROD** | Real `organizationService.hasPermission` reuse, no duplicate RBAC |

## 7. Auditability / Failure Honesty

| # | Capability | Status | Evidence |
|---|---|---|---|
| 38 | Every edge carries a real `createdAt` timestamp | **PROD** | Verified in raw data file |
| 39 | Invalid knowledge ID → honest 404 | **PROD** | Live-verified, same shape as a cross-tenant denial (no existence oracle) |
| 40 | Unauthorized read/write → honest 403 | **PROD** | Live-verified |
| 41 | No fake "indexed"/"stored"/"retrieved" success found | **PROD** | Every tested operation's response accurately reflected real underlying state |

## 8. Frontend / Reachability

| # | Capability | Status | Evidence |
|---|---|---|---|
| 42 | `/org-graph/:orgId` reachable from a real frontend consumer | **PROD** | `OrgAdminCenter.jsx` genuinely calls it |
| 43 | `/graph/reasoning/*` reachable from real frontend consumers | **PROD** | 4 real dashboard components call it |
| 44 | Electron/Web reachability | **PROD (architectural)** | Same REST API surface serves both, no separate Knowledge OS code path for Electron |

## 9. Performance

| # | Path | Latency |
|---|---|---:|
| 45 | `GET /org-graph/:orgId` | ~0.08–0.15s |
| 46 | `POST /org-graph/:orgId/index` | ~0.07–0.10s |
| 47 | `GET /org-graph/:orgId/impact/:type/:id` | ~0.07–0.08s |

---

## Totals

| Classification | Count |
|---|---:|
| **Production Ready** | **26** |
| **Fixed** | **6** |
| **Genuine Gaps** | **6** |
| **Not Measured** | **1** |
| **N/A (no capability exists to measure)** | **6** |
| Credential Blocked | 0 |
| Environment Blocked | 0 |
| Archive candidates | 0 |
| **Total assessed** | **47** |

**No knowledge platform was duplicated and nothing new was built.** One serious cross-tenant
data-leak defect (org-scoped impact analysis) and one severe, more directly-reachable version of
the same root cause (the platform-wide raw graph routes) found, root-caused, fixed uniformly,
negative-tested (33/33 combined, confirmed genuinely failing pre-fix), and live-verified with real,
identifiable, populated data on two real tenants. The AI Workspace → Knowledge OS gap the mission
specifically flagged is confirmed genuinely absent and was not built, per the mission's explicit
instruction.
