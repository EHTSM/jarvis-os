"use strict";
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const sandboxManager  = require("../../agents/runtime/execution-adapters/executionSandboxManager.cjs");
const policyEngine    = require("../../agents/runtime/execution-adapters/runtimeExecutionPolicyEngine.cjs");
const riskAnalyzer    = require("../../agents/runtime/execution-adapters/executionRiskAnalyzer.cjs");
const circuitBreaker  = require("../../agents/runtime/execution-adapters/executionCircuitBreaker.cjs");
const auditLedger     = require("../../agents/runtime/execution-adapters/executionAuditLedger.cjs");
const terminalAdapter = require("../../agents/runtime/execution-adapters/terminalExecutionAdapter.cjs");
const adapterManager  = require("../../agents/runtime/execution-adapters/runtimeExecutionAdapterManager.cjs");

// ── executionSandboxManager ───────────────────────────────────────────

describe("executionSandboxManager", () => {
    beforeEach(() => sandboxManager.reset());

    it("creates a sandbox with workspace and quota", () => {
        const r = sandboxManager.createSandbox({
            workflowId: "wf-1", sourceSubsystem: "scheduler",
            workspaceRoot: "/workspace", maxExecutions: 10,
        });
        assert.equal(r.created, true);
        assert.ok(r.sandboxId.startsWith("sandbox-"));
        assert.equal(r.maxExecutions, 10);
    });

    it("rejects sandbox creation without workflowId", () => {
        const r = sandboxManager.createSandbox({ sourceSubsystem: "s" });
        assert.equal(r.created, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("rejects sandbox creation without sourceSubsystem", () => {
        const r = sandboxManager.createSandbox({ workflowId: "wf" });
        assert.equal(r.created, false);
        assert.equal(r.reason, "sourceSubsystem_required");
    });

    it("clamps sandbox timeout to MAX_TIMEOUT", () => {
        const r = sandboxManager.createSandbox({
            workflowId: "wf", sourceSubsystem: "s", timeoutMs: 999999,
        });
        assert.ok(r.timeoutMs <= sandboxManager.DEFAULT_TIMEOUT * 6);
    });

    it("allocates an execution slot and tracks quota", () => {
        const { sandboxId } = sandboxManager.createSandbox({
            workflowId: "wf", sourceSubsystem: "s", maxExecutions: 5,
        });
        const r = sandboxManager.allocateExecution({ sandboxId, executionId: "exec-1" });
        assert.equal(r.allocated, true);
        assert.equal(r.remaining, 4);
    });

    it("marks sandbox exhausted when quota is reached", () => {
        const { sandboxId } = sandboxManager.createSandbox({
            workflowId: "wf", sourceSubsystem: "s", maxExecutions: 2,
        });
        sandboxManager.allocateExecution({ sandboxId, executionId: "e1" });
        sandboxManager.allocateExecution({ sandboxId, executionId: "e2" });
        const state = sandboxManager.getSandboxState(sandboxId);
        assert.equal(state.state, "exhausted");
    });

    it("blocks allocation on exhausted sandbox", () => {
        const { sandboxId } = sandboxManager.createSandbox({
            workflowId: "wf", sourceSubsystem: "s", maxExecutions: 1,
        });
        sandboxManager.allocateExecution({ sandboxId, executionId: "e1" });
        const r = sandboxManager.allocateExecution({ sandboxId, executionId: "e2" });
        assert.equal(r.allocated, false);
        assert.equal(r.reason, "sandbox_quota_exhausted");
    });

    it("releases an execution slot", () => {
        const { sandboxId } = sandboxManager.createSandbox({
            workflowId: "wf", sourceSubsystem: "s",
        });
        sandboxManager.allocateExecution({ sandboxId, executionId: "e1" });
        const r = sandboxManager.releaseExecution({ sandboxId, executionId: "e1" });
        assert.equal(r.released, true);
        assert.equal(r.activeCount, 0);
    });

    it("validateSandboxBounds detects path traversal", () => {
        const { sandboxId } = sandboxManager.createSandbox({
            workflowId: "wf", sourceSubsystem: "s", workspaceRoot: "/workspace",
        });
        const v = sandboxManager.validateSandboxBounds({
            sandboxId, path: "/workspace/../etc/passwd",
        });
        assert.equal(v.valid, false);
        assert.ok(v.violations.some(v => v.includes("path_traversal")));
    });

    it("validateSandboxBounds detects path outside workspace", () => {
        const { sandboxId } = sandboxManager.createSandbox({
            workflowId: "wf", sourceSubsystem: "s", workspaceRoot: "/workspace",
        });
        const v = sandboxManager.validateSandboxBounds({ sandboxId, path: "/home/user/file.txt" });
        assert.equal(v.valid, false);
        assert.ok(v.violations.some(v => v.includes("outside_workspace")));
    });

    it("validateSandboxBounds rejects capability not in scope", () => {
        const { sandboxId } = sandboxManager.createSandbox({
            workflowId: "wf", sourceSubsystem: "s",
            capabilities: ["read_file", "list_directory"],
        });
        const v = sandboxManager.validateSandboxBounds({ sandboxId, capability: "delete_file" });
        assert.equal(v.valid, false);
        assert.ok(v.violations.some(v => v.includes("capability_not_in_scope")));
    });

    it("terminates a sandbox (terminal state)", () => {
        const { sandboxId } = sandboxManager.createSandbox({
            workflowId: "wf", sourceSubsystem: "s",
        });
        const r = sandboxManager.terminateSandbox({ sandboxId });
        assert.equal(r.terminated, true);
        assert.equal(sandboxManager.getSandboxState(sandboxId).state, "terminated");
    });

    it("blocks allocation on terminated sandbox", () => {
        const { sandboxId } = sandboxManager.createSandbox({
            workflowId: "wf", sourceSubsystem: "s",
        });
        sandboxManager.terminateSandbox({ sandboxId });
        const r = sandboxManager.allocateExecution({ sandboxId, executionId: "e1" });
        assert.equal(r.allocated, false);
    });

    it("quarantines a sandbox (terminal, blocks all)", () => {
        const { sandboxId } = sandboxManager.createSandbox({
            workflowId: "wf", sourceSubsystem: "s",
        });
        sandboxManager.quarantineSandbox({ sandboxId });
        const r = sandboxManager.allocateExecution({ sandboxId, executionId: "e1" });
        assert.equal(r.allocated, false);
    });

    it("getSandboxMetrics tracks state distribution", () => {
        sandboxManager.createSandbox({ workflowId: "w1", sourceSubsystem: "s" });
        const { sandboxId } = sandboxManager.createSandbox({ workflowId: "w2", sourceSubsystem: "s" });
        sandboxManager.terminateSandbox({ sandboxId });
        const m = sandboxManager.getSandboxMetrics();
        assert.equal(m.totalSandboxes, 2);
        assert.equal(m.activeSandboxes, 1);
        assert.equal(m.terminatedSandboxes, 1);
    });
});

// ── runtimeExecutionPolicyEngine ──────────────────────────────────────

describe("runtimeExecutionPolicyEngine", () => {
    beforeEach(() => policyEngine.reset());

    it("registers an allow policy", () => {
        const r = policyEngine.registerPolicy({
            name: "allow_terminal_operator",
            adapterTypes: ["terminal"],
            minAuthority: "operator",
            effect: "allow",
        });
        assert.equal(r.registered, true);
        assert.ok(r.policyId.startsWith("policy-"));
    });

    it("rejects policy without name", () => {
        const r = policyEngine.registerPolicy({ effect: "allow" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "name_required");
    });

    it("rejects policy with invalid effect", () => {
        const r = policyEngine.registerPolicy({ name: "p", effect: "maybe" });
        assert.equal(r.registered, false);
        assert.ok(r.reason.includes("invalid_effect"));
    });

    it("evaluatePolicy allows with matching allow policy", () => {
        policyEngine.registerPolicy({
            name: "allow_git_observer",
            adapterTypes: ["git"],
            minAuthority: "observer",
            effect: "allow",
        });
        const r = policyEngine.evaluatePolicy({
            adapterType: "git", authorityLevel: "observer",
            riskScore: 0.1, trustScore: 1.0, sandboxActive: false,
        });
        assert.equal(r.allowed, true);
        assert.equal(r.reason, "policy_allow");
    });

    it("evaluatePolicy denies when no matching policy (deny-by-default)", () => {
        // No policies registered
        const r = policyEngine.evaluatePolicy({
            adapterType: "terminal", authorityLevel: "operator",
            riskScore: 0.1, trustScore: 1.0,
        });
        assert.equal(r.allowed, false);
        assert.equal(r.reason, "no_matching_policy");
    });

    it("evaluatePolicy denies when authority below policy minimum", () => {
        policyEngine.registerPolicy({
            name: "allow_terminal_operator",
            adapterTypes: ["terminal"],
            minAuthority: "operator",
            effect: "allow",
        });
        const r = policyEngine.evaluatePolicy({
            adapterType: "terminal", authorityLevel: "observer",
            riskScore: 0.1, trustScore: 1.0,
        });
        assert.equal(r.allowed, false);
        assert.equal(r.reason, "no_matching_policy");
    });

    it("evaluatePolicy denies when risk exceeds policy ceiling", () => {
        policyEngine.registerPolicy({
            name: "low_risk_only",
            adapterTypes: ["*"],
            minAuthority: "observer",
            maxRiskScore: 0.3,
            effect: "allow",
        });
        const r = policyEngine.evaluatePolicy({
            adapterType: "terminal", authorityLevel: "operator",
            riskScore: 0.5, trustScore: 1.0,
        });
        assert.equal(r.allowed, false);
    });

    it("deny policy takes precedence over allow policy (higher priority)", () => {
        policyEngine.registerPolicy({
            name: "allow_all", adapterTypes: ["*"],
            minAuthority: "observer", effect: "allow", priority: 5,
        });
        policyEngine.registerPolicy({
            name: "deny_terminal", adapterTypes: ["terminal"],
            minAuthority: "observer", effect: "deny", priority: 10,
        });
        const r = policyEngine.evaluatePolicy({
            adapterType: "terminal", authorityLevel: "operator",
            riskScore: 0.1, trustScore: 1.0,
        });
        assert.equal(r.allowed, false);
        assert.equal(r.policyName, "deny_terminal");
    });

    it("globalDenyMode blocks all executions", () => {
        policyEngine.registerPolicy({
            name: "allow_all", adapterTypes: ["*"],
            minAuthority: "observer", effect: "allow",
        });
        policyEngine.setGlobalDenyMode(true);
        const r = policyEngine.evaluatePolicy({
            adapterType: "git", authorityLevel: "governor",
            riskScore: 0, trustScore: 1.0,
        });
        assert.equal(r.allowed, false);
        assert.equal(r.reason, "global_deny_mode");
    });

    it("policy respects minTrustScore", () => {
        policyEngine.registerPolicy({
            name: "trusted_only", adapterTypes: ["*"],
            minAuthority: "observer", minTrustScore: 0.8, effect: "allow",
        });
        const r = policyEngine.evaluatePolicy({
            adapterType: "filesystem", authorityLevel: "operator",
            riskScore: 0, trustScore: 0.5,
        });
        assert.equal(r.allowed, false);
    });

    it("policy respects requireSandbox", () => {
        policyEngine.registerPolicy({
            name: "sandbox_required", adapterTypes: ["*"],
            minAuthority: "observer", requireSandbox: true, effect: "allow",
        });
        const r = policyEngine.evaluatePolicy({
            adapterType: "filesystem", authorityLevel: "operator",
            riskScore: 0, trustScore: 1.0, sandboxActive: false,
        });
        assert.equal(r.allowed, false);
    });

    it("removePolicy removes a registered policy", () => {
        const { policyId } = policyEngine.registerPolicy({
            name: "temp", adapterTypes: ["*"], minAuthority: "observer", effect: "allow",
        });
        policyEngine.removePolicy({ policyId });
        const r = policyEngine.evaluatePolicy({
            adapterType: "git", authorityLevel: "observer", riskScore: 0, trustScore: 1.0,
        });
        assert.equal(r.allowed, false);
    });

    it("getPolicyMetrics tracks totals and evaluations", () => {
        policyEngine.registerPolicy({ name: "p1", adapterTypes: ["*"], minAuthority: "observer", effect: "allow" });
        policyEngine.registerPolicy({ name: "p2", adapterTypes: ["*"], minAuthority: "observer", effect: "deny", priority: 10 });
        policyEngine.evaluatePolicy({ adapterType: "git", authorityLevel: "observer", riskScore: 0, trustScore: 1 });
        const m = policyEngine.getPolicyMetrics();
        assert.equal(m.totalPolicies, 2);
        assert.equal(m.allowPolicies, 1);
        assert.equal(m.denyPolicies, 1);
        assert.equal(m.totalEvaluations, 1);
    });
});

// ── executionRiskAnalyzer ─────────────────────────────────────────────

describe("executionRiskAnalyzer", () => {
    beforeEach(() => riskAnalyzer.reset());

    it("analyzes low-risk echo command", () => {
        const r = riskAnalyzer.analyzeCommandRisk({ command: "echo hello" });
        assert.equal(r.riskClass, "safe");
        assert.ok(r.riskScore < 0.30);
    });

    it("analyzes higher-risk find command", () => {
        const r = riskAnalyzer.analyzeCommandRisk({ command: "find /workspace -name *.js" });
        assert.ok(r.riskScore > 0.1);
        assert.ok(r.factors.some(f => f.includes("wildcard")));
    });

    it("detects sensitive keyword in argument", () => {
        const r = riskAnalyzer.analyzeCommandRisk({ command: "grep password /workspace/config.js" });
        assert.ok(r.riskScore > 0.3);
        assert.ok(r.factors.some(f => f.includes("sensitive_keyword")));
    });

    it("detects absolute path argument", () => {
        const r = riskAnalyzer.analyzeCommandRisk({ command: "ls /workspace/src" });
        assert.ok(r.factors.some(f => f.includes("absolute_path")));
    });

    it("returns restricted class for missing command", () => {
        const r = riskAnalyzer.analyzeCommandRisk({ command: null });
        assert.equal(r.riskClass, "restricted");
        assert.equal(r.riskScore, 1.0);
    });

    it("analyzes low-risk file read operation", () => {
        const r = riskAnalyzer.analyzeFilesystemRisk({ path: "/workspace/src/index.js", operation: "read" });
        assert.ok(r.riskScore < 0.30);
        assert.equal(r.riskClass, "safe");
    });

    it("analyzes high-risk delete operation", () => {
        const r = riskAnalyzer.analyzeFilesystemRisk({ path: "/workspace/src/file.js", operation: "delete" });
        assert.ok(r.riskScore >= 0.50);
    });

    it("detects sensitive path in filesystem risk", () => {
        const r = riskAnalyzer.analyzeFilesystemRisk({ path: "/workspace/.env", operation: "read" });
        assert.ok(r.riskScore > 0.40);
        assert.ok(r.factors.some(f => f.includes("sensitive_path")));
    });

    it("shallow paths get higher risk penalty", () => {
        const deep   = riskAnalyzer.analyzeFilesystemRisk({ path: "/workspace/a/b/c/file.js", operation: "write" });
        const shallow = riskAnalyzer.analyzeFilesystemRisk({ path: "/workspace/file.js", operation: "write" });
        assert.ok(shallow.riskScore >= deep.riskScore);
    });

    it("analyzes workflow risk from trust score", () => {
        const high = riskAnalyzer.analyzeWorkflowRisk({ workflowId: "wf", trustScore: 0.9 });
        const low  = riskAnalyzer.analyzeWorkflowRisk({ workflowId: "wf", trustScore: 0.1 });
        assert.ok(high.riskScore < low.riskScore);
    });

    it("recovery mode increases workflow risk", () => {
        const normal   = riskAnalyzer.analyzeWorkflowRisk({ workflowId: "wf", trustScore: 0.8 });
        const recovery = riskAnalyzer.analyzeWorkflowRisk({ workflowId: "wf", trustScore: 0.8, recoveryMode: true });
        assert.ok(recovery.riskScore > normal.riskScore);
    });

    it("computeCompositeRisk blends scores with weights", () => {
        const r = riskAnalyzer.computeCompositeRisk({
            commandScore: 0.6, filesystemScore: 0.4, workflowScore: 0.2,
            authorityLevel: "operator",
        });
        assert.ok(r.compositeScore > 0);
        assert.ok(r.compositeScore <= 1.0);
        assert.ok(r.breakdown.commandScore === 0.6);
    });

    it("getRiskMetrics tracks analysis history", () => {
        riskAnalyzer.analyzeCommandRisk({ command: "echo hi" });
        riskAnalyzer.analyzeFilesystemRisk({ path: "/workspace/a.js", operation: "read" });
        const m = riskAnalyzer.getRiskMetrics();
        assert.equal(m.totalAnalyses, 2);
        assert.ok(m.byType.command >= 1);
        assert.ok(m.byType.filesystem >= 1);
    });
});

// ── executionCircuitBreaker ───────────────────────────────────────────

describe("executionCircuitBreaker", () => {
    beforeEach(() => circuitBreaker.reset());

    it("starts in closed state", () => {
        const allowed = circuitBreaker.isAllowed({ adapterType: "terminal" });
        assert.equal(allowed.allowed, true);
        assert.equal(allowed.breakerState, "closed");
        const s = circuitBreaker.getBreakerState("terminal");
        assert.equal(s.state, "closed");
    });

    it("records ok outcome without tripping", () => {
        const r = circuitBreaker.recordOutcome({ adapterType: "terminal", outcome: "ok" });
        assert.equal(r.recorded, true);
        assert.equal(r.breakerState, "closed");
    });

    it("rejects record without adapterType", () => {
        const r = circuitBreaker.recordOutcome({ outcome: "ok" });
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "adapterType_required");
    });

    it("trips breaker after failure threshold", () => {
        circuitBreaker.configureBreaker({ adapterType: "terminal", failureThreshold: 3, windowSize: 5 });
        for (let i = 0; i < 3; i++)
            circuitBreaker.recordOutcome({ adapterType: "terminal", outcome: "error" });
        const s = circuitBreaker.getBreakerState("terminal");
        assert.equal(s.state, "open");
    });

    it("isAllowed returns false when breaker is open", () => {
        circuitBreaker.configureBreaker({ adapterType: "docker", failureThreshold: 2, windowSize: 5 });
        circuitBreaker.recordOutcome({ adapterType: "docker", outcome: "error", timestamp: 1000 });
        circuitBreaker.recordOutcome({ adapterType: "docker", outcome: "error", timestamp: 1001 });
        const r = circuitBreaker.isAllowed({ adapterType: "docker", timestamp: 2000 });
        assert.equal(r.allowed, false);
        assert.equal(r.breakerState, "open");
    });

    it("transitions to half_open after cooldown", () => {
        circuitBreaker.configureBreaker({ adapterType: "git", failureThreshold: 2, windowSize: 5, cooldownMs: 1000 });
        circuitBreaker.recordOutcome({ adapterType: "git", outcome: "error", timestamp: 0 });
        circuitBreaker.recordOutcome({ adapterType: "git", outcome: "error", timestamp: 1 });
        const r = circuitBreaker.isAllowed({ adapterType: "git", timestamp: 2000 });
        assert.equal(r.allowed, true);
        assert.equal(r.breakerState, "half_open");
    });

    it("closes circuit after successes in half_open", () => {
        circuitBreaker.configureBreaker({
            adapterType: "browser", failureThreshold: 2, successThreshold: 2,
            windowSize: 5, cooldownMs: 100,
        });
        circuitBreaker.recordOutcome({ adapterType: "browser", outcome: "error", timestamp: 0 });
        circuitBreaker.recordOutcome({ adapterType: "browser", outcome: "error", timestamp: 1 });
        // Trigger half_open via cooldown
        circuitBreaker.isAllowed({ adapterType: "browser", timestamp: 500 });
        // Two successes should close
        circuitBreaker.recordOutcome({ adapterType: "browser", outcome: "ok", timestamp: 501 });
        circuitBreaker.recordOutcome({ adapterType: "browser", outcome: "ok", timestamp: 502 });
        const s = circuitBreaker.getBreakerState("browser");
        assert.equal(s.state, "closed");
    });

    it("any failure in half_open reopens circuit", () => {
        circuitBreaker.configureBreaker({
            adapterType: "filesystem", failureThreshold: 2, windowSize: 5, cooldownMs: 100,
        });
        circuitBreaker.recordOutcome({ adapterType: "filesystem", outcome: "error", timestamp: 0 });
        circuitBreaker.recordOutcome({ adapterType: "filesystem", outcome: "error", timestamp: 1 });
        circuitBreaker.isAllowed({ adapterType: "filesystem", timestamp: 500 });
        circuitBreaker.recordOutcome({ adapterType: "filesystem", outcome: "error", timestamp: 501 });
        const s = circuitBreaker.getBreakerState("filesystem");
        assert.equal(s.state, "open");
    });

    it("resetBreaker forces circuit to closed", () => {
        circuitBreaker.configureBreaker({ adapterType: "vscode", failureThreshold: 2, windowSize: 5 });
        circuitBreaker.recordOutcome({ adapterType: "vscode", outcome: "error" });
        circuitBreaker.recordOutcome({ adapterType: "vscode", outcome: "error" });
        circuitBreaker.resetBreaker({ adapterType: "vscode" });
        assert.equal(circuitBreaker.getBreakerState("vscode").state, "closed");
    });

    it("configureBreaker overrides default config", () => {
        circuitBreaker.configureBreaker({ adapterType: "git", failureThreshold: 1, windowSize: 3 });
        const s = circuitBreaker.getBreakerState("git");
        assert.equal(s.config.failureThreshold, 1);
    });

    it("getBreakerMetrics tracks open vs closed count", () => {
        circuitBreaker.configureBreaker({ adapterType: "a1", failureThreshold: 1, windowSize: 5 });
        circuitBreaker.recordOutcome({ adapterType: "a1", outcome: "ok" });
        circuitBreaker.configureBreaker({ adapterType: "a2", failureThreshold: 1, windowSize: 5 });
        circuitBreaker.recordOutcome({ adapterType: "a2", outcome: "error" });
        const m = circuitBreaker.getBreakerMetrics();
        assert.equal(m.totalBreakers, 2);
        assert.ok(m.openBreakers >= 1);
        assert.ok(m.closedBreakers >= 1);
    });
});

// ── executionAuditLedger ──────────────────────────────────────────────

describe("executionAuditLedger", () => {
    beforeEach(() => auditLedger.reset());

    it("appends an event and returns sequenceNumber", () => {
        const r = auditLedger.appendEvent({
            adapterType: "terminal", operation: "execute_command",
            authorityLevel: "operator", workflowId: "wf-1",
            outcome: "submitted",
        });
        assert.equal(r.appended, true);
        assert.equal(r.sequenceNumber, 1);
        assert.ok(r.eventId.startsWith("audit-"));
    });

    it("rejects append without adapterType", () => {
        const r = auditLedger.appendEvent({ outcome: "submitted" });
        assert.equal(r.appended, false);
        assert.equal(r.reason, "adapterType_required");
    });

    it("rejects append without outcome", () => {
        const r = auditLedger.appendEvent({ adapterType: "terminal" });
        assert.equal(r.appended, false);
        assert.equal(r.reason, "outcome_required");
    });

    it("events are frozen (immutable)", () => {
        auditLedger.appendEvent({ adapterType: "git", outcome: "submitted" });
        const events = auditLedger.getEventsByAdapter("git");
        assert.ok(Object.isFrozen(events[0]));
    });

    it("sequence numbers are monotonically increasing", () => {
        for (let i = 0; i < 5; i++)
            auditLedger.appendEvent({ adapterType: "terminal", outcome: "submitted" });
        const all = auditLedger.getEventsByAdapter("terminal");
        for (let i = 0; i < all.length - 1; i++)
            assert.ok(all[i + 1].sequenceNumber > all[i].sequenceNumber);
    });

    it("getEventsByWorkflow returns matching events", () => {
        auditLedger.appendEvent({ adapterType: "terminal", outcome: "submitted", workflowId: "wf-A" });
        auditLedger.appendEvent({ adapterType: "git", outcome: "submitted", workflowId: "wf-B" });
        auditLedger.appendEvent({ adapterType: "filesystem", outcome: "policy_denied", workflowId: "wf-A" });
        const events = auditLedger.getEventsByWorkflow("wf-A");
        assert.equal(events.length, 2);
        assert.ok(events.every(e => e.workflowId === "wf-A"));
    });

    it("getEventsByAdapter filters by adapter", () => {
        auditLedger.appendEvent({ adapterType: "terminal", outcome: "submitted" });
        auditLedger.appendEvent({ adapterType: "git", outcome: "submitted" });
        const termEvents = auditLedger.getEventsByAdapter("terminal");
        assert.equal(termEvents.length, 1);
    });

    it("getEventsByCorrelation groups correlated events", () => {
        auditLedger.appendEvent({ adapterType: "terminal", outcome: "submitted", correlationId: "corr-1" });
        auditLedger.appendEvent({ adapterType: "terminal", outcome: "completed", correlationId: "corr-1" });
        auditLedger.appendEvent({ adapterType: "git", outcome: "submitted", correlationId: "corr-2" });
        const corr = auditLedger.getEventsByCorrelation("corr-1");
        assert.equal(corr.length, 2);
    });

    it("getEventsByOutcome filters by outcome", () => {
        auditLedger.appendEvent({ adapterType: "terminal", outcome: "submitted" });
        auditLedger.appendEvent({ adapterType: "filesystem", outcome: "policy_denied" });
        auditLedger.appendEvent({ adapterType: "git", outcome: "submitted" });
        const denied = auditLedger.getEventsByOutcome("policy_denied");
        assert.equal(denied.length, 1);
    });

    it("verifyLedgerIntegrity confirms intact sequence", () => {
        for (let i = 0; i < 3; i++)
            auditLedger.appendEvent({ adapterType: "terminal", outcome: "submitted" });
        const v = auditLedger.verifyLedgerIntegrity();
        assert.equal(v.intact, true);
        assert.equal(v.eventCount, 3);
        assert.equal(v.lastSequence, 3);
    });

    it("getLedgerMetrics reports byOutcome and byAdapter", () => {
        auditLedger.appendEvent({ adapterType: "terminal", outcome: "submitted", authorityLevel: "operator" });
        auditLedger.appendEvent({ adapterType: "terminal", outcome: "policy_denied", authorityLevel: "observer" });
        const m = auditLedger.getLedgerMetrics();
        assert.equal(m.totalEvents, 2);
        assert.equal(m.byOutcome.submitted, 1);
        assert.equal(m.byOutcome.policy_denied, 1);
        assert.equal(m.byAdapter.terminal, 2);
        assert.equal(m.deniedCount, 1);
    });
});

// ── terminalExecutionAdapter (real execution upgrade) ─────────────────

describe("terminalExecutionAdapter — simulation and tokenization", () => {
    beforeEach(() => terminalAdapter.reset());

    it("tokenizeArgv accepts clean allowlisted command", () => {
        const r = terminalAdapter.tokenizeArgv("echo hello world");
        assert.equal(r.valid, true);
        assert.deepEqual(r.tokens, ["echo", "hello", "world"]);
    });

    it("tokenizeArgv rejects pipe character", () => {
        const r = terminalAdapter.tokenizeArgv("ls | grep foo");
        assert.equal(r.valid, false);
        assert.ok(r.reason.includes("shell_metacharacter"));
    });

    it("tokenizeArgv rejects redirect >", () => {
        const r = terminalAdapter.tokenizeArgv("echo hi > /tmp/out");
        assert.equal(r.valid, false);
    });

    it("tokenizeArgv rejects semicolon chaining", () => {
        const r = terminalAdapter.tokenizeArgv("ls; rm -rf /tmp");
        assert.equal(r.valid, false);
    });

    it("tokenizeArgv rejects && chaining", () => {
        const r = terminalAdapter.tokenizeArgv("pwd && echo hacked");
        assert.equal(r.valid, false);
    });

    it("tokenizeArgv rejects subshell $(...)", () => {
        const r = terminalAdapter.tokenizeArgv("echo $(cat /etc/passwd)");
        assert.equal(r.valid, false);
    });

    it("tokenizeArgv rejects backtick subshell", () => {
        const r = terminalAdapter.tokenizeArgv("echo `cat /etc/passwd`");
        assert.equal(r.valid, false);
    });

    it("simulation mode does not spawn a process", () => {
        const r = terminalAdapter.executeCommand({
            command: "echo hello", authorityLevel: "operator",
        });
        assert.equal(r.executed, true);
        assert.ok(r.stdout.includes("[simulated"));
    });

    it("dry-run mode returns wouldExecute without any execution", () => {
        const r = terminalAdapter.executeCommand({
            command: "ls -la", authorityLevel: "operator", dryRun: true,
        });
        assert.equal(r.executed, false);
        assert.equal(r.dryRun, true);
        assert.equal(r.wouldExecute, true);
        assert.equal(terminalAdapter.getExecutionLog().length, 0);
    });

    it("rejects malicious command even before tokenization (deny pattern)", () => {
        const r = terminalAdapter.executeCommand({
            command: "ls; rm -rf /", authorityLevel: "operator", realExecution: true,
        });
        assert.equal(r.executed, false);
    });
});

describe("terminalExecutionAdapter — real execution", () => {
    beforeEach(() => terminalAdapter.reset());

    it("executes echo command and captures stdout", () => {
        const r = terminalAdapter.executeCommand({
            command: "echo hello", authorityLevel: "operator", realExecution: true,
        });
        assert.equal(r.executed, true);
        assert.ok(r.stdout.includes("hello"));
        assert.equal(r.exitCode, 0);
        assert.equal(r.realExecution, true);
    });

    it("executes uname command successfully", () => {
        const r = terminalAdapter.executeCommand({
            command: "uname", authorityLevel: "operator", realExecution: true,
        });
        assert.equal(r.executed, true);
        assert.equal(r.exitCode, 0);
        assert.ok(r.stdout.length > 0);
    });

    it("executes node --version and captures version string", () => {
        const r = terminalAdapter.executeCommand({
            command: "node --version", authorityLevel: "operator", realExecution: true,
        });
        assert.equal(r.executed, true);
        assert.ok(r.stdout.trim().startsWith("v"));
    });

    it("real execution rejects pipe even if passes allowlist prefix", () => {
        const r = terminalAdapter.executeCommand({
            command: "ls | grep js", authorityLevel: "operator", realExecution: true,
        });
        assert.equal(r.executed, false);
        assert.ok(r.reason.includes("shell_metacharacter") || r.reason.includes("deny_pattern"));
    });

    it("real execution rejects redirect", () => {
        const r = terminalAdapter.executeCommand({
            command: "echo test > /tmp/out", authorityLevel: "operator", realExecution: true,
        });
        assert.equal(r.executed, false);
    });

    it("real execution records in execution log with realExecution:true flag", () => {
        terminalAdapter.executeCommand({ command: "echo x", authorityLevel: "operator", realExecution: true });
        const log = terminalAdapter.getExecutionLog();
        assert.equal(log.length, 1);
        assert.equal(log[0].realExecution, true);
    });

    it("simulation and real execution tracked separately in metrics", () => {
        terminalAdapter.executeCommand({ command: "echo a", authorityLevel: "operator" });
        terminalAdapter.executeCommand({ command: "echo b", authorityLevel: "operator", realExecution: true });
        const m = terminalAdapter.getAdapterMetrics();
        assert.equal(m.totalExecutions, 2);
        assert.equal(m.realExecutions, 1);
    });

    it("stdout is truncated to MAX_OUTPUT_BYTES", () => {
        assert.ok(terminalAdapter.MAX_OUTPUT_BYTES > 0);
    });
});

// ── runtimeExecutionAdapterManager (integration) ─────────────────────

describe("runtimeExecutionAdapterManager — integration mode", () => {
    beforeEach(() => {
        adapterManager.reset();
        policyEngine.reset();
        circuitBreaker.reset();
        auditLedger.reset();
        riskAnalyzer.reset();
    });

    it("configure wires integration modules", () => {
        const r = adapterManager.configure({
            policyEngine, circuitBreaker, auditLedger, riskAnalyzer,
        });
        assert.equal(r.configured, true);
        assert.ok(r.integrations.includes("policyEngine"));
    });

    it("submission allowed when policy allows", () => {
        policyEngine.registerPolicy({
            name: "allow_all", adapterTypes: ["*"],
            minAuthority: "observer", effect: "allow",
        });
        adapterManager.configure({ policyEngine, auditLedger });
        const r = adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "git_status", authorityLevel: "observer",
        });
        assert.equal(r.submitted, true);
    });

    it("submission denied when policy denies", () => {
        policyEngine.registerPolicy({
            name: "deny_terminal", adapterTypes: ["terminal"],
            minAuthority: "observer", effect: "deny", priority: 10,
        });
        adapterManager.configure({ policyEngine, auditLedger });
        const r = adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "execute_command", authorityLevel: "operator",
        });
        assert.equal(r.submitted, false);
        assert.equal(r.reason, "policy_denied");
    });

    it("policy denial is recorded in audit ledger", () => {
        policyEngine.registerPolicy({
            name: "deny_browser", adapterTypes: ["browser"],
            minAuthority: "observer", effect: "deny",
        });
        adapterManager.configure({ policyEngine, auditLedger });
        adapterManager.submitExecution({
            workflowId: "wf-audit", sourceSubsystem: "s",
            capability: "navigate_url", authorityLevel: "operator",
        });
        const events = auditLedger.getEventsByWorkflow("wf-audit");
        assert.ok(events.some(e => e.outcome === "policy_denied"));
    });

    it("submission blocked when circuit breaker is open", () => {
        circuitBreaker.configureBreaker({ adapterType: "terminal", failureThreshold: 1, windowSize: 5 });
        circuitBreaker.recordOutcome({ adapterType: "terminal", outcome: "error" });
        adapterManager.configure({ circuitBreaker });
        const r = adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "execute_command", authorityLevel: "operator",
        });
        assert.equal(r.submitted, false);
        assert.equal(r.reason, "circuit_breaker_open");
    });

    it("risk score is computed and attached to submission record", () => {
        policyEngine.registerPolicy({
            name: "allow_all", adapterTypes: ["*"],
            minAuthority: "observer", effect: "allow",
        });
        adapterManager.configure({ policyEngine, riskAnalyzer });
        const r = adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "execute_command", authorityLevel: "operator",
            payload: { command: "echo hello" },
        });
        assert.equal(r.submitted, true);
        assert.ok(typeof r.riskScore === "number");
        assert.ok(r.riskScore >= 0 && r.riskScore <= 1);
    });

    it("submitted events appear in audit ledger", () => {
        policyEngine.registerPolicy({
            name: "allow_git", adapterTypes: ["git"],
            minAuthority: "observer", effect: "allow",
        });
        adapterManager.configure({ policyEngine, auditLedger });
        adapterManager.submitExecution({
            workflowId: "wf-led", sourceSubsystem: "s",
            capability: "git_status", authorityLevel: "observer",
        });
        const events = auditLedger.getEventsByWorkflow("wf-led");
        assert.ok(events.some(e => e.outcome === "submitted"));
    });

    it("globalDenyMode blocks all submissions via policy", () => {
        policyEngine.registerPolicy({
            name: "allow_all", adapterTypes: ["*"],
            minAuthority: "observer", effect: "allow",
        });
        policyEngine.setGlobalDenyMode(true);
        adapterManager.configure({ policyEngine });
        const r = adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "git_status", authorityLevel: "governor",
        });
        assert.equal(r.submitted, false);
        assert.equal(r.reason, "policy_denied");
    });

    it("reset clears integration config", () => {
        policyEngine.registerPolicy({
            name: "deny_all", adapterTypes: ["*"],
            minAuthority: "observer", effect: "deny",
        });
        adapterManager.configure({ policyEngine });
        adapterManager.reset();
        policyEngine.reset();
        // After reset, no integration — standalone mode allows submission
        const r = adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "git_status", authorityLevel: "observer",
        });
        assert.equal(r.submitted, true);
    });

    it("standalone mode (no configure) works as before", () => {
        const r = adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "read_file", authorityLevel: "observer",
        });
        assert.equal(r.submitted, true);
        assert.equal(r.adapterType, "filesystem");
    });
});
