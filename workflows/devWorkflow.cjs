"use strict";
/**
 * devWorkflow — end-to-end coding workflow.
 *
 * Steps:
 *   1. open-editor      — open VS Code with the project (optional, non-fatal)
 *   2. scan-project     — list all .js/.cjs/.mjs files in projectPath
 *   3. check-syntax     — node --check every file, collect errors
 *   4. fix-errors       — apply opts.fixer to each broken file, cache originals for rollback
 *   5. recheck-syntax   — node --check every fixed file, validate all pass
 *   6. run-script       — optional terminal command (e.g. "node -v", "npm test")
 *   7. summarize        — aggregate results into a structured report
 *
 * Usage:
 *   const { createDevWorkflow } = require("./workflows/devWorkflow");
 *   const { runWorkflow }       = require("./agents/runtime/autonomousWorkflow");
 *
 *   const steps = createDevWorkflow("/path/to/project", {
 *     fixer:      (content, errMsg) => fixedContent,
 *     runScript:  "node -v",
 *     skipEditor: true,
 *   });
 *   const result = await runWorkflow("fix-my-project", steps);
 *
 * opts:
 *   fixer(content, errorMsg) → string   — deterministic or AI-powered fix function
 *   runScript  {string}                 — whitelisted terminal command to run post-fix
 *   skipEditor {boolean}                — skip VS Code step (useful in CI / tests)
 */

const fs   = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// ── Syntax checker ────────────────────────────────────────────────
// Uses node --check directly via spawnSync (trusted workflow code — not user input).
// This bypasses terminalAgent's security whitelist intentionally: the file paths
// come from our own fs.readdirSync scan, never from raw user text.
function _checkSyntax(filePath) {
    const r = spawnSync("node", ["--check", filePath], { encoding: "utf8", timeout: 5_000 });
    if (r.status === 0) return { ok: true, error: null };
    // Extract the SyntaxError line from stderr
    const lines   = (r.stderr || "").split("\n").map(l => l.trim()).filter(Boolean);
    const errLine = lines.find(l => l.startsWith("SyntaxError:")) || lines.pop() || "SyntaxError: unknown";
    return { ok: false, error: errLine };
}

// ── Desktop agent (lazy-loaded) ────────────────────────────────────
// Initialize as undefined (not null) so the "already loaded?" guard works correctly.
let _da;
function _getDesktop() {
    if (_da !== undefined) return _da;
    try { const { DesktopAgent } = require("../agents/desktopAgent.cjs"); _da = new DesktopAgent(); }
    catch { _da = null; }
    return _da;
}

// ── Terminal agent (lazy-loaded) ──────────────────────────────────
let _terminal;
function _getTerm() {
    if (_terminal !== undefined) return _terminal;
    try { _terminal = require("../agents/terminalAgent.cjs"); }
    catch { _terminal = null; }
    return _terminal;
}

// ── Workflow factory ──────────────────────────────────────────────

function createDevWorkflow(projectPath, opts = {}) {
    const absPath = path.resolve(projectPath);

    return [

        // ── Step 1: Open editor ────────────────────────────────────
        {
            name:     "open-editor",
            optional: true,   // VS Code may not be installed; never abort for this
            execute:  async () => {
                if (opts.skipEditor) return { skipped: true, reason: "skipEditor=true" };
                const da = _getDesktop();
                if (!da) return { skipped: true, reason: "DesktopAgent unavailable" };
                const r = await da.openApp("Visual Studio Code");
                return r;
            },
        },

        // ── Step 2: Scan project ───────────────────────────────────
        {
            name: "scan-project",
            execute: async () => {
                const entries = fs.readdirSync(absPath);
                const files   = entries
                    .filter(f => /\.(js|cjs|mjs)$/.test(f))
                    .map(f => path.join(absPath, f));
                return { files, count: files.length, dir: absPath };
            },
            validate: (r) => r.count > 0,
        },

        // ── Step 3: Check syntax ───────────────────────────────────
        {
            name: "check-syntax",
            execute: async (ctx) => {
                const { files } = ctx["scan-project"];
                const errors    = [];
                const clean     = [];
                for (const f of files) {
                    const r = _checkSyntax(f);
                    if (r.ok) clean.push(path.basename(f));
                    else      errors.push({ file: f, basename: path.basename(f), error: r.error });
                }
                return { errors, clean, hasErrors: errors.length > 0 };
            },
        },

        // ── Step 4: Fix errors ─────────────────────────────────────
        {
            name: "fix-errors",
            execute: async (ctx) => {
                const { errors } = ctx["check-syntax"];
                if (errors.length === 0) return { count: 0, fixed: [], skipped: true };

                if (!opts.fixer) {
                    throw new Error(
                        `${errors.length} syntax error(s) found but no fixer provided. ` +
                        `Files: ${errors.map(e => e.basename).join(", ")}`
                    );
                }

                const fixed     = [];
                const originals = {};

                for (const { file, basename, error } of errors) {
                    const original = fs.readFileSync(file, "utf8");
                    originals[file] = original;

                    const patched = opts.fixer(original, error);
                    if (patched === original) {
                        throw new Error(`Fixer produced no change for "${basename}" (error: ${error})`);
                    }

                    fs.writeFileSync(file, patched, "utf8");
                    fixed.push({ file, basename, original, patched });
                }

                ctx._originals = originals;  // for rollback
                return { count: fixed.length, fixed };
            },
            rollback: async (ctx) => {
                for (const [file, content] of Object.entries(ctx._originals || {})) {
                    try { fs.writeFileSync(file, content, "utf8"); } catch { /* best-effort */ }
                }
            },
        },

        // ── Step 5: Re-check syntax (validate fix worked) ─────────
        {
            name: "recheck-syntax",
            execute: async (ctx) => {
                const fixResult = ctx["fix-errors"];
                if (fixResult?.skipped) return { allPassed: true, checked: 0, results: [] };

                const results = fixResult.fixed.map(({ file, basename }) => {
                    const r = _checkSyntax(file);
                    return { file: basename, ok: r.ok, error: r.error };
                });

                return {
                    allPassed: results.every(r => r.ok),
                    checked:   results.length,
                    results,
                };
            },
            validate: (r) => r.allPassed,
        },

        // ── Step 6: Run post-fix script (optional) ────────────────
        {
            name:     "run-script",
            optional: true,
            execute:  async () => {
                const cmd = opts.runScript;
                if (!cmd) return { skipped: true };
                const term = _getTerm();
                if (!term) return { skipped: true, reason: "TerminalAgent unavailable" };
                const r = await term.run(cmd);
                return { success: r.success, output: (r.stdout || r.output || "").slice(0, 400), command: cmd };
            },
        },

        // ── Step 7: Summarize ──────────────────────────────────────
        {
            name: "summarize",
            execute: async (ctx) => {
                const scan    = ctx["scan-project"]  || {};
                const check   = ctx["check-syntax"]  || {};
                const fix     = ctx["fix-errors"]    || {};
                const recheck = ctx["recheck-syntax"] || {};
                const script  = ctx["run-script"]    || {};

                const errorsFound = check.errors?.length  ?? 0;
                const errorsFixed = fix.count             ?? 0;
                const syntaxClean = recheck.allPassed     ?? (errorsFound === 0);
                const scriptOk    = script.skipped        ? null : (script.success ?? false);

                const lines = [
                    `Scanned ${scan.count ?? 0} file(s) in ${path.basename(absPath)}.`,
                    errorsFound === 0
                        ? "All files passed syntax check."
                        : `Found ${errorsFound} syntax error(s), fixed ${errorsFixed}.`,
                    syntaxClean
                        ? "Syntax validation passed."
                        : "WARNING: syntax errors remain after fix.",
                    scriptOk === null
                        ? ""
                        : `Script "${script.command}": ${scriptOk ? "passed" : "FAILED"}.`,
                ].filter(Boolean);

                return {
                    filesScanned: scan.count   ?? 0,
                    errorsFound,
                    errorsFixed,
                    syntaxClean,
                    scriptResult: scriptOk,
                    summary:      lines.join(" "),
                };
            },
        },
    ];
}

module.exports = { createDevWorkflow };
