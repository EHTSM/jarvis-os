# MEMORY / KNOWLEDGE STORAGE AUTHORIZATION & TENANT-ISOLATION AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-21 · **Branch:** `security/reality-completion`

---

## Scope

Audited `missionMemory.cjs`, `unifiedMemoryEngine`, `engineeringMemoryEngine`,
`memoryPersistenceLayer.cjs`, `knowledgeGraph.cjs`, all mounted `/p18/memory/*` routes, and their real
frontend consumers (`SharedMemoryCenter.jsx` and any other genuine caller).

## Pre-Audit Reconciliation

Two items were already flagged **DECISION REQUIRED** by 3+ prior missions this session and were
explicitly NOT re-litigated, per this mission's own instruction:

- **C10-005** (3 non-reconciled memory backends) — remains a genuine product/architecture decision,
  not a proven defect. Left untouched.
- **`/p18/memory/*`'s read side** (`GET /p18/memory`, `/stats`, `/search`, `/recall`, `/:nodeId`) —
  confirmed still `requireAuth`-only with zero orgId concept, exactly as the "Memory/ACP Authorization
  Boundary Audit" mission found. `SharedMemoryCenter.jsx` is confirmed still the real, live, read-only
  customer-facing consumer. Whether these reads should stay customer-facing, become operator-only, or
  be redesigned with real tenant scoping remains a genuine product decision this audit did not have
  the authority to make — **left DECISION REQUIRED, not guessed at**.

Also reconfirmed (unchanged since prior missions): `/memory/*` (ACP-10, `engineeringMemory.js`) and
`/memory-index/*` (`unifiedMemoryIndex.js`) both remain correctly `operatorOnly`-gated at the
`index.js` mount level. `missionMemory.cjs` has no standalone route of its own — its optional orgId
filter is threaded correctly by every route file that calls it (already audited/fixed in prior
missions this session: `business.js`, `codingAssistant.js`, `customerOrg.js`). `knowledgeGraph.cjs`'s
route surface (`graph.js`) was fully audited and fixed last mission — not re-audited here per the
explicit "do not re-audit already-certified atomic persistence" instruction.

## Genuine Vulnerability Found — 1, proven live, narrower than the architecture question above

**`POST`/`PATCH`/`DELETE /p18/memory*` — unauthorized cross-tenant destructive mutation (P1).**
Distinct from the read-side architecture question: this is not "should shared knowledge be readable,"
it's "can an unrelated customer tamper with or delete another org's data with zero ownership check at
all." Live-reproduced with two fresh ordinary customer accounts: org B read, overwrote (`PATCH`), and
permanently deleted (`DELETE`, `archive()`) org A's real memory node by ID — full read/write/delete
with zero check that B had any relationship to the node whatsoever.

`memoryPersistenceLayer.cjs`'s `save()`/`update()`/`archive()` have no orgId parameter anywhere in
their signatures — genuinely shared platform operational memory, used internally by many autonomous
systems (`missionMemory.cjs`, `akoWorkflow.cjs`, `autonomousTaskLoop.cjs`, `releaseEngine.cjs`,
`continuousRuntimeObserver.cjs`, and 9 more — confirmed via direct grep, not assumed). Redesigning it
to be tenant-scoped would be exactly the architecture expansion this mission's rules forbid.

**Confirmed no legitimate customer-facing feature needs the write/delete capability.** Traced every
real frontend caller of `saveMemoryNode`/`updateMemoryNode`/`archiveMemoryNode`
(`frontend/src/phase18Api.js`'s wrappers): only `MemoryCenter.jsx` calls them — and `MemoryCenter.jsx`
is **not imported or rendered anywhere in `App.jsx`**, confirmed dead/unreachable code (its only other
reference anywhere in the frontend is a static string inside `DeveloperCopilotV2.jsx`'s own mock
code-review-findings array, not a real import). `SharedMemoryCenter.jsx` — the one genuinely live
customer-facing consumer — is confirmed read-only; it never calls save/update/delete.

## Fix

Gated the 3 mutation routes (`POST /p18/memory`, `PATCH /p18/memory/:nodeId`, `DELETE /p18/memory/
:nodeId`) `operatorOnly` — the same, already-established mechanism used throughout this codebase for
exactly this shape of gap. All `GET /p18/memory*` routes deliberately left untouched, preserving the
existing (undecided) read-side product behavior exactly as-is — no widening, no narrowing.

## Live Verification

Verified against the real, restarted production server with a fresh ordinary customer account: the
same customer that could previously `PATCH`/`DELETE` any memory node by ID now receives `403` on both,
and a real memory node's value is confirmed unchanged after the blocked attempts. `GET /p18/memory/
:nodeId` remains `200` (unchanged, undecided, documented behavior — not newly certified as correct).

## Limitations

- The broader question of whether `GET /p18/memory*` should remain customer-facing, and C10-005's
  memory-backend consolidation question, remain genuinely unresolved — this mission closed the
  narrower, provable destructive-mutation gap, not the architecture question around them.
- `unifiedMemoryEngine`/`engineeringMemoryEngine`'s own internal logic was not re-audited beyond
  confirming their route gates are unchanged (`operatorOnly`, matching prior certification) — no new
  evidence surfaced requiring deeper investigation there.

## Regression

**Before:** 428/428. **After:** 427/431 in the full concurrent run (4 failures = `155`/`155b`'s
pre-existing, session-documented transient timeout pattern under peak concurrent load — re-confirmed
6/6 passing cleanly in isolation, unrelated to this mission's change). **Effective: 431/431. New
tests:** 3 (block 165) — 2 structural + 1 live, covering the route gate, confirming `MemoryCenter.jsx`
is dead code, and the full live cross-tenant tamper/delete-rejection proof. **Negative-tested**:
reverted the `PATCH` route's gate, confirmed the targeted structural and live tests failed for the
exact expected reason (`200 !== 403`) while the independent "dead code" test correctly still passed,
restored, confirmed all 3 passed again.

**Build:** PASS (`npm run build:frontend`, clean production build).
**Security suite:** `tests/security/97-enterprise-isolation-integrity.cjs` — 8/8 PASS (after waiting
out this environment's shared registration rate-limit window).
**Server:** restarted twice (`phase18.js` is `require()`-cached), confirmed healthy after each restart.
**`.env`:** untouched. **No merge. No push.** Unrelated uncommitted work in the working tree preserved
throughout.