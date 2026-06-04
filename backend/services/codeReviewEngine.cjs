"use strict";
/**
 * CodeReviewEngine — static analysis + AI-assisted code review.
 *
 * Accepts raw code or file paths. Runs deterministic checkers
 * (no network required) first; optionally routes to OpenRouter for
 * semantic analysis.
 *
 * Detectors:
 *   smells     — long functions, deep nesting, duplicate literals, magic numbers
 *   security   — injection patterns, eval, hardcoded secrets, weak crypto
 *   performance— synchronous I/O in hot paths, unbounded loops, missing indexes
 *
 * All reviews persisted to data/code-reviews.json.
 *
 * Public API:
 *   reviewCode(code, opts)           → ReviewResult
 *   reviewFile(filePath, opts)       → ReviewResult
 *   reviewDiff(diff, opts)           → ReviewResult
 *   getReview(reviewId)              → ReviewResult | null
 *   listReviews(opts)                → { reviews[], stats }
 *   getSummary(reviewId)             → { summary, score }
 *   getStats()                       → aggregate stats
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const execLog = require("../utils/execLog.cjs");

const REVIEWS_FILE = path.join(__dirname, "../../data/code-reviews.json");

function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function _wj(f, d) {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = f + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(d, null, 2)); fs.renameSync(tmp, f);
}

let _reviews = _rj(REVIEWS_FILE, []);
let _seq = _reviews.length;
function _rid() { return `rev_${Date.now()}_${(++_seq).toString(36)}`; }
function _save() { try { _wj(REVIEWS_FILE, _reviews.slice(-500)); } catch { /* non-fatal */ } }

// ── Finding factory ───────────────────────────────────────────────────────
function _finding(category, severity, rule, message, line = null, col = null, suggestion = null) {
    return { category, severity, rule, message, line, col, suggestion };
}

// ── Code smell detectors ──────────────────────────────────────────────────
function detectSmells(code, language = "js") {
    const findings = [];
    const lines = code.split("\n");

    // Long functions (>60 lines between function signature and closing brace)
    let funcStart = null, braceDepth = 0;
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/\bfunction\b|\=\>|async\s+\(/.test(l) && braceDepth === 0) { funcStart = i; }
        braceDepth += (l.match(/{/g) || []).length - (l.match(/}/g) || []).length;
        if (funcStart !== null && braceDepth <= 0 && i > funcStart) {
            const len = i - funcStart;
            if (len > 60) findings.push(_finding("smell", "medium", "long_function", `Function is ${len} lines — consider extracting sub-functions`, funcStart + 1, null, "Break into smaller, single-purpose functions"));
            funcStart = null; braceDepth = 0;
        }
    }

    // Deep nesting (>4 levels of indentation)
    for (let i = 0; i < lines.length; i++) {
        const indent = (lines[i].match(/^(\s+)/) || ["",""])[1].length;
        if (indent >= 16) findings.push(_finding("smell", "medium", "deep_nesting", `Nesting depth ${Math.floor(indent/4)} at line ${i+1} — too deep`, i + 1, null, "Extract nested blocks into named functions"));
    }

    // Magic numbers (numeric literals not in common safe positions)
    const magicRe = /(?<![.\w])(?!0\.)\b([2-9]\d{2,}|[1-9]\d{3,})\b(?!\s*[:,])/g;
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(magicRe);
        if (m && !lines[i].trim().startsWith("//") && !lines[i].trim().startsWith("*")) {
            findings.push(_finding("smell", "low", "magic_number", `Magic number(s) ${m.join(", ")} — extract as named constants`, i + 1, null, `const MAX_RETRIES = ${m[0]}`));
        }
    }

    // Duplicate string literals (same non-trivial string ≥3 times)
    const strLiterals = {};
    const strRe = /["']([a-z][a-z0-9_/.-]{4,})["']/gi;
    let m2;
    while ((m2 = strRe.exec(code)) !== null) { strLiterals[m2[1]] = (strLiterals[m2[1]] || 0) + 1; }
    for (const [s, count] of Object.entries(strLiterals)) {
        if (count >= 3) findings.push(_finding("smell", "low", "duplicate_literal", `String literal "${s}" repeated ${count} times — extract as constant`, null, null, `const ${s.toUpperCase().replace(/[^A-Z0-9]/g,"_")} = "${s}"`));
    }

    // Overly complex conditions (>3 &&/|| in a single line)
    for (let i = 0; i < lines.length; i++) {
        const ops = (lines[i].match(/&&|\|\|/g) || []).length;
        if (ops > 3) findings.push(_finding("smell", "medium", "complex_condition", `Complex condition with ${ops} logical operators at line ${i+1}`, i + 1, null, "Extract condition into a named boolean variable"));
    }

    return findings;
}

// ── Security detectors ────────────────────────────────────────────────────
function detectSecurity(code) {
    const findings = [];
    const lines = code.split("\n");

    const PATTERNS = [
        { re: /eval\s*\(/,                         sev: "critical", rule: "eval_usage",        msg: "eval() is dangerous — allows arbitrary code execution",   sug: "Use JSON.parse() or a safe alternative" },
        { re: /Function\s*\(\s*["'`]/,             sev: "critical", rule: "function_ctor",     msg: "new Function() with string argument — eval equivalent",   sug: "Avoid dynamic code construction" },
        { re: /child_process|exec\(|execSync\(/,   sev: "high",     rule: "shell_exec",        msg: "Shell execution detected — validate all inputs",          sug: "Use allowlists and parameterised commands" },
        { re: /\.innerHTML\s*=/,                   sev: "high",     rule: "xss_innerhtml",     msg: "innerHTML assignment — XSS risk",                         sug: "Use textContent or DOMPurify" },
        { re: /\$\{.*req\.|template.*req\./,       sev: "high",     rule: "template_injection", msg: "User input in template literal — injection risk",        sug: "Sanitise request data before interpolation" },
        { re: /sql.*\+.*req\.|query.*\+.*req\./i,  sev: "critical", rule: "sql_injection",     msg: "String concatenation in SQL — SQL injection risk",        sug: "Use parameterised queries / ORM" },
        { re: /md5\(|sha1\(|createHash\(["']md5|createHash\(["']sha1/, sev: "medium", rule: "weak_crypto", msg: "Weak hash algorithm (MD5/SHA1)", sug: "Use SHA-256 or bcrypt/scrypt for passwords" },
        { re: /Math\.random\(\)/,                  sev: "low",      rule: "weak_random",       msg: "Math.random() is not cryptographically secure",           sug: "Use crypto.randomBytes() for security-sensitive contexts" },
        { re: /(?<!\w)(password|secret|token|api_key)\s*=\s*["'][^"']{6,}["']/i, sev: "critical", rule: "hardcoded_secret", msg: "Possible hardcoded credential", sug: "Use environment variables" },
        { re: /http:\/\/(?!localhost|127\.0\.0\.1)/, sev: "medium",  rule: "cleartext_http",   msg: "HTTP (not HTTPS) to external service",                   sug: "Use HTTPS for all external calls" },
        { re: /\.find\(.*\.password\b/,            sev: "medium",   rule: "password_in_query", msg: "Querying by password field directly",                    sug: "Hash passwords before comparison" },
        { re: /cors\(\)\s*$|origin:\s*['"]?\*/,   sev: "medium",   rule: "cors_wildcard",     msg: "CORS wildcard — allows any origin",                      sug: "Use explicit origin allowlist" },
    ];

    for (let i = 0; i < lines.length; i++) {
        for (const p of PATTERNS) {
            if (p.re.test(lines[i]) && !lines[i].trim().startsWith("//") && !lines[i].trim().startsWith("*")) {
                findings.push(_finding("security", p.sev, p.rule, p.msg, i + 1, null, p.sug));
            }
        }
    }
    return findings;
}

// ── Performance detectors ─────────────────────────────────────────────────
function detectPerformance(code) {
    const findings = [];
    const lines = code.split("\n");

    const PATTERNS = [
        { re: /readFileSync|writeFileSync|existsSync/,   sev: "medium", rule: "sync_io",          msg: "Synchronous file I/O — blocks event loop",              sug: "Use async fs.promises equivalents" },
        { re: /for\s*\(.*\.length.*\).*\.find\(|\.filter\(|\.map\(/, sev: "low", rule: "nested_loop_fn", msg: "Array method inside loop — possible O(n²)",  sug: "Precompute or use a Map/Set" },
        { re: /await.*\bfor\b.*of|for.*await/,           sev: "medium", rule: "sequential_await",  msg: "Sequential awaits in loop — consider Promise.all()",    sug: "Use Promise.all() for independent async operations" },
        { re: /JSON\.parse\(JSON\.stringify\(/,          sev: "low",    rule: "json_deepclone",    msg: "JSON.parse(JSON.stringify()) for deep clone",           sug: "Use structuredClone() or a purpose-built clone library" },
        { re: /new RegExp\(.*\)\s*(?!;)/,                sev: "low",    rule: "regex_in_loop",     msg: "RegExp constructor in potentially hot path",            sug: "Compile regex once outside loop/function" },
        { re: /\.toString\(\)\s*\+\s*['"]|['"]\s*\+.*\.toString/, sev: "info", rule: "string_concat", msg: "String concatenation — consider template literals",  sug: "Use template literals for readability and speed" },
    ];

    for (let i = 0; i < lines.length; i++) {
        for (const p of PATTERNS) {
            if (p.re.test(lines[i]) && !lines[i].trim().startsWith("//")) {
                findings.push(_finding("performance", p.sev, p.rule, p.msg, i + 1, null, p.sug));
            }
        }
    }
    return findings;
}

// ── Score calculation ─────────────────────────────────────────────────────
function _scoreFindings(findings) {
    const deductions = { critical: 20, high: 10, medium: 5, low: 2, info: 0 };
    const raw = findings.reduce((score, f) => score - (deductions[f.severity] || 0), 100);
    return Math.max(0, raw);
}

function _grade(score) {
    if (score >= 90) return "A";
    if (score >= 75) return "B";
    if (score >= 60) return "C";
    if (score >= 45) return "D";
    return "F";
}

// ── AI-assisted summary (optional, via OpenRouter) ────────────────────────
async function _aiSummary(code, findings, opts = {}) {
    try {
        const tel = require("./toolExecutionLayer.cjs");
        const topFindings = findings.filter(f => ["critical","high","medium"].includes(f.severity)).slice(0, 5).map(f => `[${f.severity}] ${f.message}`).join("\n");
        const prompt = `Code review summary for ${opts.language || "JavaScript"} code (${code.split("\n").length} lines).\n\nAutomated findings:\n${topFindings || "None"}\n\nProvide a 3-sentence summary: what the code does, key risks, and top recommendation.`;
        const r = await tel.execute("openrouter", "chat_completion", { prompt, max_tokens: 300 }, { agentId: "CodeReviewEngine" });
        return r.success ? r.output : null;
    } catch { return null; }
}

// ── Core review ───────────────────────────────────────────────────────────
async function _runReview(code, opts = {}) {
    const start = Date.now();
    const smells   = detectSmells(code, opts.language);
    const security = detectSecurity(code);
    const perf     = detectPerformance(code);
    const allFindings = [...smells, ...security, ...perf];
    const score    = _scoreFindings(allFindings);

    let aiSummary = null;
    if (opts.aiReview !== false && allFindings.length > 0) {
        aiSummary = await _aiSummary(code.slice(0, 3000), allFindings, opts);
    }

    return {
        reviewId:   _rid(),
        ts:         new Date().toISOString(),
        language:   opts.language || "js",
        source:     opts.source   || "inline",
        linesOfCode: code.split("\n").filter(l => l.trim()).length,
        score,
        grade:      _grade(score),
        findings:   allFindings,
        summary: {
            smells:   smells.length,
            security: security.length,
            perf:     perf.length,
            total:    allFindings.length,
            critical: allFindings.filter(f => f.severity === "critical").length,
            high:     allFindings.filter(f => f.severity === "high").length,
            medium:   allFindings.filter(f => f.severity === "medium").length,
        },
        aiSummary,
        durationMs: Date.now() - start,
    };
}

async function reviewCode(code, opts = {}) {
    const result = await _runReview(code, { ...opts, source: "inline" });
    _reviews.push(result); _save();
    execLog.append({ agentId: "CodeReviewEngine", taskType: "review_code", taskId: result.reviewId, success: true, durationMs: result.durationMs });
    return result;
}

async function reviewFile(filePath, opts = {}) {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
    const code = fs.readFileSync(filePath, "utf8");
    const ext  = path.extname(filePath).slice(1);
    const result = await _runReview(code, { ...opts, language: ext || "js", source: filePath });
    _reviews.push(result); _save();
    execLog.append({ agentId: "CodeReviewEngine", taskType: "review_file", taskId: result.reviewId, success: true, durationMs: result.durationMs });
    return result;
}

async function reviewDiff(diff, opts = {}) {
    // Extract added lines from unified diff (lines starting with +, not +++)
    const added = diff.split("\n").filter(l => l.startsWith("+") && !l.startsWith("+++")).map(l => l.slice(1)).join("\n");
    const result = await _runReview(added || diff, { ...opts, source: "diff" });
    _reviews.push(result); _save();
    execLog.append({ agentId: "CodeReviewEngine", taskType: "review_diff", taskId: result.reviewId, success: true, durationMs: result.durationMs });
    return result;
}

function getReview(reviewId)   { return _reviews.find(r => r.reviewId === reviewId) || null; }

function listReviews({ language, grade, limit = 50, offset = 0 } = {}) {
    let rows = [..._reviews].reverse();
    if (language) rows = rows.filter(r => r.language === language);
    if (grade)    rows = rows.filter(r => r.grade    === grade);
    const stats = {
        total: _reviews.length,
        avgScore: _reviews.length ? Math.round(_reviews.reduce((s, r) => s + r.score, 0) / _reviews.length) : 0,
        criticalFindings: _reviews.flatMap(r => r.findings).filter(f => f.severity === "critical").length,
    };
    return { reviews: rows.slice(offset, offset + limit), total: rows.length, stats };
}

function getSummary(reviewId) {
    const r = getReview(reviewId);
    if (!r) throw new Error(`Review ${reviewId} not found`);
    return { reviewId, score: r.score, grade: r.grade, summary: r.summary, aiSummary: r.aiSummary, topFindings: r.findings.filter(f => ["critical","high"].includes(f.severity)).slice(0, 5) };
}

function getStats() {
    const all = _reviews.flatMap(r => r.findings);
    return { totalReviews: _reviews.length, avgScore: _reviews.length ? Math.round(_reviews.reduce((s, r) => s + r.score, 0) / _reviews.length) : 0, totalFindings: all.length, bySeverity: all.reduce((a, f) => { a[f.severity] = (a[f.severity] || 0) + 1; return a; }, {}), byCategory: all.reduce((a, f) => { a[f.category] = (a[f.category] || 0) + 1; return a; }, {}) };
}

module.exports = { reviewCode, reviewFile, reviewDiff, getReview, listReviews, getSummary, getStats, detectSmells, detectSecurity, detectPerformance };
