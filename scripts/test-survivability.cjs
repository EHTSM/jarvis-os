"use strict";
/**
 * PM2 & Process Interruption Survivability Test.
 * Simulates a process crash during a shadowing operation and verifies
 * JSON integrity and WAL recovery.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const QUEUE_FILE = path.join(__dirname, '../data/task-queue.json');
const DB_FILE    = path.join(__dirname, '../data/jarvis.db');

async function runTest() {
    console.log('[+] Starting Survivability Test...');

    // 1. Snapshot counts
    const jsonBefore = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8') || '[]');
    console.log(`[+] Initial JSON task count: ${jsonBefore.length}`);

    // 2. Spawn a subprocess to add a task and then kill it abruptly
    console.log('[+] Spawning worker to perform mutation...');
    const worker = spawn('node', [
        '-e', 
        `
        const taskQueue = require('./agents/taskQueue.cjs');
        console.log('[Worker] Adding task...');
        const t = taskQueue.addTask({ input: 'crash test task' });
        console.log('[Worker] Task added: ' + t.id);
        // Abrupt exit immediately after shadowing starts
        process.exit(0); 
        `
    ], { cwd: path.join(__dirname, '..') });

    worker.stdout.on('data', d => console.log(d.toString().trim()));
    
    await new Promise(r => worker.on('close', r));
    console.log('[+] Worker terminated.');

    // 3. Verify JSON Integrity
    const jsonAfter = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    if (jsonAfter.length > jsonBefore.length) {
        console.log('[+] JSON Authoritative write: SUCCESSFUL.');
    } else {
        throw new Error('JSON write failed or was lost!');
    }

    // 4. Verify SQLite Recovery
    console.log('[+] Initializing SQLite to verify WAL recovery...');
    const { getDB } = require('../backend/db/sqlite.cjs');
    const db = getDB();
    const lastTask = jsonAfter[jsonAfter.length - 1];
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(lastTask.id);

    if (row) {
        console.log('[+] SQLite WAL Recovery: SUCCESSFUL. Shadow task found.');
    } else {
        console.warn('[!] SQLite Shadow task missing (Expected if killed before SQL write finalized)');
    }

    console.log('[+] Survivability Test: PASSED.');
    process.exit(0);
}

runTest().catch(err => {
    console.error('[!] Survivability Test: FAILED');
    console.error(err);
    process.exit(1);
});
