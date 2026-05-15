"use strict";
/**
 * syntaxValidator — validate JS/CJS syntax before writing to disk.
 *
 * validate(code, filename?)   → { valid, errors[], warnings[] }
 * validateFile(filePath)      → same, reads file first
 *
 * Uses Node's vm.Script which runs the same parser as Node itself.
 * Does NOT execute the code — only parses it.
 */

const vm   = require("vm");
const fs   = require("fs");
const path = require("path");

const SUPPORTED_EXTS = new Set([".js", ".cjs", ".mjs"]);

function validate(code, filename = "anonymous.js") {
    if (typeof code !== "string") {
        return { valid: false, errors: [{ message: "code must be a string" }], warnings: [] };
    }

    // Strip shebangs
    const source = code.replace(/^#!.+\n/, "");

    try {
        new vm.Script(source, { filename });
        return { valid: true, errors: [], warnings: _lint(source) };
    } catch (e) {
        return {
            valid:    false,
            errors:   [{
                message: e.message,
                line:    e.lineNumber   || null,
                col:     e.columnNumber || null,
            }],
            warnings: [],
        };
    }
}

function validateFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) {
        return { valid: true, errors: [], warnings: [`unsupported extension: ${ext} — skipped`] };
    }
    let code;
    try { code = fs.readFileSync(filePath, "utf8"); }
    catch (e) { return { valid: false, errors: [{ message: `cannot read: ${e.message}` }], warnings: [] }; }
    return validate(code, filePath);
}

// Basic linting heuristics (non-fatal)
function _lint(code) {
    const warnings = [];
    if (/\bconsole\.log\b/.test(code)) warnings.push("console.log found");
    if (/debugger\b/.test(code))       warnings.push("debugger statement found");
    if (/TODO|FIXME/i.test(code))      warnings.push("TODO/FIXME comment found");
    return warnings;
}

module.exports = { validate, validateFile, SUPPORTED_EXTS };
