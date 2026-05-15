"use strict";
/**
 * rollbackCoordinator — register, execute, and chain rollback operations.
 *
 * Targets: git_revert, filesystem_restore, docker_restart,
 *          process_termination, workspace_restore
 *
 * registerRollback(spec)              → RegistrationResult
 * executeRollback(rollbackId, opts)   → ExecutionResult
 * executeRollbackChain(chainId, opts) → ChainResult
 * getRollbackStatus(rollbackId)       → StatusRecord | null
 * listRollbacks(filter)               → RollbackRecord[]
 * reset()
 */

const ROLLBACK_TARGETS = [
    "git_revert",
    "filesystem_restore",
    "docker_restart",
    "process_termination",
    "workspace_restore",
];

const ROLLBACK_STATUSES = ["pending", "executing", "completed", "failed", "skipped"];

// Actions emitted per rollback target
const TARGET_ACTIONS = {
    git_revert:           ["git_revert_commit", "restore_working_tree", "reset_index"],
    filesystem_restore:   ["restore_file_contents", "reset_permissions", "remove_created_files"],
    docker_restart:       ["stop_container", "remove_container", "recreate_container", "start_container"],
    process_termination:  ["send_sigterm", "wait_for_exit", "release_resources"],
    workspace_restore:    ["close_open_files", "restore_workspace_state", "reload_extensions"],
};

let _rollbacks = new Map();   // rollbackId → RollbackRecord
let _chains    = new Map();   // chainId → ChainRecord
let _counter   = 0;

// ── registerRollback ──────────────────────────────────────────────────

function registerRollback(spec = {}) {
    const {
        execId   = null,
        target,
        metadata = {},
        priority = 5,       // 1 = highest, 10 = lowest
        chainId  = null,
    } = spec;

    if (!ROLLBACK_TARGETS.includes(target))
        return { registered: false, reason: `invalid_target: ${target}` };

    const rollbackId = `rbk-${++_counter}`;
    const record = {
        rollbackId,
        execId,
        target,
        metadata:     { ...metadata },
        priority,
        chainId,
        status:       "pending",
        registeredAt: new Date().toISOString(),
        executedAt:   null,
        result:       null,
    };

    _rollbacks.set(rollbackId, record);

    if (chainId) {
        if (!_chains.has(chainId))
            _chains.set(chainId, { chainId, rollbacks: [], status: "pending", createdAt: new Date().toISOString() });
        _chains.get(chainId).rollbacks.push(rollbackId);
    }

    return { registered: true, rollbackId, execId, target };
}

// ── executeRollback ───────────────────────────────────────────────────

function executeRollback(rollbackId, opts = {}) {
    const record = _rollbacks.get(rollbackId);
    if (!record)                          return { executed: false, reason: "rollback_not_found",   rollbackId };
    if (record.status === "completed")    return { executed: false, reason: "already_completed",    rollbackId };
    if (record.status === "executing")    return { executed: false, reason: "already_executing",    rollbackId };

    record.status     = "executing";
    record.executedAt = new Date().toISOString();

    const actions = TARGET_ACTIONS[record.target] ?? ["generic_restore"];
    const success = opts.forceFailure !== true;

    record.status = success ? "completed" : "failed";
    record.result = {
        success,
        actions,
        restoredState: success ? { ...record.metadata, restored: true } : null,
        error:         success ? null : (opts.error ?? "rollback_execution_error"),
    };

    return {
        executed:      true,
        rollbackId,
        target:        record.target,
        status:        record.status,
        actions,
        success,
        restoredState: record.result.restoredState,
    };
}

// ── executeRollbackChain ──────────────────────────────────────────────

function executeRollbackChain(chainId, opts = {}) {
    const chain = _chains.get(chainId);
    if (!chain) return { executed: false, reason: "chain_not_found", chainId };

    // Sort ascending by priority (1 = highest priority runs first)
    const sorted = chain.rollbacks
        .map(id => _rollbacks.get(id))
        .filter(Boolean)
        .sort((a, b) => a.priority - b.priority);

    chain.status = "executing";
    const results = [];
    let allSucceeded = true;

    for (const rbk of sorted) {
        const r = executeRollback(rbk.rollbackId, opts);
        results.push(r);
        if (!r.success) {
            allSucceeded = false;
            if (opts.stopOnFailure !== false) break;
        }
    }

    chain.status = allSucceeded ? "completed" : "partial";

    return {
        executed:      true,
        chainId,
        rollbackCount: results.length,
        succeeded:     results.filter(r => r.success).length,
        failed:        results.filter(r => !r.success).length,
        status:        chain.status,
        results,
    };
}

// ── getRollbackStatus ─────────────────────────────────────────────────

function getRollbackStatus(rollbackId) {
    const record = _rollbacks.get(rollbackId);
    if (!record) return null;
    return {
        rollbackId:   record.rollbackId,
        execId:       record.execId,
        target:       record.target,
        status:       record.status,
        priority:     record.priority,
        chainId:      record.chainId,
        registeredAt: record.registeredAt,
        executedAt:   record.executedAt,
        result:       record.result,
    };
}

// ── listRollbacks ─────────────────────────────────────────────────────

function listRollbacks(filter = {}) {
    let rollbacks = [..._rollbacks.values()];
    if (filter.status) rollbacks = rollbacks.filter(r => r.status === filter.status);
    if (filter.execId) rollbacks = rollbacks.filter(r => r.execId === filter.execId);
    if (filter.target) rollbacks = rollbacks.filter(r => r.target === filter.target);
    return rollbacks;
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _rollbacks = new Map();
    _chains    = new Map();
    _counter   = 0;
}

module.exports = {
    ROLLBACK_TARGETS, ROLLBACK_STATUSES, TARGET_ACTIONS,
    registerRollback, executeRollback, executeRollbackChain,
    getRollbackStatus, listRollbacks, reset,
};
