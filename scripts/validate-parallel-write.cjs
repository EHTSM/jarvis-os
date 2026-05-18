"use strict";
/**
 * Parallel Write Validation.
 * Verifies that the new SQLite layer can "shadow" the JSON persistence
 * without impacting primary operations.
 */

const { getDB } = require('../backend/db/sqlite.cjs');
const fs = require('fs');
const path = require('path');

const TEST_JSON = path.join(__dirname, 'parallel-test.json');

function mockAddTaskJSON(task) {
    const data = JSON.parse(fs.readFileSync(TEST_JSON, 'utf8') || '[]');
    data.push(task);
    fs.writeFileSync(TEST_JSON, JSON.stringify(data));
}

function shadowWriteSQLite(task) {
    const db = getDB();
    const stmt = db.prepare(`
        INSERT INTO tasks (id, input, type, status, created_at)
        VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(task.id, task.input, task.type, task.status, task.createdAt);
}

// ── Validation Flow ───────────────────────────────────────────────────────

try {
    console.log('[+] Initializing parallel write test...');
    fs.writeFileSync(TEST_JSON, '[]');

    const mockTask = {
        id: 'tq_parallel_001',
        input: 'echo hello parallel',
        type: 'test',
        status: 'pending',
        createdAt: new Date().toISOString()
    };

    console.log('[+] Writing to JSON (Source of Truth)...');
    mockAddTaskJSON(mockTask);

    console.log('[+] Shadowing to SQLite...');
    shadowWriteSQLite(mockTask);

    console.log('[+] Verifying data consistency...');
    const db = getDB();
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(mockTask.id);
    
    if (row && row.input === mockTask.input) {
        console.log('[+] SQLite Consistency OK.');
    } else {
        throw new Error('SQLite data mismatch');
    }

    const jsonData = JSON.parse(fs.readFileSync(TEST_JSON, 'utf8'));
    if (jsonData[0].id === mockTask.id) {
        console.log('[+] JSON Integrity OK.');
    } else {
        throw new Error('JSON data corruption detected');
    }

    console.log('[+] Parallel Write Validation: PASSED.');
    
    // Cleanup
    fs.unlinkSync(TEST_JSON);
    process.exit(0);

} catch (err) {
    console.error('[!] Parallel Write Validation FAILED:');
    console.error(err);
    process.exit(1);
}
