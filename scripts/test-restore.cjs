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
    console.log('[!] SIMULATING DATA LOSS (Wiping data/)...');
    const filesToWipe = ['task-queue.json', 'jarvis.db', 'jarvis.db-wal', 'jarvis.db-shm'];
    filesToWipe.forEach(f => {
        const p = path.join(DATA_DIR, f);
        if (fs.existsSync(p)) fs.unlinkSync(p);
    });

    // 3. Perform Restore
    console.log('[+] RESTORING FROM SNAPSHOT...');
    const tmpDir = path.join(BACKUP_DIR, 'restore_tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
    
    execSync(`tar -xzf "${latestBackup}" -C "${tmpDir}"`);
    const snapDir = path.join(tmpDir, fs.readdirSync(tmpDir)[0]);
    
    // Restore files
    fs.copyFileSync(path.join(snapDir, 'task-queue.json'), path.join(DATA_DIR, 'task-queue.json'));
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

    // 4. Validate Integrity
    console.log('[+] Running integrity check...');
    try {
        execSync('node scripts/check-persistence-divergence.cjs');
        console.log('[+] INTEGRITY VERIFIED. System restored successfully.');
    } catch (err) {
        throw new Error('Integrity check failed after restore!');
    }

    // Cleanup
    execSync(`rm -rf "${tmpDir}"`);
    console.log('[+] Disaster Recovery Validation: PASSED.');
}

testRestore().catch(err => {
    console.error('[!] Disaster Recovery Validation: FAILED');
    console.error(err);
    process.exit(1);
});
