# 20 — CI/CD (Phase 11 detail)

## `.github/workflows/ci.yml` — full job breakdown

| Job | Purpose | Gate behavior |
|---|---|---|
| `audit` | `npm audit --audit-level=high` | non-blocking (`continue-on-error: true`) |
| `regression` (needs `audit`) | boots real server, installs Playwright Chromium, runs `test:runtime` + `test:security` | outcome-checked independently, fails job if either fails (Mission 63 fix — see `21_TESTING_STRATEGY.md`) |
| `build-frontend` (needs `audit`) | `npm ci --prefix frontend`, `npm run build:frontend`, verifies output | hard gate |
| `build-mobile` (needs `audit`) | real Jest tests (4 files) + build verification, CI-placeholder Firebase env | hard gate; added under "Mission 57" — mobile had zero CI coverage before |
| `deploy-scripts` | `bash -n` syntax check (hard) + shellcheck (soft, `\|\| true`) | hard on syntax |
| `validate` (needs `[regression, build-frontend]`, `if: always()`) | boots server, runs `validate-production.sh \|\| true` | permanently warn-only by design, correctly excluded from `ci-pass`'s required checks |
| `ci-pass` (needs all, `if: always()`) | top-level required-check gate | checks `regression`/`build-frontend`/`build-mobile`/`deploy-scripts` results (not `validate`, by design) |

No `grep -E "pass 144"` exists anywhere in this file — see `21_TESTING_STRATEGY.md`
for the full reconciliation against CLAUDE.md §9's stale claim.

## `.github/workflows/release.yml`

Jobs: `build` (frontend) → `package` (server tarball + sha256) → `desktop`
(mac/win/linux matrix via electron-builder, with a "Mission 58" warn-only
post-build signature-verification step) → `changelog` (extracted from
`CHANGELOG.md`) → `release` (creates the GitHub Release, pre-release-flagged if
the tag contains `-beta`/`-rc`). All jobs read in full; no placeholder/TODO
logic found. See `19_INFRASTRUCTURE.md` for the signing-specific detail
(Electron code-signed-if-secrets-present + self-verifying; Android/Play Store
signing confirmed entirely absent, by design, not merely undocumented).

## Design choices worth naming explicitly (not defects)

- `npm audit` and `validate-production.sh` are intentionally non-blocking —
  standard practice for dependency-CVE noise and a production-viability
  informational check, respectively.
- `regression`'s `continue-on-error` on the two test-suite steps is paired with
  an explicit downstream enforcement step, not a silent pass — this exact
  pairing was itself a fix for a real incident (a runtime failure previously
  caused the security suite to be silently skipped under GitHub Actions'
  default early-exit behavior).

See `21_TESTING_STRATEGY.md` for the test-corpus-specific findings and
`evidence/runtime/` for citations.
