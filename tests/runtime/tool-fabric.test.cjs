"use strict";
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const PERM_FILE = path.join(__dirname, "../../data/tool-permissions.json");
let _permBackup = null;

before(() => {
    try { _permBackup = fs.readFileSync(PERM_FILE, "utf8"); } catch { _permBackup = null; }
});
after(() => {
    if (_permBackup !== null) fs.writeFileSync(PERM_FILE, _permBackup);
    else { try { fs.unlinkSync(PERM_FILE); } catch {} }
});

const tel = require("../../backend/services/toolExecutionLayer.cjs");

describe("toolExecutionLayer (Tool Fabric)", () => {

    describe("system:exec tool (wraps backend/core/safe-exec.js)", () => {
        it("is listed as a real tool", () => {
            const tools = tel.listTools();
            assert.ok(tools.some(t => t.id === "system:exec"));
        });
        it("is denied by default (high risk)", () => {
            const perms = tel.getPermissions("system:exec");
            assert.equal(perms.permissions.run, false);
        });
        it("executes a real allowlisted command once granted, via safe-exec's real validation", async () => {
            tel.setPermission("system:exec", "run", true);
            const result = await tel.execute("system:exec", "run", { cmd: "node", args: ["-e", "console.log(1+1)"] });
            assert.equal(result.success, true);
            assert.ok(result.output.includes("2"));
            tel.setPermission("system:exec", "run", false);
        });
        it("a non-allowlisted command is genuinely blocked by safe-exec, not silently allowed", async () => {
            tel.setPermission("system:exec", "run", true);
            const result = await tel.execute("system:exec", "run", { cmd: "totally-not-a-real-allowlisted-binary-xyz" });
            assert.equal(result.success, false);
            assert.ok(result.error.includes("blocked") || result.error.includes("not_allowlisted") || result.error.includes("command_not_allowlisted"));
            tel.setPermission("system:exec", "run", false);
        });
    });

    describe("org/agent-scoped permissions — additive, backward compatible", () => {
        // github.create_pr is risk:"medium" -> denied by default (only
        // risk:"low" actions are allowed by default, per _defaultPerms()).
        it("unscoped calls behave exactly as the platform-wide default (backward compatible)", async () => {
            const result = await tel.execute("github", "create_pr", { owner: "x", repo: "y", title: "t", head: "h" });
            assert.equal(result.success, false);
            assert.ok(result.error.includes("permission_denied"));
        });
        it("an org-wide scoped grant allows a tool action for that org without changing the global default", async () => {
            const orgId = `org_toolfab_${Date.now()}`;
            tel.setScopedPermission("github", "create_pr", true, { orgId });

            const scopedResult = await tel.execute("github", "create_pr", { owner: "x", repo: "y", title: "t", head: "h" }, { orgId });
            // Real HTTP call will fail against fake credentials/repo, but the
            // PERMISSION check itself must have passed (not permission_denied).
            assert.notEqual(scopedResult.error, "permission_denied: github.create_pr is not allowed");

            const unscopedResult = await tel.execute("github", "create_pr", { owner: "x", repo: "y", title: "t", head: "h" });
            assert.ok(unscopedResult.error.includes("permission_denied"), "global default must remain unaffected by the org-scoped grant");
        });
        it("an agent-instance-specific grant takes precedence over an org-wide grant", async () => {
            const orgId = `org_toolfab_prec_${Date.now()}`;
            const instanceId = `agentinst_toolfab_${Date.now()}`;
            tel.setScopedPermission("github", "read_repo", true, { orgId });
            tel.setScopedPermission("github", "read_repo", false, { orgId, agentInstanceId: instanceId });

            const orgLevelAllowed = tel.resolvePermission("github", "read_repo", { orgId });
            const instanceLevelDenied = tel.resolvePermission("github", "read_repo", { orgId, agentInstanceId: instanceId });

            assert.equal(orgLevelAllowed, true);
            assert.equal(instanceLevelDenied, false, "agent-instance-specific denial must override the org-wide grant");
        });
        it("resolvePermission() falls back to the platform default when no scoped grant exists", () => {
            const result = tel.resolvePermission("notion", "create_page", { orgId: `org_never_granted_${Date.now()}` });
            const platformDefault = tel.getPermissions("notion").permissions.create_page;
            assert.equal(result, platformDefault);
        });
        it("setScopedPermission() requires an orgId", () => {
            assert.throws(() => tel.setScopedPermission("slack", "post_message", true, {}));
        });
        it("setScopedPermission() throws for an unknown tool", () => {
            assert.throws(() => tel.setScopedPermission("not-a-real-tool", "action", true, { orgId: "org_x" }));
        });
    });

    describe("existing behavior unchanged (regression)", () => {
        it("listTools() still reports all original tools plus system:exec", () => {
            const tools = tel.listTools().map(t => t.id);
            for (const id of ["github", "gmail", "slack", "notion", "gdrive", "telegram", "openrouter", "ollama", "system:exec"]) {
                assert.ok(tools.includes(id), `expected tool ${id} to be listed`);
            }
        });
        it("getPermissions()/setPermission() still work exactly as before for an existing tool", () => {
            tel.setPermission("gdrive", "list_files", true);
            assert.equal(tel.getPermissions("gdrive").permissions.list_files, true);
            tel.setPermission("gdrive", "list_files", false);
        });
    });
});
