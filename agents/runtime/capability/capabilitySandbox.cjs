"use strict";
/**
 * capabilitySandbox — enforce isolated execution for capabilities.
 *
 * createContext(executionId, opts?)   → { id, cwd, env, scope, restrictedShell }
 *   opts: { cwd?, allowedEnv?, scope?, restrictedShell? }
 * validateScope(filePath, scope)      → { allowed, reason? }
 * restrictShell(command, context)     → { allowed, reason? }
 * cleanup(executionId)
 * reset()
 */

const fs   = require("fs");
const os   = require("os");
const path = require("path");

const _contexts = new Map();

const ALLOWED_ENV_EXACT  = new Set(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "PWD", "LANG", "SHELL"]);
const ALLOWED_ENV_PREFIX = ["NODE_", "LC_"];

const SHELL_BLOCK = [
    /\bsudo\b/,
    /rm\s+-[a-z]*r[a-z]*f\s+\//i,
    /curl[^|]+\|\s*(bash|sh)\b/,
    /wget[^|]+\|\s*(bash|sh)\b/,
];

function createContext(executionId, opts = {}) {
    const sandboxDir = path.join(os.tmpdir(), `jarvis-cap-${executionId}`);
    fs.mkdirSync(sandboxDir, { recursive: true });

    const baseEnv = opts.allowedEnv ?? {};
    const env = {};
    for (const [k, v] of Object.entries(baseEnv)) {
        if (ALLOWED_ENV_EXACT.has(k) || ALLOWED_ENV_PREFIX.some(p => k.startsWith(p))) {
            env[k] = v;
        }
    }

    const ctx = {
        id:              executionId,
        cwd:             opts.cwd   ?? sandboxDir,
        env,
        scope:           opts.scope ?? sandboxDir,
        restrictedShell: opts.restrictedShell ?? true,
    };
    _contexts.set(executionId, ctx);
    return ctx;
}

function validateScope(filePath, scope) {
    const resolved = path.resolve(filePath);
    const root     = path.resolve(scope);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
        return { allowed: false, reason: `path "${resolved}" is outside scope "${root}"` };
    }
    return { allowed: true };
}

function restrictShell(command, context) {
    if (!context?.restrictedShell) return { allowed: true };
    for (const re of SHELL_BLOCK) {
        if (re.test(command)) return { allowed: false, reason: `blocked pattern: ${re}` };
    }
    return { allowed: true };
}

function cleanup(executionId) {
    const dir = path.join(os.tmpdir(), `jarvis-cap-${executionId}`);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    _contexts.delete(executionId);
}

function reset() { _contexts.clear(); }

module.exports = { createContext, validateScope, restrictShell, cleanup, reset, ALLOWED_ENV_EXACT, ALLOWED_ENV_PREFIX };
