# MASTER RECOVERY PLAN

Date: 2026-08-15 · Branch: `security/reality-completion`
Source of truth: `reports/C10-FINAL-CLOSURE-INVENTORY.md` (41 items, C10-001 through C10-041)

---

## Method

Every item from the C.10 inventory is carried forward with its original ID. No new worklist was invented from memory. Items are re-sequenced here by the mission's priority rubric (Section 2): P0 security/data-loss/fake-success/production-breaking → P1 security/tenant-isolation/authorization → P1 production blockers → P2 core V1 functionality → P2 cross-OS integration → P3 UX/performance/accessibility → optional/out-of-scope. Within equal severity: multi-OS impact, multi-tenant impact, core-workflow impact, easiest-safe-recovery, lowest-architectural-risk, in that order.

For each item, the recovery-before-building test (Section 3, A–G) was applied before deciding disposition.

---

## Recovery order

### Block 1 — P0/P1 tenant-isolation architecture (highest impact, multi-OS, multi-tenant)

| Order | ID | Item | Recovery-test result | Plan |
|---|---|---|---|---|
| 1 | C10-003 | Developer OS (`developerOS.cjs`) has zero `orgId` — cross-tenant visibility among authenticated users | (D) capability exists, needs ownership added — same pattern already proven in `businessDataService.cjs`/`growthOS.cjs` | Add `orgId` to every create function, filter every list/get/search by `orgId`, wire the route layer in `ops.js` to pass `req.org.id`, backfill existing unscoped records to a sentinel `orgId: null` (never silently assign them to whichever org happens to migrate first) |
| 2 | C10-004/005 | Memory OS — 3 parallel backends, zero `orgId` in any | (D)/(A) — decide canonical backend first, then apply ownership only where genuinely tenant-bound, per the mission's explicit instruction not to break legitimate shared engineering knowledge | Trace writers/readers of all 3, classify each memory *type* as tenant-bound vs. intentionally-shared, scope only the tenant-bound ones |
| 3 | C9 carry-forward | `missionMemory.cjs` mission-context cross-tenant leak (root cause, not endpoint patch) | (D) — add `orgId` to mission records and filter `listMissions()` | Fix at the data layer so every consumer (including `codingAssistant.js`'s `_missionContext()`) is automatically scoped, not just the one call site |
| 4 | C9 carry-forward | `/coding/patch-history` + bundle storage unscoped | (D) — same flat-file-array pattern as Developer OS | Add `orgId` to patch-history entries and bundle records, scope every read/list/export route |

### Block 2 — P1 security/correctness (single-mechanism, well-precedented)

| Order | ID | Item | Plan |
|---|---|---|---|
| 5 | C10-013 | No RBAC/permission step in company factory | Add a minimal permission-assignment call reusing `organizationService.cjs`'s existing role model — no new RBAC system |
| 6 | C10-017 | `businessDataService.cjs` opt-in-only `orgId` scoping | Audit every call site; make `orgId` required (throw, not silently scan-all) at the service boundary for tenant-bound entity types |
| 7 | C10-027 | JWT logout — no server-side revocation | Add a minimal revocation list (in-memory + persisted ledger) checked in `verifyJWT`, reusing existing JWT infra — no new auth system |
| 8 | C10-029 | No MRR decrement path | Add the missing decrement call at the churn/downgrade transition points in `businessOrgState.cjs`, mirroring the existing increment guard pattern |

### Block 3 — P1 production blockers / core V1 functionality

| Order | ID | Item | Plan |
|---|---|---|---|
| 9 | C10-007/008 | Automation OS — no live execution loop, no delete route | Reuse existing `runtimeEventBus`/mission infrastructure for dispatch; add `deleteRule`; do not build a new scheduler |
| 10 | C10-009 | Knowledge OS frontend fully fabricated | Wire `KnowledgeCenter.jsx` to the real, already-existing backend(s) — do not build a second Knowledge engine |

### Block 4 — P2 cross-OS integration / consistency

| Order | ID | Item | Plan |
|---|---|---|---|
| 11 | C10-010 | Enterprise OS — 3 non-integrated backends, 2 membership models | Designate `organizationService.cjs` (A/K) as canonical; re-point the UI-connected `enterpriseOS.cjs` engine's membership reads at it rather than its own independent store, where safely possible without breaking existing data |
| 12 | C10-006 | Executive/Finance reconciliation | Trace source/scope/aggregation; make the V1 source of truth explicit in code comments and, where a real per-org executive view already exists (`/org-executive/:orgId/*`), verify it is the intended completion of Flow 1 rather than building a new one |
| 13 | C10-012 | Support OS frontend not wired to real backend | Wire `SupportCenter.jsx` to `/customer-org/support/*` |
| 14 | C10-028 | Sentry never wired to capture | Wire the global error handler to call `sentryService.cjs`'s existing functions (code-complete, CONFIG REQUIRED for the DSN itself — no credential added) |

### Block 5 — Immediate disposition, no code change (P2/P3/out-of-scope/deferred)

Per the recovery-test in Section 3 and the mission's explicit instruction not to fabricate architecture for out-of-scope items, the following receive a final disposition without a code change, each justified individually in `MASTER-OPEN-FINDINGS.md`:

C10-005 (VERIFY — needs product decision), C10-011 (DEFERRED — dead capability, no leak), C10-014 (OUT OF SCOPE — architectural, acknowledged in-code), C10-015 (DEFERRED), C10-016 (OUT OF SCOPE — no external-connector credentials to build against in this phase), C10-018 (DEFERRED), C10-019 (OUT OF SCOPE — intentional), C10-020 (OUT OF SCOPE), C10-021 (OUT OF SCOPE), C10-022 (DEFERRED), C10-023 (DEFERRED), C10-024 (VERIFY), C10-025 (FIX IN MASTER RECOVERY if time permits, else DEFERRED — cosmetic cleanup, zero risk either way), C10-026 (BUILD REQUIRED FOR V1, same class as C10-009 — attempted after Knowledge OS if time permits), C10-030 (OUT OF SCOPE — external provider credentials).

C10-001, C10-002, and C10-031 through C10-041 require no action — already fixed/verified, carried forward for completeness in the final table.

---

## Concurrency safety

Before every server restart in this phase: `lsof -iTCP -sTCP:LISTEN -P | grep 505` to identify the exact PID on port 5050, kill only that PID, never a blanket pattern match. Before editing any shared file: `git status`/`git diff` on that specific file first. No `git stash` of the full tree at any point.

## Credential discipline

No `.env` edit, no credential of any kind added in this phase. Sentry (C10-028) and external connectors (C10-016, C10-030) are wired at the code level only where that is possible without a credential, and marked CONFIG REQUIRED / CREDENTIAL BLOCKED for the parts that genuinely need one.
