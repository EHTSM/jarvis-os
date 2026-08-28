# 04 — The "23/24/25 OS" Reference (naming reconciliation + full detail)

## The naming discrepancy

This mission's brief was titled with "23 OS layers," but Phase 16's file list
names this document `04_25_OS_REFERENCE.md` and asks to "reconcile the '25' in
the name against the real list." Direct evidence:

- The mission brief's Phase 1 names exactly **23** layers: Business, Sales,
  Marketing, Finance, Engineering, Developer, Product, Customer, Support,
  Organization, Enterprise, AI, Memory, Knowledge, Mission, Automation, Agent,
  Runtime, Creative, Integration, Executive, Ecosystem, Autonomous, Platform.
- `reports/OS-REGISTER.md` (the repo's own primary tracking artifact for this
  exact exercise) states in its own text: *"all 25 OSs in the master inventory
  now have either a real certification, an honest non-V1 classification, or a
  completed sufficiency determination."*
- Direct inspection resolves this: **Sales OS does not exist as an independent
  system** — it is Business OS's own pipeline, confirmed by both
  `OS-SALES-FINAL-CERTIFICATION.md` and an independent cross-system audit
  reaching the same conclusion. If Sales is not counted as separate, the
  mission's 23 collapses to 22 real distinct systems.
- **Civilization OS** (`/civ/*`) is real, live, and not in the mission's 23-name
  list at all — explicitly classified "POST-V1 / FOUNDER DECISION," not
  certified, not broken, not scored, since it has no tenant concept by design.

**Reconciled conclusion**: the repo's own "25" figure likely counts Sales as
separate (bringing the mission's 23 to a nominal 24) and adds Civilization as
a 25th. This mission does not silently pick one number as "correct" — it
reports: 22 genuinely distinct real systems map to the mission's 23 named
layers (with Sales absorbed into Business), plus 1 bonus system
(Civilization) that exists in the repo but wasn't named in the brief.

## Full per-OS 20-question reference

See `03_OOPLIX_OS_MAP.md` for the condensed table with scores. This section
elaborates each OS's answers to the mission's 20 standard questions in short
form; full narrative detail for each lives in the source `reports/OS-*`
report family and was reconciled, not re-derived, this mission (see
`evidence/missions/os-layer-reconciliation.md`).

### Business (8.6/10)
Exists, real backend (`businessDataService.cjs`, `businessOrgState.cjs`),
real routes (`/business/*`, 79 routes; `/bizorg/*`, `/bizorg/v3/*`), real
frontend (`BusinessOS.jsx`, with dedicated Jest tests), frontend calls real
routes (`businessApi.js`), data mostly real (19.6% disclosed-synthetic in the
20-department simulation), auth+tenant-isolation enforced (post-fix, a 34-route
unscoped-shadow-route defect was found and fixed with live A/B
verification), RBAC via `organizationService.cjs`, honest failure states
post-fix, real CRUD, real end-to-end lead→close→revenue workflow, real
Customer Success/Support handoff integration, real JSON persistence, tests
present and meaningful (locked post-fix, negative-tested), usable,
production-safe post-fix.

### Sales (not scored — absorbed into Business, not a distinct system)

### Marketing (8.5/10)
Exists, real backend across 4 modules (Growth/Content/Distribution/Revenue),
234 endpoints, 98/98 frontend references resolve, 0 fabricated measured
metrics, 5/5 tenant isolation verified, 0/11 unauthenticated surfaces. 4
defects found and fixed this pass (all 2xx-masking-failure class): CRM→audience
sync was a silent no-op; WhatsApp reported "sent" for a failed broadcast;
empty POSTs created junk records; validation errors surfaced as 500 not 400.
`PartnerProgram.jsx` confirmed a static mockup, 0 endpoints, archive candidate.

### Finance (8.4/10)
Real canonical surface (`/revenue/finance/*`), MRR independently recomputed
and matched exactly. **Open P0**: `/cbeta/billing/*` invoices/credits not
account-scoped. Missing: expense tracking, double-entry ledger, invoice
export. Executive OS reads a different, unreconciled MRR.

### Engineering (7.6/10)
Real (`engineeringOrgState.cjs`, 21 routes, 729-line real-disk-persisted
state), one privilege-escalation fix this pass (agent tick/enable/disable was
`requireAuth`-only, escalated to `operatorOnly`), platform-wide by intentional
design (no orgId — models the platform's own AI-engineering backlog).
Weakness is discoverability (no dedicated nav tab), not security.

### Developer (8.2/10)
Real (`/dev/*`, 36 routes). 4 fixes this pass (fake-success mission reporting,
15x-inflated tech-debt smell count, missionOrchestrator erasing history on
restart, build-artifact integrity). Tenant isolation found and fixed TWICE
(once for the base gap, once for a header-forgery bypass of the first fix) —
now closed.

### Product (6.4/10, stale)
Real (`/product-factory/*`, `ProductOSCenter.jsx`). Central tenant-isolation
finding (zero orgId anywhere in the 6-service data model) was fixed in a
same-day sibling pass (Ecosystem OS), but no re-score under the Product OS
name exists — the 6.4/10 figure materially understates current reality.

### Customer (8.1/10)
Real (`customerJourneyEngine.cjs` + siblings, `/customer-org/*`, 32 routes).
2 defects fixed: 3-sibling-engine tenant gap; a later-discovered *inverted*
leak (forged header returned MORE data than a genuine member's own view).

### Support (8.0/10)
Real (`customerSupportEngine.cjs`, `/customer-org/support/*`). 2 HIGH fixed:
inbox-summary-analytics platform-wide leak; cross-tenant write IDOR (resolve
another org's ticket). `AutonomousSupportCenter.jsx` confirmed orphaned.

### Organization (7.9/10)
Real (`organizationService.cjs`, 1,111 lines, `/orgs/*`, 33 routes, 6 RBAC
roles). 1 fix, root-caused to the cross-cutting `security.js`/`admin.js`
accidental-unscoped-middleware bleed-through pattern (see `03_OOPLIX_OS_MAP.md`).

### Enterprise (8.2/10)
Composite of 3 backends. 1 P0 fixed: the legacy `enterpriseOS.cjs` engine had
zero authentication (any zero-cookie request could create/rename/archive
organizations). 3-non-integrated-backends finding remains open by product
decision.

### AI (7.7/10)
Real 14-provider multi-vendor routing (`aiService.js`). 4 fixes: dead
model-selector, cross-tenant AI cache, lost usage-ledger org attribution,
false empty dashboard state. Separately, `AICostCenter.jsx`'s prior fabricated
cost dashboard is confirmed fixed. One open policy question: client-controlled
prompt-injection surface (session-scoped, no cross-tenant impact).

### Memory (8.0/10)
Real (`memoryPersistenceLayer.cjs`). 3 fixes (recall-scoring bug, FIFO
eviction data loss, 90%-unreachable recall scan). **Open P0**: cross-tenant
memory read/write on ~4,000 unowned records.

### Knowledge (7.5/10)
Real tenant-facing layer (`/org-graph/:orgId/*`). 2 P0 fixed. Confirmed
frontend/backend disconnect: `KnowledgeCenter.jsx` is a CRM-entity graph, not
a document/wiki product, and remains disconnected from 3 real backend
Knowledge systems.

### Mission (7.8/10)
Real (`missionOrchestrator.cjs`, `agents/executor.cjs`). 2 honesty fixes.
**Open P0, most severe of the top 3**: cross-tenant mission read AND cancel
on 2,124 unowned records — a destructive write, not merely a read.

### Automation (7.9/10)
Real (`automationService.cjs`, `orgAutomationScheduler.cjs` — genuine
`node-cron`-backed dispatcher). 1 fix (4th confirmed occurrence of the
cross-cutting middleware bug). Only 2/6 trigger types have a real dispatcher;
approval→resume flow doesn't exist. One explicitly-named unfixed "GENUINE GAP."

### Agent (7.9/10)
Real (`agentRuntimeSupervisor.cjs`, 210 live self-ticking agents confirmed).
1 fix (silently-disabled stale-lead/empty-pipeline checks due to a field-name
mismatch). 208/210 agents' individual tick logic not exhaustively audited —
honestly scoped as out of reach.

### Runtime (7.8/10)
Real composite (`runtimeEventBus.cjs`, `autonomousLoop.cjs`,
`executionEngine.cjs`, `executionHistory.cjs`). 1 fake-success chain fixed
across 3 files coordinately. Confirms CLAUDE.md §5's 4-engine layering is
intentional, not accidental duplication.

### Creative (7.6/10)
Real (`/creative/*`, real DALL-E 3/Sora/ElevenLabs + `sharp` pixel processing,
byte-verified). 1 P0 fixed (destructive cross-account delete/rename), 2 more
fixed (guessable-filename cross-account file serving, platform-wide job-count
leak). No org/workspace scoping model at all — a real, confirmed architectural
choice (account-level only), not an omission.

### Integration (8.2/10)
Real (`secretVault.cjs`, `integrationConnectors.cjs`, 44 connectors per this
mission's direct count). **0 fixes needed this pass** — genuinely clean.
`businessEventAdapter.cjs`'s zero-orgId webhook-ingestion surface is an open,
correctly-undecided architectural question, not independently fixable without
a founder decision.

### Executive (7.6/10)
Real (`/eos/v6/*`, 20-department tick engine; `/org-executive/:orgId/*`,
genuinely org-scoped). 1 P0 fixed (no operator gate at all on the platform
-wide engine — any tenant could read all goals/decisions/risks and create a
persisted platform-wide goal). MRR disagrees with Finance OS's, documented
not force-fixed.

### Ecosystem (8.3/10)
Real (`/eco/v8/*`). Fixed 2 defects, PLUS retroactively fixed Product OS's
previously-deferred tenant-isolation gap and found 2 further live cross-tenant
defects while verifying that fix (a bypassable header-forgery on Developer
OS's prior fix; an inverted leak on Customer OS). Best example in the register
of the "re-investigate, don't accept" discipline.

### Autonomous (8.3/10)
Real (`/auto/v10/*`, live decision ledger 45,000+ entries confirmed growing).
1 P0 fixed (missing `operatorOnly`, permitting a non-operator tenant to read
the full decision ledger and pause the platform-wide autonomous loop). This
mission independently confirmed the sibling-gate ambiguity the source report
flagged (`/eco`/`/civ`/`/ent`) is resolved — all three already carry
`operatorOnly` in current `backend/routes/index.js`.

### Platform (8.3/10)
Real (`/platform/v1/*`, 44 routes, Level Ω). Highest-severity item (reading/
exporting/cloning/retiring any other account's platform-org by ID) was
already fixed prior to this OS's own pass; verified to still hold (6 attack
vectors, all correctly 404). Non-security honesty gaps documented not fixed
(mislabeled "checksum," self-scoped-only certification score).

## Cross-cutting root cause (repeated across OS layers)

The `security.js`/`admin.js` accidental unscoped-middleware bleed-through is
the single most-repeated root cause across the whole register — confirmed
behind isolation defects in Organization, Customer Success, and Automation OS
independently. No dedicated fix pass exists for the pattern as a whole. See
`03_OOPLIX_OS_MAP.md` for detail.
