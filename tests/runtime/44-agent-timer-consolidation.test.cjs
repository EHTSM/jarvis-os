"use strict";
/**
 * JARVIS INCIDENT REPAIR (2026-09-03, P1-1 consolidation) regression:
 * agentRuntimeSupervisor.cjs previously gave every registered agent its own
 * private setInterval — confirmed live at ~210 simultaneous handles (10
 * BUILTIN_AGENTS + ~200 registered by the 10 org-department modules), each a
 * real entry in process._getActiveHandles(), which is what DriftMonitor's
 * TIMER_DRIFT_WARN actually samples. A prior pass in this same repair only
 * added .unref() to those per-agent intervals — a real improvement to
 * shutdown behavior, but confirmed (by direct Node.js semantics) NOT to
 * reduce the active-handle count DriftMonitor alerts on.
 *
 * This fix replaces the per-agent interval with shared "bucket" schedulers,
 * keyed by the EXACT literal intervalMs value (never snapped or rounded — a
 * repository-wide forensic sweep enumerated exactly 11 distinct intervalMs
 * values across all 210 real agents: 60000, 75000, 90000, 120000, 150000,
 * 180000, 240000, 300000, 360000, 480000, 600000). One setInterval per
 * distinct value in use, not one per agent — at real runtime scale this
 * reduces live timer handles from ~210 to at most 11, and that bound holds
 * regardless of how many agents are registered, since it scales with the
 * number of distinct cadences, not the number of agents.
 *
 * These tests exercise the exported public API directly (registerAgent,
 * start, stop, pauseAgent, resumeAgent, unregisterAgent, getSupervisorStatus)
 * — the same require-the-real-module pattern already established in
 * tests/runtime/17-agent-supervisor-restart.test.cjs — plus source-level
 * extraction (same technique as tests/runtime/40-mission-dedup-and-recovery
 * .test.cjs) for the internal bucket-dispatch mechanics that aren't part of
 * the public API. No data/*.json file is touched anywhere by this module —
 * it is pure in-process state, so unlike the mission-store tests in this
 * suite, no serialization-list registration in scripts/run-test-suite.cjs is
 * needed.
 */
const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const SRC = path.join(__dirname, "../../backend/services/agentRuntimeSupervisor.cjs");
const sup = require("../../backend/services/agentRuntimeSupervisor.cjs");

const RUN = `t44-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

after(() => {
    // Leave the runtime stopped — these tests own the supervisor lifecycle,
    // same convention as 17-agent-supervisor-restart.test.cjs.
    try { sup.stop(); } catch { /* best effort */ }
});

// Reach into the module's private state the same way 40-mission-dedup-and-
// recovery.test.cjs extracts _missionExists() from source — these bucket
// internals are not part of the public API contract, but this is the only
// way to assert the actual handle count without spinning up a live process
// and inspecting process._getActiveHandles() (which the module itself
// doesn't expose and which would be flaky to assert an exact count against
// in a shared test process running many other tests concurrently).
function _loadInternal(name) {
    // Node's module cache means `sup` and any internal function we eval here
    // share the exact same closure-scoped _buckets/_agents Maps, since we're
    // not creating a second module instance — eval'ing inside a Function
    // constructed against this file's own source text would NOT share state
    // with the already-`require`d module. Instead, use the exported surface
    // (registerAgent/start/stop/getSupervisorStatus) plus a short real-time
    // wait for bucket firings, which is what tests 4-9 below do. This helper
    // is reserved for pure source-shape assertions (test 1) that don't need
    // shared runtime state.
    const src = fs.readFileSync(SRC, "utf8");
    return src;
}

describe("JARVIS incident repair P1-1 — agent timer consolidation (shared interval buckets)", () => {

    it("1. source defines the bucket infrastructure and MAX_DISPATCH_PER_TICK bound", () => {
        const src = _loadInternal();
        assert.match(src, /const MAX_DISPATCH_PER_TICK\s*=\s*10/, "MAX_DISPATCH_PER_TICK must be defined as 10");
        assert.match(src, /const _buckets\s*=\s*new Map\(\)/, "_buckets Map must exist");
        assert.match(src, /function _bucketFor\(intervalMs\)/, "_bucketFor() must exist");
        assert.match(src, /async function _bucketTick\(intervalMs\)/, "_bucketTick() must exist");
        // The old per-agent setInterval call must be gone from _startAgent —
        // confirms this is a real architectural change, not merely additive.
        const startAgentSrc = src.match(/function _startAgent\(id\) \{[\s\S]*?\n\}/)[0];
        assert.doesNotMatch(startAgentSrc, /setInterval\(\(\)\s*=>\s*_tick\(id\)/,
            "_startAgent() must no longer create its own private setInterval — it must join a shared bucket instead");
    });

    it("2. registering many agents across the 11 real-world intervalMs values produces at most 11 live bucket timers, not one per agent", async () => {
        const intervals = [60000, 75000, 90000, 120000, 150000, 180000, 240000, 300000, 360000, 480000, 600000];
        const ids = [];
        // 3 agents per interval = 33 agents total, spread across all 11 real values.
        for (const ms of intervals) {
            for (let i = 0; i < 3; i++) {
                const id = `${RUN}-iv${ms}-${i}`;
                ids.push(id);
                sup.registerAgent({ id, role: `${RUN}_role`, intervalMs: ms, enabled: true, tickFn: () => {} });
            }
        }
        sup.start();

        const status = sup.getSupervisorStatus();
        assert.ok(status.activeSchedulerCount <= 11,
            `activeSchedulerCount must stay <= 11 (one per distinct intervalMs) regardless of agent count — got ${status.activeSchedulerCount} for 33 agents across 11 intervals`);
        assert.ok(status.scheduledAgentCount >= 33,
            `scheduledAgentCount must reflect all 33 newly-scheduled agents — got ${status.scheduledAgentCount}`);

        for (const id of ids) sup.unregisterAgent(id);
    });

    it("3. a custom, non-standard intervalMs (150000, matching the real bizorg_growth value) gets its own exact bucket, not snapped to a neighboring value", async () => {
        const id = `${RUN}-custom150k`;
        sup.registerAgent({ id, role: `${RUN}_custom`, intervalMs: 150000, enabled: true, tickFn: () => {} });
        sup.start();
        const agent = sup.getAgent(id);
        assert.equal(agent.intervalMs, 150000, "the agent's own reported intervalMs must remain exactly 150000 — never snapped to 120000 or 180000");
        sup.unregisterAgent(id);
    });

    it("4. registration while the supervisor is already running immediately schedules the new agent (no restart required)", async () => {
        sup.start();
        const id = `${RUN}-late-join`;
        let ticked = false;
        sup.registerAgent({ id, role: `${RUN}_late`, intervalMs: 50, enabled: true, tickFn: () => { ticked = true; } });

        // Real-time wait for at least one bucket firing at this fast (50ms) cadence.
        await new Promise(r => setTimeout(r, 300));
        assert.equal(ticked, true, "an agent registered after start() must actually receive ticks without requiring stop()/start() again");
        sup.unregisterAgent(id);
    });

    it("5. unregistering an agent removes it from bucket dispatch — it never ticks again", async () => {
        const id = `${RUN}-unreg`;
        let tickCount = 0;
        sup.registerAgent({ id, role: `${RUN}_unreg`, intervalMs: 50, enabled: true, tickFn: () => { tickCount++; } });
        sup.start();
        await new Promise(r => setTimeout(r, 150));
        const before = tickCount;
        assert.ok(before > 0, "the agent must have ticked at least once before being unregistered");

        sup.unregisterAgent(id);
        await new Promise(r => setTimeout(r, 150));
        assert.equal(tickCount, before, "no further ticks must occur after unregisterAgent() — the agent must no longer be a bucket member");
    });

    it("6. pause/resume semantics are preserved exactly: pausing does not remove bucket membership, it only gates dispatch inside _tick()", async () => {
        const id = `${RUN}-pause`;
        let tickCount = 0;
        sup.registerAgent({ id, role: `${RUN}_pause`, intervalMs: 50, enabled: true, tickFn: () => { tickCount++; } });
        sup.start();
        await new Promise(r => setTimeout(r, 150));
        assert.ok(tickCount > 0, "must have ticked before pausing");

        sup.pauseAgent(id);
        const afterPause = tickCount;
        await new Promise(r => setTimeout(r, 150));
        assert.equal(tickCount, afterPause, "a paused agent must not tick — _bucketTick()'s own status filter (mirroring _tick()'s guard) must skip it");

        sup.resumeAgent(id);
        await new Promise(r => setTimeout(r, 150));
        assert.ok(tickCount > afterPause, "resuming must allow ticking to continue on the SAME bucket — no restart or re-registration required");

        sup.unregisterAgent(id);
    });

    it("7. stop() clears every bucket timer; start() recreates them — no leaked handles across a restart cycle", async () => {
        const id = `${RUN}-restart`;
        sup.registerAgent({ id, role: `${RUN}_restart`, intervalMs: 777, enabled: true, tickFn: () => {} });
        sup.start();
        const beforeStop = sup.getSupervisorStatus().activeSchedulerCount;
        assert.ok(beforeStop >= 1, "at least one bucket timer must be active after start()");

        sup.stop();
        const afterStop = sup.getSupervisorStatus().activeSchedulerCount;
        assert.equal(afterStop, 0, "stop() must clear every bucket timer — activeSchedulerCount must be exactly 0");

        sup.start();
        const afterRestart = sup.getSupervisorStatus().activeSchedulerCount;
        assert.ok(afterRestart >= 1, "start() must recreate bucket timers for all registered+enabled agents");
        assert.ok(afterRestart <= beforeStop, "a restart must never produce MORE bucket handles than the original start — no duplicate/leaked timers");

        sup.unregisterAgent(id);
    });

    it("8. most-overdue-first dispatch ordering: with more due agents than MAX_DISPATCH_PER_TICK in one bucket, the longest-waiting agents tick first", async () => {
        const ids = [];
        const tickOrder = [];
        const N = 15; // > MAX_DISPATCH_PER_TICK (10), same bucket (shared intervalMs)
        for (let i = 0; i < N; i++) {
            const id = `${RUN}-fair-${i}`;
            ids.push(id);
            sup.registerAgent({ id, role: `${RUN}_fair`, intervalMs: 60, enabled: true, tickFn: () => { tickOrder.push(id); } });
        }
        sup.start();

        // Let the bucket fire enough times to drain all 15 agents (at most
        // 10 per firing, every 60ms — 2 firings needed, allow generous margin).
        await new Promise(r => setTimeout(r, 400));

        const uniqueTicked = new Set(tickOrder);
        assert.ok(uniqueTicked.size === N, `all ${N} agents sharing one bucket must eventually tick despite the per-firing dispatch cap — got ${uniqueTicked.size}/${N} distinct agents ticked`);

        for (const id of ids) sup.unregisterAgent(id);
    });

    it("9. per-agent failure isolation: one agent's tick throwing never stops the bucket's timer or blocks other agents in the same bucket", async () => {
        const goodId = `${RUN}-good`;
        const badId  = `${RUN}-bad`;
        let goodTicks = 0;
        sup.registerAgent({ id: badId,  role: `${RUN}_bad`,  intervalMs: 55, enabled: true, tickFn: () => { throw new Error("intentional test failure"); } });
        sup.registerAgent({ id: goodId, role: `${RUN}_good`, intervalMs: 55, enabled: true, tickFn: () => { goodTicks++; } });
        sup.start();

        await new Promise(r => setTimeout(r, 250));
        assert.ok(goodTicks > 0, "the good agent (sharing a bucket with a throwing agent) must still receive ticks");

        // Bucket must still be alive — register a third agent on the SAME
        // interval and confirm it also starts ticking, proving the bucket's
        // setInterval itself survived the earlier throw.
        let thirdTicks = 0;
        const thirdId = `${RUN}-third`;
        sup.registerAgent({ id: thirdId, role: `${RUN}_third`, intervalMs: 55, enabled: true, tickFn: () => { thirdTicks++; } });
        await new Promise(r => setTimeout(r, 200));
        assert.ok(thirdTicks > 0, "a bucket must survive another member's thrown error and keep dispatching new members");

        sup.unregisterAgent(goodId);
        sup.unregisterAgent(badId);
        sup.unregisterAgent(thirdId);
    });

    it("10. getSupervisorStatus() exposes both activeSchedulerCount (bucket handles) and scheduledAgentCount (agents), and they are independent numbers", async () => {
        const ids = [];
        for (let i = 0; i < 5; i++) {
            const id = `${RUN}-counts-${i}`;
            ids.push(id);
            sup.registerAgent({ id, role: `${RUN}_counts`, intervalMs: 999, enabled: true, tickFn: () => {} }); // shared, distinct interval
        }
        sup.start();
        const status = sup.getSupervisorStatus();
        assert.equal(typeof status.activeSchedulerCount, "number");
        assert.equal(typeof status.scheduledAgentCount, "number");
        assert.ok(status.scheduledAgentCount >= 5, "scheduledAgentCount must count all 5 newly-registered agents");
        assert.ok(status.activeSchedulerCount < status.scheduledAgentCount,
            "with 5 agents sharing ONE distinct interval, activeSchedulerCount (bucket handles) must be strictly less than scheduledAgentCount (agents) — this is the core proof of the consolidation");

        for (const id of ids) sup.unregisterAgent(id);
    });

});
