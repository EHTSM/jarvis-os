# 24 — OS Integration / Hybrid Orchestration (Phase 9)

## Method

Cross-OS connections in this codebase are made almost entirely through shared
**service-layer reuse**, not direct route-to-route HTTP calls or a message bus.
A route file requires a sibling OS's service module directly
(`require("../services/X.cjs")`) and calls its exported functions in-process.
This is consistent with CLAUDE.md §16's "reuse an existing service" rule.

## Named cross-OS links, evidence-checked

| Link | Real? | Evidence |
|---|---|---|
| Business ↔ Sales | Yes, but not as two systems — Sales OS is Business OS's own pipeline (see `03_OOPLIX_OS_MAP.md` #2). Not a "link," an identity. | `reports/OS-SALES-FINAL-CERTIFICATION.md` |
| Sales ↔ Marketing | Partial | Marketing OS's CRM→audience sync (`M-001`) was found to be a silent no-op (field-name mismatch `l.id` vs `l.phone`), breaking the lead-nurture chain end-to-end; fixed in the Marketing OS pass. Now real. |
| Marketing ↔ Finance | Real | Customer Success OS's real Finance integration reuses `revenueOS.cjs` directly (per Customer OS's certification). |
| Finance ↔ Organization | Real, but unreconciled | Finance's own MRR figure (₹108,891, independently recomputed from `data/billing.json`) disagrees with Executive OS's figure (₹54,051, from `businessOrgState`) — both real, feeding from different aggregation paths, not reconciled by design decision (would require touching a shared 20-department tick feed). |
| Engineering ↔ Developer | Real, loosely | Distinct backends (`engineeringOrgState.cjs` vs. Developer OS's `/dev/*`); no direct cross-call found in this session's read, but both feed the same Knowledge/Memory substrate. |
| Developer ↔ Runtime | Real | Developer OS's mission records execute through the same `missionOrchestrator.cjs`/`executor.cjs` runtime chain as every other mission-producing OS. |
| Product ↔ Engineering | Partial | Per Product OS's own certification, "no Developer OS/Knowledge OS/Memory OS/Business-Sales-Finance/Customer Success integration" was an explicit open gap at time of audit — not independently re-verified as closed by this mission. |
| Customer ↔ Support | Real | Confirmed handoff: no duplicate customer record between Customer Success and Support engines (per Customer OS's certification), reusing the same identity. |
| Support ↔ Customer Success | Real | Same as above — one shared customer identity model across both. |
| AI ↔ Memory | Real | `orgAiBrain.cjs`'s response-cache logic reads/writes shared memory-adjacent state; a real cross-tenant cache-key defect here (`AIW-2`) was found and fixed (no tenant dimension on the cache key — two orgs' identical prompts within 5 minutes shared a cached response). |
| AI ↔ Knowledge | Partial | `KnowledgeCenter.jsx` (frontend) is disconnected from 3 real backend Knowledge systems — the starkest UI/backend disconnect found in the whole OS-layer register (per `03_OOPLIX_OS_MAP.md` #14). AI's own `/org-ai/:orgId/*` does not appear to call the Knowledge Graph directly in the sampled read. |
| Mission ↔ Agent | Real | `missionOrchestrator.cjs` dispatches to `agentRegistry.cjs`'s 210 live self-ticking agents — core of the Phase 5 pipeline (`10_AGENT_RUNTIME.md`). |
| Mission ↔ Automation | Partial/GENUINE GAP | The one cross-OS flow explicitly named by the OS-layer register itself as an unfixed "GENUINE GAP": Automation→Trigger→Runtime — `automation:approval:required` is emitted with zero subscribers; the approval→execute resume half does not exist. Correctly left unbuilt pending a trigger-model product decision, not silently claimed working. |
| Agent ↔ Runtime | Real | `agentRuntimeSupervisor.cjs`'s 210-agent registry ticks through the same runtime execution chain audited in `10_AGENT_RUNTIME.md`. |
| Runtime ↔ Platform | Real | Platform OS (`platformOrg.js`, Level Ω) explicitly composes Runtime OS as a cited dependency. |
| Executive ↔ all | Partial | Executive OS aggregates from Finance/Business/Organization, but the MRR reconciliation failure above shows this aggregation is not authoritative/consistent across sources. |
| Enterprise ↔ Organization | Real | Enterprise OS is a composite of `organizationService.cjs` (canonical) plus M1-M8 `enterprise*.js` modules, all `:orgId`-scoped through the same org model. |
| Ecosystem ↔ Integration | Real, but distinct systems | Per the OS-layer register, "Integration" (connectors/vault) and "Ecosystem" (`/eco/v8/*` Level 8 org) are largely separate concerns despite the mission's list treating them as one link — the Ecosystem OS pass is a cross-OS reconciliation pass, not itself an "integration" system. |
| Autonomous ↔ Mission | Real | `agents/autonomousLoop.cjs` directly creates/updates missions via `missionMemory.cjs`'s mutating API (`createMission`, etc.) — confirmed via `scripts/run-test-suite.cjs`'s own documented race-avoidance list, which exists specifically because this link is real and writes to shared state. |
| Platform ↔ all | Real, by composition | Platform OS (`/platform/v1/*`, 44 routes) explicitly composes `organizationService.cjs` and Runtime OS rather than reimplementing either. |

## Broken links / orphaned services / dead routes found

1. **`KnowledgeCenter.jsx` ↔ backend Knowledge systems**: frontend confirmed
   entirely disconnected from the 3 real backend Knowledge systems it should
   surface (its predecessor version was fabricated data entirely; the rewrite
   is a different, CRM-entity graph rather than the intended knowledge
   product — see `03_OOPLIX_OS_MAP.md` #14 and `23_PRODUCT_REPLACEMENT_MATRIX.md`).
2. **`ElectronWorkspace.jsx` / `RevenueOS.jsx`**: both confirmed reachable ONLY
   inside the packaged Electron app (`isElectron()` gate) — a structural
   disconnection between backend capability and web-frontend reachability for
   two separate feature areas (code workspace, revenue reporting).
3. **Automation → Trigger → Runtime**: explicitly documented GENUINE GAP (see
   table above) — not a broken link so much as a never-built one, correctly
   left unbuilt per the register's own honesty discipline.
4. **`AutonomousSupportCenter.jsx`**: confirmed orphaned (Support OS
   certification), archive candidate.
5. **`PartnerProgram.jsx`**: confirmed a static mockup with 0 backend endpoints
   (Marketing OS certification), archive candidate.
6. **Legacy `enterpriseOS.cjs` engine** (mounted flat via `ops.js`): a
   duplicate, non-integrated backend alongside the canonical
   `organizationService.cjs` + M1-M8 modules — 3 non-integrated Enterprise
   backends confirmed to coexist (C10-010 finding, still open by product
   decision, not built as one system).

## Cross-cutting root cause repeated across multiple "links"

The `security.js`/`admin.js` accidental unscoped-middleware bleed-through
(documented in `03_OOPLIX_OS_MAP.md`'s cross-cutting section) is the most
repeated root cause behind isolation defects discovered while tracing these
OS-to-OS links, not a single missing-gate pattern per link.
