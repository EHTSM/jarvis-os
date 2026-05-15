#!/usr/bin/env node
"use strict";
/**
 * check-no-raw-exec — CI enforcement script.
 *
 * Scans production backend/agent code for raw shell execution that bypasses safe-exec:
 *   child_process.exec(     — shell:true by default
 *   child_process.execSync( — shell:true by default
 *   { shell: true }         — explicit shell flag on spawn
 *
 * Exits 1 if any violations are found. Exits 0 if clean.
 *
 * Usage:
 *   node scripts/check-no-raw-exec.cjs
 *   npm run security:no-raw-exec
 *
 * Scope:
 *   Only production directories are scanned: backend/, agents/
 *   Tests, electron, _archive, scripts/, modules/, evaluation/, workflows/ are excluded.
 *
 * Exemptions:
 *   Files in EXEMPT have audited, documented reasons to use exec-family calls.
 */

const fs   = require("fs");
const path = require("path");

// ── Configuration ─────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "..");

// Only scan production code directories
const SCAN_ROOTS = ["backend", "agents"];

// Extensions to scan
const SCAN_EXTS = new Set([".js", ".cjs", ".mjs"]);

// Subdirectories to skip within scan roots
const SKIP_DIRS = new Set(["node_modules", ".git"]);

// Files permitted to use exec() — audited, with documented reasons.
// Key: path relative to project root. Value: audit reason.
const EXEMPT = {
    "backend/core/safe-exec.js":
        "CANONICAL — uses spawn(shell:false). This IS the safe execution layer.",
    "agents/voiceAgent.cjs":
        "macOS desktop-only. voiceEnabled=false on Linux VPS. Not on operator routes.",
    "agents/primitives.cjs":
        "Desktop-only openURL/openApp. Headless VPS path returns early. Not on operator routes.",
    "agents/interaction/textToSpeech.cjs":
        "macOS desktop-only (say command). Not accessible from any operator route.",
    "agents/dev/versionControlAgent.cjs":
        "Dev-tooling only. Not mounted on any operator HTTP route. Isolated to /agents/dev/.",
    "agents/runtime/adapters/terminalExecutionAdapter.cjs":
        "Uses spawn(shell:false) with adapterSandboxPolicyEngine allowlist. Already safe.",
    "agents/runtime/adapters/gitExecutionAdapter.cjs":
        "Uses spawn(shell:false). Already safe.",
    "agents/runtime/adapters/vscodeExecutionAdapter.cjs":
        "Uses spawn(shell:false). Already safe.",
};

// Patterns that indicate raw shell execution (excluding spawn which can be safe)
const VIOLATION_PATTERNS = [
    { re: /\bexec\s*\(/,      label: "exec()" },
    { re: /\bexecSync\s*\(/,  label: "execSync()" },
    { re: /shell\s*:\s*true/, label: "shell:true" },
];

// ── File walker ───────────────────────────────────────────────────────────

function* walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
        } else if (entry.isFile() && SCAN_EXTS.has(path.extname(entry.name))) {
            yield full;
        }
    }
}

// ── Main ──────────────────────────────────────────────────────────────────

let violations = 0;
let scanned    = 0;
const exempted = [];

for (const scanDir of SCAN_ROOTS) {
    const fullDir = path.join(ROOT, scanDir);
    if (!fs.existsSync(fullDir)) continue;

    for (const file of walk(fullDir)) {
        const rel = path.relative(ROOT, file);
        scanned++;

        if (EXEMPT[rel]) {
            exempted.push({ file: rel, reason: EXEMPT[rel] });
            continue;
        }

        let content;
        try {
            content = fs.readFileSync(file, "utf8");
        } catch {
            continue;
        }

        const lines = content.split("\n");
        const fileViolations = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Skip pure comment lines
            if (/^\s*(\/\/|\*|#)/.test(line)) continue;

            for (const { re, label } of VIOLATION_PATTERNS) {
                if (re.test(line)) {
                    fileViolations.push({ lineNo: i + 1, label, text: line.trim().slice(0, 100) });
                }
            }
        }

        if (fileViolations.length > 0) {
            violations += fileViolations.length;
            console.error(`\n[VIOLATION] ${rel}`);
            for (const v of fileViolations) {
                console.error(`  line ${v.lineNo}: ${v.label} — ${v.text}`);
            }
        }
    }
}

// Summary
console.log(`\n[check-no-raw-exec] Scanned ${scanned} production files in: ${SCAN_ROOTS.join(", ")}`);

if (exempted.length > 0) {
    console.log(`\n[EXEMPT] ${exempted.length} file(s) with audited exec usage:`);
    for (const e of exempted) {
        console.log(`  ${e.file}`);
        console.log(`    → ${e.reason}`);
    }
}

if (violations > 0) {
    console.error(`\n[FAIL] ${violations} raw exec violation(s) found.`);
    console.error("  All process spawning must go through backend/core/safe-exec.js");
    console.error("  To add an exemption, update the EXEMPT map in scripts/check-no-raw-exec.cjs");
    process.exit(1);
} else {
    console.log(`\n[PASS] No raw exec violations in production code.`);
    process.exit(0);
}
