# 19 — Infrastructure (Phase 10)

Method: static read of `deploy/*.sh` (8 scripts, all read in full), `ecosystem.config.cjs`,
backup scripts, monitoring services, `release.yml`, `/health` route, nginx configs.
No server started, no `.env` values read.

## Deploy scripts — all 8 CODE COMPLETE

`setup-vps.sh`, `start-production.sh`, `update.sh`, `rollback.sh`,
`validate-production.sh`, `healthcheck.sh`, `monitor.sh`, `https-setup.sh` are
real, working, and unusually self-documenting about their own incident
history:
- `start-production.sh` hard-fails on missing/placeholder `JWT_SECRET`,
  `BASE_URL`, `GROQ_API_KEY`, `OPERATOR_PASSWORD_HASH`, and polls `/health` for
  up to 40s before declaring success.
- `update.sh` documents a measured ~5.6s non-zero-downtime `pm2 reload` window
  (fork mode, in-process singletons) and fixes a previously-real defect where
  `pm2 reload || pm2 restart` could mask a total PM2 failure while a stray bare
  `node backend/server.js` kept the health check green.
- `rollback.sh` fixes a second previously-real defect: two incompatible backup
  archive layouts (`backup.sh`'s `data/`-rooted vs. `safe-backup.cjs`'s
  `snapshot_*`-rooted) both matched the same glob, and a bare `tar -xzf`
  against the newer layout silently no-opped a restore while still reporting
  "Rollback complete." Fixed via explicit layout detection; always takes a
  pre-rollback safety-net archive first.

**Operator action required for all 8**: none of this runs unattended — a human
must run `setup-vps.sh`, edit `.env`/nginx, run `certbot`, then
`start-production.sh`.

## ecosystem.config.cjs — CODE COMPLETE

Two apps: `jarvis-os` (fork mode, deliberately never cluster — in-process
singletons) and `ooplix-backup` (cron_restart `0 2 * * *`). Memory thresholds
(`max_memory_restart: 1536M`, `--max-old-space-size=1024`) are sized from a
documented real OOM incident (a prior 512M/400M config crashed 223 times
against a measured 700-740MB real steady-state RSS). CLAUDE.md §21's
instruction not to change these thresholds without explicit request is
directly justified by this history.

## Backup / restore — two divergent implementations (new finding, sharper than Mission 43C/50)

Mission 43C/50 framed offsite backup as simply "dead config." Direct
inspection finds a **more specific problem**: there are two separate local
backup implementations that disagree, and the weaker one is the documented
default:

1. **`backup.sh`** (root, 22 lines) — what `npm run backup` actually runs.
   Plain `tar -czf` of `data/`, **no encryption, no SQLite consistency, no
   curated core-file list, no offsite export**.
2. **`safe-backup.cjs`** (172 lines) — what the PM2 `ooplix-backup` cron job
   actually runs. Real SQLite `VACUUM INTO`, a curated `CORE_BUSINESS_FILES`
   list (previously missing files caused "a real restore silently dropped the
   entire customer dataset" per its own fixed-defect comment), and chains
   automatically into `export-offsite.cjs` for AES-256-CBC encrypted, verified
   transfer to S3/rsync/local-dir if `BACKUP_PASSWORD`/`BACKUP_OFFSITE_DIR` are
   set.

**The stronger path is not what most of the repo points at.**
`deploy/update.sh`, `deploy/rollback.sh`, `deploy/validate-production.sh`,
`backend/services/deploymentReport.cjs`, `backend/services/co2FounderOps.cjs`,
`backend/services/dop1InfraValidation.cjs`, and 6 frontend hooks all
reference/recommend `npm run backup` (the weak script), not `safe-backup.cjs`.
`co2FounderOps.cjs` literally documents "Daily backup cron: bash backup.sh" as
a critical checklist item — but the actual cron runs `safe-backup.cjs`.

**Classification**: `safe-backup.cjs`+`export-offsite.cjs` = CODE COMPLETE, a
real encrypted, integrity-checked pipeline. The `backup.sh`/`npm run backup`
path that remains the human-facing default across scripts/services/UI =
STALE/INCONSISTENT DOCUMENTATION + tooling drift. Operator action required
regardless: `BACKUP_PASSWORD`/`BACKUP_OFFSITE_DIR` presence in `.env` could not
be verified (blocked per mission's own credential-safety rule) — if either is
unset, `export-offsite.cjs` no-ops to local-only storage by its own documented
behavior, meaning Mission 43C's "single point of physical failure" conclusion
likely still holds for the offsite leg specifically, pending operator
confirmation.

## Disk/resource monitoring — Mission 43C/50's "does not exist anywhere" is FALSE, live-verified

`backend/services/operationsAlertingLayer.cjs`'s `_diskStatus()` uses
`fs.statfsSync()`, fires warning at ≤15% free and critical at ≤5% free, with
dedup/auto-resolve logic shared with 5 other monitors (heap, secrets, queue
failure spike, autonomous-cycle failure rate). **`setInterval(..., 5*60_000).unref()`
runs this every 5 minutes as a module-load side effect**, and the module is
required at top-level scope by `phase22.js`, which is unconditionally mounted
in `backend/routes/index.js` — meaning **this runs on every server boot,
live, in production**, persisting to `data/ops-alerts.json` /
`data/ops-alert-history.json`. This directly contradicts the prior finding
attributed to Mission 43C/50; either that code was added after those missions
audited the repo, or it was missed because it lives inside a general alerting
file rather than a dedicated "disk monitor" file. Recommend correcting the
master register.

## PM2 log rotation — confirmed still inert, live-verified, growing

`ecosystem.config.cjs`'s own comment documents `pm2-logrotate` is not
installed (its `max_size`/`retain` config keys are silently ignored without
the module). Live-verified this session: `~/.pm2/modules` is empty;
`logs/pm2-out.log` = 85MB, `logs/pm2-err.log` = 20MB — larger than Mission
43C's last measurement, confirming unbounded growth continues. **Not
implemented. Operator action required**: `pm2 install pm2-logrotate` (a single
command, zero code changes needed — already correctly documented in
`docs/current/LOG_ROTATION_SETUP.md`).

## Sentry — CODE COMPLETE, correctly wired, honest no-op pending DSN

`backend/services/sentryService.cjs` implements a real Sentry Envelope API
client (no SDK dependency), wired into the global Express error handler,
`uncaughtException`, and `unhandledRejection`, all fire-and-forget. Every
capture function early-returns `{ok:false}` when `SENTRY_DSN` is unset — an
honest, self-documented no-op, not a fake-success stub. This wiring itself was
a previously-fixed defect ("MASTER FINAL GAP CLOSURE, C10-028" — the service
existed but nothing called it). Operator action required: set `SENTRY_DSN`.

## Electron/Android signing (`release.yml`)

Electron desktop signing is wired (mac cert+notarization, Windows cert) and
now self-verifying: a "Mission 58" warn-only post-build step checks signature
status and emits a GitHub Actions warning if unsigned, without hard-failing
the pipeline (electron-builder's own documented unsigned-build-on-missing-secret
behavior otherwise fails silently). **Android/Play Store signing does not
exist in CI at all** — no `KEYSTORE_*` secrets, no signing job — confirmed
absent, not merely undocumented, and `ci.yml`'s own comment explicitly states
this job "must not fabricate or attempt one."

## /health endpoint — real dependency checks, plus one dead code path

`backend/routes/ops.js` checks real AI-provider availability (not just
"API key string present" — that exact narrower check was itself a
previously-fixed defect), plus key-presence checks for
telegram/whatsapp/payments, degrading `status` to `"degraded"` when ≥2 of 4
services are disabled. **New finding**: a `require("../../agents/metrics/metricsCollector.cjs")`
inside a try/catch always throws in current code — that path was archived
under `_archive/20260520_010917/` and no longer exists at the live path. The
catch handles this gracefully (falls back to a minimal payload), so `/health`
itself never breaks, but this is dead, unreachable code inside a
production-relevant endpoint. Minor, in-scope for a follow-up one-line fix,
out of scope for this read-only audit.

## nginx/TLS — real templated config, not placeholder

`deploy/nginx-jarvis.conf` is a genuine production-grade config (rate limiting,
real security headers including a detailed CSP, gzip, static caching).
`yourdomain.com` is an intentional, documented placeholder that
`https-setup.sh` mechanically substitutes via `sed` plus rewrites `BASE_URL`
and runs certbot. Operator action required: run `https-setup.sh <domain>` on
the real VPS.

## Summary

| Item | Classification |
|---|---|
| Deploy scripts (8) | CODE COMPLETE, operator action required to run |
| PM2 config | CODE COMPLETE, thresholds justified by real incident |
| `safe-backup.cjs` + offsite export | CODE COMPLETE; operator must set 2 env vars |
| `backup.sh` / `npm run backup` default | STALE/INCONSISTENT documentation across 6+ files |
| Disk/resource monitoring | CODE COMPLETE, live-running — prior "does not exist" claim is FALSE |
| PM2 log rotation | NOT IMPLEMENTED, confirmed growing (85MB/20MB) |
| Sentry | CODE COMPLETE, honest no-op, operator must set DSN |
| Electron signing | CODE COMPLETE + self-verifying; operator must set cert secrets |
| Android signing | NOT IMPLEMENTED, confirmed absent by design |
| `/health` | CODE COMPLETE + 1 dead require (minor) |
| nginx/TLS | CODE COMPLETE, real template, operator must run on VPS |

See `22_DISASTER_RECOVERY.md` for the backup/restore detail and
`evidence/infrastructure/` for citations.
