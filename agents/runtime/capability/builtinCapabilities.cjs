"use strict";
/**
 * builtinCapabilities — register built-in capability adapters.
 *
 * register(registry)  — registers all built-in capabilities into the given registry
 * BUILTIN_IDS         — array of all built-in capability ids
 */

const fs            = require("fs");
const { spawnSync } = require("child_process");
const con           = require("./capabilityContracts.cjs");

const BUILTIN_IDS = [
    "filesystem.read",
    "filesystem.write",
    "filesystem.list",
    "process.execute",
    "git.status",
    "git.diff",
    "git.commit",
    "npm.install",
    "npm.test",
];

function _spawn(cmd, args, cwd) {
    const r = spawnSync(cmd, args, {
        cwd:      cwd ?? process.cwd(),
        encoding: "utf8",
        timeout:  10_000,
    });
    return {
        exitCode: r.status ?? 0,
        stdout:   r.stdout  ?? "",
        stderr:   r.stderr  ?? "",
    };
}

const DEFINITIONS = [
    {
        id:       "filesystem.read",
        name:     "Filesystem Read",
        policy:   "readonly",
        tags:     ["filesystem"],
        contract: con.defineContract({
            inputSchema:  { filePath: { required: true, type: "string" } },
            outputSchema: { content:  { required: true, type: "string" } },
            timeout:      5_000,
        }),
        handler: ({ filePath }) => ({
            content: fs.readFileSync(filePath, "utf8"),
        }),
    },
    {
        id:       "filesystem.write",
        name:     "Filesystem Write",
        policy:   "workspace_write",
        tags:     ["filesystem"],
        contract: con.defineContract({
            inputSchema:  {
                filePath: { required: true, type: "string" },
                content:  { required: true, type: "string" },
            },
            outputSchema: { written: { required: true, type: "boolean" } },
            timeout:      5_000,
            rollbackSupport: true,
        }),
        handler: ({ filePath, content }) => {
            fs.writeFileSync(filePath, content, "utf8");
            return { written: true };
        },
    },
    {
        id:       "filesystem.list",
        name:     "Filesystem List",
        policy:   "readonly",
        tags:     ["filesystem"],
        contract: con.defineContract({
            inputSchema:  { dirPath: { required: true, type: "string" } },
            outputSchema: { entries: { required: true } },
            timeout:      5_000,
        }),
        handler: ({ dirPath }) => ({
            entries: fs.readdirSync(dirPath),
        }),
    },
    {
        id:       "process.execute",
        name:     "Process Execute",
        policy:   "shell_execute",
        tags:     ["process"],
        contract: con.defineContract({
            inputSchema:  { command: { required: true, type: "string" } },
            outputSchema: { exitCode: { required: true, type: "number" } },
            timeout:      30_000,
            isolationRequired: true,
        }),
        handler: ({ command, cwd }) => {
            const [cmd, ...args] = command.trim().split(/\s+/);
            return _spawn(cmd, args, cwd);
        },
    },
    {
        id:       "git.status",
        name:     "Git Status",
        policy:   "readonly",
        tags:     ["git"],
        contract: con.defineContract({
            inputSchema:  {},
            outputSchema: { stdout: { required: true, type: "string" } },
            timeout:      10_000,
        }),
        handler: ({ cwd }) => _spawn("git", ["status", "--short"], cwd),
    },
    {
        id:       "git.diff",
        name:     "Git Diff",
        policy:   "readonly",
        tags:     ["git"],
        contract: con.defineContract({
            inputSchema:  {},
            outputSchema: { stdout: { required: true, type: "string" } },
            timeout:      10_000,
        }),
        handler: ({ ref = "HEAD", cwd }) => _spawn("git", ["diff", ref], cwd),
    },
    {
        id:       "git.commit",
        name:     "Git Commit",
        policy:   "workspace_write",
        tags:     ["git"],
        contract: con.defineContract({
            inputSchema:  { message: { required: true, type: "string" } },
            outputSchema: { exitCode: { required: true, type: "number" } },
            timeout:      15_000,
            rollbackSupport: true,
        }),
        handler: ({ message, cwd }) => _spawn("git", ["commit", "-m", message], cwd),
    },
    {
        id:       "npm.install",
        name:     "NPM Install",
        policy:   "network_access",
        tags:     ["npm"],
        contract: con.defineContract({
            inputSchema:  {},
            outputSchema: { exitCode: { required: true, type: "number" } },
            timeout:      120_000,
        }),
        handler: ({ cwd }) => _spawn("npm", ["install", "--prefer-offline"], cwd),
    },
    {
        id:       "npm.test",
        name:     "NPM Test",
        policy:   "shell_execute",
        tags:     ["npm"],
        contract: con.defineContract({
            inputSchema:  {},
            outputSchema: { exitCode: { required: true, type: "number" } },
            timeout:      60_000,
        }),
        handler: ({ cwd }) => _spawn("npm", ["test"], cwd),
    },
];

function register(registry) {
    for (const cap of DEFINITIONS) registry.register(cap);
}

module.exports = { register, BUILTIN_IDS };
