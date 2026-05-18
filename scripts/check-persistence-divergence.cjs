"use strict";
/**
 * Persistence Divergence Checker.
 * Compares authoritative JSON state with SQLite shadow state.
 */

const fs = require('fs');
const path = require('path');
const { getDB } = require('../backend/db/sqlite.cjs');

const JSON_PATH = path.join(__dirname, '../data/task-queue.json');

function checkDivergence() {
    console.log('[+] Starting Persistence Divergence Check...');
    
    // 1. Load JSON
    let jsonTasks = [];
    try {
        jsonTasks = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8') || '[]');
    } catch (e) {
        console.error('[!] Failed to load JSON:', e.message);
        return;
    }

    // 2. Load SQLite
    const db = getDB();
    const sqlTasks = db.prepare('SELECT * FROM tasks').all();

    console.log(`[+] JSON Count: ${jsonTasks.length}`);
    console.log(`[+] SQLite Count: ${sqlTasks.length}`);

    // 3. Count Mismatch
    // Note: SQL might have more tasks if JSON pruning happened while SQL pruning failed,
    // or vice-versa. But for active tasks, they should match.
    if (jsonTasks.length !== sqlTasks.length) {
        console.warn(`[!] COUNT MISMATCH: JSON(${jsonTasks.length}) vs SQLite(${sqlTasks.length})`);
    }

    // 4. Content Validation (Sample check of last 5 tasks)
    const recentJson = jsonTasks.slice(-5);
    let mismatches = 0;

    recentJson.forEach(jt => {
        const st = sqlTasks.find(s => s.id === jt.id);
        if (!st) {
            console.error(`[!] ORPHANED TASK in JSON: ${jt.id}`);
            mismatches++;
        } else if (st.status !== jt.status) {
            console.error(`[!] STATUS MISMATCH for ${jt.id}: JSON(${jt.status}) vs SQLite(${st.status})`);
            mismatches++;
        }
    });

    if (mismatches === 0) {
        console.log('[+] CONTENT CONSISTENCY: OK.');
    } else {
        console.error(`[!] FOUND ${mismatches} CONTENT MISMATCHES.`);
    }

    // 5. WAL Check
    const walPath = path.join(__dirname, '../data/jarvis.db-wal');
    if (fs.existsSync(walPath)) {
        const stats = fs.statSync(walPath);
        console.log(`[+] WAL Size: ${(stats.size / 1024).toFixed(2)} KB`);
    } else {
        console.log('[+] WAL File: Idle/Merged.');
    }

    console.log('[+] Divergence Check Complete.');
}

checkDivergence();
