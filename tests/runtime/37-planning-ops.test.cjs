"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path   = require("path");

const fs_mod = require("../../agents/runtime/planning/feasibilityScorer.cjs");
const ss     = require("../../agents/runtime/planning/strategySelector.cjs");
const pev    = require("../../agents/runtime/planning/preExecutionVerifier.cjs");
const pv     = require("../../agents/runtime/planning/planVerifier.cjs");
const pm     = require("../../agents/runtime/planning/planMemory.cjs");
const gd     = require("../../agents/runtime/planning/goalDecomposer.cjs");

// ── shared fixtures ───────────────────────────────────────────────────

const GOOD_TASK = {
    id: "api-deploy",
    name: "API Deploy",
    steps: [
        { id: "install", name: "Install",  dependsOn: [],          command: "npm install" },
        { id: "test",    name: "Test",     dependsOn: ["install"], command: "npm test" },
        { id: "deploy",  name: "Deploy",   dependsOn: ["test"],    command: "node deploy.js", tags: ["deploy"] },
    ],
};

function goodPlan() { return gd.buildPlan(GOOD_TASK); }

const CLEAN_SIM = {
    passed: true, issues: [], blockers: [], warnings: [], highIssues: [],
    simSummary: { totalIssues: 0, blockerCount: 0, warningCount: 0, highCount: 0, checksRun: 6 },
};

function makeSimWith(overrides) { return { ...CLEAN_SIM, ...overrides }; }

// ── feasibilityScorer ─────────────────────────────────────────────────

describe("feasibilityScorer", () => {
    describe("estimateCost", () => {
        it("returns a non-negative number", () => {
            assert.ok(fs_mod.estimateCost(goodPlan()) >= 0);
        });

        it("more steps = higher cost", () => {
            const few  = gd.buildPlan({ id: "t", name: "T", steps: [{ id: "a", name: "A", dependsOn: [] }] });
            const many = goodPlan();
            assert.ok(fs_mod.estimateCost(many) > fs_mod.estimateCost(few));
        });

        it("risk factors increase cost", () => {
            const noRisk   = { steps: [{ id: "s", name: "S", dependsOn: [] }], riskFactors: [] };
            const withRisk = { steps: [{ id: "s", name: "S", dependsOn: [] }], riskFactors: [{ severity: "high" }] };
            assert.ok(fs_mod.estimateCost(withRisk) > fs_mod.estimateCost(noRisk));
        });
    });

    describe("estimateRepair", () => {
        it("returns 0–1", () => {
            const p = fs_mod.estimateRepair(goodPlan(), CLEAN_SIM);
            assert.ok(p >= 0 && p <= 1);
        });

        it("increases with blocker count", () => {
            const noBlock = fs_mod.estimateRepair(goodPlan(), CLEAN_SIM);
            const withBlock = fs_mod.estimateRepair(goodPlan(), makeSimWith({
                passed: false,
                blockers: [{ type: "missing_dependency", severity: "blocker", message: "x" }],
            }));
            assert.ok(withBlock > noBlock);
        });
    });

    describe("estimateRollback", () => {
        it("returns 0–1", () => {
            const p = fs_mod.estimateRollback(goodPlan(), CLEAN_SIM);
            assert.ok(p >= 0 && p <= 1);
        });

        it("deploy tag increases rollback probability", () => {
            const noDeployPlan = gd.buildPlan({
                id: "t", name: "T",
                steps: [{ id: "s", name: "S", dependsOn: [], command: "echo hi" }],
            });
            const withDeployP  = fs_mod.estimateRollback(goodPlan(),     CLEAN_SIM);
            const withoutDeployP = fs_mod.estimateRollback(noDeployPlan, CLEAN_SIM);
            assert.ok(withDeployP > withoutDeployP);
        });
    });

    describe("score", () => {
        it("returns all required fields", () => {
            const s = fs_mod.score(goodPlan(), CLEAN_SIM);
            assert.ok("feasibility"          in s);
            assert.ok("estimatedCostUsd"     in s);
            assert.ok("repairProbability"    in s);
            assert.ok("rollbackProbability"  in s);
            assert.ok("confidence"           in s);
        });

        it("clean plan + sim → high feasibility and confidence", () => {
            const s = fs_mod.score({ ...goodPlan(), feasible: true }, CLEAN_SIM);
            assert.ok(s.feasibility >= 90, `feasibility=${s.feasibility}`);
            assert.ok(s.confidence  >= 80, `confidence=${s.confidence}`);
        });

        it("multiple blockers → low feasibility", () => {
            const badSim = makeSimWith({
                passed: false,
                blockers: [
                    { type: "missing_dependency", severity: "blocker", message: "x" },
                    { type: "circular_dependency", severity: "blocker", message: "y" },
                    { type: "port_conflict",       severity: "blocker", message: "z" },
                ],
            });
            const s = fs_mod.score(goodPlan(), badSim);
            assert.ok(s.feasibility < 50, `feasibility=${s.feasibility}`);
        });

        it("all scores are in valid ranges", () => {
            const s = fs_mod.score(goodPlan(), CLEAN_SIM);
            assert.ok(s.feasibility       >= 0 && s.feasibility       <= 100);
            assert.ok(s.confidence        >= 0 && s.confidence        <= 100);
            assert.ok(s.repairProbability >= 0 && s.repairProbability <= 1);
            assert.ok(s.rollbackProbability >= 0 && s.rollbackProbability <= 1);
            assert.ok(s.estimatedCostUsd  >= 0);
        });

        it("is deterministic — same inputs same output", () => {
            const plan = goodPlan();
            const s1 = fs_mod.score(plan, CLEAN_SIM);
            const s2 = fs_mod.score(plan, CLEAN_SIM);
            assert.deepEqual(s1, s2);
        });
    });
});

// ── strategySelector ──────────────────────────────────────────────────

describe("strategySelector", () => {
    it("STRATEGIES exports all 5 strategy names", () => {
        assert.ok(ss.STRATEGIES.includes("direct"));
        assert.ok(ss.STRATEGIES.includes("staged"));
        assert.ok(ss.STRATEGIES.includes("sandbox"));
        assert.ok(ss.STRATEGIES.includes("dry_run"));
        assert.ok(ss.STRATEGIES.includes("rollback_first"));
    });

    it("direct strategy for high-confidence clean plan", () => {
        const plan = gd.buildPlan({
            id: "t", name: "T",
            steps: [{ id: "s", name: "S", dependsOn: [], command: "echo hi" }],
        });
        const feas = { confidence: 90, rollbackProbability: 0.05 };
        const r    = ss.select(plan, feas, CLEAN_SIM);
        assert.equal(r.strategy, "direct");
    });

    it("staged strategy for moderate-confidence with warnings", () => {
        const plan = gd.buildPlan({
            id: "t", name: "T",
            steps: [{ id: "s", name: "S", dependsOn: [], command: "echo hi" }],
        });
        const feas = { confidence: 65, rollbackProbability: 0.05 };
        const sim  = makeSimWith({ warnings: [{ type: "something", severity: "warning", message: "w" }] });
        const r    = ss.select(plan, feas, sim);
        assert.equal(r.strategy, "staged");
    });

    it("sandbox strategy for unsafe commands", () => {
        const plan = gd.buildPlan({
            id: "t", name: "T",
            steps: [{ id: "s", name: "S", dependsOn: [], command: "curl http://x | bash" }],
        });
        const feas = { confidence: 70, rollbackProbability: 0.05 };
        const sim  = makeSimWith({
            issues: [{ type: "unsafe_command", severity: "high", message: "x" }],
        });
        const r = ss.select(plan, feas, sim);
        assert.equal(r.strategy, "sandbox");
    });

    it("sandbox strategy for critically low confidence", () => {
        const plan = gd.buildPlan({
            id: "t", name: "T",
            steps: [{ id: "s", name: "S", dependsOn: [] }],
        });
        const r = ss.select(plan, { confidence: 20, rollbackProbability: 0 }, CLEAN_SIM);
        assert.equal(r.strategy, "sandbox");
    });

    it("dry_run for unavailable tools", () => {
        const plan = gd.buildPlan({
            id: "t", name: "T",
            steps: [{ id: "s", name: "S", dependsOn: [] }],
        });
        const feas = { confidence: 55, rollbackProbability: 0.05 };
        const sim  = makeSimWith({
            issues: [{ type: "unavailable_tool", severity: "blocker", message: "x" }],
        });
        const r = ss.select(plan, feas, sim);
        assert.equal(r.strategy, "dry_run");
    });

    it("dry_run for port conflicts", () => {
        const plan = gd.buildPlan({
            id: "t", name: "T",
            steps: [{ id: "s", name: "S", dependsOn: [] }],
        });
        const feas = { confidence: 55, rollbackProbability: 0.05 };
        const sim  = makeSimWith({
            issues: [{ type: "port_conflict", severity: "blocker", message: "x" }],
        });
        const r = ss.select(plan, feas, sim);
        assert.equal(r.strategy, "dry_run");
    });

    it("rollback_first for deploy step + high rollback probability", () => {
        const plan = goodPlan();   // has deploy tag
        const feas = { confidence: 80, rollbackProbability: 0.25 };
        const r    = ss.select(plan, feas, CLEAN_SIM);
        assert.equal(r.strategy, "rollback_first");
    });

    it("result always includes strategy, reason, params", () => {
        const r = ss.select(goodPlan(), { confidence: 75, rollbackProbability: 0.05 }, CLEAN_SIM);
        assert.ok("strategy" in r);
        assert.ok("reason"   in r);
        assert.ok("params"   in r);
    });

    it("is deterministic — same inputs same strategy", () => {
        const plan = goodPlan();
        const feas = { confidence: 90, rollbackProbability: 0.05 };
        const r1   = ss.select(plan, feas, CLEAN_SIM);
        const r2   = ss.select(plan, feas, CLEAN_SIM);
        assert.equal(r1.strategy, r2.strategy);
    });
});

// ── preExecutionVerifier ──────────────────────────────────────────────

describe("preExecutionVerifier", () => {
    describe("verifyFiles", () => {
        it("passes for a file that exists", () => {
            const checks = pev.verifyFiles([__filename]);
            assert.equal(checks.length, 1);
            assert.ok(checks[0].passed);
        });

        it("fails for a file that does not exist", () => {
            const checks = pev.verifyFiles(["/tmp/__jarvis_nonexistent_xyz123.txt"]);
            assert.equal(checks.length, 1);
            assert.ok(!checks[0].passed);
        });

        it("returns empty array for empty input", () => {
            assert.deepEqual(pev.verifyFiles([]), []);
        });

        it("each check has check, target, passed, message fields", () => {
            const checks = pev.verifyFiles([__filename]);
            const c = checks[0];
            assert.ok("check"   in c);
            assert.ok("target"  in c);
            assert.ok("passed"  in c);
            assert.ok("message" in c);
        });
    });

    describe("verifyDependencies", () => {
        it("resolves built-in Node modules", () => {
            const checks = pev.verifyDependencies(["fs", "path"]);
            assert.ok(checks.every(c => c.passed));
        });

        it("fails for non-existent package", () => {
            const checks = pev.verifyDependencies(["__nonexistent_pkg_xyz_12345__"]);
            assert.equal(checks.length, 1);
            assert.ok(!checks[0].passed);
        });

        it("returns empty array for empty input", () => {
            assert.deepEqual(pev.verifyDependencies([]), []);
        });
    });

    describe("verifyPorts", () => {
        it("reports port as available for high ephemeral port", async () => {
            const checks = await pev.verifyPorts([59862]);
            assert.equal(checks.length, 1);
            assert.ok(checks[0].passed);
        });

        it("returns empty array for empty input", async () => {
            const checks = await pev.verifyPorts([]);
            assert.deepEqual(checks, []);
        });

        it("check.check field is port_available", async () => {
            const checks = await pev.verifyPorts([59863]);
            assert.equal(checks[0].check, "port_available");
        });
    });

    describe("verifyPermissions", () => {
        it("passes for readable file", () => {
            const checks = pev.verifyPermissions([{ path: __filename }]);
            assert.ok(checks[0].passed);
        });

        it("fails for non-existent path", () => {
            const checks = pev.verifyPermissions([{ path: "/tmp/__jarvis_nope_12345" }]);
            assert.ok(!checks[0].passed);
        });

        it("accepts plain string path", () => {
            const checks = pev.verifyPermissions([__filename]);
            assert.ok(checks[0].passed);
        });
    });

    describe("verifySecrets", () => {
        it("passes for HOME and PATH (always set)", () => {
            const checks = pev.verifySecrets(["HOME", "PATH"]);
            assert.ok(checks.every(c => c.passed));
        });

        it("fails for missing env var", () => {
            const checks = pev.verifySecrets(["__JARVIS_NEVER_SET_1234__"]);
            assert.ok(!checks[0].passed);
        });

        it("check.check field is secret_present", () => {
            const checks = pev.verifySecrets(["HOME"]);
            assert.equal(checks[0].check, "secret_present");
        });
    });

    describe("verify (full)", () => {
        it("returns passed:true for empty plan with no context requirements", async () => {
            const result = await pev.verify({ steps: [] }, {});
            assert.ok(result.passed);
            assert.equal(result.checks.length, 0);
        });

        it("returns passed:false when a required env var is missing", async () => {
            const result = await pev.verify({ steps: [] }, {
                requiredEnv: ["__JARVIS_NEVER_SET_XYZ__"],
            });
            assert.ok(!result.passed);
            assert.ok(result.failures.length > 0);
        });

        it("summary.total matches checks array length", async () => {
            const result = await pev.verify({ steps: [] }, {
                requiredFiles: [__filename],
                requiredDeps:  ["fs"],
            });
            assert.equal(result.summary.total, result.checks.length);
        });

        it("summary.byType counts failures by category", async () => {
            const result = await pev.verify({ steps: [] }, {
                requiredFiles: ["/tmp/__not_exist_xyz__"],
                requiredEnv:   ["__NOT_SET_XYZ__"],
            });
            assert.equal(result.summary.byType.files,   1);
            assert.equal(result.summary.byType.secrets, 1);
        });

        it("collects requiredFiles from plan steps", async () => {
            const plan = {
                steps: [{ id: "s", name: "S", dependsOn: [], requiredFiles: [__filename] }],
            };
            const result = await pev.verify(plan, {});
            assert.ok(result.checks.some(c => c.check === "file_exists" && c.passed));
        });
    });
});

// ── planVerifier ──────────────────────────────────────────────────────

describe("planVerifier", () => {
    it("exports BLOCK_CONFIDENCE and BLOCK_RISK", () => {
        assert.equal(typeof pv.BLOCK_CONFIDENCE, "number");
        assert.equal(typeof pv.BLOCK_RISK,       "number");
    });

    it("approves clean plan with high confidence", () => {
        const plan = { ...goodPlan(), totalRisk: 10, feasible: true };
        const feas = { confidence: 80 };
        const r    = pv.verify(plan, feas, CLEAN_SIM);
        assert.ok(r.approved);
        assert.ok(!r.blocked);
        assert.equal(r.reasons.length, 0);
    });

    it("blocks when confidence below threshold", () => {
        const plan = { ...goodPlan(), totalRisk: 10, feasible: true };
        const feas = { confidence: pv.BLOCK_CONFIDENCE - 1 };
        const r    = pv.verify(plan, feas, CLEAN_SIM);
        assert.ok(r.blocked);
        assert.ok(r.reasons.some(re => re.code === "low_confidence"));
    });

    it("blocks when risk exceeds threshold", () => {
        const plan = { ...goodPlan(), totalRisk: pv.BLOCK_RISK + 10, feasible: true };
        const r    = pv.verify(plan, { confidence: 80 }, CLEAN_SIM);
        assert.ok(r.blocked);
        assert.ok(r.reasons.some(re => re.code === "high_risk"));
    });

    it("blocks on cyclic dependency blocker", () => {
        const plan = { ...goodPlan(), totalRisk: 10, feasible: true };
        const sim  = makeSimWith({
            passed: false,
            blockers: [{ type: "circular_dependency", severity: "blocker", message: "a → b → a" }],
        });
        const r = pv.verify(plan, { confidence: 80 }, sim);
        assert.ok(r.blocked);
        assert.ok(r.reasons.some(re => re.code === "cyclic_dependency"));
    });

    it("blocks on unsafe execution chain", () => {
        const plan = { ...goodPlan(), totalRisk: 10, feasible: true };
        const sim  = makeSimWith({
            passed: false,
            blockers: [{ type: "unsafe_command", severity: "blocker", message: "rm -rf /" }],
        });
        const r = pv.verify(plan, { confidence: 80 }, sim);
        assert.ok(r.blocked);
        assert.ok(r.reasons.some(re => re.code === "unsafe_execution"));
    });

    it("blocks when plan is not feasible", () => {
        const plan = { ...goodPlan(), feasible: false, cycleError: "Cyclic dependency at step: a" };
        const r    = pv.verify(plan, { confidence: 80 }, CLEAN_SIM);
        assert.ok(r.blocked);
        assert.ok(r.reasons.some(re => re.code === "plan_not_feasible"));
    });

    it("riskLevel reflects totalRisk", () => {
        const high = { ...goodPlan(), totalRisk: 75, feasible: true };
        const low  = { ...goodPlan(), totalRisk: 10, feasible: true };
        assert.equal(pv.verify(high, { confidence: 80 }, CLEAN_SIM).riskLevel, "critical");
        assert.equal(pv.verify(low,  { confidence: 80 }, CLEAN_SIM).riskLevel, "low");
    });

    it("recommendation is a non-empty string", () => {
        const r = pv.verify(goodPlan(), { confidence: 80 }, CLEAN_SIM);
        assert.ok(typeof r.recommendation === "string" && r.recommendation.length > 0);
    });

    it("multiple block conditions accumulate reasons", () => {
        const plan = { ...goodPlan(), totalRisk: pv.BLOCK_RISK + 10, feasible: false, cycleError: "cycle" };
        const feas = { confidence: pv.BLOCK_CONFIDENCE - 1 };
        const r    = pv.verify(plan, feas, CLEAN_SIM);
        assert.ok(r.reasons.length >= 3);
    });
});

// ── planMemory ────────────────────────────────────────────────────────

describe("planMemory", () => {
    afterEach(() => pm.reset());

    describe("recordSuccess + lookup", () => {
        it("lookup returns found:false for unknown hash", () => {
            assert.deepEqual(pm.lookup("nonexistent"), { found: false });
        });

        it("lookup returns success outcome after recordSuccess", () => {
            pm.recordSuccess("plan-1", "hash-abc", { steps: ["install"] });
            const r = pm.lookup("hash-abc");
            assert.ok(r.found);
            assert.equal(r.outcome, "success");
        });

        it("pattern is stored and returned", () => {
            pm.recordSuccess("plan-1", "hash-pat", { steps: ["test"] });
            const r = pm.lookup("hash-pat");
            assert.deepEqual(r.pattern, { steps: ["test"] });
        });
    });

    describe("recordFailure + lookup", () => {
        it("lookup returns failure outcome after recordFailure", () => {
            pm.recordFailure("plan-2", "hash-fail", "missing_dep");
            const r = pm.lookup("hash-fail");
            assert.ok(r.found);
            assert.equal(r.outcome, "failure");
            assert.equal(r.reason, "missing_dep");
        });

        it("success takes precedence over failure for same hash", () => {
            pm.recordFailure("plan-x", "hash-both", "old_failure");
            pm.recordSuccess("plan-x", "hash-both", null);
            const r = pm.lookup("hash-both");
            assert.equal(r.outcome, "success");
        });
    });

    describe("recordHighRisk", () => {
        it("stores high-risk records", () => {
            pm.recordHighRisk("plan-r", [{ factor: "destructive_rm_root", severity: "critical" }]);
            const paths = pm.getHighRiskPaths();
            assert.equal(paths.length, 1);
            assert.equal(paths[0].planId, "plan-r");
        });

        it("risk factors are cloned (not shared reference)", () => {
            const factors = [{ factor: "eval_call" }];
            pm.recordHighRisk("p", factors);
            factors.push({ factor: "new" });
            const stored = pm.getHighRiskPaths()[0].riskFactors;
            assert.equal(stored.length, 1);
        });
    });

    describe("recordDepFailure + getCommonDepFailures", () => {
        it("increments count on repeated failures", () => {
            pm.recordDepFailure("express", "not_installed");
            pm.recordDepFailure("express", "not_installed");
            pm.recordDepFailure("express", "version_conflict");
            const failures = pm.getCommonDepFailures();
            const express  = failures.find(f => f.name === "express");
            assert.ok(express);
            assert.equal(express.count, 3);
        });

        it("reasons are deduplicated", () => {
            pm.recordDepFailure("lodash", "not_installed");
            pm.recordDepFailure("lodash", "not_installed");
            const f = pm.getCommonDepFailures().find(d => d.name === "lodash");
            assert.equal(f.reasons.length, 1);
        });

        it("sorted by count desc", () => {
            pm.recordDepFailure("axios",   "err");
            pm.recordDepFailure("express", "err");
            pm.recordDepFailure("express", "err2");
            const failures = pm.getCommonDepFailures();
            assert.equal(failures[0].name, "express");
        });

        it("n parameter limits results", () => {
            pm.recordDepFailure("a", "e");
            pm.recordDepFailure("b", "e");
            pm.recordDepFailure("c", "e");
            assert.equal(pm.getCommonDepFailures(2).length, 2);
        });
    });

    describe("getSuccessfulPatterns / getFailedPatterns", () => {
        it("returns empty arrays after reset", () => {
            assert.deepEqual(pm.getSuccessfulPatterns(), []);
            assert.deepEqual(pm.getFailedPatterns(),     []);
        });

        it("newest first ordering", () => {
            pm.recordSuccess("p1", "h1");
            pm.recordSuccess("p2", "h2");
            const patterns = pm.getSuccessfulPatterns();
            assert.equal(patterns[0].planId, "p2");
        });

        it("n parameter limits results", () => {
            for (let i = 0; i < 15; i++) pm.recordSuccess(`p${i}`, `h${i}`);
            assert.equal(pm.getSuccessfulPatterns(5).length, 5);
        });

        it("failed patterns contain reason", () => {
            pm.recordFailure("px", "hx", "port_conflict");
            const patterns = pm.getFailedPatterns();
            assert.equal(patterns[0].reason, "port_conflict");
        });
    });

    describe("reset", () => {
        it("clears all stored data", () => {
            pm.recordSuccess("p", "h");
            pm.recordFailure("p", "hf", "err");
            pm.recordHighRisk("p", []);
            pm.recordDepFailure("dep", "err");
            pm.reset();
            assert.deepEqual(pm.getSuccessfulPatterns(), []);
            assert.deepEqual(pm.getFailedPatterns(),     []);
            assert.deepEqual(pm.getHighRiskPaths(),      []);
            assert.deepEqual(pm.getCommonDepFailures(),  []);
        });
    });
});
