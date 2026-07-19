# 16 — DevOps

**Status of this document:** VERIFIED against `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `RELEASE_PLAYBOOK.md` (founder-authored), `CHANGELOG.md`, and direct git inspection.

---

## Git

- **Repository**: `EHTSM/jarvis-os` on GitHub.
- **Branches observed**: `main` (default/production), `security/reality-completion` (current branch, this documentation's source), `security/hardening-p0`, `cleanup/runtime-minimization`, plus two `codex/*` automated-fix branches and a `backup-before-filter` safety branch.
- **Commit history**: 487 commits total, spanning 2026-04-24 to 2026-07-18 (contributors: `EHTSM`, `root` — the latter likely an automated/server-side commit identity).
- **Tags**: a mix of milestone/backup tags (`backup-before-phase-A/B/C`, `internal-product-baseline`, `production-core-v1`, `stable-core-v1/v2`) and release-candidate tags `v1.0.0-rc1` through `v1.0.0-rc8`.

## Branch Naming Convention

Recent branches follow a `<domain>/<intent>` pattern (`security/reality-completion`, `security/hardening-p0`, `cleanup/runtime-minimization`) — descriptive of the work being done, not a formal Git-Flow convention.

## CI/CD

Two GitHub Actions workflows, both directly read in full:

### `.github/workflows/ci.yml` — runs on every push/PR to `main`

| Job | What it does | Blocking? |
|---|---|---|
| Security Audit | `npm audit --audit-level=high` | Non-blocking (`continue-on-error: true`) |
| Regression Suite (144 checks) | Boots a real backend, waits for `/health`, runs `npm run test:runtime`, asserts the literal string "pass 144" in output | **Blocking** |
| Frontend Build | `npm run build:frontend`, verifies `index.html` + `static/` output exist, uploads artifact | **Blocking** |
| Deploy Scripts | `bash -n` syntax check + non-blocking `shellcheck` on all `deploy/*.sh` | Syntax check blocking, shellcheck warn-only |
| Validate | Runs `deploy/validate-production.sh` against a live-started server | Warn-only (`|| true`) |
| `ci-pass` gate | Requires regression + build-frontend + deploy-scripts + validate to succeed | Final gate |

**No Docker build step, no Electron build step, no deploy automation exists in `ci.yml`.**

### `.github/workflows/release.yml` — runs on tags matching `v[0-9]*.[0-9]*.[0-9]*`

Builds the frontend, packages a **server tarball** (`ooplix-server-v<version>.tar.gz`) containing backend, agents, scripts, deploy scripts, nginx.conf, and the prebuilt frontend — intended for manual VPS deployment. **No Docker image publishing.** An Electron desktop-build matrix job is attempted for all 3 platforms but is currently the source of the B17 blocker (see [02](02_CURRENT_PROJECT_STATUS.md)) — every recent run (`v1.0.0-rc5` through `rc8`) has ended in `cancelled` or `failure` for all 3 desktop-build jobs.

**A real, fixed CI bug** (per `v1-final-reality-report.md`): the generated release-notes install snippet built a doubled-`v` filename (`ooplix-server-vv1.0.0-rc6.tar.gz`) that didn't match the real uploaded artifact, because `github.ref_name` already includes the `v` prefix that a hardcoded `v` in the template duplicated. Fixed with a one-character removal.

## Release Process (per `RELEASE_PLAYBOOK.md`, founder-authored)

1. Push to `main` — CI must pass (the safety net).
2. Tag with `v[0-9]*.[0-9]*.[0-9]*` (e.g. `v1.0.0`) — triggers the Release workflow.
3. Release builds and publishes the server tarball + (attempted) desktop matrix to GitHub Releases.
4. **Manual step**: an operator runs `npm run deploy:update` on the actual VPS to pull and apply the new release — deployment is not automated by CI.

## Real CI History — A Case Study in Native-Module Packaging Pain

The `1.0.0-rc3` through `1.0.0-rc6` sequence (all dated 2026-07-17, per `CHANGELOG.md`) is a genuine, transparent record of debugging the same underlying problem across 4 iterations:
- rc3: `typescript` dependency version drift broke the frontend lockfile.
- rc4: `electron-rebuild` was in `devDependencies` but missing from the lockfile; a `postinstall` script failed under `--omit=dev`.
- rc5: `better-sqlite3`/`node-pty` native modules failed to compile on macOS (Python 3.14 removed `distutils`, which the old `node-gyp@9.4.1` still imported) — pinned `node-gyp` to `^10.3.1`.
- rc6: the same fix broke on Windows because `node-gyp@10.3.1` didn't recognize the VS2026 toolchain — bumped to `^12.4.0`.

Each RC entry in `CHANGELOG.md` explicitly states the prior RC "is left in place as a record of this attempt" — a deliberate practice of preserving failed-attempt history rather than silently overwriting it. **This problem (native module compilation for the desktop build) is not yet fully resolved** — B17 remains open as of this documentation's writing, now understood to be a `node-pty`-specific packaging hang distinct from the compilation issues rc3-rc6 fixed.

## Rollback

`deploy/rollback.sh` supports two real, live-verified modes:
- `--list` — lists available data backups and recent git commits (non-destructive, safe to run anytime). Live-verified: listed 8 real data backups and 10 recent git commits in the audit.
- `--code <ref>` — git checkout to a prior commit/tag, followed by restart-and-verify. **Not exercised destructively in any audit** (would stop the server, wipe data, checkout) — the mechanism exists and its non-destructive inspection mode works, but the actual destructive rollback path has not been live-tested end to end.

## Deployment

Single path, confirmed as the actual operational reality (not an assumption): VPS provisioning (`deploy/setup-vps.sh`) → environment configuration → `deploy/start-production.sh` (pre-flight-checked) → PM2 (`ecosystem.config.cjs`, fork mode, single instance) → nginx reverse proxy with certbot TLS. Updates via `npm run deploy:update` (`deploy/update.sh`), pulling the released tarball.

## Environment

- `.env` (never committed) holds all runtime secrets and configuration, validated by `node scripts/check-startup-env.cjs` (also run automatically by `npm start`).
- `.env.example` (234 lines) documents every expected variable with `[REQUIRED]`/`[OPTIONAL]` markers.
- Two deployment-flavor env templates exist: `.env.production.example` (minimal) and `.env.example` (full connector surface).

## Testing Gate Before Release

`npm run test:runtime` (144 checks) is the actual CI-blocking gate. Additional test suites exist (stress, burnin, chaos, operator-simulation — 201 files total across 13 subdirectories) but are **not** part of the automated CI gate — they appear to be run manually/periodically rather than on every push. This is a reasonable scoping choice (the 144-check suite runs in ~4.5 seconds; the stress/burnin suites are designed to run for extended periods) but is worth knowing: **passing CI means the 144-check suite passed, not that the full 201-file test surface was exercised.**

---

*Next: [17_FINANCIAL_PLAN.md](17_FINANCIAL_PLAN.md) for what this infrastructure and process actually costs.*
