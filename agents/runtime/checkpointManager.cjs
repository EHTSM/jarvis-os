"use strict";
/**
 * checkpointManager — public API for workflow checkpoint management.
 *
 * Wraps the checkpoint files written by autonomousWorkflow to provide:
 *   list()         — all saved checkpoint IDs
 *   get(id)        — load one checkpoint state object
 *   listPartial()  — checkpoints whose status is "running" (interrupted)
 *   remove(id)     — delete a checkpoint file
 *   resume(id, steps, opts) — re-run from the saved state
 *   count()        — total number of checkpoints on disk
 *
 * Checkpoint files live at data/workflow-checkpoints/<id>.json.
 * State schema matches what autonomousWorkflow writes internally.
 */

const fs   = require("fs");
const path = require("path");
const { runWorkflow, loadCheckpoint } = require("./autonomousWorkflow.cjs");

const CHECKPOINT_DIR = path.join(__dirname, "../../data/workflow-checkpoints");

function _ensureDir() {
    if (!fs.existsSync(CHECKPOINT_DIR)) fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
}

// ── Queries ───────────────────────────────────────────────────────────

/** All checkpoint IDs currently on disk. */
function list() {
    _ensureDir();
    try {
        return fs.readdirSync(CHECKPOINT_DIR)
            .filter(f => f.endsWith(".json"))
            .map(f => f.slice(0, -5));
    } catch { return []; }
}

/** Load and return the raw checkpoint state for a given id. */
function get(id) {
    return loadCheckpoint(id);
}

/**
 * Checkpoints in "running" status — these are interrupted workflows that
 * can be resumed.
 */
function listPartial() {
    return list()
        .map(id => loadCheckpoint(id))
        .filter(cp => cp && cp.status === "running");
}

/** Number of checkpoint files on disk. */
function count() {
    return list().length;
}

// ── Mutations ─────────────────────────────────────────────────────────

/** Delete a checkpoint file. Returns true if deleted, false if not found. */
function remove(id) {
    try { fs.unlinkSync(path.join(CHECKPOINT_DIR, `${id}.json`)); return true; }
    catch { return false; }
}

/**
 * Resume an interrupted workflow from its saved checkpoint.
 * `steps` must be the same step array as the original run (same names).
 *
 * @param {string}   id
 * @param {object[]} steps
 * @param {object}   opts  — merged into runWorkflow opts (resume: true is forced)
 * @returns {Promise<WorkflowResult>}
 */
async function resume(id, steps, opts = {}) {
    const cp = loadCheckpoint(id);
    if (!cp) throw new Error(`checkpointManager: no checkpoint for id "${id}"`);
    return runWorkflow(cp.name, steps, { ...opts, id, resume: true });
}

module.exports = { list, get, listPartial, remove, resume, count, CHECKPOINT_DIR };
