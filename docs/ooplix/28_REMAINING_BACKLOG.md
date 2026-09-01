# 28 — Remaining Backlog (Phase 15)

Strictly separated by priority class. ERA-1 blockers are not mixed with ERA-2
enhancements.

## P0 — Must fix before any multi-tenant production claim

**Status update (2026-08-28, this mission):** all 3 items below are now
**FIXED**, verified by new negative regression tests
(`tests/security/125-msn1-mission-runtime-cross-tenant-idor.cjs`,
`tests/security/126-m4-memory-os-cross-tenant-read-idor.cjs`) proving
cross-org denial with zero side effects and same-org access unregressed.
F-1 and M-4's write side were discovered ALREADY fixed in commit `f45a146f`
(2026-08-22) — this register was generated after that fix landed but before
being updated to reflect it; a real doc/code drift, not a re-opened defect.

1. **Mission OS cross-tenant cancel (MSN-1) — FIXED.** The runtime mutation
   routes (`start`/`complete`/`fail`/`cancel`/subtask-patch in `mission.js`)
   had zero ownership check, unlike their 4 sibling read routes which
   already had `assertOwnable()` from Mission 51 — fixed with the same
   helper. A deeper layer was also found and fixed: 3 mission-creation
   routes (`/missions/orchestrator/create`, `/coding/convert-to-mission`,
   `/p27/missions`) never stamped `orgId` at all, so created missions
   landed in the shared/unowned bucket regardless of route checks — now
   stamped from server-verified org membership only, never a client claim.
   `phase27.js`'s entire duplicate `/p27/missions/*` route family (9 routes)
   also had zero ownership checks — fixed with `assertOwnable()` to match.
   No schema/backfill was needed — `orgId` was already an optional field on
   `missionMemory.cjs`; the gap was route-level and creation-time only. See
   `09_TENANT_ISOLATION.md`, `11_MISSION_AUTOMATION.md`.
2. **Finance OS `/cbeta/billing/*` unscoped (F-1) — ALREADY FIXED** (commit
   `f45a146f`, 2026-08-22, predates this register). All 7 sensitive billing
   routes are gated `operatorOnly`; verified the Express prefix-match
   correctly covers parameterized sub-routes (`/credits/:accountId`,
   `/invoices/:invoiceId/paid`). See `15_BILLING_PAYMENTS.md`.
3. **Memory OS cross-tenant read/write (M-4) — FIXED.** Write side was
   already fixed in the same `f45a146f` commit (`operatorOnly` on
   `/p18/memory` POST/PATCH/DELETE). The read side (`GET /p18/memory*`,
   `GET /p20/memory/rank`) is now fixed this mission: `orgId` added as an
   OPTIONAL field on `memoryPersistenceLayer.cjs`'s schema (same
   orgId-optional design as `missionMemory.cjs`, since ~14 of 15 write call
   sites are genuinely autonomous/background writers with no tenant
   concept), reads scoped to the caller's own real org. **Known accepted
   tradeoff, not a gap**: pre-existing nodes (nearly the entire live store)
   predate this field with no reliable way to backfill real historical
   ownership, so `SharedMemoryCenter.jsx` will show sparse/empty results for
   an org-scoped caller until new org-scoped writes accumulate — this was
   an explicit product decision (scope now, accept the transitional UX
   cost), not an oversight. A caller with no org context still sees the
   full legacy/shared pool, preserving the ~14 internal consumers.
   **Design note for future readers**: the fix deliberately does NOT scope
   via `attachOrg`'s `req.org`/`req.orgRole` — a first attempt did, and its
   own regression test caught a bypass (a caller with a real home org could
   see another org's data by supplying that org's id via `X-Org-Id`, since
   `attachOrg`'s selector-resolution branch never falls back to the
   caller's own org on verification failure). The shipped fix independently
   resolves the caller's own org straight from `organizationService`,
   ignoring any client-suppliable selector entirely. See
   `12_MEMORY_KNOWLEDGE.md`.

## P1 — Must fix before production (not tenant-breaking, but real defects)

4. `pipeline.js`/`engineering.js` mutating routes have no rate limiter (the
   remediation plan that fixed their auth gate specified rate limiting too;
   only the auth half was implemented). See `07_SECURITY_MODEL.md`.
5. `MemoryCenter.jsx`'s delete action has zero confirmation of any kind.
6. `PluginMarketplace.jsx`'s uninstall action has zero confirmation of any
   kind (failure path is honest; the mutation itself is unguarded).
7. RBAC frontend visibility parity — the web app has only a binary
   operator/non-operator gate; a `viewer`-role user sees the same UI as an
   `org_admin` and discovers denial only via a raw 403. See `16_FRONTEND_UX.md`.
8. PM2 log rotation is not installed; logs are growing unboundedly (85MB/20MB
   at audit time). Single-command fix: `pm2 install pm2-logrotate`.
9. Backup documentation/tooling points at the weaker `backup.sh` script across
   6+ files/services/UI hooks, while the real cron job runs the stronger
   `safe-backup.cjs`. Reconcile which is the documented default.
10. Confirm presence of `BACKUP_PASSWORD`/`BACKUP_OFFSITE_DIR` — if unset,
    offsite backup silently (and honestly) no-ops to local-only storage.
11. `electron/main.cjs`'s `shell-exec` IPC handler has no path/command
    allowlist, unlike its sibling filesystem handlers.
12. `/health`'s dead `require("../../agents/metrics/metricsCollector.cjs")` —
    the file was archived; the try/catch masks this gracefully but it's dead
    code in a production-relevant endpoint.
13. `tests/runtime/stream/`'s 2 files are not covered by the current
    `test:runtime` glob (non-recursive `readdirSync`).

## P2 — Important, not release-blocking

**Status update (2026-08-29, Mission 76 Micro-Missions 11/15/16):** the
`missionMemory.cjs` malformed-record statistics defect below is now
**FIXED**. `getMissionStats()` accessed `m.subtasks.length`/
`m.deployments.length`/`m.learnings.length`/`m.failures.length`/
`m.failures` (for..of) with no guard against those fields being
`undefined` — live-reproduced via `post-omega-p10.test.cjs` (74/92 pass,
18 failures, all `"Cannot read properties of undefined (reading
'length')"`), root-caused to real malformed records in the live
`data/missions.json` (traced to `tests/runtime/p18-scientific-discovery.test.cjs`'s
own out-of-band fixture writes — a separate, not-yet-fixed issue, see
item below). Fixed by mirroring the exact `(m.field || [])` guard
pattern already proven for this same file's `listMissions()` search
filter. Regression: `tests/runtime/mission-memory-stats-malformed-record.test.cjs`,
4/4 pass. Post-fix: `post-omega-p10.test.cjs` 92/92, 0 failures. The real
`data/missions.json` and its existing malformed records were not
modified — verified unchanged (file mtime identical before/after). No
tenant-isolation or security dimension (the function is a platform-wide,
unscoped read-only aggregate; no cross-org data exposure or mutation is
possible). ERA-1 blocker: NO — this was P2 severity throughout and does
not change the standing P0/P1 gate status.

14a. `missionMemory.cjs`'s `getMissionStats()` malformed-record crash —
     **FIXED** (see status update above). Fix verified but the change was
     not yet committed as of Mission 76 Micro-Mission 19.
14b. `tests/runtime/p18-scientific-discovery.test.cjs`'s fixture (lines
     180-206) writes minimal, non-conformant mission objects directly
     into the real, shared `data/missions.json`, bypassing
     `createMission()`/`_buildMission()` entirely — the actual source of
     the malformed records item 14a's fix now tolerates. A prior mission
     already partially patched this same fixture once (adding
     `createdAt` after an earlier, different crash); `subtasks`/
     `deployments`/`learnings` were never added. Left unfixed — flagged
     as a separate, explicitly not-yet-authorized decision (Mission 76
     Micro-Mission 15/16). Not itself a certification blocker (14a's fix
     means it can no longer crash anything), but an active data-hygiene
     issue that will keep growing the malformed-record count on every
     run of that test file.
14c. `backend/services/approvalQueue.cjs` orphan/tmp-file hygiene gap
     (Mission 76 Micro-Mission 05/07/21/23). `_save()`'s atomic-write
     protection is present and correct — a per-call-unique tmp filename
     (`${DATA_FILE}.${pid}.${randomHex}.tmp`) plus `writeFileSync()` +
     `renameSync()`, matching the same crash-safety pattern already
     proven for `agents/taskQueue.cjs` and
     `backend/services/businessDataService.cjs`. What is missing: unlike
     those same two sibling files (each of which independently gained a
     `_sweepOrphanedTmp()` cleanup routine, verified present — 3 and 4
     references respectively — swept once at module load to remove any
     tmp file left behind by a process that was SIGKILLed between
     `writeFileSync` and `renameSync`), `approvalQueue.cjs` has **zero**
     `_sweepOrphanedTmp()` references — re-confirmed by direct grep this
     mission. No correctness or data-loss defect exists (a genuinely
     in-flight write can never be interrupted such that a partial file
     is read — `renameSync` only ever swaps in a complete file); the gap
     is unbounded disk growth across repeated crash cycles, the exact
     same class of hygiene issue already fixed for the two sibling
     stores. Security impact: none demonstrated. Tenant-isolation
     impact: none demonstrated. ERA-1 blocker: NO. Recommended
     remediation: add the equivalent `_sweepOrphanedTmp()` routine to
     `approvalQueue.cjs`, mirroring the exact pattern already shipped in
     `taskQueue.cjs`/`businessDataService.cjs` — not implemented as of
     this entry. Status: OPEN — SAFE TO DEFER.

14. `browserPlatform.js` session CRUD routes have no rate limiter (IDOR is
    fixed; throttling is not).
15. **RESOLVED (2026-08-29, Mission 76 Micro-Mission 22).** Original finding:
    CLAUDE.md §9's test-corpus claim was stale (said 10 named files/"pass 144";
    actual was already full-corpus/outcome-gate by the time this item was
    written). This was corrected in Mission 75 — CLAUDE.md §9 itself now
    carries the heading "Real Test Corpus — Corrected 2026-08-29 (Mission 75)"
    and its first bullet explicitly states the old claim "is no longer true
    and has been corrected here, not silently," naming the real mechanism
    (`scripts/run-test-suite.cjs`, introduced Mission 42, extended Mission
    63/71). Re-verified directly against the current file this mission: the
    correction is genuinely present, not merely claimed. This backlog entry
    itself had never been updated to reflect that the underlying CLAUDE.md
    issue was already fixed — a documentation-lag gap, not a reopened or
    still-existing defect. ERA-1 blocker: NO. (CLAUDE.md §1's version-drift
    claim, the entry's second half, was already separately noted as fixed
    under Mission 38 and remains unchanged here.)
16. Missions 51-71 have no `reports/` files or register entries — a real
    audit-trail continuity gap, not a code defect.
17. Electron's Mission 53/54 hardening work has no corresponding `reports/`
    file despite being real, substantial, and dated in code comments.
17a. **Electron runtime launch — UNKNOWN, non-blocking** (Mission 76
     Micro-Mission 04/18). Static verification of `electron/main.cjs`/
     `electron/preload.cjs` is strong: 66/66 checks pass across 4
     independent artifacts (`scripts/electron-smoke-test.cjs`,
     `tests/runtime/electron-ipc-vault-boundary.test.cjs`,
     `tests/security/32-electron-ipc-injection-hardening.cjs`,
     `tests/security/33-electron-navigation-signing-scope.cjs`) —
     confirming `contextIsolation`/`nodeIntegration`/`webSecurity`
     hardening, CSP injection, real `spawn()`-based command execution,
     filesystem allow-listing, and navigation-guard scoping are all
     correctly implemented in the shipped source. Live runtime launch
     was attempted 3 times in this sandbox and crashed at `main.cjs:54`
     (`app.getPath(...)`, `app` undefined) every time, traced via
     `codesign -dv` to this specific environment's ad-hoc-signed,
     no-team-identifier Electron binary triggering a macOS
     `task_name_for_pid` kernel denial — a local OS/code-signing
     constraint, not application startup/preload/IPC logic (the
     identical crash occurred on a trivial one-line `require('electron')`
     probe, ruling out `main.cjs`'s own complexity). **No CI runtime
     evidence exists either**: `.github/workflows/ci.yml` has zero
     Electron references, and `.github/workflows/release.yml`'s
     `desktop` job only packages the app (`electron-builder --publish`)
     without ever launching the resulting executable. Electron's actual
     runtime startup has therefore never been independently verified by
     any mission or CI run to date, in either direction. **Do not read
     this as Electron being certified** — the static hardening is real
     and verified; the runtime-launch question remains genuinely open,
     just not attributable to a code defect on the evidence gathered so
     far.
18. `KnowledgeCenter.jsx` presents a CRM-entity relationship graph under a name
    ("Knowledge Center") that implies a document/wiki product it does not
    provide — not fabricated data (that was already fixed), but a naming/product
    -shape mismatch worth a product decision.
19. Automation OS's 4 of 6 trigger types (`event`/`threshold`/`webhook`) accept
    validation but never fire; the approval→resume flow has zero subscribers.
20. Executive OS and Finance OS report two different, unreconciled MRR figures
    from the same underlying business data.
21. Undisclosed hardcoded numeric fallbacks (e.g. `?? 94`, `?? 72`) in several
    dashboard components when live data is genuinely absent — lower severity
    than a fabricated dataset, but the same honesty question CLAUDE.md §17
    raises.
22. `tests/legacy/` (73/74 files), `tests/integration/` (14/15),
    `tests/smoke/` (6/9) are majority git-untracked — a real continuity risk
    if the local working tree were lost, though not a current CI gap.
23. Integration connector count discrepancy (44 direct count vs. "57+"/"62"
    cited in prior mission memory/reports) — not reconciled.
24. `accounts.js`'s `GET /accounts` implements its operator check inline
    instead of composing the shared `operatorOnly` middleware (style only).
25. **`tests/runtime/p14-knowledge-network.test.cjs`'s `discover finds
    high_value_lesson` — ENVIRONMENT DEPENDENCY, isolation fix verified,
    full-file completion not proven (2026-08-30, Mission 76 Micro-Missions
    32-38).** Root cause (M32): the assertion depends on `data/lessons.json`'s
    live, shared, non-git-tracked, per-run-volatile lesson-type distribution —
    not on any production defect (`knowledgeDiscoveryEngine.cjs` was never
    shown to misbehave). A test-only `fs` mock fix (M34/M36) now isolates both
    reads and writes to that file, with exception-safe `try/finally`
    restoration; the real `data/lessons.json` was verified byte-for-byte and
    mtime-for-mtime unchanged across a genuine execution (M37), and the target
    assertion passed for real against the isolated fixture in that same run.
    Separately, and not a consequence of this fix: the file's own later
    "End-to-End" pipeline section reproducibly hits a local JavaScript heap
    OOM while parsing large local `data/*.json` files (`missions.json`
    ~39.8MB, `repo-index.json` ~47.5MB) on this specific development machine,
    across 3 independent execution attempts (M33, M35, M37) — full-file
    completion has never been proven, and this is not a CI-relevant finding
    (GitHub Actions runners do not carry this machine's accumulated local
    data at these sizes). One accidental local incident occurred during this
    investigation (M33 overwrote the real local `data/lessons.json` with
    synthetic test data before the write-isolation fix existed); the
    pre-incident ~1.2MB dataset was searched for exhaustively (M34: no
    git tracking, no matching backup archive, no VPS-sim mirror) and is
    permanently unrecoverable — no reconstruction or fabrication was
    performed, and this is a local-development-machine data loss, not a
    production or CI data-integrity issue. ERA-1 blocker: NO. Status: OPEN
    — environment-limited, not pursued further per Mission 76's own decision
    to stop chasing a repeated, machine-local OOM rather than a code defect.

## P3 — Later / lower priority

25. CSRF relies on SameSite+CORS rather than a dedicated token scheme
    (accepted pattern, but worth naming explicitly rather than silently
    assuming coverage).
26. Several optional-integration checks fail open if a dependency throws
    (`_isStaleAfterPasswordChange` et al.) — explicitly reasoned in comments,
    worth operator awareness.
27. Windows Electron builds have no code-signing config in `package.json`
    (fails closed on unsigned auto-update by electron-updater's own default,
    which is the safe outcome, but builds remain effectively unsigned without
    a build-time certificate).

## PRODUCT DECISION (not a defect — requires a founder/maintainer choice)

28. Should `/plan/upgrade` be wired to `billingService` or removed? (Flagged,
    unresolved, since Mission 43A's original discovery.)
29. Should the 3 non-integrated Enterprise backends (canonical
    `organizationService.cjs` + M1-M8 modules + legacy `enterpriseOS.cjs`) be
    consolidated?
30. Should `browserPlatform.js`'s `?all=true` listing (now operator-restricted)
    remain a feature at all, or be removed?
31. Should Ooplix's connector layer be deepened from probe-only to real sync
    for any of the 14 audited product-replacement targets (n8n, Jira, Linear,
    Figma, Canva are the most plausible candidates per
    `23_PRODUCT_REPLACEMENT_MATRIX.md`'s hybrid-integration recommendations)?
32. Should `KnowledgeCenter.jsx` be renamed/repositioned, or should an actual
    document/page product be built under a different name?

## MANUAL OPERATOR ACTION (no code change needed)

33. Run `pm2 install pm2-logrotate` on the production VPS.
34. Set `SENTRY_DSN` to activate real error tracking (already wired, honest
    no-op until then).
35. Confirm/set `BACKUP_PASSWORD` and `BACKUP_OFFSITE_DIR`.
36. Set Electron code-signing secrets (`MACOS_CERT_P12`, `WIN_CERT_PFX`, etc.)
    in GitHub Actions if signed releases are desired.
37. Run real-device mobile testing (iOS/Android hardware) — never performed.
38. Run a real screen-reader (NVDA/JAWS/VoiceOver/TalkBack) accessibility pass
    — never performed, and the existing WCAG certification explicitly refuses
    to claim AA without it.
39. Run `https-setup.sh <domain>` on the actual VPS with a real domain.
40. Decide whether to retroactively write the missing Mission 51-71 report
    files/register entries.

## OPTIONAL HARDENING

41. Migrate the ad-hoc Playwright usage inside `tests/security/*.cjs` to a
    standard `playwright.config.js`/`e2e/` structure for discoverability.
42. Extend the `test:runtime` glob to recursively pick up
    `tests/runtime/stream/`'s 2 files, or move them to the top level.
43. Add the same `_isSafePath`-style command/path allowlist to Electron's
    `shell-exec` handler that already exists for its filesystem handlers.

## ERA-2 FEATURE (explicitly out of ERA-1 scope, not evaluated for readiness)

See `27_ERA2_READINESS.md`.
