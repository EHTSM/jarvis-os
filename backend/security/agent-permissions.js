"use strict";
/**
 * Agent Permission Model
 *
 * Classifies actions into four tiers:
 *   READ       — safe, no approval, logged at debug
 *   SAFE_WRITE — allowed, logged at info
 *   DANGEROUS  — requires operatorApproval: true, logged at warn
 *   BLOCKED    — never allowed, logged at error
 *
 * Usage:
 *   const { check, TIERS } = require("./agent-permissions");
 *   const result = check("git.push", { operatorApproval: false });
 *   // { allowed: false, tier: "dangerous", reason: "requires_operator_approval" }
 */

const logger = require("../utils/logger");

// ── Tiers ─────────────────────────────────────────────────────────────────

const TIERS = Object.freeze({
    READ:        "read",
    SAFE_WRITE:  "safe_write",
    DANGEROUS:   "dangerous",
    BLOCKED:     "blocked",
});

// ── Action registry ───────────────────────────────────────────────────────
// Key: action identifier used by agents and tool router
// Value: tier

const ACTION_MAP = Object.freeze({
    // ── Read-only (always allowed) ────────────────────────────────────
    "fs.read":           TIERS.READ,
    "fs.list":           TIERS.READ,
    "fs.stat":           TIERS.READ,
    "fs.exists":         TIERS.READ,
    "git.status":        TIERS.READ,
    "git.log":           TIERS.READ,
    "git.diff":          TIERS.READ,
    "git.branch":        TIERS.READ,
    "git.show":          TIERS.READ,
    "git.remote":        TIERS.READ,
    "git.ls-files":      TIERS.READ,
    "shell.echo":        TIERS.READ,
    "shell.pwd":         TIERS.READ,
    "shell.ls":          TIERS.READ,
    "shell.cat":         TIERS.READ,
    "shell.whoami":      TIERS.READ,
    "shell.date":        TIERS.READ,
    "shell.grep":        TIERS.READ,
    "shell.find":        TIERS.READ,
    "runtime.status":    TIERS.READ,
    "runtime.history":   TIERS.READ,
    "runtime.logs":      TIERS.READ,
    "ai.chat":           TIERS.READ,

    // ── Safe write (allowed, logged) ─────────────────────────────────
    "fs.write":          TIERS.SAFE_WRITE,
    "fs.mkdir":          TIERS.SAFE_WRITE,
    "fs.copy":           TIERS.SAFE_WRITE,
    "git.add":           TIERS.SAFE_WRITE,
    "git.commit":        TIERS.SAFE_WRITE,
    "git.checkout":      TIERS.SAFE_WRITE,
    "git.stash":         TIERS.SAFE_WRITE,
    "runtime.dispatch":  TIERS.SAFE_WRITE,
    "runtime.queue":     TIERS.SAFE_WRITE,
    "runtime.stop":      TIERS.SAFE_WRITE,
    "runtime.resume":    TIERS.SAFE_WRITE,

    // ── Dangerous (operator approval required) ────────────────────────
    "git.push":          TIERS.DANGEROUS,
    "git.reset":         TIERS.DANGEROUS,
    "git.merge":         TIERS.DANGEROUS,
    "git.rebase":        TIERS.DANGEROUS,
    "npm.install":       TIERS.DANGEROUS,
    "npm.update":        TIERS.DANGEROUS,
    "npm.run":           TIERS.DANGEROUS,
    "shell.exec":        TIERS.DANGEROUS,  // arbitrary shell execution
    "process.spawn":     TIERS.DANGEROUS,
    "process.kill":      TIERS.DANGEROUS,
    "fs.delete":         TIERS.DANGEROUS,
    "fs.move":           TIERS.DANGEROUS,
    "env.write":         TIERS.DANGEROUS,

    // ── Blocked (never allowed) ───────────────────────────────────────
    "shell.sudo":        TIERS.BLOCKED,
    "shell.rm_recursive":TIERS.BLOCKED,
    "shell.curl_pipe":   TIERS.BLOCKED,
    "shell.wget_pipe":   TIERS.BLOCKED,
    "shell.eval":        TIERS.BLOCKED,
    "shell.chroot":      TIERS.BLOCKED,
    "process.self_exec": TIERS.BLOCKED,   // recursively spawning this process
    "agent.spawn_new":   TIERS.BLOCKED,   // autonomous agent spawning
    "env.read_secrets":  TIERS.BLOCKED,
    "package.publish":   TIERS.BLOCKED,
    "git.force_push":    TIERS.BLOCKED,
    "system.shutdown":   TIERS.BLOCKED,
    "system.reboot":     TIERS.BLOCKED,
});

/**
 * Check whether an action is permitted.
 *
 * @param {string}  action              — action identifier from ACTION_MAP
 * @param {object}  opts
 * @param {boolean} opts.operatorApproval — true if operator explicitly approved
 * @param {string}  opts.requestId      — for log correlation
 *
 * @returns {{ allowed: boolean, tier: string, reason: string|null }}
 */
function check(action, { operatorApproval = false, requestId = "-" } = {}) {
    const tier = ACTION_MAP[action];

    if (!tier) {
        // Unknown actions default to dangerous — require approval
        logger.warn(`[Permissions] [${requestId}] UNKNOWN action="${action}" — treating as dangerous`);
        if (!operatorApproval) {
            return { allowed: false, tier: TIERS.DANGEROUS, reason: "unknown_action_requires_approval" };
        }
        return { allowed: true, tier: TIERS.DANGEROUS, reason: null };
    }

    switch (tier) {
        case TIERS.BLOCKED:
            logger.error(`[Permissions] [${requestId}] BLOCKED action="${action}"`);
            return { allowed: false, tier, reason: "action_blocked" };

        case TIERS.DANGEROUS:
            if (!operatorApproval) {
                logger.warn(`[Permissions] [${requestId}] DENIED action="${action}" — operator approval required`);
                return { allowed: false, tier, reason: "requires_operator_approval" };
            }
            logger.warn(`[Permissions] [${requestId}] APPROVED (dangerous) action="${action}"`);
            return { allowed: true, tier, reason: null };

        case TIERS.SAFE_WRITE:
            logger.info(`[Permissions] [${requestId}] ALLOWED (safe_write) action="${action}"`);
            return { allowed: true, tier, reason: null };

        case TIERS.READ:
            // Read actions are not logged individually — too noisy
            return { allowed: true, tier, reason: null };

        default:
            return { allowed: false, tier: TIERS.BLOCKED, reason: "unknown_tier" };
    }
}

/**
 * Express middleware to gate a route by action permission.
 *
 * Usage:
 *   router.post("/runtime/dispatch", gate("runtime.dispatch"), handler);
 *   router.post("/git/push",         gate("git.push"),         handler);
 */
function gate(action) {
    return (req, res, next) => {
        const operatorApproval = req.body?.operator_approval === true
            || req.headers["x-operator-approval"] === "true";
        const requestId = req.id || "-";

        const result = check(action, { operatorApproval, requestId });
        if (!result.allowed) {
            return res.status(403).json({
                success: false,
                error:   `Action '${action}' not permitted: ${result.reason}`,
                tier:    result.tier,
            });
        }
        req.permissionTier = result.tier;
        next();
    };
}

/**
 * Get a summary of all registered actions by tier (for /runtime/status or audit).
 */
function summary() {
    const out = { read: [], safe_write: [], dangerous: [], blocked: [] };
    for (const [action, tier] of Object.entries(ACTION_MAP)) {
        out[tier].push(action);
    }
    return out;
}

module.exports = { check, gate, summary, TIERS, ACTION_MAP };
