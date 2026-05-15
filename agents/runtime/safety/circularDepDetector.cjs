"use strict";
/**
 * circularDepDetector — static require() cycle detection.
 *
 * scan(entryFile, opts?)   → { hasCycles, cycles[{ path[] }], graph }
 * detectInFile(filePath)   → { requires[], errors[] } — extract requires from one file
 * wouldCreateCycle(from, to, existingGraph) → boolean
 */

const fs   = require("fs");
const path = require("path");

const REQUIRE_RX = /require\(['"]([^'"]+)['"]\)/g;
const MAX_DEPTH  = 50;

function detectInFile(filePath) {
    let src;
    try { src = fs.readFileSync(filePath, "utf8"); }
    catch (e) { return { requires: [], errors: [e.message] }; }

    const requires = [];
    const rx = new RegExp(REQUIRE_RX.source, "g");
    let m;
    while ((m = rx.exec(src)) !== null) {
        const dep = m[1];
        if (!dep.startsWith(".")) continue;   // skip node_modules
        const abs = _resolve(dep, filePath);
        if (abs) requires.push(abs);
    }
    return { requires, errors: [] };
}

function _resolve(dep, fromFile) {
    const base = path.resolve(path.dirname(fromFile), dep);
    // Try exact, then with .cjs, .js, /index.cjs, /index.js
    for (const candidate of [base, base + ".cjs", base + ".js",
                              path.join(base, "index.cjs"), path.join(base, "index.js")]) {
        try { fs.accessSync(candidate); return candidate; } catch { /* try next */ }
    }
    return null;
}

function scan(entryFile, opts = {}) {
    const absEntry = path.resolve(entryFile);
    const graph    = {};     // file → [deps]
    const visited  = new Set();
    const cycles   = [];

    function dfs(file, stack, depth) {
        if (depth > MAX_DEPTH) return;
        if (visited.has(file)) return;
        visited.add(file);

        const { requires } = detectInFile(file);
        graph[file] = requires;

        for (const dep of requires) {
            const cycleStart = stack.indexOf(dep);
            if (cycleStart !== -1) {
                cycles.push({ path: [...stack.slice(cycleStart), dep] });
                continue;
            }
            dfs(dep, [...stack, dep], depth + 1);
        }
    }

    dfs(absEntry, [absEntry], 0);

    return { hasCycles: cycles.length > 0, cycles, graph };
}

function wouldCreateCycle(fromFile, toFile, existingGraph = {}) {
    const from = path.resolve(fromFile);
    const to   = path.resolve(toFile);

    // BFS from `to` — if we can reach `from`, adding from→to would create a cycle
    const visited = new Set();
    const queue   = [to];
    while (queue.length > 0) {
        const cur = queue.shift();
        if (cur === from) return true;
        if (visited.has(cur)) continue;
        visited.add(cur);
        for (const dep of (existingGraph[cur] || [])) queue.push(dep);
    }
    return false;
}

module.exports = { scan, detectInFile, wouldCreateCycle };
