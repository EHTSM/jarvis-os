#!/usr/bin/env node
"use strict";
/**
 * scripts/safe-backup.cjs — manifest generation + integrity verification
 * (DR/Backup mission, MISSION 77).
 *
 * Discovery found the nightly backup pipeline (scripts/safe-backup.cjs,
 * PM2 cron_restart at 02:00, package.json's "backup" script's simpler
 * sibling backup.sh) never recorded WHAT it actually captured — no
 * manifest, no per-file hash, no archive-level hash. A backup was
 * considered "complete" the moment each copy step logged "OK", with
 * nothing to catch silent truncation/corruption before a real restore was
 * attempted. Separately, every failure path (tar failure, zero-byte
 * archive) was only ever logged, never propagated as a real exit code —
 * PM2's cron_restart and `npm run backup` could not distinguish a
 * genuinely failed backup from a successful one.
 *
 * Fixed by: recording every real captured file's name/size/sha256 during
 * the run, writing a sibling `<archive>.manifest.json` (never inside the
 * snapshot itself, so test-restore.cjs's "restore everything the snapshot
 * carries" loop never has to know about it), adding a real archive-exists/
 * non-empty check before declaring success, gating retention pruning and
 * the offsite export on that real success, and setting process.exitCode=1
 * on genuine failure. A new verifyManifest(archivePath) function performs
 * the actual CREATE → HASH → STORE → VERIFY flow this mission requires:
 * extract to a disposable scratch dir, compare every file's real hash
 * against what the manifest recorded, and report mismatches.
 *
 * This test runs the REAL backup script against this repo's real data/
 * directory — matching test-restore.cjs's own established precedent
 * (which already does exactly this as its own first step) — since
 * safe-backup.cjs only ever READS data/ and WRITES to backups/, never
 * modifying or deleting real application data. No destructive operation,
 * no production restore, no real credential touched.
 *
 * Usage: node tests/security/158-backup-manifest-integrity.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

const BACKUP_DIR = path.join(process.cwd(), "backups");

async function main() {
  const { verifyManifest } = require("../../scripts/safe-backup.cjs");

  section("Real backup run produces a manifest alongside the archive");
  {
    const before = new Set(fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("jarvis_full_") && f.endsWith(".tar.gz")));
    execSync("node scripts/safe-backup.cjs", { stdio: "pipe" });
    const after = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("jarvis_full_") && f.endsWith(".tar.gz"));
    const newArchive = after.find(f => !before.has(f));
    assert(!!newArchive, "a new archive was created by this run", `before=${before.size}, after=${after.length}`);

    const manifestPath = path.join(BACKUP_DIR, newArchive.replace(/\.tar\.gz$/, ".manifest.json"));
    assert(fs.existsSync(manifestPath), "a sibling manifest file exists for the new archive", manifestPath);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert(typeof manifest.archiveSha256 === "string" && manifest.archiveSha256.length === 64, "the manifest records a real SHA-256 hash of the archive itself");
    assert(Array.isArray(manifest.files) && manifest.files.length > 0, "the manifest lists at least one captured file", `got ${manifest.files?.length}`);
    assert(manifest.files.every(f => typeof f.sha256 === "string" && f.sha256.length === 64 && typeof f.bytes === "number"),
      "every listed file has a real sha256 and a real byte size, not a placeholder");

    global.__newArchivePath = path.join(BACKUP_DIR, newArchive);
    global.__manifestPath = manifestPath;
  }

  section("verifyManifest() confirms a genuine, untampered archive matches its own manifest");
  {
    const result = verifyManifest(global.__newArchivePath);
    assert(result.ok === true, "a real, untampered archive verifies as ok:true", JSON.stringify(result));
    assert(result.manifestFound === true, "the manifest was found");
    assert(result.mismatches.length === 0, "zero mismatches for a genuine archive");
  }

  section("verifyManifest() detects a corrupted/tampered archive (byte-level append)");
  {
    // verifyManifest() derives the manifest path as
    // archivePath.replace(/\.tar\.gz$/, '.manifest.json') — the temp
    // archive's own name must still end in .tar.gz for that derivation to
    // find the copied-alongside manifest.
    const tmpArchive = global.__newArchivePath.replace(/\.tar\.gz$/, ".corrupttest.tar.gz");
    const tmpManifest = tmpArchive.replace(/\.tar\.gz$/, ".manifest.json");
    fs.copyFileSync(global.__newArchivePath, tmpArchive);
    fs.appendFileSync(tmpArchive, "tampered-bytes-appended-by-test");
    fs.copyFileSync(global.__manifestPath, tmpManifest);
    try {
      const result = verifyManifest(tmpArchive);
      assert(result.ok === false, "a tampered archive is detected as NOT ok", JSON.stringify(result));
      assert(result.mismatches.some(m => /sha256/.test(m)), "the mismatch explicitly names a sha256 discrepancy, not a generic failure", JSON.stringify(result.mismatches));
    } finally {
      fs.rmSync(tmpArchive, { force: true });
      fs.rmSync(tmpManifest, { force: true });
    }
  }

  section("verifyManifest() detects a missing manifest honestly, never fabricating ok:true");
  {
    const result = verifyManifest(path.join(BACKUP_DIR, "definitely-does-not-exist-12345.tar.gz"));
    assert(result.ok === false, "a nonexistent archive/manifest pair is never reported as ok");
    assert(result.manifestFound === false, "manifestFound is honestly false");
  }

  section("Retention pruning removes the manifest alongside its pruned archive (no orphaned manifests)");
  {
    const archivesBefore = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("jarvis_full_") && f.endsWith(".tar.gz"));
    const manifestsBefore = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("jarvis_full_") && f.endsWith(".manifest.json"));
    // Every real archive still present must either have no manifest (pre-fix
    // generations, created before this mission) or a manifest that isn't
    // orphaned relative to a DELETED archive — i.e. no manifest exists for
    // an archive that is no longer present.
    const archiveBaseNames = new Set(archivesBefore.map(f => f.replace(/\.tar\.gz$/, "")));
    const orphaned = manifestsBefore.filter(m => !archiveBaseNames.has(m.replace(/\.manifest\.json$/, "")));
    assert(orphaned.length === 0, "no manifest exists for an archive that retention already deleted", JSON.stringify(orphaned));
  }

  section("Source-shape — safe-backup.cjs propagates real failure via process.exitCode, not just logging");
  {
    const src = fs.readFileSync(require.resolve("../../scripts/safe-backup.cjs"), "utf8");
    assert(/process\.exitCode = 1/.test(src), "the script sets process.exitCode = 1 on a genuine failure path, not just console.error");
    assert(/if \(!archiveOk\) process\.exitCode = 1;/.test(src), "exit code is tied to the real archiveOk flag, not fabricated");
    assert(/require\.main === module/.test(src), "runBackup() only auto-executes when run as a script, not when require()'d for its exports (matching export-offsite.cjs's own convention)");
  }

  section("require()-ing safe-backup.cjs for its exports does NOT trigger a real backup run");
  {
    const before = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("jarvis_full_") && f.endsWith(".tar.gz")).length;
    delete require.cache[require.resolve("../../scripts/safe-backup.cjs")];
    require("../../scripts/safe-backup.cjs");
    const after = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("jarvis_full_") && f.endsWith(".tar.gz")).length;
    assert(before === after, "no new archive was created merely by require()-ing the module", `before=${before}, after=${after}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
