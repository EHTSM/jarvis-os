"use strict";
/**
 * Symbol Intelligence — live grep-based code search.
 *
 * No pre-index. No daemon. Scans the working repo on demand via safe-exec grep.
 * All five capabilities use the same two grep calls (definition + references)
 * so a full query costs ~400-600ms total.
 *
 * Public API:
 *   findSymbol(name)        → { definitions[], references[], kind, summary }
 *   findReferences(name)    → { references[], count, files[] }
 *   findImplementations(name) → { implementations[], count }
 *   findImports(file)       → { imports[] }  (delegates to buildRepoContext)
 *   findDependents(file)    → { dependents[] } (delegates to buildRepoContext)
 */

const path = require("path");

// ── Shared constants ──────────────────────────────────────────────
const EXCL = [
    "--exclude-dir=node_modules", "--exclude-dir=_archive",
    "--exclude-dir=build",        "--exclude-dir=.git",
    "--exclude-dir=coverage",     "--exclude-dir=dist",
];
const INCL = [
    "--include=*.js", "--include=*.cjs", "--include=*.mjs",
    "--include=*.jsx", "--include=*.ts",  "--include=*.tsx",
];
const ROOT = path.resolve(".");

// ── Safe-exec loader (lazy — avoids circular dep at require time) ─
function _safeExec() { return require("../../backend/core/safe-exec"); }
function _buildCtx()  { return require("./codeGeneratorAgent.cjs").buildRepoContext; }

// ── Parse grep output line: "./file.js:42:content" ───────────────
function _parseLine(raw) {
    const m = raw.match(/^(.+?):(\d+):(.+)$/);
    if (!m) return null;
    return {
        file:    m[1].replace(/^\.\//, ""),
        line:    parseInt(m[2], 10),
        content: m[3].trim(),
    };
}

// ── Infer symbol kind from declaration line ───────────────────────
function _inferKind(content) {
    const c = content.trim();
    if (/^(export\s+default\s+)?(export\s+)?(async\s+)?function[\s(]/.test(c)) return "function";
    if (/^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?(\(|function)/.test(c))  return "function";
    if (/^(export\s+)?class\s/.test(c))                                                 return "class";
    if (/^(export\s+)?(const|let|var)\s+/.test(c))                                     return "variable";
    return "reference";
}

// ── grep runner ───────────────────────────────────────────────────
async function _grep(args, timeoutMs = 10000) {
    const r = await _safeExec().run("grep", args, { cwd: ROOT, timeoutMs });
    return (r.stdout || "").split("\n").filter(Boolean);
}

// ── 1. findSymbol ─────────────────────────────────────────────────
/**
 * Find where a symbol is defined and all places it is used.
 *
 * @param {string} name  - symbol name (function, class, variable, method)
 * @returns {{
 *   ok: boolean,
 *   name: string,
 *   definitions: Array<{file,line,content,kind}>,
 *   references:  Array<{file,line,content}>,
 *   kind:        string,
 *   summary:     string,
 * }}
 */
async function findSymbol(name) {
    if (!name || !name.trim()) return { ok: false, error: "name required" };
    const sym = name.trim();

    // Definition search: declaration patterns
    const defPattern =
        `(^|\\s)(async\\s+)?function\\s+${sym}[\\s(]|` +
        `(const|let|var)\\s+${sym}\\s*=\\s*(async\\s+)?(\\(|function)|` +
        `class\\s+${sym}[\\s{]`;

    const [defLines, refLines] = await Promise.all([
        _grep(["-rn", "-E", ...INCL, defPattern, ".", ...EXCL]),
        _grep(["-rn",       ...INCL, sym,         ".", ...EXCL]),
    ]);

    const definitions = defLines
        .map(_parseLine).filter(Boolean)
        .map(p => ({ ...p, kind: _inferKind(p.content) }));

    const defSet = new Set(definitions.map(d => `${d.file}:${d.line}`));

    const references = refLines
        .map(_parseLine).filter(Boolean)
        .filter(p => !defSet.has(`${p.file}:${p.line}`))
        .slice(0, 30);

    const kind = definitions[0]?.kind ?? "unknown";

    const summary = definitions.length === 0
        ? `Symbol "${sym}" not found in codebase.`
        : `"${sym}" is a ${kind} defined in ${definitions[0].file}:${definitions[0].line}. ` +
          `${references.length} reference(s) in ${new Set(references.map(r => r.file)).size} file(s).`;

    return {
        ok:          true,
        name:        sym,
        definitions,
        references,
        kind,
        summary,
        defCount:    definitions.length,
        refCount:    references.length,
    };
}

// ── 2. findReferences ─────────────────────────────────────────────
/**
 * All uses of a symbol (excludes definition lines).
 */
async function findReferences(name) {
    if (!name || !name.trim()) return { ok: false, error: "name required" };
    const result = await findSymbol(name.trim());
    if (!result.ok) return result;

    const files = [...new Set(result.references.map(r => r.file))];
    return {
        ok:         true,
        name:       result.name,
        references: result.references,
        count:      result.refCount,
        files,
        fileCount:  files.length,
        summary:    `"${result.name}" referenced ${result.refCount} time(s) across ${files.length} file(s).`,
    };
}

// ── 3. findImplementations ────────────────────────────────────────
/**
 * Only definition/implementation sites (no call-sites).
 */
async function findImplementations(name) {
    if (!name || !name.trim()) return { ok: false, error: "name required" };
    const result = await findSymbol(name.trim());
    if (!result.ok) return result;

    return {
        ok:              true,
        name:            result.name,
        implementations: result.definitions,
        count:           result.defCount,
        kind:            result.kind,
        summary:         result.defCount === 0
            ? `No implementation of "${result.name}" found.`
            : `"${result.name}" implemented in ${result.definitions[0].file}:${result.definitions[0].line} (${result.kind}).`,
    };
}

// ── 4. findImports ────────────────────────────────────────────────
/**
 * What a file imports (outbound dependencies).
 * Delegates to buildRepoContext which already does static require parse.
 */
function findImports(filePath) {
    if (!filePath) return { ok: false, error: "filePath required" };
    const ctx = _buildCtx()(filePath, "");
    return {
        ok:       true,
        filePath: ctx.targetFile,
        imports:  ctx.imports,
        count:    ctx.imports.length,
        summary:  `${ctx.targetFile} imports ${ctx.imports.length} local file(s).`,
    };
}

// ── 5. findDependents ─────────────────────────────────────────────
/**
 * What files import a given file (inbound dependencies / reverse deps).
 * Delegates to buildRepoContext which already does full-repo reverse scan.
 */
function findDependents(filePath) {
    if (!filePath) return { ok: false, error: "filePath required" };
    const ctx = _buildCtx()(filePath, "");
    return {
        ok:         true,
        filePath:   ctx.targetFile,
        dependents: ctx.importers,
        count:      ctx.importers.length,
        summary:    `${ctx.importers.length} file(s) depend on ${ctx.targetFile}.`,
    };
}

module.exports = { findSymbol, findReferences, findImplementations, findImports, findDependents };
