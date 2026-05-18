const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'test-sqlite.db');

try {
  console.log('[+] Initializing test database at:', dbPath);
  const db = new Database(dbPath, { verbose: console.log });

  console.log('[+] Enabling WAL mode...');
  db.pragma('journal_mode = WAL');
  const mode = db.pragma('journal_mode')[0].journal_mode;
  console.log('[+] Journal mode is:', mode);

  if (mode !== 'wal') {
    throw new Error('Failed to enable WAL mode');
  }

  console.log('[+] Creating test table...');
  db.prepare('CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, val TEXT)').run();
  
  console.log('[+] Inserting test data...');
  db.prepare('INSERT INTO test (val) VALUES (?)').run('persistence_check');

  console.log('[+] Querying test data...');
  const row = db.prepare('SELECT * FROM test WHERE val = ?').get('persistence_check');
  console.log('[+] Result:', row);

  if (!row || row.val !== 'persistence_check') {
    throw new Error('Data integrity check failed');
  }

  db.close();
  console.log('[+] Database closed successfully.');

  // Check for -wal and -shm files
  if (fs.existsSync(dbPath + '-wal')) {
    console.log('[+] WAL file exists as expected.');
  }

  process.exit(0);
} catch (err) {
  console.error('[!] SQLite Toolchain Validation Failed:');
  console.error(err);
  process.exit(1);
}
