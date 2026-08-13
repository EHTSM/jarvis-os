"use strict";
/**
 * Off-site Export & Encryption Utility.
 * Encrypts the latest snapshot and optionally transfers it off-site.
 *
 * Required env vars:
 *   BACKUP_PASSWORD  — AES-256 passphrase for encryption
 *
 * Optional env vars:
 *   BACKUP_DEST      — transfer destination
 *                      SSH/rsync:  user@host:/path/to/backups
 *                      S3:         s3://bucket-name/prefix
 *                      Leave blank to encrypt locally only (no transfer).
 *
 * Decrypt a backup:
 *   openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:<BACKUP_PASSWORD> \
 *     -in jarvis_full_<ts>.tar.gz.enc -out jarvis_full_<ts>.tar.gz
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '../backups');

function encryptBackup(inputPath, password) {
    const outputPath = inputPath + '.enc';
    console.log(`[+] Encrypting: ${path.basename(inputPath)}...`);
    try {
        execSync(
            `openssl enc -aes-256-cbc -salt -pbkdf2 -pass pass:${password} -in "${inputPath}" -out "${outputPath}"`,
            { stdio: 'pipe' }
        );
        console.log(`[+] Encrypted Archive: ${path.basename(outputPath)}`);
        return outputPath;
    } catch (err) {
        console.error('[!] Encryption failed:', err.message);
        return null;
    }
}

function transferOffsite(encryptedPath, dest) {
    console.log(`[+] Transferring to: ${dest} ...`);
    try {
        if (dest.startsWith('s3://')) {
            execSync(`aws s3 cp "${encryptedPath}" "${dest}/"`, { stdio: 'pipe' });
        } else {
            // SSH / rsync destination (user@host:/path)
            execSync(`rsync -az "${encryptedPath}" "${dest}/"`, { stdio: 'pipe' });
        }
        console.log(`[+] Off-site transfer: OK`);
        return true;
    } catch (err) {
        console.error('[!] Off-site transfer failed:', err.message);
        console.error('    Encrypted backup retained locally:', encryptedPath);
        return false;
    }
}

async function runExport() {
    const password = process.env.BACKUP_PASSWORD;
    if (!password) {
        console.warn('[!] BACKUP_PASSWORD not set — skipping encryption and transfer.');
        console.warn('    Set BACKUP_PASSWORD in .env to enable encrypted off-site backups.');
        return;
    }

    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('jarvis_full_') && !f.endsWith('.enc'))
        .sort((a, b) =>
            fs.statSync(path.join(BACKUP_DIR, b)).mtimeMs -
            fs.statSync(path.join(BACKUP_DIR, a)).mtimeMs
        );

    if (files.length === 0) {
        console.log('[!] No snapshots found to export. Run safe-backup.cjs first.');
        return;
    }

    const latest       = path.join(BACKUP_DIR, files[0]);
    const encryptedPath = encryptBackup(latest, password);
    if (!encryptedPath) return;

    const dest = (process.env.BACKUP_DEST || '').trim();
    if (dest) {
        transferOffsite(encryptedPath, dest);
    } else {
        console.log('[+] BACKUP_DEST not set — encrypted backup stored locally only.');
        console.log(`    Location: ${encryptedPath}`);
    }

    console.log('[+] Export complete.');
}

if (require.main === module) {
    runExport().catch(console.error);
}

module.exports = { encryptBackup, transferOffsite };
