# OOPLIX GAP CLOSURE — PHASE 1 WORK QUEUE

**Date:** 2026-09-09
**Source:** `reports/OOPLIX-380-MASTER-COVERAGE-MATRIX.md` (30 C/D/E/F items) +
`reports/OOPLIX-380-STRATEGIC-BUILD-ORDER.md` (commercial-leverage ranking) + direct repo
verification performed this session (see item WQ-0 below, found during Phase 0/1 cross-check, not
pre-listed in the matrix as a distinct row since it's a depth-gap under existing item #23).

**Scope:** P0 and P1 items only get worked in Phase 2. P2-P4 items are recorded here for
completeness/traceability but are NOT worked this run. No G (FUTURE SPECIALIZATION) item is
queued, per instruction.

---

## WQ-0 — Reliability (item #23) depth gap: platform `*State.cjs` files lack the same test-data
isolation `missionMemory.cjs` already received

**Not a new 380-taxonomy item** — this is additional evidence discovered this session for the
*same* item #23 (Reliability, matrix status C) rather than a new numbered item. Recorded first
because it materially changes what "closing #23" requires.

**Evidence (direct verification, not assumed):**
- The concurrent session already fixed `backend/services/missionMemory.cjs` to honor
  `JARVIS_TEST_DATA_SUFFIX` (redirects `MISSIONS_FILE` to an isolated per-run file when set), and
  added `process.env.JARVIS_TEST_DATA_SUFFIX = ...` at the top of
  `tests/runtime/{civ-v9,eco-v8,ent-v7,eos-v6,auto-v10}.test.cjs`. Verified this run: executing
  `node --test tests/runtime/civ-v9.test.cjs` produced isolated files
  `data/missions.test-<pid>-<ts>.json`, and `data/missions.json`'s SHA-256
  (`1c8d9638...ab6807`) was **unchanged** before/after — the missionMemory half of the fix is
  real and working.
- However, that same test run surfaced a **live, un-fixed sibling defect**: `civ-v9.test.cjs`'s
  `addConstitutionalArticle — ok` test failed with `FAIL: addArticle failed: Article 100 already
  exists`. Root cause traced directly: `backend/services/civilizationState.cjs` writes to
  `data/civilization/constitution.json` via a hardcoded `DATA_DIR` (no `JARVIS_TEST_DATA_SUFFIX`
  gating at all). Inspecting that live file found `articleNumber: 100`, title
  `Article-1782601786114`, `adoptedAt: "2026-06-27T23:09:46.128Z"` — i.e. **real, still-present
  production-data pollution from an unisolated test run on 2026-06-27**, predating even Mission
  97/98's `missions.json` repair. This test run (mine) did not add to it — confirmed by checking
  all 7 articles' `adoptedAt` timestamps, all `2026-06-27`, none from today — the test correctly
  refused to double-write, which is why it failed rather than silently corrupting further.
- Grepped all 9 `*State.cjs` files backing the 5 platform test suites for the same pattern
  (`path.join(__dirname, ...)` DATA_DIR with no `JARVIS_TEST_DATA_SUFFIX` check): **all 9 are
  unguarded** — `aeoState.cjs`, `akoState.cjs`, `autonomousState.cjs`, `civilizationState.cjs`,
  `ecosystemState.cjs`, `enterpriseState.cjs`, `engineeringOrgState.cjs`, `executiveState.cjs`,
  `platformState.cjs`.

**Actual gap:** the concurrent session's isolation fix for item #23 covers only the *shared*
mission store (`missionMemory.cjs`), not each platform's own *domain* data store. Running the
5 platform suites still risks writing real records into `data/{aeo,ako,autonomous,civilization,
ecosystem,enterprise,engorg,eos,platform}/*.json` — the same defect class Mission 97/98
documented and (partially) fixed, still open in 9 files.

**Reuse candidate:** the exact `JARVIS_TEST_DATA_SUFFIX` convention already proven in
`missionMemory.cjs` / `agentInstanceRegistry.cjs` / `skillRegistry.cjs` /
`businessDataService.cjs` / `toolExecutionLayer.cjs`. No new mechanism needed.

**Priority: P0** (same class as item #23's existing P0, and it's the literal continuation of an
in-progress P0 fix already proven correct for one file).

**Implementation action:** extend `DATA_DIR`/`DIR` construction in each of the 9 files to the
same conditional-suffix pattern, additive-only (byte-identical resolution when the env var is
unset). This is the smallest root-cause fix matching an existing pattern (CLAUDE.md §16/§22).

**Verification method:** re-run `node --test tests/runtime/civ-v9.test.cjs` (and the other 4
platform suites) after the fix; confirm (a) tests pass or fail for reasons unrelated to
state-file collision, (b) `data/<domain>/*.json` files' mtimes/hashes are unchanged before/after,
(c) isolated `data/<domain>/*.<suffix>.json` files are created instead.

---

## Full 30-item queue (from the matrix's C/D/E/F rows)

| # | Name | Status | Evidence (matrix) | Actual gap | Priority | Reuse candidate | Action this run |
|---|---|---|---|---|---|---|---|
| 23 | Reliability | C | Mission 98 fixed symptom; isolation fix queued | See WQ-0 above — partially fixed (missionMemory.cjs done), 9 sibling `*State.cjs` files still unguarded | **P0** | `JARVIS_TEST_DATA_SUFFIX` pattern | **WORK THIS RUN** |
| 19 | Integration | C | 8/62(65) connectors have `CONNECTOR_CAPABILITIES` metadata, 54/57 don't | Real, but large (54-57 connector metadata authoring) — verified scope, not begun this run given P0 priority + time budget | P1 | `capabilityRouting.cjs`, `integrationConnectors.cjs`'s existing `CONNECTOR_CAPABILITIES` shape | Deferred to next Phase 2 continuation (see NEXT ACTION) |
| 340 | Connector Registry | C | Same as #19 | Same as #19 (identical underlying gap, different taxonomy label) | P1 | Same | Deferred, tracks with #19 |
| 345 | Integration Registry | C | Same as #19 | Same as #19 | P1 | Same | Deferred, tracks with #19 |
| 41 | Billing | E | Code-complete, not verified against live credentials | Genuinely externally blocked — no real Razorpay/Stripe credentials in this environment | P1 | n/a | **BLOCKED — REQUIRES PROVIDER** (live credentials + provider approval) |
| 43 | Payment | E | Same as #41 | Same as #41 | P1 | n/a | **BLOCKED — REQUIRES PROVIDER** |
| 115 | Deployment | E | Code/scripts done, never run against real VPS | Externally blocked — no real VPS in this environment; also explicitly out of scope for this run (ERA-1 infra excluded) | P1 | n/a | **BLOCKED — REQUIRES INFRASTRUCTURE** (also explicitly out of run scope) |
| 116 | Infrastructure | E | Same as #115 | Same as #115 | P1 | n/a | **BLOCKED — REQUIRES INFRASTRUCTURE** (out of scope) |
| 133 | Backup | C | Mechanism done, RPO/RTO now approved (12h/4h) but not yet implemented in cron/scripts | Real gap, but implementing it means editing `deploy/`-adjacent backup cadence — explicitly named as excluded ERA-1 infra work in this run's SCOPE section | P1 | `scripts/safe-backup.cjs`, PM2 `cron_restart` | **OUT OF SCOPE this run** (explicit exclusion) |
| 134 | Disaster-Recovery | C | Scripted, never live-executed (no real VPS) | Externally blocked (no VPS) + out of scope (ERA-1 infra) | P1 | n/a | **OUT OF SCOPE this run** (explicit exclusion) |
| 4 | Privacy | C | Export exists, no full DSAR lifecycle | Real but narrow feature gap, not a defect | P3 | `gdprExportService.cjs` | Not worked (P3) |
| 9 | Risk | D | Internal signal, not verified as standalone product surface | Not a defect — internal signal working as designed | P3 | n/a | Not worked (P3) |
| 37 | Performance | D | Composed inside Analytics dashboard, not isolated | Not a defect | P3 | n/a | Not worked (P3) |
| 40 | Accounting | F | No GL/bookkeeping subsystem | Genuinely missing; strategic doc recommends 3rd-party integration (QuickBooks/Xero) over native build | P3 | n/a | Not worked (P3, marketplace-first per build-order doc) |
| 46 | Tax | F | No tax engine | Same reasoning as #40 | P3 | n/a | Not worked (P3) |
| 48 | Budget | D | Composed inside org dashboards, not standalone | Not a defect | P3 | n/a | Not worked (P3) |
| 88 | Order | F | No merchant order-lifecycle engine | Missing, vertical-specific, zero demand signal per build-order doc | P4 | n/a | Not worked (P4, explicitly excluded from Top 50) |
| 89 | Inventory | F | No inventory engine | Same as #88 | P4 | n/a | Not worked (P4) |
| 104 | Compensation | F | No comp-management subsystem | Solo-founder tool, defer until headcount | P4 | n/a | Not worked (P4) |
| 106 | Payroll-HR | F | No payroll engine | Marketplace-first (Gusto/Deel) per build-order doc | P4 | n/a | Not worked (P4) |
| 117 | Cloud | D | No multi-cloud abstraction beyond single-VPS deploy pattern | Not a defect; no multi-cloud need evidenced | P3 | n/a | Not worked (P3) |
| 127 | Device | C | Physical/IoT device sense done (P17); corporate-endpoint/MDM sense missing | Real gap but zero demand signal (no company-managed devices at scale) | P3 | n/a | Not worked (P3) |
| 132 | Cloud-Infrastructure | D | Same as #117 | Same as #117 | P3 | n/a | Not worked (P3) |
| 192 | Translation | F | No i18n/translation service | Real gap; strategic doc recommends marketplace integration (DeepL) | P3 | n/a | Not worked (P3) |
| 193 | OCR | F | No OCR service | Real gap, zero demand signal | P4 | n/a | Not worked (P4) |
| 245 | POS | F | No POS subsystem | Zero relevance to product's customer base | P4 | n/a | Not worked (P4) |
| 249 | Retail-Inventory | F | Same as #89 | Same as #89 | P4 | n/a | Not worked (P4) |
| 257 | Manufacturing-Inventory | F | Same as #89 | Same as #89 | P4 | n/a | Not worked (P4) |
| 285 | Time-Tracking | F | No timesheet subsystem | Real gap, plausible future ask, but not current | P3 | n/a | Not worked (P3) |
| 295 | Science | C | Scoped narrowly to self-improvement research, not general science vertical | Not a defect — scope question for founder, not a code gap | P3 | n/a | Not worked (P3) |

## A/B items with noted correctness defects (scanned per instruction, not part of the 30-item C/D/E/F count)

| # | Name | Status | Note | Disposition |
|---|---|---|---|---|
| 56 | CRM | A | Matrix row flags "unscoped-call class defect" at `backend/routes/index.js:340` (code comment) | **Verified ALREADY MITIGATED** — `crmService.getStats(orgId)` already takes `orgId` (confirmed: `backend/services/crmService.js:160`); `requireOrgMember` already applied on `/business/x` in `index.js`. Residual limitation (some backing stores have no orgId concept) is explicitly documented in a code comment rather than silently left unscoped. No further action needed this run — not a new gap. |
| 24 | Marketplace | A | In-progress uncommitted IDOR fix in concurrent working tree | Belongs to concurrent session (rule #10) — not this run's item. Will be verified only if it's touched incidentally. |
| 17 | Workflow | A | In-progress uncommitted `missionOrchestrator.cjs` rolledback-state fix | Same — concurrent session's item, not queued here. |
| 13 | Memory | A | In-progress uncommitted `missionMemory.cjs` secret-redaction fix | Same — concurrent session's item. Note: this is the SAME FILE as WQ-0's fix target, so WQ-0's edit must be surgical and additive-only around the concurrent session's redaction work, not a rewrite. |

---

## PRIORITY SUMMARY

- **P0: 1 work item** (WQ-0 / item #23 depth-completion) — WORKED THIS RUN.
- **P1: 8 items** (#19/#340/#345 connector-metadata cluster, #41/#43 billing/payment, #115/#116
  deployment/infra, #133/#134 backup/DR) — all either genuinely externally blocked, or explicitly
  out of this run's scope (ERA-1 infra), or deferred to a future continuation due to size
  (connector metadata authoring for 54-57 connectors is real, scoped, well-understood work but not
  a "smallest possible fix" — it's a dedicated follow-on mission per the build-order doc's own
  Top-10 #1 recommendation).
- **P2: 0 items** queued from the 30-item matrix set (none of the C/D/E/F rows carried a P2 tag).
- **P3: 12 items** — recorded, not worked (feature gaps, not defects, or marketplace-first
  candidates per strategic doc).
- **P4: 8 items** — recorded, not worked (zero demand signal, explicitly excluded from Top 50 in
  the strategic build-order doc).

## THIS RUN'S ACTUAL WORK

Given the P0/P1 breakdown above, this run's Phase 2 implementation work is:
1. **WQ-0 (item #23 depth-completion)** — the only item that is P0, unblocked, in-scope, and has
   a minimal existing-pattern fix available. Worked below.
2. All 8 P1 items are either BLOCKED (external credentials/infrastructure) or OUT OF SCOPE
   (explicit ERA-1 infra exclusion) or correctly deferred as a larger, separately-scoped mission
   (connector metadata authoring). None are silently skipped — each gets an explicit
   BLOCKED/OUT-OF-SCOPE/DEFERRED classification in the progress report rather than a guess.

This is consistent with the task brief's explicit permission to close a "clean, well-verified
partial checkpoint" rather than all 30 items.
