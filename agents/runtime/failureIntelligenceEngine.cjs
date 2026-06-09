"use strict";
/**
 * Phase 531 — Advanced Failure Intelligence
 *
 * Root-cause clustering, failure-chain mapping, unstable workflow detection,
 * deployment-risk estimation, recovery confidence scoring.
 *
 * Bounded, explainable, operationally useful.
 * Pure read — no state mutation.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const FAILURE_PATTERNS = [
    { id: "module-not-found",    pattern: /cannot find module|module not found/i,     rootCause: "Missing npm dependency",          recovery: "dependency-repair",        riskLevel: "high"   },
    { id: "connection-refused",  pattern: /econnrefused|connection refused/i,         rootCause: "Backend service not running",     recovery: "backend-restore",          riskLevel: "high"   },
    { id: "nginx-502",           pattern: /nginx.*502|upstream.*failed|bad gateway/i, rootCause: "Frontend proxy failure",          recovery: "frontend-recovery",        riskLevel: "high"   },
    { id: "git-conflict",        pattern: /merge conflict|git.*conflict/i,            rootCause: "Git merge conflict",              recovery: "git-safe-update",          riskLevel: "medium" },
    { id: "heap-oom",            pattern: /out of memory|heap.*exceeded|enomem/i,     rootCause: "Memory exhaustion",              recovery: "pressure-relief",          riskLevel: "critical" },
    { id: "disk-full",           pattern: /enospc|no space left|disk.*full/i,         rootCause: "Disk space exhausted",           recovery: null,                       riskLevel: "critical" },
    { id: "perm-denied",         pattern: /eacces|permission denied/i,               rootCause: "File permission error",          recovery: null,                       riskLevel: "medium" },
    { id: "syntax-error",        pattern: /syntaxerror|unexpected token/i,           rootCause: "JavaScript syntax error",        recovery: null,                       riskLevel: "medium" },
    { id: "timeout",             pattern: /timeout|etimedout|timed out/i,            rootCause: "Operation timeout",              recovery: "backend-restore",          riskLevel: "medium" },
    { id: "deploy-fail",         pattern: /deployment.*failed|pipeline.*failed/i,    rootCause: "Deployment pipeline failure",    recovery: "recover-backend",          riskLevel: "high"   },
];

// ── Root-cause clustering ─────────────────────────────────────────────────────

function clusterRootCauses(errorMessages = []) {
    const counts = {};
    const examples = {};

    for (const msg of errorMessages) {
        let matched = false;
        for (const pat of FAILURE_PATTERNS) {
            if (pat.pattern.test(msg)) {
                if (!counts[pat.id]) { counts[pat.id] = 0; examples[pat.id] = []; }
                counts[pat.id]++;
                if (examples[pat.id].length < 3) examples[pat.id].push(msg.slice(0, 100));
                matched = true;
                break;
            }
        }
        if (!matched) {
            if (!counts["unknown"]) { counts["unknown"] = 0; examples["unknown"] = []; }
            counts["unknown"]++;
        }
    }

    return Object.entries(counts)
        .map(([id, count]) => {
            const pat = FAILURE_PATTERNS.find(p => p.id === id);
            return {
                id,
                count,
                rootCause:  pat ? pat.rootCause  : "Unknown failure",
                recovery:   pat ? pat.recovery   : null,
                riskLevel:  pat ? pat.riskLevel  : "low",
                examples:   examples[id] || [],
            };
        })
        .sort((a, b) => b.count - a.count);
}

// ── Failure chain mapping ─────────────────────────────────────────────────────

function mapFailureChain(chainName) {
    const analytics = _tryRequire("./operationalAnalytics.cjs");
    const forensics = _tryRequire("./runtimeForensics.cjs");
    if (!analytics && !forensics) return { available: false };

    let failureRate = null, totalRuns = 0;
    if (analytics) {
        try {
            const s = analytics.summary();
            const chain = (s.chains || {})[chainName];
            if (chain) {
                totalRuns   = chain.runs || 0;
                failureRate = chain.runs > 0 ? 1 - (chain.successRate || 0) : null;
            }
        } catch {}
    }

    const recentFailures = forensics
        ? forensics.query({ limit: 50 }).filter(e => (e.chain === chainName) && (e.type === "failure" || e.type === "error"))
        : [];

    const errorTexts  = recentFailures.map(e => e.summary || e.message || "");
    const rootCauses  = clusterRootCauses(errorTexts);

    return {
        available:   true,
        chainName,
        totalRuns,
        failureRate: failureRate !== null ? Math.round(failureRate * 100) : null,
        recentFailures: recentFailures.length,
        rootCauses:  rootCauses.slice(0, 3),
        primaryRecovery: rootCauses[0]?.recovery || null,
    };
}

// ── Unstable workflow detection ───────────────────────────────────────────────

function detectUnstableWorkflows(threshold = 0.4) {
    const analytics = _tryRequire("./operationalAnalytics.cjs");
    if (!analytics) return { available: false, unstable: [] };

    try {
        const s       = analytics.summary();
        const chains  = s.chains || {};
        const unstable = Object.entries(chains)
            .filter(([, stats]) => stats.runs >= 3 && (stats.successRate || 1) < (1 - threshold))
            .map(([name, stats]) => ({
                chainName:   name,
                runs:        stats.runs,
                successRate: Math.round((stats.successRate || 0) * 100),
                failureRate: Math.round((1 - (stats.successRate || 0)) * 100),
                riskLevel:   stats.successRate < 0.3 ? "critical" : "high",
                recommendation: `Review chain "${name}" — ${Math.round((1 - (stats.successRate || 0)) * 100)}% failure rate`,
            }))
            .sort((a, b) => a.successRate - b.successRate);

        return { available: true, unstable, count: unstable.length };
    } catch (e) {
        return { available: false, error: e.message };
    }
}

// ── Deployment risk estimation ────────────────────────────────────────────────

function estimateDeploymentRisk(pipelineName = "standard-deploy") {
    const pipeline  = _tryRequire("./deploymentPipeline.cjs");
    const deployUX  = _tryRequire("./deploymentOperatorUX.cjs");
    const analytics = _tryRequire("./operationalAnalytics.cjs");

    const riskFactors = [];
    let riskScore = 0;

    // Pipeline confidence
    if (deployUX) {
        const pf = deployUX.preflightSummary(pipelineName);
        if (pf.ok) {
            const conf = pf.confidence;
            if (conf < 60) { riskScore += 30; riskFactors.push(`Low preflight confidence: ${conf}%`); }
            else if (conf < 80) { riskScore += 15; riskFactors.push(`Moderate preflight confidence: ${conf}%`); }
            riskScore += pf.warnings.length * 5;
            pf.warnings.forEach(w => riskFactors.push(`Warning: ${w}`));
            riskScore += pf.blockers.length * 25;
            pf.blockers.forEach(b => riskFactors.push(`Blocker: ${b}`));
        }
    }

    // Unstable workflows used in pipeline
    const pipeDef = pipeline ? pipeline.getPipeline(pipelineName) : null;
    if (pipeDef && analytics) {
        try {
            const s = analytics.summary();
            for (const stage of pipeDef.stages) {
                const chain = (s.chains || {})[stage.chain];
                if (chain && chain.runs >= 3 && (chain.successRate || 1) < 0.7) {
                    riskScore += 20;
                    riskFactors.push(`Stage "${stage.name}" chain "${stage.chain}" has ${Math.round((chain.successRate || 0) * 100)}% success rate`);
                }
            }
        } catch {}
    }

    riskScore = Math.min(100, riskScore);
    const riskLevel = riskScore >= 70 ? "critical" : riskScore >= 40 ? "high" : riskScore >= 20 ? "moderate" : "low";

    return {
        pipelineName,
        riskScore,
        riskLevel,
        riskFactors,
        recommendation: riskScore >= 40
            ? "High risk — resolve all factors before deploying"
            : "Risk acceptable — proceed with standard caution",
    };
}

// ── Recovery confidence scoring ───────────────────────────────────────────────

function recoveryConfidence(chainName) {
    const rm        = _tryRequire("./executionRecoveryMemory.cjs");
    const analytics = _tryRequire("./operationalAnalytics.cjs");

    let confidence = 50; // baseline
    const factors  = [];

    if (rm && rm.query) {
        try {
            const paths = rm.query({ limit: 100 })
                .filter(e => e.chainName === chainName && e.type === "validated-path");
            if (paths.length > 0) {
                const best = paths.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
                confidence = Math.max(confidence, best.confidence || 50);
                factors.push(`Validated path with ${best.confidence}% confidence`);
            }
        } catch {}
    }

    if (analytics) {
        try {
            const s     = analytics.summary();
            const chain = (s.chains || {})[chainName];
            if (chain && chain.runs >= 2) {
                const analyticsConf = Math.round((chain.successRate || 0) * 100);
                confidence = Math.round((confidence + analyticsConf) / 2);
                factors.push(`${chain.runs} runs, ${analyticsConf}% success rate`);
            }
        } catch {}
    }

    return {
        chainName,
        confidence:  Math.min(100, confidence),
        label:       confidence >= 80 ? "high" : confidence >= 60 ? "moderate" : confidence >= 40 ? "low" : "poor",
        factors,
        recommendation: confidence >= 60
            ? `Recovery chain "${chainName}" is reliable`
            : `Recovery chain "${chainName}" has limited validation — test in safe environment first`,
    };
}

// ── Unified failure intelligence report ──────────────────────────────────────

function report() {
    const forensics = _tryRequire("./runtimeForensics.cjs");
    const recentErrors = forensics
        ? forensics.query({ limit: 100 }).filter(e => e.type === "failure" || e.type === "error").map(e => e.summary || e.message || "")
        : [];

    return {
        rootCauseClusters:    clusterRootCauses(recentErrors),
        unstableWorkflows:    detectUnstableWorkflows(),
        deploymentRisk:       estimateDeploymentRisk("standard-deploy"),
        ts:                   new Date().toISOString(),
    };
}

module.exports = { clusterRootCauses, mapFailureChain, detectUnstableWorkflows, estimateDeploymentRisk, recoveryConfidence, report, FAILURE_PATTERNS };
