"use strict";
/**
 * publicationEngine.cjs — POST-Ω P18 Scientific Discovery Engine
 *
 * Generates scientific publications from validated discoveries:
 *   technical papers, benchmark reports, architecture reports, evolution proposals.
 *
 * Pipeline stages: Publish → Standardize → Learn
 *
 * Reuses: experimentOrchestratorEngine, hypothesisEngine,
 *         researchKnowledgeEngine, innovationEngine (lazy),
 *         selfImprovementEngine, engineeringBenchmarkEngine,
 *         evolutionReasoningEngine, knowledgeFederationEngine.
 *
 * Storage: data/scientific-publications.json (separate from data/research-publications.json)
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "scientific-publications.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _eoe  = () => _try(() => require("./experimentOrchestratorEngine.cjs"));
const _hyp  = () => _try(() => require("./hypothesisEngine.cjs"));
const _rke  = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _eb   = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));
const _ose  = () => _try(() => require("./evolutionReasoningEngine.cjs"));
const _kfe  = () => _try(() => require("./knowledgeFederationEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `pub_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const PUBLICATION_TYPES = [
  "technical_paper",
  "benchmark_report",
  "architecture_report",
  "evolution_proposal",
];

const PUBLICATION_STATUSES = [
  "draft",
  "review",
  "published",
  "standardized",
];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = {
    publications: [],
    queue: [],
    stats: { total: 0, published: 0, standardized: 0, byType: {} },
    updatedAt: null,
  };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.publications)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.publications.length > 500) d.publications = d.publications.slice(-500);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Paper generators ──────────────────────────────────────────────────────────

function _generateTechnicalPaper(experiment, hypothesis) {
  const bench = _try(() => _eb()?.ENGINEERING_BASELINE) || {};
  const patterns = _try(() => _sie()?.discoverPatterns?.()?.patterns || []) || [];

  return {
    title:    `${hypothesis.domain.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())} Discovery: ${hypothesis.statement.slice(0,60)}`,
    abstract: `This paper presents findings from a controlled experiment testing the hypothesis: "${hypothesis.statement}". Analysis of ${experiment.evidenceCount} evidence points yielded outcome: ${experiment.outcome} (confidence: ${experiment.confidence}%). ${experiment.analysis?.summary || ''}`,
    sections: [
      {
        heading: "1. Introduction",
        body:    `Platform telemetry revealed a researchable pattern in the ${hypothesis.domain} domain. The hypothesis was generated from source: ${hypothesis.source}.`,
      },
      {
        heading: "2. Hypothesis",
        body:    `${hypothesis.statement}\n\nMeasurable: ${hypothesis.measurable}\nFalsifiable: ${hypothesis.falsifiable}`,
      },
      {
        heading: "3. Methodology",
        body:    `Experiment type: before-after analysis. Evidence collected from ${experiment.evidenceCount} platform sources. Execution mode: automated via Autonomous Execution Engine.`,
      },
      {
        heading: "4. Results",
        body:    experiment.analysis?.summary || `Outcome: ${experiment.outcome} with ${experiment.confidence}% confidence.`,
      },
      {
        heading: "5. Conclusions",
        body:    experiment.outcome === "hypothesis_supported"
          ? `The hypothesis is supported. Platform improvements identified: apply changes to ${hypothesis.domain} layer.`
          : `The hypothesis requires further investigation. Follow-up experiment recommended.`,
      },
      {
        heading: "6. Platform Impact",
        body:    `Current engineering baseline: ${JSON.stringify(bench).slice(0,200)}. Open patterns: ${patterns.length}.`,
      },
    ],
    references: [
      "Research Knowledge Engine findings index",
      "Engineering Benchmark Engine baselines",
      "Self-Improvement Engine pattern catalogue",
    ],
    wordCount: 450,
  };
}

function _generateBenchmarkReport(experiment) {
  const bench = _try(() => _eb()?.runEngineeringBenchmark?.()) || {};
  return {
    title:    `Benchmark Report: ${experiment.domain} Experiment ${experiment.id.slice(-4)}`,
    abstract: `Benchmarks collected during scientific experiment ${experiment.id}. Outcome: ${experiment.outcome}.`,
    sections: [
      { heading: "Benchmark Baseline", body: JSON.stringify(_eb()?.ENGINEERING_BASELINE || {}, null, 2) },
      { heading: "Post-Experiment Snapshot", body: JSON.stringify(bench, null, 2).slice(0, 500) },
      { heading: "Delta Analysis", body: `Confidence: ${experiment.confidence}%. Evidence items: ${experiment.evidenceCount}.` },
      { heading: "Recommendations", body: experiment.outcome === "hypothesis_supported"
          ? "Apply hypothesis-derived improvements to production pipeline."
          : "Collect additional benchmark data before proceeding." },
    ],
    wordCount: 250,
  };
}

function _generateArchitectureReport(experiment, hypothesis) {
  return {
    title:    `Architecture Report: ${hypothesis.domain} Impact Analysis`,
    abstract: `Analysis of architectural implications from experiment ${experiment.id}.`,
    sections: [
      {
        heading: "Architecture Scope",
        body:    `Domain: ${hypothesis.domain}. Services affected: discoveryPlannerEngine, hypothesisEngine, experimentOrchestratorEngine, publicationEngine, innovationEngine, scientificDiscoveryDashboard.`,
      },
      {
        heading: "Reuse Impact",
        body:    "No new organizations, runtimes, schedulers, or event buses introduced. Pure orchestration layer over existing infrastructure.",
      },
      {
        heading: "Evolution Proposal",
        body:    hypothesis.statement,
      },
      {
        heading: "Risk Assessment",
        body:    `Experiment confidence: ${experiment.confidence}%. Risk: low (adapter-only changes, no core modifications).`,
      },
    ],
    wordCount: 300,
  };
}

function _generateEvolutionProposal(experiment, hypothesis) {
  const ose = _try(() => _ose()?.analyze?.()) || {};
  return {
    title:    `Evolution Proposal: ${hypothesis.statement.slice(0, 60)}`,
    abstract: `Validated discovery drives evolution proposal for the ${hypothesis.domain} domain. Confidence: ${experiment.confidence}%.`,
    sections: [
      { heading: "Proposed Evolution", body: hypothesis.statement },
      { heading: "Evidence Base",      body: `${experiment.evidenceCount} evidence points. Outcome: ${experiment.outcome}.` },
      { heading: "Implementation Path", body: `1. Apply to ${hypothesis.domain} layer.\n2. Re-run benchmark to validate.\n3. Promote to engineering rules if validated.` },
      { heading: "OSE Analysis",       body: JSON.stringify(ose).slice(0, 300) || "Evolution reasoning engine analysis pending." },
      { heading: "Success Criteria",   body: hypothesis.measurable },
    ],
    wordCount: 280,
  };
}

// ── Core: publish ─────────────────────────────────────────────────────────────

function publish(experimentId, types = PUBLICATION_TYPES) {
  const experiment = _eoe()?.getExperiment?.(experimentId);
  if (!experiment) return { ok: false, error: `Experiment ${experimentId} not found` };

  const hypothesis = experiment.hypothesisId
    ? (_hyp()?.getHypothesis?.(experiment.hypothesisId) || {})
    : { domain: experiment.domain, statement: experiment.hypothesisStatement || "", source: "platform", measurable: "", falsifiable: "" };

  const publications = types.map(type => {
    let content;
    switch (type) {
      case "technical_paper":      content = _generateTechnicalPaper(experiment, hypothesis); break;
      case "benchmark_report":     content = _generateBenchmarkReport(experiment); break;
      case "architecture_report":  content = _generateArchitectureReport(experiment, hypothesis); break;
      case "evolution_proposal":   content = _generateEvolutionProposal(experiment, hypothesis); break;
      default:                     content = { title: `${type} for ${experimentId}`, sections: [], wordCount: 0 };
    }
    return {
      id:           _id(),
      type,
      experimentId,
      hypothesisId: experiment.hypothesisId,
      domain:       experiment.domain,
      outcome:      experiment.outcome,
      confidence:   experiment.confidence,
      content,
      status:       "published",
      publishedAt:  _ts(),
      standardizedAt: null,
    };
  });

  // Standardize: index in RKE
  publications.forEach(pub => {
    try {
      _rke()?.publishKnowledge?.({
        type:       pub.type,
        title:      pub.content.title,
        domain:     pub.domain,
        abstract:   pub.content.abstract,
        confidence: pub.confidence,
        source:     "scientificDiscoveryEngine",
        publishedAt: pub.publishedAt,
      });
      pub.status         = "standardized";
      pub.standardizedAt = _ts();
    } catch {}
  });

  const d = _load();
  const dedup = new Map(d.publications.map(p => [`${p.type}:${p.experimentId}`, p]));
  publications.forEach(p => dedup.set(`${p.type}:${p.experimentId}`, p));
  d.publications = [...dedup.values()];

  const byType = {};
  PUBLICATION_TYPES.forEach(t => { byType[t] = 0; });
  d.publications.forEach(p => { if (byType[p.type] !== undefined) byType[p.type]++; });
  d.stats = {
    total:        d.publications.length,
    published:    d.publications.filter(p => p.status === "published" || p.status === "standardized").length,
    standardized: d.publications.filter(p => p.status === "standardized").length,
    byType,
  };
  _save(d);

  return { ok: true, published: publications.length, total: d.publications.length, publications };
}

function queueForPublication(experimentId) {
  const d = _load();
  if (!d.queue.includes(experimentId)) d.queue.push(experimentId);
  _save(d);
  return { ok: true, queued: experimentId, queueLength: d.queue.length };
}

function processQueue() {
  const d = _load();
  if (d.queue.length === 0) return { ok: true, processed: 0 };
  const batch = d.queue.splice(0, 5);
  d.queue = d.queue.slice(5);
  _save(d);
  const results = batch.map(id => publish(id));
  return { ok: true, processed: batch.length, results };
}

function getPublication(id) {
  return _load().publications.find(p => p.id === id) || null;
}

function listPublications({ type, domain, status, limit = 50 } = {}) {
  let items = _load().publications;
  if (type)   items = items.filter(p => p.type === type);
  if (domain) items = items.filter(p => p.domain === domain);
  if (status) items = items.filter(p => p.status === status);
  return { ok: true, publications: items.slice(0, limit), total: items.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, queueLength: d.queue.length, PUBLICATION_TYPES, PUBLICATION_STATUSES, updatedAt: d.updatedAt };
}

module.exports = {
  PUBLICATION_TYPES,
  PUBLICATION_STATUSES,
  publish,
  queueForPublication,
  processQueue,
  getPublication,
  listPublications,
  getStats,
};
