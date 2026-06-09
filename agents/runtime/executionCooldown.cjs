"use strict";
/**
 * Phase 400 — Execution Cooldown + Throttling
 *
 * Prevents: restart storms, repeated retries, adapter spam,
 *           rapid workflow recursion, queue floods.
 *
 * Three independent mechanisms:
 *   1. Per-command cooldown: same command can't run twice within cooldownMs
 *   2. Per-chain cooldown: same chain can't restart within chainCooldownMs
 *   3. Workflow throttle: max N workflows per minute system-wide
 *
 * All state is in-memory. Resets on process restart (intentional — cooldowns
 * are a runtime concern, not a persistence concern).
 */

const logger = require("../../backend/utils/logger");

// ── Per-command cooldowns ─────────────────────────────────────────────────────
const CMD_COOLDOWNS = {
    default:          2_000,    // 2s between identical commands
    "pm2 restart":   10_000,    // 10s — restart storms
    "pm2 reload":    10_000,
    "npm run build": 30_000,    // 30s — build spam
    "npm install":   60_000,    // 60s — install spam
    "git push":      15_000,    // 15s — push throttle
    "git pull":       5_000,
    "git rebase":    10_000,
};

const _lastRun  = new Map();   // cmdKey → lastRunAt
const _chainRun = new Map();   // chainName → lastRunAt

// ── System-wide workflow throttle ─────────────────────────────────────────────
const WORKFLOW_THROTTLE = {
    windowMs:  60_000,
    maxPerMin: 10,           // max 10 workflow starts per minute
    _ticks:    [],
};

function _cmdKey(cmd) { return cmd.trim().toLowerCase().slice(0, 100); }

function _getCooldownMs(cmd) {
    const lower = cmd.trim().toLowerCase();
    for (const [pattern, ms] of Object.entries(CMD_COOLDOWNS)) {
        if (pattern !== "default" && lower.startsWith(pattern)) return ms;
    }
    return CMD_COOLDOWNS.default;
}

/**
 * Check if a command is in cooldown.
 * @param {string} cmd
 * @returns {{ allowed: bool, remainingMs: number, reason: string }}
 */
function checkCommand(cmd) {
    const key     = _cmdKey(cmd);
    const last    = _lastRun.get(key) || 0;
    const cooling = _getCooldownMs(cmd);
    const elapsed = Date.now() - last;
    if (elapsed < cooling) {
        return {
            allowed:     false,
            remainingMs: cooling - elapsed,
            reason:      `command_cooldown:${Math.ceil((cooling - elapsed) / 1000)}s`,
        };
    }
    return { allowed: true, remainingMs: 0, reason: "" };
}

/**
 * Record that a command just ran. Call after dispatch is confirmed.
 * @param {string} cmd
 */
function recordRun(cmd) {
    _lastRun.set(_cmdKey(cmd), Date.now());
}

/**
 * Check if a workflow chain is in cooldown.
 * Chains have a longer cooldown than individual commands — prevents restart loops.
 * @param {string} chainName
 * @returns {{ allowed: bool, remainingMs: number }}
 */
function checkChain(chainName) {
    const CHAIN_COOLDOWN_MS = 60_000; // 1 min between same chain restarts
    const last    = _chainRun.get(chainName) || 0;
    const elapsed = Date.now() - last;
    if (elapsed < CHAIN_COOLDOWN_MS && last > 0) {
        return { allowed: false, remainingMs: CHAIN_COOLDOWN_MS - elapsed };
    }
    return { allowed: true, remainingMs: 0 };
}

/**
 * Record that a chain started. Call when a chain begins execution.
 * @param {string} chainName
 */
function recordChainStart(chainName) {
    _chainRun.set(chainName, Date.now());

    // System-wide workflow throttle tick
    const now = Date.now();
    WORKFLOW_THROTTLE._ticks = WORKFLOW_THROTTLE._ticks.filter(t => now - t < WORKFLOW_THROTTLE.windowMs);
    WORKFLOW_THROTTLE._ticks.push(now);
}

/**
 * Check system-wide workflow throttle.
 * @returns {{ allowed: bool, rate: number, maxPerMin: number }}
 */
function checkWorkflowThrottle() {
    const now = Date.now();
    WORKFLOW_THROTTLE._ticks = WORKFLOW_THROTTLE._ticks.filter(t => now - t < WORKFLOW_THROTTLE.windowMs);
    const rate = WORKFLOW_THROTTLE._ticks.length;
    return {
        allowed:   rate < WORKFLOW_THROTTLE.maxPerMin,
        rate,
        maxPerMin: WORKFLOW_THROTTLE.maxPerMin,
    };
}

/**
 * Comprehensive gate: all three checks in one call.
 * @param {string} cmd
 * @param {string} [chainName]
 * @returns {{ allowed: bool, reason: string, details: object }}
 */
function gate(cmd, chainName) {
    const cmdCheck   = checkCommand(cmd);
    const wfCheck    = checkWorkflowThrottle();
    const chainCheck = chainName ? checkChain(chainName) : { allowed: true };

    if (!wfCheck.allowed) {
        logger.warn(`[Cooldown] workflow throttle — ${wfCheck.rate}/${wfCheck.maxPerMin} per min`);
        return { allowed: false, reason: `workflow_throttle:${wfCheck.rate}/min`, details: { wfCheck } };
    }
    if (chainName && !chainCheck.allowed) {
        logger.warn(`[Cooldown] chain "${chainName}" in cooldown — ${Math.ceil(chainCheck.remainingMs / 1000)}s remaining`);
        return { allowed: false, reason: `chain_cooldown:${chainName}`, details: { chainCheck } };
    }
    if (!cmdCheck.allowed) {
        logger.info(`[Cooldown] command in cooldown — ${cmdCheck.reason}`);
        return { allowed: false, reason: cmdCheck.reason, details: { cmdCheck } };
    }
    return { allowed: true, reason: "", details: {} };
}

/** Diagnostics snapshot. */
function stats() {
    return {
        trackedCommands: _lastRun.size,
        trackedChains:   _chainRun.size,
        workflowRate:    WORKFLOW_THROTTLE._ticks.length,
        workflowMaxPerMin: WORKFLOW_THROTTLE.maxPerMin,
    };
}

module.exports = { checkCommand, recordRun, checkChain, recordChainStart, checkWorkflowThrottle, gate, stats };
