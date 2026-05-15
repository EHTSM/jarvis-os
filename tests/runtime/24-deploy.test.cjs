"use strict";
const { describe, it, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const pdv = require("../../agents/runtime/deploy/preDeployValidator.cjs");
const pcd = require("../../agents/runtime/deploy/portConflictDetector.cjs");
const dor = require("../../agents/runtime/deploy/deploymentOrchestrator.cjs");

// ── preDeployValidator — runChecks ────────────────────────────────────────

describe("preDeployValidator — runChecks", () => {
    it("passes when all checks succeed", async () => {
        const r = await pdv.runChecks([
            { name: "always_pass", fn: () => true },
        ]);
        assert.equal(r.passed, true);
        assert.equal(r.score,  100);
        assert.equal(r.failed.length, 0);
    });
    it("fails when any check fails", async () => {
        const r = await pdv.runChecks([
            { name: "pass",      fn: () => true  },
            { name: "fail_me",   fn: () => false },
        ]);
        assert.equal(r.passed, false);
        assert.ok(r.failed.some(f => f.name === "fail_me"));
    });
    it("score is proportional to passing checks", async () => {
        const r = await pdv.runChecks([
            { name: "a", fn: () => true  },
            { name: "b", fn: () => false },
        ]);
        assert.equal(r.score, 50);
    });
    it("handles async check fn", async () => {
        const r = await pdv.runChecks([
            { name: "async_pass", fn: async () => true },
        ]);
        assert.equal(r.passed, true);
    });
    it("handles throwing check fn", async () => {
        const r = await pdv.runChecks([
            { name: "throws", fn: () => { throw new Error("boom"); } },
        ]);
        assert.equal(r.passed, false);
        assert.ok(r.failed[0].note === "boom");
    });
    it("empty checks returns passed:true, score:100", async () => {
        const r = await pdv.runChecks([]);
        assert.equal(r.passed, true);
        assert.equal(r.score,  100);
    });
    it("result has checks array", async () => {
        const r = await pdv.runChecks([{ name: "x", fn: () => true }]);
        assert.ok(Array.isArray(r.checks));
    });
});

describe("preDeployValidator — validate", () => {
    it("empty config returns passed:true", async () => {
        const r = await pdv.validate({});
        assert.equal(r.passed, true);
        assert.equal(r.score,  100);
    });
    it("requiredFiles check: existing file passes", async () => {
        const r = await pdv.validate({ requiredFiles: [__filename] });
        assert.equal(r.passed, true);
    });
    it("requiredFiles check: missing file fails", async () => {
        const r = await pdv.validate({ requiredFiles: ["/tmp/surely-no-such-file-xyz.js"] });
        assert.equal(r.passed, false);
    });
    it("writableDirs check: /tmp is writable", async () => {
        const r = await pdv.validate({ writableDirs: ["/tmp"] });
        assert.equal(r.passed, true);
    });
    it("minFreeMemMB: 1 MB always passes", async () => {
        const r = await pdv.validate({ minFreeMemMB: 1 });
        assert.equal(r.passed, true);
    });
    it("minFreeMemMB: absurdly large fails", async () => {
        const r = await pdv.validate({ minFreeMemMB: 999_999_999 });
        assert.equal(r.passed, false);
    });
    it("custom checks array is honoured", async () => {
        const r = await pdv.validate({
            checks: [{ name: "custom_pass", fn: () => true }],
        });
        assert.equal(r.passed, true);
    });
});

describe("preDeployValidator — check factories", () => {
    it("fileExists factory name contains the path", () => {
        const c = pdv.fileExists("/tmp/some-file.js");
        assert.ok(c.name.includes("/tmp/some-file.js"));
    });
    it("envVarSet factory name contains var name", () => {
        const c = pdv.envVarSet("HOME");
        assert.ok(c.name.includes("HOME"));
    });
    it("dirWritable factory produces named check", () => {
        const c = pdv.dirWritable("/tmp");
        assert.ok(typeof c.name === "string");
        assert.ok(typeof c.fn   === "function");
    });
    it("minFreeMemMB factory check fn returns boolean", async () => {
        const c  = pdv.minFreeMemMB(1);
        const ok = await Promise.resolve(c.fn());
        assert.equal(typeof ok, "boolean");
    });
});

// ── portConflictDetector ──────────────────────────────────────────────────

describe("portConflictDetector — checkPort", () => {
    it("returns { port, available } structure", async () => {
        const r = await pcd.checkPort(0);  // port 0 = OS assigns ephemeral
        assert.ok("port"      in r);
        assert.ok("available" in r);
    });
    it("high port (>40000) is likely available", async () => {
        // Pick a port that is very unlikely to be in use
        const port = 49152 + Math.floor(Math.random() * 1000);
        const r    = await pcd.checkPort(port);
        assert.equal(typeof r.available, "boolean");
    });
});

describe("portConflictDetector — checkPorts", () => {
    it("returns { available, conflicts } arrays", async () => {
        const r = await pcd.checkPorts([49200 + Math.floor(Math.random() * 100)]);
        assert.ok(Array.isArray(r.available));
        assert.ok(Array.isArray(r.conflicts));
    });
    it("available + conflicts covers all input ports", async () => {
        const ports = [49300, 49301];
        const r     = await pcd.checkPorts(ports);
        assert.equal(r.available.length + r.conflicts.length, ports.length);
    });
});

describe("portConflictDetector — findFreePort", () => {
    it("returns a number in the given range", async () => {
        const port = await pcd.findFreePort(49400, 49500);
        assert.ok(port === null || (port >= 49400 && port <= 49500));
    });
    it("returned port is actually available", async () => {
        const port = await pcd.findFreePort(49500, 49600);
        if (port !== null) {
            const r = await pcd.checkPort(port);
            assert.equal(r.available, true);
        }
    });
});

// ── deploymentOrchestrator ────────────────────────────────────────────────

describe("deploymentOrchestrator — successful deploy", () => {
    afterEach(() => dor.reset());

    it("returns success:true for happy-path deploy", async () => {
        const r = await dor.deploy({
            name:        "test-deploy",
            deploy:      async () => ({ deployed: true }),
            healthCheck: async () => ({ healthy: true }),
        });
        assert.equal(r.success, true);
        assert.equal(r.status,  dor.STATUS.HEALTHY);
    });
    it("emits deployment_succeeded event", async () => {
        const r = await dor.deploy({
            name:   "ev-deploy",
            deploy: async () => {},
        });
        assert.ok(r.events.some(e => e.event === "deployment_succeeded"));
    });
    it("getStatus returns record after deploy", async () => {
        const r   = await dor.deploy({ name: "gs-test", deploy: async () => {} });
        const rec = dor.getStatus(r.id);
        assert.ok(rec !== null);
        assert.equal(rec.name, "gs-test");
    });
    it("listDeployments includes the new deployment", async () => {
        await dor.deploy({ name: "list-test", deploy: async () => {} });
        const list = dor.listDeployments();
        assert.ok(list.some(d => d.name === "list-test"));
    });
});

describe("deploymentOrchestrator — validation failure", () => {
    afterEach(() => dor.reset());

    it("returns success:false when validate fn returns false", async () => {
        const r = await dor.deploy({
            name:     "val-fail",
            validate: async () => false,
            deploy:   async () => {},
        });
        assert.equal(r.success, false);
    });
    it("auto-rollback fires when rollback fn provided", async () => {
        let rolled = false;
        await dor.deploy({
            name:     "rb-auto",
            validate: async () => false,
            deploy:   async () => {},
            rollback: async () => { rolled = true; },
        });
        assert.equal(rolled, true);
    });
    it("status is rolled_back after auto-rollback", async () => {
        const r = await dor.deploy({
            name:     "status-rb",
            validate: async () => false,
            deploy:   async () => {},
            rollback: async () => {},
        });
        assert.equal(r.status, dor.STATUS.ROLLEDBACK);
    });
});

describe("deploymentOrchestrator — health check failure", () => {
    afterEach(() => dor.reset());

    it("returns success:false when healthCheck returns healthy:false", async () => {
        const r = await dor.deploy({
            name:        "hc-fail",
            deploy:      async () => {},
            healthCheck: async () => ({ healthy: false }),
        });
        assert.equal(r.success, false);
    });
    it("emits deployment_failed event", async () => {
        const r = await dor.deploy({
            name:        "hc-ev",
            deploy:      async () => {},
            healthCheck: async () => ({ healthy: false }),
        });
        assert.ok(r.events.some(e => e.event === "deployment_failed"));
    });
});

describe("deploymentOrchestrator — manual rollback", () => {
    afterEach(() => dor.reset());

    it("rollback returns ok:true for healthy deployment", async () => {
        const r  = await dor.deploy({ name: "rb-healthy", deploy: async () => {} });
        const rb = await dor.rollback(r.id);
        assert.equal(rb.ok, true);
        assert.equal(rb.status, dor.STATUS.ROLLEDBACK);
    });
    it("rollback returns ok:false for unknown id", async () => {
        const rb = await dor.rollback("no-such-id");
        assert.equal(rb.ok, false);
    });
    it("rolled-back record includes rollback_complete event", async () => {
        const r  = await dor.deploy({ name: "rb-ev", deploy: async () => {} });
        await dor.rollback(r.id);
        const rec = dor.getStatus(r.id);
        assert.ok(rec.events.some(e => e.event === "rollback_complete"));
    });
});
