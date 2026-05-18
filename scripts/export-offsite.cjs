"use strict";
/**
 * Off-site Export & Encryption Utility.
 * Encrypts a full snapshot for safe off-site storage.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '../backups');

function encryptBackup(inputPath, password) {
    const outputPath = inputPath + '.enc';
    console.log(`[+] Encrypting: ${path.basename(inputPath)}...`);
    
    // Using OpenSSL for simple, standard AES-256 encryption.
    // This ensures the backup is portable and can be decrypted on any machine.
    try {
        execSync(`openssl enc -aes-256-cbc -salt -pbkdf2 -pass pass:${password} -in "${inputPath}" -out "${outputPath}"`);
        console.log(`[+] Encrypted Archive: ${path.basename(outputPath)}`);
        return outputPath;
    } catch (err) {
        console.error('[!] Encryption failed:', err.message);
        return null;
    }
}

async function runExport() {
    const password = process.env.BACKUP_PASSWORD;
    if (!password) {
        console.warn('[!] BACKUP_PASSWORD not set in .env. Skipping encryption.');
        return;
    }

    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('jarvis_full_') && !f.endsWith('.enc'))
        .sort((a, b) => fs.statSync(path.join(BACKUP_DIR, b)).mtimeMs - fs.statSync(path.join(BACKUP_DIR, a)).mtimeMs);

    if (files.length === 0) {
        console.log('[!] No snapshots found to export.');
        return;
    }

    const latest = path.join(BACKUP_DIR, files[0]);
    encryptBackup(latest, password);
    console.log('[+] Export Ready.');
}

if (require.main === module) {
    runExport().catch(console.error);
}

module.exports = { encryptBackup };
