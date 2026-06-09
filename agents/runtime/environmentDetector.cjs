"use strict";
/**
 * Phase 513 — Environment Auto-Detection
 *
 * Detects: Node version, package manager, runtime dependencies,
 * active services, frontend/backend structure, deployment environment.
 *
 * Generates: environment readiness summary, likely setup issues,
 * recommended workflows.
 *
 * Pure read — no execution side effects.
 */

const fs      = require("fs");
const path    = require("path");
const { execSync } = require("child_process");

function _tryRequire(p) { try { return require(p); } catch { return null; } }
function _exec(cmd) {
    try { return execSync(cmd, { timeout: 5000, stdio: ["pipe","pipe","pipe"] }).toString().trim(); }
    catch { return null; }
}
function _exists(p) { try { return fs.existsSync(p); } catch { return false; } }

const ROOT = path.join(__dirname, "../../");

// ── Detection functions ───────────────────────────────────────────────────────

function _detectNode() {
    const version = process.version;
    const major   = parseInt(version.slice(1).split(".")[0]);
    return {
        version,
        major,
        ok:       major >= 18,
        warning:  major < 18 ? `Node ${version} — JARVIS requires Node 18+` : null,
    };
}

function _detectPackageManager() {
    const hasYarnLock = _exists(path.join(ROOT, "yarn.lock"));
    const hasPnpmLock = _exists(path.join(ROOT, "pnpm-lock.yaml"));
    const hasNpmLock  = _exists(path.join(ROOT, "package-lock.json"));
    const pm = hasYarnLock ? "yarn" : hasPnpmLock ? "pnpm" : "npm";
    return { detected: pm, lockfileFound: hasYarnLock || hasPnpmLock || hasNpmLock };
}

function _detectDependencies() {
    const pkgPath = path.join(ROOT, "package.json");
    const nmPath  = path.join(ROOT, "node_modules");
    let   pkg     = null;
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); } catch {}

    const nmExists    = _exists(nmPath);
    const depCount    = pkg ? Object.keys(pkg.dependencies || {}).length : 0;
    const devDepCount = pkg ? Object.keys(pkg.devDependencies || {}).length : 0;

    const criticalDeps = ["express", "better-sqlite3"];
    const missing = pkg ? criticalDeps.filter(d => !((pkg.dependencies || {})[d] || (pkg.devDependencies || {})[d])) : [];

    return {
        packageJsonFound: !!pkg,
        nodeModulesFound: nmExists,
        depCount,
        devDepCount,
        criticalDepsMissing: missing,
        ok: nmExists && missing.length === 0,
        warning: !nmExists ? "node_modules not found — run npm install" : missing.length > 0 ? `Missing: ${missing.join(", ")}` : null,
    };
}

function _detectActiveServices() {
    const services = [];

    // Backend (pm2 or node process)
    const pm2List = _exec("pm2 jlist 2>/dev/null");
    if (pm2List) {
        try {
            const procs = JSON.parse(pm2List);
            procs.forEach(p => services.push({ name: p.name, pm2: true, status: p.pm2_env?.status || "unknown", pid: p.pid }));
        } catch {}
    }

    // Fallback: check port 3000
    const port3000 = _exec("lsof -ti:3000 2>/dev/null | head -1");
    if (port3000 && services.length === 0) {
        services.push({ name: "unknown-backend", port: 3000, pid: parseInt(port3000) || null });
    }

    // Nginx
    const nginxStatus = _exec("systemctl is-active nginx 2>/dev/null") || _exec("nginx -t 2>&1 | tail -1");
    const nginxActive = nginxStatus && (nginxStatus === "active" || nginxStatus.includes("successful"));

    return { services, nginx: { detected: !!nginxStatus, active: nginxActive }, backendFound: services.length > 0 };
}

function _detectProjectStructure() {
    const structure = {
        hasBackend:    _exists(path.join(ROOT, "backend")),
        hasFrontend:   _exists(path.join(ROOT, "frontend")) || _exists(path.join(ROOT, "public")),
        hasMobile:     _exists(path.join(ROOT, "mobile")),
        hasAgents:     _exists(path.join(ROOT, "agents")),
        hasTests:      _exists(path.join(ROOT, "tests")),
        hasData:       _exists(path.join(ROOT, "data")),
        hasDockerfile: _exists(path.join(ROOT, "Dockerfile")) || _exists(path.join(ROOT, "docker-compose.yml")),
        hasEnvFile:    _exists(path.join(ROOT, ".env")) || _exists(path.join(ROOT, ".env.production")),
    };

    const type =
        structure.hasBackend && structure.hasFrontend ? "fullstack" :
        structure.hasBackend  ? "backend-only"         :
        structure.hasFrontend ? "frontend-only"        : "unknown";

    return { ...structure, type };
}

function _detectDeploymentEnv() {
    const nodeEnv = process.env.NODE_ENV || "development";
    const port    = process.env.PORT || "3000";
    const hasPort = !!process.env.PORT;

    const envFile = _exists(path.join(ROOT, ".env")) || _exists(path.join(ROOT, ".env.production"));
    const gitBranch = _exec("git branch --show-current 2>/dev/null");
    const isMain   = gitBranch === "main" || gitBranch === "master";

    return {
        nodeEnv,
        port,
        portFromEnv: hasPort,
        envFileFound: envFile,
        gitBranch,
        isProductionBranch: isMain,
        likelyProduction: nodeEnv === "production",
        warning: nodeEnv === "production" && !envFile ? "Production NODE_ENV but no .env file found" : null,
    };
}

// ── Recommendations ───────────────────────────────────────────────────────────

function _buildRecommendations(node, deps, services, structure, deployEnv) {
    const recommendations = [];

    if (!node.ok) recommendations.push({ priority: "high", workflow: null, message: node.warning });
    if (!deps.ok) recommendations.push({ priority: "high", workflow: "dependency-repair", message: deps.warning });
    if (!services.backendFound) recommendations.push({ priority: "medium", workflow: "backend-restore", message: "Backend service not detected — start with backend-restore workflow" });
    if (!structure.hasEnvFile) recommendations.push({ priority: "medium", workflow: "environment-bootstrap", message: "No .env file — run environment-bootstrap workflow" });
    if (deployEnv.warning) recommendations.push({ priority: "medium", workflow: null, message: deployEnv.warning });
    if (!structure.hasTests) recommendations.push({ priority: "low", workflow: null, message: "No tests directory — consider adding tests before deploying" });

    return recommendations;
}

// ── Public API ────────────────────────────────────────────────────────────────

function detect() {
    const node       = _detectNode();
    const pkgMgr     = _detectPackageManager();
    const deps       = _detectDependencies();
    const services   = _detectActiveServices();
    const structure  = _detectProjectStructure();
    const deployEnv  = _detectDeploymentEnv();
    const recommendations = _buildRecommendations(node, deps, services, structure, deployEnv);

    const issues = [
        !node.ok ? node.warning : null,
        !deps.ok ? deps.warning : null,
        deployEnv.warning,
    ].filter(Boolean);

    const ready = issues.length === 0;

    return {
        ready,
        node,
        packageManager: pkgMgr,
        dependencies:   deps,
        services,
        structure,
        deploymentEnv:  deployEnv,
        issues,
        recommendations,
        summary: ready
            ? `Environment ready — Node ${node.version}, ${deps.depCount} dep(s), ${pkgMgr.detected}`
            : `Environment has ${issues.length} issue(s) — review recommendations`,
        ts: new Date().toISOString(),
    };
}

module.exports = { detect };
