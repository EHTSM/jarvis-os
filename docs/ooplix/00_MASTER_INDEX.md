# 00 — Master Index — Mission 72 Documentation Pack

Mission 72 is a read-only, evidence-driven forensic audit of the Ooplix / JARVIS-OS
repository (`/Users/ehtsm/jarvis-os`), covering architecture, security, tenant
isolation, autonomy, UX, integrations, infrastructure, CI/CD, and ERA-1 certification
readiness. It produced no code changes — see the mission's absolute constraints.

**Source of truth order**: direct repository inspection (routes, services, tests,
git history) > CLAUDE.md > prior mission reports (`reports/`, `docs/audits/`,
`docs/current/`) > root-level legacy audit `.md` files. Where these disagree, the
contradiction is reported explicitly rather than silently resolved — per CLAUDE.md's
own stated policy and this mission's Phase 17 rule.

**Audit date**: 2026-08-28. **Branch**: `security/reality-completion`. **HEAD at
audit time**: `719fe0aa` ("fix: ERA-1 Mission 71 — three CI blockers"). No commits
were made during this mission.

## How this pack is organized

| # | File | Covers |
|---|------|--------|
| 00 | MASTER_INDEX.md | This file |
| 01 | EXECUTIVE_OVERVIEW.md | One-page verdict for a non-technical reader |
| 02 | PRODUCT_VISION.md | What Ooplix claims to be vs. what it is today |
| 03 | OOPLIX_OS_MAP.md | The 23-OS architecture as implemented |
| 04 | 25_OS_REFERENCE.md | Per-OS scorecard (naming discrepancy noted) |
| 05 | ARCHITECTURE.md | Backend/frontend/agent runtime map |
| 06 | DATA_ARCHITECTURE.md | Persistence, stores, tenant chains |
| 07 | SECURITY_MODEL.md | Security forensic (Phase 3) |
| 08 | AUTH_RBAC_MFA.md | Auth/RBAC/MFA specifics |
| 09 | TENANT_ISOLATION.md | Data isolation forensic (Phase 4) |
| 10 | AGENT_RUNTIME.md | Execution engines, agent registry |
| 11 | MISSION_AUTOMATION.md | Mission/automation pipeline |
| 12 | MEMORY_KNOWLEDGE.md | Memory OS + Knowledge Graph |
| 13 | AI_PROVIDER_LAYER.md | 12+ AI providers, routing |
| 14 | INTEGRATION_CATALOG.md | 57+ connector inventory |
| 15 | BILLING_PAYMENTS.md | Billing/payment provider evidence |
| 16 | FRONTEND_UX.md | UX forensic (Phase 6) |
| 17 | MOBILE.md | Capacitor mobile app reality |
| 18 | ELECTRON.md | Desktop shell reality |
| 19 | INFRASTRUCTURE.md | VPS/PM2/backup/monitoring |
| 20 | CICD.md | GitHub Actions pipeline forensic |
| 21 | TESTING_STRATEGY.md | Real test corpus vs. CLAUDE.md §9 claims |
| 22 | DISASTER_RECOVERY.md | Backup/restore/rollback reality |
| 23 | PRODUCT_REPLACEMENT_MATRIX.md | 14-product replacement audit |
| 24 | OS_INTEGRATION_MATRIX.md | Cross-OS connection audit (Phase 9) |
| 25 | PRODUCTION_READINESS.md | Operator-action vs. code-complete split |
| 26 | ERA1_CERTIFICATION.md | Gap matrix + exit criteria |
| 27 | ERA2_READINESS.md | What's explicitly out of ERA-1 scope |
| 28 | REMAINING_BACKLOG.md | P0-P3 + decisions + manual actions |
| 29 | RISK_REGISTER.md | Consolidated risk register |
| 30 | GLOSSARY.md | Terminology (OS names, mission numbering, etc) |
| 31 | CHANGELOG.md | This pack's own revision log |

`evidence/` subfolders hold short evidence-index files (not full source copies)
organized by domain: `missions/`, `security/`, `runtime/`, `frontend/`, `mobile/`,
`electron/`, `infrastructure/`, `integrations/`, `product/`.

## Known documentation drift flagged by this mission (see individual files for detail)

1. **CLAUDE.md §9 is itself now stale.** It claims `npm run test:runtime` runs "10
   specifically named files" and that CI's gate does `grep -E "pass 144"`. As of
   HEAD (`719fe0aa`), `test:runtime` invokes `scripts/run-test-suite.cjs runtime`,
   which discovers and runs **all** `tests/runtime/*.test.cjs` files (114 at audit
   time) via `node --test`, and `.github/workflows/ci.yml` no longer contains the
   string `"pass 144"` anywhere — the gate is now outcome-based
   (`steps.run_regression.outcome` / `steps.run_security.outcome`). This drift is
   reported, not silently corrected, per this mission's explicit instructions.
2. Mission numbering for "51 through 71" referenced in this mission's brief does
   not exist as individual `reports/MISSION-5X.md` / `MISSION-6X.md` files. The
   `reports/OOPLIX-V1-MASTER-AUDIT-REGISTER.md` register's own explicit entries stop
   at **Mission 50** (2026-08-24). Missions 60A, 63, 65, 66, 67-69, and 71 exist only
   as **git commit messages** on this branch (`security/reality-completion`), not as
   register entries or individual report files — see `29_RISK_REGISTER.md` /
   `evidence/missions/` for the reconciliation and exact commit hashes.
3. package.json's version (`1.0.0-rc1`) vs. README/SECURITY.md's `rc6`/`rc8` drift,
   already named as known/tracked in CLAUDE.md §1, still holds as-is — not
   re-verified further beyond confirming CLAUDE.md's description matches current
   `package.json`.
