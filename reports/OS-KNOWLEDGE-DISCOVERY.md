# OS-KNOWLEDGE — DISCOVERY REPORT

**Track:** OOPLIX OS #15 — Knowledge OS
**Date:** 2026-08-15 · **Branch:** `security/reality-completion`
**Method:** Repository inspection BEFORE any change. **No new knowledge platform was built.**
**Isolation:** Verification server on **port 5199**. The concurrent Audit Track's own server (port
5050) was checked before and after every process action this pass — confirmed running throughout,
including through its own legitimate self-initiated restarts (multiple PID changes, each verified
healthy via `/health` before continuing).

---

## 1. Three real, architecturally distinct systems, not one

| System | Route prefix | Scope | Role |
|---|---|---|---|
| **Org Knowledge Graph** (V5 Module 2) | `/org-graph/:orgId/*` | Per-tenant | **The real, usable, tenant-facing Knowledge OS** — a relationship graph over each org's own CRM/connector/automation/AI-context/document data |
| Autonomous Knowledge Org (Level 4) | `/ako/*`, `/ako/v4/*` | Platform-wide simulation | 20 simulated "knowledge department" agents ticking against shared platform state — architecturally global by design, not a tenant store |
| Universal Knowledge Network (POST-Ω P14) | `/knowledge-net/*` | Platform-wide | External-source federation/correlation/discovery/governance simulation — also architecturally global by design |

Only the first is genuinely "knowledge that belongs to a tenant." The other two have no `:orgId` in
any route and no tenant-scoping to test — they are correctly, intentionally platform-level, so
tenant-isolation testing does not apply to them; this discovery confirms that architecture rather
than treating their global scope as a defect.

## 2. The real Knowledge OS's actual design

`orgKnowledgeGraph.cjs`'s own header comment is explicit and, on inspection, accurate: it is **not
a new graph engine** — it is a thin, org-scoped composition layer over `knowledgeGraph.cjs` (Phase
Q1's pre-existing "Unified Knowledge Graph"), which is itself an **edge-only store**
(`data/knowledge-graph-edges.json`) — no node data is duplicated; every node's live content is
resolved on read from its canonical store (CRM leads from `businessDataService.cjs`, missions from
`missionMemory.cjs`, connectors from `secretVault.cjs`, AI context from `promptHistory.cjs`,
documents from `creativeAssetLibrary.cjs`). This is genuinely "additive, not duplicative" — verified
by reading every indexing function, not assumed from the comment.

## 3. Backend inventory (the real tenant-facing surface)

| File | Lines | Role |
|---|---:|---|
| `backend/services/knowledgeGraph.cjs` | 659 | The real edge store, CRUD, traversal, impact analysis. Already carries real prior hardening (Phase B.12 dedupe fix, 20K-edge cap) |
| `backend/services/orgKnowledgeGraph.cjs` | 183 (+38 this pass's fix) | Org-scoped indexing (CRM/connectors/workflows/AI-context/documents) + org-scoped query wrapper |
| `backend/routes/orgKnowledgeGraph.js` | 45 | `/org-graph/:orgId/*` — index, read-graph, impact-analysis |
| `backend/routes/graph.js` | 241 (+1 this pass's fix) | `/graph/*` — the platform-wide raw graph API (schema/stats/CRUD/traversal/reasoning) that `knowledgeGraph.cjs` is directly exposed through |
| `frontend/src/components/OrgAdminCenter.jsx` | — | Real consumer: calls `/org-graph/:orgId` and `/org-graph/:orgId/index` |

## 4. Record ownership fields — present, and where absent it is documented, not a defect

Per the mission's explicit checklist:

| Field | Present? | Evidence |
|---|---|---|
| orgId | **Yes**, on every indexed edge (`BELONGS_TO` → `org`/`orgId`) | Confirmed in every `index*` function in `orgKnowledgeGraph.cjs` |
| workspaceId | **No** — the graph is org-scoped, not workspace-scoped | Consistent with the rest of the V5 platform (Modules 1/2 are both org-level, not workspace-level) |
| owner/account identity | **Partial** — edges carry `metadata` (which may include names/emails from the source record) but no dedicated `createdBy` field on the edge itself | The edge's `createdAt` timestamp exists; attribution of *who* triggered an index call is not recorded on the edge, only implicitly via the calling account's own audit trail elsewhere |
| source | **Yes**, implicitly — `fromType`/`toType` identify which canonical store a node's real data lives in | — |
| createdBy | **No**, on the edge record itself | Not classified as a tenant-boundary defect — the edge is a relationship pointer, not a user-authored record; the underlying canonical records (leads, missions, etc.) already carry their own `createdBy`/`ownerId` |
| timestamps | **Yes** — `createdAt` on every edge | — |

**Where ownership (orgId) is absent, it is intentional** for the platform-wide `/ako/*` and
`/knowledge-net/*` systems (§1) — not a defect, since those systems have no tenant concept to begin
with.

## 5. The genuine defects found (see Security report for full detail)

1. **`orgKnowledgeGraph.cjs`'s `getOrgImpact()` never verified the analyzed resource belonged to
   the requesting org** — only that the *caller* belonged to the org supplied in the path. Its own
   doc comment described a "post-hoc org-membership filter" that never actually existed in the
   code. Live-reproduced: a genuine member of Org B, using Org B's own orgId in the path, received
   Org A's real lead name/email/status and Org A's organization name. **Fixed.**
2. **`graph.js`'s raw platform-wide routes had zero tenant or operator gate at all** — `node`,
   `impact`, `traverse`, `related`, `edges` (read/write/delete), `export`, `lookup/*`, and the two
   parametrized `reasoning/impact|dependencies` routes were reachable with nothing beyond
   `requireAuth`. Since this route has no per-org concept by design, the correct fix is the same
   operator-only gate `crm.js` already uses for its own identical-shape "cross-org operator view"
   routes — not a new authorization concept. **Fixed.** The aggregate/statistical routes any real
   dashboard actually calls (`schema`, `stats`, `reasoning`, `reasoning/critical`,
   `reasoning/executive`, `reasoning/recommendations`) were confirmed to disclose only counts/top-N
   summaries, not individual record content, and were left reachable to any authenticated user.

## 6. Genuine gaps confirmed (not built)

- **AI Workspace → Knowledge OS integration does not exist.** Confirmed by direct grep across
  `jarvisController.js`, `aiOrchestrator.cjs`, `orgAiBrain.cjs` — none of them ever reference
  `knowledgeGraph.cjs` or `orgKnowledgeGraph.cjs`. This matches and confirms the exact gap the AI
  Workspace OS pass already flagged; independently re-verified unchanged this pass, not re-derived.
- **Mission/Agent → Knowledge OS is one-directional (write-only from Mission's side).**
  `knowledgeGraph.indexMission()` is genuinely wired (called from `graph.js`'s
  `/graph/index/mission/:missionId` and automatically from
  `autonomousEngineeringPlatform.cjs` on engineering-run completion) — but nothing in Mission OS or
  the agent runtime ever *reads back* from the knowledge graph. Missions feed the graph; they don't
  consume it.
- **Memory OS and Knowledge OS are intentionally, architecturally separate** — confirmed, not
  assumed. `knowledgeGraph.cjs` only reads mission data FROM `missionMemory.cjs` (read-only, for
  node display), never writes to or merges with it. One stray unused accessor
  (`engineeringMemoryEngine.cjs`'s `_kg()`) references `knowledgeGraph.cjs` but is never actually
  called anywhere — dead code, not a real integration.

---

**Outcome:** Knowledge OS (the real, tenant-facing `/org-graph/:orgId/*` surface) is a genuinely
real, architecturally sound, mostly well-built system with one serious and one severe cross-tenant
defect found and fixed this pass. The two platform-wide simulation layers (`/ako/*`,
`/knowledge-net/*`) are real but out of tenant-isolation scope by design. **0 systems built.**
