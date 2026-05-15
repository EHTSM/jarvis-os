"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const eb    = require("../../agents/runtime/planning/executionBlocker.cjs");
const sr    = require("../../agents/runtime/planning/strategyRouter.cjs");
const rep   = require("../../agents/runtime/planning/planningReplay.cjs");
const pipe  = require("../../agents/runtime/planning/executionPipeline.cjs");
const hooks = require("../../agents/runtime/planning/planningHooks.cjs");
const gd    = require("../../agents/runtime/planning/goalDecomposer.cjs");

// ── shared fixtures ───────────────────────────────────────────────────

const CLEAN_TASK = {
    id: "clean-task",
    name: "Clean Task",
    steps: [
        { id: "install", name: "Install", dependsOn: [],          command: "npm install" },
        { id: "test",    name: "Test",    dependsOn: ["install"], command: "npm test" },
        { id: "build",   name: "Build",   dependsOn: ["test"],    command: "npm run build" },
    ],
};

const CYCLIC_TASK = {
    id: "cyclic-task",
    name: "Cyclic Task",
    steps: [
        { id: "a", name: "A", dependsOn: ["b"] },
        { id: "b", name: "B", dependsOn: ["a"] },
    ],
};

const UNSAFE_TASK = {
    id: "unsafe-task",
    name: "Unsafe Task",
    steps: [
        { id: "wipe", name: "Wipe", dependsOn: [], command: "rm -rf /" },
    ],
};

// ── executionBlocker ──────────────────────────────────────────────────

describe("executionBlocker", () => {
    describe("BLOCK_CODES", () => {
        it("exports all 6 block codes", () => {
            assert.ok("LOW_CONFIDENCE"      in eb.BLOCK_CODES);
            assert.ok("HIGH_RISK"           in eb.BLOCK_CODES);
            assert.ok("CYCLIC_DEPS"         in eb.BLOCK_CODES);
            assert.ok("UNSAFE_EXECUTION"    in eb.BLOCK_CODES);
            assert.ok("PLAN_NOT_FEASIBLE"   in eb.BLOCK_CODES);
            assert.ok("VERIFICATION_FAILED" in eb.BLOCK_CODES);
        });
    });

    describe("shouldBlock", () => {
        it("does not block clean plan with high confidence", () => {
            const plan  = { ...gd.buildPlan(CLEAN_TASK), totalRisk: 5, feasible: true };
            const feas  = { confidence: 90 };
            const sim   = { passed: true, blockers: [], issues: [], warnings: [], highIssues: [] };
            const r     = eb.shouldBlock(plan, feas, sim);
            assert.ok(!r.blocked);
            assert.equal(r.reasons.length, 0);
        });

        it("blocks on low confidence", () => {
            const plan = { ...gd.buildPlan(CLEAN_TASK), totalRisk: 5, feasible: true };
            const feas = { confidence: 30 };
            const sim  = { passed: true, blockers: [], issues: [], warnings: [], highIssues: [] };
            const r    = eb.shouldBlock(plan, feas, sim);
            assert.ok(r.blocked);
            assert.ok(r.reasons.some(re => re.code === "low_confidence"));
        });

        it("blocks on cyclic dependency in blockers", () => {
            const plan = { ...gd.buildPlan(CYCLIC_TASK), totalRisk: 0, feasible: false };
            const sim  = {
                passed: false,
                blockers: [{ type: "circular_dependency", severity: "blocker", message: "a → b → a" }],
                issues: [], warnings: [], highIssues: [],
            };
            const feas = { confidence: 60 };
            const r    = eb.shouldBlock(plan, feas, sim);
            assert.ok(r.blocked);
            assert.ok(r.reasons.some(re => re.code === "cyclic_dependency"));
        });

        it("blocks on unsafe command blocker", () => {
            const plan = { ...gd.buildPlan(UNSAFE_TASK), totalRisk: 40, feasible: true };
            const sim  = {
                passed: false,
                blockers: [{ type: "unsafe_command", severity: "blocker", message: "rm -rf /" }],
                issues: [], warnings: [], highIssues: [],
            };
            const feas = { confidence: 55 };
            const r    = eb.shouldBlock(plan, feas, sim);
            assert.ok(r.blocked);
            assert.ok(r.reasons.some(re => re.code === "unsafe_execution"));
        });

        it("result includes riskLevel and recommendation", () => {
            const plan = { ...gd.buildPlan(CLEAN_TASK), totalRisk: 5, feasible: true };
            const r    = eb.shouldBlock(plan, { confidence: 90 }, { passed: true, blockers: [], issues: [], warnings: [], highIssues: [] });
            assert.ok("riskLevel"      in r);
            assert.ok("recommendation" in r);
        });
    });

    describe("shouldBlockVerification", () => {
        it("does not block when verifyResult.passed is true", () => {
            const r = eb.shouldBlockVerification({ passed: true, failures: [] });
            assert.ok(!r.blocked);
        });

        it("blocks when verifyResult has failures", () => {
            const r = eb.shouldBlockVerification({
                passed:   false,
                failures: [{ check: "secret_present", target: "MY_VAR", passed: false, message: "MY_VAR missing" }],
            });
            assert.ok(r.blocked);
            assert.ok(r.reasons.some(re => re.code === "verification_failed"));
        });

        it("does not block for null input", () => {
            assert.ok(!eb.shouldBlockVerification(null).blocked);
        });
    });
});

// ── strategyRouter ────────────────────────────────────────────────────

describe("strategyRouter", () => {
    describe("STRATEGIES + ROUTE_CONFIGS", () => {
        it("STRATEGIES has 5 entries", () => {
            assert.equal(sr.STRATEGIES.length, 5);
        });

        it("each strategy has a ROUTE_CONFIG entry", () => {
            for (const s of sr.STRATEGIES) {
                assert.ok(s in sr.ROUTE_CONFIGS, `missing config for ${s}`);
            }
        });

        it("each ROUTE_CONFIG has required fields", () => {
            for (const [name, cfg] of Object.entries(sr.ROUTE_CONFIGS)) {
                assert.ok("checkpoints"      in cfg, `${name} missing checkpoints`);
                assert.ok("isolation"        in cfg, `${name} missing isolation`);
                assert.ok("rollbackRequired" in cfg, `${name} missing rollbackRequired`);
                assert.ok("dryRun"           in cfg, `${name} missing dryRun`);
                assert.ok("description"      in cfg, `${name} missing description`);
            }
        });
    });

    describe("routeConfig", () => {
        it("direct: no checkpoints, no isolation, no dryRun", () => {
            const c = sr.routeConfig("direct");
            assert.ok(!c.checkpoints);
            assert.ok(!c.isolation);
            assert.ok(!c.dryRun);
        });

        it("dry_run: dryRun is true", () => {
            assert.ok(sr.routeConfig("dry_run").dryRun);
        });

        it("sandbox: isolation is true", () => {
            assert.ok(sr.routeConfig("sandbox").isolation);
        });

        it("rollback_first: rollbackRequired and checkpoints are true", () => {
            const c = sr.routeConfig("rollback_first");
            assert.ok(c.rollbackRequired);
            assert.ok(c.checkpoints);
        });

        it("staged: checkpoints true, stageByStage true", () => {
            const c = sr.routeConfig("staged");
            assert.ok(c.checkpoints);
            assert.ok(c.stageByStage);
        });

        it("unknown strategy falls back to direct", () => {
            const c = sr.routeConfig("unknown_xyz");
            assert.ok(!c.dryRun);
        });
    });

    describe("route", () => {
        const plan = { executionOrder: ["install", "test", "build"] };

        it("direct: stepsToExecute = all steps", () => {
            const r = sr.route("direct", plan);
            assert.deepEqual(r.stepsToExecute, plan.executionOrder);
            assert.deepEqual(r.stepsToSimulate, []);
        });

        it("dry_run: stepsToExecute empty, stepsToSimulate = all", () => {
            const r = sr.route("dry_run", plan);
            assert.deepEqual(r.stepsToExecute,  []);
            assert.deepEqual(r.stepsToSimulate, plan.executionOrder);
        });

        it("rollback_first: preflight includes create_rollback_snapshot", () => {
            const r = sr.route("rollback_first", plan);
            assert.ok(r.preflightActions.some(a => a.action === "create_rollback_snapshot"));
        });

        it("sandbox: preflight includes setup_sandbox_environment", () => {
            const r = sr.route("sandbox", plan);
            assert.ok(r.preflightActions.some(a => a.action === "setup_sandbox_environment"));
        });

        it("result has mode, config, checkpointMode, isolatedMode", () => {
            const r = sr.route("staged", plan);
            assert.ok("mode"          in r);
            assert.ok("config"        in r);
            assert.ok("checkpointMode" in r);
            assert.ok("isolatedMode"  in r);
        });
    });
});

// ── planningReplay ────────────────────────────────────────────────────

describe("planningReplay", () => {
    afterEach(() => rep.reset());

    describe("hash", () => {
        it("returns an 8-character hex string", () => {
            const h = rep.hash(CLEAN_TASK, {});
            assert.ok(typeof h === "string");
            assert.ok(/^[0-9a-f]{8}$/.test(h), `not 8-char hex: ${h}`);
        });

        it("same inputs produce same hash (determinism)", () => {
            const h1 = rep.hash(CLEAN_TASK, {});
            const h2 = rep.hash(CLEAN_TASK, {});
            assert.equal(h1, h2);
        });

        it("different tasks produce different hashes", () => {
            const h1 = rep.hash(CLEAN_TASK,  {});
            const h2 = rep.hash(CYCLIC_TASK, {});
            assert.notEqual(h1, h2);
        });

        it("different contexts produce different hashes", () => {
            const h1 = rep.hash(CLEAN_TASK, {});
            const h2 = rep.hash(CLEAN_TASK, { occupiedPorts: [3000] });
            assert.notEqual(h1, h2);
        });
    });

    describe("replayFull", () => {
        it("returns decomposition, simResult, feasibility, strategy", () => {
            const r = rep.replayFull(CLEAN_TASK, {});
            assert.ok("decomposition" in r);
            assert.ok("simResult"     in r);
            assert.ok("feasibility"   in r);
            assert.ok("strategy"      in r);
        });

        it("clean task → simResult.passed:true", () => {
            const r = rep.replayFull(CLEAN_TASK, {});
            assert.ok(r.simResult.passed);
        });

        it("cyclic task → simResult.passed:false", () => {
            const r = rep.replayFull(CYCLIC_TASK, {});
            assert.ok(!r.simResult.passed);
        });

        it("is deterministic — same inputs same result", () => {
            const r1 = rep.replayFull(CLEAN_TASK, {});
            const r2 = rep.replayFull(CLEAN_TASK, {});
            assert.equal(r1.strategy.strategy,      r2.strategy.strategy);
            assert.equal(r1.feasibility.feasibility, r2.feasibility.feasibility);
            assert.deepEqual(r1.decomposition.executionOrder, r2.decomposition.executionOrder);
        });

        it("context.occupiedPorts causes port conflict blocker", () => {
            const portTask = {
                id: "pt", name: "PT",
                steps: [{ id: "s", name: "S", dependsOn: [], requiredPorts: [4000] }],
            };
            const r = rep.replayFull(portTask, { occupiedPorts: [4000] });
            assert.ok(!r.simResult.passed);
            assert.ok(r.simResult.blockers.some(b => b.type === "port_conflict"));
        });
    });

    describe("record + replay", () => {
        it("record returns hash and stored:true", () => {
            const result = rep.replayFull(CLEAN_TASK, {});
            const r = rep.record(CLEAN_TASK, {}, result);
            assert.ok(r.stored);
            assert.ok(typeof r.hash === "string");
        });

        it("replay on first call stores and returns stored:null", () => {
            const r = rep.replay(CLEAN_TASK, {});
            assert.equal(r.stored, null);
            assert.ok("fresh" in r);
        });

        it("replay on second call returns stored result and match:true", () => {
            rep.replay(CLEAN_TASK, {});   // stores
            const r = rep.replay(CLEAN_TASK, {});   // retrieves
            assert.ok(r.stored !== null);
            assert.ok(r.match);
            assert.deepEqual(r.diffs, []);
        });

        it("record + replay detects match for same planning result", () => {
            const fresh = rep.replayFull(CLEAN_TASK, {});
            rep.record(CLEAN_TASK, {}, fresh);
            const r = rep.replay(CLEAN_TASK, {});
            assert.ok(r.match);
        });
    });

    describe("compare", () => {
        it("identical results → match:true, diffs:[]", () => {
            const r1 = rep.replayFull(CLEAN_TASK, {});
            const r2 = rep.replayFull(CLEAN_TASK, {});
            const cmp = rep.compare(r1, r2);
            assert.ok(cmp.match);
            assert.deepEqual(cmp.diffs, []);
        });

        it("different strategy → match:false, diff recorded", () => {
            const r1 = { strategy: { strategy: "direct" },  feasibility: { feasibility: 80, confidence: 80 }, simResult: { passed: true }, decomposition: { executionOrder: [] } };
            const r2 = { strategy: { strategy: "sandbox" }, feasibility: { feasibility: 80, confidence: 80 }, simResult: { passed: true }, decomposition: { executionOrder: [] } };
            const cmp = rep.compare(r1, r2);
            assert.ok(!cmp.match);
            assert.ok(cmp.diffs.some(d => d.field === "strategy"));
        });
    });
});

// ── executionPipeline ─────────────────────────────────────────────────

describe("executionPipeline", () => {
    afterEach(() => {
        pipe.reset();
        rep.reset();
    });

    describe("happy path — clean task approved", () => {
        it("run returns approved:true for clean task", async () => {
            const r = await pipe.run(CLEAN_TASK, {});
            assert.ok(r.approved);
            assert.ok(!r.blocked);
        });

        it("result includes executionId, strategy, checkpoints, metadata, auditId", async () => {
            const r = await pipe.run(CLEAN_TASK, {});
            assert.ok("executionId" in r);
            assert.ok("strategy"    in r);
            assert.ok("checkpoints" in r);
            assert.ok("metadata"    in r);
            assert.ok("auditId"     in r);
        });

        it("blockReasons is empty for approved execution", async () => {
            const r = await pipe.run(CLEAN_TASK, {});
            assert.deepEqual(r.blockReasons, []);
        });

        it("result.result contains execution details", async () => {
            const r = await pipe.run(CLEAN_TASK, {});
            assert.ok("result"          in r);
            assert.ok("stepsPlanned"    in r.result);
            assert.ok("stepsExecuted"   in r.result);
            assert.ok("completedAt"     in r.result);
        });

        it("checkpoints contain all 7 pipeline stages", async () => {
            const r = await pipe.run(CLEAN_TASK, {});
            for (const stage of ["decompose", "simulate", "score", "select_strategy", "verify", "approve", "execute"]) {
                assert.ok(stage in r.checkpoints, `missing checkpoint: ${stage}`);
            }
        });

        it("metadata includes strategy, feasibilityScore, confidence", async () => {
            const r = await pipe.run(CLEAN_TASK, {});
            assert.ok("strategy"         in r.metadata);
            assert.ok("feasibilityScore" in r.metadata);
            assert.ok("confidence"       in r.metadata);
        });
    });

    describe("execution blocking", () => {
        it("cyclic task → blocked with cyclic_dependency reason", async () => {
            const r = await pipe.run(CYCLIC_TASK, {});
            assert.ok(r.blocked);
            assert.ok(r.blockReasons.some(re => re.code === "cyclic_dependency" || re.code === "plan_not_feasible"));
        });

        it("blocked execution has approved:false", async () => {
            const r = await pipe.run(CYCLIC_TASK, {});
            assert.ok(!r.approved);
        });

        it("blocked execution: no result key", async () => {
            const r = await pipe.run(CYCLIC_TASK, {});
            assert.ok(!("result" in r));
        });

        it("missing required env var → blocked with verification_failed", async () => {
            const r = await pipe.run(CLEAN_TASK, { requiredEnv: ["__JARVIS_NEVER_SET_XYZ__"] });
            assert.ok(r.blocked);
            assert.ok(r.blockReasons.some(re => re.code === "verification_failed"));
        });

        it("unsafe command task → blocked", async () => {
            const r = await pipe.run(UNSAFE_TASK, {});
            assert.ok(r.blocked);
            assert.ok(r.blockReasons.length > 0);
        });
    });

    describe("strategy routing", () => {
        it("clean task: strategy is one of the 5 valid strategies", async () => {
            const VALID = ["direct", "staged", "dry_run", "sandbox", "rollback_first"];
            const r     = await pipe.run(CLEAN_TASK, {});
            assert.ok(VALID.includes(r.strategy), `unexpected strategy: ${r.strategy}`);
        });

        it("dry_run strategy: stepsExecuted is empty", async () => {
            // Force dry_run by passing unavailable tools
            const toolTask = {
                id: "tool-task", name: "Tool Task",
                steps: [{ id: "s", name: "S", dependsOn: [], requiredTools: ["ghost-tool-xyz"] }],
            };
            const r = await pipe.run(toolTask, { availableTools: ["node"] });
            // dry_run because unavailable tool, or blocked — either way no execution
            if (!r.blocked && r.result?.dryRun) {
                assert.deepEqual(r.result.stepsExecuted, []);
            }
        });

        it("direct strategy: stepsExecuted includes all planned steps", async () => {
            const r = await pipe.run(CLEAN_TASK, {});
            if (r.result?.mode === "direct") {
                assert.deepEqual(r.result.stepsExecuted, r.result.stepsPlanned);
            }
        });
    });

    describe("observability hooks", () => {
        it("planning_started is emitted", async () => {
            await pipe.run(CLEAN_TASK, {});
            const log = hooks.getLog();
            assert.ok(log.some(e => e.event === "planning_started"));
        });

        it("simulation_completed is emitted", async () => {
            await pipe.run(CLEAN_TASK, {});
            assert.ok(hooks.getLog().some(e => e.event === "simulation_completed"));
        });

        it("strategy_selected is emitted", async () => {
            await pipe.run(CLEAN_TASK, {});
            assert.ok(hooks.getLog().some(e => e.event === "strategy_selected"));
        });

        it("execution_approved emitted for clean task", async () => {
            await pipe.run(CLEAN_TASK, {});
            assert.ok(hooks.getLog().some(e => e.event === "execution_approved"));
        });

        it("execution_blocked emitted for blocked task", async () => {
            await pipe.run(CYCLIC_TASK, {});
            assert.ok(hooks.getLog().some(e => e.event === "execution_blocked"));
        });

        it("verification_completed is emitted", async () => {
            await pipe.run(CLEAN_TASK, {});
            assert.ok(hooks.getLog().some(e => e.event === "verification_completed"));
        });
    });

    describe("audit trail", () => {
        it("audit record created for approved execution", async () => {
            const r = await pipe.run(CLEAN_TASK, {});
            const audit = require("../../agents/runtime/planning/executionAudit.cjs");
            const entries = audit.get(r.executionId);
            assert.ok(entries.length > 0);
            assert.equal(entries[0].taskId, CLEAN_TASK.id);
        });

        it("audit record created for blocked execution", async () => {
            const r = await pipe.run(CYCLIC_TASK, {});
            const audit = require("../../agents/runtime/planning/executionAudit.cjs");
            const entries = audit.get(r.executionId);
            assert.ok(entries.length > 0);
            assert.ok(entries[0].blockingReasons.length > 0);
        });

        it("findByTaskId works after pipeline run", async () => {
            await pipe.run(CLEAN_TASK, {});
            const audit   = require("../../agents/runtime/planning/executionAudit.cjs");
            const entries = audit.findByTaskId(CLEAN_TASK.id);
            assert.ok(entries.length > 0);
        });
    });

    describe("deterministic replay", () => {
        it("same task produces same strategy on repeated calls", async () => {
            const r1 = await pipe.run(CLEAN_TASK, {});
            pipe.reset();
            const r2 = await pipe.run(CLEAN_TASK, {});
            assert.equal(r1.strategy, r2.strategy);
        });

        it("planningReplay.replayFull matches pipeline strategy", async () => {
            const pipeResult   = await pipe.run(CLEAN_TASK, {});
            const replayResult = rep.replayFull(CLEAN_TASK, {});
            assert.equal(pipeResult.strategy, replayResult.strategy.strategy);
        });
    });

    describe("execution metadata", () => {
        it("metadata.simBlockers is array", async () => {
            const r = await pipe.run(CLEAN_TASK, {});
            assert.ok(Array.isArray(r.metadata.simBlockers));
        });

        it("metadata.repairProbability is 0–1", async () => {
            const r = await pipe.run(CLEAN_TASK, {});
            const p = r.metadata.repairProbability;
            assert.ok(p >= 0 && p <= 1, `repairProbability=${p}`);
        });

        it("metadata.rollbackProbability is 0–1", async () => {
            const r = await pipe.run(CLEAN_TASK, {});
            const p = r.metadata.rollbackProbability;
            assert.ok(p >= 0 && p <= 1, `rollbackProbability=${p}`);
        });
    });
});
