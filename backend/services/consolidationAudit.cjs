"use strict";
/**
 * consolidationAudit.cjs — POST-Ω Sprint P1
 *
 * Static analysis of the repository to track:
 *   - duplicate services (same capability, multiple files)
 *   - placeholder / mock logic
 *   - dead routes (mounted but no real logic)
 *   - phase file route counts vs canonical coverage
 *   - architectural overlap
 *
 * Reads files directly — no new infrastructure.
 * Produces a structured audit report saved to data/consolidation-audit.json.
 */

const fs   = require("fs");
const path = require("path");

const ROOT     = path.join(__dirname, "../../");
const SVC_DIR  = path.join(ROOT, "backend/services");
const RTE_DIR  = path.join(ROOT, "backend/routes");
const DATA_FILE = path.join(ROOT, "data/consolidation-audit.json");

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { audits: [], lastAuditAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

// ── Duplicate detection ───────────────────────────────────────────────────────

const KNOWN_DUPLICATES = [
  {
    id:       "automationService_dual_format",
    files:    ["backend/services/automationService.js", "backend/services/automationService.cjs"],
    category: "naming_collision",
    severity: "medium",
    note:     "Two separate automation systems with same base name. .js = WhatsApp follow-up engine. .cjs = rule-based automation. Different capabilities — rename to clarify, not merge.",
    action:   "Rename automationService.js → whatsappAutomation.js to eliminate confusion",
    resolved: false,
  },
  {
    id:       "phase_routes_overlap",
    files:    ["backend/routes/phase18.js","backend/routes/phase19.js","backend/routes/phase20.js","backend/routes/phase21.js","backend/routes/phase22.js","backend/routes/phase23.js","backend/routes/phase24.js","backend/routes/phase25.js","backend/routes/phase26.js","backend/routes/phase27.js"],
    category: "architectural_overlap",
    severity: "low",
    note:     "Phase routes (p18-p27) expose unique capabilities under /pNN/* namespace. Not duplicate of named routes — they route to different underlying services. Low priority: deprecation headers already added in index.js for /p18-/p22.",
    action:   "Add deprecation headers to p23-p27; document canonical migration paths. No removal until client audit complete.",
    resolved: false,
  },
  {
    id:       "production_wiring_dual",
    files:    ["backend/services/productionWiring.cjs","backend/services/productionWiring2.cjs"],
    category: "versioned_duplicate",
    severity: "low",
    note:     "Sprint 1 vs Sprint 2 audits. Sprint 2 extends Sprint 1 checks. No overlap in checks performed — Sprint 1 covers AI/Payments/Email/OAuth/WhatsApp/Browser; Sprint 2 adds SMTP/Monitoring/Storage/E2E.",
    action:   "Consider merging into single productionWiring.cjs with version flag. Non-urgent.",
    resolved: false,
  },
];

// ── Placeholder scanner ───────────────────────────────────────────────────────

const PLACEHOLDER_PATTERNS = [
  { pattern: /\/\/.*TODO/g,              label: "TODO comment" },
  { pattern: /\/\/.*FIXME/g,             label: "FIXME comment" },
  { pattern: /placeholder/gi,            label: "placeholder" },
  { pattern: /not implemented/gi,        label: "not-implemented" },
  { pattern: /\/\/.*\bstub\b/gi,         label: "stub comment" },
  { pattern: /return\s*\{\s*ok:\s*true\s*\};\s*\/\//g, label: "trivial ok stub" },
];

function _scanPlaceholders(dir, ext = [".cjs",".js"]) {
  const findings = [];
  let files;
  try { files = fs.readdirSync(dir).filter(f => ext.some(e => f.endsWith(e))); }
  catch { return findings; }

  for (const fname of files) {
    const fpath = path.join(dir, fname);
    let src;
    try { src = fs.readFileSync(fpath, "utf8"); } catch { continue; }

    const filePath = path.relative(ROOT, fpath);
    const counts   = {};
    let total = 0;

    for (const { pattern, label } of PLACEHOLDER_PATTERNS) {
      const matches = (src.match(pattern) || []).length;
      if (matches > 0) { counts[label] = matches; total += matches; }
    }

    if (total > 0) {
      findings.push({ file: filePath, total, breakdown: counts });
    }
  }

  return findings.sort((a, b) => b.total - a.total);
}

// ── Dead code detection ───────────────────────────────────────────────────────

function _findUnmountedRoutes() {
  // Routes in backend/routes/ that are NOT required in index.js
  let indexSrc;
  try { indexSrc = fs.readFileSync(path.join(RTE_DIR, "index.js"), "utf8"); }
  catch { return []; }

  let routeFiles;
  try { routeFiles = fs.readdirSync(RTE_DIR).filter(f => f.endsWith(".js") && f !== "index.js"); }
  catch { return []; }

  return routeFiles.filter(f => {
    const base = path.basename(f, ".js");
    return !indexSrc.includes(`"./routes/${base}"`) && !indexSrc.includes(`'./${base}'`) && !indexSrc.includes(`require("./${base}")`);
  });
}

function _findUnusedServices() {
  // Services in backend/services/ not required by any other file
  let svcFiles;
  try {
    svcFiles = fs.readdirSync(SVC_DIR)
      .filter(f => f.endsWith(".cjs") || f.endsWith(".js"));
  } catch { return []; }

  // Build require index from all backend files
  const allSrc = [];
  const scanDirs = [
    path.join(ROOT, "backend/routes"),
    path.join(ROOT, "backend/services"),
    path.join(ROOT, "backend/controllers"),
    path.join(ROOT, "backend"),
    path.join(ROOT, "agents/runtime"),
  ];
  for (const sd of scanDirs) {
    try {
      const files = fs.readdirSync(sd).filter(f => f.endsWith(".js") || f.endsWith(".cjs"));
      for (const f of files) {
        try { allSrc.push(fs.readFileSync(path.join(sd, f), "utf8")); } catch {}
      }
    } catch {}
  }
  const combined = allSrc.join("\n");

  return svcFiles.filter(f => {
    const base = path.basename(f, path.extname(f));
    // Check if anything requires this service
    return !combined.includes(`require("./${f}")`) &&
           !combined.includes(`require("./${base}")`) &&
           !combined.includes(`require("./services/${base}")`) &&
           !combined.includes(`require("./services/${f}")`);
  }).slice(0, 30); // cap at 30 to avoid noise
}

// ── Main audit ────────────────────────────────────────────────────────────────

function runAudit() {
  const svcPlaceholders = _scanPlaceholders(SVC_DIR);
  const rteUnmounted    = _findUnmountedRoutes();
  const unusedServices  = _findUnusedServices();

  // Phase route stats
  const phaseStats = [];
  for (let n = 18; n <= 27; n++) {
    try {
      const src = fs.readFileSync(path.join(RTE_DIR, `phase${n}.js`), "utf8");
      const routes    = (src.match(/router\.(get|post|put|patch|delete)/g) || []).length;
      const deprecated = src.includes("deprecated") || src.includes("_deprecate");
      phaseStats.push({ file: `phase${n}.js`, routes, deprecated });
    } catch {}
  }

  // Count totals
  const totalPlaceholders = svcPlaceholders.reduce((s, f) => s + f.total, 0);
  const resolvedDuplicates = KNOWN_DUPLICATES.filter(d => d.resolved).length;
  const openDuplicates     = KNOWN_DUPLICATES.filter(d => !d.resolved).length;

  const audit = {
    id:          `audit_${Date.now()}`,
    createdAt:   new Date().toISOString(),
    summary: {
      openDuplicates,
      resolvedDuplicates,
      filesWithPlaceholders: svcPlaceholders.length,
      totalPlaceholderCount: totalPlaceholders,
      unmountedRouteFiles:   rteUnmounted.length,
      unusedServicesEstimate: unusedServices.length,
      phaseRouteFiles:       phaseStats.length,
      phaseRouteTotal:       phaseStats.reduce((s, p) => s + p.routes, 0),
    },
    duplicates:          KNOWN_DUPLICATES,
    placeholderFiles:    svcPlaceholders.slice(0, 20), // top 20
    unmountedRoutes:     rteUnmounted,
    unusedServices:      unusedServices,
    phaseStats,
    consolidationScore: Math.max(0, Math.min(100,
      100
      - openDuplicates * 10
      - Math.round(totalPlaceholders * 0.5)
      - rteUnmounted.length * 3
    )),
  };

  const d = _load();
  d.audits.push(audit);
  if (d.audits.length > 52) d.audits = d.audits.slice(-52);
  d.lastAuditAt = audit.createdAt;
  _save(d);

  return { ok: true, audit };
}

function getLatestAudit() {
  const audits = _load().audits;
  return audits.length > 0 ? audits[audits.length - 1] : null;
}

function listAudits({ limit = 10 } = {}) {
  return _load().audits.slice(-limit).reverse();
}

function markResolved(duplicateId) {
  const dup = KNOWN_DUPLICATES.find(d => d.id === duplicateId);
  if (!dup) return { ok: false, error: "unknown duplicate id" };
  dup.resolved = true;
  dup.resolvedAt = new Date().toISOString();
  return { ok: true, duplicate: dup };
}

function getConsolidationPlan() {
  return {
    openItems: KNOWN_DUPLICATES.filter(d => !d.resolved),
    resolvedItems: KNOWN_DUPLICATES.filter(d => d.resolved),
    nextSprint: {
      title: "Sprint P2 — Architecture Consolidation",
      priority: "high",
      items: [
        { action: "Rename automationService.js → whatsappAutomation.js", impact: "naming clarity", effort: "15min" },
        { action: "Add deprecation headers to phase23–27 routes", impact: "API clarity", effort: "30min" },
        { action: "Merge productionWiring + productionWiring2 checks", impact: "maintainability", effort: "2h" },
        { action: "Fix remaining placeholder logic in autonomousExecutionRuntime.cjs", impact: "reliability", effort: "4h" },
      ],
    },
    estimatedDebtReduction: "15-25 debt points after Sprint P2",
  };
}

module.exports = {
  runAudit,
  getLatestAudit,
  listAudits,
  markResolved,
  getConsolidationPlan,
  KNOWN_DUPLICATES,
};
