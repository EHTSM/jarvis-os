# Evidence Index — OS Layer Reconciliation (Phase 1)

Primary source: `reports/OS-REGISTER.md` (2,090 lines).

Per-OS report families referenced (pattern: `reports/OS-<NAME>-<STAGE>.md` where
STAGE ∈ {DISCOVERY, CAPABILITY-MATRIX, FINAL or FINAL-CERTIFICATION,
SECURITY or SECURITY-EVIDENCE, WORKFLOW-EVIDENCE}):
BUSINESS(as OS-5/5.1/5.2), SALES, MARKETING(-GROWTH-CERTIFICATION),
FINANCE, ENGINEERING, DEVELOPER, PRODUCT, CUSTOMER(-SUCCESS), SUPPORT,
ORGANIZATION, ENTERPRISE, AI(-WORKSPACE), MEMORY, KNOWLEDGE, MISSION,
AUTOMATION, AGENT, RUNTIME, CREATIVE(-STUDIO), INTEGRATION, EXECUTIVE,
ECOSYSTEM, AUTONOMOUS, PLATFORM, CIVILIZATION (bonus, not in mission's 23).

Directly re-verified by Mission 72 itself against current code (not merely cited):
- `backend/routes/index.js` gating for `/eco`, `/civ`, `/ent`, `/auto`, `/eos`,
  `/platform`, `/engorg` — confirmed `requireAuth, operatorOnly` present on
  `/eco`, `/civ`, `/ent` as of current HEAD, resolving an ambiguity the
  Autonomous OS report itself flagged as unclear.
- Existence on disk of all cited route files and 5 spot-checked frontend
  components (`BusinessOS.jsx`, `EngineeringConsole.jsx`, `OrgLevelStatus.jsx`,
  `CreativeStudio.jsx`, `ExecutiveDashboard.jsx`).
- Current `tests/runtime/` and `tests/security/` file counts (114/121 at this
  mission's own count via `ls | wc -l` — the OS-layer sub-agent's independent
  count returned 228/121, a discrepancy likely due to differing glob patterns
  [`*.test.cjs` vs. all files]; see `21_TESTING_STRATEGY.md` for the reconciled
  count using this mission's own direct `find`/`ls` commands as ground truth).

All other specific numeric claims cited in `03_OOPLIX_OS_MAP.md` and
`04_25_OS_REFERENCE.md` (recall@10 scores, MRR figures, agent counts, decision
ledger sizes, restart-survival results, regression pass counts) are drawn from
the named `OS-*` reports' own live-verification sections and were **not**
re-executed by this mission (Mission 72 is read-only and does not run the test
corpus or start a live server per its constraints). Treat them as reconciled
citations, not fresh live verification.
