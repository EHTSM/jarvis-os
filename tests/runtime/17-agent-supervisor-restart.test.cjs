"use strict";
/**
 * Phase B.11 regression: supervisor start() must be the true inverse of stop().
 *
 * stop() stops every entry in the _agents map. start() only iterated the
 * BUILTIN_AGENTS list — 10 entries — while the live runtime holds 210 agents
 * (10 builtin + 200 added through registerAgent() by the org modules). So a
 * stop→start cycle left 200 agents permanently stopped while
 * getSupervisorStatus() still reported started:true.
 *
 * Reproduced live through the operator controls: POST supervisor/stop then
 * supervisor/start gave runningCount 10/210, and sampling every 6s for 30s
 * showed it stuck there (200 stopped / 10 running, all enabled:true) — not a
 * ramp-up. Emergency stop is a HUMAN OVERSIGHT control, so a partial restore is
 * worse than none: the operator is told the runtime is up while 95% of the
 * fleet is idle.
 *
 * Measured in-process with 22 agents (10 builtin + 12 dynamic):
 *   before fix: {total:22, afterStop:0, afterStart:10, allRestarted:false}
 *   after  fix: {total:22, afterStop:0, afterStart:22, allRestarted:true}
 *
 * These tests pin the inverse relationship and the two exclusions that keep it
 * correct (no double-start of builtins, disabled agents stay off).
 */
const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const SRC = path.join(__dirname, "../../backend/services/agentRuntimeSupervisor.cjs");
const sup = require("../../backend/services/agentRuntimeSupervisor.cjs");

const RUN = `b11-${Date.now().toString(36)}`;

after(() => {
    // Leave the runtime stopped — these tests own the supervisor lifecycle.
    try { sup.stop(); } catch { /* best effort */ }
});

describe("agent supervisor restart symmetry (Phase B.11)", () => {
    it("restarts every registered agent, not just the builtins", () => {
        sup.start();
        for (let i = 0; i < 8; i++) {
            sup.registerAgent({ id: `${RUN}_dyn_${i}`, role: "tester", label: `Dyn ${i}` });
        }
        const total = sup.getSupervisorStatus().agentCount;
        assert.ok(total > 10, "the fixture must include agents beyond the builtin list");

        sup.stop();
        assert.equal(sup.getSupervisorStatus().runningCount, 0, "stop() must stop everything");

        sup.start();
        assert.equal(sup.getSupervisorStatus().runningCount, total,
            "start() must restore every agent stop() stopped — 10/210 was the bug");
    });

    it("leaves no agent in a stopped state after start()", () => {
        sup.start();
        const stopped = (sup.getSupervisorStatus().agents || [])
            .filter(a => a.status !== "running" && a.enabled !== false)
            .map(a => a.id);
        assert.deepEqual(stopped, [], `enabled agents must all be running, stuck: ${stopped.slice(0, 5)}`);
    });

    it("keeps deliberately-disabled agents stopped", () => {
        sup.start();
        const id = `${RUN}_disabled`;
        sup.registerAgent({ id, role: "tester", label: "Disabled probe" });
        if (typeof sup.disableAgent === "function") sup.disableAgent(id);
        else if (typeof sup.setAgentEnabled === "function") sup.setAgentEnabled(id, false);
        else return;   // no disable API in this build — nothing to assert

        sup.stop();
        sup.start();
        const a = (sup.getSupervisorStatus().agents || []).find(x => x.id === id);
        if (a) assert.notEqual(a.status, "running", "a disabled agent must not be restarted");
    });

    it("does not double-start the builtin agents", () => {
        const src = fs.readFileSync(SRC, "utf8");
        const startFn = src.slice(src.indexOf("function start()"));
        assert.ok(/BUILTIN_AGENTS\.some\(s => s\.id === id\)/.test(startFn),
            "the dynamic loop must skip ids already started by the builtin loop");
    });

    it("start() iterates the live agent map, not only a static list", () => {
        const src = fs.readFileSync(SRC, "utf8");
        const startFn = src.slice(src.indexOf("function start()"), src.indexOf("function stop()"));
        assert.ok(/for \(const \[id, state\] of _agents\)/.test(startFn),
            "start() must walk _agents so dynamically-registered agents are covered");
    });

    it("stop() still stops the whole map (the other half of the contract)", () => {
        const src = fs.readFileSync(SRC, "utf8");
        const stopFn = src.slice(src.indexOf("function stop()"));
        assert.ok(/for \(const id of _agents\.keys\(\)\) _stopAgent\(id\)/.test(stopFn),
            "stop() must remain map-wide, or the asymmetry reappears from the other side");
    });
});
