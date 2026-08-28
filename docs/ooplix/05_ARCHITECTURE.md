# 05 — Architecture (Phase 0/1 baseline)

Per CLAUDE.md and direct verification:

- **Backend**: Express 5, entrypoint `backend/server.js`. Route barrel
  `backend/routes/index.js` (416 lines, ~213 `router.use` mounts, confirmed by
  direct grep). Manual security headers (no `helmet` dependency).
- **Frontend**: separate npm package (CRA/React 18), entrypoint
  `frontend/src/App.jsx`. No router library — hand-rolled routing. No
  Redux/Zustand/MobX — Context + hooks. API calls via flat `*Api.js` files at
  `frontend/src/` root.
- **Agents/runtime**: `agents/` (legacy + domain agents) plus
  `agents/runtime/` (`runtimeOrchestrator.cjs`, `executionEngine.cjs`,
  `patchExecutionEngine.cjs`). `agents/executor.cjs` (132.9KB) confirmed still
  the largest file in the repo and still in the live execution path.
- **Services**: `backend/services/` — 398 `.cjs` files confirmed via direct
  count (`ls backend/services/*.cjs | wc -l`), flat, one level deep, following
  `<name>State.cjs`/`<name>Workflow.cjs`/`<name>Org.cjs` triads for OS
  subsystems.
- **Electron**: `electron/main.cjs` is the `package.json` main entry. Confirmed
  hardened (`contextIsolation`, `sandbox`, allowlisted filesystem access) —
  see `18_ELECTRON.md`.
- **Deploy**: `deploy/` — 8 real, working scripts. See `19_INFRASTRUCTURE.md`.
- **Tests**: `tests/` — 384 files across 13 categories (updated count, see
  `21_TESTING_STRATEGY.md`; CLAUDE.md's own "373 files" figure has drifted
  further since it was written).
- **Reports**: `reports/` — 315 files confirmed by direct count, plus
  `reports/OOPLIX-V1-MASTER-AUDIT-REGISTER.md` as the running index (4,672
  lines). The register's explicit numbered entries stop at Mission 50
  (2026-08-24) — Missions 51 through 71 exist only as git commit messages and
  in-code comments, never as register entries or dedicated report files. See
  `evidence/missions/` and `26_ERA1_CERTIFICATION.md` for the reconciliation.
- **Mobile/Electron/Flutter**: `mobile/` (Capacitor 6 + Firebase, real,
  distinct app — see `17_MOBILE.md`). No `flutter/` directory presence was
  independently re-verified in this mission (not part of the audited scope
  this session touched directly); `vscode-extension/` not independently
  audited this session.

## Four overlapping execution engines — confirmed still present, confirmed intentional

`agents/runtime/executionEngine.cjs` (27.7KB), `backend/services/autonomousExecutionEngine.cjs`
(21.2KB), `backend/services/agentExecutionEngine.cjs` (10.2KB),
`backend/services/computerExecutionEngine.cjs` (22.1KB) — all four confirmed
present and independently sized. The Runtime OS audit (see `03_OOPLIX_OS_MAP.md`
#18) found direct evidence this layering is intentional (different call sites
require different files for different purposes), supporting CLAUDE.md §5's
instruction not to unify them unilaterally without an explicit decision.

## Version drift — CLAUDE.md §1's claim is now stale; the underlying drift is already fixed

CLAUDE.md §1 states `package.json` says `1.0.0-rc1` while README/SECURITY.md
say "rc6"/"rc8," framing this as a known, tracked, still-open discrepancy.
Direct check this session shows this is **no longer true**:
- `package.json`: `"version": "1.0.0-rc1"`.
- `README.md:20` (version badge): `1.0.0-rc1`.
- `SECURITY.md:7`: `1.0.0-rc1 (current, per package.json)`, with an explicit
  in-file note: *"This table previously claimed a '3.x' current version that
  does not match package.json. Corrected 2026-08-23 (Mission 38) to match
  package.json's real version string exactly."*

So the actual historical drift was between `package.json` and a stale "3.x" in
SECURITY.md (not "rc6"/"rc8" as CLAUDE.md currently describes), and it was
already fixed under "Mission 38" (2026-08-23) — a mission with no
corresponding `reports/` file, consistent with this audit's broader finding
about missing report files for mission numbers 33+ in this range. **This is
itself a fresh documentation-drift finding**: CLAUDE.md §1 is now describing a
problem that has been resolved, using a description ("rc6"/"rc8") that does
not match either the historical or current state as directly verified.
Reported per this mission's own rule to surface contradictions rather than
silently resolve them — CLAUDE.md §1 should be updated by the user/maintainer,
not silently corrected here.
