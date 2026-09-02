"use strict";
/**
 * Mission 42 — test-only isolation for tests/runtime and tests/security.
 *
 * Root cause (Mission 41 audit, re-confirmed live this mission): Node's
 * `node --test` runner isolates each test FILE into its own OS process by
 * default (`--test-isolation=process`) and runs multiple such processes
 * concurrently (up to os.availableParallelism()). A small number of test
 * files call missionMemory.cjs's mutating API (createMission/updateMission/
 * etc., directly or via missionOrchestrator.cjs) against the real, shared
 * data/missions.json. missionMemory.cjs's own read-modify-write cycle has
 * no cross-process coordination (Mission 41: proven, reproducible lost-
 * update race), so when two of these files' child processes run at the same
 * time, one process's mission write can silently vanish — a false test
 * failure with nothing wrong in the code under test.
 *
 * This script does NOT touch missionMemory.cjs or any production code. It
 * only changes HOW the existing test files are invoked: the small set of
 * files that mutate real mission state run sequentially (one OS process at
 * a time, so there is never a second writer to race against), while every
 * other file in the suite keeps running with Node's normal parallel
 * isolation, unaffected.
 *
 * Usage: node scripts/run-test-suite.cjs <runtime|security>
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// Files confirmed (Mission 42 audit) to call missionMemory.cjs's mutating
// API — directly, or indirectly via missionOrchestrator.cjs's
// createManual()/_queue() (which itself calls missionMemory.createMission).
// Read-only mission consumers (getMission/listMissions/getMissionStats) are
// NOT included — only files that WRITE to the shared data/missions.json
// need serialization, since Node's single-threaded event loop already makes
// same-process calls safe (Mission 41 §6) and read-only calls have nothing
// to lose to a concurrent writer beyond a normal transient read, which none
// of these tests assert an exact-count invariant against.
//
// Mission 68: the 7 runtime files below all call organizationService.cjs's
// createOrg() against the real, shared data/organizations.json. That
// module's own _write() comment (organizationService.cjs:93-106) already
// documents this exact lost-update race as previously confirmed live during
// Vault Security Hardening — "a freshly created org's owner got a 403 from
// secretVault.cjs's org-check because a concurrent second createOrg() call
// had overwritten the file before the first org was ever durably
// persisted" — the identical failure signature behind ERA-1 failure #261
// (vault-negative-security-matrix.test.cjs's "wrong org"/"wrong account"
// tests). That mission fixed the corruption/ENOENT class (atomic tmp+rename)
// but explicitly deferred the underlying two-concurrent-writers race as
// "a larger architectural change out of scope" — serializing these callers
// the same way MISSION_MUTATING already does for missions.json closes that
// gap without touching organizationService.cjs itself.
const MISSION_MUTATING = {
    runtime: [
        "tests/runtime/10-c10-cross-system-closure.test.cjs",
        "tests/runtime/40-mission-dedup-and-recovery.test.cjs",
        // JARVIS INCIDENT REPAIR (2026-09-03, P0-2/P0-3): both call
        // missionMemory.cjs's mutating API (createMission/updateMission)
        // directly against the real, shared data/missions.json — same race
        // class as 40-mission-dedup-and-recovery.test.cjs above. Confirmed
        // live: running 43-mission-storage-dedup.test.cjs standalone while a
        // full test:runtime run was concurrently writing to missions.json
        // produced a real, reproducible lost-update (a just-created org-
        // scoped mission's write did not survive a concurrent process's
        // write before this test's own very next read-modify-write saw it).
        // 42-autonomous-boot-gate.test.cjs is NOT included here — it only
        // calls the read-only getMissionStats(), matching this file's own
        // stated policy above ("read-only mission consumers... are NOT
        // included — only files that WRITE... need serialization").
        "tests/runtime/41-blocker-resolution-recursion-guard.test.cjs",
        "tests/runtime/43-mission-storage-dedup.test.cjs",
        "tests/runtime/approval-queue-engine.test.cjs",
        "tests/runtime/mission-orchestrator-nodetypes.test.cjs",
        "tests/runtime/10-org-param-precedence.test.cjs",
        "tests/runtime/capability-buildout-cross-company-reuse.test.cjs",
        "tests/runtime/credential-activation-isolation.test.cjs",
        "tests/runtime/company-factory-org-scoping.test.cjs",
        "tests/runtime/vault-hardening-mandatory-proofs.test.cjs",
        "tests/runtime/vault-negative-security-matrix.test.cjs",
        "tests/runtime/vault-security-hardening.test.cjs",
    ],
    security: [
        "tests/security/13-mission-memory-race-verification.cjs",
        "tests/security/18-mission-runtime-lifecycle.cjs",
        "tests/security/52-runtime-stability-fixes.cjs",
        // Mission 71: these 6 files all call businessDataService.cjs's
        // createLead()/mutating CRM API against the real, shared
        // data/biz-leads.json (and siblings) — the identical unlocked
        // lost-update race as organizationService.cjs/accountService.js
        // above, now in a third shared store. Force-reproduced: a
        // concurrent write losing 08-v5-production-validation.cjs's own
        // freshly-created lead made orgKnowledgeGraph.cjs's node resolver
        // return undefined for it, producing the ERA-1 "cross-org knowledge
        // graph leak detected" failure — orgId propagation is correct at
        // every layer (verified directly); the defect is purely storage-
        // layer concurrency, not tenant isolation. Serializing these
        // callers closes the same gap the runtime list above closes for
        // organizations.json, without touching businessDataService.cjs.
        "tests/security/08-v5-production-validation.cjs",
        "tests/security/57-reports-page-shows-fake-zero-stats.cjs",
        "tests/security/76-crm-leads-id-mismatch-broken-actions.cjs",
        "tests/security/77-marketing-campaigns-id-mismatch-and-creative-error-surfacing.cjs",
        "tests/security/81-reports-wrong-leads-source-and-export-mismatch.cjs",
        "tests/security/83-crm-sales-ux-consistency-id-mismatch-response-shape-destructive-confirm.cjs",
        // Mission 75 (ERA-1 certification recovery, 2026-08-29): these 2 files
        // were added by the same commit that fixed the MSN-1/M-4 P0s
        // (ce6862e0), after this list was last extended (Mission 71) — a pure
        // sequencing gap, not a design decision. Both call mutating APIs
        // directly against the real, shared JSON stores this list exists to
        // protect: 125 calls missionMemory.createMission() (same store as the
        // `runtime` list's missions.json writers above), 126 calls
        // memoryPersistenceLayer.save() (a third shared store). Reproduced
        // live (Mission 74): 125 crashed with "Cannot read properties of null
        // (reading 'status')" when run concurrently alongside 9 other files,
        // then passed 18/18 twice in true isolation — the identical
        // lost-update signature this list's other entries already describe.
        "tests/security/125-msn1-mission-runtime-cross-tenant-idor.cjs",
        "tests/security/126-m4-memory-os-cross-tenant-read-idor.cjs",
    ],
};

// CLAUDE.md §9 / backlog item #13 (2026-08-28 verification): fs.readdirSync
// is non-recursive, so tests/runtime/stream/'s 2 files
// (reconnectRecovery.test.cjs, streamStress.test.cjs) were silently excluded
// from every `npm run test:runtime` invocation — not a stale claim, verified
// against current HEAD, both files still exist and are still skipped.
// Neither touches missionMemory.cjs/organizationService.cjs's mutating APIs
// (grepped, zero hits), so they're safe to add to the normal parallel group
// with no MISSION_MUTATING entry needed. walkTestFiles() recurses one level
// deep (this repo's test dirs are at most one subdirectory deep — confirmed
// via `find tests/runtime -mindepth 2 -type d`), matching the existing
// "discover files dynamically, don't hardcode a count" design intent this
// script's own header comment establishes for the top-level case.
function walkTestFiles(dir, glob) {
    const found = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            for (const f of fs.readdirSync(full)) {
                if (glob(f)) found.push(path.join(full, f));
            }
        } else if (glob(entry.name)) {
            found.push(full);
        }
    }
    return found;
}

const SUITES = {
    runtime: {
        dir: "tests/runtime",
        glob: (f) => f.endsWith(".test.cjs"),
    },
    security: {
        dir: "tests/security",
        glob: (f) => /^\d/.test(f) && f.endsWith(".cjs"),
    },
};

function run(args) {
    const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
    if (result.error) throw result.error;
    return result.status ?? 1;
}

function main() {
    const suiteName = process.argv[2];
    const suite = SUITES[suiteName];
    if (!suite) {
        console.error(`Usage: node scripts/run-test-suite.cjs <${Object.keys(SUITES).join("|")}>`);
        process.exit(2);
    }

    const mutating = new Set(MISSION_MUTATING[suiteName].map((p) => path.join(ROOT, p)));
    const allFiles = walkTestFiles(path.join(ROOT, suite.dir), suite.glob).sort();

    // Sanity check: every file this script intends to serialize must still
    // exist. If one was renamed/removed, fail loudly rather than silently
    // serializing nothing (which would quietly reintroduce the race).
    for (const m of mutating) {
        if (!allFiles.includes(m)) {
            console.error(`[run-test-suite] Expected mission-mutating file not found: ${path.relative(ROOT, m)}`);
            console.error(`[run-test-suite] It may have been renamed or removed — update MISSION_MUTATING in this script.`);
            process.exit(2);
        }
    }

    const parallelFiles = allFiles.filter((f) => !mutating.has(f));
    const serialFiles = allFiles.filter((f) => mutating.has(f));

    console.log(`[run-test-suite] ${suiteName}: ${parallelFiles.length} file(s) parallel, ${serialFiles.length} file(s) serialized (mission-store writers)`);

    // Parallel group first — unaffected by this change, same behavior as
    // the previous single `node --test <glob>` invocation for these files.
    const parallelStatus = parallelFiles.length
        ? run(["--test", ...parallelFiles])
        : 0;

    // Serialized group — one OS process at a time (--test-concurrency=1),
    // so no two of these files' real writes to data/missions.json can ever
    // overlap in wall-clock time.
    const serialStatus = serialFiles.length
        ? run(["--test", "--test-concurrency=1", ...serialFiles])
        : 0;

    process.exit(parallelStatus !== 0 || serialStatus !== 0 ? 1 : 0);
}

main();
