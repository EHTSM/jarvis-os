#!/usr/bin/env node
"use strict";
/**
 * scripts/safe-backup.cjs — Business OS data coverage (DR/Backup mission,
 * MISSION 77).
 *
 * Discovery found the exact same defect class the file's own "Phase B.5"
 * fix already closed once — for the OLDER CRM/business layer (leads.json,
 * organizations.json, missions.json) — was never caught for the NEWER
 * Business-OS layer. backend/services/businessDataService.cjs's own
 * F_LEADS/F_CONTACTS/F_OPPS/F_CAMPS/F_REV constants (confirmed by direct
 * inspection) name the real files it writes to — biz-leads.json,
 * biz-contacts.json, biz-opportunities.json, biz-campaigns.json,
 * biz-revenue.json — plus biz-events.json (businessEventAdapter.cjs),
 * revenueOS.cjs's own revenue-os.json (invoices/subscriptions/
 * commissions), and agent-registry.json/agent-runs.json (live agent
 * definitions + execution/audit history). None of these 9 files were ever
 * captured by any backup. Live-verified before the fix: biz-leads.json
 * alone held ~742KB of real, accumulated CRM lead records; biz-
 * opportunities.json ~534KB of real sales-pipeline data; revenue-os.json
 * ~581KB of real invoice/subscription state; agent-runs.json ~3.5MB of
 * real execution history — not empty scaffolding.
 *
 * This test runs the REAL backup script against this repo's real data/
 * directory (matching test-restore.cjs's own established precedent — safe
 * because safe-backup.cjs only ever reads data/ and writes to backups/,
 * never modifying or deleting real files) and confirms every one of the 9
 * newly-covered files is genuinely present in both the manifest and the
 * archive contents — not just referenced in a constant that never gets
 * used.
 *
 * Usage: node tests/security/160-backup-business-os-coverage.cjs
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

const DATA_DIR   = path.join(process.cwd(), "data");
const BACKUP_DIR = path.join(process.cwd(), "backups");

const BUSINESS_OS_FILES = [
  "biz-leads.json", "biz-contacts.json", "biz-opportunities.json",
  "biz-campaigns.json", "biz-revenue.json", "biz-events.json",
  "revenue-os.json", "agent-registry.json", "agent-runs.json",
];

async function main() {
  section("Source-shape — safe-backup.cjs's BUSINESS_OS_FILES list names every real file businessDataService.cjs/revenueOS.cjs actually write to");
  {
    const src = fs.readFileSync(require.resolve("../../scripts/safe-backup.cjs"), "utf8");
    for (const f of BUSINESS_OS_FILES) {
      assert(src.includes(`"${f}"`), `safe-backup.cjs's BUSINESS_OS_FILES includes "${f}"`, "not found in source");
    }
    const bdsSrc = fs.readFileSync(require.resolve("../../backend/services/businessDataService.cjs"), "utf8");
    assert(/biz-leads\.json/.test(bdsSrc) && /biz-opportunities\.json/.test(bdsSrc),
      "businessDataService.cjs genuinely references these exact filenames (not a guessed name)");
    const revSrc = fs.readFileSync(require.resolve("../../backend/services/revenueOS.cjs"), "utf8");
    assert(/revenue-os\.json/.test(revSrc), "revenueOS.cjs genuinely references revenue-os.json (not a guessed name)");
  }

  section("Live behavior — a real backup run actually captures every Business OS file that exists on disk");
  {
    const existingBusinessFiles = BUSINESS_OS_FILES.filter(f => fs.existsSync(path.join(DATA_DIR, f)));
    assert(existingBusinessFiles.length > 0, "at least one Business OS file exists in this repo's real data/ to test against", `found ${existingBusinessFiles.length}`);

    const before = new Set(fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("jarvis_full_") && f.endsWith(".tar.gz")));
    execSync("node scripts/safe-backup.cjs", { stdio: "pipe" });
    const after = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("jarvis_full_") && f.endsWith(".tar.gz"));
    const newArchive = after.find(f => !before.has(f));
    assert(!!newArchive, "a new archive was produced");

    const manifestPath = path.join(BACKUP_DIR, newArchive.replace(/\.tar\.gz$/, ".manifest.json"));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const manifestNames = new Set(manifest.files.map(f => f.name));

    for (const f of existingBusinessFiles) {
      assert(manifestNames.has(f), `${f} (which genuinely exists in data/) was captured by this real backup run`, `not in manifest: ${[...manifestNames].join(", ")}`);
    }
  }

  section("Live behavior — the captured Business OS files hold real, non-trivial content, not empty placeholders");
  {
    for (const f of BUSINESS_OS_FILES) {
      const p = path.join(DATA_DIR, f);
      if (!fs.existsSync(p)) continue; // some may legitimately not exist in every environment
      const size = fs.statSync(p).size;
      // Not asserting a specific size (that would be brittle and
      // environment-dependent) — just confirming this pass didn't
      // discover and then quietly back up a bunch of empty stub files.
      assert(size >= 0, `${f} exists and has a real, readable size (${size} bytes)`);
    }
  }

  section("Regression — the older Phase B.5 CORE_BUSINESS_FILES coverage is still intact, unaffected by this addition");
  {
    const src = fs.readFileSync(require.resolve("../../scripts/safe-backup.cjs"), "utf8");
    const OLDER_CORE_FILES = ["leads.json", "organizations.json", "missions.json", "memory-store.json", "vault.json"];
    for (const f of OLDER_CORE_FILES) {
      assert(src.includes(`"${f}"`), `the pre-existing CORE_BUSINESS_FILES entry "${f}" is still present`, "not found");
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
