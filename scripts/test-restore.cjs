"use strict";
/**
 * Disaster Recovery Validation Test.
 * Verifies that the platform can be fully restored from a snapshot
 * after total persistence loss.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_DIR  = path.join(__dirname, '..');
const DATA_DIR = path.join(APP_DIR, 'data');
const BACKUP_DIR = path.join(APP_DIR, 'backups');

async function testRestore() {
    console.log('[+] Starting Disaster Recovery Validation...');

    // 1. Create a fresh backup
    console.log('[+] Creating baseline backup...');
    execSync('node scripts/safe-backup.cjs');
    
    const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('jarvis_full_')).sort();
    const latestBackup = path.join(BACKUP_DIR, backups[backups.length - 1]);
    console.log(`[+] Using latest backup: ${latestBackup}`);

    // 2. Simulate Catastrophic Loss
    //
    // Phase B.5: this list previously held only task-queue.json + jarvis.db —
    // exactly the two files the snapshot was known to contain — so the test
    // could never fail and never noticed that CRM, organizations, missions,
    // memory and the vault were absent from every backup. The wipe set is now
    // derived from the snapshot itself: every file the backup claims to
    // protect is removed and must come back. To stay a safe drill, each file
    // is moved aside to a restore-drill sidecar rather than deleted outright,
    // and anything the restore fails to bring back is put back from the
    // sidecar before the test reports its result — so a failing drill
    // reports the failure instead of causing the data loss it simulates.
    console.log('[!] SIMULATING DATA LOSS (moving protected files aside)...');
    const preSnapList = (() => {
        const tmp = path.join(BACKUP_DIR, 'wipe_probe');
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.mkdirSync(tmp, { recursive: true });
        execSync(`tar -xzf "${latestBackup}" -C "${tmp}"`);
        const dir = path.join(tmp, fs.readdirSync(tmp)[0]);
        const names = fs.readdirSync(dir).filter(f => f !== 'env-config-nonsecret.txt');
        fs.rmSync(tmp, { recursive: true, force: true });
        return names;
    })();

    const SIDECAR = path.join(BACKUP_DIR, `restore_drill_sidecar_${Date.now()}`);
    fs.mkdirSync(SIDECAR, { recursive: true });
    const wiped = [];
    for (const f of [...preSnapList, 'jarvis.db-wal', 'jarvis.db-shm']) {
        const p = path.join(DATA_DIR, f);
        if (fs.existsSync(p)) {
            fs.renameSync(p, path.join(SIDECAR, f));
            wiped.push(f);
        }
    }
    console.log(`[!] ${wiped.length} protected file(s) removed: ${wiped.join(', ')}`);

    // 3. Perform Restore
    console.log('[+] RESTORING FROM SNAPSHOT...');
    const tmpDir = path.join(BACKUP_DIR, 'restore_tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
    
    execSync(`tar -xzf "${latestBackup}" -C "${tmpDir}"`);
    const snapDir = path.join(tmpDir, fs.readdirSync(tmpDir)[0]);

    // Restore every file the snapshot carries (not just task-queue.json) —
    // this is what a real operator restore has to achieve.
    for (const f of fs.readdirSync(snapDir)) {
        if (f === 'env-config-nonsecret.txt') continue;  // reference only, never overwrites .env
        if (f === 'jarvis.db' || f === 'jarvis.db.raw') continue;  // handled below
        fs.copyFileSync(path.join(snapDir, f), path.join(DATA_DIR, f));
    }
    // jarvis.db is only present in the snapshot if safe-backup.cjs found a live
    // SQLite DB to back up (backend/db/sqlite.cjs is not required anywhere in
    // the live server path, so a fresh/typical environment has no DB file at
    // all — that's not a restore failure). The online-backup path writes
    // jarvis.db; its raw-copy fallback (used when VACUUM INTO fails, e.g. a
    // better-sqlite3 native ABI mismatch) writes jarvis.db.raw instead.
    const dbSnapshot = ['jarvis.db', 'jarvis.db.raw']
        .map(f => path.join(snapDir, f))
        .find(p => fs.existsSync(p));
    if (dbSnapshot) {
        fs.copyFileSync(dbSnapshot, path.join(DATA_DIR, 'jarvis.db'));
    } else {
        console.log('[+] No jarvis.db in snapshot — SQLite DB was not present at backup time, skipping.');
    }
    
    console.log('[+] Restore finished.');

    // 4. Validate Integrity — every wiped file must be back AND parseable.
    // check-persistence-divergence.cjs alone is not sufficient here: it always
    // exits 0 (it warns about count/content divergence on stdout but never
    // signals failure), so the previous `execSync` + catch could never throw
    // and this step always "passed". It is still run for its divergence
    // report, but the pass/fail decision is now made from real per-file checks.
    console.log('[+] Running integrity check...');
    const failures = [];
    for (const f of wiped) {
        if (f === 'jarvis.db-wal' || f === 'jarvis.db-shm') continue;  // regenerated by SQLite
        const p = path.join(DATA_DIR, f);
        if (!fs.existsSync(p)) { failures.push(`${f}: NOT RESTORED`); continue; }
        if (fs.statSync(p).size === 0) { failures.push(`${f}: restored but ZERO BYTES`); continue; }
        if (f.endsWith('.json')) {
            try { JSON.parse(fs.readFileSync(p, 'utf8')); }
            catch (e) { failures.push(`${f}: restored but INVALID JSON (${e.message.slice(0, 50)})`); }
        }
    }

    if (failures.length) {
        // Put back everything the restore failed to recover so a failed drill
        // never becomes real data loss.
        console.error(`[!] ${failures.length} file(s) failed verification — rolling the drill back:`);
        failures.forEach(f => console.error(`    - ${f}`));
        for (const f of fs.readdirSync(SIDECAR)) {
            fs.copyFileSync(path.join(SIDECAR, f), path.join(DATA_DIR, f));
        }
        console.error('[+] Original files restored from drill sidecar — no data lost.');
        execSync(`rm -rf "${tmpDir}" "${SIDECAR}"`);
        throw new Error(`Restore verification failed for ${failures.length} file(s): ${failures.join('; ')}`);
    }

    console.log(`[+] INTEGRITY VERIFIED — ${wiped.length} file(s) restored, readable and parseable.`);
    try { execSync('node scripts/check-persistence-divergence.cjs', { stdio: 'inherit' }); }
    catch { console.warn('[!] Divergence report exited non-zero (informational).'); }

    // Cleanup
    execSync(`rm -rf "${tmpDir}" "${SIDECAR}"`);
    console.log('[+] Disaster Recovery Validation: PASSED.');
}

testRestore().catch(err => {
    console.error('[!] Disaster Recovery Validation: FAILED');
    console.error(err);
    process.exit(1);
});
