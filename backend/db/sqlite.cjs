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

function getDB() {
    if (_db) return _db;

    _db = new Database(DB_PATH, {
        // verbose: console.log // uncomment for debugging
    });

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
    `);

    return _db;
}

/** Close connection safely on shutdown. */
function closeDB() {
    if (_db) {
        _db.close();
        _db = null;
    }
}

module.exports = { getDB, closeDB, DB_PATH };
