"use strict";
/**
 * executionGraph — DAG analysis for workflow step scheduling.
 *
 * Detects ctx read/write patterns across steps to build a dependency graph:
 *   step B depends on step A if B reads ctx["step-A-name"] (injected by autonomousWorkflow)
 *   OR if B's source accesses ctx["A"] via literal key.
 *
 * Produces:
 *   parallelGroups   — Kahn-grouped topological levels (each level can run in parallel)
 *   criticalPath     — longest sequential dependency chain
 *   bottlenecks      — steps blocking the most downstream work
 *   parallelizable   — step names that share a group with at least one other step
 */

// ── Source extraction ─────────────────────────────────────────────────

function _src(step) {
    return typeof step.execute === "function" ? step.execute.toString() : "";
}

function _literalKeys(src, re) {
    const keys = new Set();
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(src)) !== null) keys.add(m[1]);
    return keys;
}

// ── Graph construction ────────────────────────────────────────────────

/**
 * Build a dependency graph from a steps array.
 *
 * @param {object[]} steps
 * @returns {Graph}
 */
function buildGraph(steps) {
    const n        = steps.length;
    const writeRe  = /ctx\[['"]([^'"]+)['"]\]\s*=/g;
    const readRe   = /ctx\[['"]([^'"]+)['"]\](?!\s*=)/g;

    // Per-step write/read sets
    const meta = steps.map(step => {
        const src    = _src(step);
        const writes = _literalKeys(src, new RegExp(writeRe.source, "g"));
        const reads  = _literalKeys(src, new RegExp(readRe.source,  "g"));
        // autonomousWorkflow injects ctx[step.name] = result on success
        writes.add(step.name);
        reads.delete(step.name);  // self-reads are not dependencies
        return { name: step.name, writes, reads };
    });

    // Edges: A → B if A.writes ∩ B.reads is non-empty (A must complete before B)
    const edges  = [];  // { from: idx, to: idx, key: string }
    const deps   = steps.map(() => new Set());  // deps[i] = set of indices i depends on
    const rdeps  = steps.map(() => new Set());  // rdeps[i] = steps that depend on i

    for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
            for (const key of meta[a].writes) {
                if (meta[b].reads.has(key)) {
                    edges.push({ from: a, to: b, key });
                    deps[b].add(a);
                    rdeps[a].add(b);
                    break;
                }
            }
        }
    }

    const inDegree  = steps.map((_, i) => deps[i].size);
    const outDegree = steps.map((_, i) => rdeps[i].size);

    return { steps, meta, edges, deps, rdeps, inDegree, outDegree };
}

// ── Topological order ─────────────────────────────────────────────────

function _topoOrder(graph) {
    const { steps, deps, inDegree } = graph;
    const n      = steps.length;
    const degree = [...inDegree];
    const order  = [];
    const queue  = [];

    for (let i = 0; i < n; i++) if (degree[i] === 0) queue.push(i);

    while (queue.length) {
        const node = queue.shift();
        order.push(node);
        for (let j = 0; j < n; j++) {
            if (deps[j].has(node)) {
                degree[j]--;
                if (degree[j] === 0) queue.push(j);
            }
        }
    }

    // Append cycle nodes (shouldn't occur in well-formed workflows)
    for (let i = 0; i < n; i++) if (!order.includes(i)) order.push(i);

    return order;
}

// ── Parallel groups ───────────────────────────────────────────────────

/**
 * Group steps into levels where all steps in the same level are
 * mutually independent and can execute in parallel.
 *
 * @param {Graph} graph
 * @returns {string[][]} array of name-arrays, one per parallel level
 */
function parallelGroups(graph) {
    const { steps, deps, inDegree } = graph;
    const n       = steps.length;
    const degree  = [...inDegree];
    const groups  = [];
    const visited = new Set();

    while (visited.size < n) {
        const group = [];
        for (let i = 0; i < n; i++) {
            if (!visited.has(i) && degree[i] === 0) group.push(i);
        }
        if (group.length === 0) break;  // cycle guard

        for (const idx of group) {
            visited.add(idx);
            for (let j = 0; j < n; j++) {
                if (!visited.has(j) && deps[j].has(idx)) degree[j]--;
            }
        }
        groups.push(group.map(i => steps[i].name));
    }

    return groups;
}

// ── Critical path ─────────────────────────────────────────────────────

/**
 * Compute the longest dependency chain (critical path).
 * Returns step names in order from root to leaf.
 *
 * @param {Graph} graph
 * @returns {{ path: string[], length: number }}
 */
function criticalPath(graph) {
    const { steps, deps } = graph;
    const n       = steps.length;
    const order   = _topoOrder(graph);
    const dp      = new Array(n).fill(1);  // longest path ending at i
    const parent  = new Array(n).fill(-1);

    for (const i of order) {
        for (const j of deps[i]) {
            if (dp[j] + 1 > dp[i]) {
                dp[i]     = dp[j] + 1;
                parent[i] = j;
            }
        }
    }

    let maxLen = 0, endNode = 0;
    for (let i = 0; i < n; i++) {
        if (dp[i] > maxLen) { maxLen = dp[i]; endNode = i; }
    }

    const path = [];
    let cur = endNode;
    while (cur !== -1) {
        path.unshift(steps[cur].name);
        cur = parent[cur];
    }

    return { path, length: maxLen };
}

// ── Bottleneck detection ──────────────────────────────────────────────

/**
 * Identify bottleneck steps.
 * A step is a bottleneck if it concentrates many dependencies:
 *   high in-degree  (many steps must complete before it can run)
 *   high out-degree (many steps are blocked waiting for it)
 *   on the critical path with downstream dependents
 *
 * @param {Graph} graph
 * @returns {object[]} sorted by score descending
 */
function detectBottlenecks(graph) {
    const { steps, inDegree, outDegree } = graph;
    const cpNames = new Set(criticalPath(graph).path);
    const bottlenecks = [];

    for (let i = 0; i < steps.length; i++) {
        const onCP = cpNames.has(steps[i].name);
        const score = inDegree[i] * 0.4 + outDegree[i] * 0.6 + (onCP ? 0.5 : 0);

        if (inDegree[i] >= 2 || outDegree[i] >= 2 || (onCP && outDegree[i] >= 1)) {
            bottlenecks.push({
                name:          steps[i].name,
                inDegree:      inDegree[i],
                outDegree:     outDegree[i],
                onCriticalPath: onCP,
                score:         parseFloat(score.toFixed(2)),
            });
        }
    }

    return bottlenecks.sort((a, b) => b.score - a.score);
}

// ── Full analysis ─────────────────────────────────────────────────────

/**
 * @param {object[]} steps
 * @returns {GraphAnalysis}
 */
function analyzeGraph(steps) {
    if (!steps || steps.length === 0) {
        return {
            totalSteps: 0, edges: [], parallelGroups: [], parallelizable: [],
            criticalPath: { path: [], length: 0 }, bottlenecks: [],
            hasCycles: false, maxParallelism: 0,
        };
    }

    const graph    = buildGraph(steps);
    const groups   = parallelGroups(graph);
    const cp       = criticalPath(graph);
    const bottlenecks = detectBottlenecks(graph);

    const parallelizable = groups
        .filter(g => g.length > 1)
        .flat();

    const coveredByGroups = groups.flat().length;
    const hasCycles       = coveredByGroups < steps.length;

    return {
        totalSteps:     steps.length,
        edges:          graph.edges,
        parallelGroups: groups,
        parallelizable,
        criticalPath:   cp,
        bottlenecks,
        hasCycles,
        maxParallelism: Math.max(...groups.map(g => g.length), 1),
    };
}

module.exports = { buildGraph, parallelGroups, criticalPath, detectBottlenecks, analyzeGraph };
