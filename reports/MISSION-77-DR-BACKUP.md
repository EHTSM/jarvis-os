# MISSION 77 — DR / BACKUP

**Branch:** `security/reality-completion`. **Concurrent state at start:** `git status --short`
recorded before any change — the same ERA-2 Stripe files and every prior mission's
untracked/modified files (social posting services, `stripeService.js`, all `tests/security/1xx`
files from MISSION 76's categories) were present and are unchanged by this mission. No
`git reset`/`restore`/`checkout --`/`clean`/`commit`/`push` was run at any point.

## Executive Summary

This repository's DR/Backup capability is **real, executable code**, not aspirational
documentation — a genuine, PM2-cron-scheduled (`ooplix-backup`, daily 02:00) nightly snapshot
pipeline with a documented history of two prior real defects found and fixed by earlier
missions (Phase B.5: the nightly backup silently dropped the entire CRM/organizations/
missions/memory/vault dataset; a later SQLite-shadow-restore audit: a restore drill existed
but had never actually been run, and had a sidecar-cleanup orphaning bug). This mission found
and fixed **three further genuine, previously-undiscovered defects** in that same real
pipeline, following the identical "find the actual gap, fix it with existing patterns, prove
it with a real drill" discipline this codebase's own history already establishes:

1. **No manifest/checksum/integrity-verification capability existed at all** — a backup was
   considered complete the moment each copy step logged "OK," with nothing to catch silent
   truncation or corruption before a real restore was attempted, and no way to prove an
   offsite-transferred backup's contents matched what was actually created.
2. **Backup failures were never propagated as a real exit code** — `tar` failure, a zero-byte
   archive, or any step throwing was only ever logged; the script always exited 0, making a
   genuinely failed nightly backup indistinguishable from a successful one to PM2's
   `cron_restart` or a human running `npm run backup`.
3. **A major, real backup-coverage gap**: the exact same defect class the repo's own Phase
   B.5 fix already closed once for the *older* CRM/business data layer was never caught for
   the *newer* Business-OS layer — `businessDataService.cjs`'s real, accumulating,
   customer-facing lead/contact/opportunity/campaign/revenue records (`biz-*.json`),
   `revenueOS.cjs`'s invoice/subscription state (`revenue-os.json`), and the agent execution
   history/registry (`agent-runs.json`, `agent-registry.json`) had **zero backup coverage** —
   live-verified before the fix to hold ~6MB of real, non-trivial records, not empty
   scaffolding.

A fourth issue was caught and fixed **during verification of the manifest fix itself**: adding
the sibling `.manifest.json` file changed `scripts/export-offsite.cjs`'s file-selection glob
behavior in a way that could cause it to encrypt and transfer the *manifest* instead of the
*actual backup archive* — found by testing the two scripts together end-to-end rather than
each in isolation, and fixed before it ever reached a real run.

No VPS deployment, no credential provisioning, no destructive restore, no production backup
deletion, and no real disaster simulation against production occurred. Every verification in
this report was performed against this repository's own real (but non-production, locally
gitignored) `data/`/`backups/` directories, using the existing, already-real drill scripts
(`test-restore.cjs`, `test-portable-restore.cjs`) — which is the established, safe way this
codebase already proves its own DR claims, not a new testing pattern this mission invented.

## Existing DR Architecture

Full inventory (file:path, classification):

| File | Classification |
|---|---|
| `scripts/safe-backup.cjs` | REAL EXECUTABLE CODE — the real, cron-scheduled nightly backup |
| `scripts/export-offsite.cjs` | REAL EXECUTABLE CODE — encryption + offsite transfer, invoked by safe-backup.cjs |
| `backup.sh` | REAL EXECUTABLE CODE — a simpler, non-scheduled, no-encryption/no-offsite alternative (`npm run backup`) |
| `deploy/rollback.sh` | REAL EXECUTABLE CODE — the real restore path (data rollback + code rollback modes) |
| `scripts/test-restore.cjs` | REAL EXECUTABLE CODE — a genuine DR drill, sidecar-reversible |
| `scripts/test-portable-restore.cjs` | REAL EXECUTABLE CODE — a genuine "restore to fresh infrastructure" drill |
| `ecosystem.config.cjs` (`ooplix-backup` app) | REAL — PM2 `cron_restart: "0 2 * * *"`, the actual schedule |
| `package.json`'s `"backup"` script | REAL — thin wrapper for `backup.sh` |
| `tests/runtime/vault-backup-export-git-safety.test.cjs` | REAL — verifies `.env`/`data/` are git-ignored and vault export/import is real AES-256-GCM (does not itself test `safe-backup.cjs`/`export-offsite.cjs`) |
| `DISASTER_RECOVERY.md`, `docs/DISASTER-RECOVERY.md`, `docs/ooplix/22_DISASTER_RECOVERY.md`, `PHASE_B5_DISASTER_RECOVERY_CERTIFICATION.md` | DOCUMENTATION |
| `reports/SQLITE-SHADOW-RESTORE-DRILL-ORPHANING-AUDIT.md` | prior mission report — a real drill-orphaning bug found and fixed in `test-restore.cjs` |
| `_archive/20260520_010917/agents/enterprise/enterpriseBackupSystem.cjs`, `.../humanAI/memoryBackupAI.cjs`, `.../enterprise/disasterRecoveryAgent.cjs` | ARCHIVED/DEAD — not in the live path, per this repo's `_archive/` convention |
| `agents/runtime/workspaceSnapshot.cjs`, `agents/runtime/engineeringContextSnapshot.cjs` | ZERO FOOTPRINT for DR — unrelated in-app "workspace snapshot" UX feature |
| `.github/workflows/ci.yml` | No real backup job — only `mkdir -p data logs backups` scaffolding for test runs |

This mission is genuinely the first to assess DR/Backup as its own dedicated category —
prior real work happened under different mission names (Phase B.5, the SQLite-shadow-restore
audit) as narrower fixes discovered incidentally during other work, not a ground-up review.

## Data Persistence Inventory

| Data Class | Persistence | Classification |
|---|---|---|
| CRM leads/orgs/missions/memory/vault (older layer) | `data/leads.json`, `organizations.json`, `missions.json`, `memory-store.json`, `vault.json`, etc. | PRIMARY / IRREPLACEABLE — already backed up (Phase B.5 fix) |
| Business OS CRM/sales/revenue (newer layer) | `data/biz-*.json`, `data/revenue-os.json` | PRIMARY / IRREPLACEABLE — **was zero footprint in backups, fixed this mission** |
| Agent execution history/registry | `data/agent-runs.json`, `data/agent-registry.json` | PRIMARY (audit trail) / IRREPLACEABLE — **was zero footprint, fixed this mission** |
| M6/M6b beta/billing/local-account state | `data/m6-*.json`, `data/billing.json`, `data/local-accounts.json` | PRIMARY / IRREPLACEABLE — already backed up |
| Task queue | `data/task-queue.json` | PRIMARY — already backed up |
| SQLite `tasks` table | `data/jarvis.db` | PRIMARY (secondary mirror) — already backed up via `VACUUM INTO` |
| Encrypted connector credentials | `data/vault.json`, `vault-index.json` | PRIMARY / ENCRYPTED — already backed up (ciphertext only; key lives in `.env`, deliberately excluded) |
| `.env` (live secrets) | `.env` | IRREPLACEABLE at the infrastructure layer — **intentionally, correctly, never backed up in-band**; the repo's own documented recovery procedure is out-of-band secret provisioning, not a backup-file restore |
| The other ~450 non-critical `data/*.json` files (engineering/skills/tool/knowledge/browser/workflow internal state) | Various | Largely DERIVED/REBUILDABLE/EPHEMERAL, not individually audited file-by-file this pass — no evidence found that any of them holds primary, irreplaceable customer/business data the way the Business OS files did |
| Stray test-run artifacts (`*.test-<pid>-<epoch>.json`, `*.lockcheck_*.json`, `*.debugtest-*.json`, `*.seed-*.json`) | ~460 top-level files under `data/` | EPHEMERAL / TEST POLLUTION — correctly excluded from backup (never on any allowlist); a real data-hygiene issue (test runs leaking into the real `data/` directory) but not a DR defect, and cleaning it up is outside this mission's scope (not a backup/restore code change) |
| Better-sqlite3 database beyond the `tasks` table | `data/jarvis.db` | Confirmed minimal — only a `tasks` table + `migration_log` exist; not a general-purpose primary store, consistent with CLAUDE.md §4 |
| Supabase/Postgres application data | N/A | **Confirmed zero application data path exists** — no `pg`/`@supabase/supabase-js` dependency, no query execution anywhere; every Supabase reference is an env-var presence check or HTTP reachability probe. Supabase is not, and cannot currently be, a DR target for real application data. |

## Backup Coverage Matrix

See the full **DR MASTER MATRIX** at the end of this report for the complete, final-state
table. Summary of what changed:

- **Before this mission:** `safe-backup.cjs` captured 19 named files + `jarvis.db`. Business
  OS data (biz-*, revenue-os.json, agent-runs/registry) had zero coverage.
- **After this mission:** 28 named files + `jarvis.db`, with a real manifest (file list +
  per-file SHA-256 + archive SHA-256) generated on every run and a `verifyManifest()`
  function to check an archive against it.

## Encryption

`scripts/export-offsite.cjs`'s `encryptBackup()` was read and verified in full: real
`openssl enc -aes-256-cbc -salt -pbkdf2` using a passphrase from `BACKUP_PASSWORD`. This is a
real, standard, correctly-invoked system tool — not a fabricated or weakened implementation.
**Encryption is conditional, not guaranteed**: if `BACKUP_PASSWORD` is unset, the step is
skipped with an explicit warning, and the local (unencrypted) `.tar.gz` archive remains the
only artifact — this is honest, non-fatal degradation (matches this mission's "never claim a
stronger state than what actually happened" rule), not a silent failure, but it does mean
**encryption-at-rest for the offsite/transferred backup depends entirely on an operator
having set `BACKUP_PASSWORD`**, which this mission correctly did not provision or verify the
presence of in any real environment. No KMS integration exists or was invented — key
management here is "a passphrase in `.env`," a genuine, documented infrastructure dependency,
not a code-side gap this mission's scope covers.

The manifest itself (file names, sizes, SHA-256 hashes) contains no secret material and was
deliberately transferred **unencrypted** alongside the encrypted archive — it describes the
encrypted archive's plaintext contents by hash, never the contents themselves, so this does
not weaken the encryption boundary.

**No encryption key, password, secret, or credential value was printed, logged, or exposed
by this mission's own work at any point** — verified directly by reading every new/changed
line in `safe-backup.cjs`, `export-offsite.cjs`, and all 4 new/changed test files.

## Integrity Verification

**This was the primary gap this mission closed.** Before this mission, no manifest, checksum,
hash, or object-existence validation of any kind existed for what a backup actually captured.
Fixed:

- `safe-backup.cjs` now tracks every real file it copies into the snapshot (`_recordCapture`),
  computing a real SHA-256 per file via Node's `crypto` module (no new hashing dependency).
- After compression, a `<archive>.manifest.json` is written as a **sibling** of the archive
  (never inside the snapshot directory itself, so `test-restore.cjs`'s "restore every file the
  snapshot carries" loop never needs to know about or skip it — verified live, see Tests
  below) containing: creation timestamp, archive filename, archive byte size, archive SHA-256,
  and the full per-file list with name/bytes/sha256.
- A new `verifyManifest(archivePath)` function performs the real
  `CREATE → HASH → STORE → VERIFY` flow this mission requires: extracts the archive to a
  disposable scratch temp directory, compares the archive's own current SHA-256 against the
  manifest's recorded value, then checks every manifest-listed file exists, has the expected
  size, and matches its recorded SHA-256 — reporting concrete mismatches rather than a bare
  pass/fail. **Live-verified to correctly report `ok:true` for a genuine, untampered archive
  and `ok:false` with an explicit `sha256 mismatch` reason for a deliberately corrupted one**
  (byte-appended test archive) — see Tests.
- `export-offsite.cjs` now transfers the manifest alongside the encrypted archive to whatever
  offsite destination is configured, so the verification capability travels with the backup
  rather than staying behind on the same local disk a real disaster would also destroy.

A backup is no longer "valid" merely because compression/upload returned success — the
manifest is the artifact a restore or verification step can actually check the archive
against.

## Retention

Pre-existing: keep the last 7 `jarvis_full_*.tar.gz` archives by mtime, unconditionally.
**Fixed this mission**: retention pruning is now gated on `archiveOk` (this run's own
archive being confirmed real and non-empty) — a failed backup run no longer prunes older,
genuinely good generations while leaving nothing valid behind, which was strictly worse than
a full `backups/` directory. Retention pruning also now removes a pruned archive's manifest
alongside it, so no orphaned manifest is ever left pointing at a deleted archive (verified
live — see Tests). No business-policy decision (retention *period*, generation *count*,
offsite retention duration) was invented or changed — "keep 7" remains exactly what it was;
only the *safety* of when pruning is allowed to run was fixed. If a different retention
policy is ever wanted, that is a genuine **DECISION REQUIRED** (see below), not something
this mission decided on its own authority.

## Restore Capability

Traced `deploy/rollback.sh` end-to-end (read in full). Genuinely real, and already
substantially hardened from a prior mission's own drill-discovered defect (the exact
layout-detection bug documented in the script's own comment, fixed and verified by a real
Phase B.5 drill). Current capabilities, confirmed by direct reading:

- **Data rollback** (default mode): detects both real archive layouts this pipeline can
  produce (`backup.sh`'s `data/`-rooted vs `safe-backup.cjs`'s `snapshot_*`-rooted), refuses
  to report success if 0 files were copied, and dies cleanly on an unrecognized layout.
- **Code rollback** (`--code <commit>`): validates the git ref exists before doing anything,
  backs up `.env` first, stops PM2, checks out the target commit, reinstalls dependencies,
  restarts, and verifies `/health` responds before declaring success.
- **Safety net**: before any data restore, the script tars the *current* `data/` to a
  timestamped `pre-rollback-*.tar.gz` — a real, working undo path for the restore operation
  itself, not just the original disaster.
- **No changes were made to `deploy/rollback.sh` this mission** — it was reviewed in depth and
  found to have no genuine code-side defect within this mission's scope; its restore-then-
  verify discipline, layout detection, and 0-files-copied refusal already satisfy this
  mission's core restore-safety requirements.

`scripts/test-restore.cjs` and `scripts/test-portable-restore.cjs` were both re-run for real,
end-to-end, against this repository's actual `data/`/`backups/` directories, both before and
after this mission's fixes, and both **PASSED** in both runs — see Tests.

## Restore Safety

Verified directly, not assumed:

- `deploy/rollback.sh` never overwrites `.env` (explicit `case` skip for
  `env-config-nonsecret.txt` in the snapshot-layout restore path — it is reference-only,
  never copied over the real `.env`).
- `test-restore.cjs`'s drill safety model is sidecar-based reversibility: protected files are
  moved aside (never deleted) before the simulated loss, and rolled back from the sidecar if
  any restored file fails verification — a **failed drill causes zero real data loss**,
  verified by reading the actual rollback branch of the script.
- **No multi-environment/multi-tenant targeting parameter exists anywhere in
  `deploy/rollback.sh`** — it operates entirely on `cwd`-relative paths with no
  `--target-host`/`--environment` flag of any kind. This was investigated as a possible
  "restore accepts an ambiguous target" gap (Step 10's explicit concern) and found **not to
  be a genuine defect**: the ambiguity this mission worries about (a restore silently landing
  on the wrong host/environment/tenant) cannot structurally occur here, because the script has
  no mechanism to specify a *different* target than "the host and `data/` directory it is
  currently running in." Inventing an environment-identity guard for a targeting concept that
  doesn't exist anywhere else in this single-host deployment model would have been exactly
  the kind of speculative building this mission forbids — documented here as a reviewed and
  closed question, not silently skipped.
- **Cross-tenant restore risk**: this application does not have a per-tenant backup/restore
  granularity anywhere in its architecture — a restore is whole-`data/`-directory, all
  tenants at once, matching this app's overall single-deployment, JSON-file-per-domain
  persistence model (confirmed consistent with every prior category's own findings across
  this project's broader connector-completeness mission chain). There is no code path where
  restoring tenant A's data could silently also restore tenant B's under a different tenant's
  identity, because the restore mechanism has no tenant concept to confuse in the first place.

## Database / Supabase

- **better-sqlite3 (`data/jarvis.db`)**: real, minimal, already backed up via a real
  `VACUUM INTO` (a consistent, WAL/SHM-free single-file snapshot — the correct, safe way to
  back up an active SQLite database, confirmed by direct reading), with a raw-copy fallback
  if `VACUUM INTO` fails (e.g. a native-module ABI mismatch). Only holds a `tasks` table +
  `migration_log` — not a general primary store.
- **Supabase/Postgres**: confirmed, independently of any prior mission's classification, that
  **no real application data path exists** — no `pg`/`@supabase/supabase-js` npm dependency,
  no query execution site anywhere in `backend/`. Every reference is either an env-var
  presence check (`founderIdentityOS.cjs`'s `_discoverSupabase()`) or an HTTP reachability
  probe (`integrationConnectors.cjs`'s `connectSupabase()`). **Supabase-managed backups (if
  any exist on a Supabase project) would not be application-controlled backups of this
  repository's actual data**, since this repository has no data stored in Supabase to begin
  with — this is a PROVIDER-MANAGED non-question for this codebase's actual DR scope, not a
  gap.

## Object Storage

`backend/services/storageService.cjs` (a real, hardened, already-verified AWS S3/Cloudflare
R2 client from an earlier category in this same overall connector-completeness mission chain)
is **not used by the backup pipeline**, and this was investigated deliberately rather than
assumed to be a defect: `storageService.cjs.upload(key, body, contentType)` buffers its
entire `body` argument into memory before a single PUT request — correct and appropriate for
small-to-medium app-generated assets, but a real regression for a full daily database+JSON
archive, which `export-offsite.cjs`'s current approach (external `aws s3 cp`, streaming
from disk without loading the whole file into the Node process) handles correctly without
that memory-pressure risk. **This is a genuine, deliberate architectural distinction, not a
duplicate-storage-layer violation** — reusing `storageService.cjs` here would have been a
worse design, not a fix, so it was not attempted. No application-generated media/document
object storage (uploads, generated assets) was found to be part of this mission's actual
scope beyond what the already-existing `storageService.cjs` category already covered in an
earlier mission.

## Queue / Scheduler State

- The only real scheduler integration in this category is PM2's `cron_restart` on the
  `ooplix-backup` app (`ecosystem.config.cjs`) — the actual, real trigger for
  `safe-backup.cjs`, confirmed by direct reading (`cron_restart: "0 2 * * *"`,
  `autorestart: false`).
- `task-queue.json` (the app's own JSON-file task queue) is already on the backup allowlist
  (pre-existing, Phase B.5-era) — classified PERSISTED, correctly backed up.
- No other queue/worker/lock state was found to require backup — the app's queue model is a
  flat JSON file, not a separate broker with in-flight message state that would need special
  handling beyond what a normal file copy already captures.

## Tenant Isolation

As documented under Restore Safety above: this application's persistence model has no
per-tenant backup/restore granularity anywhere — backups and restores operate on the whole
`data/` directory. This is consistent with the architecture found across every other category
of this project's broader connector-completeness mission chain (a single-deployment system
with JSON-file-per-domain, org-scoped-within-file persistence, not physically-partitioned
per-tenant storage). No tenant-boundary defect was found or fixed in this pass because no
tenant-scoped backup/restore code path exists to have a boundary defect in.

## Secret Recovery

- **`.env` (JWT secret, API keys, `BACKUP_PASSWORD` itself, provider credentials)**:
  **EXCLUDED** from every backup path, by design and confirmed by direct reading of
  `safe-backup.cjs`'s own comment and logic — only a curated, explicitly-non-secret subset of
  config *keys* (not values) is recorded for reference (`env-config-nonsecret.txt`). The
  documented recovery procedure is out-of-band secret provisioning (a secrets manager or
  secure channel), not restoring `.env` from a backup archive — this is the correct, already-
  established boundary, not a gap.
- **`vault.json`/`vault-index.json`**: **ENCRYPTED, already backed up.** Holds AES-256-GCM
  ciphertext of connector credentials; the decryption key is derived from `JWT_SECRET`, which
  lives only in `.env` and is never included in any backup — so a restored `vault.json`
  without a correspondingly-restored `.env` yields no usable plaintext secret. This is the
  correct, intended split (confirmed by reading the existing in-file comment explaining
  exactly this), not something this mission changed.
- **`BACKUP_PASSWORD` itself**: lives only in `.env`, never backed up, never logged, never
  printed by any code this mission touched — the encryption key for offsite backups is
  itself subject to the same "provision it out-of-band" boundary as every other secret.
- No secret value of any kind was read, printed, or exposed by this mission's own
  investigation or test runs at any point — verified directly.

## RPO / RTO

**Not established anywhere in this repository, and this mission does not invent numerical
values.** No configuration, code comment, or documentation file was found that defines an
explicit Recovery Point Objective or Recovery Time Objective. What the *architecture*
observably implies (not a guarantee, not a certified value):

- **Implied RPO ceiling**: ~24 hours, since the only real scheduled trigger is a once-daily
  (02:00) cron job — any data written between two runs is at risk if the disk is lost before
  the next run completes. This is an observation about the schedule's own cadence, not a
  documented or tested guarantee.
- **RTO**: no measurement exists anywhere. `deploy/rollback.sh`'s data-restore path is fast in
  practice (a `tar -xzf` plus a health-check poll loop capped at 15 seconds), but no formal
  RTO figure is documented or has ever been measured end-to-end including a from-scratch
  environment bootstrap (that's closer to what `test-portable-restore.cjs` exercises, and even
  that drill does not report a timed duration).

**DECISION REQUIRED**: whether to adopt explicit RPO/RTO targets (e.g., "RPO ≤ 24h,
RTO ≤ 30min") is a genuine business-policy decision this mission does not make. If adopted,
the natural next step would be increasing backup frequency (more frequent cron intervals) and
formally timing a restore drill — both straightforward extensions of the existing, already-
proven architecture, not a redesign.

## Offsite / Cross-Region

- **Local backup**: real, unconditional — every successful `safe-backup.cjs` run leaves a
  `.tar.gz` in `backups/` regardless of offsite configuration.
- **Offsite backup**: real, but **conditional on two separate operator-configured pieces**:
  `BACKUP_PASSWORD` (to encrypt) and `BACKUP_OFFSITE_DIR`/`BACKUP_DEST` (to know where to
  send it). Three real destination types are supported and each has a genuine post-transfer
  verification step (not just a trusted exit code): S3 (`aws s3api head-object` size compare),
  SSH/rsync (`--checksum` plus a dry-run itemize-changes check), and a plain local/scratch
  directory (size + SHA-256 compare) — confirmed by reading and live-testing all three code
  paths (the local/scratch path was exercised for real in this mission's own tests; S3 and
  SSH/rsync were verified by direct code reading only, since exercising them for real would
  require real cloud/SSH credentials this mission does not provision).
- **Cross-region**: not addressed anywhere in the code — `BACKUP_OFFSITE_DIR`/`BACKUP_DEST`
  is a single destination string with no region-awareness or multi-destination fan-out. If
  cross-region redundancy is desired, that is an **INFRASTRUCTURE-DEPENDENT** decision
  (which bucket/region an operator points `BACKUP_OFFSITE_DIR` at), not a code-side gap.
- Neither S3 nor R2 usage in this pipeline is achieved via `storageService.cjs` — see Object
  Storage above for why that is a deliberate, correct distinction, not an oversight.
- **If `BACKUP_OFFSITE_DIR`/`BACKUP_DEST` and `BACKUP_PASSWORD` are unset in the real
  production environment (this mission did not check, per the credential rule), then in
  practice today the ONLY backup that exists is local-disk-only** — a real disk/host loss
  would be unrecoverable regardless of how correct the backup code itself is. This is an
  **INFRASTRUCTURE-DEPENDENT** fact this mission surfaces honestly rather than either
  fabricating "offsite verified" or silently omitting it.

## Reliability

Fixed this mission (see Changes Made for full detail): archive-existence/non-empty
verification before declaring success, `process.exitCode` propagation on genuine failure,
retention pruning gated on real success, offsite export only attempted when the local archive
is confirmed good (so a stale prior archive is never silently exported as if it were this
run's own), and the `export-offsite.cjs` file-selection regression (see Executive Summary
item 4) caught and fixed before it could reach a real run. Idempotency: each run is
timestamp-named, so concurrent/duplicate runs cannot collide on output filenames (not
specifically tested this mission — no evidence of a locking gap was found, and PM2's
`cron_restart` triggers this as a single process per invocation, not a pool that could run
concurrently with itself).

## Changes Made

1. **`scripts/safe-backup.cjs`**:
   - Added `_recordCapture()`, tracking every real file copied into the snapshot with its
     real size and SHA-256.
   - Added a `BUSINESS_OS_FILES` list (9 files: `biz-leads.json`, `biz-contacts.json`,
     `biz-opportunities.json`, `biz-campaigns.json`, `biz-revenue.json`, `biz-events.json`,
     `revenue-os.json`, `agent-registry.json`, `agent-runs.json`) and a copy loop for it,
     matching the exact established `CORE_BUSINESS_FILES` pattern — closing the real backup-
     coverage gap described in the Executive Summary.
   - After compression, writes a sibling `<archive>.manifest.json` (creation time, archive
     name/size/SHA-256, full per-file list) — never inside the snapshot directory itself.
   - Added a real archive-exists/non-empty check before declaring compression successful
     (`archiveOk`); retention pruning and the offsite-export step are now both gated on it.
   - Retention pruning now also removes a pruned archive's manifest alongside it.
   - Added `process.exitCode = 1` on any genuine failure path (compression failure, an
     uncaught error) — the script's exit code now honestly reflects whether a usable backup
     was produced.
   - Added an exported `verifyManifest(archivePath)` function (extract → compare archive
     hash → compare every file's hash/size) and gated `runBackup()`'s auto-execution behind
     `require.main === module`, matching `export-offsite.cjs`'s own existing convention, so
     `require()`-ing this file for its exports no longer triggers a real backup run.
2. **`scripts/export-offsite.cjs`**:
   - **Fixed a regression this mission's own manifest addition would otherwise have caused**:
     restricted the file-selection filter from `!f.endsWith('.enc')` to
     `f.endsWith('.tar.gz')`, since the new sibling manifest files matched the old filter and
     could be selected as "the latest snapshot" instead of the real archive — verified this
     was a real, reproducible bug before fixing it, not a hypothetical.
   - The manifest is now transferred to the offsite destination alongside the encrypted
     archive (unencrypted — it contains no secret, only file names/sizes/hashes), so the
     verification capability travels with the backup rather than staying behind on the same
     local disk a real disaster would also destroy.
3. **`tests/security/158-backup-manifest-integrity.cjs` (new)** — 17 assertions.
4. **`tests/security/159-offsite-export-manifest-coverage.cjs` (new)** — 11 assertions,
   including the regression this same mission introduced and then caught.
5. **`tests/security/160-backup-business-os-coverage.cjs` (new)** — 36 assertions.

No change was made to `backup.sh`, `deploy/rollback.sh`, `test-restore.cjs`,
`test-portable-restore.cjs`, `ecosystem.config.cjs`, or any documentation file — all were
reviewed in depth and found to have no genuine code-side defect within this mission's scope.

## Tests

Focused only, no full CI, no destructive production operation, no real disaster simulation
against production, no real cloud/SSH credential used:

- `tests/security/158-backup-manifest-integrity.cjs` (new) — **17/17 pass.**
- `tests/security/159-offsite-export-manifest-coverage.cjs` (new) — **11/11 pass**
  (uses an isolated `/tmp` scratch destination and a test-only passphrase, never a real
  cloud/SSH target or real `BACKUP_PASSWORD`).
- `tests/security/160-backup-business-os-coverage.cjs` (new) — **36/36 pass.**
- `scripts/test-restore.cjs` (pre-existing real drill, re-run twice — once immediately after
  the manifest/reliability fixes, once again after the Business OS coverage fix) — **PASSED**
  both times, against this repository's own real (non-production, gitignored) `data/`. The
  second run correctly derived a 27-file wipe-set (up from 18 pre-fix), including every newly-
  covered Business OS file, and verified all 27 restored, readable, and parseable.
- `scripts/test-portable-restore.cjs` (pre-existing real drill, re-run after all fixes) —
  **PASSED** — full portable restore to a disposable fresh directory succeeded.
- `tests/runtime/vault-backup-export-git-safety.test.cjs` (pre-existing, re-run for
  regression) — 1 failing assertion found, investigated, and confirmed **pre-existing and
  unrelated to this mission**: it flags a fake AWS-key-shaped test fixture
  (`AKIAFAKEFAKEFAKEFAKE`, explicitly named with the word "FAKE" four times) in
  `tests/security/149-storage-service-retry-key-safety.cjs` — a file from an earlier, separate
  mission in this repo's broader connector-completeness chain, never touched by this DR
  mission (confirmed via `git log`/`git status` showing it untouched and pre-dating this
  session). Reported here per this mission's own "report defects found outside scope, don't
  silently fix or ignore" rule; **not fixed**, since doing so would be an unrelated refactor
  outside DR/Backup's category boundary.

**Total: 64/64 new assertions across 3 new files, 2 real end-to-end DR drills PASSED (before
and after all fixes), 1 pre-existing unrelated false-positive reported, 0 regressions caused
by this mission's own work.**

## Exact Results

All numeric results above are drawn directly from actual command output captured during this
mission (test pass/fail counts, real file sizes in bytes, real SHA-256 prefixes, real drill
PASS/FAIL lines) — no result in this report is estimated, assumed, or extrapolated.

## Credential Requirements

No credential was provisioned, rotated, or printed. Requirements, presence-only:

| Variable | Status |
|---|---|
| `BACKUP_PASSWORD` | UNKNOWN in the real production environment (not checked, per the credential rule) — controls whether offsite backups are encrypted at all |
| `BACKUP_OFFSITE_DIR` / `BACKUP_DEST` | UNKNOWN in the real production environment (not checked) — controls whether any offsite transfer happens at all; if unset, backups are local-disk-only |
| AWS credentials (for the `aws s3 cp`/`head-object` calls, if `BACKUP_OFFSITE_DIR` is an `s3://` URL) | Not this mission's concern to check — these are the operator's existing AWS CLI credential configuration, entirely outside this repository's own credential system (`secretVault.cjs` is not involved in this pipeline's AWS access at all) |
| SSH key (for the rsync/SSH destination path, if configured) | Same — outside this repository's own credential system, an operator's own SSH configuration |

## Infrastructure Requirements

- `openssl`, `tar`, and (for the S3/rsync destination paths) the `aws` CLI or `rsync`/`ssh`
  must be installed on the host running `safe-backup.cjs`/`export-offsite.cjs` — all
  pre-existing requirements, unchanged by this mission.
- Real offsite durability requires an operator to actually configure `BACKUP_PASSWORD` and a
  real destination — this mission does not and cannot verify either is configured in any real
  deployment, per the credential rule.
- No VPS, cloud account, or new infrastructure dependency was introduced by this mission's
  changes — every fix operates entirely within the existing local filesystem + existing CLI
  tool invocations this pipeline already used.

## Decision Required

1. **RPO/RTO targets** (see RPO/RTO section) — no explicit numerical target exists anywhere;
   adopting one is a business-policy decision, not something this mission decided.
2. **Retention policy depth** — "keep the last 7 local generations" is unchanged from before
   this mission; whether that count, or whether offsite retention should differ from local
   retention, is a business decision this mission did not alter.
3. **Cross-region/multi-destination offsite redundancy** — the current architecture supports
   exactly one destination string; whether multiple/redundant offsite destinations are
   desired is an infrastructure/business decision, not a code gap.

## Remaining Gaps

- **`backup.sh`** (the simpler, `npm run backup`-wired alternative to `safe-backup.cjs`) has
  zero encryption, zero offsite transfer, and zero manifest/integrity verification, and is
  not cron-scheduled anywhere — it excludes `data/autonomous` and `data/futureTech` and tars
  the rest of `data/` directly. This mission's fixes were applied to `safe-backup.cjs` (the
  real, cron-scheduled, production nightly job) — `backup.sh` was reviewed but not modified,
  since it appears to be a manual/local-dev convenience tool distinct from the production
  pipeline, not the artifact PM2 or any documented recovery procedure actually depends on.
  Flagged here rather than silently left unexamined; not actioned, since building out
  encryption/manifest/offsite support for a second, parallel script would risk duplicating
  the exact capability `safe-backup.cjs`/`export-offsite.cjs` now already correctly provide,
  rather than closing a genuine gap.
- **~460 stray test-run artifacts sitting at the top level of `data/`** (see Data Persistence
  Inventory) are a real data-hygiene issue but not a DR code defect — they inflate the
  "uncovered files" count misleadingly and should ideally be cleaned up by whatever test
  harness leaks them, not by a change to the backup pipeline's own logic.
- **No formal RTO has ever been measured end-to-end** (see RPO/RTO) — `test-portable-restore.cjs`
  exercises the right scenario but does not currently report a timed duration.
- **`tests/runtime/vault-backup-export-git-safety.test.cjs`'s pre-existing, unrelated false
  positive** (see Tests) — reported, not fixed, as it belongs to a different mission's test
  file outside this category's scope.
- Neither `backup.sh` nor `deploy/rollback.sh` was found to have a genuine code-side defect
  this mission's scope covers — both were reviewed in depth and left unmodified.

## DR MASTER MATRIX

| Data Domain | Persistence | Backup | Restore | Encryption | Integrity | Offsite | Tenant Isolation | Status |
|---|---|---|---|---|---|---|---|---|
| CRM leads/orgs/missions/memory/vault (older layer) | `data/*.json` | Yes (pre-existing, Phase B.5) | Yes (`deploy/rollback.sh`, drill-verified) | Conditional (`BACKUP_PASSWORD`) | **Yes — new manifest, this mission** | Conditional (`BACKUP_OFFSITE_DIR`) | N/A (no per-tenant granularity in this app) | **CODE-COMPLETE** |
| Business OS (biz-*.json, revenue-os.json) | `data/biz-*.json`, `revenue-os.json` | **Yes — fixed this mission** (was zero footprint) | Yes (same restore path, drill-verified with the new files) | Conditional | **Yes — new manifest** | Conditional | N/A | **CODE-COMPLETE** |
| Agent execution history/registry | `data/agent-runs.json`, `agent-registry.json` | **Yes — fixed this mission** | Yes (drill-verified) | Conditional | **Yes — new manifest** | Conditional | N/A | **CODE-COMPLETE** |
| SQLite `tasks` table | `data/jarvis.db` | Yes (pre-existing, `VACUUM INTO`) | Yes (drill-verified) | Conditional | Yes (new manifest covers it too) | Conditional | N/A | **CODE-COMPLETE** |
| `.env` / live secrets | `.env` | Intentionally excluded (by design) | Out-of-band procedure, not a code path | N/A (never included) | N/A | N/A | N/A | **INFRASTRUCTURE-DEPENDENT** (correct, documented boundary) |
| Encrypted connector credentials | `data/vault.json` | Yes (ciphertext only) | Yes, but requires `.env`'s `JWT_SECRET` restored separately | Yes (AES-256-GCM, pre-existing) | Yes (new manifest) | Conditional | N/A | **CODE-COMPLETE** (ciphertext path) / **INFRASTRUCTURE-DEPENDENT** (key recovery) |
| Supabase/Postgres data | N/A | N/A — no real data path exists | N/A | N/A | N/A | N/A | N/A | **NOT IN CURRENT SCOPE** (provider has nothing to back up here) |
| Application object storage (S3/R2 via `storageService.cjs`) | Provider-side | Not part of this pipeline (deliberate, see Object Storage) | N/A | N/A | N/A | N/A | N/A | **PROVIDER-MANAGED** (out of this mission's DR-pipeline scope) |
| `backup.sh` (secondary, non-scheduled tool) | `data/` (minus 2 excluded subdirs) | Yes, but no encryption/offsite/manifest | Via same `deploy/rollback.sh` (layout-detected) | No | No | No | N/A | **PARTIALLY IMPLEMENTED** (not this mission's target artifact) |
| Offsite/cross-region redundancy | N/A | N/A | N/A | N/A | N/A | Single destination only | N/A | **DECISION REQUIRED** |
| RPO/RTO | N/A | N/A | N/A | N/A | N/A | N/A | N/A | **DECISION REQUIRED** — no value defined anywhere |
