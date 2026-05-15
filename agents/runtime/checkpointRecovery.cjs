"use strict";
/**
 * checkpointRecovery — detect and repair corrupted workflow checkpoints.
 *
 * validate(id)        → { valid, issues[], file?, parsed? }
 * repair(id)          → { repaired, changes[], reason? }
 * scanAll()           → { total, valid, corrupted[{ id, issues }] }
 * purgeCorrupted()    → { removed[], count }
 */

const fs   = require("fs");
const path = require("path");
const cm   = require("./checkpointManager.cjs");

const CHECKPOINT_DIR   = path.join(__dirname, "../../data/workflow-checkpoints");
const REQUIRED_FIELDS  = ["id", "name", "status", "startedAt", "steps"];
const VALID_STATUSES   = ["running", "completed", "failed", "partial"];

function _filePath(id) {
    return path.join(CHECKPOINT_DIR, `${id}.json`);
}

function validate(id) {
    const file = _filePath(id);
    let raw;
    try { raw = fs.readFileSync(file, "utf8"); }
    catch (e) { return { valid: false, issues: [`cannot read file: ${e.message}`] }; }

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { return { valid: false, issues: [`JSON parse error: ${e.message}`], raw, file }; }

    const issues = [];
    for (const field of REQUIRED_FIELDS) {
        if (parsed[field] === undefined || parsed[field] === null) {
            issues.push(`missing required field: ${field}`);
        }
    }
    if (parsed.status !== undefined && !VALID_STATUSES.includes(parsed.status)) {
        issues.push(`invalid status: "${parsed.status}"`);
    }
    if (parsed.steps !== undefined && !Array.isArray(parsed.steps)) {
        issues.push("steps must be an array");
    }
    if (parsed.startedAt && isNaN(Date.parse(parsed.startedAt))) {
        issues.push("startedAt is not a valid ISO date");
    }

    return { valid: issues.length === 0, issues, file, parsed };
}

function repair(id) {
    const result = validate(id);
    if (result.valid) return { repaired: false, changes: [], reason: "already_valid" };
    if (!result.parsed) return { repaired: false, changes: [], reason: "unparseable_json" };

    const p       = result.parsed;
    const changes = [];

    if (!p.id)        { p.id        = id;                         changes.push("restored id"); }
    if (!p.name)      { p.name      = id;                         changes.push("restored name from id"); }
    if (!p.startedAt) { p.startedAt = new Date().toISOString();   changes.push("restored startedAt"); }
    if (!Array.isArray(p.steps)) { p.steps = [];                  changes.push("reset steps to []"); }
    if (!VALID_STATUSES.includes(p.status)) {
        p.status = "failed";
        changes.push(`corrected status to "failed"`);
    }

    if (changes.length > 0) {
        try {
            fs.writeFileSync(result.file, JSON.stringify(p, null, 2), "utf8");
        } catch (e) {
            return { repaired: false, changes, reason: `write failed: ${e.message}` };
        }
    }

    return { repaired: changes.length > 0, changes };
}

function scanAll() {
    const ids    = cm.list();
    const report = { total: ids.length, valid: 0, corrupted: [] };
    for (const id of ids) {
        const v = validate(id);
        if (v.valid) report.valid++;
        else         report.corrupted.push({ id, issues: v.issues });
    }
    return report;
}

function purgeCorrupted() {
    const scan    = scanAll();
    const removed = [];
    for (const { id } of scan.corrupted) {
        try { cm.remove(id); removed.push(id); } catch { /* skip */ }
    }
    return { removed, count: removed.length };
}

module.exports = { validate, repair, scanAll, purgeCorrupted, REQUIRED_FIELDS, VALID_STATUSES };
