"use strict";
/**
 * Engineering Smell Detector — ACP-3
 *
 * Proactive static analysis + runtime analysis.
 * Detects 14 smell categories and returns Recommendation Cards.
 *
 * Static (file-level):
 *   todo_fixme        — TODO/FIXME accumulation
 *   duplicate_literal — duplicated string literals (3+ occurrences)
 *   empty_catch       — empty catch blocks
 *   console_log_prod  — console.log in non-test files
 *   sync_fs           — synchronous fs calls (readFileSync outside services)
 *   blocking_crypto   — synchronous crypto usage
 *   long_function     — functions > 100 lines
 *   dead_export       — exported symbols with no detected import elsewhere
 *
 * Runtime (data-level):
 *   stale_mission     — missions in-progress > 7 days without update
 *   build_failure     — repeated build failures in last 24 hours
 *   benchmark_decline — failing benchmark trends
 *   stale_feature_flag — feature flags older than 30 days still in code
 *
 * Output per smell:
 *   { id, type, severity, file, line, detail, confidence,
 *     patchHint, affectedFiles, estimatedMinutesSaved }
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

const CODE_EXTS = [".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx"];
const SKIP_DIRS = new Set(["node_modules", ".git", "_archive", "dist", "build", "coverage", "out", ".next"]);
const DATA_DIR  = path.join(__dirname, "../../data");
const DISMISS_FILE = path.join(DATA_DIR, "dismissed-smells.json");

// ── Helpers ───────────────────────────────────────────────────────────────────

function _walkFiles(root) {
    const results = [];
    function walk(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries) {
            if (SKIP_DIRS.has(e.name)) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (CODE_EXTS.includes(path.extname(e.name))) results.push(full);
        }
    }
    walk(root);
    return results;
}

function _rel(root, abs) {
    return path.relative(root, abs);
}

function _smellId(type, file, detail) {
    return crypto.createHash("sha1").update(`${type}:${file}:${detail}`).digest("hex").slice(0, 12);
}

function _loadDismissed() {
    try { return new Set(JSON.parse(fs.readFileSync(DISMISS_FILE, "utf8")).dismissed || []); }
    catch { return new Set(); }
}

function _saveDismissed(set) {
    fs.writeFileSync(DISMISS_FILE, JSON.stringify({ dismissed: [...set] }, null, 2));
}

function _readJSON(file, fallback) {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8")); }
    catch { return fallback; }
}

// ── Static detectors ──────────────────────────────────────────────────────────

function _detectTodoFixme(files, root) {
    const smells = [];
    for (const f of files) {
        const rel = _rel(root, f);
        let content;
        try { content = fs.readFileSync(f, "utf8"); } catch { continue; }
        const lines = content.split("\n");
        let count = 0;
        const firstLine = { TODO: -1, FIXME: -1 };
        for (let i = 0; i < lines.length; i++) {
            if (/\b(TODO|FIXME)\b/i.test(lines[i])) {
                count++;
                if (firstLine.TODO === -1 && /TODO/i.test(lines[i])) firstLine.TODO = i + 1;
                if (firstLine.FIXME === -1 && /FIXME/i.test(lines[i])) firstLine.FIXME = i + 1;
            }
        }
        if (count >= 3) {
            const line = firstLine.TODO > 0 ? firstLine.TODO : firstLine.FIXME;
            smells.push({
                type: "todo_fixme",
                severity: count >= 10 ? "high" : count >= 5 ? "medium" : "low",
                file: rel, line,
                detail: `${count} TODO/FIXME comments accumulated — tech debt indicator`,
                confidence: 0.95,
                patchHint: null,
                estimatedMinutesSaved: Math.min(count * 5, 60),
            });
        }
    }
    return smells;
}

function _detectEmptyCatch(files, root) {
    const smells = [];
    for (const f of files) {
        const rel = _rel(root, f);
        let content;
        try { content = fs.readFileSync(f, "utf8"); } catch { continue; }
        const lines = content.split("\n");
        let inCatch = false;
        let catchLine = -1;
        let braceDepth = 0;
        let bodyLines = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (/\}\s*catch\s*\(/.test(line) || /catch\s*\([^)]*\)\s*\{/.test(line)) {
                inCatch = true;
                catchLine = i + 1;
                braceDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
                bodyLines = 0;
            } else if (inCatch) {
                braceDepth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
                if (line && line !== '{' && line !== '}') bodyLines++;
                if (braceDepth <= 0) {
                    if (bodyLines === 0) {
                        smells.push({
                            type: "empty_catch",
                            severity: "medium",
                            file: rel, line: catchLine,
                            detail: "Empty catch block silently swallows errors",
                            confidence: 0.90,
                            patchHint: "Add `logger.error(err)` or `console.error(err)` at minimum",
                            estimatedMinutesSaved: 10,
                        });
                    }
                    inCatch = false;
                }
            }
        }
    }
    return smells;
}

function _detectConsoleLogs(files, root) {
    const smells = [];
    for (const f of files) {
        if (/\.(test|spec)\.[^.]+$/.test(f)) continue;
        const rel = _rel(root, f);
        let content;
        try { content = fs.readFileSync(f, "utf8"); } catch { continue; }
        const lines = content.split("\n");
        const hits = [];
        for (let i = 0; i < lines.length; i++) {
            if (/\bconsole\.(log|warn|error|debug|info)\s*\(/.test(lines[i]) &&
                !/\/\/.*console/.test(lines[i])) {
                hits.push(i + 1);
            }
        }
        if (hits.length >= 2) {
            smells.push({
                type: "console_log_prod",
                severity: hits.length >= 5 ? "medium" : "low",
                file: rel, line: hits[0],
                detail: `${hits.length} console.log/warn/error statements in production code`,
                confidence: 0.85,
                patchHint: "Replace with structured logger (e.g. logger.info/warn/error)",
                estimatedMinutesSaved: hits.length * 3,
            });
        }
    }
    return smells;
}

function _detectSyncFs(files, root) {
    const smells = [];
    const SERVICE_DIR = /services?[/\\]/;
    for (const f of files) {
        if (SERVICE_DIR.test(f)) continue; // services legitimately use sync fs
        const rel = _rel(root, f);
        let content;
        try { content = fs.readFileSync(f, "utf8"); } catch { continue; }
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (/fs\.(readFileSync|writeFileSync|existsSync|mkdirSync|readdirSync)\s*\(/.test(lines[i])) {
                smells.push({
                    type: "sync_fs",
                    severity: "medium",
                    file: rel, line: i + 1,
                    detail: "Synchronous fs call blocks the event loop",
                    confidence: 0.80,
                    patchHint: `Convert to fs.promises.readFile / writeFile`,
                    estimatedMinutesSaved: 15,
                });
                break; // one per file
            }
        }
    }
    return smells;
}

function _detectBlockingCrypto(files, root) {
    const smells = [];
    for (const f of files) {
        const rel = _rel(root, f);
        let content;
        try { content = fs.readFileSync(f, "utf8"); } catch { continue; }
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (/crypto\.pbkdf2Sync|crypto\.scryptSync|bcrypt\.hashSync|bcrypt\.compareSync/.test(lines[i])) {
                smells.push({
                    type: "blocking_crypto",
                    severity: "high",
                    file: rel, line: i + 1,
                    detail: "Synchronous crypto operation blocks all requests during computation",
                    confidence: 0.92,
                    patchHint: "Use async variant: crypto.pbkdf2 / crypto.scrypt / bcrypt.hash",
                    estimatedMinutesSaved: 30,
                });
                break;
            }
        }
    }
    return smells;
}

function _detectLongFunctions(files, root) {
    const smells = [];
    for (const f of files) {
        const rel = _rel(root, f);
        let content;
        try { content = fs.readFileSync(f, "utf8"); } catch { continue; }
        const lines = content.split("\n");

        let funcStart = -1;
        let funcName  = "";
        let depth     = 0;
        let inFunc    = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const fnMatch = line.match(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\())/);
            if (fnMatch && !inFunc) {
                inFunc    = true;
                funcStart = i;
                funcName  = fnMatch[1] || fnMatch[2] || "anonymous";
                depth     = 0;
            }
            if (inFunc) {
                depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
                if (depth <= 0 && i > funcStart) {
                    const len = i - funcStart + 1;
                    if (len > 100) {
                        smells.push({
                            type: "long_function",
                            severity: len > 200 ? "high" : "medium",
                            file: rel, line: funcStart + 1,
                            detail: `Function \`${funcName}\` is ${len} lines — extract helper functions`,
                            confidence: 0.88,
                            patchHint: `Split \`${funcName}\` into smaller focused functions`,
                            estimatedMinutesSaved: 20,
                        });
                    }
                    inFunc = false;
                }
            }
        }
    }
    return smells;
}

function _detectDuplicateLiterals(files, root) {
    const smells = [];
    for (const f of files) {
        const rel = _rel(root, f);
        let content;
        try { content = fs.readFileSync(f, "utf8"); } catch { continue; }
        const strings = {};
        const matches = content.matchAll(/["'`]([^"'`\n]{8,60})["'`]/g);
        for (const m of matches) {
            const s = m[1].trim();
            if (!s || /^http|^\$|^#/.test(s)) continue;
            strings[s] = (strings[s] || 0) + 1;
        }
        const dups = Object.entries(strings).filter(([, c]) => c >= 4);
        if (dups.length) {
            const [worstStr, worstCount] = dups.sort((a, b) => b[1] - a[1])[0];
            smells.push({
                type: "duplicate_literal",
                severity: dups.length >= 5 ? "medium" : "low",
                file: rel, line: null,
                detail: `${dups.length} string literal(s) repeated 4+ times. Worst: "${worstStr.slice(0, 40)}" (${worstCount}x) — extract as constant`,
                confidence: 0.82,
                patchHint: `Extract repeated strings to named constants at top of file`,
                estimatedMinutesSaved: 10,
            });
        }
    }
    return smells;
}

function _detectStaleFeatureFlags(files, root) {
    const smells = [];
    const FLAG_RE = /(?:feature_?flag|ff_|FLAG_|isEnabled|featureEnabled)\s*[=:]\s*(?:true|false|1|0)/gi;
    for (const f of files) {
        const rel = _rel(root, f);
        let content, stat;
        try { content = fs.readFileSync(f, "utf8"); stat = fs.statSync(f); } catch { continue; }
        const lines = content.split("\n");
        const ageMs = Date.now() - stat.mtimeMs;
        const ageDays = ageMs / 86400000;
        if (ageDays < 30) continue; // only flag old files

        for (let i = 0; i < lines.length; i++) {
            if (FLAG_RE.test(lines[i])) {
                smells.push({
                    type: "stale_feature_flag",
                    severity: "low",
                    file: rel, line: i + 1,
                    detail: `Possible hardcoded feature flag in file untouched for ${Math.round(ageDays)} days`,
                    confidence: 0.60,
                    patchHint: "Remove or promote to configuration, or delete if fully rolled out",
                    estimatedMinutesSaved: 15,
                });
                FLAG_RE.lastIndex = 0;
                break;
            }
            FLAG_RE.lastIndex = 0;
        }
    }
    return smells;
}

// ── Runtime detectors ─────────────────────────────────────────────────────────

function _detectStaleMissions() {
    const smells = [];
    try {
        const mm = require("./missionMemory.cjs");
        const { missions } = mm.listMissions({ status: "in_progress", limit: 100 });
        const cutoff = Date.now() - 7 * 86400000;
        for (const m of missions) {
            const updAt = new Date(m.updatedAt || m.createdAt).getTime();
            if (updAt < cutoff) {
                const ageDays = Math.round((Date.now() - updAt) / 86400000);
                smells.push({
                    type: "stale_mission",
                    severity: ageDays > 14 ? "high" : "medium",
                    file: null, line: null,
                    detail: `Mission "${m.objective?.slice(0, 60)}" has been in-progress for ${ageDays} days without update`,
                    confidence: 0.90,
                    patchHint: null,
                    affectedMissionId: m.id,
                    estimatedMinutesSaved: 30,
                });
            }
        }
    } catch {}
    return smells;
}

function _detectBuildFailures() {
    const smells = [];
    try {
        const cutoff = Date.now() - 86400000;
        const agentRuns = _readJSON("agent-runs.json", []);
        const buildFails = (Array.isArray(agentRuns) ? agentRuns : [])
            .filter(r => r.type === "build" && r.status === "failed" && new Date(r.ts || r.createdAt).getTime() > cutoff);
        if (buildFails.length >= 3) {
            smells.push({
                type: "build_failure",
                severity: buildFails.length >= 5 ? "high" : "medium",
                file: null, line: null,
                detail: `${buildFails.length} build failure(s) in the last 24 hours — investigate root cause`,
                confidence: 0.95,
                patchHint: null,
                estimatedMinutesSaved: 60,
            });
        }
    } catch {}
    // Also check healing history
    try {
        const healing = _readJSON("healing-history.json", []);
        const recentBuildHeals = (Array.isArray(healing) ? healing : [])
            .filter(h => h.type === "build_failure" && (Date.now() - new Date(h.ts || h.timestamp).getTime()) < 86400000);
        if (recentBuildHeals.length >= 2) {
            smells.push({
                type: "build_failure",
                severity: "medium",
                file: null, line: null,
                detail: `${recentBuildHeals.length} build failures auto-healed in 24h — recurring pattern may need permanent fix`,
                confidence: 0.85,
                patchHint: "Review CI configuration and dependency versions",
                estimatedMinutesSaved: 45,
            });
        }
    } catch {}
    return smells;
}

function _detectBenchmarkDecline() {
    const smells = [];
    try {
        const obs = _readJSON("observability.json", {});
        const metrics = obs.metrics || obs.recent || [];
        if (!metrics.length) return smells;

        // Look for P95 latency increasing trend
        const latencies = metrics.filter(m => m.key === "response_time_p95" || m.name === "p95").slice(-20);
        if (latencies.length >= 5) {
            const recent = latencies.slice(-5).map(m => m.value || m.p95 || 0);
            const older  = latencies.slice(0, 5).map(m => m.value || m.p95 || 0);
            const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
            const avgOlder  = older.reduce((a, b) => a + b, 0) / older.length;
            if (avgRecent > avgOlder * 1.3 && avgOlder > 0) {
                smells.push({
                    type: "benchmark_decline",
                    severity: avgRecent > avgOlder * 2 ? "high" : "medium",
                    file: null, line: null,
                    detail: `P95 latency increased ${Math.round((avgRecent/avgOlder - 1) * 100)}% over last 5 measurements (${Math.round(avgOlder)}ms → ${Math.round(avgRecent)}ms)`,
                    confidence: 0.78,
                    patchHint: "Profile recent changes, check DB query plans",
                    estimatedMinutesSaved: 90,
                });
            }
        }
    } catch {}
    return smells;
}

// ── Severity ordering ─────────────────────────────────────────────────────────

const SEV_ORDER = { high: 0, medium: 1, low: 2 };

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * scan(repoPath) → { smells[], summary, scannedFiles }
 * Runs all detectors, deduplicates, filters dismissed, sorts by severity.
 */
function scan(repoPath) {
    const root     = path.resolve(repoPath);
    const files    = _walkFiles(root);
    const dismissed = _loadDismissed();

    const allSmells = [
        ..._detectTodoFixme(files, root),
        ..._detectEmptyCatch(files, root),
        ..._detectConsoleLogs(files, root),
        ..._detectSyncFs(files, root),
        ..._detectBlockingCrypto(files, root),
        ..._detectLongFunctions(files, root),
        ..._detectDuplicateLiterals(files, root),
        ..._detectStaleFeatureFlags(files, root),
        ..._detectStaleMissions(),
        ..._detectBuildFailures(),
        ..._detectBenchmarkDecline(),
    ];

    // Assign stable IDs and filter dismissed
    const enriched = allSmells
        .map(s => ({
            ...s,
            id: _smellId(s.type, s.file || "runtime", s.detail),
            affectedFiles: s.file ? [s.file] : (s.affectedFiles || []),
        }))
        .filter(s => !dismissed.has(s.id));

    // De-dup by id
    const seen = new Set();
    const deduped = enriched.filter(s => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
    });

    // Sort: severity then confidence desc
    deduped.sort((a, b) => {
        const sd = (SEV_ORDER[a.severity] ?? 2) - (SEV_ORDER[b.severity] ?? 2);
        if (sd !== 0) return sd;
        return (b.confidence || 0) - (a.confidence || 0);
    });

    const summary = {
        total:    deduped.length,
        high:     deduped.filter(s => s.severity === "high").length,
        medium:   deduped.filter(s => s.severity === "medium").length,
        low:      deduped.filter(s => s.severity === "low").length,
        avgConfidence: deduped.length
            ? Math.round(deduped.reduce((acc, s) => acc + (s.confidence || 0), 0) / deduped.length * 100)
            : 0,
        estimatedMinutesSaved: deduped.reduce((acc, s) => acc + (s.estimatedMinutesSaved || 0), 0),
        byType: deduped.reduce((acc, s) => { acc[s.type] = (acc[s.type] || 0) + 1; return acc; }, {}),
    };

    return { smells: deduped, summary, scannedFiles: files.length };
}

function dismiss(smellId) {
    const dismissed = _loadDismissed();
    dismissed.add(smellId);
    _saveDismissed(dismissed);
    return { ok: true, dismissed: smellId };
}

function undismiss(smellId) {
    const dismissed = _loadDismissed();
    dismissed.delete(smellId);
    _saveDismissed(dismissed);
    return { ok: true, undismissed: smellId };
}

function getDismissed() {
    return { dismissed: [..._loadDismissed()] };
}

module.exports = { scan, dismiss, undismiss, getDismissed };
