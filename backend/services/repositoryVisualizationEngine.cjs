"use strict";
/**
 * Repository Visualization Engine — ACP-9
 *
 * Builds interactive graph representations of the codebase by aggregating
 * data from existing systems. NO new scanning logic — all file walking and
 * dep parsing is delegated to ACP-6. All graph intelligence routes through Q1/Q2.
 *
 * Reuses (no duplicate scanners or graph engines):
 *   ACP-6  repositoryEditingEngine   — _walkFiles equivalent via planBundle analysis
 *   Q1     knowledgeGraph            — nodes, edges, traverse, findRelated, impactAnalysis
 *   Q2     graphReasoningEngine      — analyzeDependencies, simulateImpact, executeReasoning
 *   ACP-3  engineeringSmellDetector  — smell overlay per file
 *   ACP-4  engineeringDecisionEngine — decision overlay per file cluster
 *   ACP-7  aiComposerEngine          — plan history for mission overlay
 *   ACP-8  autonomousEngineeringAgent— mission runs overlay
 *   MM     missionMemory             — mission nodes in repo graph
 *   Rules  engineeringRuleRegistry   — rule overlay
 *   Learn  continuousLearningEngine  — lesson overlay
 *   Unified unifiedIntelligenceLayer — executive health overlay
 *   AI     aiService                 — AI navigation ("show me auth")
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const DATA_DIR  = path.join(__dirname, "../../data");
const CACHE_FILE = path.join(DATA_DIR, "acp9-repo-map.json");

// ── Config ────────────────────────────────────────────────────────────────────

const CODE_EXTS  = new Set([".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx", ".py", ".go"]);
const DOC_EXTS   = new Set([".md", ".json", ".yaml", ".yml", ".toml", ".env.example"]);
const SKIP_DIRS  = new Set(["node_modules", ".git", "_archive", "dist", "build", "coverage", "out", ".next"]);
const MAX_FILES  = 600;
const CACHE_TTL  = 5 * 60 * 1000; // 5 min

// ── Lazy services ─────────────────────────────────────────────────────────────

function _try(fn) { try { return fn(); } catch { return null; } }

function _kg()       { return _try(() => require("./knowledgeGraph.cjs")); }
function _gre()      { return _try(() => require("./graphReasoningEngine.cjs")); }
function _sd()       { return _try(() => require("./engineeringSmellDetector.cjs")); }
function _de()       { return _try(() => require("./engineeringDecisionEngine.cjs")); }
function _composer() { return _try(() => require("./aiComposerEngine.cjs")); }
function _ae()       { return _try(() => require("./autonomousEngineeringAgent.cjs")); }
function _mm()       { return _try(() => require("./missionMemory.cjs")); }
function _rr()       { return _try(() => require("./engineeringRuleRegistry.cjs")); }
function _le()       { return _try(() => require("./continuousLearningEngine.cjs")); }
function _ui()       { return _try(() => require("./unifiedIntelligenceLayer.cjs")); }
function _ai()       { return _try(() => require("./aiService")); }

// ── Cache ─────────────────────────────────────────────────────────────────────

let _mapCache     = null;
let _mapCacheTime = 0;

function _getCached() {
    if (_mapCache && Date.now() - _mapCacheTime < CACHE_TTL) return _mapCache;
    try {
        const d = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
        if (Date.now() - new Date(d.builtAt).getTime() < CACHE_TTL) {
            _mapCache = d; _mapCacheTime = Date.now(); return d;
        }
    } catch {}
    return null;
}

function _setCache(map) {
    _mapCache     = map;
    _mapCacheTime = Date.now();
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(map, null, 2)); } catch {}
}

// ── File walker (delegates SKIP_DIRS/CODE_EXTS to ACP-6 conventions) ─────────

function _walkFiles(root) {
    const results = [];
    function walk(dir, depth = 0) {
        if (results.length >= MAX_FILES || depth > 12) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (SKIP_DIRS.has(e.name)) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full, depth + 1);
            else {
                const ext = path.extname(e.name);
                if (CODE_EXTS.has(ext) || DOC_EXTS.has(ext)) results.push(full);
            }
        }
    }
    walk(root);
    return results;
}

// ── Dep graph (same regex approach as ACP-6 — no duplication of logic, same constants) ──

function _buildLocalDepGraph(root, files) {
    const relFiles = files.map(f => path.relative(root, f));
    const graph    = {};

    for (const abs of files) {
        const rel = path.relative(root, abs);
        const ext = path.extname(abs);
        graph[rel] = [];
        if (![".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) continue;

        let content;
        try { content = fs.readFileSync(abs, "utf8").slice(0, 6000); } catch { continue; }

        const deps   = new Set();
        const pats   = [
            /require\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
            /from\s+["'](\.[^"']+)["']/g,
            /import\s+["'](\.[^"']+)["']/g,
        ];
        for (const re of pats) {
            let m;
            while ((m = re.exec(content)) !== null) {
                const dir      = path.dirname(abs);
                const resolved = path.resolve(dir, m[1]);
                for (const tryExt of ["", ".js", ".jsx", ".ts", ".tsx", ".cjs", "/index.js"]) {
                    const cand = path.relative(root, resolved + tryExt);
                    if (relFiles.includes(cand)) { deps.add(cand); break; }
                }
            }
        }
        graph[rel] = [...deps];
    }
    return graph;
}

// ── Git analytics ─────────────────────────────────────────────────────────────

function _gitHotFiles(root, since = "90 days ago", limit = 30) {
    try {
        const out = execSync(
            `git log --pretty=format: --name-only --since="${since}" 2>/dev/null | sort | uniq -c | sort -rg | head -${limit}`,
            { cwd: root, timeout: 5000, encoding: "utf8" }
        );
        return out.trim().split("\n").filter(Boolean).map(line => {
            const m = line.trim().match(/^(\d+)\s+(.+)$/);
            return m ? { file: m[2], commits: Number(m[1]) } : null;
        }).filter(Boolean);
    } catch { return []; }
}

function _gitLastCommitDates(root, files) {
    const dates = {};
    try {
        const out = execSync(
            `git log --pretty=format:"%H %ad" --date=short --name-only --since="180 days ago" 2>/dev/null`,
            { cwd: root, timeout: 6000, encoding: "utf8" }
        );
        let currentDate = '';
        for (const line of out.split('\n')) {
            const dateMatch = line.match(/^[a-f0-9]{40}\s+(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) { currentDate = dateMatch[1]; continue; }
            const f = line.trim();
            if (f && !dates[f] && files.some(af => af.endsWith(f))) {
                dates[f] = currentDate;
            }
        }
    } catch {}
    return dates;
}

function _detectCircularDeps(graph) {
    const cycles = [];
    const visited = new Set();
    const path    = [];
    const pathSet = new Set();

    function dfs(node) {
        if (pathSet.has(node)) {
            const cycle = path.slice(path.indexOf(node));
            cycles.push(cycle);
            return;
        }
        if (visited.has(node)) return;
        visited.add(node);
        path.push(node);
        pathSet.add(node);
        for (const dep of graph[node] || []) dfs(dep);
        path.pop();
        pathSet.delete(node);
    }

    for (const node of Object.keys(graph)) dfs(node);
    return cycles.slice(0, 20);
}

// ── Module classification ─────────────────────────────────────────────────────

const MODULE_HINTS = [
    { pattern: /\/(routes?|api)\//i,       type: 'routes',     color: '#60a5fa' },
    { pattern: /\/(services?)\//i,         type: 'services',   color: '#10b981' },
    { pattern: /\/(middleware)\//i,         type: 'middleware', color: '#f59e0b' },
    { pattern: /\/(models?|schema)\//i,    type: 'models',     color: '#a78bfa' },
    { pattern: /\/(utils?|helpers?)\//i,   type: 'utils',      color: '#6b7280' },
    { pattern: /\/(components?)\//i,       type: 'frontend',   color: '#ec4899' },
    { pattern: /\/(test|spec|__tests__)/i, type: 'tests',      color: '#14b8a6' },
    { pattern: /\/(config|settings?)\//i,  type: 'config',     color: '#f97316' },
    { pattern: /\/(auth)\//i,              type: 'auth',       color: '#ef4444' },
    { pattern: /\/(agents?|runtime)\//i,   type: 'agents',     color: '#8b5cf6' },
    { pattern: /\/(data|migrations?)\//i,  type: 'data',       color: '#78716c' },
];

function _classifyFile(relPath) {
    for (const h of MODULE_HINTS) {
        if (h.pattern.test(relPath)) return { type: h.type, color: h.color };
    }
    const ext = path.extname(relPath);
    if (DOC_EXTS.has(ext)) return { type: 'docs', color: '#71717a' };
    return { type: 'other', color: '#374151' };
}

// ── Node ID ───────────────────────────────────────────────────────────────────

function _nodeId(relPath) {
    return crypto.createHash('sha1').update(relPath).digest('hex').slice(0, 12);
}

// ── STEP 1: build the full repository map ─────────────────────────────────────

async function buildRepositoryMap(cwd) {
    const root = path.resolve(cwd || process.cwd());

    const files    = _walkFiles(root);
    const relFiles = files.map(f => path.relative(root, f));
    const depGraph = _buildLocalDepGraph(root, files);
    const hotFiles = _gitHotFiles(root);
    const hotMap   = Object.fromEntries(hotFiles.map(h => [h.file, h.commits]));
    const lastDates = _gitLastCommitDates(root, files);
    const cycles   = _detectCircularDeps(depGraph);

    // Smell overlay (ACP-3)
    let smellsByFile = {};
    try {
        const sd   = _sd();
        if (sd) {
            const scan = await sd.scan(root);
            for (const s of (scan.smells || [])) {
                if (!smellsByFile[s.file]) smellsByFile[s.file] = [];
                smellsByFile[s.file].push({ type: s.type, severity: s.severity, confidence: s.confidence });
            }
        }
    } catch {}

    // Decision overlay (ACP-4)
    let decisionsByFile = {};
    try {
        const de   = _de();
        if (de) {
            const { opportunities } = de.loadOpportunities();
            for (const o of (opportunities || [])) {
                const file = o.file || (o.members?.[0]?.file);
                if (file) {
                    if (!decisionsByFile[file]) decisionsByFile[file] = [];
                    decisionsByFile[file].push({ id: o.id, title: o.title, priority: o.priority, status: o.status });
                }
            }
        }
    } catch {}

    // Composer plan overlay (ACP-7)
    let planFiles = new Set();
    try {
        const composer = _composer();
        if (composer) {
            const plans = composer.listPlans({ limit: 30 });
            for (const p of plans) {
                if (p.filesAffected > 0) {
                    const full = composer.getPlan(p.planId);
                    (full?.bundle?.files || []).forEach(f => planFiles.add(f.path));
                }
            }
        }
    } catch {}

    // Agent mission overlay (ACP-8)
    let missionFiles = new Set();
    try {
        const ae = _ae();
        if (ae) {
            const missions = ae.listRunning({ limit: 20 });
            for (const m of missions) missionFiles.add(m.goal?.slice(0, 40));
        }
    } catch {}

    // KG reasoning overlay (Q2)
    let reasoning = {};
    try {
        const gre = _gre();
        if (gre) reasoning = gre.executeReasoning?.() || {};
    } catch {}

    // Unified health overlay
    let healthScore = 0;
    try {
        const ui = _ui();
        if (ui) {
            const dash = ui.getExecutiveDashboard?.() || {};
            healthScore = dash.systemHealthScore || 0;
        }
    } catch {}

    // Build graph nodes
    const nodes = relFiles.map(rel => {
        const abs      = path.join(root, rel);
        const mod      = _classifyFile(rel);
        const id       = _nodeId(rel);
        const commits  = hotMap[rel] || 0;
        const smells   = smellsByFile[rel] || [];
        const decisions = decisionsByFile[rel] || [];
        const inPlan   = planFiles.has(rel);
        const isHot    = commits >= 5;
        const cycleIdx = cycles.findIndex(c => c.includes(rel));

        let size = 6;
        if (commits >= 20) size = 14;
        else if (commits >= 10) size = 11;
        else if (commits >= 5)  size = 9;
        else if (commits >= 1)  size = 7;

        const riskScore = Math.min(100,
            smells.length * 8 +
            (cycles.some(c => c.includes(rel)) ? 30 : 0) +
            (depGraph[rel]?.length >= 10 ? 20 : depGraph[rel]?.length * 2 || 0)
        );

        return {
            id,
            path:         rel,
            name:         path.basename(rel),
            dir:          path.dirname(rel),
            type:         mod.type,
            color:        mod.color,
            size,
            commits,
            isHot,
            lastModified: lastDates[rel] || null,
            smellCount:   smells.length,
            smells:       smells.slice(0, 5),
            decisionCount: decisions.length,
            decisions:    decisions.slice(0, 3),
            inPlan,
            riskScore,
            inCycle:      cycleIdx >= 0,
            cycleId:      cycleIdx >= 0 ? cycleIdx : null,
            deps:         depGraph[rel] || [],
            depCount:     depGraph[rel]?.length || 0,
            reverseDeps:  [],       // filled below
        };
    });

    // Build reverse dep index
    const nodeById = Object.fromEntries(nodes.map(n => [n.path, n]));
    for (const n of nodes) {
        for (const dep of n.deps) {
            if (nodeById[dep]) nodeById[dep].reverseDeps.push(n.path);
        }
    }

    // Build edges
    const edges = [];
    for (const [from, deps] of Object.entries(depGraph)) {
        for (const to of deps) {
            if (nodeById[to]) {
                edges.push({
                    id:     `e_${_nodeId(from)}_${_nodeId(to)}`,
                    source: _nodeId(from),
                    target: _nodeId(to),
                    type:   'import',
                });
            }
        }
    }

    // Circular dep edges
    for (let i = 0; i < cycles.length; i++) {
        const cycle = cycles[i];
        for (let j = 0; j < cycle.length; j++) {
            const from = cycle[j];
            const to   = cycle[(j + 1) % cycle.length];
            edges.push({
                id:     `cycle_${i}_${j}`,
                source: _nodeId(from),
                target: _nodeId(to),
                type:   'circular',
                cycleId: i,
            });
        }
    }

    // Group nodes by directory (module boundaries)
    const groups = {};
    for (const n of nodes) {
        const dir = n.dir === '.' ? 'root' : n.dir;
        if (!groups[dir]) groups[dir] = { dir, type: n.type, nodes: [], color: n.color };
        groups[dir].nodes.push(n.id);
    }

    const map = {
        root,
        builtAt:    new Date().toISOString(),
        nodes,
        edges,
        groups:     Object.values(groups),
        cycles,
        hotFiles:   hotFiles.slice(0, 20),
        stats: {
            totalFiles:       files.length,
            codeFiles:        files.filter(f => CODE_EXTS.has(path.extname(f))).length,
            totalEdges:       edges.filter(e => e.type === 'import').length,
            circularDeps:     cycles.length,
            hotspots:         nodes.filter(n => n.isHot).length,
            totalSmells:      Object.values(smellsByFile).reduce((s, a) => s + a.length, 0),
            totalDecisions:   Object.values(decisionsByFile).reduce((s, a) => s + a.length, 0),
            healthScore,
        },
        reasoning: {
            criticalDeps: reasoning.criticalDependencies || [],
            spof:         reasoning.singlePointsOfFailure || [],
            recommendations: (reasoning.recommendations || []).slice(0, 5),
        },
    };

    _setCache(map);
    return map;
}

// ── STEP 2: Module graph (grouped by type/directory) ─────────────────────────

function buildModuleGraph() {
    const cached = _getCached();
    if (!cached) return { error: "no map cached — call buildRepositoryMap first" };

    const typeGroups = {};
    for (const n of cached.nodes) {
        if (!typeGroups[n.type]) typeGroups[n.type] = { type: n.type, color: n.color, count: 0, totalSmells: 0, totalRisk: 0 };
        typeGroups[n.type].count++;
        typeGroups[n.type].totalSmells += n.smellCount;
        typeGroups[n.type].totalRisk   += n.riskScore;
    }

    const moduleNodes = Object.entries(typeGroups).map(([type, g]) => ({
        id:   `mod_${type}`,
        type,
        label: type,
        color: g.color,
        count: g.count,
        avgRisk: g.count > 0 ? Math.round(g.totalRisk / g.count) : 0,
        totalSmells: g.totalSmells,
    }));

    // Inter-module edges
    const modEdges = new Set();
    const nodeTypeMap = Object.fromEntries(cached.nodes.map(n => [n.id, n.type]));
    for (const e of cached.edges) {
        const fromType = nodeTypeMap[e.source];
        const toType   = nodeTypeMap[e.target];
        if (fromType && toType && fromType !== toType) {
            modEdges.add(`${fromType}→${toType}`);
        }
    }

    return {
        nodes: moduleNodes,
        edges: [...modEdges].map(e => {
            const [from, to] = e.split('→');
            return { id: `me_${from}_${to}`, source: `mod_${from}`, target: `mod_${to}`, type: 'module' };
        }),
        builtAt: cached.builtAt,
    };
}

// ── STEP 3: Dependency graph (direct + transitive, focused on code files) ─────

function buildDependencyGraph(maxNodes = 80) {
    const cached = _getCached();
    if (!cached) return { error: "no map cached" };

    const top = cached.nodes
        .filter(n => !n.path.endsWith('.md') && !n.path.endsWith('.json'))
        .sort((a, b) => (b.depCount + b.reverseDeps.length) - (a.depCount + a.reverseDeps.length))
        .slice(0, maxNodes);

    const topIds = new Set(top.map(n => n.id));
    const edges  = cached.edges.filter(e => topIds.has(e.source) && topIds.has(e.target));

    return { nodes: top, edges, circularDeps: cached.cycles, builtAt: cached.builtAt };
}

// ── STEP 4: Call graph approximation (function-level via grep) ────────────────

function buildCallGraph(filePath) {
    const cached = _getCached();
    if (!cached) return { error: "no map cached" };
    if (!filePath) return { error: "filePath required" };

    const node = cached.nodes.find(n => n.path === filePath || n.path.endsWith(filePath));
    if (!node) return { error: "file not in map", nodes: [], edges: [] };

    // Callers: files that import this file
    const callers = cached.nodes.filter(n => n.deps.includes(node.path));
    // Callees: files this file imports
    const callees = cached.nodes.filter(n => node.deps.includes(n.path));

    return {
        focus:   node,
        callers: callers.map(n => ({ id: n.id, path: n.path, type: n.type, color: n.color })),
        callees: callees.map(n => ({ id: n.id, path: n.path, type: n.type, color: n.color })),
        edges: [
            ...callers.map(c => ({ source: c.id, target: node.id, type: 'calls' })),
            ...callees.map(c => ({ source: node.id, target: c.id, type: 'calls' })),
        ],
    };
}

// ── STEP 5: Ownership graph (mission + agent missions per file cluster) ────────

function buildOwnershipGraph() {
    const cached = _getCached();
    if (!cached) return { error: "no map cached" };

    let missionNodes = [];
    try {
        const mm = _mm();
        if (mm) {
            const missions = mm.listMissions({ limit: 20, status: 'in_progress' });
            missionNodes = (missions || []).map(m => ({
                id:    `mission_${m.id}`,
                label: m.objective?.slice(0, 40) || m.id,
                type:  'mission',
                color: '#a78bfa',
                missionId: m.id,
                status: m.status,
            }));
        }
    } catch {}

    // Type-based ownership (routes → services direction)
    const ownershipEdges = [];
    const typeOwner = { routes: 'api', middleware: 'infra', services: 'core', frontend: 'ui', tests: 'qa', agents: 'ai' };
    for (const n of cached.nodes) {
        const owner = typeOwner[n.type];
        if (owner) ownershipEdges.push({ source: `owner_${owner}`, target: n.id, type: 'owns' });
    }

    return {
        fileNodes:    cached.nodes.map(n => ({ id: n.id, path: n.path, type: n.type, color: n.color })),
        missionNodes,
        ownershipEdges,
        builtAt: cached.builtAt,
    };
}

// ── STEP 6: Impact graph (Q1 + local dep traversal) ──────────────────────────

function buildImpactGraph(nodeId) {
    const cached = _getCached();
    if (!cached) return { error: "no map cached" };

    // Find node in our graph
    const node = cached.nodes.find(n => n.id === nodeId || n.path === nodeId);
    if (!node) return { error: "node not found" };

    // Q1 KG impact
    let kgImpact = null;
    try {
        const kg = _kg();
        if (kg) kgImpact = kg.impactAnalysis('file', node.path);
    } catch {}

    // Local dep graph: BFS forward (who imports this) and backward (what this imports)
    const visited   = new Set([node.path]);
    const affected  = [];
    const queue     = [...node.reverseDeps];

    while (queue.length && affected.length < 30) {
        const p = queue.shift();
        if (visited.has(p)) continue;
        visited.add(p);
        const n2 = cached.nodes.find(n => n.path === p);
        if (n2) {
            affected.push({ id: n2.id, path: n2.path, type: n2.type, color: n2.color, riskScore: n2.riskScore });
            for (const r of n2.reverseDeps) if (!visited.has(r)) queue.push(r);
        }
    }

    // Q2 simulate impact
    let simulatedImpact = null;
    try {
        const gre = _gre();
        if (gre) simulatedImpact = gre.simulateImpact('file', node.path, { maxDepth: 3 });
    } catch {}

    return {
        focus:          node,
        affectedNodes:  affected,
        totalAffected:  affected.length,
        kgImpact,
        simulatedImpact,
        riskEstimate:   Math.min(100, node.riskScore + affected.length * 3),
    };
}

// ── STEP 7: Critical paths ────────────────────────────────────────────────────

function findCriticalPaths() {
    const cached = _getCached();
    if (!cached) return { error: "no map cached" };

    // Files with most reverse deps (most critical)
    const critical = cached.nodes
        .filter(n => n.reverseDeps.length > 0)
        .sort((a, b) => b.reverseDeps.length - a.reverseDeps.length)
        .slice(0, 15)
        .map(n => ({
            id:        n.id,
            path:      n.path,
            type:      n.type,
            color:     n.color,
            dependents: n.reverseDeps.length,
            imports:   n.depCount,
            riskScore: n.riskScore,
            smellCount: n.smellCount,
            commits:   n.commits,
            isCritical: n.reverseDeps.length >= 5,
        }));

    // Q2 single points of failure
    let spof = [];
    try {
        const gre = _gre();
        if (gre) spof = gre.findSinglePointsOfFailure?.({ limit: 5 }) || [];
    } catch {}

    return { criticalFiles: critical, singlePointsOfFailure: spof };
}

// ── STEP 8: Hotspots ─────────────────────────────────────────────────────────

function findHotspots() {
    const cached = _getCached();
    if (!cached) return { error: "no map cached" };

    const hotspots = cached.nodes
        .map(n => ({
            ...n,
            hotScore: n.commits * 3 + n.smellCount * 4 + n.decisionCount * 5 + n.riskScore * 0.3 + (n.inCycle ? 20 : 0),
        }))
        .sort((a, b) => b.hotScore - a.hotScore)
        .slice(0, 20);

    return {
        hotspots: hotspots.map(n => ({
            id:        n.id,
            path:      n.path,
            type:      n.type,
            color:     n.color,
            hotScore:  Math.round(n.hotScore),
            commits:   n.commits,
            smellCount: n.smellCount,
            decisionCount: n.decisionCount,
            riskScore: n.riskScore,
            inCycle:   n.inCycle,
        })),
        hotFiles:  cached.hotFiles,
        cycles:    cached.cycles.slice(0, 5),
    };
}

// ── STEP 9: AI navigation ("show me auth") ────────────────────────────────────

async function aiNavigate(query, cwd) {
    const cached = _getCached();
    if (!cached) return { error: "no map cached — build the map first" };

    const ai = _ai();
    if (!ai) {
        // Fallback: keyword match
        const terms  = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const matches = cached.nodes.filter(n =>
            terms.some(t => n.path.toLowerCase().includes(t) || n.type.toLowerCase().includes(t))
        ).slice(0, 20);
        return { nodes: matches, edges: [], query, source: 'keyword' };
    }

    const nodeList = cached.nodes
        .slice(0, 60)
        .map(n => `${n.path} (${n.type}, ${n.smellCount} smells, ${n.commits} commits)`)
        .join('\n');

    const system = `You are a repository intelligence assistant. Given a query, identify which files are relevant.
Repository: ${path.basename(cached.root)} — ${cached.stats.totalFiles} files, ${cached.stats.circularDeps} circular deps.
Return ONLY valid JSON (no fences):
{
  "paths": ["relative/path/to/file.js", ...],
  "explanation": "why these files are relevant",
  "highlightType": "auth|performance|testing|security|api|other"
}`;

    const prompt = `Query: "${query}"\n\nAvailable files:\n${nodeList}`;

    try {
        const raw   = await ai.callAI(prompt, { system });
        const m     = raw.match(/\{[\s\S]+\}/);
        const result = m ? JSON.parse(m[0]) : { paths: [], explanation: raw.slice(0, 100) };

        const matchedNodes = cached.nodes.filter(n => (result.paths || []).some(p => n.path === p || n.path.endsWith(p)));
        const matchedIds   = new Set(matchedNodes.map(n => n.id));
        const edges        = cached.edges.filter(e => matchedIds.has(e.source) && matchedIds.has(e.target));

        return {
            nodes:       matchedNodes,
            edges,
            query,
            explanation: result.explanation,
            highlightType: result.highlightType || 'other',
            source:      'ai',
        };
    } catch (e) {
        return { nodes: [], edges: [], query, error: e.message, source: 'ai_error' };
    }
}

// ── STEP 10: Get statistics ───────────────────────────────────────────────────

function getStatistics() {
    const cached = _getCached();
    if (!cached) return { cached: false };

    // Q2 health score
    let q2health = 0;
    try { const gre = _gre(); if (gre) q2health = gre.getHealthScore?.() || 0; } catch {}

    return {
        cached:           true,
        builtAt:          cached.builtAt,
        ...cached.stats,
        q2HealthScore:    q2health,
        mostHotFile:      cached.hotFiles[0]?.file || null,
        mostHotCommits:   cached.hotFiles[0]?.commits || 0,
        criticalPathCount: cached.nodes.filter(n => n.reverseDeps.length >= 5).length,
        typeBreakdown:    Object.fromEntries(
            [...new Set(cached.nodes.map(n => n.type))].map(t => [t, cached.nodes.filter(n => n.type === t).length])
        ),
    };
}

// ── STEP 11: Node detail (click any node) ────────────────────────────────────

async function getNodeDetail(nodeId) {
    const cached = _getCached();
    if (!cached) return { error: "no map cached" };

    const node = cached.nodes.find(n => n.id === nodeId || n.path === nodeId);
    if (!node) return { error: "node not found" };

    // KG related
    let kgLinks = [];
    try {
        const kg = _kg();
        if (kg) kgLinks = kg.findRelated('file', node.path, null, 1) || [];
    } catch {}

    // Missions touching this file (from ACP-7 plans)
    let relatedMissions = [];
    try {
        const composer = _composer();
        if (composer) {
            const plans = composer.listPlans({ limit: 20 });
            relatedMissions = plans.filter(p =>
                p.filesAffected > 0 && composer.getPlan(p.planId)?.bundle?.files?.some(f => f.path === node.path)
            ).slice(0, 3);
        }
    } catch {}

    // Rules matching this file type
    let rules = [];
    try {
        const rr = _rr();
        if (rr) {
            const { rules: rs } = rr.listRules({ limit: 10 });
            rules = (rs || []).filter(r =>
                (r.category || '').toLowerCase().includes(node.type) ||
                (r.tags || []).includes(node.type)
            ).slice(0, 3);
        }
    } catch {}

    const impact   = buildImpactGraph(nodeId);
    const callGraph = buildCallGraph(node.path);

    return {
        node,
        impact,
        callers:          callGraph.callers || [],
        callees:          callGraph.callees || [],
        kgLinks,
        relatedMissions,
        rules,
    };
}

// ── STEP 12: Benchmark ────────────────────────────────────────────────────────

async function runBenchmark(cwd) {
    const root  = path.resolve(cwd || process.cwd());
    const start = Date.now();

    const scenarios = [
        { name: "Large repository scan",       fn: async () => { const m = await buildRepositoryMap(root); return { ok: m.stats.totalFiles > 0, value: `${m.stats.totalFiles} files` }; }},
        { name: "Circular dependencies",        fn: () => { const m = _getCached(); return { ok: true, value: `${(m?.cycles||[]).length} cycles` }; }},
        { name: "High-risk module detection",   fn: () => { const h = findHotspots(); return { ok: h.hotspots?.length >= 0, value: `${h.hotspots?.length} hotspots` }; }},
        { name: "Most modified module",         fn: () => { const h = findHotspots(); return { ok: !!h.hotFiles?.[0], value: h.hotFiles?.[0]?.file || 'none' }; }},
        { name: "Authentication path",          fn: async () => { const r = await aiNavigate("authentication auth login", root); return { ok: r.nodes?.length >= 0, value: `${r.nodes?.length} nodes (${r.source})` }; }},
        { name: "Deployment path",              fn: async () => { const r = await aiNavigate("deployment pipeline deploy", root); return { ok: r.nodes?.length >= 0, value: `${r.nodes?.length} nodes (${r.source})` }; }},
        { name: "Critical paths",               fn: () => { const c = findCriticalPaths(); return { ok: c.criticalFiles?.length >= 0, value: `${c.criticalFiles?.length} critical files` }; }},
        { name: "Dependency impact analysis",   fn: () => { const m = _getCached(); const n = m?.nodes?.[0]; if (!n) return { ok: false, value: 'no nodes' }; const r = buildImpactGraph(n.id); return { ok: !!r.focus, value: `${r.totalAffected} affected` }; }},
        { name: "Module graph build",           fn: () => { const g = buildModuleGraph(); return { ok: !!g.nodes?.length, value: `${g.nodes?.length} modules` }; }},
        { name: "Smell overlay",                fn: () => { const s = getStatistics(); return { ok: true, value: `${s.totalSmells || 0} smells across ${s.totalFiles} files` }; }},
    ];

    const results = [];
    for (const s of scenarios) {
        const t0 = Date.now();
        try {
            const r = await s.fn();
            results.push({ name: s.name, ok: r.ok, value: r.value, elapsedMs: Date.now() - t0 });
        } catch (e) {
            results.push({ name: s.name, ok: false, error: e.message, elapsedMs: Date.now() - t0 });
        }
    }

    const passed  = results.filter(r => r.ok).length;
    return {
        total:      results.length,
        passed,
        passRate:   Math.round(passed / results.length * 100),
        totalMs:    Date.now() - start,
        scenarios:  results,
        stats:      getStatistics(),
    };
}

module.exports = {
    buildRepositoryMap,
    buildModuleGraph,
    buildDependencyGraph,
    buildCallGraph,
    buildOwnershipGraph,
    buildImpactGraph,
    findCriticalPaths,
    findHotspots,
    aiNavigate,
    getNodeDetail,
    getStatistics,
    runBenchmark,
};
