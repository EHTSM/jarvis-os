# Phase B.6 — Database Certification

**Product:** Ooplix (jarvis-os) v1.0.0-rc1
**Date:** 2026-08-09
**Branch:** `security/reality-completion` (no merge, no push)
**Method:** Operated the live persistence layer as a production DBA. Every number below is measured, not estimated. Reproduce → Measure → Root Cause → Recover → Regression → Reverify.

## Persistence Architecture (as found — not redesigned)

| Property | Reality |
|---|---|
| Primary engine | Whole-file JSON stores, synchronous `readFileSync`/`writeFileSync` |
| Root stores | 542 (`data/*.json`); 3438 including subdirectories |
| Total footprint | 677 MB (`data/`), of which 289 MB is `data/logs/` |
| SQLite | `data/jarvis.db` — **1 real table** (`tasks`), explicitly a *passive mirror* (`agents/taskQueue.cjs:17`) |
| Authority model | JSON is authoritative; SQLite never read back for correctness |
| Concurrency model | Single-process, `instances: 1`, `exec_mode: "fork"` — "NOT cluster-safe. Never set instances > 1" (`ecosystem.config.cjs:33`) |
| Migration framework | None. `migration_log` table exists, 0 rows |

---

## Defect Found, Fixed, and Regression-Tested

### F1 — Permanent JSON→SQLite mirror drift after crash (**reproduced, fixed**)

**Observed:** 10 real tasks where JSON said `completed` but SQLite still said `pending`/`running`.

```
tq_1786221271135  JSON: completed @20:37:57   SQLite: pending  (completed_at=null)
tq_1786221545313  JSON: completed @20:39:12   SQLite: pending  (completed_at=null)
tq_1786221574698  JSON: completed @20:39:50   SQLite: running  (completed_at=null)
```

**Root cause:** `update()` performs `_save(tasks)` (JSON) then `_shadowUpsert(t)` (SQLite) as **two separate writes, not one transaction** (`agents/taskQueue.cjs`). A crash in that window leaves the mirror permanently behind. Nothing repaired it — `recoverStale()` only re-mirrored tasks that were `running` *in JSON*, so a `completed`/`pending` disagreement was never revisited and survived every subsequent boot.

**Correlation:** all 10 drifted completions fall between 20:37:57–20:39:50, precisely inside the Phase B.5 crash-drill window (20:29–20:39). The drift was *caused* by those SIGKILLs and then persisted.

**Reproduced deterministically:** mutated JSON to `completed` without notifying the mirror (the exact crash window) → `JSON=completed SQLite=pending drift=true`.

**Fix** (`agents/taskQueue.cjs`, in the existing `recoverStale()` startup path): re-mirror any task whose SQLite status disagrees with the JSON authority, using the existing `_shadowUpsert`. No new storage, no schema change, no migration. JSON remains the single source of truth — the mirror is only ever corrected *toward* JSON. Tasks present in SQLite but absent from JSON are deliberately left alone, because `pruneOldTasks()` intentionally trims JSON while the mirror retains history. Wrapped fail-safe so a mirror problem can never block startup.

**Verified:** 11 drifted → **0**. Confirmed on the real startup path — a live restart logged `re-mirrored 2 task(s)`, catching fresh drift from that very restart.

**Regression:** `tests/runtime/09-mirror-reconcile.test.cjs` — 5 tests covering the repair, no-spurious-rewrite, JSON-authority direction, prune-safety (no resurrection from mirror), and fail-safe. **Negative-tested:** with the reconcile block disabled, 2 tests fail; restored, 5/5 pass.

---

## 1. Data Integrity Matrix

| Check | Result | Classification |
|---|---|---|
| Corruption | **0 corrupted / 0 zero-byte across 3438 JSON stores (282.9 MB)** | CERTIFIED |
| Duplicate records | **0 violations of the real contract** (uniqueness is `orgId`+`phone`, per `crmService.js:72`) | CERTIFIED |
| Dangling `orgId` — CRM | 6 rows referencing literal `"orgA"`/`"orgB"` test fixtures (2026-08-04) | OBSERVATION |
| Dangling `userId` — CRM | 3 legacy Telegram leads (`tg_*`, pre-org era) | OBSERVATION |
| Missing `orgId` — CRM | 27 legacy leads spanning 2026-04-28 → 2026-08-07 | OBSERVATION |
| Dangling `orgId` — all stores | 22 of 29 org-bearing stores; 169 distinct unresolved values | OBSERVATION |
| **Consequence of dangling refs** | **All probes → HTTP 404, 0 rows.** `attachOrg` requires the org to resolve, so unresolved IDs have no access path | CERTIFIED |
| Inconsistent ownership | Tenant query returned exactly **1 distinct `orgId`**; no legacy/fixture rows leaked | CERTIFIED |
| Mirror consistency (F1) | 10 real drifted tasks → fixed → **0** | CERTIFIED (after fix) |

An important distinction the raw counts obscure: 4 phone numbers appear twice, but each pair sits in *different* orgs. `crmService.js:14` documents this explicitly — dedupe is per-org so a second org's lead cannot be silently swallowed. Measured against the actual contract (`orgId`+`phone`), violations are **0**.

Of the 169 unresolved `orgId` values: 7 are named sentinels (`global`, `org_engineering`, `org_executive`…) that are intentional scopes, 97 are timestamped IDs from deleted/never-created orgs, and 65 are other fixtures (`org-fintech-01`, `account:<id>`). None is reachable.

## 2. Storage Health Matrix

| Metric | Measured | Classification |
|---|---|---|
| Total stores | 542 root / 3438 recursive | CERTIFIED |
| Total size | 677 MB (`data/`) | CERTIFIED |
| Largest store | `repo-index.json` — **45.3 MB** | CERTIFIED WITH LIMITATIONS |
| Next largest | `missions.json` 10.7 MB, `company-workspaces.json` 2.7 MB, `memory-store.json` 2.6 MB, `leads.json` 2.25 MB | CERTIFIED |
| Growth (mtime cohorts) | <1d: 338 MB · 1–7d: 288 MB · 7–30d: 29 MB · 30–90d: 12 MB · >90d: 0.04 MB | CERTIFIED |
| Stale data | **1.8%** untouched >30d — actively-used store, not accumulating dead weight | CERTIFIED |
| Log tree | **289 MB (43% of `data/`)**; 21 rotated `.ndjson` never cleaned despite a documented "retains 30 days" | CERTIFIED WITH LIMITATIONS |
| Fragmentation / compaction | N/A for whole-file JSON (every write is a full rewrite = implicit compaction). SQLite: WAL 0 KB after checkpoint | CERTIFIED |
| Retention | Task queue caps terminal tasks (`pruneOldTasks`, default 50); `repo-index` caps at 20 repos | CERTIFIED |

## 3. Read Performance Matrix

Live product, 10 runs per endpoint.

| Query | p50 | p95 | max | Classification |
|---|---|---|---|---|
| `GET /health` | **0.6 ms** | 1.0 ms | 1.0 ms | CERTIFIED |
| `GET /runtime/dead-letter` | 2.0 ms | 3.5 ms | 3.5 ms | CERTIFIED |
| `GET /orgs/:id/members` | 9.0 ms | 10.2 ms | 10.2 ms | CERTIFIED |
| `GET /crm/leads` (5140 rows) | 14.6 ms | 164.3 ms | 164.3 ms | CERTIFIED |
| `GET /runtime/audit/health` | 15.1 ms | 27.2 ms | 27.2 ms | CERTIFIED |
| `GET /crm/leads/export` | 17.2 ms | 22.6 ms | 22.6 ms | CERTIFIED |
| **`GET /orgs/me/context`** (scans 934 orgs) | **41.4 ms** | 62.4 ms | 62.4 ms | CERTIFIED WITH LIMITATIONS |

**Synchronous parse cost** (each figure is a full event-loop block):

| Store | Size | p50 parse | max |
|---|---|---|---|
| `repo-index.json` | 45.3 MB | **126.8 ms** | 205.0 ms |
| `missions.json` | 10.8 MB | 32.9 ms | 35.6 ms |
| `memory-store.json` | 2.6 MB | 6.8 ms | 9.5 ms |
| `leads.json` | 2.25 MB | 4.2 ms | 5.6 ms |
| `organizations.json` | 0.55 MB | 1.1 ms | 13.3 ms |

**Caching:** `repoIntelligenceEngine.cjs:23` and `largeContextCodeSearch.cjs:24` both cache the 45 MB index with a 5-minute TTL — verified effective: real JSON endpoints on that data respond in **1 ms**. **No caching exists on the hot tenant stores** — `crmService._read()` and `organizationService._read()` re-read and re-parse from disk on *every* request. At current volumes that's 1–4 ms and acceptable; it is the mechanism behind the growth ceiling in §7.

## 4. Write Performance Matrix

| Metric | Measured | Classification |
|---|---|---|
| **Write amplification** | **11,779×** — a ~200-byte lead insert rewrites the full 2,355,884-byte file | CERTIFIED WITH LIMITATIONS |
| Single write latency | p50 **17.8 ms** (at 5.2k leads) → **4.9 ms** after cleanup to 47 leads | CERTIFIED |
| Atomicity — task queue | `agents/taskQueue.cjs:105-107` — per-PID unique `.tmp` + `renameSync` (atomic on POSIX) | CERTIFIED |
| Atomicity — CRM | `crmService.js:39` — **bare `writeFileSync`, not atomic** | CERTIFIED WITH LIMITATIONS |
| Atomic-write adoption | 45 service files use `tmp`+`renameSync`; 288 use bare `writeFileSync` | CERTIFIED WITH LIMITATIONS |
| Concurrent writes (40 parallel) | **40/40 landed, 0 lost**, file valid | CERTIFIED |
| Concurrent writes (150 parallel) | **150/150 landed, 0 lost**, 2900 ms wall, **52 writes/sec** | CERTIFIED |
| Lock contention | No file locks. Safety comes from Node's single-threaded event loop serializing read-modify-write | CERTIFIED WITH LIMITATIONS |
| **Cross-process safety** | **60 of 120 writes lost** with two OS processes on the same file — proves no cross-process locking | CERTIFIED (guarded by config) |
| Partial writes | 4 consecutive SIGKILL-during-write drills (Phase B.5) → 0 corruption | CERTIFIED |
| Retry behavior | `retries`/`maxRetries`/`retryDelay` persisted per task; preserved across restart | CERTIFIED |

The cross-process loss is **not a live defect**: `ecosystem.config.cjs:33` already pins `instances: 1` with the comment "NOT cluster-safe. Never set instances > 1". It is a hard architectural constraint that is documented and enforced — recorded here so it is not accidentally violated by future horizontal scaling.

**Event-loop blocking, measured live:** `/health` p50 degraded **0.7 ms → 17.6 ms** (max 159.1 ms) while writes hit the 2.25 MB `leads.json` — a **25× penalty on unrelated requests**. This is the observable symptom of the whole-file write model.

## 5. Consistency Matrix

| Layer pair | Result | Classification |
|---|---|---|
| JSON ↔ SQLite (count) | JSON 369 vs SQLite 1407 — **by design**: JSON prunes to 50 terminal tasks, mirror retains history | CERTIFIED |
| **JSON ↔ SQLite (status)** | **10 permanent disagreements → fixed → 0** (F1) | CERTIFIED (after fix) |
| JSON ↔ SQLite (orphans) | 351–353 JSON-only = mirror write-behind + prune asymmetry; transient orphan warnings resolved to 0 on re-measure | CERTIFIED |
| Disk ↔ API | Fresh write visible on disk, via `GET`, and via export path **immediately** (1/1/1) | CERTIFIED |
| Cache ↔ disk | 5-min TTL on `repo-index`; invalidated on write (`_invalidateCache`) | CERTIFIED |
| Memory ↔ disk | No long-lived in-memory mutable state for tenant stores (re-read per request) — cannot drift | CERTIFIED |
| Indexes | No secondary indexes exist; `repo-index.json` is a rebuildable artifact, not an authority | CERTIFIED |
| SQLite WAL | WAL mode active; 0 KB after checkpoint; no orphaned `-wal`/`-shm` | CERTIFIED |

## 6. Transactions Matrix

| Property | Observation | Classification |
|---|---|---|
| Idempotency | Same lead POSTed 5× → `duplicate:false` then `true`×4; **1 row on disk** | CERTIFIED |
| Duplicate requests | Deduplicated per `orgId`+`phone`; no double-insert | CERTIFIED |
| Partial failure | Invalid payload rejected → row count unchanged (5445 → 5445), no partial write | CERTIFIED |
| Rollback — queue | Corrupt queue moved to `.bak.<ts>` and re-initialised rather than crashing (`taskQueue.cjs:84`) | CERTIFIED |
| Interrupted writes | 0 corruption across all crash drills | CERTIFIED |
| **Multi-store atomicity** | **None.** JSON + SQLite are separate writes (root cause of F1); no cross-store transaction primitive exists | CERTIFIED WITH LIMITATIONS |

Single-store writes are effectively atomic where `renameSync` is used. There is no transaction spanning two stores — F1 was the consequence, now reconciled on startup rather than prevented at write time (preventing it would require the architectural change this mission forbids).

## 7. Growth Simulation Matrix

Synthetic records in the **exact shape** of real `leads.json` rows, measured on this host.

| Scale | File size | Write | Parse | Filter 1 org | RSS delta |
|---|---|---|---|---|---|
| **10 k** | 4.6 MB | 10 ms | 19 ms | 1 ms (10 hits) | 16 MB |
| **100 k** | 46.2 MB | 137 ms | 207 ms | 6 ms (100 hits) | 117 MB |
| **1 M** | 464.0 MB | **2592 ms** | **2441 ms** | 31 ms (1000 hits) | 395 MB |

Because every write is read-modify-write, per-write cost ≈ parse + write:

| Scale | Event-loop block per write | Max writes/sec | Verdict |
|---|---|---|---|
| 10 k | 29 ms | ~34 | **OK** |
| 100 k | 344 ms | ~2.9 | **DEGRADED** — every write stalls all requests ⅓ sec |
| 1 M | 5033 ms | ~0.2 | **CRITICAL** — one tenant's write freezes the whole product ~5 s |

**Validated live, not just synthetically:** at only 2.25 MB, writes already inflated `/health` p50 by 25× (0.7 → 17.6 ms). After cleanup to 47 leads, write latency fell 17.8 ms → **4.9 ms** and read p50 to **3.6 ms** — confirming latency tracks file size exactly as projected.

**Practical ceiling: ~10 k records per hot store.** Current largest tenant store (`leads.json`) sits at 5.2 k. `missions.json` at 10.7 MB already costs 32.9 ms per parse.

## 8. Multi-org Isolation Matrix

| Check | Result | Classification |
|---|---|---|
| Stores carrying `orgId` | 29 of 542 root stores | CERTIFIED |
| CRM filter correctness | `getLeads` filters `(l.orgId \|\| null) === (orgId \|\| null)` — exact match, no coercion leak | CERTIFIED |
| Tenant query result | **1 distinct `orgId`**; 0 legacy, 0 fixture, 0 Telegram rows | CERTIFIED |
| Forged `X-Org-Id` (real other org) | Returns nothing — membership required (Phase B.4, re-verified) | CERTIFIED |
| Dangling `orgId` reachability | `global`, `org_engineering`, `orgA`, deleted-org IDs → **all 404 / 0 rows** | CERTIFIED |
| Vault scoping | Distinct scopes `global` and `account:<id>`; `X-Org-Id=global` → **404** | CERTIFIED |
| Legacy `orgId`-less rows | Visible only to a null-org context, **never to a real tenant** (verified by filter semantics) | CERTIFIED |
| Archived orgs | 15 archived orgs remain in-file (soft delete) — restorable, not dangling | CERTIFIED |

## 9. Cleanup Matrix

| Job | Behavior | Live test | Classification |
|---|---|---|---|
| `pruneOldTasks(keep)` | Keeps all `pending`/`running` + all `recurring` + newest N terminal | **Pruned 481, kept 20; all 19 live pending tasks survived** | CERTIFIED |
| SQLite prune sync | `_shadowDelete` called per pruned id | Verified in code + mirror counts | CERTIFIED |
| `abandonStuckTasks(hrs)` | Marks tasks stuck >2 h as `failed` (mirrored) | Present, mirrored | CERTIFIED |
| Audit log rotation | Rotates at 20 MB | 21 rotated files present | CERTIFIED |
| **Rotated log cleanup** | **No job exists** despite documented "retains 30 days"; 289 MB accumulated | RECOVERY REQUIRED |
| Orphan record cleanup | No sweep for dead `orgId`/`userId` refs | CONFIGURATION REQUIRED |
| Live-data safety | **No cleanup job deleted live data in any test** | CERTIFIED |

## 10. Backup Compatibility Matrix

| Check | Result | Classification |
|---|---|---|
| Current backup restores without migration | 17/17 files restored, parseable, non-zero (Phase B.5 drill) | CERTIFIED |
| **3-month-old backup (2026-05-08)** | **10/10 stores parse under current code — no migration needed** | CERTIFIED |
| Container-shape stability | `local-accounts.json` id-keyed dict; `leads.json` array — both read correctly by current code | CERTIFIED |
| Credential material | `passwordHash` present for all 558 accounts — login works post-restore | CERTIFIED |
| Encrypted vault | `vault.json` ciphertext restores; **requires original `JWT_SECRET`** to decrypt | CONFIGURATION REQUIRED |
| Migration framework | None exists; `migration_log` = 0 rows. Not needed — schema changes are additive | CERTIFIED |

## 11. Schema Evolution Matrix

| Aspect | Observation | Classification |
|---|---|---|
| New fields since May backup | `orgId`, `email`, `amount`, `dealValue`, `notes`, `service` (6 added) | CERTIFIED |
| Removed fields | **0** — evolution is purely additive | CERTIFIED |
| Shared fields | 16 | CERTIFIED |
| Older backup → newer code | Parses and loads; missing fields read as `undefined`, no crash | CERTIFIED |
| Newer backup → older code | Extra fields ignored by JSON readers (no strict schema) | CERTIFIED |
| **Multi-tenancy field gap** | Pre-`orgId` records restore with no owner — **safe**: invisible to every real tenant, but also unreachable/unowned | CERTIFIED WITH LIMITATIONS |
| Version marker | `data/version.json` + `capability-registry.json` in every backup | CERTIFIED |
| Schema validation on load | None (`JSON.parse` only). Malformed-but-valid-JSON data would be accepted | CERTIFIED WITH LIMITATIONS |

The absence of a migration framework is appropriate here rather than a gap: with additive-only, schema-less JSON, old backups load unchanged — demonstrated with a genuinely 3-month-old archive.

## 12. Root Causes

| Finding | Root cause |
|---|---|
| F1 mirror drift | `_save()` (JSON) and `_shadowUpsert()` (SQLite) are two non-transactional writes; a crash between them is unrecoverable, and `recoverStale()` only revisited `running` tasks |
| 11,779× write amplification | Whole-file JSON persistence: any single-record change rewrites the entire store |
| 25× read latency under write load | Synchronous `writeFileSync` on the request path blocks Node's single event loop |
| ~10 k-record practical ceiling | Read-modify-write means per-write cost = parse + serialize, both O(file size), both blocking |
| 52 writes/sec ceiling | Same — serialized by the event loop, cost scales with store size |
| Cross-process write loss | No file locking; correctness depends entirely on `instances: 1` |
| 169 dangling `orgId` refs | No referential-integrity enforcement and no orphan sweep across 542 independent stores |
| 289 MB log tree | Rotation implemented, retention documented, cleanup never implemented |
| 27 `orgId`-less leads | Records predate multi-tenancy; additive schema evolution left them unowned |

## 13. Remediation Matrix

| ID | Recommendation | Scope | Priority |
|---|---|---|---|
| F1 | **DONE** — startup mirror reconciliation + 5 regression tests | `agents/taskQueue.cjs` | ✅ Fixed |
| B1 | Convert `crmService.js:39` to the `tmp`+`renameSync` pattern already in `agents/taskQueue.cjs:105` | `crmService.js` | **P1** |
| B2 | Add rotated-log cleanup honoring the documented 30-day retention (recovers ~289 MB) | `auditLog.cjs` / cron | **P1** |
| B3 | Add a read cache (TTL + write-invalidate) to `crmService`/`organizationService`, mirroring the proven `repoIntelligenceEngine` pattern — removes repeated parse from the hot path | services | **P1** |
| B4 | Enforce a per-store size ceiling (~10 k records / ~10 MB) with archival rollover, using the existing `pruneOldTasks` pattern | services | **P1** |
| B5 | Add an orphan sweep for dangling `orgId`/`userId` and a one-time backfill for the 27 legacy leads | services | P2 |
| B6 | Cap or shard `repo-index.json` (45 MB, 126.8 ms parse) below the existing 20-repo limit | `repoIntelligenceEngine.cjs` | P2 |
| B7 | Make `check-persistence-divergence.cjs` exit non-zero on true **status** mismatch (count delta stays informational) so CI can gate on it | script | P2 |
| B8 | Guard `instances: 1` at runtime — refuse to boot a second writer (e.g. PID lockfile) rather than relying on config discipline | `server.js` | P2 |
| B9 | Optimize `/orgs/me/context` (41.4 ms scanning 934 orgs) with an account→org index | `organizationService.cjs` | P3 |
| B10 | Add shape validation on load for critical stores so malformed-but-valid JSON is rejected | services | P3 |

None of these require a new storage engine or a migration. B3/B4 are the two that move the growth ceiling.

---

## Certification

| Area | Classification |
|---|---|
| Data Integrity | **CERTIFIED** — 0 corruption in 3438 stores; 0 true duplicate violations; orphans proven unreachable |
| Storage Health | CERTIFIED WITH LIMITATIONS — 1.8% stale, but 289 MB uncleaned logs |
| Read Performance | **CERTIFIED** at current scale (p50 0.6–41 ms); no hot-store caching |
| Write Performance | CERTIFIED WITH LIMITATIONS — 0 lost updates in 190 concurrent writes; 11,779× amplification |
| Consistency | **CERTIFIED** (after F1 fix) — drift 10 → 0, reconciled on startup |
| Transactions | CERTIFIED WITH LIMITATIONS — idempotency and partial-failure clean; no multi-store transaction |
| Growth Simulation | **RECOVERY REQUIRED** beyond ~10 k records per hot store |
| Multi-org Isolation | **CERTIFIED** — 1 distinct `orgId` per tenant query; every dangling ref 404 |
| Cleanup | CERTIFIED WITH LIMITATIONS — live data never deleted; no rotated-log cleanup |
| Backup Compatibility | **CERTIFIED** — 3-month-old backup restores with no migration |
| Schema Evolution | **CERTIFIED** — additive-only, forward and backward compatible |

### Database Readiness: **CERTIFIED WITH LIMITATIONS**

**Correctness is genuinely sound.** I tried hard to break it and could not: zero corruption across 3438 stores and 282.9 MB, zero lost updates across 190 concurrent writes, zero true duplicate violations, exact tenant isolation, clean idempotency, and cleanup that never touched live data. The atomic queue write path, `.bak` corruption fallback, per-org dedupe design, and TTL cache on the 45 MB index are all correct engineering.

**One real defect existed and is fixed.** F1 was permanent, silent, and caused by the Phase B.5 crash drills — the mirror recorded tasks as `pending` that had actually completed. It is now reconciled on the existing startup path, verified live (a restart repaired 2 fresh drifts), and guarded by 5 regression tests that provably fail without the fix.

**The binding limitation is scale, not correctness.** Whole-file JSON persistence gives **11,779× write amplification** and a **52 writes/sec** ceiling, and every write blocks the single event loop for O(file size). Measured live: writes to a 2.25 MB store inflated unrelated `/health` latency **25×**. Projected and validated: 100 k records → 344 ms stall per write; 1 M records → ~5 s freeze. **The practical ceiling is ~10 k records per hot store**; `leads.json` was at 5.2 k during testing and `missions.json` already costs 32.9 ms per parse. B3 (read cache) and B4 (size ceiling with rollover) address this within the existing architecture — no new engine, no migration.

**Remaining bottlenecks, ranked:** (1) synchronous whole-file writes on the request path; (2) no read cache on hot tenant stores; (3) 45 MB `repo-index.json` at 126.8 ms parse; (4) `/orgs/me/context` scanning 934 orgs at 41.4 ms; (5) 289 MB unbounded log tree.

**Validation hygiene:** 5,398 synthetic load-test leads removed; all prior-phase markers verified intact (`ALPHA-SECRET-LEAD`, `PRECRASH-MARKER-B5`, `BETA-SECRET-LEAD`); mirror drift re-verified at 0 post-cleanup; one server instance running clean; health 200. Regression **144/144 existing + 5/5 new**. Changes limited to `agents/taskQueue.cjs` and the new test file, plus the Phase B.5 files and pre-existing `.claude/settings.json`. No merge, no push, no redesign, no new storage engine, no migration.
