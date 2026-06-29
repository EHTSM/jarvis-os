"use strict";
/**
 * organizationCapabilityExchangeEngine.cjs — POST-Ω P20 Artificial Organization Network
 *
 * Automatically discovers which organization is best suited for any mission or task.
 * Tracks all capabilities across all registered orgs. Does not implement capabilities —
 * only routes and matches.
 *
 * Reuses: organizationRegistryEngine, selfImprovementEngine, engineeringBenchmarkEngine,
 *         businessReasoningEngine, knowledgeFederationEngine, riskAssessmentEngine.
 *
 * Storage: data/org-capability-exchange.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "org-capability-exchange.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _reg  = () => _try(() => require("./organizationRegistryEngine.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _eng  = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));
const _biz  = () => _try(() => require("./businessReasoningEngine.cjs"));
const _kfe  = () => _try(() => require("./knowledgeFederationEngine.cjs"));
const _risk = () => _try(() => require("./riskAssessmentEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `cap_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const EXCHANGE_EVENT_TYPES = [
  "capability_discovered",
  "best_org_matched",
  "capability_gap_detected",
  "capability_overlap_resolved",
];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { capabilities: {}, events: [], gapDetections: [] };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (typeof d.capabilities !== "object") return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.events.length > 2000) d.events = d.events.slice(-2000);
  if (d.gapDetections.length > 500) d.gapDetections = d.gapDetections.slice(-500);
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Capability Discovery ──────────────────────────────────────────────────────

function discoverCapabilities() {
  const reg = _reg();
  if (!reg) return { ok: false, error: "Registry unavailable" };

  const orgs = reg.listOrgs({ status: "active" });
  const capMap = {};

  orgs.orgs.forEach(org => {
    (org.capabilities || []).forEach(cap => {
      if (!capMap[cap]) capMap[cap] = [];
      if (!capMap[cap].includes(org.id)) capMap[cap].push(org.id);
    });
  });

  // Augment with intelligence from existing services
  const siePatterns = _sie()?.getPatterns?.() || [];
  siePatterns.forEach(p => {
    if (p.promoted && p.capability) {
      if (!capMap[p.capability]) capMap[p.capability] = [];
      capMap[p.capability].push("org_evolution");
    }
  });

  const d = _load();
  const previous = Object.keys(d.capabilities);
  const current  = Object.keys(capMap);
  const newCaps  = current.filter(c => !previous.includes(c));

  d.capabilities = capMap;
  newCaps.forEach(cap => {
    d.events.push({ id: _id(), type: "capability_discovered", cap, orgs: capMap[cap], ts: _ts() });
  });
  _save(d);

  return {
    ok:              true,
    total:           current.length,
    newlyDiscovered: newCaps.length,
    capabilities:    capMap,
    orgsCovered:     orgs.total,
  };
}

// ── Best-Org Matching ─────────────────────────────────────────────────────────

function findBestOrg({ goal, requiredCapabilities = [] }) {
  if (!goal && requiredCapabilities.length === 0) {
    return { ok: false, error: "goal or requiredCapabilities required" };
  }

  const reg = _reg();
  if (!reg) return { ok: false, error: "Registry unavailable" };

  const d    = _load();
  const orgs = reg.listOrgs({ status: "active" }).orgs;

  // Build keyword set from goal
  const keywords = (goal || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(" ").filter(Boolean);

  const scored = orgs.map(org => {
    let score = org.networkScore || 0;
    const orgCaps = (org.capabilities || []).map(c => c.toLowerCase());

    // Required capabilities match
    requiredCapabilities.forEach(rc => {
      if (orgCaps.some(c => c.includes(rc.toLowerCase()))) score += 20;
    });

    // Keyword match against org name + capabilities
    keywords.forEach(kw => {
      if (org.name.toLowerCase().includes(kw)) score += 5;
      if (orgCaps.some(c => c.includes(kw))) score += 10;
    });

    // Trust bonus
    const trustBonus = { certified: 30, trusted: 15, provisional: 5, untrusted: 0 };
    score += trustBonus[org.trustLevel] || 0;

    return { org, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 20) {
    d.gapDetections.push({ id: _id(), goal, requiredCapabilities, ts: _ts() });
    d.events.push({ id: _id(), type: "capability_gap_detected", goal, requiredCapabilities, ts: _ts() });
    _save(d);
    return { ok: false, error: "No suitable org found", gap: true };
  }

  d.events.push({ id: _id(), type: "best_org_matched", orgId: best.org.id, goal, score: best.score, ts: _ts() });
  _save(d);

  return {
    ok:           true,
    best:         { ...best.org, matchScore: best.score },
    alternatives: scored.slice(1, 3).map(s => ({ ...s.org, matchScore: s.score })),
    allScores:    scored.slice(0, 5).map(s => ({ orgId: s.org.id, name: s.org.name, score: s.score })),
  };
}

// ── Gap Detection ─────────────────────────────────────────────────────────────

function detectGaps() {
  const d = _load();
  const gaps = [];

  // Risk-driven gap detection
  const riskResult = _risk()?.assess?.() || { risks: [] };
  (riskResult.risks || []).forEach(risk => {
    if (risk.category && !d.capabilities[risk.category]) {
      gaps.push({ category: risk.category, severity: risk.severity, source: "risk_engine" });
    }
  });

  // Benchmark-driven gap detection
  const baseline = _eng()?.ENGINEERING_BASELINE || {};
  Object.entries(baseline).forEach(([key]) => {
    if (!d.capabilities[key]) {
      gaps.push({ category: key, severity: "medium", source: "benchmark_engine" });
    }
  });

  if (gaps.length > 0) {
    d.gapDetections.push(...gaps.map(g => ({ id: _id(), ...g, ts: _ts() })));
    _save(d);
  }

  return { ok: true, gaps, total: gaps.length };
}

function getAllCapabilities() {
  const d = _load();
  const reg = _reg();
  const orgs = reg?.listOrgs({ status: "active" }).orgs || [];

  return {
    ok: true,
    capabilities:        d.capabilities,
    totalCapabilities:   Object.keys(d.capabilities).length,
    totalOrgs:           orgs.length,
    capabilityDensity:   orgs.length > 0
      ? Math.round(Object.keys(d.capabilities).length / orgs.length)
      : 0,
    gapsDetected:        d.gapDetections.length,
    recentEvents:        d.events.slice(-10),
  };
}

function resolveOverlap(capability) {
  const d = _load();
  const providers = d.capabilities[capability] || [];
  if (providers.length <= 1) return { ok: true, resolved: false, providers };

  const reg = _reg();
  const orgs = providers.map(id => reg?.getOrg(id)).filter(Boolean);
  const best = orgs.sort((a, b) => (b.networkScore || 0) - (a.networkScore || 0))[0];

  d.events.push({ id: _id(), type: "capability_overlap_resolved", capability, providerId: best?.id, ts: _ts() });
  _save(d);

  return { ok: true, resolved: true, capability, primaryProvider: best, allProviders: providers };
}

module.exports = {
  EXCHANGE_EVENT_TYPES,
  discoverCapabilities,
  findBestOrg,
  detectGaps,
  getAllCapabilities,
  resolveOverlap,
};
