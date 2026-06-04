"use strict";
/**
 * GitHubEngineeringAgent — real GitHub API integration for autonomous
 * engineering tasks: repo reads, issue analysis, PR creation, PR review,
 * changelog generation.
 *
 * All GitHub calls go through _gh() which handles auth, user-agent,
 * and response normalisation. GITHUB_TOKEN env var required for writes;
 * public repo reads work without a token.
 *
 * Persists all activity to data/github-engineering-activity.json.
 *
 * Public API:
 *   readRepo(owner, repo)                   → RepoInfo
 *   listIssues(owner, repo, opts)           → Issue[]
 *   analyzeIssues(owner, repo, opts)        → IssueAnalysis
 *   createIssue(owner, repo, spec)          → Issue
 *   createPR(owner, repo, spec)             → PR
 *   reviewPR(owner, repo, prNumber, opts)   → PRReview
 *   generateChangelog(owner, repo, opts)    → ChangelogResult
 *   getActivity(opts)                       → ActivityRecord[]
 *   getStats()                              → stats
 */

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const logger = require("../utils/logger");
const execLog = require("../utils/execLog.cjs");

const ACTIVITY_FILE = path.join(__dirname, "../../data/github-engineering-activity.json");

function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function _wj(f, d) {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = f + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(d, null, 2)); fs.renameSync(tmp, f);
}

let _activity = _rj(ACTIVITY_FILE, []);
let _seq = _activity.length;
function _actId() { return `ghea_${Date.now()}_${(++_seq).toString(36)}`; }
function _save() { try { _wj(ACTIVITY_FILE, _activity.slice(-2000)); } catch { /* non-fatal */ } }

function _record(type, data) {
    const rec = { actId: _actId(), type, ts: new Date().toISOString(), ...data };
    _activity.push(rec);
    _save();
    execLog.append({ agentId: "GitHubEngineeringAgent", taskType: type, taskId: rec.actId, success: !data.error, durationMs: data.durationMs || 0 });
    return rec;
}

// ── GitHub HTTP client ────────────────────────────────────────────────────
const GH_BASE = "https://api.github.com";

function _ghHeaders() {
    const h = { "User-Agent": "jarvis-os/1.0", Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    const token = process.env.GITHUB_TOKEN;
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
}

function _httpJson(method, url, body) {
    return new Promise((resolve, reject) => {
        const u   = new URL(url);
        const data = body ? JSON.stringify(body) : null;
        const req = https.request({
            hostname: u.hostname, port: 443, path: u.pathname + u.search, method,
            headers: { ..._ghHeaders(), "Content-Type": "application/json", ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) },
        }, res => {
            let raw = "";
            res.on("data", d => raw += d);
            res.on("end", () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(raw), headers: res.headers }); }
                catch { resolve({ status: res.statusCode, body: raw, headers: res.headers }); }
            });
        });
        req.on("error", reject);
        req.setTimeout(15000, () => req.destroy(new Error("GitHub API timeout")));
        if (data) req.write(data);
        req.end();
    });
}

async function _gh(method, path_, body) {
    const url = path_.startsWith("http") ? path_ : `${GH_BASE}${path_}`;
    const r   = await _httpJson(method, url, body);
    if (r.status === 401) throw new Error("GitHub auth failed — check GITHUB_TOKEN");
    if (r.status === 403) throw new Error("GitHub permission denied — token may lack required scope");
    if (r.status === 404) throw new Error(`GitHub resource not found: ${path_}`);
    if (r.status >= 500)  throw new Error(`GitHub server error: ${r.status}`);
    return r;
}

// ── Read repository ───────────────────────────────────────────────────────
async function readRepo(owner, repo) {
    const start = Date.now();
    try {
        const [repoR, branchR, langR, contribR] = await Promise.allSettled([
            _gh("GET", `/repos/${owner}/${repo}`),
            _gh("GET", `/repos/${owner}/${repo}/branches?per_page=10`),
            _gh("GET", `/repos/${owner}/${repo}/languages`),
            _gh("GET", `/repos/${owner}/${repo}/contributors?per_page=5`),
        ]);

        const repoData = repoR.status === "fulfilled" ? repoR.value.body : null;
        if (!repoData || repoData.message) throw new Error(repoData?.message || "Could not read repo");

        const result = {
            name:          repoData.full_name,
            description:   repoData.description,
            defaultBranch: repoData.default_branch,
            stars:         repoData.stargazers_count,
            forks:         repoData.forks_count,
            openIssues:    repoData.open_issues_count,
            language:      repoData.language,
            topics:        repoData.topics || [],
            private:       repoData.private,
            updatedAt:     repoData.updated_at,
            branches:      branchR.status === "fulfilled" ? (branchR.value.body || []).map(b => b.name) : [],
            languages:     langR.status === "fulfilled"   ? Object.keys(langR.value.body || {}) : [],
            contributors:  contribR.status === "fulfilled" ? (contribR.value.body || []).slice(0, 5).map(c => c.login) : [],
        };

        _record("read_repo", { owner, repo, result, durationMs: Date.now() - start });
        return result;
    } catch (e) {
        _record("read_repo", { owner, repo, error: e.message, durationMs: Date.now() - start });
        throw e;
    }
}

// ── List + analyze issues ─────────────────────────────────────────────────
async function listIssues(owner, repo, { state = "open", labels, limit = 30 } = {}) {
    const start = Date.now();
    let url = `/repos/${owner}/${repo}/issues?state=${state}&per_page=${Math.min(limit, 100)}`;
    if (labels) url += `&labels=${encodeURIComponent(labels)}`;
    const r = await _gh("GET", url);
    const issues = (Array.isArray(r.body) ? r.body : []).filter(i => !i.pull_request); // exclude PRs
    _record("list_issues", { owner, repo, state, count: issues.length, durationMs: Date.now() - start });
    return issues.map(i => ({
        number:    i.number,
        title:     i.title,
        state:     i.state,
        labels:    (i.labels || []).map(l => l.name),
        assignees: (i.assignees || []).map(a => a.login),
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        body:      (i.body || "").slice(0, 500),
        url:       i.html_url,
    }));
}

async function analyzeIssues(owner, repo, opts = {}) {
    const start  = Date.now();
    const issues = await listIssues(owner, repo, { ...opts, limit: 50 });

    // Cluster by label
    const byLabel = {};
    for (const i of issues) {
        for (const l of i.labels.length ? i.labels : ["unlabeled"]) {
            byLabel[l] = (byLabel[l] || []).concat(i.number);
        }
    }

    // Age analysis
    const now = Date.now();
    const ages = issues.map(i => (now - new Date(i.createdAt).getTime()) / 86_400_000);
    const avgAge = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
    const stale  = issues.filter((_, idx) => ages[idx] > 30);

    // Priority clustering: "bug" > "enhancement" > unlabeled
    const bugs      = issues.filter(i => i.labels.some(l => /bug|error|fix|crash/i.test(l)));
    const features  = issues.filter(i => i.labels.some(l => /feat|enhancement|improvement/i.test(l)));
    const unlabeled = issues.filter(i => i.labels.length === 0);

    const analysis = {
        total: issues.length, avgAgeDays: avgAge, staleCount: stale.length,
        bugCount: bugs.length, featureCount: features.length, unlabeledCount: unlabeled.length,
        byLabel,
        topIssues:   issues.slice(0, 5).map(i => ({ number: i.number, title: i.title })),
        staleIssues: stale.slice(0, 5).map(i => ({ number: i.number, title: i.title, ageDays: Math.round((now - new Date(i.createdAt).getTime()) / 86_400_000) })),
        recommendation: bugs.length > 5 ? "High bug count — prioritise bug fixes before new features."
            : avgAge > 60 ? "Issues are aging — consider a triage sprint."
            : unlabeled.length > issues.length * 0.5 ? "Many unlabeled issues — label them for better routing."
            : "Issue health looks reasonable.",
    };

    _record("analyze_issues", { owner, repo, analysis, durationMs: Date.now() - start });
    return analysis;
}

// ── Create issue ──────────────────────────────────────────────────────────
async function createIssue(owner, repo, spec) {
    if (!spec.title) throw new Error("title required");
    const start = Date.now();
    const body  = { title: spec.title, body: spec.body || "", labels: spec.labels || [], assignees: spec.assignees || [] };
    const r     = await _gh("POST", `/repos/${owner}/${repo}/issues`, body);
    if (r.status !== 201) throw new Error(`Failed to create issue: ${JSON.stringify(r.body)}`);
    _record("create_issue", { owner, repo, number: r.body.number, title: spec.title, url: r.body.html_url, durationMs: Date.now() - start });
    return { number: r.body.number, url: r.body.html_url, title: r.body.title };
}

// ── Create PR ─────────────────────────────────────────────────────────────
async function createPR(owner, repo, spec) {
    if (!spec.title || !spec.head || !spec.base) throw new Error("title, head and base required");
    const start = Date.now();
    const body  = { title: spec.title, body: spec.body || "", head: spec.head, base: spec.base, draft: spec.draft || false };
    const r     = await _gh("POST", `/repos/${owner}/${repo}/pulls`, body);
    if (r.status !== 201) throw new Error(`Failed to create PR: ${JSON.stringify(r.body)}`);
    _record("create_pr", { owner, repo, number: r.body.number, title: spec.title, url: r.body.html_url, durationMs: Date.now() - start });
    return { number: r.body.number, url: r.body.html_url, title: r.body.title };
}

// ── Review PR ─────────────────────────────────────────────────────────────
async function reviewPR(owner, repo, prNumber, opts = {}) {
    const start = Date.now();
    // Fetch PR details + diff
    const [prR, filesR, commentsR] = await Promise.allSettled([
        _gh("GET", `/repos/${owner}/${repo}/pulls/${prNumber}`),
        _gh("GET", `/repos/${owner}/${repo}/pulls/${prNumber}/files`),
        _gh("GET", `/repos/${owner}/${repo}/pulls/${prNumber}/comments`),
    ]);

    const pr    = prR.status === "fulfilled" ? prR.value.body : null;
    if (!pr || pr.message) throw new Error(pr?.message || "PR not found");

    const files = filesR.status === "fulfilled" ? (filesR.value.body || []) : [];
    const comments = commentsR.status === "fulfilled" ? (commentsR.value.body || []).length : 0;

    // Static analysis on changed files
    const findings = [];
    for (const f of files.slice(0, 20)) {
        const patch = f.patch || "";
        // Security patterns
        if (/eval\(|exec\(|child_process|\.innerHTML\s*=/.test(patch)) findings.push({ file: f.filename, severity: "critical", type: "security", message: "Potential code injection or unsafe DOM manipulation detected" });
        if (/password|secret|token|api_key/i.test(patch) && /=\s*["'][^"']{6,}["']/.test(patch)) findings.push({ file: f.filename, severity: "high", type: "secret_leak", message: "Possible hardcoded credential detected" });
        // Code quality
        if (/console\.log\(/.test(patch) && !f.filename.includes("test") && !f.filename.includes("spec")) findings.push({ file: f.filename, severity: "low", type: "debug_code", message: "console.log left in non-test code" });
        if (/TODO|FIXME|HACK/i.test(patch)) findings.push({ file: f.filename, severity: "info", type: "todo", message: "TODO/FIXME comment added — track or resolve" });
        // Large functions (rough heuristic on line count)
        if ((f.additions || 0) > 200) findings.push({ file: f.filename, severity: "medium", type: "large_diff", message: `Large diff (+${f.additions} lines) — consider splitting` });
    }

    // If OpenRouter available, get AI summary
    let aiSummary = null;
    try {
        const tel = require("./toolExecutionLayer.cjs");
        const prompt = `Summarize this GitHub PR for code review:\nTitle: ${pr.title}\nFiles changed: ${files.map(f => f.filename).join(", ")}\nAdditions: ${pr.additions}, Deletions: ${pr.deletions}\n\nProvide: 1) What this PR does, 2) Key risks, 3) Recommendation (APPROVE/REQUEST_CHANGES/COMMENT)`;
        const r = await tel.execute("openrouter", "chat_completion", { prompt, max_tokens: 400 }, { agentId: "GitHubEngineeringAgent" });
        if (r.success) aiSummary = r.output;
    } catch { /* optional */ }

    const review = {
        prNumber, title: pr.title, author: pr.user?.login,
        additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changed_files,
        existingComments: comments,
        findings,
        criticalCount: findings.filter(f => f.severity === "critical").length,
        highCount:     findings.filter(f => f.severity === "high").length,
        verdict:       findings.some(f => f.severity === "critical" || f.severity === "high") ? "REQUEST_CHANGES" : findings.length > 3 ? "COMMENT" : "APPROVE",
        aiSummary,
        reviewedAt: new Date().toISOString(),
    };

    // Post review comment if requested
    if (opts.postComment && process.env.GITHUB_TOKEN) {
        const body = `**Jarvis Engineering Review** — ${review.verdict}\n\n${findings.length ? findings.map(f => `- [${f.severity.toUpperCase()}] \`${f.file}\`: ${f.message}`).join("\n") : "No automated findings."}\n\n${aiSummary ? `\n**AI Summary:** ${aiSummary}` : ""}`;
        await _gh("POST", `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, { body, event: review.verdict === "APPROVE" ? "APPROVE" : review.verdict === "REQUEST_CHANGES" ? "REQUEST_CHANGES" : "COMMENT" });
    }

    _record("review_pr", { owner, repo, prNumber, verdict: review.verdict, findingsCount: findings.length, durationMs: Date.now() - start });
    return review;
}

// ── Changelog generation ──────────────────────────────────────────────────
async function generateChangelog(owner, repo, { since, base = "main", limit = 30 } = {}) {
    const start = Date.now();
    // Fetch recent merged PRs as changelog source
    const searchUrl = `/repos/${owner}/${repo}/pulls?state=closed&base=${base}&per_page=${limit}&sort=updated&direction=desc`;
    const r = await _gh("GET", searchUrl);
    const prs = (Array.isArray(r.body) ? r.body : []).filter(pr => pr.merged_at);
    const filtered = since ? prs.filter(pr => pr.merged_at >= since) : prs;

    // Categorise by PR title prefix
    const categories = { breaking: [], features: [], fixes: [], chores: [], other: [] };
    for (const pr of filtered) {
        const t = pr.title.toLowerCase();
        if (/^break|breaking/i.test(pr.title))     categories.breaking.push(pr);
        else if (/^feat|feature|add/i.test(pr.title))  categories.features.push(pr);
        else if (/^fix|bug|patch|hotfix/i.test(pr.title)) categories.fixes.push(pr);
        else if (/^chore|refactor|test|docs|ci/i.test(pr.title)) categories.chores.push(pr);
        else categories.other.push(pr);
    }

    const lines = [];
    const fmt = prs_ => prs_.map(p => `- ${p.title} (#${p.number}) @${p.user?.login || "unknown"}`).join("\n");
    if (categories.breaking.length) lines.push(`### Breaking Changes\n${fmt(categories.breaking)}`);
    if (categories.features.length) lines.push(`### Features\n${fmt(categories.features)}`);
    if (categories.fixes.length)    lines.push(`### Bug Fixes\n${fmt(categories.fixes)}`);
    if (categories.chores.length)   lines.push(`### Chores\n${fmt(categories.chores)}`);
    if (categories.other.length)    lines.push(`### Other\n${fmt(categories.other)}`);

    const changelog = {
        generatedAt: new Date().toISOString(),
        repo: `${owner}/${repo}`, base, since: since || null,
        prCount: filtered.length,
        markdown: lines.length ? `# Changelog\n\n${lines.join("\n\n")}` : "# Changelog\n\nNo merged PRs found.",
        categories: { breaking: categories.breaking.length, features: categories.features.length, fixes: categories.fixes.length, chores: categories.chores.length, other: categories.other.length },
    };

    _record("generate_changelog", { owner, repo, prCount: filtered.length, durationMs: Date.now() - start });
    return changelog;
}

// ── Query ─────────────────────────────────────────────────────────────────
function getActivity({ type, owner, repo, limit = 100, offset = 0 } = {}) {
    let rows = [..._activity].reverse();
    if (type)  rows = rows.filter(r => r.type  === type);
    if (owner) rows = rows.filter(r => r.owner === owner);
    if (repo)  rows = rows.filter(r => r.repo  === repo);
    return { activity: rows.slice(offset, offset + limit), total: rows.length };
}

function getStats() {
    const byType = _activity.reduce((a, r) => { a[r.type] = (a[r.type] || 0) + 1; return a; }, {});
    return { total: _activity.length, byType, errors: _activity.filter(r => r.error).length };
}

module.exports = { readRepo, listIssues, analyzeIssues, createIssue, createPR, reviewPR, generateChangelog, getActivity, getStats };
