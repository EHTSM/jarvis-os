"use strict";
/**
 * SQLite Shadow Failure Degradation Test.
 * Verifies that the task queue DOES NOT CRASH if SQLite throws an error.
 */

const fs = require('fs');
const path = require('path');

// Mock getDB to throw an error
const sqlitePath = path.join(__dirname, '../backend/db/sqlite.cjs');
const originalContent = fs.readFileSync(sqlitePath, 'utf8');

try {
    console.log('[+] Simulating SQLite failure...');
    fs.writeFileSync(sqlitePath, 'module.exports = { getDB: () => { throw new Error("MOCK_DB_FAILURE"); } };');

    // Invalidate require cache
    delete require.cache[require.resolve('../agents/taskQueue.cjs')];
    delete require.cache[require.resolve('../backend/db/sqlite.cjs')];

    const taskQueue = require('../agents/taskQueue.cjs');
    
    console.log('[+] Attempting to add task with broken SQLite shadow...');
    const task = taskQueue.addTask({ input: 'degradation test' });

    console.log('[+] Task ID:', task.id);
    console.log('[+] Checking if JSON persisted despite SQLite error...');
    
    const QUEUE_FILE = path.join(__dirname, '../data/task-queue.json');
    const data = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    
    if (data.find(t => t.id === task.id)) {
        console.log('[+] JSON persistence successful. Degradation is GRACEFUL.');
    } else {
        throw new Error('JSON persistence failed during SQLite error!');
    }

    console.log('[+] Shadow Failure Degradation: PASSED.');
    
    // Restore
    fs.writeFileSync(sqlitePath, originalContent);
    process.exit(0);

} catch (err) {
    console.error('[!] Shadow Failure Degradation: FAILED');
    console.error(err);
    fs.writeFileSync(sqlitePath, originalContent);
    process.exit(1);
}
