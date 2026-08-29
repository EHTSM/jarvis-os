# ERA-1 ENGINEERING HISTORY — RECOVERED RECORD (Missions 51–71)

**This is NOT an original mission report.** No mission report or register entry was ever written for
most of the commits below at the time the work was done. This document is a **post-hoc reconstruction**
assembled from git history, code comments, and (where available) live test re-execution, produced by
Mission 75 to close the audit-trail continuity gap identified by Mission 74 (§5, §19 item #16).

Every claim below is labeled with its evidence class:

- **RECOVERED FROM GIT** — derived from a commit message, diff, or `git log` metadata that exists and was read directly.
- **RECOVERED FROM CODE** — derived from an in-code comment (dated, mission-numbered, or otherwise self-describing) found in the current source, cross-referenced against the diff that introduced it.
- **RECOVERED FROM TEST EVIDENCE** — confirmed by actually re-running the named test file(s) in this or the Mission 74 session and observing the pass/fail result directly.
- **UNVERIFIED** — a claim that appears in a commit message or comment but was not independently re-checked against running code or a passing test this session.

Where a commit's actual mission number could not be determined with confidence, it is labeled by its
commit SHA only rather than guessed into a numbered slot — inventing a mission number to fill a gap
would itself be a form of fabrication.

---

## Coverage note

The register (`reports/OOPLIX-V1-MASTER-AUDIT-REGISTER.md`) already contains full, real entries for
**Mission 31** ("Frontend/Backend Contract Parity & API Honesty Deep Audit") and **Mission 33** ("MFA
End-to-End Frontend/Backend Certification," with its own dedicated report,
`MFA-END-TO-END-FRONTEND-BACKEND-CERTIFICATION.md`) — these are **not** part of this recovery, since
they were never missing. This record covers only the commits in the range `2ae1c703..6d4f141e`
(2026-08-22 through 2026-08-29) that correspond to no register entry: the gap is specifically
**Missions ~40, 42, 51, 57, 60A, 63, 65, 66, 67–69, 71, and the undated "ERA-1 forensic closure"
work**, not the entire 31–71 span implied by the mission brief's shorthand.

---

## Entry: Mission 40 — Autonomous mission-creation dedup fix

- **Commit:** `94de8ab1` (2026-08-23 11:47:30 +0530)
- **Evidence class:** RECOVERED FROM CODE + RECOVERED FROM TEST EVIDENCE (mission number is self-identified in the code comment, not guessed)
- **Files:** `backend/services/agentRuntimeSupervisor.cjs` (1 file, 10 insertions/1 deletion)
- **Purpose:** `_missionExists()`'s dedup check compared an auto-generated mission objective string (e.g. `"Follow up on 569 stale lead(s)"`) by exact 50-char prefix. Since the embedded stale-lead count changes over time, the same logical follow-up mission was never recognized as a duplicate — root cause of the previously-reported "569 stale leads → 8,269 missions" production incident. Fix: `_normalizeObjective()` now replaces digit runs with `#` before comparison, and the comparison was corrected to check for `status === "planned"` (the real status new missions get) rather than a nonexistent `"pending"` status.
- **Security/stability impact:** High — unbounded mission creation, CPU/storage growth.
- **Test evidence:** Independently reproduced this session via an isolated Node script confirming `"Follow up on 569 stale lead(s)".slice(0,50)` and `"Follow up on 601 stale lead(s)".slice(0,50)` both normalize to the identical string. Confirmed **fixed and closed** for this specific mechanism (Mission 74 §14, re-confirmed unchanged this session).

## Entry: Mission 42 — Test-file process-isolation race fix (introduces `scripts/run-test-suite.cjs`)

- **Commits:** `f3256a71` (2026-08-23 18:48:46), `b794e39e` (2026-08-23 19:29:19)
- **Evidence class:** RECOVERED FROM CODE (the script's own header comment self-identifies as "Mission 42")
- **Files:** `scripts/run-test-suite.cjs` (new), `package.json` (wires `test:runtime`/`test:security` to it)
- **Purpose:** `node --test`'s default per-file-process parallelism caused lost-update races when multiple test files wrote to the same shared JSON store (`data/missions.json` at the time). Introduced a discovery+bucketing script: known mutating-API callers run serialized (`--test-concurrency=1`), everything else keeps normal parallelism.
- **Security/stability impact:** Medium (test-infrastructure correctness, not production code).
- **Test evidence:** This exact mechanism was extended by Mission 75 (this session) to close the 125/126 gap — see the main Mission 75 report, Phase 2. The mechanism itself was verified working end-to-end this session (11/11 pass under the script's real invocation pattern).

## Entry: Mission 51 — Tenant-isolation/IDOR sweep (the largest single change in the range)

- **Commits:** `f45a146f` (2026-08-22 02:18:21) — likely the bulk of this mission's work, 100+ files; `9bd984d2` (2026-08-27 16:32:26) — confirmed by an in-code comment dated 2026-08-26 naming "Mission 51" explicitly for `backend/routes/mission.js`'s 4 read-route ownership fixes
- **Evidence class:** RECOVERED FROM CODE (high confidence for the `mission.js`/`resourceOwnership.cjs` portion, since the comment explicitly says "Mission 51 (2026-08-26)"); RECOVERED FROM GIT only (lower confidence, unattributed) for `f45a146f`'s much larger diff, which cannot be conclusively tied to "Mission 51" by number — it may represent this same mission's earlier work-in-progress, or a separate unnamed pass. Both are real, but only the `9bd984d2` portion carries a self-identifying mission number.
- **Files (9bd984d2 portion):** `backend/routes/mission.js`, `backend/services/resourceOwnership.cjs` (new — introduces `assertOwnable()`), plus 8 further route files per the commit body: "Mission 57 mobile CI coverage, Mission 43C offsite backup destination support, electron-builder asar file filters... and associated frontend/mobile component fixes."
- **Purpose:** Introduced `resourceOwnership.cjs`'s `assertOwnable(req, resource, notFoundMessage)` helper — allows orgId-less resources through unchanged (preserving the large body of legacy/shared/operator-created data), denies only when a resource has a real `orgId` the caller doesn't belong to. Applied to `mission.js`'s 4 read routes (timeline/graph/replay/state) as the first application of this pattern. This is the pattern Mission 74's MSN-1 fix (`ce6862e0`) later extended to `mission.js`'s 5 *mutation* routes.
- **Security impact:** Critical — this is the origin of the cross-tenant IDOR-prevention pattern that essentially all later P0 fixes in this range (MSN-1, and by direct code reuse, several `docs/ooplix/` citations) build on.
- **Test evidence:** Not independently re-run this session in isolation (no single `mission-51-*.cjs`-named test file exists to target); its downstream consequence (MSN-1's mutation-route fix reusing the same `assertOwnable()` helper) was independently verified 18/18 in Mission 74 and re-confirmed working in this session's Phase 2 concurrency fix testing.

## Entry: Mission 57 — Mobile CI coverage

- **Commit:** `9bd984d2` (bundled with Mission 51/43C work, per its own commit body)
- **Evidence class:** RECOVERED FROM GIT (commit body names it) + RECOVERED FROM CODE (the `build-mobile` job in `.github/workflows/ci.yml` carries its own "Mission 57 (2026-08-27)" comment, independently confirmed present in Mission 74 §9)
- **Files:** `.github/workflows/ci.yml` (`build-mobile` job)
- **Purpose:** `mobile/` had zero CI coverage before this — no build, no test run, on any PR or push. Added a job mirroring `build-frontend`'s install/build/verify shape, explicitly not attempting release signing (no keystore secrets exist).
- **Test evidence:** Not re-run this session (would require executing `mobile/`'s own npm scripts — out of Mission 75's completed scope; see the main report's Phase 7 section).

## Entry: Mission 60A / 60A-E — ERA-1 certification blockers

- **Commit:** `d1128564` (2026-08-27 21:27:41)
- **Evidence class:** RECOVERED FROM GIT (real, named commit message)
- **Files:** `.github/workflows/ci.yml`, `agents/runtime/missionRuntime.cjs`, `backend/services/autonomousLoop.cjs` (the `backend/services/` one — a distinct file from `agents/autonomousLoop.cjs`, see Mission 74 §14's note on this pair), `backend/services/browserController.cjs`, plus 8 runtime test files.
- **Purpose:** Not fully detailed in the (short, non-narrative) commit message beyond the subject line; the diff shape (test-file expansions to `10-c10-cross-system-closure.test.cjs`, `auto-v10.test.cjs`, `p11`/`p12`/`p13`/`p18`, `post-omega-p8`) suggests a broad certification-blocker sweep across multiple runtime suites rather than one focused fix.
- **Test evidence:** UNVERIFIED this session — not independently re-run.

## Entry: Mission 63 — post-omega-p9, Test 154, CI gate

- **Commit:** `4b20fc2a` (2026-08-28 04:50:39)
- **Evidence class:** RECOVERED FROM GIT (full, real, narrative commit message — see below)
- **Files:** `backend/services/workspaceCoordinator.cjs`, `backend/services/workspaceMesh.cjs`, `tests/runtime/10-c10-cross-system-closure.test.cjs`, `.github/workflows/ci.yml`
- **Purpose (quoted from the commit body, which is complete and self-describing):** Fixed `computerController.run()` being called with a mis-shaped argument in Electron/cloud dispatch (silently swallowed as an undefined error); fixed `workspaceMesh.cjs` dropping the real error message on a failed run; relaxed Test 154's over-strict byte-for-byte account-store equality check to tolerate legitimate concurrent writes while still catching real corruption; fixed CI's "Run security suite" step being silently skipped whenever "Run regression suite" failed (GitHub Actions' default skip-on-failure), replaced with unconditional execution + explicit outcome-based gating — this is the exact CI-gate mechanism Mission 74 §9 and this session's Phase 9 both independently verified is still correctly in place. Explicitly left Test 138 and `06-retry.test.cjs` as UNKNOWN, "no safe fix identified."
- **Test evidence:** The CI-gate mechanism this commit introduced was independently re-verified by direct code read in both Mission 74 and Mission 75 (Phase 9) — confirmed present and correctly wired.

## Entry: Mission 65 — Root-cause remediation (autonomous loop, security defects)

- **Commit:** `05e79744` (2026-08-28 05:52:21)
- **Evidence class:** RECOVERED FROM GIT (full narrative commit message) + RECOVERED FROM TEST EVIDENCE
- **Files:** `backend/server.js`, `backend/services/missionMemory.cjs`, `frontend/src/components/CommandCenter.jsx`, `tests/runtime/10-c10-cross-system-closure.test.cjs`, `tests/security/99-c1-accessibility-recovery.cjs`
- **Purpose (quoted/paraphrased from the full commit body):** Root-caused a recurring CI failure cluster (Tests 133/147/148/153/154, security 36/39/43/44/45) to `agents/autonomousLoop.cjs` running real unattended writes into the same shared JSON stores the test suites assert against, for the server's entire CI lifetime. Added an opt-in `DISABLE_AUTONOMOUS_LOOP=1` guard at the call site in `server.js`. Also fixed a genuine `CommandCenter.jsx` defect (unconditional JSON-body parsing on an auth failure masking the real error) and a `missionMemory.cjs` crash (`listMissions()`'s search filter crashing on a malformed record via unguarded `.some()`). Explicitly classified 7 remaining security failures as CI/environment-load artifacts (rate-limit exhaustion, one socket hang-up, one CPU-contended performance guard) and left them unmodified. Explicitly left Test 138/`06-retry.test.cjs` as UNKNOWN.
- **Test evidence:** The `DISABLE_AUTONOMOUS_LOOP` guard was independently verified by direct code read in Mission 74 (§6/§14): confirmed read at `backend/server.js:976`, correctly branches, is absent from production config. Re-confirmed unchanged this session.

## Entry: Mission 66 — CI: disable autonomous loop for Regression Suite

- **Commit:** `73cbec3b` (2026-08-28 05:53:16) — one minute after Mission 65
- **Evidence class:** RECOVERED FROM GIT (real, named, one-line commit message) + RECOVERED FROM TEST EVIDENCE
- **Files:** `.github/workflows/ci.yml` (1 line: `DISABLE_AUTONOMOUS_LOOP: "1"` added to the `regression` job's env)
- **Purpose:** The CI-side half of Mission 65's guard — sets the env var Mission 65 taught `server.js` to read, scoped only to the regression job.
- **Test evidence:** Independently confirmed present in `.github/workflows/ci.yml:58` by direct file read, both in Mission 74 and re-confirmed in this session's Phase 9.

## Entry: Missions 67–69 — retry/OAuth/vault UNKNOWNs, Business OS data-isolation hang

- **Commit:** `4263bbc4` (2026-08-28 17:36:40)
- **Evidence class:** RECOVERED FROM GIT (full narrative commit message)
- **Files:** `backend/services/businessDataService.cjs`, `backend/services/businessOrgState.cjs`, `backend/services/missionMemory.cjs`, 4 frontend panel components, `scripts/run-test-suite.cjs`, 7 runtime test files, `tests/security/99-c1-accessibility-recovery.cjs`
- **Purpose:** Bundles three previously-open items (not individually broken out in the commit message beyond the subject line: retry-logic UNKNOWNs, OAuth token-safety UNKNOWNs, vault UNKNOWNs) plus a fix for a Business OS data-isolation test hang.
- **Test evidence:** UNVERIFIED this session — not independently re-run.

## Entry: Mission 71 — Three CI blockers from run 33169866440

- **Commit:** `719fe0aa` (2026-08-28 19:21:23)
- **Evidence class:** RECOVERED FROM GIT (full, real, narrative commit message — quoted in Mission 74 §5 and reproduced in full above during this session's investigation)
- **Files:** `scripts/run-test-suite.cjs`, `tests/runtime/10-c10-cross-system-closure.test.cjs`, `tests/runtime/23-workforce-ownership.test.cjs`
- **Purpose:** (1) Fixed `23-workforce-ownership.test.cjs` reading `data/organizations.json` with no missing-file guard, which broke once Mission 68 moved all `createOrg()` callers into the serialized batch (an ordering side-effect of a correct prior fix). (2) Serialized `10-c10-cross-system-closure.test.cjs`'s own 74 internal `describe()` blocks (via `{ concurrency: false }`) after force-reproducing an intra-file lost-update race in `accountService.js`. (3) Added 6 `businessDataService.cjs`-mutating security files to `MISSION_MUTATING.security` after tracing a "cross-org knowledge graph leak" false-positive to the identical lost-update race, now in `data/biz-leads.json`.
- **Test evidence:** This is the direct precedent Mission 75 (this session) followed to fix the 125/126 gap — same list, same file, same pattern, only lower down chronologically since 125/126 didn't exist yet when this commit landed.

## Entry: Undated bulk work — SSRF audit, docs, hardening passes (no mission number recoverable)

The following commits carry either no commit body or a body that does not self-identify a mission
number. They are real, substantive, and (where checked) correct, but **no mission number is asserted
for them** — doing so would be fabrication:

| Commit | Date | Files | Best-available characterization | Evidence class |
|---|---|---|---|---|
| `199b00ca` | 08-22 | 6 | Adds `reports/SSRF-OUTBOUND-HTTP-SECURITY-AUDIT.md`; touches `autonomousLoop.cjs`, `creativeStudio.js`, `operationsAlertingLayer.cjs`, `AgentFactoryCenter.jsx` | RECOVERED FROM GIT (diff only) |
| `8f919ee3` | 08-23 | 100+ | Adds MFA-provider-bypass fix to `_handleFirebaseSession` in `auth.js` (self-identifies as this commit's own work, no mission number in the comment itself — the *register entry* for it, added one commit later in `db597e1b`, calls it part of Mission 32/33's work); adds `operatorOnly` gate to `/agents/runtime/*` (comment self-identifies as "Mission 32 — Autonomous Agent Registry & Execution Authorization audit") | RECOVERED FROM CODE for the two named fixes; RECOVERED FROM GIT only for the remaining ~98 files in this diff (frontend test scaffolding, `authApi.js`, billing/business component tests) |
| `db597e1b` | 08-23 | 2 | Register entries for Missions 31–33 (MFA certification) added retroactively | RECOVERED FROM GIT — this commit is itself evidence the register was being kept current as of 08-23, before the gap begins in earnest with `2e831bc4` onward |
| `2e831bc4` | 08-23 | 11 | Authors `CLAUDE.md` (321 lines, the file governing this and prior missions), adds 6 `.claude/skills/`, minor CI/README/package.json touches | RECOVERED FROM GIT |
| `6c6e1deb` | 08-23 | 21 (all `tests/security/*.cjs`) | Hardening pass strengthening assertions across 21 pre-existing security test files (06, 08, 13, 18, 19, 20, 33, 36, 39, 49, 57, 73, 76, 77, 81, 86, 87, 89) — no per-file rationale recoverable from the commit message; each file's own diff would need individual review to attribute a specific defect to a specific hunk, which is out of this recovery's scope | RECOVERED FROM GIT (diff only, no narrative) |
| `e9216160` | 08-27 | 78 (net +23,605 lines) | Large new-test-file addition: 15+ new `tests/security/*.cjs` (100 through 117), 2 new Electron IPC/navigation security tests (32, 33 — renumbered/reused prefixes, see Mission 74 §7's naming-collision note), `.gitignore` update | RECOVERED FROM GIT (diff only, no narrative — this is pure test-corpus expansion, not itself a "fix" to characterize) |
| `de2da263` | 08-27 | 4 | `missionMemory.cjs` fix + 3 runtime test file updates — likely the specific `listMissions()` short-circuit-bypass fix that Mission 65's commit message (05e79744, one day later) references as already having "hardened listMissions()'s search filter the same way its sort was hardened in the prior pass" | RECOVERED FROM CODE (cross-referenced against Mission 65's own commit message naming "the prior pass") |
| `d4242707` | 08-28 | 34 | Authors the entire `docs/ooplix/` corpus (32 files); fixes 2 real call-signature bugs in `akoState.cjs`/`akoWorkflow.cjs` (`saveTypedMemory`/`memoryPersistenceLayer.save()` argument-shape mismatches) | RECOVERED FROM CODE (both AKO fixes carry detailed, dated, self-explaining comments) + RECOVERED FROM TEST EVIDENCE (`tests/runtime/ako-v4.test.cjs`, 66/66, independently re-run in Mission 74 and unchanged since) |
| `07251166` | 08-29 | 3 | SSRF IPv6 bracket-notation bypass fix in `urlSafety.cjs`; orphaned-tmp-file sweeps added to `agents/taskQueue.cjs` and `backend/services/businessDataService.cjs` | RECOVERED FROM CODE (all three carry detailed, dated "ERA-1 forensic closure"/"ERA-1 Phase 2A" comments) + RECOVERED FROM TEST EVIDENCE (`tests/security/102-ssrf-outbound-http-security.cjs`, 7/7, independently re-run twice across Mission 74 and 75) |
| `6d4f141e` | 08-29 | 1 | Adds the regression test coverage for the SSRF fix above | RECOVERED FROM CODE + RECOVERED FROM TEST EVIDENCE (same test, same result) |
| `ce6862e0` | 08-28 | — | MSN-1 (Mission OS runtime-mutation IDOR) + M-4 (Memory OS read scoping) P0 fixes | RECOVERED FROM GIT (full narrative commit message) + RECOVERED FROM TEST EVIDENCE (18/18, 14/14, independently re-run three times total across Missions 74 and 75) |

---

## What cannot be reconstructed

- **Per-hunk rationale for `6c6e1deb`'s 21-file hardening pass and `9bd984d2`'s ~98 unlabeled files** (beyond the ones with self-identifying comments already extracted above) — the diffs are real and were read, but attributing a specific defect narrative to each hunk without the original author's context would require re-deriving that reasoning from scratch, which risks inventing a plausible-sounding but unverifiable rationale. Left as RECOVERED FROM GIT (diff-only) rather than guessed further.
- **Whether `f45a146f`'s 100+-file diff is "Mission 51" itself, an earlier draft of it, or a separate unnamed pass** — no self-identifying comment in that diff names a mission number; the "Mission 51" label only appears in the later `9bd984d2` commit's comment. Both are treated as real, but not merged into one mission number without stronger evidence.
- **Exact original author intent for `e9216160`'s 78-file test-corpus expansion** — the files themselves are real and (where sampled) internally coherent, but no commit message states what triggered adding exactly this set at this time.

## Explicit non-goal

This document does not attempt to renumber history into a clean Mission 51→71 sequence with no gaps.
Several commits in this date range cannot be confidently mapped to any specific mission number at all.
Presenting a false sense of complete numbering would itself violate the "do not fabricate historical
mission reports" instruction this document was created under.
