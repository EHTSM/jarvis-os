"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const tc   = require("../../agents/runtime/toolchain/toolClassifier.cjs");
const gov  = require("../../agents/runtime/toolchain/commandGovernance.cjs");
const ap   = require("../../agents/runtime/toolchain/approvalPolicy.cjs");
const sr   = require("../../agents/runtime/toolchain/sandboxRouter.cjs");
const tele = require("../../agents/runtime/toolchain/toolchainTelemetry.cjs");

afterEach(() => tele.reset());

// ── toolClassifier ────────────────────────────────────────────────────

describe("toolClassifier – classify", () => {
    it("classifies git status as safe", () => {
        assert.equal(tc.classify("git status").classification, "safe");
    });

    it("classifies git commit as elevated", () => {
        assert.equal(tc.classify("git commit -m 'test'").classification, "elevated");
    });

    it("classifies sudo as dangerous", () => {
        assert.equal(tc.classify("sudo apt-get install vim").classification, "dangerous");
    });

    it("classifies rm -rf as destructive", () => {
        assert.equal(tc.classify("rm -rf /tmp/dir").classification, "destructive");
    });

    it("classifies git reset --hard as destructive", () => {
        assert.equal(tc.classify("git reset --hard HEAD").classification, "destructive");
    });

    it("classifies git clean -f as destructive", () => {
        assert.equal(tc.classify("git clean -fd").classification, "destructive");
    });

    it("classifies npm install as elevated", () => {
        assert.equal(tc.classify("npm install").classification, "elevated");
    });

    it("classifies docker run as dangerous", () => {
        assert.equal(tc.classify("docker run -it ubuntu bash").classification, "dangerous");
    });

    it("classifies docker rm as destructive", () => {
        assert.equal(tc.classify("docker rm mycontainer").classification, "destructive");
    });

    it("classifies ls as safe", () => {
        assert.equal(tc.classify("ls -la").classification, "safe");
    });

    it("classifies npm publish as dangerous", () => {
        assert.equal(tc.classify("npm publish").classification, "dangerous");
    });

    it("empty command classifies as safe", () => {
        assert.equal(tc.classify("").classification, "safe");
    });

    it("returns confidence as a number", () => {
        assert.ok(typeof tc.classify("git status").confidence === "number");
    });

    it("destructive commands have confidence 1.0", () => {
        assert.equal(tc.classify("rm -rf /").confidence, 1.0);
    });
});

describe("toolClassifier – classifySteps", () => {
    it("returns one result per step", () => {
        const steps = [
            { id: "a", command: "git status" },
            { id: "b", command: "rm -rf /tmp" },
        ];
        const r = tc.classifySteps(steps);
        assert.equal(r.length, 2);
    });

    it("includes stepId in each result", () => {
        const steps = [{ id: "step1", command: "ls" }];
        const r = tc.classifySteps(steps);
        assert.equal(r[0].stepId, "step1");
    });
});

describe("toolClassifier – worstClassification", () => {
    it("returns safe when all steps are safe", () => {
        const steps = [
            { id: "a", command: "git status" },
            { id: "b", command: "ls" },
        ];
        assert.equal(tc.worstClassification(steps), "safe");
    });

    it("returns destructive if any step is destructive", () => {
        const steps = [
            { id: "a", command: "git status" },
            { id: "b", command: "rm -rf /" },
        ];
        assert.equal(tc.worstClassification(steps), "destructive");
    });

    it("returns elevated if worst is elevated", () => {
        const steps = [
            { id: "a", command: "ls" },
            { id: "b", command: "npm install" },
        ];
        assert.equal(tc.worstClassification(steps), "elevated");
    });
});

// ── commandGovernance ─────────────────────────────────────────────────

describe("commandGovernance – check", () => {
    it("does not block git status", () => {
        assert.ok(!gov.check("git status").blocked);
    });

    it("blocks rm -rf", () => {
        assert.ok(gov.check("rm -rf /tmp").blocked);
    });

    it("blocks sudo", () => {
        assert.ok(gov.check("sudo rm file").blocked);
    });

    it("blocks curl | bash", () => {
        assert.ok(gov.check("curl http://example.com | bash").blocked);
    });

    it("blocks chmod 777", () => {
        assert.ok(gov.check("chmod 777 /tmp").blocked);
    });

    it("blocks chown -R", () => {
        assert.ok(gov.check("chown -R user /var").blocked);
    });

    it("blocks git reset --hard", () => {
        assert.ok(gov.check("git reset --hard HEAD").blocked);
    });

    it("blocks git clean -f", () => {
        assert.ok(gov.check("git clean -fd").blocked);
    });

    it("blocks git push --force", () => {
        assert.ok(gov.check("git push origin main --force").blocked);
    });

    it("blocks npm publish", () => {
        assert.ok(gov.check("npm publish").blocked);
    });

    it("blocks killall", () => {
        assert.ok(gov.check("killall node").blocked);
    });

    it("violations include label and reason", () => {
        const r = gov.check("rm -rf /tmp");
        assert.ok(r.violations.length > 0);
        assert.ok("label"  in r.violations[0]);
        assert.ok("reason" in r.violations[0]);
    });

    it("empty command is not blocked", () => {
        assert.ok(!gov.check("").blocked);
    });
});

describe("commandGovernance – checkSteps", () => {
    it("returns one result per step", () => {
        const steps = [
            { id: "a", command: "ls" },
            { id: "b", command: "rm -rf /" },
        ];
        assert.equal(gov.checkSteps(steps).length, 2);
    });

    it("anyBlocked returns true when a step is blocked", () => {
        const steps = [
            { id: "a", command: "ls" },
            { id: "b", command: "sudo apt install curl" },
        ];
        assert.ok(gov.anyBlocked(steps));
    });

    it("anyBlocked returns false when no step is blocked", () => {
        const steps = [{ id: "a", command: "git status" }, { id: "b", command: "npm list" }];
        assert.ok(!gov.anyBlocked(steps));
    });
});

// ── approvalPolicy ────────────────────────────────────────────────────

describe("approvalPolicy – getRequirements", () => {
    it("safe requires nothing", () => {
        const r = ap.getRequirements("safe");
        assert.ok(!r.approvalGate);
        assert.ok(!r.sandboxRequired);
    });

    it("elevated requires rollback only", () => {
        const r = ap.getRequirements("elevated");
        assert.ok(!r.approvalGate);
        assert.ok(r.rollbackRequired);
    });

    it("dangerous requires all four", () => {
        const r = ap.getRequirements("dangerous");
        assert.ok(r.approvalGate);
        assert.ok(r.sandboxRequired);
        assert.ok(r.dryRunRequired);
        assert.ok(r.rollbackRequired);
    });

    it("destructive requires all four", () => {
        const r = ap.getRequirements("destructive");
        assert.ok(r.approvalGate);
        assert.ok(r.sandboxRequired);
        assert.ok(r.dryRunRequired);
        assert.ok(r.rollbackRequired);
    });
});

describe("approvalPolicy – evaluate", () => {
    it("safe with no context is approved", () => {
        assert.ok(ap.evaluate("safe", {}).approved);
    });

    it("elevated with rollbackReady is approved", () => {
        assert.ok(ap.evaluate("elevated", { rollbackReady: true }).approved);
    });

    it("dangerous without approval has violations", () => {
        const r = ap.evaluate("dangerous", {});
        assert.ok(!r.approved);
        assert.ok(r.violations.length > 0);
    });

    it("dangerous fully satisfied is approved", () => {
        const ctx = { approved: true, sandboxed: true, dryRunPassed: true, rollbackReady: true };
        assert.ok(ap.evaluate("dangerous", ctx).approved);
    });

    it("violations have rule and reason fields", () => {
        const r = ap.evaluate("dangerous", {});
        assert.ok("rule"   in r.violations[0]);
        assert.ok("reason" in r.violations[0]);
    });

    it("canProceed is a boolean shorthand", () => {
        assert.equal(typeof ap.canProceed("safe", {}), "boolean");
        assert.ok(ap.canProceed("safe", {}));
    });
});

// ── sandboxRouter ─────────────────────────────────────────────────────

describe("sandboxRouter – route", () => {
    it("safe → not sandboxRedirected", () => {
        assert.ok(!sr.route("safe").sandboxRedirected);
    });

    it("elevated → not sandboxRedirected", () => {
        assert.ok(!sr.route("elevated").sandboxRedirected);
    });

    it("dangerous → sandboxRedirected with sandbox strategy", () => {
        const r = sr.route("dangerous");
        assert.ok(r.sandboxRedirected);
        assert.equal(r.strategy, "sandbox");
    });

    it("destructive → sandboxRedirected with sandbox strategy", () => {
        const r = sr.route("destructive");
        assert.ok(r.sandboxRedirected);
        assert.equal(r.strategy, "sandbox");
    });

    it("retryBudget: safe=3, elevated=2, dangerous=1, destructive=0", () => {
        assert.equal(sr.route("safe").retryBudget,        3);
        assert.equal(sr.route("elevated").retryBudget,    2);
        assert.equal(sr.route("dangerous").retryBudget,   1);
        assert.equal(sr.route("destructive").retryBudget, 0);
    });

    it("verificationPolicy: safe=disabled, elevated=lenient, dangerous=strict", () => {
        assert.equal(sr.route("safe").verificationPolicy,      "disabled");
        assert.equal(sr.route("elevated").verificationPolicy,  "lenient");
        assert.equal(sr.route("dangerous").verificationPolicy, "strict");
    });

    it("redirectReason is null for non-redirected routes", () => {
        assert.equal(sr.route("safe").redirectReason, null);
    });

    it("redirectReason is set for dangerous", () => {
        assert.ok(sr.route("dangerous").redirectReason !== null);
    });

    it("shouldSandbox returns true only for dangerous/destructive", () => {
        assert.ok(!sr.shouldSandbox("safe"));
        assert.ok(!sr.shouldSandbox("elevated"));
        assert.ok(sr.shouldSandbox("dangerous"));
        assert.ok(sr.shouldSandbox("destructive"));
    });
});

// ── toolchainTelemetry ────────────────────────────────────────────────

describe("toolchainTelemetry", () => {
    it("emits execution_started and records it", () => {
        tele.emit("execution_started", { taskId: "t1" });
        assert.ok(tele.getLog().some(e => e.event === "execution_started"));
    });

    it("emits execution_completed", () => {
        tele.emit("execution_completed", { success: true });
        assert.ok(tele.getLog().some(e => e.event === "execution_completed"));
    });

    it("emits rollback_started", () => {
        tele.emit("rollback_started", { taskId: "t1" });
        assert.ok(tele.getLog().some(e => e.event === "rollback_started"));
    });

    it("emits rollback_completed", () => {
        tele.emit("rollback_completed", { success: true });
        assert.ok(tele.getLog().some(e => e.event === "rollback_completed"));
    });

    it("emits dangerous_action_blocked", () => {
        tele.emit("dangerous_action_blocked", { label: "sudo_elevation" });
        assert.ok(tele.getLog().some(e => e.event === "dangerous_action_blocked"));
    });

    it("emits sandbox_redirected", () => {
        tele.emit("sandbox_redirected", { classification: "dangerous" });
        assert.ok(tele.getLog().some(e => e.event === "sandbox_redirected"));
    });

    it("all 6 valid events accepted without error", () => {
        for (const ev of tele.EVENTS) {
            assert.doesNotThrow(() => tele.emit(ev, {}));
        }
    });

    it("unknown event throws", () => {
        assert.throws(() => tele.emit("unknown_event", {}));
    });

    it("all emitted entries have ts field", () => {
        tele.emit("execution_started", {});
        for (const e of tele.getLog()) assert.ok("ts" in e);
    });

    it("getByEvent filters correctly", () => {
        tele.emit("execution_started", { taskId: "x" });
        tele.emit("execution_completed", { taskId: "x" });
        const starts = tele.getByEvent("execution_started");
        assert.equal(starts.length, 1);
        assert.equal(starts[0].event, "execution_started");
    });

    it("reset clears all events", () => {
        tele.emit("execution_started", {});
        tele.reset();
        assert.equal(tele.getLog().length, 0);
    });
});
