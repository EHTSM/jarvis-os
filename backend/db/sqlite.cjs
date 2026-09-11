"use strict";
/**
 * SQLite Connection Manager.
 * Optimized for local single-operator use with WAL mode.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const DB_PATH = path.join(__dirname, '../../data/jarvis.db');
const DB_DIR  = path.dirname(DB_PATH);

if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

let _db = null;
let _dbIno = null; // inode DB_PATH pointed to when _db was opened

function getDB() {
    // Stale-handle detection: if DB_PATH now resolves to a different inode
    // than the one _db has open (e.g. an external process replaced the file
    // via rename — a real restore-drill scenario, not hypothetical: a live
    // server's open fd keeps writing into the old, now-unlinked inode
    // forever, silently, with every write appearing to succeed while the
    // data becomes permanently unreachable the moment that inode's last
    // reference is dropped), reopen against the current file instead of
    // continuing to write into orphaned storage.
    if (_db) {
        try {
            const curIno = fs.statSync(DB_PATH).ino;
            if (curIno === _dbIno) return _db;
            logger.warn('[SQLite] DB_PATH inode changed since connection was opened (external replace) — reopening');
            _db.close();
            _db = null;
        } catch {
            return _db; // stat failed transiently — keep using the existing handle rather than disrupt it
        }
    }

    _db = new Database(DB_PATH, {
        // verbose: console.log // uncomment for debugging
    });
    _dbIno = fs.statSync(DB_PATH).ino;

    // ── WAL Configuration ──────────────────────────────────────────────────
    // Write-Ahead Logging allows concurrent readers + 1 writer without blocking.
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL'); 

    const mode = _db.pragma('journal_mode')[0].journal_mode;
    if (mode === 'wal') {
        logger.info(`[SQLite] Persistence recovered — WAL mode active.`);
    } else {
        logger.warn(`[SQLite] Persistence degraded — journal mode: ${mode}`);
    }

    // ── Schema Initialization (Safe/Idempotent) ─────────────────────────────
    _db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            input TEXT NOT NULL,
            type TEXT DEFAULT 'auto',
            status TEXT DEFAULT 'pending',
            retries INTEGER DEFAULT 0,
            max_retries INTEGER DEFAULT 3,
            retry_delay INTEGER DEFAULT 15000,
            scheduled_for TEXT,
            recurring_cron TEXT,
            created_at TEXT,
            started_at TEXT,
            completed_at TEXT,
            last_error TEXT,
            metadata TEXT DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS migration_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            applied_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_for);
        CREATE INDEX IF NOT EXISTS idx_tasks_created   ON tasks(created_at);
    `);

    return _db;
}

/** Close connection safely on shutdown. */
function closeDB() {
    if (_db) {
        _db.close();
        _db = null;
        _dbIno = null;
    }
}

/** Return aggregate task statistics from the database. */
function getStats() {
    const db = getDB();
    const total = db.prepare("SELECT COUNT(*) as n FROM tasks").get().n;
    const byStatus = {};
    for (const r of db.prepare("SELECT status, COUNT(*) as n FROM tasks GROUP BY status").all()) {
        byStatus[r.status] = r.n;
    }
    return { total, byStatus };
}

module.exports = { getDB, closeDB, DB_PATH, getStats };
