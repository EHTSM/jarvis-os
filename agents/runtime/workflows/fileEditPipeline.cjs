"use strict";
/**
 * fileEditPipeline — safe file editing with automatic backup and rollback.
 *
 * backupStep(filePath)          — copy file to <path>.bak.<ts>  → ctx._bak_<path>
 * editStep(filePath, patchFn)   — read → patchFn(content, ctx) → write  (rollback restores)
 * restoreStep(filePath)         — restore from ctx._bak_<path>
 * buildEditPipeline(files, opts) — compose: [backup?, edit, …, verify?]
 */

const fs   = require("fs");
const path = require("path");

function _bakKey(filePath) { return `_bak_${filePath}`; }
function _bakPath(filePath) { return `${filePath}.bak.${Date.now()}`; }

function backupStep(filePath) {
    return {
        name: `backup:${path.basename(filePath)}`,
        execute: async (ctx) => {
            if (!fs.existsSync(filePath)) {
                ctx[_bakKey(filePath)] = null;
                return { skipped: true, reason: "file_not_found" };
            }
            const bak = _bakPath(filePath);
            fs.copyFileSync(filePath, bak);
            ctx[_bakKey(filePath)] = bak;
            return { backup: bak };
        },
    };
}

function editStep(filePath, patchFn) {
    return {
        name: `edit:${path.basename(filePath)}`,
        execute: async (ctx) => {
            const original = fs.existsSync(filePath)
                ? fs.readFileSync(filePath, "utf8")
                : "";
            const patched = await Promise.resolve(patchFn(original, ctx));
            if (typeof patched !== "string") throw new Error("patchFn must return a string");
            fs.writeFileSync(filePath, patched, "utf8");
            ctx[`_edit_${filePath}`] = { original, patched };
            return { edited: filePath, bytesDelta: patched.length - original.length };
        },
        rollback: async (ctx) => {
            const bak  = ctx[_bakKey(filePath)];
            const edit = ctx[`_edit_${filePath}`];
            if (bak && fs.existsSync(bak)) {
                fs.copyFileSync(bak, filePath);
                try { fs.unlinkSync(bak); } catch { /* ignore */ }
            } else if (edit) {
                fs.writeFileSync(filePath, edit.original, "utf8");
            }
        },
    };
}

function restoreStep(filePath) {
    return {
        name: `restore:${path.basename(filePath)}`,
        execute: async (ctx) => {
            const bak = ctx[_bakKey(filePath)];
            if (!bak || !fs.existsSync(bak)) return { skipped: true, reason: "no_backup" };
            fs.copyFileSync(bak, filePath);
            try { fs.unlinkSync(bak); } catch { /* ignore */ }
            return { restored: filePath };
        },
    };
}

function buildEditPipeline(files, opts = {}) {
    const steps = [];
    for (const entry of files) {
        const filePath = entry.path || entry;
        const patchFn  = entry.patchFn || ((c) => c);
        if (opts.backup !== false) steps.push(backupStep(filePath));
        steps.push(editStep(filePath, patchFn));
    }
    if (typeof opts.verify === "function") {
        steps.push({
            name: "verify-edits",
            execute: async (ctx) => {
                const result = await Promise.resolve(opts.verify(ctx));
                if (!result?.ok) throw new Error(result?.reason || "verification_failed");
                return result;
            },
        });
    }
    return steps;
}

module.exports = { backupStep, editStep, restoreStep, buildEditPipeline };
