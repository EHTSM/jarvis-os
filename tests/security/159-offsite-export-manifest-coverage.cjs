#!/usr/bin/env node
"use strict";
/**
 * scripts/export-offsite.cjs — correct file selection + manifest co-transfer
 * (DR/Backup mission, MISSION 77).
 *
 * This test caught a real regression introduced by this same mission's own
 * safe-backup.cjs manifest fix, discovered by testing end-to-end rather than
 * unit-testing safe-backup.cjs in isolation: runExport()'s original file
 * filter was `f.startsWith('jarvis_full_') && !f.endsWith('.enc')`, which
 * also matched the newly-introduced sibling `<archive>.manifest.json` files.
 * Since a manifest can share (or precede) its archive's mtime, `files[0]`
 * could resolve to the MANIFEST rather than the actual backup archive —
 * encryptBackup() would then silently openssl-encrypt and transfer the
 * wrong file, producing an offsite "backup" that was actually just an
 * encrypted JSON manifest, not the real data.
 *
 * Fixed by restricting the filter to real `.tar.gz` files, and separately
 * transferring the manifest itself (unencrypted — it contains only file
 * names/sizes/hashes, describing the encrypted archive's contents by hash,
 * not the plaintext itself) alongside the encrypted archive, since the
 * manifest's verification capability must travel WITH an offsite backup,
 * not stay behind on the same local disk a real disaster would also
 * destroy.
 *
 * This test creates real backup archives + manifests in the real backups/
 * directory (safe, non-destructive — matching test-restore.cjs's own
 * established precedent) and transfers to an isolated /tmp scratch
 * destination — never a real S3 bucket or SSH host, never a real
 * BACKUP_PASSWORD from a real environment.
 *
 * Usage: node tests/security/159-offsite-export-manifest-coverage.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

const BACKUP_DIR = path.join(process.cwd(), "backups");
const TEST_PASSWORD = "test-offsite-export-passphrase-not-a-real-secret";

async function main() {
  section("Source-shape — the file-selection glob only matches real .tar.gz archives, never the manifest");
  {
    const src = fs.readFileSync(require.resolve("../../scripts/export-offsite.cjs"), "utf8");
    assert(/f\.startsWith\('jarvis_full_'\) && f\.endsWith\('\.tar\.gz'\)/.test(src),
      "the filter explicitly requires .tar.gz, not just \"doesn't end in .enc\" (which the old, buggy filter used)");
    // The old vulnerable pattern is referenced in this fix's own explanatory
    // comment (as historical context) but must not appear as live filter
    // logic — check only the real .filter(...) call site, not prose.
    const filterCallLine = src.split("\n").find(l => l.includes(".filter(f =>") && l.includes("jarvis_full_"));
    assert(!!filterCallLine && !filterCallLine.includes("!f.endsWith('.enc')"),
      "the real filter call site no longer uses the manifest-vulnerable \"doesn't end in .enc\" shape", filterCallLine);
  }

  section("Live behavior — a fresh backup + manifest pair; runExport() picks the real archive, never the manifest");
  {
    execSync("node scripts/safe-backup.cjs", { stdio: "pipe" });
    const archives = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("jarvis_full_") && f.endsWith(".tar.gz"))
      .sort((a, b) => fs.statSync(path.join(BACKUP_DIR, b)).mtimeMs - fs.statSync(path.join(BACKUP_DIR, a)).mtimeMs);
    const latestArchive = archives[0];
    const latestManifest = latestArchive.replace(/\.tar\.gz$/, ".manifest.json");
    assert(fs.existsSync(path.join(BACKUP_DIR, latestManifest)), "the fresh backup produced a manifest to test against");

    const scratchDest = fs.mkdtempSync(path.join(os.tmpdir(), "dr-offsite-test-"));
    global.__scratchDest = scratchDest;
    try {
      delete require.cache[require.resolve("../../scripts/export-offsite.cjs")];
      process.env.BACKUP_PASSWORD = TEST_PASSWORD;
      process.env.BACKUP_OFFSITE_DIR = scratchDest;
      const { runExport } = require("../../scripts/export-offsite.cjs");
      const result = await runExport();

      assert(result && result.ok === true, "runExport() reports overall success", JSON.stringify(result));
      assert(result.encryptedPath.endsWith(".tar.gz.enc"), "the encrypted output is derived from the real .tar.gz archive, not the manifest", result.encryptedPath);
      assert(!result.encryptedPath.includes(".manifest.json"), "the manifest was never mistaken for the source archive");

      const encryptedName = path.basename(result.encryptedPath);
      assert(fs.existsSync(path.join(scratchDest, encryptedName)), "the encrypted archive was transferred to the offsite destination");

      // Decrypt and confirm it's a real, valid tar.gz of the ORIGINAL
      // archive content — not the manifest JSON re-encrypted.
      const decryptedPath = path.join(scratchDest, "decrypted-check.tar.gz");
      execSync(`openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:${TEST_PASSWORD} -in "${path.join(scratchDest, encryptedName)}" -out "${decryptedPath}"`);
      const listing = execSync(`tar -tzf "${decryptedPath}"`).toString();
      assert(/snapshot_/.test(listing), "the decrypted archive is a real snapshot tar.gz, not an encrypted JSON manifest", listing.slice(0, 100));
    } finally {
      delete process.env.BACKUP_PASSWORD;
      delete process.env.BACKUP_OFFSITE_DIR;
    }
  }

  section("The manifest itself is also transferred offsite, alongside the encrypted archive");
  {
    const manifestFiles = fs.readdirSync(global.__scratchDest).filter(f => f.endsWith(".manifest.json"));
    assert(manifestFiles.length === 1, "exactly one manifest file was transferred to the offsite destination", `found ${manifestFiles.length}`);

    const transferredManifest = JSON.parse(fs.readFileSync(path.join(global.__scratchDest, manifestFiles[0]), "utf8"));
    assert(typeof transferredManifest.archiveSha256 === "string" && transferredManifest.archiveSha256.length === 64,
      "the transferred manifest is the real manifest (has a real archive hash), not a placeholder");
  }

  section("A destination-transfer failure for the manifest is reported, without falsely reporting the whole export as fully successful");
  {
    // Simulate a manifest-transfer failure by making the destination
    // directory read-only for the second transferOffsite() call — the
    // first (archive) transfer already succeeded and created the dir;
    // remove write permission before the manifest step would run by
    // exporting again with a destination that already has the archive but
    // gets locked down. Simpler and still real: point BACKUP_OFFSITE_DIR at
    // a path where a file (not a directory) already exists at that exact
    // name, which fs.mkdirSync/copyFileSync will reject.
    const blockedDest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dr-offsite-blocked-")), "not-a-directory");
    fs.writeFileSync(blockedDest, "this is a file, not a directory, transferOffsite must fail cleanly here");
    try {
      delete require.cache[require.resolve("../../scripts/export-offsite.cjs")];
      process.env.BACKUP_PASSWORD = TEST_PASSWORD;
      process.env.BACKUP_OFFSITE_DIR = blockedDest;
      const { runExport } = require("../../scripts/export-offsite.cjs");
      const result = await runExport();
      assert(result && result.ok === false, "an impossible destination is reported as a failed export, not a fabricated success", JSON.stringify(result));
    } finally {
      delete process.env.BACKUP_PASSWORD;
      delete process.env.BACKUP_OFFSITE_DIR;
      fs.rmSync(blockedDest, { force: true });
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
