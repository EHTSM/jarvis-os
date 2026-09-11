# Phase B.5 — Disaster Recovery & Business Continuity Certification

**Product:** Ooplix (jarvis-os) v1.0.0-rc1
**Date:** 2026-08-09
**Branch:** `security/reality-completion` (no merge, no push)
**Method:** Operated the live product through real failures — real SIGKILL/SIGTERM/SIGINT, real mid-write interrupts, real backups, real restores.

## Environment

| Property | Value |
|---|---|
| Backend | `node backend/server.js` on `:5050` (bare process — **PM2 has no managed entry**) |
| `data/` size | 675 MB, 542 root JSON stores + 12 subdirectories |
| SQLite | `data/jarvis.db` — 1 real table (`tasks`), passive mirror |
| Test data | Phase B.4 real tenants/leads reused as durability markers |
| Regression | `npm run test:runtime` → **144/144 pass, 0 fail** (after fixes) |

Durable markers used throughout: `ALPHA-SECRET-LEAD`, `PRECRASH-MARKER-B5` (CRM), `SecVal Alpha Corp` (org).

---

## Defects Found and Fixed

Three genuine recovery defects were discovered, reproduced, fixed, and re-verified. Per the mission's "fix only genuine recovery defects" rule, nothing else was changed.

### D1 — Automated backup omitted the entire customer dataset (**CRITICAL**)

`scripts/safe-backup.cjs` used a hardcoded allowlist that captured 9 files. Absent: **CRM (`leads.json`), organizations/RBAC (`organizations.json`), missions (`missions.json`), memory (`memory-store.json`), Product OS (`product-plans.json`), and the encrypted vault (`vault.json`)**.

This was not theoretical:
- `DISASTER_RECOVERY.md:22` explicitly promises "**CRM leads, task history, learning/memory data**" are recoverable.
- The nightly automation (`crontab` 03:00 **and** `ecosystem.config.cjs` 02:00) both invoke *this* script.
- `deploy/rollback.sh` restores the newest `jarvis_*.tar.gz`, which is always one of these archives.
- Verified `jarvis.db` holds only `tasks`, so the JSON stores were **not** redundant — this data existed in no backup at all.

Measured before fix: `data/` 675 MB / 542 stores → archive **340 KB / 10 files**.

**Fix:** added a `CORE_BUSINESS_FILES` list (8 stores) to `scripts/safe-backup.cjs`. `vault.json` holds AES-256-GCM ciphertext whose key derives from `JWT_SECRET` in `.env` — which is deliberately *not* backed up — so including it stores no usable plaintext.

**Re-verified:** archive now 17 files / 1.1 MB, and `ALPHA-SECRET-LEAD`, `PRECRASH-MARKER-B5` and `SecVal Alpha Corp` are all recoverable from it.

### D2 — `deploy/rollback.sh` restore was a silent no-op (**CRITICAL**)

Two archive layouts coexist and the script's own glob matched both:

| Producer | Archive root | `tar -xzf` result |
|---|---|---|
| `backup.sh` | `data/` | extracts into `data/` ✅ |
| `safe-backup.cjs` | `snapshot_<ts>/` | creates `snapshot_<ts>/`, **`data/` untouched** ❌ |

Because `safe-backup.cjs` runs nightly, its archive was almost always the newest match — so the default `bash deploy/rollback.sh` hit the broken path. Verification only polled `/health` for 200, which succeeded while still serving the *old* data, so the script printed **"Rollback complete"** having restored nothing.

**Reproduced** in an isolated sandbox: pre-seeded `data/leads.json` was still the original content after the "successful" restore, with a stray `snapshot_*/` directory alongside.

**Fix:** detect the archive root and handle both layouts; copy snapshot files into `data/` explicitly; `die` if 0 files were copied or the layout is unrecognized (never report success on an empty restore); never overwrite `.env` from `env-config-nonsecret.txt`.

**Re-verified** end-to-end: stale marker gone, 15 files restored, real customer data present, no stray directory.

### D3 — The DR validation test could not fail (**HIGH**)

`scripts/test-restore.cjs` claimed to verify "full restore after total persistence loss" but wiped only **2 files** — `task-queue.json` and `jarvis.db`, exactly the two the backup was known to contain. Its integrity gate was `execSync('check-persistence-divergence.cjs')`, and that script **always exits 0** (it prints warnings but never signals failure). So the drill reported

```
[!] COUNT MISMATCH: JSON(1316) vs SQLite(2705)
[+] INTEGRITY VERIFIED. System restored successfully.
[+] Disaster Recovery Validation: PASSED.
```

— asserting success in the same breath as reporting a mismatch. This is why D1 and D2 went unnoticed.

**Fix:** derive the wipe set from the snapshot itself (every file the backup claims to protect), verify each restored file is **present, non-zero, and parseable**, and decide pass/fail from those checks rather than the always-zero exit code. Files are moved to a sidecar rather than deleted, and are put back if verification fails — a failing drill can never cause the loss it simulates.

**Re-verified both directions:**
- Positive: wipes and restores **17 files** → PASSED, exit 0.
- **Negative (fault injected):** zero-byte `leads.json` in snapshot → `FAILED`, **exit 1**, `leads.json: restored but ZERO BYTES`, originals rolled back from sidecar, `ALPHA-SECRET-LEAD` and `PRECRASH-MARKER-B5` intact.

---

## 1. Backup Matrix

Post-fix, measured on the live `data/`.

| Class | Store | Size | In backup | Readable | Valid JSON | Status |
|---|---|---|---|---|---|---|
| Database | `jarvis.db` | 4.3 MB | Yes (`VACUUM INTO`, consistent) | Yes | n/a | CERTIFIED |
| JSON stores | `task-queue.json` | 1.0 MB | Yes | Yes | 138 entries | CERTIFIED |
| Mission store | `missions.json` | 11 MB | **Yes (fixed)** | Yes | valid | CERTIFIED |
| Memory store | `memory-store.json` | 2.6 MB | **Yes (fixed)** | Yes | 2000 entries | CERTIFIED |
| Product plans | `product-plans.json` | 492 KB | **Yes (fixed)** | Yes | valid | CERTIFIED |
| CRM | `leads.json` | 2.2 MB | **Yes (fixed)** | Yes | 5183 leads | CERTIFIED |
| Settings/config | `env-config-nonsecret.txt` | — | Yes (non-secret keys only) | Yes | n/a | CERTIFIED |
| Audit logs | `data/logs/audit.ndjson` | 6.8 MB | **No** — excluded by design (283 MB log tree) | n/a | n/a | CONFIGURATION REQUIRED |
| Orgs/RBAC | `organizations.json` | 568 KB | **Yes (fixed)** | Yes | valid | CERTIFIED |
| Secret vault | `vault.json` | 8 KB | **Yes (fixed)** | Yes | ciphertext only | CERTIFIED |
| Identity | `local-accounts.json` | 284 KB | Yes | Yes | 558 accounts, `passwordHash` intact | CERTIFIED |
| Secrets (`.env`) | — | — | Intentionally excluded | n/a | n/a | CERTIFIED (by design) |

## 2. Restore Matrix

Restored into an isolated directory and verified per domain.

| Domain | Restore result | Status |
|---|---|---|
| Organizations | `SecVal Alpha Corp` + memberships + roles recovered | CERTIFIED |
| Users / Identity | 558 accounts, all 5 Phase B.4 role-holders, `passwordHash` present (login possible post-restore) | CERTIFIED |
| CRM | 5183 leads incl. both durability markers | CERTIFIED |
| Product OS | `product-plans.json` valid | CERTIFIED |
| Engineering / Missions | `missions.json` valid, 1635 missions | CERTIFIED |
| Memory | 2000 memory entries | CERTIFIED |
| Runtime / Queue | `task-queue.json` valid, statuses preserved | CERTIFIED |
| AI configuration | `LLM_PROVIDER=groq` in non-secret config; API keys require `.env` re-provisioning | CONFIGURATION REQUIRED |
| Corruption | **0 invalid files across all 17 restored** | CERTIFIED |

## 3. Crash Recovery Matrix

Each drill: kill → scan 542 stores → restart → measure. All reproduced on the live server.

| Scenario | Shutdown | Recovery | Corrupted files | Reconciliation | Marker survived | Status |
|---|---|---|---|---|---|---|
| Graceful (SIGTERM, idle) | port 7 ms; process 5811 ms (5 s drain by design) | — | 0 | clean exit logged | Yes | CERTIFIED |
| SIGTERM | 9 ms | **2139 ms** | **0 / 542** | 2 events | Yes | CERTIFIED |
| SIGINT | 26 899 ms* | — | **0 / 542** | — | Yes | CERTIFIED WITH LIMITATIONS |
| SIGKILL (power-loss equivalent) | 45 ms | **2461 ms** | **0 / 542** | 1 stale task → pending | Yes | CERTIFIED |
| Restart during write | killed mid-burst | ~2.1 s | **0 / 542** (4 consecutive drills) | — | Yes, 33 writes persisted | CERTIFIED |
| Restart during mission execution | killed with AutoLoop mid-task | 2084 ms | 0 | 1 task reset, 14 pending re-queued | Yes | CERTIFIED |

\* SIGINT lingered because the 5 s exit timer is `.unref()`'d while the AutoLoop held the event loop. The port closed immediately and no data was lost; only full process exit was delayed. Observation, not data-loss.

**Lost work:** none observed. **Duplicate work:** none — reconciliation resets `running` → `pending` rather than re-dispatching in parallel.
**No auto-restart:** PM2 has no managed entry for the process, so recovery required a manual start. This is the single largest contributor to real-world RTO.

## 4. Queue Recovery Matrix

| Control | Observation | Status |
|---|---|---|
| Queue resumes | `[Startup:Reconcile] 14 pending task(s) queued for execution` | CERTIFIED |
| Stale task reconciliation | `recovered 1 stale running task(s) → pending` on every crash boot | CERTIFIED |
| Missions resume | 1635 missions preserved; orchestrator restarted | CERTIFIED |
| Retries resume | `attempts` field preserved on persisted tasks | CERTIFIED |
| Approvals survive | `/approval/sessions` returned real pre-crash approval records | CERTIFIED |
| AI jobs survive | Pending patch queue intact (`/runtime/approval-queue`) | CERTIFIED |
| DLQ survives | `count: 50, total: 1000` preserved across all crash cycles | CERTIFIED |
| Duplicate prevention | No task observed executing twice after recovery | CERTIFIED |

## 5. Runtime Continuity Matrix

Measured after 5 consecutive crash cycles.

| Subsystem | Post-recovery state | Status |
|---|---|---|
| Scheduler / AutoLoop | Restarted, resumed task dispatch | CERTIFIED |
| Observers | `[Observer]` active; `recovery_agent` @60 s, `eos_recovery` @240 s registered | CERTIFIED |
| Agents | **411 agent supervisor registration events**; 42+ runtime agents re-registered | CERTIFIED |
| Memory | `memory-store.json` intact (2000 entries) | CERTIFIED |
| Executive | `/org-executive/:orgId/*` responded 200 for owner | CERTIFIED |
| Reports / Monitoring | `/runtime/audit/health` → `healthy: true, malformed: 0` | CERTIFIED |
| Automation | Cron jobs stopped cleanly on shutdown, restarted on boot | CERTIFIED |
| ExecRuntime | 13 capabilities + 26 engineering handlers re-registered | CERTIFIED |
| Metrics collector | `/queue/status` → 503 `Metrics collector unavailable` (honest, not a fake zero) | OBSERVATION |

## 6. Data Durability Matrix

| Control | Observation | Status |
|---|---|---|
| Atomic writes — task queue | `agents/taskQueue.cjs:105-107` — per-PID unique `.tmp` + `renameSync` (atomic on POSIX) | CERTIFIED |
| Atomic writes — corruption fallback | Corrupt queue file moved to `.bak.<ts>`, queue re-initialised rather than crashing | CERTIFIED |
| Atomic writes — adoption | 45 service files use `tmp`+`renameSync`; 288 use bare `writeFileSync` | CERTIFIED WITH LIMITATIONS |
| **CRM write path** | `backend/services/crmService.js:39` — bare `writeFileSync` on a 2.2 MB file, **not** atomic | CERTIFIED WITH LIMITATIONS |
| Partial / interrupted writes | 4 consecutive SIGKILL-during-write drills → **0 corruption**, JSON valid every time | CERTIFIED |
| Rollback behavior | `pre-rollback-<ts>.tar.gz` safety net taken before every restore | CERTIFIED |
| SQLite durability | WAL mode; `Persistence recovered — WAL mode active` on boot; no orphaned WAL/SHM after SIGKILL | CERTIFIED |
| Stray temp files | None left behind after any crash | CERTIFIED |

The non-atomic CRM write did not corrupt in 4/4 drills — the write window is short relative to the kill probability — but it remains a latent risk on a larger `leads.json` or slower disk. Recorded as a limitation, not fixed: the mission scope is "fix genuine recovery **defects** discovered", and no corruption was reproduced here.

## 7. Configuration Recovery Matrix

| Item | Post-restore state | Status |
|---|---|---|
| Environment (non-secret) | `PORT`, `NODE_ENV`, `BASE_URL`, `APP_URL`, `ALLOWED_ORIGINS`, `COOKIE_DOMAIN` recovered as reference | CERTIFIED |
| Environment (secrets) | Excluded by design — must be re-provisioned via secure channel | CERTIFIED (by design) |
| Feature flags | `capability-registry.json`, `version.json` restored | CERTIFIED |
| Integrations | Connector credentials restored via `vault.json` (ciphertext); **require `JWT_SECRET` from `.env` to decrypt** | CONFIGURATION REQUIRED |
| Branding | Static assets in git, not `data/` | CERTIFIED |
| Workspaces | `org-context.json` restored | CERTIFIED |
| Permissions / RBAC | Roles and memberships restored inside `organizations.json` | CERTIFIED |

**Restore dependency worth stating plainly:** `vault.json` is encrypted with a key derived from `JWT_SECRET`. Restoring `data/` without the original `.env` yields undecryptable connector credentials. This is correct security design, but it makes `.env` custody a hard prerequisite of any successful restore.

## 8. Business Continuity Matrix

| Capability | Post-recovery verification (through the product) | Status |
|---|---|---|
| Service availability | `/health` → 200, all services up | CERTIFIED |
| Authentication | Login succeeded after every crash cycle | CERTIFIED |
| Session continuity | Stateless JWT survives restart (no server-side session store to lose) | CERTIFIED |
| Org context | `SecVal Alpha Corp / org_owner` resolved | CERTIFIED |
| Customer data access | `ALPHA-SECRET-LEAD` + `PRECRASH-MARKER-B5` readable via API | CERTIFIED |
| Multi-tenant isolation | Preserved after recovery (Phase B.4 controls re-checked) | CERTIFIED |
| Audit trail | Append-only, `malformed: 0`, rotation intact | CERTIFIED |
| Archived-org restore | `POST /orgs/:id/restore` recovered a soft-deleted org | CERTIFIED |

## 9. Operational Readiness Matrix

| Item | Observation | Status |
|---|---|---|
| Backup automation | `crontab` 03:00 + `ecosystem.config.cjs` 02:00, both → `safe-backup.cjs` (now complete) | CERTIFIED |
| Offsite replication | `scripts/export-offsite.cjs` in cron, gated on `BACKUP_DEST`/`BACKUP_PASSWORD` — **neither set in `.env`** | CONFIGURATION REQUIRED |
| Restore documentation | `DISASTER_RECOVERY.md` — 4 named scenarios, concrete commands, RTO table | CERTIFIED |
| Disaster procedures | Code rollback, data rollback, total-loss rebuild, per-file recovery all documented | CERTIFIED |
| Recovery checklist | Present, incl. "run `test-restore.cjs` and confirm it passes" — now a meaningful gate | CERTIFIED |
| Rollback readiness | `deploy/rollback.sh` — `.env` backup, safety-net archive, health verify (restore now real) | CERTIFIED |
| Safety net | `pre-rollback-<ts>.tar.gz` makes a bad restore itself reversible | CERTIFIED |
| **Process supervision** | **PM2 has no managed entry** — a crash leaves the product down until a human restarts it | RECOVERY REQUIRED |
| Backup retention | 7 archives (`safe-backup`), 14 (`backup.sh`) | CERTIFIED |
| Log retention | Rotates at 20 MB, but docstring claims "retains 30 days" with **no cleanup job**; 21 rotated files, 283 MB (42% of `data/`) | CERTIFIED WITH LIMITATIONS |
| Backup integrity validation | No checksum/manifest written with the archive | CONFIGURATION REQUIRED |

## 10. Backup Quality Measurements

| Metric | Before fix | After fix |
|---|---|---|
| Backup duration | 160 ms | **296–482 ms** |
| Archive size | 340 KB | **1.1 MB** |
| Files captured | 10 | **17** |
| Uncompressed payload | — | 17.8 MB |
| Compression ratio | — | **16.7× (94.0% saved)** |
| Full DR drill (backup + wipe + restore + verify) | ~700 ms (vacuous) | **623 ms (17 files, real verification)** |
| Customer data recoverable | **No** | **Yes** |
| Integrity validation | Always-pass | **Per-file present/non-zero/parseable; fails with exit 1** |

## 11. Recovery Timeline (measured)

| Phase | Duration |
|---|---|
| Failure detection (port closed) | 7–45 ms |
| Graceful drain (SIGTERM, by design) | 5 000 ms |
| Process start → `/health` 200 | **2 084 – 2 461 ms** |
| Queue reconciliation | within boot (same 2.1–2.5 s) |
| Agent/observer re-registration | within boot (411 events) |
| **Total RTO (crash → serving, manual restart)** | **~2.1–2.5 s of process time** |
| **Effective RTO in production today** | **unbounded — no supervisor restarts the process** |
| Backup cycle (RPO granularity) | 296–482 ms; nightly ⇒ **RPO up to 24 h** |
| Data restore from local backup | < 1 s (measured); docs estimate ~2 min at scale |

## 12. Risk Matrix

| ID | Risk | State | Severity |
|---|---|---|---|
| D1 | Automated backup omitted CRM/orgs/missions/memory/vault | **FIXED + re-verified** | ~~Critical~~ → Resolved |
| D2 | `rollback.sh` restore silently no-opped, reported success | **FIXED + re-verified** | ~~Critical~~ → Resolved |
| D3 | DR validation test could not fail; masked D1/D2 | **FIXED + negative-tested** | ~~High~~ → Resolved |
| R1 | **No process supervisor** — PM2 has no managed entry, so a crash leaves the product down until manual restart. Process-level RTO is 2.1 s; real-world RTO is unbounded. | Open | **High** |
| R2 | **Offsite replication inert** — `export-offsite.cjs` is scheduled but `BACKUP_DEST`/`BACKUP_PASSWORD` are unset, so backups exist only on the same host. `DISASTER_RECOVERY.md:85` warns of exactly this ("your data backups died with it"). | Open | **High** |
| R3 | Audit log excluded from backup — a compliance artifact (`malformed: 0`, append-only) is unrecoverable after host loss. | Open | **Medium** |
| R4 | CRM write path non-atomic (`crmService.js:39`); 0 corruption in 4/4 drills but latent on larger files/slower disks. | Open | **Medium** |
| R5 | No backup checksum/manifest — a silently truncated archive would only be discovered at restore time. | Open | **Medium** |
| R6 | Log tree unbounded: 283 MB / 21 rotated files, no cleanup job despite a documented "30 days" retention claim. | Open | **Medium** |
| R7 | `check-persistence-divergence.cjs` always exits 0, so it cannot gate CI. (No longer masks the DR drill, which now decides pass/fail itself.) | Open | **Low** |
| R8 | 6 leads reference non-existent orgs; 27 legacy leads carry no `orgId`. No cleanup routine observed. | Open | **Low** |
| R9 | SIGINT full-process exit delayed to ~27 s under load (`.unref()`'d timer + busy AutoLoop). Port closes immediately; no data loss. | Open | **Informational** |

## 13. Remediation Matrix

| ID | Recommendation | Scope | Priority |
|---|---|---|---|
| R1 | Register the server with PM2 (`pm2 start ecosystem.config.cjs --env production && pm2 save`) so crash recovery is automatic. The 2.1 s process RTO is already good — it just needs something to trigger it. | ops | **P0** |
| R2 | Set `BACKUP_DEST` + `BACKUP_PASSWORD` in `.env` to activate the existing offsite export. No new code needed. | `.env` | **P0** |
| R3 | Add the current `data/logs/audit.ndjson` (not rotated history) to `CORE_BUSINESS_FILES`, or export a date-bounded slice. | `safe-backup.cjs` | P1 |
| R4 | Convert `crmService.js:39` to the `tmp`+`renameSync` pattern already used by `agents/taskQueue.cjs:105`. | `crmService.js` | P1 |
| R5 | Write a `manifest.json` (per-file SHA-256 + sizes) into each snapshot and verify it in `test-restore.cjs`. | `safe-backup.cjs` | P1 |
| R6 | Add rotated-log cleanup honoring the documented 30-day retention. | `auditLog.cjs` / cron | P2 |
| R7 | Make `check-persistence-divergence.cjs` exit non-zero on true content mismatch (keeping the JSON-prunes-vs-SQLite-mirror count delta as informational). | script | P2 |
| R8 | Add an orphan sweep for leads with dead/missing `orgId`. | `crmService.js` | P3 |
| R9 | Do not `.unref()` the shutdown timer, so SIGINT exits within the intended 5 s. | `server.js:365` | P3 |
| — | Update `rc1-manifest.json` `criticalDataFiles` to match the corrected backup set. | `data/rc1-manifest.json` | P2 |

---

## Certification

**Overall: CERTIFIED WITH LIMITATIONS**

| Area | Classification |
|---|---|
| Backup Integrity | **CERTIFIED** (after D1 fix) — audit-log exclusion noted |
| Restore Integrity | **CERTIFIED** (after D2 fix) — 17/17 files, 0 corruption |
| Crash Recovery | **CERTIFIED** — 0 corrupted files across 542 stores in every drill |
| Data Durability | CERTIFIED WITH LIMITATIONS (R4 non-atomic CRM write) |
| Queue Recovery | **CERTIFIED** — real reconciliation, no lost or duplicated work |
| Runtime Continuity | **CERTIFIED** — all subsystems resumed after 5 crash cycles |
| Long-Term Data Health | CERTIFIED WITH LIMITATIONS (R6 log growth, R8 orphans) |
| Configuration Recovery | CERTIFIED WITH LIMITATIONS (`.env` is a hard restore prerequisite) |
| Backup Quality | **CERTIFIED** (R5 no checksum) |
| Operational Readiness | **RECOVERY REQUIRED** (R1 no supervisor, R2 offsite inert) |

**What the product does genuinely well:** crash durability is excellent and was hard to fault — **0 corrupted files out of 542 stores across every drill**, including four consecutive SIGKILLs during sustained writes. Recovery is fast (2.1–2.5 s), reconciliation is real (stale `running` tasks reset to `pending`, 14 pending re-queued), and approvals, DLQ, missions and retries all survived. The atomic queue write path, `.bak` corruption fallback, safety-net archive before restore, and deliberate exclusion of `.env` are all sound engineering.

**What made this phase necessary:** the three defects were mutually concealing. The backup omitted the customer dataset (D1), the restore silently did nothing (D2), and the test that existed to catch both was structurally incapable of failing (D3) — it printed "INTEGRITY VERIFIED" directly beneath a COUNT MISMATCH. All three are fixed and verified in both directions, including a fault-injected negative test that now correctly fails with exit 1 and rolls back safely.

**Two open items gate production DR**, and neither needs code: **register the process with PM2** (R1 — a 2.1 s recovery capability that nothing currently triggers) and **set `BACKUP_DEST`/`BACKUP_PASSWORD`** (R2 — backups presently live only on the host they protect, the exact scenario `DISASTER_RECOVERY.md` warns about).

**Validation hygiene:** all Phase B.4 and B.5 markers verified intact after the full drill sequence (`ALPHA-SECRET-LEAD`, `PRECRASH-MARKER-B5`, `SecVal Alpha Corp`); the archived test org was restored through the product's own `/orgs/:id/restore` route; the injected fault was removed and its absence confirmed; no drill sidecars left behind; one server instance running clean. Regression **144/144**. Changes limited to the three defect files (`scripts/safe-backup.cjs`, `deploy/rollback.sh`, `scripts/test-restore.cjs`) plus the pre-existing `.claude/settings.json`. No merge, no push, no architecture redesign, no new storage.
