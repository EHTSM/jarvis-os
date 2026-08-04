#!/usr/bin/env node
"use strict";
/**
 * Logging consistency — regression test.
 *
 * Production Code Quality Certification finding: 4 files in
 * backend/routes and backend/services used raw console.warn() instead of
 * the shared backend/utils/logger.js (used by 88 other files in the same
 * directories — the clearly dominant pattern) — auth.js, whatsapp.js,
 * ops.js, telegramService.js. Bypassing the shared logger means those log
 * lines skip LOG_LEVEL filtering and the optional file sink entirely.
 *
 * Fixed by importing and switching to logger.warn() in all 4 — verified
 * the logger import exists and no raw console.warn/log/error/info call
 * sites remain in backend/routes or backend/services, excluding files
 * where "console.log"/"console.warn" appears only as a string literal
 * (static-analysis tooling that detects this exact pattern in OTHER
 * code, or a generated shell-script template) rather than as live,
 * executing code — verified each excluded file individually before
 * building this allowlist.
 *
 * Usage: node tests/security/19-logging-consistency.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

// Files confirmed (by reading each one) to reference "console.log"/
// "console.warn" only as a string literal — either static-analysis
// tooling that detects this exact pattern elsewhere in the codebase, or a
// generated shell-script/code template written out as a string — never as
// live executing console.* code in this file itself.
const ALLOWLIST = new Set([
  "backend/services/rc1.cjs",                    // template string for a generated backup script
  "backend/services/selfHealingFrontend.cjs",     // doc comment describing intercepted browser console messages
  "backend/services/gitHubEngineeringAgent.cjs",  // detects "console.log(" as a code-smell string pattern in PR diffs
  "backend/services/engineeringBenchmark.cjs",    // benchmark goal descriptions referencing this exact fix by name
  "backend/services/credentialImportTool.cjs",    // security-invariant doc comment
  "backend/services/engineeringSmellDetector.cjs",// detects "console.log"/"console.warn" as a code-smell string pattern
  "backend/services/dop2Deployment.cjs",          // shell command string for the operator to run manually
]);

function listFiles(dir) {
  const out = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|cjs)$/.test(entry.name)) out.push(full);
    }
  }
  walk(dir);
  return out;
}

async function main() {
  section("No raw console.* calls outside the allowlisted string-literal/template files");
  const scanDirs = ["backend/routes", "backend/services"];
  const offenders = [];
  for (const dir of scanDirs) {
    for (const file of listFiles(path.join(process.cwd(), dir))) {
      const rel = path.relative(process.cwd(), file);
      if (ALLOWLIST.has(rel)) continue;
      const content = fs.readFileSync(file, "utf8");
      // Match a real call: console.(log|warn|error|info)( — not inside a
      // string/comment is hard to detect perfectly with regex, but every
      // known false-positive file is already allowlisted above, so any
      // NEW hit here is either a real regression or a new false positive
      // that needs its own allowlist entry with a documented reason.
      if (/console\.(log|warn|error|info)\(/.test(content)) offenders.push(rel);
    }
  }
  assert(offenders.length === 0, "zero unallowlisted files use raw console.* in backend/routes or backend/services", `found: ${offenders.join(", ")}`);

  section("The 4 previously-fixed files now import and use the shared logger");
  const fixedFiles = [
    "backend/routes/auth.js",
    "backend/routes/whatsapp.js",
    "backend/routes/ops.js",
    "backend/services/telegramService.js",
  ];
  for (const rel of fixedFiles) {
    const content = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    const hasLoggerImport = /require\(["'].*utils\/logger["']\)/.test(content);
    const hasLoggerCall = /logger\.(debug|info|warn|error)\(/.test(content);
    assert(hasLoggerImport && hasLoggerCall, `${rel} imports and calls the shared logger`, `import=${hasLoggerImport} call=${hasLoggerCall}`);
  }

  section("Real runtime behavior — logger.warn() actually fires and is correctly formatted");
  {
    const tg = require("../../backend/services/telegramService.js");
    process.env.TELEGRAM_TOKEN = "fake-token-for-regression-test";
    // logger.warn() calls console.warn() internally (backend/utils/logger.js),
    // which writes to stderr, not stdout — patch console.warn directly
    // rather than a stream, so this works regardless of which stream the
    // logger is wired to.
    const originalWarn = console.warn;
    let captured = "";
    console.warn = (...args) => { captured += args.join(" "); };
    await tg.sendMessage("123", "test");
    console.warn = originalWarn;
    assert(/\[WARN\]\s*\[Telegram\] sendMessage failed/.test(captured), "telegramService's failure path produces a real, correctly-formatted [WARN] log line", `captured: ${captured.slice(0, 200)}`);
  }

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  Pass: ${pass}   Fail: ${fail}`);
  console.log(`${"═".repeat(52)}`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`    ✗ ${f.msg}: ${f.reason}`));
  }

  try {
    fs.writeFileSync(
      path.join(process.cwd(), "data/logging-consistency-test-report.json"),
      JSON.stringify({ generated: new Date().toISOString(), pass, fail, failures }, null, 2)
    );
    console.log("\n  Report: data/logging-consistency-test-report.json\n");
  } catch { /* non-critical */ }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
