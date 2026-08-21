# SQLITE SHADOW RESTORE-DRILL ORPHANING — AUDIT

**Track:** OOPLIX V1 Master Audit — production hardening / data integrity / backup-restore
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`

---

## Why this item

Reconciled the register per this mission's own instructions. C10-005 (3 non-reconciled memory
backends) and `/p18/memory/*` (authorization/product-scope decision) both remain genuinely
**DECISION REQUIRED — BLOCKED ON FOUNDER PRODUCT DECISION** — no existing project documentation
supplies the missing decision, so both were left untouched, exactly as instructed.

With the operator-authorization, tenant-IDOR, `/api`-prefix, and frontend-wiring defect families all
already closed and the mission explicitly forbidding another sweep of an already-closed pattern,
shifted to the new priority list's backup/restore area (#6). This has been open, unchanged, since
B.25 first flagged it: *"Perform a real restore drill (NM-1) — hours, needs a scratch environment."*
Every subsequent phase (RC-1, RC-2, RC-3, RC-4) carried "restore drill" forward as NOT MEASURED without
ever executing one.

## Discovery

The "missing capability" framing was wrong — `scripts/test-restore.cjs` already exists, is real,
already engineered to be safe (moves protected files to a sidecar rather than deleting them; if any
post-restore check fails, it copies everything back from the sidecar before reporting failure, so a
failing drill cannot itself cause data loss), and its own header comment documents a real bug it
already fixed in an earlier version (a wipe list that could never actually catch a missing file, so the
test could never fail). It had simply never been run, and no report anywhere in this session's history
mentions it.

Took an additional manual safety copy of `data/` beyond the script's own built-in protection, then ran
it for real:

```
node scripts/test-restore.cjs
→ 19 protected files removed (leads.json, organizations.json, missions.json, memory-store.json,
  vault.json, jarvis.db, jarvis.db-wal, jarvis.db-shm, and 11 others)
→ RESTORING FROM SNAPSHOT... Restore finished.
→ INTEGRITY VERIFIED — 19 file(s) restored, readable and parseable.
→ Disaster Recovery Validation: PASSED.
```

**The drill itself passed on the first real run.** But its own informational divergence-check step
(`scripts/check-persistence-divergence.cjs`, always exit-0, warning-only by design) printed a count
mismatch between the JSON task queue and its SQLite shadow. Investigating that output — rather than
dismissing it as the pre-existing informational noise it's designed to allow — surfaced a real,
previously undiscovered defect.

## Root cause

`backend/db/sqlite.cjs`'s `getDB()` is a classic module-level singleton:

```js
let _db = null;
function getDB() {
    if (_db) return _db;
    _db = new Database(DB_PATH, {...});
    ...
    return _db;
}
```

`test-restore.cjs`'s "simulate data loss" step does `fs.renameSync(data/jarvis.db, sidecar/...)`, then
restores a snapshot into `data/jarvis.db` via `copyFileSync`. `renameSync` swaps which inode the path
`data/jarvis.db` refers to — it does **not** invalidate a file descriptor a process already has open to
the old inode. The live server's `_db` handle, opened before the drill ran, kept its descriptor bound
to that old inode. Every subsequent write from `taskQueue.cjs`'s `_shadowUpsert()` kept **silently
succeeding** — `better-sqlite3` had no reason to throw, the file it was writing to was perfectly valid,
just no longer reachable by any path. The existing `try{}catch{}` around every shadow-write had nothing
to catch; nothing was ever logged.

**Confirmed directly, not inferred**: `lsof -p <live-server-pid>` showed the process's actual open file
descriptors for `jarvis.db`/`jarvis.db-wal`/`jarvis.db-shm` pointing literally into
`backups/restore_drill_sidecar_<timestamp>/` — a directory the drill's own cleanup step had *already
deleted*. The data those writes produced was gone the instant that `rm -rf` ran, and invisible the
entire time before that, since:

- a fresh, independent connection to the *current* `data/jarvis.db` showed the identical row count to
  the live server's own state, both frozen at the exact millisecond of the drill's file-swap
- `task-queue.json` (the JSON side, authoritative) kept growing normally throughout, confirmed by
  timestamp: JSON's latest task was created 90 seconds after the SQLite side had gone completely silent

This is architecturally significant: `check-persistence-divergence.cjs`'s whole purpose is to be an
early-warning signal for exactly this kind of silent SQLite/JSON divergence — and it correctly fired —
but nothing had ever acted on what it was capable of catching, because the drill that would trigger the
real-world version of this scenario had never been run.

## Fix

```diff
 let _db = null;
+let _dbIno = null; // inode DB_PATH pointed to when _db was opened

 function getDB() {
-    if (_db) return _db;
+    if (_db) {
+        try {
+            const curIno = fs.statSync(DB_PATH).ino;
+            if (curIno === _dbIno) return _db;
+            logger.warn('[SQLite] DB_PATH inode changed since connection was opened (external replace) — reopening');
+            _db.close();
+            _db = null;
+        } catch {
+            return _db; // stat failed transiently — keep using the existing handle
+        }
+    }

     _db = new Database(DB_PATH, {...});
+    _dbIno = fs.statSync(DB_PATH).ino;
     ...
```

`closeDB()` was extended to also clear `_dbIno`. No new architecture, no new service, no schema
change — the existing singleton pattern was made self-correcting instead of blindly trusting its own
cached handle forever. Every real consumer (`taskQueue.cjs`'s 3 call sites) already calls `getDB()`
fresh each time rather than holding a local reference, so the fix requires zero consumer-side changes.

## Live re-verification

Restarted the server on the fix, took a fresh safety copy of `data/`, and ran a **second real restore
drill** end-to-end against the live, running, fixed server:

```
node scripts/test-restore.cjs  →  PASSED (19/19 files restored, integrity verified)
```

Server's own log confirms the fix fired during this drill:

```
[WARN] [SQLite] DB_PATH inode changed since connection was opened (external replace) — reopening
```

Confirmed shadow writes resumed landing in the real, current file (not a new orphan) by polling an
independent fresh connection across three separate checks: `1535 → 1543 → 1554`, sustained growth,
each check's "most recent" row timestamped within the prior few seconds — the exact signature that was
frozen solid before the fix.

Confirmed real production data intact after both the exploratory and the confirmation drill runs
(`leads.json`, `organizations.json`, `missions.json`, `memory-store.json`, `vault.json` all present,
correctly sized, non-zero), and that no drill artifacts (`restore_drill_sidecar_*`, `wipe_probe`,
`restore_tmp`) were left behind in `backups/`.

## Regression

- Added describe block `135-master-audit-sqlite-shadow-restore-drill-orphaning` to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`: a structural check that `getDB()` tracks and
  compares an inode, and a real live test that opens a real connection to `data/jarvis.db`, inserts a
  probe row, externally replaces the file by rename exactly as the drill does, inserts a second probe
  row via a fresh `getDB()` call, and proves via a fully independent connection that the second write
  landed in the current file (not an orphan) — then cleans up both probe rows.
- Negative-tested: reverted the fix, confirmed both new tests failed — the live test specifically
  failed because the post-swap write was genuinely unrecoverable from the current file, proving the
  test reproduces the real defect rather than asserting something tautological — restored, confirmed
  passing again.
- `npm run test:runtime`: **272/272** (270/270 baseline + 2 new tests).
- `tests/security/97-enterprise-isolation-integrity.cjs`: unaffected (1/1).
- Production build: unaffected (backend-only change, no frontend files touched).
- `.env`: confirmed untouched throughout.

---

## AUDIT NAME: SQLite Shadow Restore-Drill Orphaning (getDB() stale-handle silent data loss)

**STATUS:** CERTIFIED
**SCORE:** 9/10
**CONFIDENCE:** 93%

## V1 SURFACE

- **Backend:** `backend/db/sqlite.cjs` (1 function extended — inode tracking added to `getDB()`,
  `closeDB()` extended to clear it). `taskQueue.cjs` read for consumer-safety confirmation, not
  modified — no consumer caches the handle.
- **Routes:** N/A — this is a persistence-layer connection-lifecycle fix, no HTTP route surface.
- **Frontend:** N/A — no frontend files touched, no UI consumer of SQLite shadow data.
- **Persistence:** PASS — the actual subject of this audit; live-verified against the real production
  `data/jarvis.db` through two real, full end-to-end restore drills (one exploratory that discovered
  the defect, one confirmation run proving the fix).
- **Authentication:** N/A.
- **Authorization:** N/A.
- **Tenant Isolation:** N/A — the task queue is internal platform infrastructure, not tenant data.
- **Cross-OS:** N/A — pure Node.js file-descriptor/inode behavior, POSIX-standard (macOS/Linux; not
  claimed for Windows, where rename-over-open-handle semantics differ).
- **Failure Honesty:** PASS, and the actual improvement — before this fix, silent data loss occurred
  with zero error, zero log line; after, a real `[WARN]` is emitted the moment staleness is detected
  and the recovery is automatic, not merely disclosed.
- **Live Verification:** two full real restore drills against the actual running server and real
  production data, `lsof`-confirmed root cause, log-confirmed fix engagement, independent-connection-
  confirmed sustained write recovery.
- **Regression:** 272/272 (0 failures, 0 skipped, 2 net new tests).

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed — `getDB()`'s module-level singleton never detected external file
  replacement, causing every SQLite shadow-write in a live process to silently succeed into a
  permanently orphaned, soon-to-be-deleted inode after any real restore operation, with zero error and
  zero log signal.
- **V1-critical P2:** 0
- **Other:** confirmed the restore drill script itself (`test-restore.cjs`) was already correct and
  needed no change; the defect was in a different file the drill's own execution exposed.

## FIXES

- `backend/db/sqlite.cjs`: `getDB()` now tracks the inode of `DB_PATH` at open time and reopens
  automatically if it changes; `closeDB()` clears the tracked inode.
- 2 new regression tests (1 structural, 1 live end-to-end reproduction), negative-tested.
- Real restore drill executed twice against real production data (once exploratory, once to confirm
  the fix), both with full manual safety backups in addition to the script's own built-in protection.

## LIMITATIONS

- The fix is scoped to `getDB()`'s own module-level singleton; if any future code were to cache a
  `Database` handle locally outside of calling `getDB()` fresh each time, it would not benefit from
  this self-healing behavior — confirmed no such caller currently exists, but this is a discipline the
  fix depends on rather than structurally prevents.
- POSIX rename/inode semantics were assumed and confirmed live on this platform (macOS); Windows file
  rename-while-open behavior is different (typically requires the handle to be closed first) and would
  fail differently — not claimed as verified here, since this codebase targets Linux/macOS deployment.
- The pre-existing JSON-vs-SQLite count divergence unrelated to this defect (SQLite retains more
  historical rows than the more-aggressively-pruned JSON queue) was observed and is expected/benign per
  `check-persistence-divergence.cjs`'s own design intent — not investigated further, as it was not the
  defect this pass targeted and the checker already correctly treats it as informational, not a failure.

## FINAL CLASSIFICATION: **CERTIFIED**

## PROGRAMME IMPACT

Converts "restore drill — NOT MEASURED" (open since B.25, carried through RC-1 through RC-4 unresolved)
into a genuinely executed, twice-run, evidence-backed PASS — and, in the process of actually running
it for the first time, found and fixed a real silent-data-loss defect that would otherwise have shipped
undetected into any real production restore operation. No OS-track record altered.

## REGRESSION RESULT: 272/272 (0 failures, 0 skipped, 2 net new tests)

## BUILD RESULT: PASS (unaffected; backend-only change, no frontend files modified)

## CURRENT BASELINE: 272/272
