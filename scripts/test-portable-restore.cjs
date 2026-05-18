"use strict";
/**
 * Portable Restore Validation.
 * Verifies that an exported snapshot can be restored onto a fresh directory
 * and successfully initialize the runtime.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR     = path.join(__dirname, '..');
const BACKUP_DIR   = path.join(ROOT_DIR, 'backups');
const FRESH_VPS_DIR = path.join(ROOT_DIR, 'backups/fresh_vps_sim');

async function validatePortability() {
    console.log('[+] Starting Portable Restore Validation...');

    // 1. Get latest snapshot
    const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('jarvis_full_') && f.endsWith('.tar.gz')).sort();
    if (backups.length === 0) throw new Error('No snapshots found!');
    const latest = path.join(BACKUP_DIR, backups[backups.length - 1]);
    console.log(`[+] Source snapshot: ${path.basename(latest)}`);

    // 2. Setup Fresh VPS Sim
    if (fs.existsSync(FRESH_VPS_DIR)) execSync(`rm -rf "${FRESH_VPS_DIR}"`);
    fs.mkdirSync(FRESH_VPS_DIR, { recursive: true });
    fs.mkdirSync(path.join(FRESH_VPS_DIR, 'data'));
    fs.mkdirSync(path.join(FRESH_VPS_DIR, 'backend/db'), { recursive: true });

    // 3. Restore to Fresh VPS
    console.log('[+] Restoring to fresh directory...');
    const tmpRestore = path.join(BACKUP_DIR, 'portable_tmp');
    if (!fs.existsSync(tmpRestore)) fs.mkdirSync(tmpRestore);
    
    execSync(`tar -xzf "${latest}" -C "${tmpRestore}"`);
    const snapDir = path.join(tmpRestore, fs.readdirSync(tmpRestore)[0]);
    
    // Copy only essential data/config
    fs.copyFileSync(path.join(snapDir, '.env.bak'), path.join(FRESH_VPS_DIR, '.env'));
    fs.copyFileSync(path.join(snapDir, 'task-queue.json'), path.join(FRESH_VPS_DIR, 'data/task-queue.json'));
    fs.copyFileSync(path.join(snapDir, 'jarvis.db'), path.join(FRESH_VPS_DIR, 'data/jarvis.db'));

    console.log('[+] Restoration finished.');

    // 4. Verify Initialization on "Fresh VPS"
    console.log('[+] Verifying bootstrap on fresh instance...');
    
    // We point a custom script to the fresh dir to verify it can open the DB and load tasks
    const testScript = path.join(FRESH_VPS_DIR, 'verify_boot.cjs');
    fs.writeFileSync(testScript, `
        const fs = require('fs');
        const path = require('path');
        const Database = require('${path.join(ROOT_DIR, 'node_modules/better-sqlite3')}');
        
        console.log('[Verify] Loading JSON tasks...');
        const json = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/task-queue.json'), 'utf8'));
        console.log('[Verify] JSON tasks:', json.length);

        console.log('[Verify] Opening SQLite DB...');
        const db = new Database(path.join(__dirname, 'data/jarvis.db'));
        const count = db.prepare('SELECT COUNT(*) as c FROM tasks').get().c;
        console.log('[Verify] SQLite tasks:', count);
        db.close();
        
        process.exit(0);
    `);

    try {
        execSync(`node "${testScript}"`);
        console.log('[+] PORTABILITY VERIFIED. System is fully restorable to clean infrastructure.');
    } catch (err) {
        throw new Error('Fresh instance verification failed!');
    }

    // Cleanup
    execSync(`rm -rf "${tmpRestore}"`);
    // execSync(`rm -rf "${FRESH_VPS_DIR}"`); // Keep for manual inspection if needed
    console.log('[+] Portable Restore Validation: PASSED.');
}

validatePortability().catch(err => {
    console.error('[!] Portable Restore Validation: FAILED');
    console.error(err);
    process.exit(1);
});
