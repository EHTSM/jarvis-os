"use strict";
/**
 * commitGrouper — group changed files into conventional commit batches.
 *
 * detectType(filePath)        → conventional commit type string
 * group(files[])              → { feat, fix, refactor, test, docs, chore, build }
 * generateMessage(type, files) → commit message string
 * buildCommitPlan(files[])    → [{ type, files[], message }] ordered plan
 */

const path = require("path");

// File path patterns → commit type
const TYPE_RULES = [
    { type: "test",     pattern: /\/(tests?|__tests?__|spec)\//i },
    { type: "test",     pattern: /\.(test|spec)\.[a-z]+$/i },
    { type: "docs",     pattern: /\.(md|txt|rst|adoc)$/i },
    { type: "docs",     pattern: /\/(docs?|documentation)\//i },
    { type: "build",    pattern: /\/(\.github|\.circleci|\.gitlab)\//i },
    { type: "build",    pattern: /(Dockerfile|docker-compose|Makefile|\.yml|\.yaml)$/i },
    { type: "chore",    pattern: /(package\.json|package-lock\.json|yarn\.lock|\.nvmrc|\.node-version)$/i },
    { type: "chore",    pattern: /\.(eslintrc|prettierrc|babelrc|tsconfig)[^/]*$/i },
    { type: "refactor", pattern: /\/(utils?|helpers?|lib|shared)\//i },
    { type: "feat",     pattern: /\/(features?|modules?|components?)\//i },
    { type: "fix",      pattern: /\/(fix(es)?|patches?|hotfix)\//i },
];

const TYPE_ORDER = ["fix", "feat", "refactor", "test", "build", "docs", "chore"];

function detectType(filePath) {
    for (const { type, pattern } of TYPE_RULES) {
        if (pattern.test(filePath)) return type;
    }
    // Default: infer from extension
    const ext = path.extname(filePath).toLowerCase();
    if ([".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx"].includes(ext)) return "feat";
    if ([".css", ".scss", ".less", ".html"].includes(ext)) return "feat";
    return "chore";
}

function group(files) {
    const groups = { feat: [], fix: [], refactor: [], test: [], docs: [], chore: [], build: [] };
    for (const f of files) {
        const type = detectType(f);
        (groups[type] || (groups.chore)).push(f);
    }
    return groups;
}

function generateMessage(type, files) {
    const scope = _inferScope(files);
    const summary = _summarize(files);
    const prefix = `${type}${scope ? `(${scope})` : ""}`;
    return `${prefix}: ${summary}`;
}

function _inferScope(files) {
    if (files.length === 0) return null;
    // Find common directory component
    const dirs = files.map(f => path.dirname(f).split(path.sep).filter(Boolean));
    if (dirs.length === 0 || dirs[0].length === 0) return null;
    let common = dirs[0][0];
    for (const d of dirs) if (d[0] !== common) return null;
    // Strip generic dirs
    if ([".", "src", "lib", "agents"].includes(common)) return null;
    return common.length <= 20 ? common : null;
}

function _summarize(files) {
    if (files.length === 1) {
        return `update ${path.basename(files[0])}`;
    }
    return `update ${files.length} files`;
}

function buildCommitPlan(files) {
    const grouped = group(files);
    return TYPE_ORDER
        .filter(type => grouped[type]?.length > 0)
        .map(type => ({
            type,
            files:   grouped[type],
            message: generateMessage(type, grouped[type]),
        }));
}

module.exports = { detectType, group, generateMessage, buildCommitPlan, TYPE_ORDER };
