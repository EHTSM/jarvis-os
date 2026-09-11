# MISSION 43C — Production Infrastructure & Operations Gap Discovery

**Date:** 2026-08-23
**Type:** Audit only (no code changes, per mission scope)
**Scope:** PM2/process topology, startup/shutdown, health checks, backup/restore,
offsite backup, retention, recovery, logging, observability, CI/CD, build pipeline,
deployment config, crash recovery, restart behavior, resource limits, filesystem
safety, configuration validation.

## Method

Direct inspection of live repo state (not documentation claims): `ecosystem.config.cjs`,
`backend/server.js` (shutdown/crash/startup paths), `scripts/safe-backup.cjs`,
`deploy/*.sh`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`,
`backend/utils/logger.js`, actual `logs/` and `backups/` directory contents on disk,
`~/.pm2/modules`, `scripts/run-test-suite.cjs`. Cross-referenced against CO1, Production
Mission 4, RC-3, RC-4 reports and their memory summaries.

---

## STATUS BY AREA

### 1. PM2 / Process Topology — **CERTIFIED**

- Single fork-mode instance for `jarvis-os`, correctly documented as required
  (in-process singletons — taskQueue, learningSystem, contextEngine — are not
  cluster-safe). `instances: 1` enforced.
- Second app entry (`ooplix-backup`) is a `cron_restart` job, not a second server
  instance — no `EADDRINUSE` risk, matches CLAUDE.md §7 constraint.
- `max_restarts: 5` + `min_uptime: 15s` crash-loop guard present and sized correctly
  post-Phase-B.8 (previously masked by run times exceeding `min_uptime`).
- `max_memory_restart: 1536M` + `--max-old-space-size=1024` sized from measured
  steady-state RSS (738 MB), with documented headroom. Consistent with current
  `memoryTracker` WARN_HEAP_MB (350 MB, an early-warning threshold, not the ceiling).

### 2. Startup / Shutdown — **CERTIFIED**

- `_gracefulShutdown()` in `backend/server.js` stops, in order: HTTP listener,
  autonomous task loop, automation cron, browser scheduler, content scheduler,
  org automation scheduler, founder identity sync scheduler, memory sampler, event
  bus (SSE), SQLite connection (`closeDB()` — WAL checkpoint/truncate). 5s drain
  window before `process.exit(0)`, timer `.unref()`'d so it can't itself block exit.
  This list reflects fixes from a prior "Scheduler Reliability & Recovery Audit"
  (2026-08-16) that are still present and wired — not regressed.
- `wait_ready: true` + `process.send("ready")` after `app.listen()` confirmed present
  — PM2 won't report a restart complete before the port is actually accepting.
- `kill_timeout: 8000` > the 5s drain window — correct ordering maintained.
- Env validation on boot: per-service required/optional var declaration
  (`ai: required`, `telegram/firebase/maps: optional`) degrades non-fatally;
  `JWT_SECRET`/`OPERATOR_PASSWORD_HASH` are hard-required in production with a
  fatal, actionable error message. This is real config validation, not cosmetic.

### 3. Health Checks — **CERTIFIED**

- `/health` unauthenticated probe exists and is used by CI's server-readiness wait
  loop, `deploy/healthcheck.sh`, and `deploy/validate-production.sh`.
- Prior Mission-4 fix (env key names removed from `/health` warning output) still
  reflected in current route behavior per code inspection — no regression found.

### 4. Crash Recovery — **CERTIFIED**

- `uncaughtException` writes synchronous forensics to `data/crashes/` (queue state,
  last event, drift report, PM2 attribution, memory snapshot, truncated stack) before
  exiting for a clean PM2 restart. `unhandledRejection` logs + continues (correct —
  not treated as fatal).
- Telegram crash alerting is wired but conditionally no-ops if
  `TELEGRAM_OPERATOR_CHAT_ID` unset — this is a known, already-documented
  (Mission 4) soft dependency, not a new finding.

### 5. Backup / Restore — **PARTIALLY CERTIFIED**

- `scripts/safe-backup.cjs` (live-read in full) is materially stronger than what
  CLAUDE.md's history implies: it now backs up core business data (leads,
  organizations, missions, memory-store, vault, fdios-state, org-context) — the
  exact dataset a prior Phase B.5 audit found *missing* from every archive. This
  gap is fixed and currently in place.
- SQLite backup uses `VACUUM INTO` for a consistent, WAL-independent single-file
  copy — correct pattern for an online SQLite backup.
- `.env` is deliberately excluded; only a non-secret key allowlist is recorded.
  Correct per CLAUDE.md §20.
- Retention: keeps last 7 `jarvis_full_*.tar.gz` archives, verified live —
  `backups/` on disk currently holds exactly 7 dated archives, consistent with the
  script's own pruning logic actually running (not just documented).
- **REAL DEFECT: `BACKUP_OFFSITE_DIR` is entirely unimplemented.** It is referenced
  only once in the entire repo — a comment in `ecosystem.config.cjs` ("Set
  BACKUP_OFFSITE_DIR in .env to rsync the archive to a remote path"). `grep` across
  every `.cjs`/`.js` file, including `safe-backup.cjs` itself, confirms
  `process.env.BACKUP_OFFSITE_DIR` is never read anywhere. There is no rsync, no
  remote copy, no offsite step of any kind. All backups — the 7 retained archives
  plus every prior daily run — write to `backups/` on the **same local disk** as
  the live `data/` directory and the running application. A single disk failure,
  VPS provider incident, or `rm -rf` mistake destroys production data and every
  backup simultaneously. This was already flagged as a founder action item in
  RC-4 ("offsite backups" under HIGH-priority checklist items G9–G15) but RC-4
  scored it as a checklist item to complete, not as a confirmed-absent code path
  — this mission's direct grep confirms there is no code to invoke even if the
  env var were set today. **Recommend folding into a single remediation mission**
  (see Remediation Missions below).

### 6. Retention — **PARTIALLY CERTIFIED**

- Backup retention (7 archives, local): CERTIFIED, verified live on disk.
- PM2 log retention: **REAL DEFECT.** `ecosystem.config.cjs` declares
  `max_size: "10M"` / `retain: 5` under the app's `out_file`/`error_file` block,
  but these are `pm2-logrotate` **module** options — core PM2 silently ignores
  them without that module installed. Live-verified: `~/.pm2/modules` is empty
  (no logrotate module present on this machine), and on-disk log files are
  **`logs/pm2-out.log` = 88.6 MB** and **`logs/pm2-err.log` = 20.9 MB** — both far
  past the "10 MB" the config claims, with zero rotated `.log.1`/`.gz` files
  present. This is the same gap Production Mission 4 already documented
  ("Deductions: ... no structured JSON log format") and RC-3 flagged as
  stability risk #5 ("Log files unbounded → PM2 log rotation") — it is
  **still unresolved at time of this audit**, not a regression, but also not
  fixed since it was first identified. Confirmed current, not stale.
- Optional `LOG_FILE` app-level file sink (`backend/utils/logger.js`) has no
  size cap or rotation logic of its own — if operators set `LOG_FILE` per
  Mission 4's own "Remaining Manual Steps" #2, that file grows unbounded too,
  independent of the PM2-log gap above.
- Audit log (`backend/utils/auditLog.cjs`) rotates at 20MB per Mission 4 —
  CERTIFIED, distinct subsystem from the two gaps above, not affected.

### 7. Recovery Procedures — **CERTIFIED**

- `deploy/rollback.sh`: both data-restore mode (from `backups/jarvis_*.tar.gz`)
  and code-rollback mode (`--code <commit>`, backs up `.env` first, `pm2 stop`,
  `git checkout` of just the app dirs, leaves `.env`/`data/` untouched) present
  and structured correctly, matching documented Mission-4/RC-3 recovery patterns.
- `deploy/validate-production.sh`: 30-check production validation script,
  covering env/server/auth/routes/PM2/nginx/SSL/backups/monitoring/data
  integrity, both human and `--json` output modes — present and current.

### 8. Logging — **PARTIALLY CERTIFIED** (see Retention above for the size-cap gap)

- 4-level structured logger with timestamps, trace-ID propagation
  (`X-Trace-Id`), and optional file sink — CERTIFIED as functionality.
- Unbounded growth risk under both PM2's own log files and an operator-enabled
  `LOG_FILE` — REAL DEFECT, see §6.

### 9. Observability — **CERTIFIED**

- `/health` (unauthenticated), `/metrics` and `/ops` (auth-gated) all present.
- Custom Prometheus-format metrics collector — a deliberate PASS-BY-DESIGN
  substitute for a Prometheus dependency, already accepted in Mission 4.
- No distributed tracing (OpenTelemetry) — already a documented, accepted
  limitation (Mission 4 Observability deduction), not re-litigated here as new.

### 10. CI/CD — **CERTIFIED, with one documentation drift to flag**

- `.github/workflows/ci.yml` runs 5 jobs: security audit (`npm audit
  --audit-level=high`, non-blocking), backend regression, frontend build
  (with build-output verification), **deploy-script verification** (`bash -n`
  syntax check on every `deploy/*.sh` + `shellcheck -S warning`, non-blocking),
  and a full production-validation job. This deploy-script CI gate did not
  exist in earlier audit cycles' descriptions and is a genuine strengthening
  since Mission 4/CO1 — noted as positive drift, not a defect.
- **DECISION REQUIRED / doc-drift, not a defect:** CLAUDE.md §9 states CI's gate
  literally does `grep -E "pass 144"` against a hardcoded 10-file
  `test:runtime` script, and that this represents CI "presenting itself as a
  full regression gate" while validating a narrow, stale subset. Live
  inspection of the **current** `.github/workflows/ci.yml` and `package.json`
  shows this is no longer accurate: `test:runtime` now invokes
  `scripts/run-test-suite.cjs runtime`, which **discovers every
  `tests/runtime/*.test.cjs` file at run time** (currently 116 files, not 10),
  runs a small explicitly-documented subset sequentially only to avoid a known
  `missionMemory.cjs` race condition, and CI's pass/fail gate is the script's
  **exit code**, not a string-matched count. `tests/security/` (also 116
  files) is run via a separate `test:security` CI step. Per CLAUDE.md's own
  instruction ("do not silently fix the 144 number... surface the discrepancy
  and let the user decide"), this is surfaced here: **the repo appears to have
  already fixed this gap since CLAUDE.md §9 was last written**, and §9 itself
  is now the stale artifact, not the CI config. Recommend the user confirm and
  update CLAUDE.md §9 accordingly — no code change made by this audit.

### 11. Build Pipeline — **CERTIFIED**

- `build-frontend` CI job builds CRA output and asserts `index.html` +
  `static/` exist before uploading as a 7-day-retained artifact — catches the
  exact "stale disk build served" class of defect noted historically (C.1 audit
  comment still present in server.js).

### 12. Deployment Configuration — **CERTIFIED**

- `deploy/setup-vps.sh` includes `pm2 startup systemd` wiring for reboot
  persistence — addresses RC-3 stability risk #4.
- nginx configs (`nginx-jarvis.conf`, `nginx-multisite.conf`) and
  `https-setup.sh` present; not independently re-verified against a live VPS
  per mission's "do not touch VPS" constraint — scope respected.

### 13. Resource Limits — **PARTIALLY CERTIFIED**

- Memory ceiling (`max_memory_restart`, `--max-old-space-size`): CERTIFIED,
  measured and sized correctly per Phase B.8 history.
- **DECISION REQUIRED:** No OS-level file-descriptor (`ulimit`/`LimitNOFILE`)
  or process-count tuning found in `deploy/setup-vps.sh` or
  `ecosystem.config.cjs` for the PM2-managed process. Given the app opens SSE
  streams, SQLite WAL handles, and 57+ external connectors, default OS
  `ulimit -n` (often 1024 on a fresh VPS) could become a real ceiling under
  load. Not confirmed as an active defect (no live measurement of concurrent
  FD usage was performed — out of scope, no VPS access), but no evidence it
  has ever been checked either. Flagged as a gap to decide on, not a proven
  defect.

### 14. Filesystem Safety — **PARTIALLY CERTIFIED**

- SQLite: WAL checkpoint/truncate on graceful shutdown fixed (per §2). `VACUUM
  INTO` used for backups (atomic, consistent). Both CERTIFIED.
- **REAL DEFECT (same root cause as §6):** no disk-space/capacity monitoring
  exists anywhere in `backend/server.js` or `memoryTracker`-equivalent
  services — only heap/RSS is sampled. Combined with the unbounded PM2 log
  growth in §6 (108 MB combined, live-measured, on a single machine that
  isn't even under sustained production load) and backups accumulating on the
  same volume, there is no automated signal before a full-disk event, which
  would take down logging, the SQLite WAL, and JSON persistence
  simultaneously. This was not separately called out in any prior report
  reviewed (Mission 4, RC-3, RC-4, CO1) — it is a **new finding**, not a
  restatement of an existing one, though it shares a root cause with the log
  rotation gap.

### 15. Configuration Validation — **CERTIFIED**

- Per-service required/optional env declaration with graceful degradation,
  hard-fail on missing `JWT_SECRET`/`OPERATOR_PASSWORD_HASH` in production,
  actionable error messages (includes the exact `node -e` command to generate
  a secret) — this is real, load-bearing validation, not a checklist item.

---

## REAL DEFECTS SUMMARY (live-verified, unresolved as of 2026-08-23)

| # | Defect | Evidence | Severity |
|---|--------|----------|----------|
| 1 | `BACKUP_OFFSITE_DIR` documented but never implemented — no code path reads it | `grep` across full repo: only hit is the `ecosystem.config.cjs` comment | HIGH — single point of physical failure for all data + backups |
| 2 | PM2 log rotation config (`max_size`/`retain`) is inert without `pm2-logrotate` module, which is not installed | `~/.pm2/modules` empty; `logs/pm2-out.log` = 88.6 MB, `logs/pm2-err.log` = 20.9 MB on disk right now | MEDIUM — known since Mission 4/RC-3, still open |
| 3 | No disk-space/filesystem-capacity monitoring anywhere in the runtime | `memoryTracker`-class services sample heap/RSS only; no `df`/disk check found | MEDIUM — new finding, shares root cause with #2 |

## DECISION REQUIRED

| # | Item | Why it needs a decision, not a fix |
|---|------|--------------------------------------|
| 1 | CLAUDE.md §9's "CI greps for pass 144 against a stale 10-file subset" claim appears outdated — current CI runs the full, self-discovering `tests/runtime/*.test.cjs` corpus (116 files) gated on exit code | Per CLAUDE.md's own instruction, this discrepancy must be surfaced, not silently corrected. Needs the user to confirm and, if agreed, update §9 rather than have this audit rewrite project documentation unasked. |
| 2 | No OS-level `ulimit`/file-descriptor tuning found for the PM2-managed process | Not proven as an active failure (no VPS load test performed, out of mission scope) — a capacity decision, not a confirmed bug |

## CERTIFIED AREAS (no action needed)

PM2/process topology, startup sequencing, graceful shutdown ordering, health
checks, crash forensics + alerting, backup *content* completeness (post Phase
B.5 fix) and local retention count, recovery/rollback scripts, CI regression +
build + deploy-script verification jobs, observability endpoints, config
validation on boot.

---

## REMEDIATION MISSIONS (combined, small set)

**Remediation Mission A — Offsite Backup Implementation**
Scope: implement the actual `BACKUP_OFFSITE_DIR` rsync/remote-copy step in
`scripts/safe-backup.cjs` (the env var and doc comment already exist — only the
code path is missing), plus a post-copy verification step (checksum or file-size
compare) so a silent rsync failure doesn't read as a successful offsite backup.
Directly closes REAL DEFECT #1 and the RC-4 founder-checklist item it was
already tracked under.

**Remediation Mission B — Log & Disk Capacity Safety**
Scope: install/wire `pm2-logrotate` (or equivalent enforced rotation) to make
the existing `max_size`/`retain` config in `ecosystem.config.cjs` actually take
effect, AND add a lightweight disk-space check (reuse the existing
`memoryTracker`-style periodic sampler pattern rather than inventing a new
subsystem) that warns/alerts via the existing Telegram alerting path before a
volume fills. Combines REAL DEFECTS #2 and #3 since they share one root cause
(unbounded local disk growth with no automated signal) and one natural fix
location.

**Decision-only, no mission needed yet:**
- CLAUDE.md §9 update (pending user confirmation).
- `ulimit`/FD-limit tuning (pending an actual load measurement to justify scope).

---

## Mission Compliance

- No files modified.
- No packages installed.
- No VPS/production systems touched.
- No `.env`/credential files read, printed, or modified.
- No git commit/push/merge performed.
- Cross-referenced against: CO1, Production Mission 4, RC-3, RC-4 (memory +
  where available, underlying `reports/` files).
- Single audit pass, stopped per mission instruction.
