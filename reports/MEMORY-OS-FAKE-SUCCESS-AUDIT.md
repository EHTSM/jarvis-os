# MEMORY OS FAKE-SUCCESS — AUDIT

**Track:** OOPLIX V1 Master Audit — next unresolved item after Invitation Flow
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Prior findings referenced:** B.25 line 309 (JWT logout revocation), GG-1 (IP allowlist enforcement),
C10-003/C10-004/C10-009 (`reports/C10-FINAL-CLOSURE-INVENTORY.md`).

---

## Why this item

Reconciled the register against current code before selecting:

- **B.25's "JWT logout revocation — STILL OPEN"** (line 309) is **stale**. `authMiddleware.js` already
  contains a real `jti`-based revocation ledger (`data/revoked-tokens.json`, `revokeToken()`,
  `_isRevoked()`), fixed by an earlier `C10-027` pass this session. Live re-confirmed this pass: a
  real token returns `200` on `/auth/me` before logout, `401` on the identical token immediately
  after. No action needed; recorded as closed-by-prior-fix.
- **GG-1's IP allowlist enforcement gap** is already closed — confirmed `assertIpAllowed()` wired into
  `enterpriseAudit.js`, `enterpriseMonitoring.js`, `enterpriseDashboard.js`, matching the register's
  own GG-1 closure section from an earlier mission this session.
- **C10-003** (Developer OS zero `orgId` concept) is already fixed — `agents/runtime/developerOS.cjs`
  now has 194 real `orgId` occurrences and `backend/routes/ops.js`'s `/dev/*` routes require
  `requireOrgMember`, confirmed by direct source read.
- **C10-009** (Knowledge OS frontend entirely fabricated) is already fixed —
  `frontend/src/components/KnowledgeCenter.jsx` was rewritten to a real `/org-graph/:orgId` data
  source (the file's own header comment, dated 2026-08-15, predates this session's visible mission
  arc — a prior pass, not stale register text).
- **C10-004** (Memory OS's 3 backend engines — `engineeringMemoryEngine.cjs`, `unifiedMemoryEngine.cjs`,
  `learningMemoryEngine.cjs` — have zero `orgId` concept) was investigated in depth as the leading
  candidate, then **reclassified, not selected**: live inspection of what this data actually is
  (`engineeringMemoryEngine.cjs`'s own header comment: "lessons", "RCAs", "patch history", "pipeline
  runs" — all about Ooplix's own codebase) and where it's surfaced (`AutonomousAgentDashboard.jsx`,
  an engineering/dev-console component, not a customer CRM view) confirmed this is genuinely shared
  platform-engineering knowledge, not per-customer tenant data requiring `orgId` isolation. This is
  the same class of template/reality mismatch C.10 itself already corrected for "Sales OS"/"Finance
  OS" — forcing a tenant-isolation framing onto data that was never tenant-scoped by design would be
  a false classification, not a genuine finding.

While investigating that reclassification, a **different, previously undocumented, genuinely open P1**
was found: the confidentiality question was real (this data — while not "cross-tenant" in the CRM
sense — is still internal engineering data reachable by any authenticated customer, since the
`agentruntime` tab carries no `operatorOnly` gate at either the frontend or backend layer), but a
more clear-cut, more classically in-scope defect was found one click away: `MemoryOSV2.jsx` (the
`"memory"` tab, also customer-reachable, no operator gate) was **silently presenting fabricated data
as a real, healthy state whenever its backend calls genuinely failed** — the exact "fake success"
class this entire audit programme (C.2's C2-01/C2-02, C.9's `AICostCenter.jsx`, C10-009's
`KnowledgeCenter.jsx`) is built around finding and fixing, and a cleaner, more decisively in-scope
match for this mission's priority order than the operator-gating question, which would require a
product decision (should this be operator-only? role-gated?) rather than a narrow, evidence-driven
fix.

## Discovery

`frontend/src/components/MemoryOSV2.jsx` (`"Memory OS"` tab, `frontend/src/App.jsx`'s `tab === "memory"`,
no operator role check) renders 5 sub-tabs. Investigation of each:

- **Memory Index** (`TabIndex`) — calls real `listMemoryNodes()`/`memoryStats()`
  (`/p18/memory`, `/p18/memory/stats`), both confirmed live-healthy (`success:true`, 2000 real
  archived memory nodes). Already has a correct, honest `apiDown===true` failure UI
  ("Memory API not available… Contact your administrator").
- **Shared Fabric** (`TabShared`) — entirely hardcoded (`SHARED_NODES`), but carries a visible
  "BETA" badge and "under development" disclosure. Not a genuine defect — honest disclosure,
  matching this session's own established precedent for disclosed mock content.
- **Intelligence** (`TabIntelligence`) — entirely hardcoded (`AI_INSIGHTS`), same honest "BETA"
  disclosure. Not a genuine defect.
- **Knowledge** (`TabKnowledge`) — hardcoded `SEED_DOCS` fallback, but also carries an honest "BETA"
  banner ("Existing documents shown below") plus a real `getKnowledge()`/`deleteKnowledge()` API
  wiring attempt. Not a genuine defect.
- **Search** (`TabSearch`) — calls real `searchMemory()` (`/p18/memory/search`, confirmed live-healthy).
  **No disclosure banner anywhere in this tab.**

## The defect

Two related call sites, same root cause, in the root `MemoryOSV2` component and in `TabSearch`:

1. **`refresh()`'s `catch` block** (root component, feeds `TabIndex`):
   ```js
   } catch {
     setApiDown(false); // keep SEED_ENTRIES, don't mark down
   }
   ```
   `_fetch` (`_client.js`) always throws a real `Error` on a non-2xx HTTP response or network failure
   — this is not a hypothetical path. Live-reproduced the underlying failure condition directly: an
   unauthenticated request to `/p18/memory` and `/p18/memory/search` both correctly return `401` (a
   real, always-available trigger for this catch block — e.g. session expiry mid-session). On any
   such failure, `apiDown` was explicitly forced to `false` — the opposite of honest — silently
   presenting `SEED_ENTRIES` (10 fabricated memory entries: fake lead names, fake WhatsApp batch
   sends, fake payment errors) as a normal, healthy result. `TabIndex` already contains a correct,
   honest `apiDown===true` branch that this exact bug prevented from ever being reachable in
   practice.

2. **`TabSearch`'s `doSearch` `catch` block**: fell back to `_localSearch(q)`, a local filter over
   `allEntries` (which is `SEED_ENTRIES` whenever `refresh()` had also failed), presenting fabricated
   search hits with the exact same UI as a genuine live search result — no error, no disclosure, no
   "BETA" banner anywhere in this tab.

This is materially the same defect class C.2 (C2-01: "no active missions" while the session had
expired; C2-02: "✓ benchmark runs completed" for a run that failed) already found and fixed elsewhere
in this audit programme — a real failure silently converted into an indistinguishable-from-real
success state.

## Fix

- `refresh()`'s `catch` block now calls `setApiDown(true); setIsLive(false);` instead of
  unconditionally clearing `apiDown` to `false` — reusing `TabIndex`'s own pre-existing, correct
  honest-failure UI rather than building anything new.
- `TabSearch`'s `doSearch` `catch` block now sets a real `searchError` message (surfaced in a new,
  minimal "Search failed" UI block matching the existing empty-state visual pattern already used
  elsewhere in the same file) instead of silently substituting fabricated local results. The
  now-dead `_localSearch` function (and the `allEntries` prop that only it consumed) was removed
  entirely, not merely left unreferenced.

No new architecture — both fixes reuse UI/state patterns already present in the same file.

## Live re-verification

- Confirmed the real failure trigger still exists and is reachable: unauthenticated `GET /p18/memory`
  and `GET /p18/memory/search` both correctly return `401` — the exact condition the `catch` blocks
  handle.
- Confirmed the healthy path is unaffected: authenticated `GET /p18/memory` and
  `GET /p18/memory/stats` both return real data (`success:true`, 2000 archived nodes) after a full
  server restart.
- **Verified the fix in the actual served production bundle, not just source.** Located the real lazy
  chunk (`frontend/build/static/js/6183.bb28443d.chunk.js`, confirmed to be the chunk `MemoryOSV2`
  compiles into by searching for its unique strings). The minified `refresh()` catch block reads
  `catch(e){M(!0),z(!1)}` — `setApiDown(true)`, `setIsLive(false)` — confirming the fix is present in
  what a real browser would actually load, matching the exact pattern this session already used to
  verify prior frontend fixes (e.g. G2-B195 in B.25).
- Confirmed the pre-fix defect string (`"keep SEED_ENTRIES"`) is absent from the built bundle (0
  occurrences).

## Regression

- Added 2 tests (describe block `122-master-audit-memory-os-fake-success`) to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`. Negative-tested — reverted each of the two
  fixes independently, confirmed each failed with its exact expected assertion message, restored both.
- `npm run test:runtime`: **233/233** (231/231 baseline + 2 new tests).
- Production build: clean, no new warnings, fix confirmed present in the actual served chunk.
- `.env`: confirmed untouched throughout.

---

## AUDIT NAME: Memory OS Fake-Success Masking (MemoryOSV2.jsx)

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.2/10
**CONFIDENCE:** 85%

## V1 SURFACE

- **Backend:** none changed — `/p18/memory*` routes (`phase18.js`) were already correct and
  unaffected; investigated and confirmed healthy, not modified.
- **Routes:** `GET /p18/memory`, `GET /p18/memory/stats`, `GET /p18/memory/search` — all live-tested,
  confirmed healthy and unaffected by this frontend-only fix.
- **Frontend:** `frontend/src/components/MemoryOSV2.jsx` — 2 related fixes (root `refresh()` catch
  block, `TabSearch`'s `doSearch` catch block + dead-code removal).
- **Persistence:** N/A — no state persisted by this fix; purely a client-side failure-handling
  correction.
- **Authentication:** PASS — unaffected; the real `401` on an unauthenticated request (the concrete
  trigger for this bug) continues to behave correctly.
- **Authorization:** investigated but out of this fix's scope — this tab and its sibling
  `AutonomousAgentDashboard.jsx`/`agentruntime` tab carry no `operatorOnly` gate despite showing
  internal platform-engineering data to any authenticated customer; documented as a limitation below,
  not fixed this pass (a product/architecture decision, not a narrow evidence-driven fix).
- **Tenant Isolation:** N/A — reclassified during investigation: this data (Memory OS's underlying
  `/p18/memory` backend) is genuinely shared platform-engineering knowledge, not per-customer tenant
  data: no cross-tenant boundary applies here in the way it does for CRM/business data.
- **Cross-OS:** N/A — a single-component frontend fix, not a cross-OS composition.
- **Failure Honesty:** PASS after fix — this was precisely a failure-honesty defect; now resolved for
  both identified call sites, reusing the component's own pre-existing honest-failure UI pattern.
- **Live Verification:** every claim backed by real HTTP requests (including a real `401` trigger) and
  direct inspection of the actual built, served production JS bundle — not source-only reasoning.
- **Regression:** 233/233 (231/231 baseline + 2 new tests, 0 weakened).

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed (2 call sites, same root cause) — a customer-facing "Memory OS" tab
  silently presented fabricated data as a normal, healthy state whenever its real backend calls
  failed, with an explicit comment instructing exactly that ("keep SEED_ENTRIES, don't mark down").
  The component's own honest-failure UI existed but was unreachable due to this bug.
- **V1-critical P2:** 0
- **Other:** 3 register entries reconciled as stale/already-resolved without re-auditing (B.25 JWT
  revocation, C10-003 Developer OS org-scoping, C10-009 Knowledge OS fabrication); 1 leading
  candidate (C10-004, Memory OS backend org-scoping) investigated and correctly reclassified as not a
  genuine tenant-isolation gap, avoiding a false-positive fix in the wrong direction (mirrors C.10's
  own "Sales OS"/"Finance OS" reclassification methodology).

## FIXES

- `frontend/src/components/MemoryOSV2.jsx`: `refresh()`'s catch block now sets `apiDown(true)` /
  `isLive(false)` on a real failure instead of unconditionally clearing `apiDown` to `false`.
- `frontend/src/components/MemoryOSV2.jsx`: `TabSearch`'s `doSearch` catch block now surfaces a real
  `searchError` message instead of silently substituting fabricated local search results; removed the
  now-dead `_localSearch` fallback function and its unused `allEntries` prop.
- 2 new regression tests, both independently negative-tested.

## LIMITATIONS

- `MemoryOSV2.jsx`'s "Shared Fabric" and "Intelligence" sub-tabs remain entirely hardcoded — left
  alone deliberately, since both already carry an honest, visible "BETA / under development"
  disclosure banner (not a hidden fabrication) — building real backing for either would be new
  architecture, out of scope for an audit-recovery pass.
- The confidentiality/authorization question raised during investigation — internal platform
  engineering data (RCAs, patch history, mission failure records about Ooplix's own codebase) being
  reachable by any authenticated customer account via the `agentruntime` tab and its underlying
  `/memory/*`, `/memory-index/*`, `/p18/memory/*` routes, none of which carry an `operatorOnly` gate
  — was identified but **not fixed this pass**. This is a real, live-confirmed reachability fact
  (verified: a genuinely ordinary customer test account successfully read real RCA titles and
  knowledge-growth stats via `/memory/stats` and `/memory/timeline`), but whether it should be
  operator-only, role-gated, or intentionally shared is a product decision outside a narrow
  evidence-driven audit fix — documented here for a future mission to pick up as a distinct,
  actionable item if the answer is "should be gated."
- This fix addresses the 2 call sites found in `MemoryOSV2.jsx` specifically; the broader
  `AutonomousAgentDashboard.jsx`/`EngineeringMemoryPanel.jsx` surface (a separate component sharing
  some of the same backend routes) was not independently re-audited for the same fake-success pattern
  this pass — out of scope, not claimed as clean.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Reconciles 3 stale register entries without unnecessary re-audit work, correctly declines a
false-positive fix direction (C10-004's tenant-isolation framing), and finds and fixes a genuine,
previously undocumented P1 fake-success defect in a customer-reachable tab — directly in the pattern
this entire audit programme (C.2, C.9, C10-009) exists to catch. Surfaces one real, unresolved
authorization-scoping question (internal engineering data reachable by ordinary customers) as a
documented, distinct candidate for a future mission rather than either ignoring it or overreaching
into an architectural decision this pass wasn't scoped to make. No OS-track record altered.

## REGRESSION RESULT: 233/233 (0 failures, 0 skipped, 2 net new tests)

## BUILD RESULT: PASS (clean, fix confirmed present in the actual served production bundle)
