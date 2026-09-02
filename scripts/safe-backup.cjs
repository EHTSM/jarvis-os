"use strict";
/**
 * Safe Snapshot & Backup Utility.
 * Performs a consistent backup of JSON and SQLite persistence.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const APP_DIR    = path.join(__dirname, '..');
const DATA_DIR   = path.join(APP_DIR, 'data');
const BACKUP_DIR = path.join(APP_DIR, 'backups');
const TIMESTAMP  = new Date().toISOString().replace(/[:.]/g, '-');
const SNAP_DIR   = path.join(BACKUP_DIR, `snapshot_${TIMESTAMP}`);

function _sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function runBackup() {
    console.log('[+] Starting Safe Snapshot...');
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);
    fs.mkdirSync(SNAP_DIR);

    // DR/Backup mission: a backup was previously considered "complete" the
    // moment each step logged "OK", with no record of exactly which files
    // actually landed in the snapshot, their size, or a hash — silent
    // truncation/corruption of one file mid-backup would never be caught
    // until (or unless) a real restore was attempted. `captured` tracks
    // every real file this run actually wrote into SNAP_DIR, so a manifest
    // can be generated after compression that a restore/verification step
    // can check against, per this mission's own "CREATE → HASH → STORE →
    // VERIFY → RECORD MANIFEST" requirement.
    const captured = []; // { name, bytes, sha256 }
    function _recordCapture(name) {
        const p = path.join(SNAP_DIR, name);
        captured.push({ name, bytes: fs.statSync(p).size, sha256: _sha256(p) });
    }

    // 1. .env is intentionally NOT backed up — it contains live secrets.
    // Restore procedure: provision .env separately via secrets manager / secure channel.
    // Only non-secret config keys are recorded for reference.
    const envPath = path.join(APP_DIR, '.env');
    if (fs.existsSync(envPath)) {
        const NON_SECRET_KEYS = ['PORT','NODE_ENV','BASE_URL','APP_URL','ALLOWED_ORIGINS',
            'LLM_PROVIDER','WA_API_VERSION','WA_BUSINESS_ACCOUNT_ID','REACT_APP_API_URL',
            'DISABLE_X_POWERED_BY','COOKIE_DOMAIN','N8N_URL','LOG_LEVEL'];
        const lines = fs.readFileSync(envPath, 'utf8').split('\n');
        const safe  = lines.filter(l => {
            const key = l.split('=')[0].replace(/^#\s*/, '');
            return l.startsWith('#') || l.trim() === '' || NON_SECRET_KEYS.includes(key);
        });
        fs.writeFileSync(path.join(SNAP_DIR, 'env-config-nonsecret.txt'),
            '# Non-secret config keys only — secrets intentionally excluded\n' + safe.join('\n'));
        _recordCapture('env-config-nonsecret.txt');
        console.log('[+] env config (non-secret only): OK');
    }

    // 2. Snapshot JSON Task Queue (Authority)
    const jsonQueue = path.join(DATA_DIR, 'task-queue.json');
    if (fs.existsSync(jsonQueue)) {
        fs.copyFileSync(jsonQueue, path.join(SNAP_DIR, 'task-queue.json'));
        _recordCapture('task-queue.json');
        console.log('[+] JSON Queue snapshot: OK');
    }


    // 2b. M6/M6b state files — Critical for beta operations (added RC-1)
    const M6_STATE_FILES = [
        "m6-auth-tokens.json",
        "m6-beta-state.json",
        "co3-user-success.json",
        "m6b-closed-beta.json",
        "m6b-billing-ext.json",
        "billing.json",
        "local-accounts.json",
        "version.json",
        "capability-registry.json",
    ];
    for (const f of M6_STATE_FILES) {
        const fPath = path.join(DATA_DIR, f);
        if (fs.existsSync(fPath)) {
            fs.copyFileSync(fPath, path.join(SNAP_DIR, f));
            _recordCapture(f);
            console.log(`[+] ${f}: OK`);
        }
    }

    // 2c. Vault index (secrets encrypted — safe to backup)
    const vaultIndex = path.join(DATA_DIR, "vault-index.json");
    if (fs.existsSync(vaultIndex)) {
        fs.copyFileSync(vaultIndex, path.join(SNAP_DIR, "vault-index.json"));
        _recordCapture('vault-index.json');
        console.log("[+] vault-index.json: OK");
    }

    // 2d. Core business stores — Phase B.5 DR validation.
    // These were absent from every jarvis_full_* archive, so the nightly
    // automated backup (cron 03:00 / PM2 02:00, both invoking THIS script)
    // captured no CRM, no organizations, no missions, no memory and no
    // secret vault. DISASTER_RECOVERY.md line 22 explicitly promises "CRM
    // leads, task history, learning/memory data" are recoverable, and
    // deploy/rollback.sh restores from the newest jarvis_* archive — which
    // is always one of these — so a real restore silently dropped the
    // entire customer dataset. Verified by reading data/: this content lives
    // ONLY in these JSON files (jarvis.db holds just the `tasks` table), so
    // nothing here is redundant with the SQLite snapshot below.
    // vault.json holds AES-256-GCM ciphertext (key = SHA-256(JWT_SECRET),
    // which lives in .env and is deliberately NOT backed up), so including
    // it stores no usable plaintext secret.
    const CORE_BUSINESS_FILES = [
        "leads.json",             // CRM — customer records
        "organizations.json",     // orgs, memberships, RBAC roles
        "missions.json",          // mission store / task history
        "memory-store.json",      // learning + memory data
        "product-plans.json",     // Product OS
        "vault.json",             // encrypted connector credentials
        "fdios-state.json",       // declared critical in rc1-manifest.json
        "org-context.json",       // active org/workspace resolution
    ];
    for (const f of CORE_BUSINESS_FILES) {
        const fPath = path.join(DATA_DIR, f);
        if (fs.existsSync(fPath)) {
            fs.copyFileSync(fPath, path.join(SNAP_DIR, f));
            _recordCapture(f);
            console.log(`[+] ${f}: OK`);
        }
    }

    // 2e. Business OS stores — DR/Backup mission (MISSION 77) finding.
    // The same defect class the Phase B.5 fix above already found once
    // for the OLDER CRM/business layer (leads.json/organizations.json/
    // missions.json) was never caught for the NEWER Business-OS layer
    // businessDataService.cjs actually writes to: real, accumulating,
    // customer-facing lead/contact/opportunity/campaign/revenue records
    // in biz-*.json, plus revenueOS.cjs's own invoice/subscription state
    // (revenue-os.json) and the agent execution history/registry — all had
    // ZERO backup coverage. Confirmed by direct inspection of
    // businessDataService.cjs's own F_LEADS/F_CONTACTS/F_OPPS/F_CAMPS/F_REV
    // constants and revenueOS.cjs's DATA_FILE constant — these are the
    // real, current file names each service writes to, not a guess.
    // Verified live: biz-leads.json/biz-revenue.json/biz-opportunities.json
    // each held real accumulated records (hundreds of KB), not empty
    // scaffolding, at the time this gap was found.
    const BUSINESS_OS_FILES = [
        "biz-leads.json",          // Business OS — CRM leads (businessDataService.cjs)
        "biz-contacts.json",       // Business OS — contacts
        "biz-opportunities.json",  // Business OS — sales pipeline / deals
        "biz-campaigns.json",      // Business OS — marketing campaigns
        "biz-revenue.json",        // Business OS — revenue records
        "biz-events.json",         // Business OS — event log feeding the above
        "revenue-os.json",         // revenueOS.cjs — invoices/subscriptions/commissions
        "agent-registry.json",     // live agent definitions
        "agent-runs.json",         // agent execution history / audit trail
    ];
    for (const f of BUSINESS_OS_FILES) {
        const fPath = path.join(DATA_DIR, f);
        if (fs.existsSync(fPath)) {
            fs.copyFileSync(fPath, path.join(SNAP_DIR, f));
            _recordCapture(f);
            console.log(`[+] ${f}: OK`);
        }
    }

    // 3. Safe SQLite Backup (Using VACUUM INTO)
    const dbPath = path.join(DATA_DIR, 'jarvis.db');
    if (fs.existsSync(dbPath)) {
        try {
            const Database = require('better-sqlite3');
            const db = new Database(dbPath, { readonly: true });
            const backupFile = path.join(SNAP_DIR, 'jarvis.db');

            // VACUUM INTO creates a consistent, single-file copy without WAL/SHM side-files.
            // This is the safest way to backup an active SQLite DB.
            db.prepare(`VACUUM INTO '${backupFile}'`).run();
            db.close();
            _recordCapture('jarvis.db');
            console.log('[+] SQLite Snapshot (Consistent): OK');
        } catch (err) {
            console.warn('[!] SQLite online backup failed, falling back to raw copy:', err.message);
            fs.copyFileSync(dbPath, path.join(SNAP_DIR, 'jarvis.db.raw'));
            _recordCapture('jarvis.db.raw');
        }
    }

    // 4. Compress Snapshot
    // DR/Backup mission: this step (and step 5) previously only ever
    // logged an error and let runBackup() fall through to "Backup Cycle
    // Complete" and exit 0 regardless — a tar failure (missing binary,
    // disk full, permission error) was indistinguishable from success to
    // PM2's cron_restart or a human running `npm run backup`. archiveOk
    // tracks whether the one artifact a restore actually depends on was
    // genuinely produced; the script's final exit code now reflects it.
    const archive = path.join(BACKUP_DIR, `jarvis_full_${TIMESTAMP}.tar.gz`);
    let archiveOk = false;
    try {
        execSync(`tar -czf "${archive}" -C "${BACKUP_DIR}" "snapshot_${TIMESTAMP}"`);
        if (!fs.existsSync(archive) || fs.statSync(archive).size === 0) {
            throw new Error('tar reported success but produced no archive / a zero-byte archive');
        }
        archiveOk = true;
        console.log(`[+] Full Snapshot Archived: ${archive}`);

        // DR/Backup mission: record exactly what this run captured — file
        // names, sizes, and per-file SHA-256 — plus the final archive's own
        // hash, so a restore or verification step can prove the archive it
        // is about to trust actually contains what this run believes it
        // does, per this mission's "a backup must not be considered valid
        // merely because an upload/compression step returned success" rule.
        // Written as a SIBLING of the archive (not inside SNAP_DIR) so
        // test-restore.cjs's "restore every file the snapshot carries" loop
        // never has to know about or skip it.
        const manifest = {
            createdAt: new Date().toISOString(),
            archive: path.basename(archive),
            archiveBytes: fs.statSync(archive).size,
            archiveSha256: _sha256(archive),
            fileCount: captured.length,
            files: captured,
        };
        const manifestPath = archive.replace(/\.tar\.gz$/, '.manifest.json');
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        console.log(`[+] Manifest written: ${path.basename(manifestPath)} (${captured.length} file(s), archive sha256=${manifest.archiveSha256.slice(0, 12)}...)`);

        // Cleanup temp dir
        execSync(`rm -rf "${SNAP_DIR}"`);
    } catch (err) {
        console.error('[!] Compression failed:', err.message);
    }

    // 5. Retention Logic (Keep last 7)
    // Only prune when this run's own archive is confirmed good — otherwise
    // a failed backup could prune a real, working prior generation while
    // leaving nothing valid behind, which is strictly worse than a full
    // backups/ directory.
    if (archiveOk) {
        try {
            const files = fs.readdirSync(BACKUP_DIR)
                .filter(f => f.startsWith('jarvis_full_') && f.endsWith('.tar.gz'))
                .sort((a, b) => fs.statSync(path.join(BACKUP_DIR, b)).mtimeMs - fs.statSync(path.join(BACKUP_DIR, a)).mtimeMs);

            if (files.length > 7) {
                files.slice(7).forEach(f => {
                    fs.unlinkSync(path.join(BACKUP_DIR, f));
                    // The manifest is a small, independently useful audit
                    // record (what a given generation contained) — remove it
                    // alongside its archive so retention doesn't leave
                    // manifests for archives that no longer exist.
                    const mf = path.join(BACKUP_DIR, f.replace(/\.tar\.gz$/, '.manifest.json'));
                    if (fs.existsSync(mf)) fs.unlinkSync(mf);
                    console.log(`[+] Pruned old backup: ${f}`);
                });
            }
        } catch (err) {
            console.warn('[!] Retention pruning failed:', err.message);
        }
    } else {
        console.warn('[!] Skipping retention pruning — this run\'s own archive was not confirmed good.');
    }

    console.log(archiveOk ? '[+] Backup Cycle Complete.' : '[!] Backup Cycle FAILED — no valid archive produced this run.');

    // 6. Offsite export (encrypt + optionally transfer). Runs in the same
    // cron cycle as the local snapshot above so a forgotten second cron
    // entry can't silently leave backups local-only. No-ops cleanly (with a
    // console warning) when BACKUP_PASSWORD isn't set — see export-offsite.cjs.
    // Only attempted when this run actually produced something to export —
    // exporting a STALE prior archive while silently reporting this run
    // failed would look like this run's own backup succeeded offsite.
    let offsiteFailed = false;
    if (archiveOk) {
        try {
            const { runExport } = require('./export-offsite.cjs');
            const result = await runExport();
            if (result && result.transferred && !result.ok) {
                offsiteFailed = true;
                console.error('[!] Offsite transfer FAILED — encrypted backup retained locally only:', result.encryptedPath);
            }
        } catch (err) {
            offsiteFailed = true;
            console.error('[!] Offsite export step failed:', err.message);
        }
    }

    // DR/Backup mission: propagate real failure to the caller. A local
    // archive failure is always fatal (nothing to restore from). An offsite
    // transfer failure is reported but does NOT fail the run — the
    // encrypted backup is still retained locally (export-offsite.cjs's own
    // guarantee), which is a genuine partial success, not a total one; a
    // future mission wiring real alerting can distinguish the two exit
    // paths if that granularity is ever needed.
    if (!archiveOk) process.exitCode = 1;
    return { archiveOk, offsiteFailed, manifestFileCount: captured.length };
}

/**
 * verifyManifest(archivePath): DR/Backup mission — the VERIFY step of
 * CREATE → HASH → STORE → VERIFY → RECORD MANIFEST. Extracts the given
 * archive to a scratch temp directory, checks every file the manifest
 * claims to contain actually exists, is non-empty, and matches its
 * recorded SHA-256, then reports mismatches instead of trusting the
 * archive's mere existence. Read-only with respect to data/ and the
 * archive itself — extracts to a disposable tmp dir it always cleans up.
 *
 * @returns {{ ok, manifestFound, fileCount, mismatches: string[] }}
 */
function verifyManifest(archivePath) {
    const manifestPath = archivePath.replace(/\.tar\.gz$/, '.manifest.json');
    if (!fs.existsSync(manifestPath)) {
        return { ok: false, manifestFound: false, fileCount: 0, mismatches: ['no manifest found for this archive'] };
    }
    if (!fs.existsSync(archivePath)) {
        return { ok: false, manifestFound: true, fileCount: 0, mismatches: ['archive file does not exist'] };
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const mismatches = [];

    if (_sha256(archivePath) !== manifest.archiveSha256) {
        mismatches.push('archive sha256 does not match the manifest — the archive changed since it was created');
    }

    const tmp = fs.mkdtempSync(path.join(BACKUP_DIR, 'verify_tmp_'));
    try {
        execSync(`tar -xzf "${archivePath}" -C "${tmp}"`);
        const snapDirName = fs.readdirSync(tmp)[0];
        const snapPath = snapDirName ? path.join(tmp, snapDirName) : null;
        for (const f of manifest.files || []) {
            const p = snapPath ? path.join(snapPath, f.name) : null;
            if (!p || !fs.existsSync(p)) { mismatches.push(`${f.name}: missing from archive`); continue; }
            const size = fs.statSync(p).size;
            if (size !== f.bytes) { mismatches.push(`${f.name}: size changed (manifest=${f.bytes}, actual=${size})`); continue; }
            if (_sha256(p) !== f.sha256) { mismatches.push(`${f.name}: sha256 mismatch — content differs from what was backed up`); }
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }

    return { ok: mismatches.length === 0, manifestFound: true, fileCount: (manifest.files || []).length, mismatches };
}

if (require.main === module) {
    runBackup().catch(err => {
        console.error('[!] Backup run threw an unhandled error:', err.message);
        process.exitCode = 1;
    });
}

module.exports = { runBackup, verifyManifest };
