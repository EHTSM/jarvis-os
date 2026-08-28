# 22 — Disaster Recovery (Phase 10 detail)

## Backup — two divergent implementations

See `19_INFRASTRUCTURE.md` for full detail. Summary: `safe-backup.cjs` (the
real, PM2-cron-scheduled, SQLite-consistent, curated, offsite-chaining
pipeline) is architecturally sound and CODE COMPLETE. `backup.sh`/`npm run backup`
(the weaker, plain-tar, no-encryption, no-curation script) remains the
documented default across `deploy/update.sh`, `deploy/rollback.sh`,
`deploy/validate-production.sh`, `deploymentReport.cjs`, `co2FounderOps.cjs`,
`dop1InfraValidation.cjs`, and 6 frontend hooks. This is a real, previously
under-specified documentation/tooling-drift finding — Mission 43C/50's "dead
offsite config" framing is accurate for the offsite leg specifically but
undersells that there are two disagreeing local implementations.

## Restore — `rollback.sh`

The only script that correctly handles both backup archive layouts (its own
comment documents a real, drill-verified silent-no-op bug it fixed: a bare
`tar -xzf` against the newer `snapshot_*` layout previously produced a
false-success "Rollback complete" message with no actual data restored, since
the health check only verifies `/health` returns 200 against unchanged old
data). Always takes a pre-rollback safety-net archive of `data/` first, and
backs up `.env` with `chmod 600` before any code change. Supports `--list`,
`--code <commit>`, and default data-restore modes.

## Offsite backup — status unconfirmed, likely still a gap

`export-offsite.cjs` performs real AES-256-CBC encryption and verified
transfer to S3/rsync/local-dir, but only if `BACKUP_PASSWORD` and
`BACKUP_OFFSITE_DIR` are set in `.env`. This mission could not verify their
presence (credential-safety rule — presence-only checks were not run for these
specific variables in this pass). If either is unset, the pipeline correctly
and honestly no-ops to local-only storage rather than fake-succeeding. Mission
43C's "single point of physical failure" conclusion likely still holds for the
offsite leg pending operator confirmation.

## A second, distinct continuity risk: majority-untracked test files

See `21_TESTING_STRATEGY.md` — `tests/legacy/` (73 of 74 files),
`tests/integration/` (14 of 15), and `tests/smoke/` (6 of 9) are git-invisible.
If the local machine holding these working-tree files were lost, roughly 90
test files across 3 categories would be permanently gone with no git history
to recover from. Not a CI failure today (CI never requests these files), but a
real, previously-unnamed disaster-recovery exposure distinct from the data
backup question above.

## Rollback / recovery infrastructure summary

| Mechanism | Status |
|---|---|
| `safe-backup.cjs` (local, encrypted-if-offsite-configured) | CODE COMPLETE |
| `export-offsite.cjs` (offsite leg) | CODE COMPLETE, gated on 2 unconfirmed env vars |
| `backup.sh`/`npm run backup` (weaker, still the documented default) | STALE/INCONSISTENT DOCUMENTATION |
| `rollback.sh` | CODE COMPLETE, handles both archive layouts, pre-rollback safety net |
| `healthcheck.sh` (cron-based auto-restart) | CODE COMPLETE; cron installation is advisory-only, not code-enforced |
| Untracked test files (legacy/integration/smoke) | Real, previously unnamed DR risk |

Operator actions required: confirm/set `BACKUP_PASSWORD` and
`BACKUP_OFFSITE_DIR`; reconcile documentation to point at `safe-backup.cjs`
instead of `backup.sh`; decide whether the majority-untracked test
directories should be committed.
