"use strict";
/**
 * benchmarkReporter — generate structured benchmark reports from run results.
 *
 * generateReport(results[])
 *   → { summary, table[], failureCategories[], repairRanking[], unstableWorkflows[] }
 *
 * formatTable(results[])    → aligned text table string
 * topFailures(results[], n) → [{category, count, rate}]
 * repairEffectivenessRanking(results[]) → [{name, repairRate, composite}]
 * detectUnstable(results[], threshold?) → [{name, flipRate, successRate, verdict}]
 * exportMarkdown(report)    → markdown string
 */

const UNSTABLE_FLIP_THRESHOLD    = 0.30;
const UNRELIABLE_SUCCESS_THRESHOLD = 0.50;

// ── generateReport ────────────────────────────────────────────────────

function generateReport(results = []) {
    const table              = _buildTable(results);
    const failureCategories  = topFailures(results, 10);
    const repairRanking      = repairEffectivenessRanking(results);
    const unstableWorkflows  = detectUnstable(results);

    const totalRuns      = results.reduce((s, r) => s + (r.totalRuns || 1), 0);
    const avgSuccess     = results.length > 0
        ? parseFloat((results.reduce((s, r) => s + (r.successRate || 0), 0) / results.length).toFixed(3))
        : 0;
    const avgRepair      = results.length > 0
        ? parseFloat((results.reduce((s, r) => s + (r.repairRate  || 0), 0) / results.length).toFixed(3))
        : 0;
    const avgComposite   = results.length > 0
        ? Math.round(results.reduce((s, r) => s + (r.score?.composite || 0), 0) / results.length)
        : 0;

    return {
        generatedAt:      new Date().toISOString(),
        scenarioCount:    results.length,
        totalRuns,
        summary: {
            avgSuccessRate:    avgSuccess,
            avgRepairRate:     avgRepair,
            avgCompositeScore: avgComposite,
            unstableCount:     unstableWorkflows.length,
            topFailureCategory: failureCategories[0]?.category || "none",
        },
        table,
        failureCategories,
        repairRanking,
        unstableWorkflows,
    };
}

// ── formatTable ───────────────────────────────────────────────────────

function formatTable(results = []) {
    if (results.length === 0) return "(no results)";

    const cols = [
        { key: "name",        label: "Scenario",   width: 30 },
        { key: "category",    label: "Category",   width: 16 },
        { key: "successRate", label: "Success%",   width: 10, fmt: v => pct(v) },
        { key: "repairRate",  label: "Repair%",    width: 10, fmt: v => pct(v) },
        { key: "flipRate",    label: "FlipRate",   width: 10, fmt: v => v?.toFixed(3) ?? "—" },
        { key: "avgMs",       label: "AvgMs",      width: 8,  fmt: v => v ?? "—" },
        { key: "composite",   label: "Score",      width: 7,  fmt: (_, r) => r.score?.composite ?? "—" },
    ];

    const header = cols.map(c => c.label.padEnd(c.width)).join(" ");
    const divider = cols.map(c => "─".repeat(c.width)).join(" ");
    const rows    = results.map(r =>
        cols.map(c => {
            const raw = c.fmt ? c.fmt(r[c.key], r) : String(r[c.key] ?? "—");
            return raw.toString().padEnd(c.width);
        }).join(" ")
    );

    return [header, divider, ...rows].join("\n");
}

// ── topFailures ───────────────────────────────────────────────────────

function topFailures(results = [], n = 5) {
    const cats = {};
    for (const r of results) {
        const cat  = r.category || "unknown";
        const fails = r.runs?.filter(run => !run.success).length
            ?? Math.round((1 - (r.successRate || 0)) * (r.totalRuns || 1));
        cats[cat] = (cats[cat] || 0) + fails;
    }
    const total = Object.values(cats).reduce((s, v) => s + v, 0) || 1;
    return Object.entries(cats)
        .map(([category, count]) => ({
            category,
            count,
            rate: parseFloat((count / total).toFixed(3)),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, n);
}

// ── repairEffectivenessRanking ────────────────────────────────────────

function repairEffectivenessRanking(results = []) {
    return results
        .map(r => ({
            name:         r.name     || "unnamed",
            category:     r.category || "unknown",
            repairRate:   r.repairRate   ?? 0,
            successRate:  r.successRate  ?? 0,
            composite:    r.score?.composite ?? 0,
        }))
        .sort((a, b) => b.repairRate - a.repairRate || b.composite - a.composite);
}

// ── detectUnstable ────────────────────────────────────────────────────

function detectUnstable(results = [], threshold = UNSTABLE_FLIP_THRESHOLD) {
    return results
        .filter(r => (r.flipRate ?? 0) > threshold || (r.successRate ?? 1) < UNRELIABLE_SUCCESS_THRESHOLD)
        .map(r => ({
            name:        r.name || "unnamed",
            flipRate:    r.flipRate    ?? 0,
            successRate: r.successRate ?? 0,
            verdict:     _verdict(r),
        }))
        .sort((a, b) => b.flipRate - a.flipRate);
}

// ── exportMarkdown ────────────────────────────────────────────────────

function exportMarkdown(report) {
    const lines = [];
    lines.push(`# Benchmark Report`);
    lines.push(`Generated: ${report.generatedAt}`);
    lines.push(``);
    lines.push(`## Summary`);
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Scenarios | ${report.scenarioCount} |`);
    lines.push(`| Total runs | ${report.totalRuns} |`);
    lines.push(`| Avg success rate | ${pct(report.summary?.avgSuccessRate)} |`);
    lines.push(`| Avg repair rate | ${pct(report.summary?.avgRepairRate)} |`);
    lines.push(`| Avg composite score | ${report.summary?.avgCompositeScore} |`);
    lines.push(`| Unstable workflows | ${report.summary?.unstableCount} |`);
    lines.push(``);

    if (report.table?.length > 0) {
        lines.push(`## Results`);
        lines.push("```");
        lines.push(formatTable(report.table));
        lines.push("```");
        lines.push(``);
    }

    if (report.failureCategories?.length > 0) {
        lines.push(`## Top Failure Categories`);
        lines.push(`| Category | Failures | Rate |`);
        lines.push(`|----------|----------|------|`);
        for (const f of report.failureCategories) {
            lines.push(`| ${f.category} | ${f.count} | ${pct(f.rate)} |`);
        }
        lines.push(``);
    }

    if (report.unstableWorkflows?.length > 0) {
        lines.push(`## Unstable Workflows`);
        for (const w of report.unstableWorkflows) {
            lines.push(`- **${w.name}**: ${w.verdict} (flipRate=${w.flipRate.toFixed(3)}, success=${pct(w.successRate)})`);
        }
        lines.push(``);
    }

    return lines.join("\n");
}

// ── helpers ───────────────────────────────────────────────────────────

function _buildTable(results) {
    return results.map(r => ({
        name:        r.name        || "unnamed",
        category:    r.category    || "generic",
        successRate: r.successRate ?? 0,
        repairRate:  r.repairRate  ?? 0,
        flipRate:    r.flipRate    ?? 0,
        avgMs:       r.avgMs       ?? 0,
        score:       r.score       || null,
        totalRuns:   r.totalRuns   ?? 1,
    }));
}

function _verdict(r) {
    if ((r.flipRate ?? 0) > 0.5)   return "highly_unstable";
    if ((r.successRate ?? 1) < 0.2) return "critically_unreliable";
    if ((r.flipRate ?? 0) > 0.30)   return "unstable";
    return "unreliable";
}

function pct(v) {
    if (v == null) return "—";
    return Math.round(v * 100) + "%";
}

module.exports = {
    generateReport,
    formatTable,
    topFailures,
    repairEffectivenessRanking,
    detectUnstable,
    exportMarkdown,
    UNSTABLE_FLIP_THRESHOLD,
    UNRELIABLE_SUCCESS_THRESHOLD,
};
