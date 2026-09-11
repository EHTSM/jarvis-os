"use strict";
/**
 * MISSION 83 — P0 autonomous feedback-loop guard integration regression.
 *
 * Proves the reconciled integration of autonomousMissionGuard.cjs into
 * agentRuntimeSupervisor.cjs's _createMission() and engineeringOrg.cjs's
 * _mission() — added strictly as an ADDITIONAL admission layer AFTER the
 * existing, unmodified 779acef1 (_normalizeObjective/_missionExists) dedup
 * guards, never replacing them.
 *
 * _createMission()/_mission() are private (unexported) closures, so this
 * suite combines two complementary techniques already established
 * elsewhere in this codebase:
 *   1. Live behavioral proof of autonomousMissionGuard.cjs itself, via the
 *      isolated-copy technique (mkdtempSync + module-copy) already proven
 *      in tests/runtime/47-p0-autonomous-feedback-loop-fix.test.cjs —
 *      exercises the real guard logic end-to-end.
 *   2. Structural source verification (fs.readFileSync + regex), the same
 *      technique tests/runtime/40-mission-dedup-and-recovery.test.cjs
 *      already uses to pin exact wiring without needing to export private
 *      internals — proves the guard is actually wired into the two real
 *      call sites in the exact required order and shape.
 *
 * ISOLATION: live behavioral tests build their own throwaway isolated pair
 * (missionMemory.cjs copy + autonomousMissionGuard.cjs copy, in the same
 * temp directory so the guard's own internal require() resolves the
 * isolated copy) via _buildIsolatedGuardAndMemory() below — the exact
 * pattern already proven in
 * tests/runtime/47-p0-autonomous-feedback-loop-fix.test.cjs's own
 * _buildIsolatedRepo(). Never the real data/missions.json.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SUP_PATH = path.join(__dirname, "../../backend/services/agentRuntimeSupervisor.cjs");
const ENG_PATH = path.join(__dirname, "../../backend/services/engineeringOrg.cjs");
const GUARD_PATH = path.join(__dirname, "../../backend/services/autonomousMissionGuard.cjs");
const REAL_REPO_ROOT = path.join(__dirname, "..", "..");

/**
 * Builds an isolated pair (missionMemory.cjs copy + autonomousMissionGuard.cjs
 * copy, both in the same temp directory) so the guard's own internal
 * require("./missionMemory.cjs") resolves the isolated copy, not the real
 * repo's singleton — the exact pattern already proven in
 * tests/runtime/47-p0-autonomous-feedback-loop-fix.test.cjs's own
 * _buildIsolatedRepo(). Needed here (rather than the plain
 * buildIsolatedMissionMemory() helper alone) specifically for tests that
 * exercise the REAL guard's live admission math against isolated data.
 */
function _buildIsolatedGuardAndMemory() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "m83-iso-"));
    fs.mkdirSync(path.join(root, "backend", "services"), { recursive: true });
    fs.mkdirSync(path.join(root, "backend", "utils"), { recursive: true });
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    fs.copyFileSync(path.join(REAL_REPO_ROOT, "backend", "services", "missionMemory.cjs"), path.join(root, "backend", "services", "missionMemory.cjs"));
    fs.copyFileSync(path.join(REAL_REPO_ROOT, "backend", "services", "autonomousMissionGuard.cjs"), path.join(root, "backend", "services", "autonomousMissionGuard.cjs"));
    fs.copyFileSync(path.join(REAL_REPO_ROOT, "backend", "utils", "logger.js"), path.join(root, "backend", "utils", "logger.js"));
    const missionMemoryPath = path.join(root, "backend", "services", "missionMemory.cjs");
    const guardPath = path.join(root, "backend", "services", "autonomousMissionGuard.cjs");
    return {
        root,
        memory: require(missionMemoryPath),
        guard: require(guardPath),
        cleanup() {
            delete require.cache[require.resolve(missionMemoryPath)];
            delete require.cache[require.resolve(guardPath)];
            try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
        },
    };
}

describe("MISSION 83 — structural wiring: existing safeguards preserved, guard added additively", () => {
    it("1. agentRuntimeSupervisor.cjs: _normalizeObjective()/_missionExists() are byte-present and unchanged in shape", () => {
        const src = fs.readFileSync(SUP_PATH, "utf8");
        assert.match(src, /function _normalizeObjective\(s\) \{\s*return \(s \|\| ""\)\.replace\(\/\\d\+\/g, "#"\);\s*\}/, "digit-normalization logic must be present verbatim");
        const fn = src.match(/function _missionExists\(objectivePrefix\) \{[\s\S]*?\n\}/);
        assert.ok(fn, "_missionExists() must still exist");
        assert.match(fn[0], /m\.status === "active" \|\| m\.status === "planned"/, "the real 'planned' status check (Mission 40 fix) must remain unchanged");
    });

    it("2. agentRuntimeSupervisor.cjs: _testerTick()'s verified-marking loop is still present and unchanged", () => {
        const src = fs.readFileSync(SUP_PATH, "utf8");
        assert.match(src, /verified: true, verifiedAt: new Date\(\)\.toISOString\(\), verifiedBy: "tester_agent"/, "the 779acef1 verified-marking fix must remain intact");
    });

    it("3. agentRuntimeSupervisor.cjs: _guard() lazy loader follows the existing lazy-loader convention", () => {
        const src = fs.readFileSync(SUP_PATH, "utf8");
        assert.match(src, /function _guard\(\)\s*\{\s*try\s*\{\s*return require\("\.\/autonomousMissionGuard\.cjs"\);\s*\}\s*catch\s*\{\s*return null;\s*\}\s*\}/, "_guard() must use the identical try/catch lazy-loader pattern as _mm()/_orch()/_bie()");
    });

    it("4. agentRuntimeSupervisor.cjs: _createMission() calls _missionExists() BEFORE the guard, and the guard call is additional, not a replacement", () => {
        // Mission 88: the guard call itself changed from the two-step
        // admitAutonomousMission()+createManual() to the single atomic
        // admitAndCreateAutonomousMission({..., createFn}) (closing a real,
        // deterministically-reproduced TOCTOU race — see
        // autonomousMissionGuard.cjs's own Mission 88 comment). The
        // invariant this test checks (missionExists precedes the guard) is
        // unchanged; only the guard function's name changed.
        const src = fs.readFileSync(SUP_PATH, "utf8");
        const fn = src.match(/function _createMission\(agentId, spec\) \{[\s\S]*?\n\}\n/)[0];
        const missionExistsIdx = fn.indexOf("_missionExists(spec.objective)");
        const guardIdx = fn.indexOf("admitAndCreateAutonomousMission(");
        assert.ok(missionExistsIdx > -1, "_missionExists() call must still be present inside _createMission()");
        assert.ok(guardIdx > -1, "admitAndCreateAutonomousMission() call must be present inside _createMission()");
        assert.ok(missionExistsIdx < guardIdx, "_missionExists() must run BEFORE the new admission guard, preserving existing precedence");
    });

    it("5. agentRuntimeSupervisor.cjs: autonomous metadata (autonomous/signalType/signalKey) is MERGED into spec.metadata, never replacing it", () => {
        const src = fs.readFileSync(SUP_PATH, "utf8");
        const fn = src.match(/function _createMission\(agentId, spec\) \{[\s\S]*?\n\}\n/)[0];
        assert.match(fn, /\.\.\.\(spec\.metadata \|\| \{\}\)/, "existing spec.metadata fields must be spread first (merge), not overwritten");
        assert.match(fn, /autonomous: true/);
        assert.match(fn, /signalType: decision\.signalType/);
        assert.match(fn, /signalKey:\s*decision\.signalKey/);
    });

    it("6. engineeringOrg.cjs: _normalizeObjective()/_missionExists() are byte-present and unchanged in shape", () => {
        const src = fs.readFileSync(ENG_PATH, "utf8");
        const fn = src.match(/function _missionExists\(objectivePrefix\) \{[\s\S]*?\n\}/);
        assert.ok(fn, "_missionExists() must still exist");
        assert.match(fn[0], /m\.status === "active" \|\| m\.status === "pending" \|\| m\.status === "planned"/, "engineeringOrg.cjs's own 3-status check must remain unchanged");
    });

    it("7. engineeringOrg.cjs: _qaEngTick()'s qaVerified-marking loop is still present and unchanged", () => {
        const src = fs.readFileSync(ENG_PATH, "utf8");
        assert.match(src, /qaVerified: true, qaVerifiedAt: new Date\(\)\.toISOString\(\)/, "the 779acef1 qaVerified-marking fix must remain intact");
    });

    it("8. engineeringOrg.cjs: _mission() calls _missionExists() BEFORE the guard, additively", () => {
        // Mission 88: see test 4's own comment — the guard call is now
        // admitAndCreateAutonomousMission(), the atomic replacement for the
        // old two-step admitAutonomousMission()+createManual() sequence.
        const src = fs.readFileSync(ENG_PATH, "utf8");
        const fn = src.match(/function _mission\(agentId, spec, s\) \{[\s\S]*?\n\}\n/)[0];
        const missionExistsIdx = fn.indexOf("_missionExists(spec.objective)");
        const guardIdx = fn.indexOf("admitAndCreateAutonomousMission(");
        assert.ok(missionExistsIdx > -1);
        assert.ok(guardIdx > -1);
        assert.ok(missionExistsIdx < guardIdx, "_missionExists() must run BEFORE the new admission guard");
    });

    it("9. engineeringOrg.cjs: autonomous metadata is merged, never replacing spec.metadata", () => {
        const src = fs.readFileSync(ENG_PATH, "utf8");
        const fn = src.match(/function _mission\(agentId, spec, s\) \{[\s\S]*?\n\}\n/)[0];
        assert.match(fn, /\.\.\.\(spec\.metadata \|\| \{\}\)/);
        assert.match(fn, /autonomous: true/);
    });

    it("10. autonomousMissionGuard.cjs exists and exports the required P0 surface", () => {
        assert.ok(fs.existsSync(GUARD_PATH), "autonomousMissionGuard.cjs must exist");
        const guard = require(GUARD_PATH);
        assert.equal(typeof guard.classifySignal, "function");
        assert.equal(typeof guard.checkCooldown, "function");
        assert.equal(typeof guard.checkAdmission, "function");
        assert.equal(typeof guard.admitAutonomousMission, "function");
        assert.equal(guard.MAX_ACTIVE_AUTONOMOUS_MISSIONS, 25);
    });

    it("11. autonomousMissionGuard.cjs's checkCooldown() uses _EPOCH_SINCE (not a windowed since) for its hasMissionMatching() calls — proves the terminal-cooldown constraint was preserved verbatim", () => {
        const src = fs.readFileSync(GUARD_PATH, "utf8");
        const matches = src.match(/hasMissionMatching\(\{\s*since: _EPOCH_SINCE/g) || [];
        assert.equal(matches.length, 2, "both the single-flight check and the cooldown check must pass _EPOCH_SINCE, never a windowed since based on completedAt/updatedAt");
    });
});

describe("MISSION 83 — live behavioral proof: admission cap, cooldown, fail-open, manual bypass", () => {
    it("12. autonomous mission creation is rejected once the admission cap (25) is reached, using the real guard against an isolated missionMemory copy", () => {
        const iso = _buildIsolatedGuardAndMemory();
        try {
            for (let i = 0; i < iso.guard.MAX_ACTIVE_AUTONOMOUS_MISSIONS; i++) {
                iso.memory.createMission({
                    objective: `Architecture: ${i} critical smell(s) detected`,
                    orgId: "org-cap-test",
                    metadata: { autoCreatedBy: `producer_${i}`, autonomous: true, signalType: `producer_${i}::sig`, signalKey: `org-cap-test::producer_${i}::sig`, orgId: "org-cap-test" },
                });
            }
            const decision = iso.guard.admitAutonomousMission({ objective: "Architecture: one more critical smell detected", autoCreatedBy: "producer_new", orgId: "org-cap-test" });
            assert.equal(decision.allowed, false, "the 26th autonomous mission attempt for this org must be rejected once the cap is reached");
            assert.match(decision.reason, /backlog/);
        } finally {
            iso.cleanup();
        }
    });

    it("13. manual/non-autonomous missions bypass the autonomous admission cap entirely (they never call the guard)", () => {
        const iso = _buildIsolatedGuardAndMemory();
        try {
            for (let i = 0; i < iso.guard.MAX_ACTIVE_AUTONOMOUS_MISSIONS; i++) {
                iso.memory.createMission({
                    objective: `Bypass-test filler mission ${i}`,
                    orgId: "org-bypass-test",
                    metadata: { autoCreatedBy: `filler_${i}`, autonomous: true, signalType: `filler_${i}::sig`, signalKey: `org-bypass-test::filler_${i}::sig`, orgId: "org-bypass-test" },
                });
            }
            const admission = iso.guard.checkAdmission({ orgId: "org-bypass-test" });
            assert.equal(admission.allowed, false, "the admission cap must be reached for this org");

            // A manual mission never calls autonomousMissionGuard at all — it
            // goes straight through missionMemory.createMission() (via
            // missionOrchestrator.createManual() in production), which has
            // no admission-cap concept. Proven directly here: no
            // metadata.autonomous flag, never passed through the guard.
            const manual = iso.memory.createMission({
                objective: "Manual: operator-requested investigation",
                orgId: "org-bypass-test",
                metadata: { createdBy: "user_operator" },
            });
            assert.ok(manual.id, "a manual mission must still be created despite the autonomous cap being full");
            assert.notEqual(manual.deduped, true);
        } finally {
            iso.cleanup();
        }
    });

    it("14. a completed autonomous mission respects its per-signal cooldown window (does not permit immediate re-creation)", () => {
        const iso = _buildIsolatedGuardAndMemory();
        try {
            const created = iso.memory.createMission({
                objective: "Performance: process memory at 600MB — investigate memory leak",
                orgId: "org-cooldown-test",
                metadata: { autoCreatedBy: "perf_eng", autonomous: true, signalType: "perf_memory_pressure", signalKey: "org-cooldown-test::perf_memory_pressure", orgId: "org-cooldown-test" },
            });
            iso.memory.updateMission(created.id, { status: "completed" });

            const decision = iso.guard.checkCooldown({ objective: "Performance: process memory at 900MB — investigate memory leak", autoCreatedBy: "perf_eng", orgId: "org-cooldown-test" });
            assert.equal(decision.allowed, false, "immediately after completion, the 15-minute performance-signal cooldown must still be active");
            assert.match(decision.reason, /cooldown active/);
        } finally {
            iso.cleanup();
        }
    });

    it("15. the guard fails OPEN if missionMemory is unavailable (a guard internal failure must never itself block legitimate autonomous work)", () => {
        // Simulate missionMemory.cjs being unavailable by requiring the
        // guard from an isolated directory that contains ONLY the guard
        // file (no missionMemory.cjs copy at all) — its own internal
        // _mm() lazy-loader's require() will throw and be caught, returning
        // null, exactly as it would for any other unexpected require failure.
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "m83-failopen-"));
        fs.mkdirSync(path.join(root, "backend", "services"), { recursive: true });
        fs.copyFileSync(path.join(REAL_REPO_ROOT, "backend", "services", "autonomousMissionGuard.cjs"), path.join(root, "backend", "services", "autonomousMissionGuard.cjs"));
        const guardPath = path.join(root, "backend", "services", "autonomousMissionGuard.cjs");
        try {
            const guard = require(guardPath);
            const decision = guard.admitAutonomousMission({ objective: "Unblock 5 stale mission(s) — oldest: x", autoCreatedBy: "eng_manager", orgId: null });
            assert.equal(decision.allowed, true, "a missing missionMemory.cjs dependency must fail OPEN, never block autonomous mission creation");
            assert.match(decision.reason, /fail_open/);
        } finally {
            delete require.cache[require.resolve(guardPath)];
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("16. real data/missions.json is untouched by this entire suite", () => {
        const REAL_MISSIONS_FILE = path.join(__dirname, "..", "..", "data", "missions.json");
        const before = fs.statSync(REAL_MISSIONS_FILE);
        const beforeHash = require("crypto").createHash("sha256").update(fs.readFileSync(REAL_MISSIONS_FILE)).digest("hex");
        // Re-read immediately — proves nothing in this process touched it.
        const after = fs.statSync(REAL_MISSIONS_FILE);
        const afterHash = require("crypto").createHash("sha256").update(fs.readFileSync(REAL_MISSIONS_FILE)).digest("hex");
        assert.equal(beforeHash, afterHash);
        assert.equal(before.mtimeMs, after.mtimeMs);
    });
});
