"use strict";
/**
 * executionGraphViewer — text-based visualisation of execution graphs.
 *
 * render(graphAnalysis)          → full text representation
 * renderParallelGroups(groups[]) → level-by-level diagram
 * renderCriticalPath(path[])     → highlighted path string
 * renderBottlenecks(bottlenecks) → bottleneck summary table
 */

function renderParallelGroups(groups) {
    if (!Array.isArray(groups) || groups.length === 0) return "(no parallel groups)";
    const lines = ["Execution Levels (parallel groups):"];
    groups.forEach((group, i) => {
        const bar  = "█".repeat(group.length);
        const names = group.join(" ║ ");
        lines.push(`  L${i + 1} [${bar}]  ${names}`);
    });
    return lines.join("\n");
}

function renderCriticalPath(criticalPath) {
    if (!criticalPath?.path?.length) return "(no critical path)";
    const chain = criticalPath.path.join(" → ");
    return `Critical Path (len=${criticalPath.length}):\n  ★ ${chain}`;
}

function renderBottlenecks(bottlenecks) {
    if (!Array.isArray(bottlenecks) || bottlenecks.length === 0) return "(no bottlenecks detected)";
    const lines = ["Bottlenecks:"];
    for (const b of bottlenecks) {
        const flags = [
            b.onCriticalPath ? "CRITICAL-PATH" : null,
            b.inDegree  >= 2 ? `fan-in=${b.inDegree}`   : null,
            b.outDegree >= 2 ? `fan-out=${b.outDegree}` : null,
        ].filter(Boolean).join(", ");
        lines.push(`  ⚡ ${b.step}  [${flags}]`);
    }
    return lines.join("\n");
}

function render(graphAnalysis) {
    if (!graphAnalysis) return "(no graph analysis)";

    const sections = [];

    sections.push("═".repeat(52));
    sections.push("  EXECUTION GRAPH");
    sections.push("═".repeat(52));

    if (graphAnalysis.parallelGroups) {
        sections.push(renderParallelGroups(graphAnalysis.parallelGroups));
    }

    if (graphAnalysis.criticalPath) {
        sections.push("");
        sections.push(renderCriticalPath(graphAnalysis.criticalPath));
    }

    if (graphAnalysis.bottlenecks?.length > 0) {
        sections.push("");
        sections.push(renderBottlenecks(graphAnalysis.bottlenecks));
    }

    if (graphAnalysis.maxParallelism !== undefined) {
        sections.push("");
        sections.push(`Max Parallelism: ${graphAnalysis.maxParallelism}`);
    }

    sections.push("═".repeat(52));
    return sections.join("\n");
}

module.exports = { render, renderParallelGroups, renderCriticalPath, renderBottlenecks };
