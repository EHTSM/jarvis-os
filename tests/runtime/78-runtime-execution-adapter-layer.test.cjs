"use strict";
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const adapterRegistry   = require("../../agents/runtime/execution-adapters/executionAdapterRegistry.cjs");
const permissionBridge  = require("../../agents/runtime/execution-adapters/adapterPermissionBridge.cjs");
const terminalAdapter   = require("../../agents/runtime/execution-adapters/terminalExecutionAdapter.cjs");
const fsAdapter         = require("../../agents/runtime/execution-adapters/filesystemExecutionAdapter.cjs");
const gitAdapter        = require("../../agents/runtime/execution-adapters/gitExecutionAdapter.cjs");
const vscodeAdapter     = require("../../agents/runtime/execution-adapters/vscodeExecutionAdapter.cjs");
const dockerAdapter     = require("../../agents/runtime/execution-adapters/dockerExecutionAdapter.cjs");
const browserAdapter    = require("../../agents/runtime/execution-adapters/browserExecutionAdapter.cjs");
const healthMonitor     = require("../../agents/runtime/execution-adapters/adapterHealthMonitor.cjs");
const adapterManager    = require("../../agents/runtime/execution-adapters/runtimeExecutionAdapterManager.cjs");

// ── executionAdapterRegistry ──────────────────────────────────────────

describe("executionAdapterRegistry", () => {
    beforeEach(() => adapterRegistry.reset());

    it("lists all builtin adapters after reset", () => {
        const all = adapterRegistry.listAdapters();
        assert.ok(all.length >= 6);
        const types = all.map(a => a.adapterType);
        assert.ok(types.includes("terminal"));
        assert.ok(types.includes("filesystem"));
        assert.ok(types.includes("docker"));
    });

    it("looks up builtin terminal adapter", () => {
        const r = adapterRegistry.lookupAdapter("terminal");
        assert.equal(r.found, true);
        assert.ok(r.capabilities.includes("execute_command"));
    });

    it("returns found:false for unknown adapter type", () => {
        const r = adapterRegistry.lookupAdapter("kubernetes");
        assert.equal(r.found, false);
    });

    it("deactivates an adapter", () => {
        const r = adapterRegistry.deactivateAdapter({ adapterType: "terminal" });
        assert.equal(r.deactivated, true);
        const lookup = adapterRegistry.lookupAdapter("terminal");
        assert.equal(lookup.active, false);
    });

    it("rejects deactivation of unknown adapter", () => {
        const r = adapterRegistry.deactivateAdapter({ adapterType: "unknown" });
        assert.equal(r.deactivated, false);
        assert.equal(r.reason, "adapter_not_found");
    });

    it("getRegistryMetrics returns builtin and active counts", () => {
        const m = adapterRegistry.getRegistryMetrics();
        assert.ok(m.totalAdapters >= 6);
        assert.ok(m.activeAdapters >= 6);
        assert.ok(m.sandboxedCount >= 6);
        assert.ok(m.builtinCount >= 6);
    });

    it("getRegistryMetrics shows replay-compatible adapters", () => {
        const m = adapterRegistry.getRegistryMetrics();
        assert.ok(m.replayCompatible >= 5);
    });

    it("reset restores builtins", () => {
        adapterRegistry.deactivateAdapter({ adapterType: "terminal" });
        adapterRegistry.reset();
        const r = adapterRegistry.lookupAdapter("terminal");
        assert.equal(r.active, true);
    });
});

// ── adapterPermissionBridge ───────────────────────────────────────────

describe("adapterPermissionBridge", () => {
    beforeEach(() => permissionBridge.reset());

    it("grants adapter permission for sufficient authority", () => {
        const r = permissionBridge.grantAdapterPermission({
            principalId: "user-1", adapterType: "terminal",
            operation: "execute_command", authorityLevel: "operator",
        });
        assert.equal(r.granted, true);
        assert.ok(r.permissionId.startsWith("aperm-"));
    });

    it("rejects grant for insufficient authority", () => {
        const r = permissionBridge.grantAdapterPermission({
            principalId: "user-1", adapterType: "terminal",
            operation: "execute_command", authorityLevel: "observer",
        });
        assert.equal(r.granted, false);
        assert.equal(r.reason, "insufficient_authority");
    });

    it("rejects grant without principalId", () => {
        const r = permissionBridge.grantAdapterPermission({
            adapterType: "terminal", operation: "execute_command", authorityLevel: "operator",
        });
        assert.equal(r.granted, false);
        assert.equal(r.reason, "principalId_required");
    });

    it("rejects grant with invalid authority level", () => {
        const r = permissionBridge.grantAdapterPermission({
            principalId: "u", adapterType: "terminal",
            operation: "execute_command", authorityLevel: "superadmin",
        });
        assert.equal(r.granted, false);
        assert.ok(r.reason.includes("invalid_authority_level"));
    });

    it("revokes a permission", () => {
        const { permissionId } = permissionBridge.grantAdapterPermission({
            principalId: "u", adapterType: "git",
            operation: "git_status", authorityLevel: "observer",
        });
        const r = permissionBridge.revokeAdapterPermission({ permissionId });
        assert.equal(r.revoked, true);
    });

    it("checkAdapterPermission allows with active grant and sufficient authority", () => {
        permissionBridge.grantAdapterPermission({
            principalId: "u1", adapterType: "filesystem",
            operation: "read_file", authorityLevel: "observer",
        });
        const r = permissionBridge.checkAdapterPermission({
            principalId: "u1", adapterType: "filesystem",
            operation: "read_file", authorityLevel: "observer",
        });
        assert.equal(r.allowed, true);
    });

    it("checkAdapterPermission denies when no active grant exists", () => {
        const r = permissionBridge.checkAdapterPermission({
            principalId: "u1", adapterType: "filesystem",
            operation: "read_file", authorityLevel: "observer",
        });
        assert.equal(r.allowed, false);
        assert.equal(r.reason, "no_active_permission");
    });

    it("checkAdapterPermission denies after revocation", () => {
        const { permissionId } = permissionBridge.grantAdapterPermission({
            principalId: "u2", adapterType: "git",
            operation: "git_diff", authorityLevel: "observer",
        });
        permissionBridge.revokeAdapterPermission({ permissionId });
        const r = permissionBridge.checkAdapterPermission({
            principalId: "u2", adapterType: "git",
            operation: "git_diff", authorityLevel: "observer",
        });
        assert.equal(r.allowed, false);
    });

    it("validateExecution returns valid for correct spec", () => {
        const v = permissionBridge.validateExecution({
            adapterType: "terminal", operation: "execute_command",
            authorityLevel: "operator", sandboxed: true,
        });
        assert.equal(v.valid, true);
    });

    it("validateExecution flags missing sandbox", () => {
        const v = permissionBridge.validateExecution({
            adapterType: "terminal", operation: "execute_command",
            authorityLevel: "operator", sandboxed: false,
        });
        assert.equal(v.valid, false);
        assert.ok(v.violations.includes("execution_must_be_sandboxed"));
    });

    it("getPermissionMetrics tracks totals and revocations", () => {
        const { permissionId } = permissionBridge.grantAdapterPermission({
            principalId: "u", adapterType: "git",
            operation: "git_status", authorityLevel: "observer",
        });
        permissionBridge.revokeAdapterPermission({ permissionId });
        const m = permissionBridge.getPermissionMetrics();
        assert.equal(m.totalGranted, 1);
        assert.equal(m.revokedCount, 1);
        assert.equal(m.activeCount, 0);
    });
});

// ── terminalExecutionAdapter ──────────────────────────────────────────

describe("terminalExecutionAdapter", () => {
    beforeEach(() => terminalAdapter.reset());

    it("executes an allowlisted command", () => {
        const r = terminalAdapter.executeCommand({
            command: "ls -la", workflowId: "wf-1", authorityLevel: "operator",
        });
        assert.equal(r.executed, true);
        assert.ok(r.executionId.startsWith("term-exec-"));
        assert.equal(r.exitCode, 0);
    });

    it("rejects command execution with observer authority", () => {
        const r = terminalAdapter.executeCommand({
            command: "ls", authorityLevel: "observer",
        });
        assert.equal(r.executed, false);
        assert.equal(r.reason, "insufficient_authority");
    });

    it("rejects command not in allowlist", () => {
        const r = terminalAdapter.executeCommand({
            command: "curl https://example.com", authorityLevel: "operator",
        });
        assert.equal(r.executed, false);
        assert.equal(r.reason, "command_not_in_allowlist");
    });

    it("rejects command matching deny pattern (rm -rf)", () => {
        const r = terminalAdapter.validateCommand({ command: "rm -rf /tmp/test" });
        assert.equal(r.valid, false);
        assert.equal(r.reason, "command_matches_deny_pattern");
    });

    it("rejects sudo command", () => {
        const r = terminalAdapter.validateCommand({ command: "sudo ls" });
        assert.equal(r.valid, false);
    });

    it("validates allowed command successfully", () => {
        const r = terminalAdapter.validateCommand({ command: "git status" });
        assert.equal(r.valid, true);
    });

    it("dry-run returns wouldExecute without logging execution", () => {
        const r = terminalAdapter.executeCommand({
            command: "ls", authorityLevel: "operator", dryRun: true,
        });
        assert.equal(r.executed, false);
        assert.equal(r.dryRun, true);
        assert.equal(r.wouldExecute, true);
        assert.equal(terminalAdapter.getExecutionLog().length, 0);
    });

    it("dryRunCommand returns validation for invalid command", () => {
        const r = terminalAdapter.dryRunCommand({ command: "rm -rf /", authorityLevel: "operator" });
        assert.equal(r.dryRun, true);
        assert.equal(r.wouldExecute, false);
        assert.equal(r.validation.valid, false);
    });

    it("clamps timeout to MAX_TIMEOUT_MS", () => {
        const r = terminalAdapter.executeCommand({
            command: "ls", authorityLevel: "operator",
            timeoutMs: 999999,
        });
        assert.equal(r.executed, true);
        // No error — timeout is clamped internally
    });

    it("getExecutionLog records executions", () => {
        terminalAdapter.executeCommand({ command: "ls", authorityLevel: "operator" });
        terminalAdapter.executeCommand({ command: "pwd", authorityLevel: "operator" });
        assert.equal(terminalAdapter.getExecutionLog().length, 2);
    });

    it("getAdapterMetrics counts completed executions", () => {
        terminalAdapter.executeCommand({ command: "ls", authorityLevel: "operator" });
        const m = terminalAdapter.getAdapterMetrics();
        assert.equal(m.totalExecutions, 1);
        assert.equal(m.completedCount, 1);
        assert.equal(m.adapterType, "terminal");
    });

    it("reset clears execution log", () => {
        terminalAdapter.executeCommand({ command: "ls", authorityLevel: "operator" });
        terminalAdapter.reset();
        assert.equal(terminalAdapter.getExecutionLog().length, 0);
    });
});

// ── filesystemExecutionAdapter ────────────────────────────────────────

describe("filesystemExecutionAdapter", () => {
    beforeEach(() => fsAdapter.reset());

    it("reads a workspace-scoped file", () => {
        const r = fsAdapter.readFile({ path: "/workspace/src/index.js", authorityLevel: "observer" });
        assert.equal(r.read, true);
        assert.ok(r.executionId.startsWith("fs-exec-"));
    });

    it("denies path traversal", () => {
        const r = fsAdapter.readFile({ path: "/workspace/../etc/passwd", authorityLevel: "observer" });
        assert.equal(r.read, false);
        assert.equal(r.reason, "path_matches_deny_pattern");
    });

    it("denies sensitive directory /etc", () => {
        const r = fsAdapter.readFile({ path: "/etc/hosts", authorityLevel: "observer" });
        assert.equal(r.read, false);
        assert.equal(r.reason, "sensitive_path_denied");
    });

    it("denies .env file", () => {
        const r = fsAdapter.readFile({ path: "/workspace/.env", authorityLevel: "observer" });
        assert.equal(r.read, false);
        assert.equal(r.reason, "path_matches_deny_pattern");
    });

    it("denies path outside workspace", () => {
        const r = fsAdapter.readFile({ path: "/home/user/file.txt", authorityLevel: "observer" });
        assert.equal(r.read, false);
        assert.equal(r.reason, "path_outside_workspace");
    });

    it("writes a file with operator authority", () => {
        const r = fsAdapter.writeFile({
            path: "/workspace/out.txt", content: "hello",
            authorityLevel: "operator",
        });
        assert.equal(r.written, true);
        assert.equal(r.bytesWritten, 5);
    });

    it("denies write with observer authority", () => {
        const r = fsAdapter.writeFile({ path: "/workspace/out.txt", authorityLevel: "observer" });
        assert.equal(r.written, false);
        assert.equal(r.reason, "insufficient_authority_for_write");
    });

    it("lists a workspace directory", () => {
        const r = fsAdapter.listDirectory({ path: "/workspace/src", authorityLevel: "observer" });
        assert.equal(r.listed, true);
        assert.ok(Array.isArray(r.entries));
    });

    it("deletes with controller authority", () => {
        const r = fsAdapter.deleteFile({ path: "/workspace/tmp.txt", authorityLevel: "controller" });
        assert.equal(r.deleted, true);
    });

    it("denies delete with operator authority", () => {
        const r = fsAdapter.deleteFile({ path: "/workspace/tmp.txt", authorityLevel: "operator" });
        assert.equal(r.deleted, false);
        assert.equal(r.reason, "insufficient_authority_for_delete");
    });

    it("validatePath rejects .pem file", () => {
        const v = fsAdapter.validatePath("/workspace/certs/server.pem");
        assert.equal(v.valid, false);
    });

    it("getAuditLog records all operations immutably", () => {
        fsAdapter.readFile({ path: "/workspace/a.js", authorityLevel: "observer" });
        fsAdapter.writeFile({ path: "/workspace/b.js", content: "x", authorityLevel: "operator" });
        const log = fsAdapter.getAuditLog();
        assert.equal(log.length, 2);
        assert.equal(log[0].operation, "read");
        assert.equal(log[1].operation, "write");
    });

    it("getAdapterMetrics counts by operation", () => {
        fsAdapter.readFile({ path: "/workspace/a.js", authorityLevel: "observer" });
        fsAdapter.readFile({ path: "/workspace/b.js", authorityLevel: "observer" });
        fsAdapter.writeFile({ path: "/workspace/c.js", content: "", authorityLevel: "operator" });
        const m = fsAdapter.getAdapterMetrics();
        assert.equal(m.byOperation.read, 2);
        assert.equal(m.byOperation.write, 1);
        assert.equal(m.adapterType, "filesystem");
    });
});

// ── gitExecutionAdapter ───────────────────────────────────────────────

describe("gitExecutionAdapter", () => {
    beforeEach(() => gitAdapter.reset());

    it("gitStatus returns simulated output", () => {
        const r = gitAdapter.gitStatus({ workflowId: "wf-1", authorityLevel: "observer" });
        assert.equal(r.executed, true);
        assert.ok(r.executionId.startsWith("git-exec-"));
        assert.ok(r.output.length > 0);
    });

    it("gitDiff returns diff output", () => {
        const r = gitAdapter.gitDiff({ authorityLevel: "observer" });
        assert.equal(r.executed, true);
        assert.ok(r.output.includes("simulated diff"));
    });

    it("gitDiff includes filePath when provided", () => {
        const r = gitAdapter.gitDiff({ authorityLevel: "observer", filePath: "src/index.js" });
        assert.ok(r.output.includes("src/index.js"));
    });

    it("gitBranch returns branches and currentBranch", () => {
        const r = gitAdapter.gitBranch({ authorityLevel: "observer" });
        assert.equal(r.executed, true);
        assert.ok(Array.isArray(r.branches));
        assert.ok(r.currentBranch);
    });

    it("validateCommit returns valid for clean commit", () => {
        const v = gitAdapter.validateCommit({
            message: "feat: add user auth", files: ["src/auth.js"],
            authorityLevel: "operator",
        });
        assert.equal(v.valid, true);
    });

    it("validateCommit rejects message with sensitive data", () => {
        const v = gitAdapter.validateCommit({
            message: "update api_key = abc123", files: [],
            authorityLevel: "operator",
        });
        assert.equal(v.valid, false);
        assert.ok(v.violations.some(v => v.includes("sensitive_data")));
    });

    it("validateCommit rejects .env file in commit", () => {
        const v = gitAdapter.validateCommit({
            message: "update config", files: [".env"],
            authorityLevel: "operator",
        });
        assert.equal(v.valid, false);
        assert.ok(v.violations.some(v => v.includes("sensitive_file")));
    });

    it("validateCommit rejects observer authority", () => {
        const v = gitAdapter.validateCommit({
            message: "fix: bug", files: [], authorityLevel: "observer",
        });
        assert.equal(v.valid, false);
        assert.ok(v.violations.some(v => v.includes("insufficient_authority")));
    });

    it("safeCheckout succeeds with operator authority", () => {
        const r = gitAdapter.safeCheckout({ branch: "feature/test", authorityLevel: "operator" });
        assert.equal(r.checked_out, true);
        assert.equal(r.branch, "feature/test");
    });

    it("safeCheckout rejects observer authority", () => {
        const r = gitAdapter.safeCheckout({ branch: "main", authorityLevel: "observer" });
        assert.equal(r.checked_out, false);
        assert.equal(r.reason, "insufficient_authority_for_checkout");
    });

    it("force checkout requires governor authority", () => {
        const r = gitAdapter.safeCheckout({ branch: "main", authorityLevel: "operator", force: true });
        assert.equal(r.checked_out, false);
        assert.equal(r.reason, "force_checkout_requires_governor");
    });

    it("force checkout allowed with governor authority", () => {
        const r = gitAdapter.safeCheckout({ branch: "main", authorityLevel: "governor", force: true });
        assert.equal(r.checked_out, true);
    });

    it("getAdapterMetrics counts by operation", () => {
        gitAdapter.gitStatus({});
        gitAdapter.gitDiff({});
        gitAdapter.gitBranch({});
        const m = gitAdapter.getAdapterMetrics();
        assert.equal(m.totalExecutions, 3);
        assert.equal(m.byOperation.status, 1);
        assert.equal(m.byOperation.diff, 1);
        assert.equal(m.adapterType, "git");
    });
});

// ── vscodeExecutionAdapter ────────────────────────────────────────────

describe("vscodeExecutionAdapter", () => {
    beforeEach(() => vscodeAdapter.reset());

    it("navigates to a file at line", () => {
        const r = vscodeAdapter.navigateFile({ path: "src/index.js", line: 42, authorityLevel: "observer" });
        assert.equal(r.navigated, true);
        assert.equal(r.line, 42);
    });

    it("rejects navigate without path", () => {
        const r = vscodeAdapter.navigateFile({ authorityLevel: "observer" });
        assert.equal(r.navigated, false);
        assert.equal(r.reason, "path_required");
    });

    it("edits a safe file with operator authority", () => {
        const r = vscodeAdapter.editFile({
            path: "src/app.js", changes: [{ line: 1, text: "// updated" }],
            authorityLevel: "operator",
        });
        assert.equal(r.edited, true);
        assert.equal(r.changesApplied, 1);
    });

    it("rejects edit with observer authority", () => {
        const r = vscodeAdapter.editFile({ path: "src/app.js", authorityLevel: "observer" });
        assert.equal(r.edited, false);
        assert.equal(r.reason, "insufficient_authority_for_edit");
    });

    it("rejects edit of sensitive file (.env)", () => {
        const r = vscodeAdapter.editFile({ path: ".env", authorityLevel: "operator" });
        assert.equal(r.edited, false);
        assert.equal(r.reason, "edit_path_denied_by_policy");
    });

    it("dry-run edit returns preview without logging", () => {
        const r = vscodeAdapter.editFile({
            path: "src/app.js", changes: [{ line: 5, text: "x" }],
            authorityLevel: "operator", dryRun: true,
        });
        assert.equal(r.edited, false);
        assert.equal(r.dryRun, true);
        assert.ok(r.preview.includes("dry-run"));
    });

    it("scans workspace and returns file count", () => {
        const r = vscodeAdapter.scanWorkspace({ workspaceRoot: "/workspace" });
        assert.equal(r.scanned, true);
        assert.ok(r.fileCount > 0);
    });

    it("captures editor state with openFiles and activeFile", () => {
        const r = vscodeAdapter.captureEditorState({ authorityLevel: "observer" });
        assert.equal(r.captured, true);
        assert.ok(Array.isArray(r.state.openFiles));
        assert.ok(r.state.activeFile);
    });

    it("getAdapterMetrics reports by operation", () => {
        vscodeAdapter.navigateFile({ path: "a.js" });
        vscodeAdapter.scanWorkspace({});
        const m = vscodeAdapter.getAdapterMetrics();
        assert.equal(m.adapterType, "vscode");
        assert.ok(m.totalExecutions >= 2);
    });
});

// ── dockerExecutionAdapter ────────────────────────────────────────────

describe("dockerExecutionAdapter", () => {
    beforeEach(() => dockerAdapter.reset());

    it("inspects a container", () => {
        const r = dockerAdapter.inspectContainer({ containerId: "abc123", authorityLevel: "observer" });
        assert.equal(r.inspected, true);
        assert.equal(r.containerId, "abc123");
        assert.ok(r.info.status);
    });

    it("rejects inspect without containerId", () => {
        const r = dockerAdapter.inspectContainer({ authorityLevel: "observer" });
        assert.equal(r.inspected, false);
        assert.equal(r.reason, "containerId_required");
    });

    it("lists containers", () => {
        const r = dockerAdapter.listContainers({ authorityLevel: "observer" });
        assert.equal(r.listed, true);
        assert.ok(Array.isArray(r.containers));
    });

    it("retrieves container logs", () => {
        const r = dockerAdapter.getContainerLogs({ containerId: "abc123", lines: 100 });
        assert.equal(r.retrieved, true);
        assert.ok(r.logs.includes("100"));
    });

    it("rejects logs without containerId", () => {
        const r = dockerAdapter.getContainerLogs({ authorityLevel: "observer" });
        assert.equal(r.retrieved, false);
        assert.equal(r.reason, "containerId_required");
    });

    it("validateDockerOp rejects exec operation", () => {
        const v = dockerAdapter.validateDockerOp({ operation: "exec" });
        assert.equal(v.valid, false);
        assert.ok(v.violations.some(v => v.includes("operation_not_allowed")));
    });

    it("validateDockerOp rejects privileged containers", () => {
        const v = dockerAdapter.validateDockerOp({ operation: "inspect", privileged: true });
        assert.equal(v.valid, false);
        assert.ok(v.violations.includes("privileged_containers_denied"));
    });

    it("validateDockerOp rejects host networking", () => {
        const v = dockerAdapter.validateDockerOp({ operation: "inspect", hostNetwork: true });
        assert.equal(v.valid, false);
        assert.ok(v.violations.includes("host_networking_denied"));
    });

    it("validateDockerOp rejects root escalation", () => {
        const v = dockerAdapter.validateDockerOp({ operation: "ps", rootEscalation: true });
        assert.equal(v.valid, false);
        assert.ok(v.violations.includes("root_escalation_denied"));
    });

    it("validateDockerOp accepts safe inspect operation", () => {
        const v = dockerAdapter.validateDockerOp({ operation: "inspect" });
        assert.equal(v.valid, true);
    });

    it("getAdapterMetrics reports docker operations", () => {
        dockerAdapter.inspectContainer({ containerId: "c1" });
        dockerAdapter.listContainers({});
        const m = dockerAdapter.getAdapterMetrics();
        assert.equal(m.adapterType, "docker");
        assert.equal(m.totalExecutions, 2);
    });
});

// ── browserExecutionAdapter ───────────────────────────────────────────

describe("browserExecutionAdapter", () => {
    beforeEach(() => browserAdapter.reset());

    it("navigates to a valid HTTPS URL", () => {
        const r = browserAdapter.navigateUrl({
            url: "https://example.com", authorityLevel: "operator",
        });
        assert.equal(r.navigated, true);
        assert.ok(r.executionId.startsWith("browser-exec-"));
    });

    it("rejects navigation with observer authority", () => {
        const r = browserAdapter.navigateUrl({ url: "https://example.com", authorityLevel: "observer" });
        assert.equal(r.navigated, false);
        assert.equal(r.reason, "insufficient_authority_for_navigation");
    });

    it("rejects javascript: URI", () => {
        const r = browserAdapter.validateUrl({ url: "javascript:alert(1)" });
        assert.equal(r.valid, false);
        assert.equal(r.reason, "url_matches_deny_pattern");
    });

    it("rejects data: URI", () => {
        const r = browserAdapter.validateUrl({ url: "data:text/html,<h1>test</h1>" });
        assert.equal(r.valid, false);
    });

    it("rejects file: URI", () => {
        const r = browserAdapter.validateUrl({ url: "file:///etc/passwd" });
        assert.equal(r.valid, false);
    });

    it("rejects localhost navigation", () => {
        const r = browserAdapter.navigateUrl({ url: "http://localhost:3000", authorityLevel: "operator" });
        assert.equal(r.navigated, false);
        assert.equal(r.reason, "hostname_denied");
    });

    it("rejects executable download URL (.exe)", () => {
        const r = browserAdapter.validateUrl({ url: "https://example.com/setup.exe" });
        assert.equal(r.valid, false);
    });

    it("rejects .sh download URL", () => {
        const r = browserAdapter.validateUrl({ url: "https://example.com/install.sh" });
        assert.equal(r.valid, false);
    });

    it("captures screenshot with observer authority", () => {
        const r = browserAdapter.captureScreenshot({ url: "https://example.com", authorityLevel: "observer" });
        assert.equal(r.captured, true);
        assert.ok(r.screenshotRef.startsWith("[screenshot-"));
    });

    it("rejects screenshot for invalid URL", () => {
        const r = browserAdapter.captureScreenshot({ url: "javascript:1", authorityLevel: "observer" });
        assert.equal(r.captured, false);
    });

    it("getBrowserLog records navigations and screenshots", () => {
        browserAdapter.navigateUrl({ url: "https://example.com", authorityLevel: "operator" });
        browserAdapter.captureScreenshot({ url: "https://example.com", authorityLevel: "observer" });
        const log = browserAdapter.getBrowserLog();
        assert.equal(log.length, 2);
        assert.equal(log[0].op, "navigate");
        assert.equal(log[1].op, "screenshot");
    });

    it("getAdapterMetrics reports by operation", () => {
        browserAdapter.navigateUrl({ url: "https://example.com", authorityLevel: "operator" });
        const m = browserAdapter.getAdapterMetrics();
        assert.equal(m.adapterType, "browser");
        assert.equal(m.byOperation.navigate, 1);
    });
});

// ── adapterHealthMonitor ──────────────────────────────────────────────

describe("adapterHealthMonitor", () => {
    beforeEach(() => healthMonitor.reset());

    it("records an ok outcome and returns healthy", () => {
        const r = healthMonitor.recordExecutionOutcome({
            adapterType: "terminal", outcome: "ok",
        });
        assert.equal(r.recorded, true);
        assert.equal(r.health, "healthy");
        assert.ok(r.healthId.startsWith("health-"));
    });

    it("rejects record without adapterType", () => {
        const r = healthMonitor.recordExecutionOutcome({ outcome: "ok" });
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "adapterType_required");
    });

    it("rejects record without outcome", () => {
        const r = healthMonitor.recordExecutionOutcome({ adapterType: "terminal" });
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "outcome_required");
    });

    it("health becomes degraded after 20%+ errors", () => {
        for (let i = 0; i < 8; i++)
            healthMonitor.recordExecutionOutcome({ adapterType: "fs", outcome: "ok" });
        for (let i = 0; i < 2; i++)
            healthMonitor.recordExecutionOutcome({ adapterType: "fs", outcome: "error" });
        const h = healthMonitor.getAdapterHealth("fs");
        assert.equal(h.health, "degraded");
    });

    it("health becomes critical after 50%+ errors", () => {
        for (let i = 0; i < 5; i++)
            healthMonitor.recordExecutionOutcome({ adapterType: "docker", outcome: "error" });
        for (let i = 0; i < 5; i++)
            healthMonitor.recordExecutionOutcome({ adapterType: "docker", outcome: "ok" });
        const h = healthMonitor.getAdapterHealth("docker");
        assert.equal(h.health, "critical");
    });

    it("getAdapterHealth returns unknown for untracked adapter", () => {
        const h = healthMonitor.getAdapterHealth("phantom");
        assert.equal(h.found, false);
        assert.equal(h.health, "unknown");
    });

    it("setAdapterQuarantine marks adapter as quarantined", () => {
        healthMonitor.recordExecutionOutcome({ adapterType: "browser", outcome: "ok" });
        healthMonitor.setAdapterQuarantine({ adapterType: "browser", quarantined: true });
        const h = healthMonitor.getAdapterHealth("browser");
        assert.equal(h.health, "quarantined");
        assert.equal(h.quarantined, true);
    });

    it("getAllAdapterHealth returns all tracked adapters", () => {
        healthMonitor.recordExecutionOutcome({ adapterType: "terminal", outcome: "ok" });
        healthMonitor.recordExecutionOutcome({ adapterType: "git", outcome: "error" });
        const all = healthMonitor.getAllAdapterHealth();
        assert.equal(all.length, 2);
        const types = all.map(a => a.adapterType);
        assert.ok(types.includes("terminal"));
        assert.ok(types.includes("git"));
    });

    it("getHealthMetrics counts by health state", () => {
        healthMonitor.recordExecutionOutcome({ adapterType: "terminal", outcome: "ok" });
        healthMonitor.recordExecutionOutcome({ adapterType: "docker", outcome: "ok" });
        healthMonitor.setAdapterQuarantine({ adapterType: "browser", quarantined: true });
        const m = healthMonitor.getHealthMetrics();
        assert.equal(m.totalAdapters, 3);
        assert.ok(m.healthyAdapters >= 2);
        assert.equal(m.quarantinedAdapters, 1);
    });

    it("reset clears all health records", () => {
        healthMonitor.recordExecutionOutcome({ adapterType: "terminal", outcome: "ok" });
        healthMonitor.reset();
        const all = healthMonitor.getAllAdapterHealth();
        assert.equal(all.length, 0);
    });
});

// ── runtimeExecutionAdapterManager ───────────────────────────────────

describe("runtimeExecutionAdapterManager", () => {
    beforeEach(() => adapterManager.reset());

    it("submits an execution and returns executionId", () => {
        const r = adapterManager.submitExecution({
            workflowId: "wf-1", sourceSubsystem: "scheduler",
            capability: "execute_command", authorityLevel: "operator",
        });
        assert.equal(r.submitted, true);
        assert.ok(r.executionId.startsWith("mgr-exec-"));
        assert.equal(r.adapterType, "terminal");
        assert.equal(r.lifecycleState, "requested");
    });

    it("auto-resolves adapterType from capability", () => {
        const r = adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "git_status", authorityLevel: "observer",
        });
        assert.equal(r.submitted, true);
        assert.equal(r.adapterType, "git");
    });

    it("rejects submit without workflowId", () => {
        const r = adapterManager.submitExecution({
            sourceSubsystem: "s", capability: "read_file", authorityLevel: "observer",
        });
        assert.equal(r.submitted, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("rejects submit without sourceSubsystem", () => {
        const r = adapterManager.submitExecution({
            workflowId: "wf", capability: "read_file", authorityLevel: "observer",
        });
        assert.equal(r.submitted, false);
        assert.equal(r.reason, "sourceSubsystem_required");
    });

    it("rejects submit with unknown capability", () => {
        const r = adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "teleport", authorityLevel: "operator",
        });
        assert.equal(r.submitted, false);
        assert.equal(r.reason, "no_adapter_for_capability");
    });

    it("advances execution through lifecycle states", () => {
        const { executionId } = adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "read_file", authorityLevel: "observer",
        });
        adapterManager.advanceExecution({ executionId, newState: "validated" });
        adapterManager.advanceExecution({ executionId, newState: "authorized" });
        const rec = adapterManager.getExecution(executionId);
        assert.equal(rec.lifecycleState, "authorized");
    });

    it("rejects invalid lifecycle transition", () => {
        const { executionId } = adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "git_diff", authorityLevel: "observer",
        });
        const r = adapterManager.advanceExecution({ executionId, newState: "completed" });
        assert.equal(r.advanced, false);
        assert.equal(r.reason, "invalid_transition");
    });

    it("cancels an execution in requested state", () => {
        const { executionId } = adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "navigate_url", authorityLevel: "operator",
        });
        const r = adapterManager.cancelExecution({ executionId, reason: "timeout" });
        assert.equal(r.cancelled, true);
        assert.equal(r.previousState, "requested");
    });

    it("blocks cancellation of completed execution", () => {
        const { executionId } = adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "git_status", authorityLevel: "observer",
        });
        adapterManager.advanceExecution({ executionId, newState: "validated" });
        adapterManager.advanceExecution({ executionId, newState: "authorized" });
        adapterManager.advanceExecution({ executionId, newState: "sandboxed" });
        adapterManager.advanceExecution({ executionId, newState: "executing" });
        adapterManager.advanceExecution({ executionId, newState: "verified" });
        adapterManager.advanceExecution({ executionId, newState: "completed" });
        const r = adapterManager.cancelExecution({ executionId });
        assert.equal(r.cancelled, false);
        assert.ok(r.reason.includes("terminal"));
    });

    it("quarantines an active execution", () => {
        const { executionId } = adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "execute_command", authorityLevel: "operator",
        });
        adapterManager.advanceExecution({ executionId, newState: "validated" });
        const r = adapterManager.quarantineExecution({ executionId });
        assert.equal(r.quarantined, true);
        assert.equal(r.previousState, "validated");
    });

    it("blocks double-quarantine", () => {
        const { executionId } = adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "inspect_container", authorityLevel: "observer",
        });
        adapterManager.quarantineExecution({ executionId });
        const r = adapterManager.quarantineExecution({ executionId });
        assert.equal(r.quarantined, false);
        assert.equal(r.reason, "already_quarantined");
    });

    it("blocks quarantine of completed execution", () => {
        const { executionId } = adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "git_status", authorityLevel: "observer",
        });
        // Drive to completed
        for (const s of ["validated", "authorized", "sandboxed", "executing", "verified", "completed"])
            adapterManager.advanceExecution({ executionId, newState: s });
        const r = adapterManager.quarantineExecution({ executionId });
        assert.equal(r.quarantined, false);
        assert.equal(r.reason, "cannot_quarantine_completed");
    });

    it("validateExecution returns valid for known adapter+capability", () => {
        const v = adapterManager.validateExecution({
            adapterType: "filesystem", capability: "read_file",
            authorityLevel: "observer", sandboxed: true,
        });
        assert.equal(v.valid, true);
    });

    it("validateExecution flags capability/adapter mismatch", () => {
        const v = adapterManager.validateExecution({
            adapterType: "terminal", capability: "read_file",
            authorityLevel: "observer", sandboxed: true,
        });
        assert.equal(v.valid, false);
        assert.ok(v.violations.some(v => v.includes("capability_not_supported")));
    });

    it("getExecution returns null for unknown executionId", () => {
        assert.equal(adapterManager.getExecution("mgr-exec-999"), null);
    });

    it("getExecutionMetrics tracks completions, cancellations, and quarantines", () => {
        const e1 = adapterManager.submitExecution({
            workflowId: "w1", sourceSubsystem: "s", capability: "git_status", authorityLevel: "observer",
        });
        const e2 = adapterManager.submitExecution({
            workflowId: "w2", sourceSubsystem: "s", capability: "read_file", authorityLevel: "observer",
        });
        const e3 = adapterManager.submitExecution({
            workflowId: "w3", sourceSubsystem: "s", capability: "navigate_url", authorityLevel: "operator",
        });

        // Complete e1
        for (const s of ["validated","authorized","sandboxed","executing","verified","completed"])
            adapterManager.advanceExecution({ executionId: e1.executionId, newState: s });

        // Cancel e2
        adapterManager.cancelExecution({ executionId: e2.executionId });

        // Quarantine e3
        adapterManager.quarantineExecution({ executionId: e3.executionId });

        const m = adapterManager.getExecutionMetrics();
        assert.equal(m.totalExecutions, 3);
        assert.equal(m.completedCount, 1);
        assert.equal(m.cancelledCount, 1);
        assert.equal(m.quarantinedCount, 1);
    });

    it("getExecutionMetrics tracks by adapter type", () => {
        adapterManager.submitExecution({
            workflowId: "w1", sourceSubsystem: "s", capability: "git_status", authorityLevel: "observer",
        });
        adapterManager.submitExecution({
            workflowId: "w2", sourceSubsystem: "s", capability: "git_diff", authorityLevel: "observer",
        });
        adapterManager.submitExecution({
            workflowId: "w3", sourceSubsystem: "s", capability: "read_file", authorityLevel: "observer",
        });
        const m = adapterManager.getExecutionMetrics();
        assert.equal(m.byAdapter.git, 2);
        assert.equal(m.byAdapter.filesystem, 1);
    });

    it("reset clears all executions", () => {
        adapterManager.submitExecution({
            workflowId: "wf", sourceSubsystem: "s",
            capability: "git_status", authorityLevel: "observer",
        });
        adapterManager.reset();
        const m = adapterManager.getExecutionMetrics();
        assert.equal(m.totalExecutions, 0);
    });
});
