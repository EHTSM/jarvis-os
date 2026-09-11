# 30 — Glossary

- **ERA-1**: This codebase's internal name for its current production
  certification milestone/branch effort (`security/reality-completion`
  branch). Not a formally defined term in any single document this mission
  located; used consistently across recent commit messages (Missions 60A
  through 71) to mean "the certification push toward a GO/no-GO production
  verdict."
- **Mission N**: This repo's unit of audit/remediation work, historically
  documented as a `reports/MISSION-N-*.md` file plus a register entry in
  `reports/OOPLIX-V1-MASTER-AUDIT-REGISTER.md`. As of this mission's audit,
  that convention was followed through Mission 50 and then not followed for
  Missions 51-71, which exist only as git commits and code comments. See
  `evidence/missions/mission-51-71-index.md`.
- **OS (as in "23 OS layers")**: A named business/platform capability domain
  (e.g. "Business OS," "Finance OS") implemented as a cluster of
  `backend/services/*.cjs` files plus dedicated routes, following the
  `<name>State.cjs`/`<name>Workflow.cjs`/`<name>Org.cjs` naming triad
  (CLAUDE.md §11). Not an operating system in the OS-kernel sense.
- **Level N / "OS Level 2-10" / "Platform Ω"**: An internal versioning scheme
  where later "Levels" represent progressively broader/more abstract
  platform-simulation layers (e.g. Level 6 = Executive OS, Level 10 =
  Autonomous Civilization, Platform Ω = the artificial-organization platform
  layer). Referenced extensively in the user's own memory file and confirmed
  live in `backend/routes/index.js`'s route prefixes (`/eos`, `/ent`, `/eco`,
  `/civ`, `/auto`, `/platform`).
- **Connector (probe-only)**: A function in `integrationConnectors.cjs` that
  checks credential presence and makes one live HTTP reachability/identity
  check against an external service, recording a status string. Distinct from
  a "sync" integration, which would perform real bidirectional data operations
  against that service — the vast majority of this repo's 44 connectors are
  probe-only. See `14_INTEGRATION_CATALOG.md`.
- **`assertOwnable` / `resourceOwnership.cjs`**: The shared helper introduced
  under "Mission 51" to close 4 of the 9 confirmed IDOR defects — allows
  orgId-less resources to remain shared (matching `missionMemory.cjs`'s
  documented design), and checks real membership/grants for resources that do
  carry an orgId. See `09_TENANT_ISOLATION.md`.
- **`MISSION_MUTATING`**: The list inside `scripts/run-test-suite.cjs` of test
  files known to write to shared JSON stores, serialized during CI to avoid a
  documented lost-update race. See `21_TESTING_STRATEGY.md`.
- **The "144" claim**: A stale reference (CLAUDE.md §9, and formerly a literal
  `grep -E "pass 144"` in `.github/workflows/ci.yml`, now removed) to an old,
  narrow 144-test CI gate. No longer accurate — see `21_TESTING_STRATEGY.md`.
- **GLOBAL_ORG**: `secretVault.cjs`'s reserved partition for the founder/
  platform's own credentials, distinct from per-tenant `orgId::connectorId::type`
  keys. A prior defect let a customer org's env-var fallback resolve to a
  GLOBAL_ORG secret; fixed by scoping the fallback.
