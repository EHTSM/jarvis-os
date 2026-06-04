"use strict";
/**
 * ReleaseEngine — build validation, release checklist, version management,
 * release notes generation, and deployment readiness assessment.
 *
 * Integrates with:
 *   DeploymentValidator    — checks build artifacts and environment
 *   SecurityHardeningLayer — security gate
 *   GitHubEngineeringAgent — changelog source
 *   CodeReviewEngine       — quality gate
 *   MemoryPersistenceLayer — stores release records
 *
 * Version management: reads/writes data/version.json.
 * Bump strategies: major | minor | patch | prerelease
 *
 * Persists releases to data/releases.json.
 *
 * Public API:
 *   validateBuild(opts)                  → BuildValidation
 *   runChecklist(version, opts)          → ChecklistResult
 *   bumpVersion(strategy, opts)          → VersionRecord
 *   getCurrentVersion()                  → VersionRecord
 *   generateReleaseNotes(version, opts)  → ReleaseNotes
 *   checkDeploymentReadiness()           → ReadinessResult
 *   createRelease(spec)                  → ReleaseRecord
 *   getRelease(releaseId)                → ReleaseRecord | null
 *   listReleases(opts)                   → { releases[], stats }
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const execLog = require("../utils/execLog.cjs");

const ROOT         = path.join(__dirname, "../..");
const VERSION_FILE = path.join(__dirname, "../../data/version.json");
const RELEASE_FILE = path.join(__dirname, "../../data/releases.json");

function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function _wj(f, d) {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = f + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(d, null, 2)); fs.renameSync(tmp, f);
}

let _releases = _rj(RELEASE_FILE, []);
let _seq = _releases.length;
function _relId() { return `rel_${Date.now()}_${(++_seq).toString(36)}`; }
function _save() { try { _wj(RELEASE_FILE, _releases.slice(-200)); } catch { /* non-fatal */ } }

// ── Version management ─────────────────────────────────────────────────────
function getCurrentVersion() {
    const stored = _rj(VERSION_FILE, null);
    if (stored) return stored;
    // Fall back to package.json
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
        const v = { version: pkg.version || "1.0.0", createdAt: new Date().toISOString(), history: [] };
        _wj(VERSION_FILE, v);
        return v;
    } catch {
        return { version: "1.0.0", createdAt: new Date().toISOString(), history: [] };
    }
}

function bumpVersion(strategy = "patch", opts = {}) {
    const current = getCurrentVersion();
    const [major, minor, patch, ...rest] = current.version.replace(/[^0-9.]/g, "").split(".").map(Number);

    let next;
    switch (strategy) {
        case "major":      next = `${major + 1}.0.0`;   break;
        case "minor":      next = `${major}.${minor + 1}.0`; break;
        case "patch":      next = `${major}.${minor}.${(patch || 0) + 1}`; break;
        case "prerelease": next = `${major}.${minor}.${patch}-rc.${Date.now()}`; break;
        default: throw new Error(`Unknown bump strategy: ${strategy}`);
    }

    const record = {
        version: next, previous: current.version,
        strategy, bumpedAt: new Date().toISOString(),
        bumpedBy: opts.bumpedBy || "release-engine",
        notes: opts.notes || "",
        history: [...(current.history || []).slice(-19), { from: current.version, to: next, at: new Date().toISOString() }],
    };
    _wj(VERSION_FILE, record);
    logger.info(`[ReleaseEngine] Version bumped: ${current.version} → ${next} (${strategy})`);
    return record;
}

// ── Build validation ──────────────────────────────────────────────────────
function validateBuild(opts = {}) {
    const checks = [];

    // Frontend build
    const buildDir = path.join(ROOT, "frontend/build");
    const indexHtml = path.join(buildDir, "index.html");
    checks.push(fs.existsSync(indexHtml) ? { name: "frontend_build", status: "pass", detail: "frontend/build/index.html present" } : { name: "frontend_build", status: "fail", detail: "Frontend not built — run: cd frontend && npm run build" });

    // JS/CSS bundles
    const jsDir = path.join(buildDir, "static/js");
    const jsFiles = fs.existsSync(jsDir) ? fs.readdirSync(jsDir).filter(f => f.endsWith(".js") && !f.endsWith(".map")) : [];
    checks.push(jsFiles.length > 0 ? { name: "js_bundle",  status: "pass", detail: `${jsFiles.length} JS bundle(s)` }  : { name: "js_bundle",  status: "fail", detail: "No JS bundles" });

    const cssDir = path.join(buildDir, "static/css");
    const cssFiles = fs.existsSync(cssDir) ? fs.readdirSync(cssDir).filter(f => f.endsWith(".css") && !f.endsWith(".map")) : [];
    checks.push(cssFiles.length > 0 ? { name: "css_bundle", status: "pass", detail: `${cssFiles.length} CSS bundle(s)` } : { name: "css_bundle", status: "warn", detail: "No CSS bundles" });

    // package.json version matches version.json
    const ver = getCurrentVersion();
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
        checks.push(pkg.version === ver.version ? { name: "version_sync",   status: "pass", detail: `package.json version ${pkg.version} matches version.json` } : { name: "version_sync", status: "warn", detail: `package.json v${pkg.version} ≠ version.json v${ver.version}` });
    } catch { checks.push({ name: "version_sync", status: "warn", detail: "Could not read package.json" }); }

    // node_modules
    checks.push(fs.existsSync(path.join(ROOT, "node_modules")) ? { name: "dependencies", status: "pass", detail: "node_modules present" } : { name: "dependencies", status: "fail", detail: "node_modules missing — run npm install" });

    // Data directory
    try { fs.accessSync(path.join(ROOT, "data"), fs.constants.W_OK); checks.push({ name: "data_dir", status: "pass", detail: "data/ writable" }); }
    catch { checks.push({ name: "data_dir", status: "fail", detail: "data/ not writable" }); }

    const passed = checks.filter(c => c.status === "pass").length;
    const score  = Math.round(passed / checks.length * 100);
    execLog.append({ agentId: "ReleaseEngine", taskType: "validate_build", taskId: `bv_${Date.now()}`, success: score >= 80, durationMs: 0 });
    return { checks, score, passed, total: checks.length, valid: score >= 80 };
}

// ── Release checklist ──────────────────────────────────────────────────────
function runChecklist(version, opts = {}) {
    const checks = [];

    // Build validation
    const build = validateBuild();
    checks.push({ item: "Build artifacts valid",        done: build.valid,               detail: `Score: ${build.score}%` });

    // Security gate
    try {
        const shl   = require("./securityHardeningLayer.cjs");
        const secR  = shl.getLastReport();
        const secOk = secR && secR.score >= 60;
        checks.push({ item: "Security hardening ≥60",   done: secOk,  detail: secR ? `Score: ${secR.score}/100 (${secR.grade})` : "No security report — run POST /p22/security/check" });
    } catch { checks.push({ item: "Security hardening", done: false, detail: "SecurityHardeningLayer unavailable" }); }

    // Secret audit
    try {
        const sml  = require("./secretManagementLayer.cjs");
        const miss = sml.detectMissing();
        checks.push({ item: "No critical secrets missing", done: miss.critical.length === 0, detail: miss.critical.length ? `Missing: ${miss.critical.join(", ")}` : "All critical secrets present" });
    } catch { checks.push({ item: "Secret audit", done: false, detail: "SecretManagementLayer unavailable" }); }

    // Code quality (last review)
    try {
        const cre   = require("./codeReviewEngine.cjs");
        const stats = cre.getStats();
        const okQuality = stats.totalReviews === 0 || stats.avgScore >= 70;
        checks.push({ item: "Code review quality ≥70",  done: okQuality, detail: stats.totalReviews ? `Avg score: ${stats.avgScore}` : "No reviews recorded" });
    } catch { checks.push({ item: "Code review", done: false, detail: "CodeReviewEngine unavailable" }); }

    // Version set
    const ver = getCurrentVersion();
    checks.push({ item: "Version bumped for release",   done: version !== ver.previous, detail: `Current: ${ver.version}` });

    // changelog exists
    checks.push({ item: "Release notes prepared",       done: !!opts.hasNotes,          detail: opts.hasNotes ? "Provided" : "Pass hasNotes:true when generating" });

    // Deployment readiness
    try {
        const dv  = require("./deploymentValidator.cjs");
        const dvR = dv.getLastReport();
        const dvOk = dvR && dvR.score >= 60;
        checks.push({ item: "Deployment readiness ≥60",  done: dvOk, detail: dvR ? `Score: ${dvR.score}/100 (${dvR.grade})` : "No deployment report — run POST /p22/deploy/check" });
    } catch { checks.push({ item: "Deployment readiness", done: false, detail: "DeploymentValidator unavailable" }); }

    const passed  = checks.filter(c => c.done).length;
    const score   = Math.round(passed / checks.length * 100);
    const ready   = score >= 80;
    execLog.append({ agentId: "ReleaseEngine", taskType: "release_checklist", taskId: `cl_${Date.now()}`, success: ready, durationMs: 0 });
    return { version, checks, passed, total: checks.length, score, ready };
}

// ── Release notes ─────────────────────────────────────────────────────────
async function generateReleaseNotes(version, opts = {}) {
    const build = validateBuild();
    let changelogMd = "";

    // Pull from GitHub changelog if owner/repo provided
    if (opts.owner && opts.repo) {
        try {
            const gha = require("./gitHubEngineeringAgent.cjs");
            const cl  = await gha.generateChangelog(opts.owner, opts.repo, { since: opts.since, base: opts.base });
            changelogMd = cl.markdown;
        } catch (e) { changelogMd = `_(Could not fetch GitHub changelog: ${e.message})_`; }
    }

    const notes = {
        version,
        releasedAt: new Date().toISOString(),
        markdown: `# Release ${version}\n\n**Released:** ${new Date().toLocaleDateString()}\n\n## Build\n- Score: ${build.score}% (${build.passed}/${build.total} checks passing)\n\n## Changes\n${changelogMd || "_(No changelog provided)_"}\n\n## Notes\n${opts.notes || ""}`,
        buildScore: build.score,
        changelogProvided: !!changelogMd,
    };
    return notes;
}

// ── Deployment readiness ──────────────────────────────────────────────────
async function checkDeploymentReadiness() {
    const build  = validateBuild();
    let deploy   = null, security = null, secrets = null;

    try {
        const dv = require("./deploymentValidator.cjs");
        deploy   = dv.getLastReport() || await dv.runCheck();
    } catch { /* optional */ }

    try {
        const shl = require("./securityHardeningLayer.cjs");
        security  = shl.getLastReport() || shl.runCheck();
    } catch { /* optional */ }

    try {
        const sml = require("./secretManagementLayer.cjs");
        secrets   = sml.detectMissing();
    } catch { /* optional */ }

    const scores = [build.score, deploy?.score || 0, security?.score || 0, secrets ? (secrets.critical.length === 0 ? 100 : 0) : 50];
    const overall = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

    return {
        ready:    overall >= 70,
        score:    overall,
        build:    { score: build.score, valid: build.valid },
        deploy:   deploy   ? { score: deploy.score,   grade: deploy.grade }   : null,
        security: security ? { score: security.score, grade: security.grade } : null,
        secrets:  secrets  ? { criticalMissing: secrets.critical.length }     : null,
        blockers: [
            ...(build.checks.filter(c => c.status === "fail").map(c => c.detail)),
            ...(deploy?.failures  || []).slice(0, 3).map(f => f.detail),
            ...(security?.failures || []).slice(0, 3).map(f => f.detail),
            ...(secrets?.critical || []).map(k => `Missing secret: ${k}`),
        ].filter(Boolean),
    };
}

// ── Create release record ─────────────────────────────────────────────────
async function createRelease(spec) {
    const version = spec.version || getCurrentVersion().version;
    const checklist = runChecklist(version, { hasNotes: !!spec.notes });
    const notes = spec.notes ? { markdown: spec.notes, version } : await generateReleaseNotes(version, spec);

    const release = {
        releaseId:  _relId(),
        version,
        name:       spec.name     || `Release ${version}`,
        status:     checklist.ready ? "released" : "draft",
        checklist:  checklist,
        notes:      notes.markdown,
        buildScore: validateBuild().score,
        createdAt:  new Date().toISOString(),
        releasedAt: checklist.ready ? new Date().toISOString() : null,
        owner:      spec.owner || null,
        repo:       spec.repo  || null,
        metadata:   spec.metadata || {},
    };
    _releases.push(release); _save();
    execLog.append({ agentId: "ReleaseEngine", taskType: "create_release", taskId: release.releaseId, success: release.status === "released", durationMs: 0 });

    // Store in memory for cross-agent access
    try {
        const mpl = require("./memoryPersistenceLayer.cjs");
        mpl.save({ key: `Release ${version}`, value: { releaseId: release.releaseId, version, status: release.status, checklist: checklist.score }, type: "metric", tags: ["release", version], importance: 85, confidence: 95 });
    } catch { /* non-critical */ }

    logger.info(`[ReleaseEngine] Release ${version} created (${release.status})`);
    return release;
}

function getRelease(releaseId) { return _releases.find(r => r.releaseId === releaseId) || null; }

function listReleases({ status, limit = 50, offset = 0 } = {}) {
    let rows = [..._releases].reverse();
    if (status) rows = rows.filter(r => r.status === status);
    const stats = { total: _releases.length, released: _releases.filter(r => r.status === "released").length, draft: _releases.filter(r => r.status === "draft").length };
    return { releases: rows.slice(offset, offset + limit), total: rows.length, stats };
}

module.exports = { validateBuild, runChecklist, bumpVersion, getCurrentVersion, generateReleaseNotes, checkDeploymentReadiness, createRelease, getRelease, listReleases };
