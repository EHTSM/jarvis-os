# 12 — Memory & Knowledge (Phase 5/1 detail)

## Memory OS

`memoryPersistenceLayer.cjs`, `continuousLearningEngine.cjs`,
`engineeringMemoryEngine.cjs`. Three real defects confirmed fixed (per
`03_OOPLIX_OS_MAP.md` #13): a recall-scoring bug that ranked an exact keyword
match #82 of 1,946 results (now 3/3 at top); a pure-FIFO eviction policy that
silently lost authored memories within ~71 minutes despite confirmed disk
writes; a recall function that scanned only the newest 10% of 2,000 lessons,
making 90% of stored memory unreachable.

**Open P0/HIGH, unresolved**: cross-tenant memory read AND write, reproduced
bidirectionally via both `/memory/recall` and `/p20/memory/rank` — records
carry no ownership field at all. Not fixed; requires a schema change plus
backfill of ~4,000 records across infrastructure that 5+ other certified OS
tracks also write into. This is one of the master report's top 3 open
cross-tenant findings.

## Knowledge OS

Real tenant-facing layer: `/org-graph/:orgId/*` (edge-only relationship graph,
no duplicated node storage). Two P0s confirmed fixed: a caller-org-membership
check that never verified the analyzed resource's own org ownership
(cross-org lead data leak); and raw platform-wide `graph.js` routes that had
only `requireAuth`, letting any account read/mutate any other org's individual
record (fixed with the same `operatorOnly` gate `crm.js` already uses).

**Confirmed frontend/backend disconnect**: `KnowledgeCenter.jsx`'s own header
comment documents that its *predecessor* version was entirely fabricated data
(hardcoded seed documents, fake chunk counts, fake semantic-search results,
localStorage-only, zero network calls). The rewrite is a real CRM-entity
relationship graph — but this is a different product than what "Knowledge
Center" implies (a document/wiki store), and it remains disconnected from 3
real backend Knowledge systems that exist but have no frontend consumer. This
is the starkest UI/backend disconnect found anywhere in the OS-layer register.
See `23_PRODUCT_REPLACEMENT_MATRIX.md` for the Notion-replacement consequence
of this same finding.

## Mission memory (distinct from "Memory OS")

`backend/services/missionMemory.cjs` — orgId is optional by explicit design;
the majority of missions (created via `codingAssistant.js`, `phase27.js`, most
autonomous/engineering flows) are legitimately shared, operator-visible,
non-tenant-owned resources. See `10_AGENT_RUNTIME.md` and
`09_TENANT_ISOLATION.md` for the route-level IDOR fix (Mission 51) and the
still-open, deeper Mission OS data-model gap (MSN-1: cross-tenant cancel on
2,124 records).

## Verdict

Both Memory OS and Knowledge OS have real, live-verified capability with
real, fixed historical defects — but each carries either an unresolved P0
cross-tenant gap (Memory) or a confirmed product-shape mismatch between what
the frontend implies and what the backend delivers (Knowledge). Neither
should be scored above the 7.5-8.0/10 range reflected in `03_OOPLIX_OS_MAP.md`
until these are addressed.
