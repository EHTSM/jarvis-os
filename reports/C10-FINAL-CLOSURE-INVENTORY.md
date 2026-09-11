# C.10 — FINAL CLOSURE INVENTORY

Date: 2026-08-14/15 · Branch: `security/reality-completion`

Master inventory of everything still open across Ooplix V1, for the separate upcoming Master Recovery & Closure phase to consume. Every item has an explicit disposition — none are left as vague "open."

Dispositions used: `FIX IN MASTER RECOVERY` · `BUILD REQUIRED FOR V1` · `CREDENTIAL BLOCKED` · `CONFIG REQUIRED` · `VERIFY` · `DEFERRED` · `OUT OF SCOPE` · `FALSE POSITIVE` · `ALREADY FIXED`

---

## P0 — Fixed during C.10 (no longer open, listed for completeness)

| ID | Area | Description | Severity | Current state | Disposition |
|---|---|---|---|---|---|
| C10-001 | G (Developer OS) | `/dev/*` (36 routes) had zero auth gate — live-confirmed unauthenticated create+read of full engineering store | P0 | **FIXED** this session, live-verified | ALREADY FIXED |
| C10-002 | F ("Finance"/cbeta) | `/cbeta/billing/*` accepted arbitrary `accountId` with no ownership check — live-confirmed cross-account read AND forged write of real billing credit | P0 | **FIXED** this session, live-verified | ALREADY FIXED |

## P0/P1 — Genuine gaps found this session, NOT fixed (new architecture required)

| ID | Area | Description | Severity | Current state | Evidence | Tenant/security impact | V1 relevance | Disposition |
|---|---|---|---|---|---|---|---|---|
| C10-003 | G (Developer OS) | `developerOS.cjs` has zero `orgId` concept — any authenticated user sees every other tenant's repos/projects/issues/builds/deployments | P1 (post-fix; was P0 combined with C10-001) | Live-confirmed: Org B saw Org A's test repo after the auth fix | `agents/runtime/developerOS.cjs` — 0 `orgId` occurrences (grep-confirmed) | Cross-tenant data exposure among legitimate authenticated users | HIGH — real engineering data, real customer risk if multi-org deployed | FIX IN MASTER RECOVERY |
| C10-004 | H (Memory OS) | Zero `orgId` concept across all 3 parallel memory backends (`/memory/*`, `/memory-index/*`, `/p18/memory/*`) | P1 | Confirmed by direct grep of all 3 engine files (0 hits each) | `engineeringMemoryEngine.cjs`, `unifiedMemoryEngine.cjs`, phase18 memory service | Cross-tenant memory/context exposure — directly affects AI prompt context (see C.9's mission-context finding, same root cause) | HIGH | FIX IN MASTER RECOVERY |
| C10-005 | H (Memory OS) | 3 non-reconciled memory backends coexist with no clear authoritative source | P2 | Confirmed live route mounts: `/memory/*`, `/memory-index/*` (comment: "previously built but unwired"), `/p18/memory/*` (legacy, actually used by `MemoryOSV2.jsx`) | `backend/routes/index.js` mount comments | Not a security issue directly, but a data-consistency risk (which "memory" is authoritative?) | MEDIUM | VERIFY (needs a product decision on which backend is canonical before a fix makes sense) |

## P1 — Cross-OS flow gaps

| ID | Area | Description | Severity | Current state | Evidence | Tenant/security impact | V1 relevance | Disposition |
|---|---|---|---|---|---|---|---|---|
| C10-006 | F/J (Finance/Executive) | No unified "Finance OS"; "Executive OS" (`/eos/v6/*`) is platform-wide operator-only and cannot reflect an individual org's real revenue (confirmed 403 for a real org owner with real $50k revenue) | P2 | Live-confirmed via Flow 1 test | See Workflow Evidence Flow 1 | Not a security defect (the boundary is correctly enforced) — a real product-completeness gap against the mission brief's own Flow 1 expectation | MEDIUM — depends on whether org-level executive reporting was ever intended as a V1 feature | VERIFY (is `/org-executive/:orgId/*`, confirmed to exist and be correctly org-scoped, meant to be this missing piece? Not live-tested this session — worth a follow-up) |
| C10-007 | N (Automation OS) | No live automatic execution loop — rules can be created and dry-run (simulated) only; imported automation-loop dependency is never actually invoked | P1 | Confirmed via grep: 0 call sites for the loop dependency in the route file | `backend/services/automationService.cjs`, `backend/routes/automation.js` | Not a security issue — a real capability gap. A founder configuring an automation rule believing it will fire is currently not supported | HIGH — automation is a named, marketed capability | BUILD REQUIRED FOR V1 |
| C10-008 | N (Automation OS) | No `deleteRule` function anywhere in the service layer; no dedicated resume/trigger route (only generic PATCH for enable/disable) | P2 | Confirmed via grep of `automationService.cjs` exports | Same files as C10-007 | Not a security issue — incomplete CRUD surface | MEDIUM | FIX IN MASTER RECOVERY (thin wiring, not new architecture, once C10-007's execution loop exists) |
| C10-009 | U (Knowledge OS) | The "Knowledge" tab shown to users (`KnowledgeCenter.jsx`) is entirely hardcoded seed data, persisted only to `localStorage`, with zero network calls — while 3 real backend Knowledge systems exist unused | P1 | Confirmed by direct source read: 0 `fetch`/`_fetch` occurrences in the file | `frontend/src/components/KnowledgeCenter.jsx` | Not a security issue directly — but a significant honesty concern: a live, mounted, reachable tab presents fabricated content as if real, with no disclaimer (unlike Support OS's honest `SampleDataNotice` pattern) | HIGH — this is the starkest UI/backend disconnect found across the whole audit | BUILD REQUIRED FOR V1 (wire the tab to a real backend) or FIX IN MASTER RECOVERY (add an honest "not connected" disclaimer, matching Support OS's pattern, as an interim measure) |
| C10-010 | V (Enterprise OS) | 3 non-integrated Enterprise backends exist; the one UI tab uses only the least-discoverable one (`enterpriseOS.cjs`, inlined in `ops.js`), with its own independent membership model separate from `organizationService.cjs` | P2 | Confirmed via route/service trace | `backend/routes/ops.js:741-800`, `agents/runtime/enterpriseOS.cjs` vs `backend/routes/enterpriseOrg.js`, `organizationService.cjs` | Real risk of two membership models drifting apart; not observed to have actually diverged in this session's testing | MEDIUM | VERIFY (needs a decision on which model is canonical) |
| C10-011 | Z (Platform OS) | Real, org-scoped backend exists with zero discoverable frontend consumer; the shared status component used by J/V/W/X/Y explicitly omits a Platform entry | P3 | Confirmed via grep across `frontend/src` — 0 hits for `/platform/v1` or `/platform/status`/`/platform/summary` | `backend/routes/platformOrg.js`, `frontend/src/components/OrgLevelStatus.jsx` | None — dead capability, not a leak | LOW | DEFERRED |
| C10-012 | M (Support OS frontend) | `SupportCenter.jsx` never calls the real, tenant-hardened `/customer-org/support/*` backend — shows honestly-labeled sample data instead | P2 | Confirmed via source read: 0 references to `/customer-org` in the file | `frontend/src/components/SupportCenter.jsx` | None — the sample-data state is honestly disclosed via `SampleDataNotice`, not a fabrication | MEDIUM | BUILD REQUIRED FOR V1 (wire the real backend in) |

## P1/P2 — Re-verified prior findings (from 7 audited historical documents), still open

| ID | Source | Description | Severity | Disposition |
|---|---|---|---|---|
| C10-013 | GAP-LIST #4 | No RBAC/permission-assignment step in company factory | P0 (orig.) | FIX IN MASTER RECOVERY |
| C10-014 | GAP-LIST #5 | Single-process architecture (`instances:1`), explicitly non-cluster-safe | P0 (orig.) | OUT OF SCOPE (architectural decision, not a bug — explicitly acknowledged in-code) |
| C10-015 | GAP-LIST #7 | No dynamic/new-skill-creation pipeline | P1 (orig.) | DEFERRED (not independently re-verified this pass) |
| C10-016 | GAP-LIST #10 | Connector coverage limited; no Salesforce/HubSpot/Zendesk/QuickBooks/Shippo | P1 (orig.) | BUILD REQUIRED FOR V1 (if these integrations are V1-required) or OUT OF SCOPE (if not) |
| C10-017 | GAP-LIST #12 | `businessDataService.cjs` opt-in-only `orgId` scoping design | P1 (orig.) | FIX IN MASTER RECOVERY — see C.10's own live confirmation this is still real |
| C10-018 | GAP-LIST #14 | Company-factory niche classification is a 10-keyword regex ladder, defaults to `saas` | P1 (orig.) | DEFERRED |
| C10-019 | GAP-LIST #15 | Production deploy approval defaults to off for non-production profiles | P1 (orig., by design) | OUT OF SCOPE (appears intentional — only the `production` profile requires approval) |
| C10-020 | GAP-LIST #16-18 | No compliance/legal e-signature, clinical-safety, or trading-data infrastructure | P2 (orig.) | BUILD REQUIRED FOR V1 (if in scope) or OUT OF SCOPE |
| C10-021 | GAP-LIST #19 | No geospatial/mapping capability despite a referenced (unused) Google Maps key | P2 (orig.) | CONFIG REQUIRED (if intended) or OUT OF SCOPE |
| C10-022 | GAP-LIST #20 | 3D/CAD, Manufacturing/IoT/Robotics/Energy department families largely label-only | P2 (orig.) | DEFERRED |
| C10-023 | GAP-LIST #21 | Cross-company intelligence is 2 hardcoded heuristics, not real analysis | P2 (orig.) | DEFERRED |
| C10-024 | GAP-LIST #22 | "Load-test verified" claims not backed by real concurrency tests beyond 20 concurrent | P3 (orig.) | VERIFY (re-run at realistic concurrency before any claim is made publicly) |
| C10-025 | GAP-LIST #23 | Duplicate connector-probe code between two files | P3 (orig.) | FIX IN MASTER RECOVERY (cleanup, low risk) |
| C10-026 | GAP-LIST #24 | Enterprise CRM frontend (`EnterpriseCRM.jsx`) is pure client-side mock (`localStorage`, hardcoded seed arrays) | P3 (orig.) | BUILD REQUIRED FOR V1 (same class as C10-009 Knowledge OS) |
| C10-027 | Named finding | JWT logout does not revoke server-side — cookie-clear only, token valid until natural expiry | HIGH (documented) | FIX IN MASTER RECOVERY |
| C10-028 | Named finding | Sentry (`sentryService.cjs`) exports capture functions but nothing in the app actually calls them — no real crash reporting wired | HIGH (newly characterized) | CONFIG REQUIRED + FIX IN MASTER RECOVERY (wire the global error handler) |
| C10-029 | Named finding | No MRR decrement path exists anywhere (churn/downgrade never reduces recorded MRR) | Real, confirmed | FIX IN MASTER RECOVERY |
| C10-030 | Named finding | Marketing external publishing implemented for X/Twitter only; LinkedIn/Facebook/Instagram/ad platforms remain unimplemented | P1/P2 (orig., partially fixed since) | BUILD REQUIRED FOR V1 (if multi-platform is a V1 requirement) |

## Findings confirmed FIXED since the original audit documents (no action needed)

| ID | Original finding | Fix evidence |
|---|---|---|
| C10-031 | Cross-tenant CRM lead IDOR | `business.js` — every `bds.*Lead*()` call now passes `req.org.id`; `requireOrgMember` gate present |
| C10-032 | Refunds executed with no approval gate | `commercial.js` — now enqueues via `approvalQueue`, execution deferred |
| C10-033 | Company creation hardcoded `dryRun:true` | `companyFactory.cjs`/`companyWorkspaceBuilder.cjs` — now `dryRun:false` |
| C10-034 | Fake OAuth/Zapier health checks | `integrationConnectors.cjs` — real network probes confirmed (OIDC discovery, 302-vs-400 discrimination, real webhook POST) |
| C10-035 | Deployment approval floor bypassable via request body | `deploymentCoordinator.cjs` — floor fix confirmed, caller can only raise, never lower |
| C10-036 | 15 broken agent-logic files (missing `agents/crm.cjs` etc.) | All 3 named files now exist and load cleanly (verified live) |
| C10-037 | 14 department families with zero code | `departmentTemplateRegistry.cjs` now defines real templates for the named families |
| C10-038 | `orgMiddleware.attachOrg` confused-deputy on path-param routes | Fixed (Phase B.7), re-verified live this session (Flow 7 forged-header test) |
| C10-039 | `orgKnowledgeGraph.getOrgImpact()` missing isolation filter | `_assertMember()` check now present before impact analysis runs |
| C10-040 | MRR-overflow root cause (`advanceDeal()` re-triggering without idempotency guard) | `businessOrgState.cjs` — `TERMINAL_STAGES` guard now rejects re-transitions |
| C10-041 | Support ticket resolve-route cross-tenant IDOR | Live-verified fixed this session (contradicts a stale in-code comment) |

## Regression / Build status

| Check | Result |
|---|---|
| `npm run test:runtime` | **181/181**, 0 fail, 0 skipped |
| New C.10 regression suite | `tests/runtime/10-c10-cross-system-closure.test.cjs`, 5 tests, all negative-tested to confirm they catch reintroduced regressions |
| Prior C.1–C.9 suites | All still passing (176 tests carried forward unchanged) |
| `.env` | Untouched |
| Merge/push | None performed |
