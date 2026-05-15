"use strict";
/**
 * failurePredictor — predictive failure analysis before workflow execution.
 *
 * Runs before the workflow starts and surfaces probable failure causes so
 * the planner can adjust retry budgets, add preflight checks, or warn.
 *
 * Predictors:
 *   fragileDepScan     — extracts require("pkg") from step source, checks existence
 *   cyclicDetect       — finds ctx read/write cycles across steps
 *   unstablePortScan   — flags hardcoded ports that commonly conflict
 *   repeatedFailureScan — uses patternCluster to flag historically unreliable steps
 *
 * Each prediction:
 *   { type, stepName, severity, message, riskScore }
 *
 * Severity: "high" | "medium" | "low"
 */

const fs      = require("fs");
const path    = require("path");
const cluster = require("./patternCluster.cjs");

// ── Helpers ───────────────────────────────────────────────────────────

const BUILTIN_MODULES = new Set([
    "fs", "path", "os", "net", "http", "https", "crypto", "url", "util",
    "events", "stream", "child_process", "buffer", "assert", "zlib",
    "readline", "process", "module", "cluster", "dns", "dgram", "tty",
    "string_decoder", "tls", "timers", "console", "v8", "vm", "worker_threads",
    "node:test", "node:assert", "perf_hooks",
]);

function _stepSource(step) {
    return typeof step.execute === "function" ? step.execute.toString() : "";
}

// ── Predictor 1: fragile dependency scan ─────────────────────────────

function fragileDepScan(steps, projectPath) {
    const predictions = [];
    const requireRe   = /require\(['"]([^'"./][^'"]*)['"]\)/g;

    for (const step of steps) {
        const src  = _stepSource(step);
        let match;
        requireRe.lastIndex = 0;
        while ((match = requireRe.exec(src)) !== null) {
            const pkg = match[1];
            if (BUILTIN_MODULES.has(pkg) || pkg.startsWith("node:")) continue;

            // Strip subpath: "lodash/fp" → "lodash"; "@scope/pkg/sub" → "@scope/pkg"
            const topPkg = pkg.startsWith("@")
                ? pkg.split("/").slice(0, 2).join("/")
                : pkg.split("/")[0];

            let exists = true;
            if (projectPath) {
                const nmPath = path.join(projectPath, "node_modules", topPkg);
                exists = fs.existsSync(nmPath);
            }

            if (!exists) {
                predictions.push({
                    type:      "fragile_dependency",
                    stepName:  step.name,
                    severity:  "high",
                    message:   `Step "${step.name}" requires "${topPkg}" which is not in node_modules`,
                    riskScore: 0.75,
                    detail:    { package: topPkg },
                });
            }
        }
    }
    return predictions;
}

// ── Predictor 2: cyclic ctx dependency detection ──────────────────────

function cyclicDetect(steps) {
    const predictions = [];
    // Build a write/read map: which steps write ctx[name] and which steps read them
    const writes = new Map();  // stepName → array of ctx keys it sets
    const reads  = new Map();  // stepName → array of ctx keys it reads

    const writeRe = /ctx\[['"]([^'"]+)['"]\]\s*=/g;
    const readRe  = /ctx\[['"]([^'"]+)['"]\](?!\s*=)/g;

    for (const step of steps) {
        const src    = _stepSource(step);
        const w = [], r = [];

        let m;
        writeRe.lastIndex = 0;
        while ((m = writeRe.exec(src)) !== null) w.push(m[1]);
        readRe.lastIndex = 0;
        while ((m = readRe.exec(src)) !== null) {
            // Only count reads of keys that look like step names (contain hyphens)
            if (m[1].includes("-")) r.push(m[1]);
        }

        // Also catch ctx["step-name"] access patterns from autonomousWorkflow injection
        const nameRe = new RegExp(`ctx\\[["']${step.name}["']\\]`, "g");
        // implicit self-write
        if (nameRe.test(src)) w.push(step.name);

        writes.set(step.name, w);
        reads.set(step.name, r);
    }

    // Detect: step A writes key K, step B reads K and writes key K2, step A reads K2
    for (const stepA of steps) {
        for (const stepB of steps) {
            if (stepA.name === stepB.name) continue;
            const aWrites = writes.get(stepA.name) || [];
            const bReads  = reads.get(stepB.name)  || [];
            const bWrites = writes.get(stepB.name) || [];
            const aReads  = reads.get(stepA.name)  || [];

            const ab = aWrites.filter(k => bReads.includes(k));
            const ba = bWrites.filter(k => aReads.includes(k));

            if (ab.length > 0 && ba.length > 0) {
                predictions.push({
                    type:      "cyclic_dependency",
                    stepName:  `${stepA.name} ↔ ${stepB.name}`,
                    severity:  "medium",
                    message:   `Steps "${stepA.name}" and "${stepB.name}" have circular ctx dependencies`,
                    riskScore: 0.45,
                    detail:    { stepA: stepA.name, stepB: stepB.name, keysAB: ab, keysBA: ba },
                });
            }
        }
    }
    return predictions;
}

// ── Predictor 3: unstable port prediction ─────────────────────────────

// Ports commonly blocked by system services, browsers, or other dev tools
const RISKY_PORTS = new Set([
    80, 443, 3000, 3001, 4000, 5000, 5432, 5984, 6379, 6543,
    8000, 8080, 8443, 8888, 9000, 9200, 9300, 27017, 27018,
]);

function unstablePortScan(steps) {
    const predictions = [];
    const portRe      = /(?:port|PORT|listen|bind)\s*[=:,\(]\s*(\d{2,5})/gi;

    for (const step of steps) {
        const src   = _stepSource(step);
        const found = new Set();
        let match;
        portRe.lastIndex = 0;
        while ((match = portRe.exec(src)) !== null) {
            const port = parseInt(match[1]);
            if (port > 0 && port < 65536 && !found.has(port)) {
                found.add(port);
                if (RISKY_PORTS.has(port)) {
                    predictions.push({
                        type:      "unstable_port",
                        stepName:  step.name,
                        severity:  "medium",
                        message:   `Step "${step.name}" uses port ${port} which is commonly occupied`,
                        riskScore: 0.40,
                        detail:    { port },
                    });
                }
            }
        }
    }
    return predictions;
}

// ── Predictor 4: repeated failure pattern detection ───────────────────

const REPEAT_FAILURE_THRESHOLD = 0.40; // flag steps with historical success rate < 40%

function repeatedFailureScan(steps) {
    const predictions = [];
    const allClusters = cluster.getClusters();

    for (const step of steps) {
        // Find any cluster matching this step name (partial match OK)
        const matches = allClusters.filter(c =>
            c.stepName && (
                step.name.includes(c.stepName) ||
                c.stepName.includes(step.name)
            )
        );

        for (const c of matches) {
            if (c.totalAttempts >= 4 && c.successRate < REPEAT_FAILURE_THRESHOLD) {
                predictions.push({
                    type:      "repeated_failure_pattern",
                    stepName:  step.name,
                    severity:  c.successRate < 0.20 ? "high" : "medium",
                    message:   `Step "${step.name}" historically fails ${Math.round((1 - c.successRate) * 100)}% of the time (${c.totalAttempts} samples)`,
                    riskScore: 1 - c.successRate,
                    detail:    {
                        cluster:      c.id,
                        successRate:  c.successRate,
                        totalAttempts: c.totalAttempts,
                        bestStrategy: c.bestStrategy,
                    },
                });
            }
        }
    }
    return predictions;
}

// ── Full prediction analysis ──────────────────────────────────────────

/**
 * Run all four predictors and return an aggregated PredictionReport.
 *
 * @param {object[]} steps
 * @param {string}   projectPath  — optional, enables dependency scanning
 * @returns {PredictionReport}
 */
function analyzePredictions(steps, projectPath = null) {
    const all = [
        ...fragileDepScan(steps, projectPath),
        ...cyclicDetect(steps),
        ...unstablePortScan(steps),
        ...repeatedFailureScan(steps),
    ];

    const high   = all.filter(p => p.severity === "high");
    const medium = all.filter(p => p.severity === "medium");
    const low    = all.filter(p => p.severity === "low");

    const avgRisk  = all.length > 0
        ? all.reduce((s, p) => s + (p.riskScore || 0), 0) / all.length
        : 0;

    const riskLevel = high.length > 0   ? "high"
                    : medium.length > 0  ? "medium"
                    : low.length > 0     ? "low"
                    : "clean";

    return {
        predictions:  all,
        high,
        medium,
        low,
        riskLevel,
        avgRisk:      parseFloat(avgRisk.toFixed(3)),
        hasCritical:  high.length > 0,
    };
}

module.exports = {
    analyzePredictions,
    fragileDepScan,
    cyclicDetect,
    unstablePortScan,
    repeatedFailureScan,
    RISKY_PORTS,
};
