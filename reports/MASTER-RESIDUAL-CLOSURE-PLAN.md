# MASTER RESIDUAL CLOSURE — PLAN

Date: 2026-08-15 · Branch: `security/reality-completion`
Source of truth: `reports/MASTER-OPEN-FINDINGS.md` (36 remaining items after Master Recovery's 5 fixes + 1 correction)

---

## Method

Read `MASTER-OPEN-FINDINGS.md`, `MASTER-RECOVERY-FINAL.md`, and `MASTER-RECOVERY-PROGRESS.md` in full before any change (Section 0). Worked in the mission's priority order (P0/P1 security → P1 core workflow → P1 cross-OS → P2 → P3 → credential/config → post-V1). No new worklist invented.

## Items processed this phase

| Priority | ID | Action |
|---|---|---|
| 1 | C10-009 (Knowledge OS frontend) | **BUILT** — real graph-explorer UI wired to `/org-graph/:orgId/*`, replacing 100% fabricated document-library UI. Live-verified with two real tenants. |
| 2 | C10-017 (businessDataService opt-in scoping) | **FIXED** — audit of all `business.js` call sites found them all correctly scoped (confirming prior sessions' work); audit of the other 10 consumers found a genuine, previously-undocumented **live cross-tenant leak** in `unifiedIntelligenceLayer.cjs` (`GET /intelligence/unified/executive` and 4 sibling routes), reproduced live, fixed, then a SECOND vulnerability (forged `X-Org-Id` header bypass) found in the first fix's own gate and closed with `requireOrgMember`. |
| 3 | C10-012 (Support OS frontend) | **DEFERRED this phase** — explicit user decision to prioritize P1 security items first; SupportCenter.jsx already has an honest sample-data disclosure (not misleading), so deferring carries no honesty risk. |
| 4 | C10-005, C10-004b, C10-006, C10-010, C10-024 | **VERIFY — canonicality decisions documented below**, per Section 5's explicit instruction, without unilateral consolidation or deletion of existing data. |
| 5 | C10-007, C10-008, C10-026, remaining DEFERRED/OUT OF SCOPE/CREDENTIAL BLOCKED items | **Unchanged dispositions carried forward** — each already has a specific, evidenced reason from Master Recovery; re-confirmed still accurate, not re-investigated from scratch where no new evidence emerged. |

## Canonicality decisions (Section 5)

### Memory OS (C10-005, C10-004b)

Three memory-adjacent systems exist:
- **`/p18/memory/*`** (phase18 legacy) — **CANONICAL for user-facing "Memory" UI** (`MemoryOSV2.jsx` uses it today; changing this would break a live UI surface without a migration plan).
- **`/memory/*`** (`engineeringMemoryEngine.cjs`) — **LEGACY / READ-ONLY AGGREGATOR**. Does not store anything itself; aggregates 14 other engines. Correctly left as-is — it is a query surface, not a data store, so "canonical vs legacy" doesn't apply to it directly.
- **`/memory-index/*`** (`unifiedMemoryEngine.cjs`) — **DEPRECATED / UNWIRED**, by its own route-mount comment ("previously built but unwired"). No live consumer found. Recommend: do not build new consumers against this; do not delete without confirming zero hidden consumers first.
- **The 13 underlying engineering-memory source engines** (rule registry, RCA engine, pipeline coordinator, decision engine, smell detector, confidence engine, viz engine, knowledge graph, etc.) — **PLATFORM-GLOBAL by design**. None store tenant-identifiable business/customer data (confirmed again this phase — they hold coding rules, failure patterns, pipeline run history). Classification: **PLATFORM-GLOBAL, not a gap** — the original C10-004b concern (P1/P2, "zero orgId") is downgraded on inspection: these were never meant to be tenant-scoped, unlike missionMemory (which legitimately holds tenant-owned mission records) and unifiedIntelligenceLayer's business-state reads (which legitimately holds tenant-owned CRM data, and where the leak was real and is now fixed).

**Decision required from a human for full consolidation:** whether `/memory-index/*` should be wired up as the eventual canonical replacement for both `/memory/*` and `/p18/memory/*`, or removed. Not decided here — no data destroyed, no consumer redirected without this decision.

### Executive/Finance (C10-006)

**Decision: `/business/dashboard` (real, org-scoped, tested throughout this session) is the correct V1-facing "executive view" for a regular org owner.** `/eos/v6/*` is confirmed **PLATFORM-GLOBAL**, operator-only by design (real platform aggregate across every tenant) — not a bug, not something to open up to regular org owners, since doing so would itself be a cross-tenant leak of the exact same class just fixed in C10-017. `/org-executive/:orgId/*` exists and is genuinely org-scoped but was not live-tested this session; recommend a follow-up to confirm whether it duplicates `/business/dashboard` or adds distinct value before deciding whether to surface it in the UI as "Executive OS."

**No unification performed.** These are correctly three different scopes (platform-wide operator view / per-org business view / per-org executive view of uncertain relationship to the second) — collapsing them without confirming `/org-executive/:orgId/*`'s actual content risks either duplicating work or hiding a real gap.

### Enterprise OS (C10-010)

**Decision: `organizationService.cjs` (used by A/K, and by every fix in this entire C.9→Master Recovery→this session arc) is CANONICAL for organization/membership.** The UI-connected `enterpriseOS.cjs` engine (inlined in `ops.js`) is classified **LEGACY — real, functioning, but running its own independent membership model**, not yet migrated. **Not consolidated this session** — re-pointing a live UI-connected engine at a different membership model without a data migration plan risks silently orphaning or duplicating real enterprise-tier customer records. This requires a dedicated migration-planning pass, not a code-only fix.

### Load-test claims (C10-024)

**Not re-verified this session** (no realistic-concurrency test infrastructure was set up). Recommendation unchanged from Master Recovery: do not make a "load-test verified" claim publicly until re-run at realistic concurrency (the existing test caps at 20 concurrent, confirmed insufficient for a production claim).

## Concurrency safety

Confirmed the parallel session (visible earlier this arc as edits to `backend/routes/index.js` and others) is not touched by any change in this phase — every file edited this session was verified via `git status`/read-before-edit, no blanket process kills used (each `kill -9 <PID>` targeted the specific PID confirmed via `lsof` to be listening on port 5050, the audit track's own port).
