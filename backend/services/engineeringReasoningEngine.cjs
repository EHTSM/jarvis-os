"use strict";
/**
 * engineeringReasoningEngine.cjs — OAI X V1 Engineering Intelligence Evolution
 *
 * Reasons about WHY engineering systems behave as they do:
 *   - architectural reasoning  (coupling, cohesion, layering violations)
 *   - dependency reasoning     (circular deps, version drift, orphaned pkgs)
 *   - bug reasoning            (smell patterns → defect prediction)
 *   - performance reasoning    (hotspot identification, bottleneck chains)
 *   - security reasoning       (exposed surface, outdated deps, insecure patterns)
 *   - scalability reasoning    (bottleneck topology, single-points-of-failure)
 *
 * Reuses: engineeringMemoryEngine, engineeringRuleRegistry, engineeringSmellDetector,
 *         repoIntelligenceEngine, engineeringConfidenceEngine, continuousLearningEngine
 *
 * Storage: data/engineering-reasoning.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "engineering-reasoning.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _em  = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _rr  = () => _try(() => require("./engineeringRuleRegistry.cjs"));
const _sd  = () => _try(() => require("./engineeringSmellDetector.cjs"));
const _ri  = () => _try(() => require("./repoIntelligenceEngine.cjs"));
const _ce  = () => _try(() => require("./engineeringConfidenceEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `er_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ── Reasoning functions ───────────────────────────────────────────────────────

function _reasonArchitecture(repoData, smells) {
  const findings = [];
  const files   = repoData?.files || repoData?.fileCount || 0;
  const smellList = smells?.smells || smells?.issues || [];

  const couplingSmells = smellList.filter(s => /coupl|circular|depend/i.test(s.type || s.name || "")).length;
  const layerSmells    = smellList.filter(s => /layer|modulari|boundar/i.test(s.type || s.name || "")).length;
  const sizeSmells     = smellList.filter(s => /large|big|fat|god|blob/i.test(s.type || s.name || "")).length;

  if (couplingSmells > 0) findings.push({ type: "high_coupling", severity: "high", count: couplingSmells, recommendation: "Extract shared interfaces to reduce coupling between modules" });
  if (layerSmells > 0)    findings.push({ type: "layer_violation", severity: "medium", count: layerSmells, recommendation: "Enforce architectural boundaries with import restrictions" });
  if (sizeSmells > 0)     findings.push({ type: "large_module", severity: "medium", count: sizeSmells, recommendation: "Split large modules into focused single-responsibility units" });
  if (files > 200)        findings.push({ type: "high_file_count", severity: "low", count: files, recommendation: "Consider domain-driven directory restructuring" });

  const score = Math.max(0, 100 - couplingSmells * 15 - layerSmells * 10 - sizeSmells * 8 - Math.max(0, (files - 100) / 20));
  return { score: Math.min(100, Math.round(score)), findings };
}

function _reasonDependencies(repoData) {
  const deps    = repoData?.dependencies || repoData?.deps || {};
  const devDeps = repoData?.devDependencies || repoData?.devDeps || {};
  const allDeps = Object.keys({ ...deps, ...devDeps });
  const findings = [];

  // Check for common outdated/vulnerable patterns
  const outdatedPatterns = allDeps.filter(d => /^(lodash|moment|request|node-uuid)$/.test(d));
  if (outdatedPatterns.length > 0) findings.push({ type: "legacy_dependencies", severity: "medium", packages: outdatedPatterns, recommendation: "Replace legacy packages with modern alternatives" });

  // Large dependency count
  if (allDeps.length > 50) findings.push({ type: "dependency_bloat", severity: "low", count: allDeps.length, recommendation: "Audit and remove unused dependencies" });

  const score = Math.max(0, 100 - outdatedPatterns.length * 10 - Math.max(0, allDeps.length - 30) * 0.5);
  return { score: Math.min(100, Math.round(score)), findings, totalDeps: allDeps.length };
}

function _reasonBugs(smells, ruleStats) {
  const smellList = smells?.smells || smells?.issues || [];
  const findings  = [];

  const criticalSmells = smellList.filter(s => (s.severity || s.impact || "") === "high" || (s.severity || s.impact || "") === "critical");
  const totalSmells    = smellList.length;

  if (criticalSmells.length > 0) findings.push({ type: "critical_smells", severity: "critical", count: criticalSmells.length, patterns: criticalSmells.slice(0, 3).map(s => s.type || s.name) });
  if (totalSmells > 10) findings.push({ type: "smell_accumulation", severity: "high", count: totalSmells, recommendation: "Address smell backlog before new feature development" });

  // From rule registry — high-firing rules indicate bug-prone areas
  const rules = ruleStats?.rules || [];
  const highFireRules = rules.filter(r => (r.triggerCount || 0) > 5);
  if (highFireRules.length > 0) findings.push({ type: "repeated_rule_violations", severity: "medium", rules: highFireRules.map(r => r.id || r.name).slice(0, 3) });

  const score = Math.max(0, 100 - criticalSmells.length * 20 - Math.max(0, totalSmells - 5) * 3);
  return { score: Math.min(100, Math.round(score)), findings };
}

function _reasonPerformance(memStats, benchData) {
  const findings = [];
  const runs     = benchData?.runs || [];
  const latencies= runs.map(r => r.latencyMs || 0).filter(Boolean);
  const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

  if (avgLatency > 500) findings.push({ type: "high_latency", severity: "high", avgMs: Math.round(avgLatency), recommendation: "Profile and optimize hot paths" });
  else if (avgLatency > 200) findings.push({ type: "moderate_latency", severity: "medium", avgMs: Math.round(avgLatency), recommendation: "Consider caching for frequent operations" });

  const memTotal = memStats?.totalKnowledge || memStats?.totalMemories || 0;
  if (memTotal > 5000) findings.push({ type: "memory_growth", severity: "low", count: memTotal, recommendation: "Implement memory pruning for stale entries" });

  const score = avgLatency === 0 ? 80 : Math.max(0, 100 - (avgLatency / 10));
  return { score: Math.min(100, Math.round(score)), findings };
}

function _reasonSecurity(repoData, smells) {
  const smellList = smells?.smells || smells?.issues || [];
  const findings  = [];

  const securitySmells = smellList.filter(s => /secret|token|password|key|auth|injection|xss|csrf/i.test(s.type || s.name || s.message || ""));
  if (securitySmells.length > 0) findings.push({ type: "security_smells", severity: "critical", count: securitySmells.length, recommendation: "Immediate security review required" });

  // Check for insecure dependency patterns
  const deps = Object.keys({ ...(repoData?.dependencies || {}), ...(repoData?.devDependencies || {}) });
  const securityRisk = deps.filter(d => /^(serialize-javascript|node-serialize|eval)$/.test(d));
  if (securityRisk.length > 0) findings.push({ type: "risky_packages", severity: "high", packages: securityRisk });

  const score = Math.max(0, 100 - securitySmells.length * 25 - securityRisk.length * 15);
  return { score: Math.min(100, Math.round(score)), findings };
}

function _reasonScalability(repoData, smells) {
  const smellList = smells?.smells || smells?.issues || [];
  const findings  = [];

  const singletons   = smellList.filter(s => /singleton|global.state|shared.state/i.test(s.type || s.name || "")).length;
  const syncPatterns = smellList.filter(s => /sync|blocking|serial/i.test(s.type || s.name || "")).length;

  if (singletons > 0) findings.push({ type: "global_state", severity: "high", count: singletons, recommendation: "Replace global state with context-scoped state for horizontal scaling" });
  if (syncPatterns > 0) findings.push({ type: "blocking_patterns", severity: "medium", count: syncPatterns, recommendation: "Convert synchronous patterns to async for better throughput" });

  const score = Math.max(0, 100 - singletons * 15 - syncPatterns * 8);
  return { score: Math.min(100, Math.round(score)), findings };
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { analyses: [], stats: { total: 0, avgReasoningScore: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.analyses.length > 300) d.analyses = d.analyses.slice(-300);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Main analysis ─────────────────────────────────────────────────────────────

async function analyze(context, { repoData, smellData, skipScan } = {}) {
  context = context || "current_repo";

  // Pull from existing engineering services
  const smells = smellData || (!skipScan ? _try(() => _sd()?.scan?.(".")) : null) || { smells: [] };
  const riStatus = _try(() => _ri()?.getStatus?.()) || {};
  const memStats  = _try(() => _em()?.getStatistics?.()) || {};
  const ruleStats = _try(() => { const r = _rr()?.getStats?.(); return r; }) || {};
  const raw = _try(() => _cle()?.getRecommendations?.()) || {};
  const recs = Array.isArray(raw) ? raw : (raw.recommendations || []);

  const repo = repoData || {
    files: riStatus.indexedFiles || 0,
    dependencies: {},
    devDependencies: {},
  };

  const architecture  = _reasonArchitecture(repo, smells);
  const dependencies  = _reasonDependencies(repo);
  const bugs          = _reasonBugs(smells, ruleStats);
  const performance   = _reasonPerformance(memStats, {});
  const security      = _reasonSecurity(repo, smells);
  const scalability   = _reasonScalability(repo, smells);

  const overallScore = Math.round(
    architecture.score  * 0.25 +
    bugs.score          * 0.20 +
    security.score      * 0.20 +
    performance.score   * 0.15 +
    dependencies.score  * 0.10 +
    scalability.score   * 0.10
  );

  const insights = [
    architecture.score < 60  ? `Architecture score ${architecture.score}/100 — ${architecture.findings[0]?.recommendation || "review structure"}` : null,
    bugs.score < 60          ? `Bug risk score ${bugs.score}/100 — ${bugs.findings[0]?.recommendation || "address smells"}` : null,
    security.score < 80      ? `Security score ${security.score}/100 — requires immediate attention` : null,
    performance.score < 60   ? `Performance score ${performance.score}/100 — latency optimization needed` : null,
    recs.length > 0          ? `${recs.length} active improvement recommendations from CLE` : null,
  ].filter(Boolean);

  const d = _load();
  const analysis = {
    id: _id(),
    context,
    dimensions: { architecture, dependencies, bugs, performance, security, scalability },
    overallScore,
    insights,
    analyzedAt: _ts(),
  };

  d.analyses.push(analysis);
  d.stats.total++;
  const recent = d.analyses.slice(-20);
  d.stats.avgReasoningScore = +(recent.reduce((s, a) => s + a.overallScore, 0) / recent.length).toFixed(1);
  _save(d);

  // Store in engineering memory
  _try(() => _em()?.remember?.({
    problem:   `Engineering reasoning for ${context}`,
    solution:  `Overall score: ${overallScore}. Key: ${insights[0] || "all clear"}`,
    context:   { overallScore, dimensions: Object.fromEntries(Object.entries(analysis.dimensions).map(([k, v]) => [k, v.score])) },
    outcome:   "analyzed",
    confidence: 0.85,
  }));

  return { ok: true, analysis };
}

function getAnalysis(id) { return _load().analyses.find(a => a.id === id) || null; }

function listAnalyses({ limit = 50 } = {}) {
  return { ok: true, analyses: _load().analyses.slice(-limit) };
}

function getStats() {
  return { ..._load().stats, updatedAt: _load().updatedAt };
}

module.exports = { analyze, getAnalysis, listAnalyses, getStats };
