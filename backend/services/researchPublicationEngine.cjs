"use strict";
/**
 * researchPublicationEngine.cjs — POST-Ω Sprint P10 Autonomous Research Institute
 *
 * Generates and publishes internal research papers:
 *   - assembles findings from researchKnowledgeEngine + experimentManager
 *   - formats as structured internal research documents
 *   - pushes to continuousLearningEngine and engineeringMemoryEngine
 *   - archives publication history
 *   - generates platform evolution recommendations
 *
 * Reuses: researchKnowledgeEngine, experimentManager, researchPlanner,
 *         continuousLearningEngine, engineeringMemoryEngine.
 *
 * Storage: data/research-publications.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "research-publications.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _rke = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _em  = () => _try(() => require("./experimentManager.cjs"));
const _rp  = () => _try(() => require("./researchPlanner.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _eme = () => _try(() => require("./engineeringMemoryEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `pub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ── Publication types ─────────────────────────────────────────────────────────

const PUBLICATION_TYPES = [
  "research_paper",        // formal finding with methodology and results
  "benchmark_report",      // benchmark comparison across runs
  "technology_assessment", // technology radar update + rationale
  "experiment_summary",    // experiment design, run, and validation
  "evolution_proposal",    // platform evolution recommendation
  "weekly_digest",         // aggregated weekly research digest
];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      publications: [],
      evolutionQueue: [],   // approved recommendations awaiting implementation
      stats: { totalPublished: 0, papersGenerated: 0, evolutionProposals: 0, minutesSaved: 0 },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.publications.length  > 300) d.publications  = d.publications.slice(-300);
  if (d.evolutionQueue.length > 100) d.evolutionQueue = d.evolutionQueue.slice(-100);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Research paper generation ─────────────────────────────────────────────────

function generatePaper({ planId, title, abstract, domain, sections = [], findings = [], experiments = [] } = {}) {
  if (!title) return { ok: false, error: "title required" };

  // Pull findings from knowledge engine
  const knowledgeFindings = _rke()?.getFindings?.({ domain, limit: 5 })?.findings || [];
  const allFindings = [...findings, ...knowledgeFindings.map(f => f.finding)].filter(Boolean);

  // Pull experiments
  const runExperiments = planId
    ? _em()?.listExperiments?.({ planId, status: "completed" })?.experiments || []
    : experiments;

  // Assemble sections
  const fullSections = sections.length > 0 ? sections : [
    { heading: "Abstract",      content: abstract || `Research investigation into ${domain || "platform improvements"}.` },
    { heading: "Methodology",   content: "16-step autonomous research pipeline: Observe → Identify → Research → Benchmark → Hypothesize → Experiment → Validate → Publish." },
    { heading: "Findings",      content: allFindings.length > 0 ? allFindings.join(" ") : "No significant deviations from baseline detected." },
    { heading: "Experiments",   content: runExperiments.length > 0
        ? runExperiments.map(e => `[${e.name}] ${e.results?.overallImprovement ? "Improvement validated" : "No improvement"} (confidence=${e.results?.confidence ?? "N/A"})`).join("; ")
        : "No experiments executed in this research cycle." },
    { heading: "Recommendations", content: (_rke()?.generateRecommendations?.({ domain })?.recommendations || []).slice(0,3).map(r => r.recommendation).join(" ") || "Continue monitoring." },
    { heading: "Conclusion",    content: `Research cycle complete. ${allFindings.length} findings indexed. ${runExperiments.length} experiments run.` },
  ];

  const d = _load();
  const pub = {
    id:         _id(),
    planId:     planId || null,
    type:       "research_paper",
    title,
    domain:     domain || "general",
    abstract:   abstract || fullSections[0]?.content,
    sections:   fullSections,
    findings:   allFindings,
    experiments: runExperiments.map(e => e.id || e),
    wordCount:  fullSections.reduce((sum, s) => sum + (s.content || "").split(" ").length, 0),
    publishedAt: _ts(),
    minutesSaved: 45,   // estimated time saved vs manual research
  };

  d.publications.push(pub);
  d.stats.totalPublished++;
  d.stats.papersGenerated++;
  d.stats.minutesSaved += pub.minutesSaved;
  _save(d);

  // Publish to learning engine
  _try(() => _cle()?.createLesson?.({
    type:   "research_publication",
    title:  pub.title,
    source: "researchPublicationEngine",
    confidence: 0.85,
    tags:   ["research", "publication", domain || "general"],
    metadata: { planId, paperId: pub.id },
  }));

  // Publish to memory
  _try(() => _eme()?.remember?.({
    type: "research_paper", confidence: 0.85,
    content: `[Research Paper] ${pub.title}: ${pub.abstract}`,
    tags: ["research", "paper", domain || "general"],
  }));

  return { ok: true, publication: pub };
}

// ── Benchmark report ──────────────────────────────────────────────────────────

function generateBenchmarkReport({ targets, planId } = {}) {
  const bm      = _try(() => require("./benchmarkEngine.cjs"));
  const results = {};

  for (const t of (targets || [])) {
    const history = bm?.getHistory?.(t, 5);
    if (history?.ok) results[t] = history.history;
  }

  const title = `Benchmark Report: ${(targets || []).join(", ") || "All Targets"}`;
  const d = _load();
  const pub = {
    id:         _id(),
    planId:     planId || null,
    type:       "benchmark_report",
    title,
    targets:    targets || [],
    results,
    publishedAt: _ts(),
    minutesSaved: 30,
  };

  d.publications.push(pub);
  d.stats.totalPublished++;
  d.stats.minutesSaved += pub.minutesSaved;
  _save(d);

  return { ok: true, publication: pub };
}

// ── Evolution proposal ────────────────────────────────────────────────────────

function proposeEvolution({ planId, domain, recommendation, confidence = 0.8, effort = "medium", impact = "high" } = {}) {
  if (!recommendation) return { ok: false, error: "recommendation required" };

  const d = _load();
  const proposal = {
    id:             _id(),
    planId:         planId || null,
    type:           "evolution_proposal",
    title:          `Evolution Proposal: ${domain || "platform"}`,
    domain,
    recommendation,
    confidence,
    effort,          // low/medium/high
    impact,          // low/medium/high
    status:          "proposed",
    publishedAt:     _ts(),
    minutesSaved:    60,
  };

  d.publications.push(proposal);
  d.evolutionQueue.push({ proposalId: proposal.id, domain, recommendation, confidence, effort, impact, ts: _ts() });
  d.stats.totalPublished++;
  d.stats.evolutionProposals++;
  d.stats.minutesSaved += proposal.minutesSaved;
  _save(d);

  // Notify CLE
  _try(() => _cle()?.createLesson?.({
    type: "evolution_proposal", title: proposal.title,
    source: "researchPublicationEngine", confidence,
    tags: ["evolution", "proposal", domain || "platform"],
    metadata: { proposalId: proposal.id, effort, impact },
  }));

  return { ok: true, proposal };
}

// ── Weekly digest ─────────────────────────────────────────────────────────────

function generateDigest() {
  const d = _load();

  // Recent publications (last 7 days)
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recent = d.publications.filter(p => p.publishedAt >= cutoff);

  // Recent experiments
  const experiments = _em()?.listExperiments?.({ limit: 5, status: "completed" })?.experiments || [];

  // Open evolution proposals
  const openProposals = d.evolutionQueue.filter(p => p.ts >= cutoff);

  const digest = {
    id:          _id(),
    type:        "weekly_digest",
    title:       `Weekly Research Digest — ${new Date().toDateString()}`,
    period:      { from: cutoff, to: _ts() },
    publications: recent.length,
    experiments:  experiments.length,
    evolutionProposals: openProposals.length,
    highlights:  recent.slice(-3).map(p => ({ title: p.title, type: p.type })),
    publishedAt: _ts(),
    minutesSaved: 20,
  };

  d.publications.push(digest);
  d.stats.totalPublished++;
  _save(d);

  return { ok: true, digest };
}

// ── Queries ───────────────────────────────────────────────────────────────────

function getPublication(id) {
  return _load().publications.find(p => p.id === id) || null;
}

function listPublications({ type, domain, planId, limit = 50 } = {}) {
  let pubs = _load().publications;
  if (type)   pubs = pubs.filter(p => p.type === type);
  if (domain) pubs = pubs.filter(p => p.domain === domain);
  if (planId) pubs = pubs.filter(p => p.planId === planId);
  return { ok: true, publications: pubs.slice(-limit) };
}

function getEvolutionQueue({ limit = 50 } = {}) {
  return { ok: true, queue: _load().evolutionQueue.slice(-limit) };
}

function getStats() {
  const d = _load();
  const byType = {};
  for (const p of d.publications) byType[p.type] = (byType[p.type] || 0) + 1;
  return { ...d.stats, byType, total: d.publications.length, updatedAt: d.updatedAt };
}

module.exports = {
  PUBLICATION_TYPES,
  generatePaper,
  generateBenchmarkReport,
  proposeEvolution,
  generateDigest,
  getPublication,
  listPublications,
  getEvolutionQueue,
  getStats,
};
