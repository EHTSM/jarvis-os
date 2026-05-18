"use strict";
/**
 * Safe Snapshot & Backup Utility.
 * Performs a consistent backup of JSON and SQLite persistence.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const APP_DIR    = path.join(__dirname, '..');
const DATA_DIR   = path.join(APP_DIR, 'data');
const BACKUP_DIR = path.join(APP_DIR, 'backups');
const TIMESTAMP  = new Date().toISOString().replace(/[:.]/g, '-');
const SNAP_DIR   = path.join(BACKUP_DIR, `snapshot_${TIMESTAMP}`);

async function runBackup() {
    console.log('[+] Starting Safe Snapshot...');
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);
    fs.mkdirSync(SNAP_DIR);

    // 1. Snapshot .env (Critical Config)
    if (fs.existsSync(path.join(APP_DIR, '.env'))) {
        fs.copyFileSync(path.join(APP_DIR, '.env'), path.join(SNAP_DIR, '.env.bak'));
        console.log('[+] .env snapshot: OK');
    }

    // 2. Snapshot JSON Task Queue (Authority)
    const jsonQueue = path.join(DATA_DIR, 'task-queue.json');
    if (fs.existsSync(jsonQueue)) {
        fs.copyFileSync(jsonQueue, path.join(SNAP_DIR, 'task-queue.json'));
        console.log('[+] JSON Queue snapshot: OK');
    }

    // 3. Safe SQLite Backup (Using VACUUM INTO)
    const dbPath = path.join(DATA_DIR, 'jarvis.db');
    if (fs.existsSync(dbPath)) {
        try {
            const Database = require('better-sqlite3');
            const db = new Database(dbPath, { readonly: true });
            const backupFile = path.join(SNAP_DIR, 'jarvis.db');
            
            // VACUUM INTO creates a consistent, single-file copy without WAL/SHM side-files.
            // This is the safest way to backup an active SQLite DB.
            db.prepare(`VACUUM INTO '${backupFile}'`).run();
            db.close();
            console.log('[+] SQLite Snapshot (Consistent): OK');
        } catch (err) {
            console.warn('[!] SQLite online backup failed, falling back to raw copy:', err.message);
            fs.copyFileSync(dbPath, path.join(SNAP_DIR, 'jarvis.db.raw'));
        }
    }

    // 4. Compress Snapshot
    const archive = path.join(BACKUP_DIR, `jarvis_full_${TIMESTAMP}.tar.gz`);
    try {
        execSync(`tar -czf "${archive}" -C "${BACKUP_DIR}" "snapshot_${TIMESTAMP}"`);
        console.log(`[+] Full Snapshot Archived: ${archive}`);
        
        // Cleanup temp dir
        execSync(`rm -rf "${SNAP_DIR}"`);
    } catch (err) {
        console.error('[!] Compression failed:', err.message);
    }

    // 5. Retention Logic (Keep last 7)
    try {
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('jarvis_full_'))
            .sort((a, b) => fs.statSync(path.join(BACKUP_DIR, b)).mtimeMs - fs.statSync(path.join(BACKUP_DIR, a)).mtimeMs);
        
        if (files.length > 7) {
            files.slice(7).forEach(f => {
                fs.unlinkSync(path.join(BACKUP_DIR, f));
                console.log(`[+] Pruned old backup: ${f}`);
            });
        }
    } catch (err) {
        console.warn('[!] Retention pruning failed:', err.message);
    }

    console.log('[+] Backup Cycle Complete.');
}

runBackup().catch(console.error);
