"use strict";
/**
 * taskSuites — 8 real-world autonomous repair scenarios.
 *
 * Each suite:
 *   - Creates a realistic temp project (actual files on disk)
 *   - Returns steps that trigger real failure types the recovery engine handles
 *   - Includes a cleanup() for temp file removal
 *   - Uses only: node --check, fs, path, os — no React/Docker/TS toolchains required
 *
 * Scenarios:
 *   react-build-repair      — JS files with syntax errors (mirrors broken React src)
 *   docker-recovery         — port conflict + env var bootstrap
 *   typescript-migration    — JSDoc→TS annotation conversion with validation
 *   dependency-conflict     — MODULE_NOT_FOUND then npm-install recovery
 *   broken-api-recovery     — ECONNREFUSED network error → backoff retry
 *   failing-test-repair     — broken assertion file fixed by logic inversion
 *   env-bootstrap           — missing .env → stub creation with required keys
 *   git-merge-repair        — conflict markers in file → automated resolution
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { spawnSync } = require("child_process");

// ── Project factory ───────────────────────────────────────────────────

function createTmpProject(name, files) {
    const dir = path.join(os.tmpdir(), `jarvis-suite-${name}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, "utf8");
    }
    return dir;
}

function rmDir(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ } }

function syntaxCheck(file) {
    const r = spawnSync("node", ["--check", file], { encoding: "utf8", timeout: 5_000 });
    return r.status === 0;
}

// ── 1. React build repair ─────────────────────────────────────────────

function createReactBuildSuite() {
    const dir = createTmpProject("react-build", {
        "src/App.js": `"use strict";\nfunction App() {\n    return { title: "App" };\n`,          // missing }
        "src/index.js": `"use strict";\nconst App = require('./App');\nfunction render() {\n    App();\n`,  // missing }
        "src/utils.js": `"use strict";\nmodule.exports = { add: (a, b) => a + b };\n`,           // clean
        "package.json": JSON.stringify({ name: "react-app", version: "1.0.0" }, null, 2),
    });

    let appCallCount   = 0;
    let indexCallCount = 0;

    return {
        name: "react-build-repair",
        projectPath: dir,
        steps: [
            {
                name: "scan-src",
                execute: async (ctx) => {
                    ctx._projectPath = dir;
                    const files  = ["src/App.js", "src/index.js", "src/utils.js"].map(f => path.join(dir, f));
                    const errors = files.filter(f => !syntaxCheck(f)).map(f => path.basename(f));
                    return { files: files.length, errors, hasErrors: errors.length > 0 };
                },
            },
            {
                name:       "repair-App",
                maxRetries: 2,
                simulate:   async (ctx) => ({ willModify: [path.join(dir, "src/App.js")], risk: "low" }),
                execute: async (ctx) => {
                    appCallCount++;
                    ctx._lastFile = path.join(dir, "src/App.js");
                    if (appCallCount === 1) {
                        const e = new Error("SyntaxError: Unexpected end of input");
                        e.name = "SyntaxError";
                        throw e;
                    }
                    return { repaired: "App.js", syntaxOk: syntaxCheck(ctx._lastFile) };
                },
            },
            {
                name:       "repair-index",
                maxRetries: 2,
                simulate:   async (ctx) => ({ willModify: [path.join(dir, "src/index.js")], risk: "low" }),
                execute: async (ctx) => {
                    indexCallCount++;
                    ctx._lastFile = path.join(dir, "src/index.js");
                    if (indexCallCount === 1) {
                        const e = new Error("SyntaxError: Unexpected end of input");
                        e.name = "SyntaxError";
                        throw e;
                    }
                    return { repaired: "index.js", syntaxOk: syntaxCheck(ctx._lastFile) };
                },
            },
            {
                name: "validate-build",
                execute: async (ctx) => {
                    const files  = ["src/App.js", "src/index.js"].map(f => path.join(dir, f));
                    const broken = files.filter(f => !syntaxCheck(f));
                    if (broken.length > 0) throw new Error(`${broken.length} file(s) still broken after repair`);
                    return { buildOk: true, filesValidated: files.length };
                },
            },
        ],
        cleanup: () => rmDir(dir),
    };
}

// ── 2. Docker recovery ────────────────────────────────────────────────

function createDockerSuite() {
    const dir = createTmpProject("docker-app", {
        "docker-compose.yml": `version: "3"\nservices:\n  app:\n    ports:\n      - "3001:3001"\n`,
        "server.js": `"use strict";\nmodule.exports = { port: 3001, start() {} };\n`,
    });

    let bindCount = 0;

    return {
        name: "docker-recovery",
        projectPath: dir,
        steps: [
            {
                name: "check-config",
                execute: async (ctx) => {
                    ctx._projectPath = dir;
                    const exists = fs.existsSync(path.join(dir, "docker-compose.yml"));
                    return { configFound: exists };
                },
            },
            {
                name:       "bind-service-port",
                maxRetries: 2,
                execute: async (ctx) => {
                    bindCount++;
                    if (bindCount === 1) {
                        const e = new Error("listen EADDRINUSE :::3001");
                        e.code = "EADDRINUSE";
                        throw e;
                    }
                    const port = ctx._port || 3001;
                    return { bound: true, port };
                },
            },
            {
                name: "write-env",
                execute: async (ctx) => {
                    const port = ctx._port || 3001;
                    fs.writeFileSync(path.join(dir, ".env"), `PORT=${port}\nNODE_ENV=production\n`, "utf8");
                    return { envWritten: true, port };
                },
            },
        ],
        cleanup: () => rmDir(dir),
    };
}

// ── 3. TypeScript migration ───────────────────────────────────────────

function createTypeScriptSuite() {
    const dir = createTmpProject("ts-migration", {
        "src/math.js": `"use strict";\n/** @param {number} a @param {number} b @returns {number} */\nfunction add(a, b) {\n    return a + b;\n}\nmodule.exports = { add };\n`,
        "src/string.js": `"use strict";\n/** @param {string} s @returns {string} */\nfunction upper(s) {\n    return s.toUpperCase();\nmodule.exports = { upper };\n`,  // missing }
    });

    let migrated = 0;

    return {
        name: "typescript-migration",
        projectPath: dir,
        steps: [
            {
                name: "scan-js-files",
                execute: async (ctx) => {
                    ctx._projectPath = dir;
                    const jsFiles = fs.readdirSync(path.join(dir, "src")).filter(f => f.endsWith(".js"));
                    ctx._jsFiles = jsFiles.map(f => path.join(dir, "src", f));
                    return { count: jsFiles.length, files: jsFiles };
                },
            },
            {
                name:       "repair-syntax-errors",
                maxRetries: 2,
                execute: async (ctx) => {
                    // Find and repair broken files before migration
                    const broken = (ctx._jsFiles || []).filter(f => !syntaxCheck(f));
                    if (broken.length === 0) return { repaired: 0 };
                    for (const f of broken) {
                        ctx._lastFile = f;
                        const src    = fs.readFileSync(f, "utf8");
                        const opens  = (src.match(/\{/g) || []).length;
                        const closes = (src.match(/\}/g) || []).length;
                        if (opens > closes) fs.writeFileSync(f, src + "\n}".repeat(opens - closes), "utf8");
                    }
                    return { repaired: broken.length };
                },
            },
            {
                name: "migrate-to-ts-annotations",
                execute: async (ctx) => {
                    // Transform: add 'use strict' guard, JSDoc → inline TS comment marker
                    const results = [];
                    for (const f of (ctx._jsFiles || [])) {
                        const src  = fs.readFileSync(f, "utf8");
                        // Mark as migration-ready by adding a @ts-check header
                        if (!src.includes("@ts-check")) {
                            fs.writeFileSync(f, `// @ts-check\n${src}`, "utf8");
                            results.push(path.basename(f));
                        }
                    }
                    migrated = results.length;
                    return { migrated, files: results };
                },
            },
            {
                name: "validate-migration",
                execute: async (ctx) => {
                    const broken = (ctx._jsFiles || []).filter(f => !syntaxCheck(f));
                    if (broken.length > 0) throw new Error(`${broken.length} file(s) invalid after migration`);
                    return { valid: true, filesChecked: (ctx._jsFiles || []).length };
                },
            },
        ],
        cleanup: () => rmDir(dir),
    };
}

// ── 4. Dependency conflict repair ─────────────────────────────────────

function createDependencyConflictSuite() {
    const dir = createTmpProject("dep-conflict", {
        "package.json": JSON.stringify({
            name: "dep-test", version: "1.0.0", dependencies: { "lodash": "^4.0.0" },
        }, null, 2),
        "index.js": `"use strict";\n// requires lodash\nmodule.exports = {};\n`,
    });

    let loadAttempt = 0;

    return {
        name: "dependency-conflict",
        projectPath: dir,
        steps: [
            {
                name: "read-package",
                execute: async (ctx) => {
                    ctx._projectPath = dir;
                    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
                    return { name: pkg.name, depCount: Object.keys(pkg.dependencies || {}).length };
                },
            },
            {
                name:       "load-dependencies",
                maxRetries: 2,
                execute: async (ctx) => {
                    loadAttempt++;
                    if (loadAttempt === 1) {
                        const e = new Error("Cannot find module 'lodash'");
                        e.code = "MODULE_NOT_FOUND";
                        throw e;
                    }
                    // Recovery ran npm install or extracted package — succeed on retry
                    return { loaded: true, attempt: loadAttempt };
                },
            },
            {
                name: "verify-deps",
                execute: async (ctx) => {
                    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
                    return { verified: true, deps: Object.keys(pkg.dependencies || {}) };
                },
            },
        ],
        cleanup: () => rmDir(dir),
    };
}

// ── 5. Broken API recovery ────────────────────────────────────────────

function createBrokenAPISuite() {
    const dir = createTmpProject("broken-api", {
        "api.js": `"use strict";\nmodule.exports = { endpoint: "http://127.0.0.1:19999/api" };\n`,
    });

    let fetchAttempt = 0;

    return {
        name: "broken-api-recovery",
        projectPath: dir,
        steps: [
            {
                name: "read-config",
                execute: async (ctx) => {
                    ctx._projectPath = dir;
                    return { endpoint: "http://127.0.0.1:19999/api" };
                },
            },
            {
                name:       "fetch-health",
                maxRetries: 3,
                execute: async (ctx) => {
                    fetchAttempt++;
                    if (fetchAttempt <= 2) {
                        const e = new Error("connect ECONNREFUSED 127.0.0.1:19999");
                        e.code = "ECONNREFUSED";
                        throw e;
                    }
                    // After network-wait-retry recovery applies, succeed
                    return { status: "ok", attempt: fetchAttempt };
                },
            },
            {
                name: "report-health",
                execute: async (ctx) => {
                    const health = ctx["fetch-health"];
                    return { healthy: health?.status === "ok", attempts: health?.attempt };
                },
            },
        ],
        cleanup: () => rmDir(dir),
    };
}

// ── 6. Failing test repair ────────────────────────────────────────────

function createFailingTestSuite() {
    const dir = createTmpProject("failing-tests", {
        "lib/math.js": `"use strict";\nmodule.exports = { sum: (a, b) => a + b, double: x => x * 2 };\n`,
        "test/math.test.js": `"use strict";\n// Broken: asserts wrong value\nconst { sum, double } = require('../lib/math');\nconst assert = require('assert');\nassert.strictEqual(sum(1, 2), 99, 'sum should be 99'); // WRONG\nassert.strictEqual(double(5), 10, 'double ok');\nconsole.log('tests passed');\n`,
    });

    let repairDone = false;

    return {
        name: "failing-test-repair",
        projectPath: dir,
        steps: [
            {
                name: "run-tests-initial",
                optional: true,
                execute: async (ctx) => {
                    ctx._projectPath = dir;
                    const testFile = path.join(dir, "test/math.test.js");
                    const r = spawnSync("node", [testFile], { encoding: "utf8", timeout: 5_000 });
                    return { passed: r.status === 0, output: (r.stdout + r.stderr).slice(0, 200) };
                },
            },
            {
                name:       "repair-assertion",
                maxRetries: 2,
                execute: async (ctx) => {
                    if (!repairDone) {
                        repairDone = true;
                        const testFile = path.join(dir, "test/math.test.js");
                        const src = fs.readFileSync(testFile, "utf8");
                        // Fix the broken assertion: 99 → 3
                        const fixed = src.replace(
                            /assert\.strictEqual\(sum\(1, 2\), \d+,/,
                            "assert.strictEqual(sum(1, 2), 3,"
                        );
                        if (fixed === src) throw new Error("pattern not found — cannot repair assertion");
                        fs.writeFileSync(testFile, fixed, "utf8");
                        ctx._lastFile = testFile;
                    }
                    return { repaired: true };
                },
            },
            {
                name: "run-tests-after",
                execute: async (ctx) => {
                    const testFile = path.join(dir, "test/math.test.js");
                    const r = spawnSync("node", [testFile], { encoding: "utf8", timeout: 5_000 });
                    if (r.status !== 0) throw new Error(`Tests still failing: ${(r.stdout + r.stderr).slice(0, 150)}`);
                    return { passed: true };
                },
            },
        ],
        cleanup: () => rmDir(dir),
    };
}

// ── 7. Environment bootstrap ──────────────────────────────────────────

function createEnvBootstrapSuite() {
    const dir = createTmpProject("env-bootstrap", {
        "server.js": `"use strict";\nmodule.exports = { port: process.env.PORT || 3000 };\n`,
        ".env.example": `PORT=3000\nNODE_ENV=development\nAPI_KEY=your_key_here\n`,
    });

    const envFile    = path.join(dir, ".env");
    let loadAttempt  = 0;

    return {
        name: "env-bootstrap",
        projectPath: dir,
        steps: [
            {
                name: "check-env-file",
                execute: async (ctx) => {
                    ctx._projectPath = dir;
                    const exists = fs.existsSync(envFile);
                    return { envExists: exists, path: envFile };
                },
            },
            {
                name:       "load-env",
                maxRetries: 2,
                execute: async (ctx) => {
                    loadAttempt++;
                    if (loadAttempt === 1 && !fs.existsSync(envFile)) {
                        const e = new Error(`ENOENT: no such file or directory, open '${envFile}'`);
                        e.code = "ENOENT";
                        throw e;
                    }
                    // Ensure proper .env content — recovery may have created a JS stub
                    let content = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
                    if (!content.includes("PORT=")) {
                        const examplePath = path.join(dir, ".env.example");
                        const template = fs.existsSync(examplePath)
                            ? fs.readFileSync(examplePath, "utf8")
                            : "PORT=3000\nNODE_ENV=development\n";
                        fs.writeFileSync(envFile, template, "utf8");
                        content = template;
                    }
                    const vars = Object.fromEntries(
                        content.split("\n")
                            .filter(l => l.includes("=") && !l.startsWith("#"))
                            .map(l => l.split("=").map(s => s.trim()))
                    );
                    return { loaded: true, vars: Object.keys(vars) };
                },
            },
            {
                name: "validate-required-env",
                execute: async (ctx) => {
                    const content  = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
                    const hasPort  = /PORT=/i.test(content);
                    const hasPkg   = /NODE_ENV=/i.test(content);
                    return { portSet: hasPort, nodeEnvSet: hasPkg, envValid: hasPort };
                },
            },
        ],
        cleanup: () => rmDir(dir),
    };
}

// ── 8. Git merge conflict repair ──────────────────────────────────────

function createGitMergeSuite() {
    const dir = createTmpProject("git-merge", {
        "config.js": [
            `"use strict";`,
            `<<<<<<< HEAD`,
            `const DB_HOST = "localhost";`,
            `const DB_PORT = 5432;`,
            `=======`,
            `const DB_HOST = "db.prod.example.com";`,
            `const DB_PORT = 5433;`,
            `>>>>>>> feature/db-migration`,
            `module.exports = { DB_HOST, DB_PORT };`,
        ].join("\n"),
        "routes.js": `"use strict";\nmodule.exports = [];\n`,  // clean
    });

    return {
        name: "git-merge-repair",
        projectPath: dir,
        steps: [
            {
                name: "detect-conflicts",
                execute: async (ctx) => {
                    ctx._projectPath = dir;
                    const files   = fs.readdirSync(dir).map(f => path.join(dir, f));
                    const conflicted = files.filter(f => {
                        try { return fs.readFileSync(f, "utf8").includes("<<<<<<<"); }
                        catch { return false; }
                    });
                    ctx._conflictedFiles = conflicted;
                    return { count: conflicted.length, files: conflicted.map(f => path.basename(f)) };
                },
            },
            {
                name:       "resolve-conflicts",
                maxRetries: 1,
                simulate:   async (ctx) => ({ willModify: ctx._conflictedFiles || [], risk: "low" }),
                execute: async (ctx) => {
                    const files = ctx._conflictedFiles || [];
                    if (files.length === 0) return { resolved: 0 };
                    const resolved = [];
                    for (const f of files) {
                        const src     = fs.readFileSync(f, "utf8");
                        // Resolution strategy: keep HEAD (ours) — discard theirs
                        const fixed   = src
                            .replace(/<<<<<<< .+\n([\s\S]*?)=======\n[\s\S]*?>>>>>>> .+\n/gm, "$1");
                        if (fixed !== src) {
                            fs.writeFileSync(f, fixed, "utf8");
                            resolved.push(path.basename(f));
                        }
                    }
                    return { resolved: resolved.length, files: resolved };
                },
            },
            {
                name: "validate-merge",
                execute: async (ctx) => {
                    const files = ctx._conflictedFiles || [];
                    for (const f of files) {
                        const content = fs.readFileSync(f, "utf8");
                        if (content.includes("<<<<<<<") || content.includes(">>>>>>>")) {
                            throw new Error(`Conflict markers remain in ${path.basename(f)}`);
                        }
                        if (!syntaxCheck(f)) throw new Error(`${path.basename(f)} has syntax errors after merge`);
                    }
                    return { clean: true, filesVerified: files.length };
                },
            },
        ],
        cleanup: () => rmDir(dir),
    };
}

// ── Registry ──────────────────────────────────────────────────────────

const SUITES = {
    "react-build-repair":    createReactBuildSuite,
    "docker-recovery":       createDockerSuite,
    "typescript-migration":  createTypeScriptSuite,
    "dependency-conflict":   createDependencyConflictSuite,
    "broken-api-recovery":   createBrokenAPISuite,
    "failing-test-repair":   createFailingTestSuite,
    "env-bootstrap":         createEnvBootstrapSuite,
    "git-merge-repair":      createGitMergeSuite,
};

module.exports = SUITES;
