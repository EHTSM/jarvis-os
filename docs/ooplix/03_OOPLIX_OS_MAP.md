# 03 — Ooplix OS Map (Phase 1)

## Method note

This mission's Phase 1 work is a **reconciliation**, not a from-scratch audit. The
repository already contains a mature, dedicated audit trail for every one of the
23 OS layers named in the mission brief, primarily in `reports/OS-REGISTER.md`
(2,090 lines) plus per-OS `OS-<NAME>-DISCOVERY.md` / `-CAPABILITY-MATRIX.md` /
`-FINAL.md` / `-SECURITY.md` / `-WORKFLOW-EVIDENCE.md` report families. Direct
verification performed by this mission itself (not merely cited from a prior
report) is called out explicitly below and in `04_25_OS_REFERENCE.md`; everything
else is a reconciled citation of a prior pass's own live-verification claim.

## Top-line finding

All 23 named layers map to at least one dedicated prior audit artifact. This is
**not** a coverage gap the way Electron or offsite backup were before their
respective missions. The register's own text states: *"all 25 OSs in the master
inventory now have either a real certification, an honest non-V1 classification,
or a completed sufficiency determination."* ("25" vs. the mission's "23" is
itself a discrepancy — see `04_25_OS_REFERENCE.md`.)

## The 23 layers, condensed (full detail + line-item evidence in `04_25_OS_REFERENCE.md`)

| # | OS | Score | Status | Key evidence |
|---|----|-------|--------|---------------|
| 1 | Business | 8.6/10 | Certified, live-verified | `businessDataService.cjs`, `/business/*`, `BusinessOS.jsx` |
| 2 | Sales | N/A (absorbed) | Not a distinct system by design | Confirmed: implemented inside Business OS's own pipeline, not a separate layer |
| 3 | Marketing | 8.5/10 | Certified, 4 defects fixed this pass | `/growth/*`, `/content/*`, `/distrib/*`, `/revenue/*` |
| 4 | Finance | 8.4/10 | Certified with **one open P0/HIGH** | `/revenue/finance/*` clean; `/cbeta/billing/*` invoices/credits **not account-scoped** — unresolved cross-tenant billing read/write |
| 5 | Engineering | 7.6/10 | Certified, 1 privilege-escalation fixed | `engineeringOrgState.cjs`, `/engorg/*`, 214/214 regression |
| 6 | Developer | 8.2/10 | Certified, tenant gap fixed (twice) | `/dev/*`, isolation fixed then re-fixed after header-forgery bypass found |
| 7 | Product | 6.4/10 (stale) | Isolation fixed in a later (Ecosystem) pass, **no re-score issued** | `/product-factory/*`; current real-world state materially better than the stale number |
| 8 | Customer | 8.1/10 | Certified, 2 defects fixed (one found later, inverted-leak class) | `customerJourneyEngine.cjs` etc., `/customer-org/*` |
| 9 | Support | 8.0/10 | Certified, 2 HIGH fixed | `customerSupportEngine.cjs`, `/customer-org/support/*` |
| 10 | Organization | 7.9/10 | Certified, 1 fixed (root-caused to a cross-cutting bug class) | `organizationService.cjs`, `/orgs/*` |
| 11 | Enterprise | 8.2/10 | Certified, 1 P0 (unauthenticated legacy engine) fixed | composite of 3 backends, `enterpriseOS.cjs` legacy engine had **zero auth** pre-fix |
| 12 | AI | 7.7/10 | Certified, 4 fixed + 1 open policy question | `/jarvis`, `/ai/*`, `/org-ai/:orgId/*`; unfixed: client-controlled prompt-injection surface (session-scoped, no cross-tenant impact) |
| 13 | Memory | 8.0/10 | Certified, 3 fixed, **1 open P0/HIGH** | `memoryPersistenceLayer.cjs`; cross-tenant memory read/write, no ownership field on ~4,000 records |
| 14 | Knowledge | 7.5/10 | Certified, 2 P0 fixed | `/org-graph/:orgId/*`; `KnowledgeCenter.jsx` frontend confirmed **entirely hardcoded mock data**, disconnected from 3 real backend systems |
| 15 | Mission | 7.8/10 | Certified, 2 honesty fixes, **1 open P0/HIGH (most severe)** | `missionOrchestrator.cjs`; cross-tenant mission read **and cancel** on 2,124 unowned records |
| 16 | Automation | 7.9/10 | Certified, 1 fixed, 1 flow explicitly left unbuilt | `automationService.cjs`; only 2/6 trigger types have a real dispatcher; approval→resume half does not exist |
| 17 | Agent | 7.9/10 | Certified, 1 fixed | `agentRuntimeSupervisor.cjs`, 210 live self-ticking agents confirmed |
| 18 | Runtime | 7.8/10 | Certified, 1 fake-success chain fixed | `runtimeEventBus.cjs`, `agents/autonomousLoop.cjs`, `executionEngine.cjs` — confirms CLAUDE.md §5's 4-engine layering is intentional |
| 19 | Creative | 7.6/10 | Certified, 1 P0 (destructive data loss) + 2 more fixed | `/creative/*`, real DALL-E 3/Sora/ElevenLabs + `sharp` wiring verified |
| 20 | Integration | 8.2/10 | Certified, **0 fixes needed** | `secretVault.cjs`, `integrationConnectors.cjs` (65 connectors); one open architecture question (`businessEventAdapter.cjs` has no orgId concept) |
| 21 | Executive | 7.6/10 | Certified, 3 fixed, 1 cross-OS reconciliation failure documented not forced | `/eos/v6/*` had **no operator gate** pre-fix; MRR figure disagrees with Finance OS's |
| 22 | Ecosystem | 8.3/10 | Certified, fixed 2 defects **plus retroactively fixed Product OS's isolation gap** | `/eco/v8/*`; explicit re-investigation discipline |
| 23 | Autonomous | 8.3/10 | Certified, 1 P0 fixed | `/auto/v10/*`; sibling-gate ambiguity checked **directly by this mission** — confirmed current `backend/routes/index.js` already gates `/eco`, `/civ`, `/ent` with `operatorOnly` |
| 24 | Platform | 8.3/10 | Certified, fix already landed pre-pass, verified holds | `/platform/v1/*`, 44 routes |

**Bonus (not in the mission's 23, but live in the repo):** Civilization OS
(`/civ/*`) — explicitly classified "POST-V1 / FOUNDER DECISION," not certified,
not broken, not scored, since it has no tenant concept by design.

## The three most severe cross-tenant findings — STATUS: ALL FIXED (2026-08-28)

**Update (2026-08-28):** all 3 findings below are now fixed and
regression-tested. See `28_REMAINING_BACKLOG.md`'s P0 section and commit
`ce6862e0` for the full writeup, fix detail, and test evidence
(`tests/security/125-msn1-mission-runtime-cross-tenant-idor.cjs`,
`tests/security/126-m4-memory-os-cross-tenant-read-idor.cjs`). Text below
preserved as the historical record of what was found; no longer "currently
open."

These were the master report's top security priorities — none was folded
into its OS's headline score as "resolved" at the time this was written:

1. **MSN-1 (Mission OS) — FIXED.** Cross-tenant mission read **and cancel**
   (destructive write) via `mission.js`'s runtime mutation routes (no
   ownership check at all, unlike sibling read routes) plus 3
   mission-creation routes that never stamped `orgId`. No schema change was
   needed — `orgId` was already optional on `missionMemory.cjs`; the gap was
   route-level.
2. **F-1 (Finance OS) — was already fixed** pre-dating this document
   (commit `f45a146f`, 2026-08-22) — `/cbeta/billing/*` is `operatorOnly`
   -gated on all sensitive routes. This document's claim was stale relative
   to the code at the time it was written.
3. **M-4 (Memory OS) — FIXED.** Write side was already fixed in the same
   `f45a146f` commit. Read side (`/p18/memory*`, `/p20/memory/rank`) fixed
   this pass: optional `orgId` field added to `memoryPersistenceLayer.cjs`,
   reads scoped to the caller's real (independently-verified, never
   client-claimed) org. Known accepted tradeoff: pre-existing records
   predate the field with no reliable backfill path, so scoped reads show
   only new org-tagged data until it accumulates — a deliberate product
   decision, not a gap.

## Cross-cutting root cause identified across multiple OS passes

The single most-repeated root cause in the OS-layer register is **not** a missing
auth middleware call (CLAUDE.md §6's named pattern) but an *accidental* one:
`security.js`/`admin.js` route files mount unscoped middleware via
`router.use(fn)` with no path prefix, which Express then silently applies to
every subsequently-mounted router in the same barrel file — confirmed as the
actual mechanism behind isolation defects independently found and fixed in
Organization OS (`governance.js`), Customer Success OS (3 sibling engines), and
Automation OS (4th confirmed occurrence). No dedicated fix pass exists for this
class as a whole; every occurrence so far has been patched file-by-file. This is
a related-but-distinct pattern from CLAUDE.md §6's documented defect class and is
flagged as a candidate for its own remediation mission (not undertaken here per
Phase 18's no-remediation rule).

## Score-staleness note

Product OS's registered score (6.4/10) predates a same-day fix (in the Ecosystem
OS pass) that closed its central tenant-isolation finding. No re-score under the
Product OS name exists. This mission does not invent a new number — it flags the
6.4/10 figure as stale relative to current code, materially better in reality.

## Evidence

See `docs/ooplix/04_25_OS_REFERENCE.md` for the full per-OS 20-question breakdown,
and `docs/ooplix/evidence/missions/os-layer-reconciliation.md` for the report
citation index.
