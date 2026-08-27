"use strict";
/**
 * Off-site Export & Encryption Utility.
 * Encrypts the latest snapshot and optionally transfers it off-site.
 *
 * Required env vars:
 *   BACKUP_PASSWORD  — AES-256 passphrase for encryption
 *
 * Optional env vars:
 *   BACKUP_OFFSITE_DIR — transfer destination (primary name; documented in
 *                      ecosystem.config.cjs's ooplix-backup job comment since
 *                      before this script existed).
 *   BACKUP_DEST      — alias for BACKUP_OFFSITE_DIR (this script's original
 *                      name; kept working for anyone who already set it).
 *                      Either accepts:
 *                      SSH/rsync:  user@host:/path/to/backups
 *                      S3:         s3://bucket-name/prefix
 *                      Local/scratch dir (no ':' or 's3://'): plain cp, for
 *                      environments with no SSH/S3 destination yet.
 *                      Leave both blank to encrypt locally only (no transfer).
 *
 * Decrypt a backup:
 *   openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:<BACKUP_PASSWORD> \
 *     -in jarvis_full_<ts>.tar.gz.enc -out jarvis_full_<ts>.tar.gz
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
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

function _sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Copies encryptedPath to dest (S3, rsync/SSH, or a plain local/scratch
 * directory), then verifies the transfer actually landed — a silent
 * rsync/cp failure must never be reported as a successful offsite backup.
 */
function transferOffsite(encryptedPath, dest) {
    console.log(`[+] Transferring to: ${dest} ...`);
    const localSize = fs.statSync(encryptedPath).size;
    const localHash = _sha256(encryptedPath);
    const baseName  = path.basename(encryptedPath);

    try {
        if (dest.startsWith('s3://')) {
            execSync(`aws s3 cp "${encryptedPath}" "${dest}/"`, { stdio: 'pipe' });
            // Verify via `aws s3api head-object` size compare — never trust exit code alone.
            const key = `${dest.replace(/^s3:\/\/[^/]+\//, '').replace(/\/$/, '')}/${baseName}`;
            const bucket = dest.replace(/^s3:\/\//, '').split('/')[0];
            const head = execSync(`aws s3api head-object --bucket "${bucket}" --key "${key}"`, { stdio: 'pipe' }).toString();
            const remoteSize = JSON.parse(head).ContentLength;
            if (remoteSize !== localSize) {
                throw new Error(`size mismatch after transfer: local=${localSize} remote=${remoteSize}`);
            }
        } else if (dest.includes(':') && !path.isAbsolute(dest)) {
            // SSH / rsync destination (user@host:/path) — real remote host.
            execSync(`rsync -az --checksum "${encryptedPath}" "${dest}/"`, { stdio: 'pipe' });
            // rsync --checksum already verifies content on transfer; additionally
            // confirm the remote file is listed with the expected size via `rsync --dry-run --itemize-changes`
            // reporting no pending change (i.e. remote already matches).
            const check = execSync(`rsync -az --checksum --dry-run --itemize-changes "${encryptedPath}" "${dest}/"`, { stdio: 'pipe' }).toString();
            if (check.trim().length > 0) {
                throw new Error(`post-transfer verification found remote out of sync: ${check.trim().slice(0, 200)}`);
            }
        } else {
            // Plain local/scratch destination — used for on-prem secondary disks,
            // mounted network shares, or test/scratch paths. No new transport
            // invented: this is a direct filesystem copy, same trust level as
            // the tar.gz archive step already in safe-backup.cjs.
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            const destFile = path.join(dest, baseName);
            fs.copyFileSync(encryptedPath, destFile);
            const remoteSize = fs.statSync(destFile).size;
            const remoteHash = _sha256(destFile);
            if (remoteSize !== localSize || remoteHash !== localHash) {
                throw new Error(`verification failed after local copy: size ${localSize}->${remoteSize}, hash mismatch=${remoteHash !== localHash}`);
            }
        }
        console.log(`[+] Off-site transfer: OK (verified, sha256=${localHash.slice(0, 12)}...)`);
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

    const dest = (process.env.BACKUP_OFFSITE_DIR || process.env.BACKUP_DEST || '').trim();
    if (!dest) {
        console.log('[+] BACKUP_OFFSITE_DIR (or BACKUP_DEST) not set — encrypted backup stored locally only.');
        console.log(`    Location: ${encryptedPath}`);
        console.log('[+] Export complete.');
        return { transferred: false, ok: true, encryptedPath };
    }

    const ok = transferOffsite(encryptedPath, dest);
    console.log('[+] Export complete.');
    // Caller decides what a failed transfer means for its own exit code —
    // this module must not set process.exitCode itself, since safe-backup.cjs
    // require()s runExport() as a step within its own run, and a failed
    // *offsite* copy must not be reported as a failed *local* backup.
    return { transferred: true, ok, encryptedPath };
}

if (require.main === module) {
    runExport().then(result => {
        if (result && result.ok === false) process.exitCode = 1;
    }).catch(err => { console.error(err); process.exitCode = 1; });
}

module.exports = { encryptBackup, transferOffsite, runExport };
