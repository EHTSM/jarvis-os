"use strict";
/**
 * ODI-28 Enterprise Design Review
 *
 * Aggregates scores from existing ODI services into a unified per-page
 * design review with executive report:
 *
 *   - UI Score:                  ODI-16 Vision QA
 *   - UX Score:                  ODI-12 UX Optimizer
 *   - Accessibility Score:       ODI-7  Accessibility Auditor
 *   - Consistency Score:         ODI-12 consistencyScore
 *   - Enterprise Readiness:      composite of all + brand + interaction
 *
 * Executive report: PDF-ready text + JSON suitable for dashboard display.
 * Storage: data/odi/reviews/
 */

const fs   = require("fs");
const path = require("path");

const REVIEW_DIR = path.join(__dirname, "../../data/odi/reviews");
function _ensureDir() { if (!fs.existsSync(REVIEW_DIR)) fs.mkdirSync(REVIEW_DIR, { recursive: true }); }

// ── Scoring ───────────────────────────────────────────────────────────────────

function _grade(score) {
  if (score >= 90) return { grade: "A", label: "Excellent" };
  if (score >= 80) return { grade: "B", label: "Good" };
  if (score >= 70) return { grade: "C", label: "Acceptable" };
  if (score >= 55) return { grade: "D", label: "Needs Work" };
  return { grade: "F", label: "Critical Issues" };
}

function _enterpriseScore(scores) {
  const { ui = 0, ux = 0, accessibility = 0, consistency = 0, brand = 0, interaction = 0 } = scores;
  // Enterprise clients weight accessibility and consistency more heavily
  return Math.round(
    ui           * 0.15 +
    ux           * 0.20 +
    accessibility * 0.25 +
    consistency  * 0.20 +
    brand        * 0.10 +
    interaction  * 0.10
  );
}

// ── Report generator ──────────────────────────────────────────────────────────

function _buildExecutiveReport(url, scores, findings) {
  const enterprise = _enterpriseScore(scores);
  const grade = _grade(enterprise);

  const lines = [
    `ENTERPRISE DESIGN REVIEW`,
    `========================`,
    `URL: ${url}`,
    `Date: ${new Date().toISOString().split("T")[0]}`,
    ``,
    `EXECUTIVE SUMMARY`,
    `-----------------`,
    `Enterprise Readiness Score: ${enterprise}/100 (${grade.grade} — ${grade.label})`,
    ``,
    `DIMENSION SCORES`,
    `----------------`,
  ];

  for (const [dim, val] of Object.entries(scores)) {
    const g = _grade(val);
    lines.push(`  ${dim.padEnd(20)} ${String(val).padStart(3)}/100  ${g.grade}  ${g.label}`);
  }

  lines.push(``, `TOP FINDINGS`, `------------`);
  const criticals = findings.filter(f => f.severity === "error").slice(0, 5);
  const warnings  = findings.filter(f => f.severity === "warning").slice(0, 5);

  if (criticals.length) {
    lines.push(`Critical Issues (${criticals.length}):`);
    criticals.forEach((f, i) => lines.push(`  ${i+1}. [${f.source}] ${f.message}`));
  }
  if (warnings.length) {
    lines.push(``, `Warnings (${warnings.length}):`);
    warnings.forEach((f, i) => lines.push(`  ${i+1}. [${f.source}] ${f.message}`));
  }

  lines.push(``, `RECOMMENDATIONS`, `---------------`);
  if (scores.accessibility < 80) lines.push(`  - Accessibility is the highest-priority fix for enterprise compliance (WCAG 2.1 AA)`);
  if (scores.consistency < 75)   lines.push(`  - Inconsistent UI patterns will confuse users — standardize spacing and component variants`);
  if (scores.ux < 70)            lines.push(`  - UX score indicates friction — review CTA placement and visual hierarchy`);
  if (scores.ui < 75)            lines.push(`  - Visual QA detected layout issues — fix overflow and broken elements first`);
  if (enterprise >= 80)          lines.push(`  - Strong foundation — focus on polish and consistency`);

  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function reviewPage({ url } = {}) {
  if (!url) return { ok: false, error: "url required" };

  _ensureDir();
  const reviewId = `review-${Date.now()}`;
  const record = { reviewId, url, status: "running", scores: {}, findings: [], timestamp: new Date().toISOString() };
  const save = () => { try { fs.writeFileSync(path.join(REVIEW_DIR, `${reviewId}.json`), JSON.stringify(record, null, 2)); } catch {} };
  save();

  // Run all scoring services in series (some require prior DOM analysis)
  let domFilename, a11yResult, uxResult, vqaResult, brandResult, interactionResult;

  try {
    // DOM first
    const domSvc = require("./domAnalyzerService.cjs");
    const domR   = await domSvc.analyzePage({ url });
    domFilename  = domR.ok ? domR.filename : null;

    // UX + Consistency
    if (domFilename) {
      const uxSvc = require("./uxOptimizerService.cjs");
      uxResult = await uxSvc.analyzeUX({ domFilename });
      record.scores.ux          = uxResult.uxScore || 0;
      record.scores.consistency = uxResult.consistencyScore || 0;
      if (uxResult.issues) record.findings.push(...uxResult.issues.map(f => ({ ...f, source: "ux" })));
    }

    // Accessibility
    const a11ySvc = require("./accessibilityAuditor.cjs");
    a11yResult = await a11ySvc.auditPage({ url });
    const a11yErrors = a11yResult.stats?.errors || 0;
    const a11yWarns  = a11yResult.stats?.warnings || 0;
    record.scores.accessibility = Math.max(0, 100 - a11yErrors * 20 - a11yWarns * 5);
    if (a11yResult.findings) record.findings.push(...a11yResult.findings.slice(0, 10).map(f => ({ ...f, source: "accessibility" })));

    // Vision QA (UI score)
    const vqaSvc = require("./visionQA.cjs");
    vqaResult = await vqaSvc.auditPage({ url });
    record.scores.ui = vqaResult.qaScore || 0;
    if (vqaResult.issues) record.findings.push(...vqaResult.issues.slice(0, 10).map(f => ({ ...f, source: "vision-qa" })));

    // Brand
    if (domFilename) {
      const brandSvc = require("./brandIntelligence.cjs");
      brandResult = await brandSvc.analyzeFromDomFile({ domFilename });
      record.scores.brand = brandResult.brandScore || 0;
      if (brandResult.violations) record.findings.push(...brandResult.violations.slice(0, 5).map(f => ({ ...f, source: "brand" })));
    }

    // Interaction
    const intSvc = require("./interactionIntelligence.cjs");
    interactionResult = await intSvc.analyzeInteractions({ url });
    record.scores.interaction = interactionResult.interactionScore || 0;
    if (interactionResult.issues) record.findings.push(...interactionResult.issues.slice(0, 5).map(f => ({ ...f, source: "interaction" })));

  } catch (e) {
    // Partial scores are acceptable — continue
    record.partialError = e.message;
  }

  // Fill missing scores with defaults so enterprise score is always computable
  const defaults = { ui: 0, ux: 0, accessibility: 0, consistency: 0, brand: 0, interaction: 0 };
  record.scores = { ...defaults, ...record.scores };

  const enterpriseScore = _enterpriseScore(record.scores);
  const grade = _grade(enterpriseScore);

  record.enterpriseScore    = enterpriseScore;
  record.grade              = grade;
  record.status             = "complete";
  record.executiveReport    = _buildExecutiveReport(url, record.scores, record.findings);
  record.completedAt        = new Date().toISOString();

  save();

  return {
    ok: true,
    reviewId,
    url,
    scores:          record.scores,
    enterpriseScore,
    grade,
    totalFindings:   record.findings.length,
    executiveReport: record.executiveReport,
  };
}

async function reviewPages({ urls } = {}) {
  if (!Array.isArray(urls) || !urls.length) return { ok: false, error: "urls[] required" };
  const results = [];
  for (const url of urls) {
    const r = await reviewPage({ url });
    results.push(r);
  }
  const avgScore = Math.round(results.filter(r => r.ok).reduce((s, r) => s + r.enterpriseScore, 0) / Math.max(1, results.filter(r => r.ok).length));
  return { ok: true, total: results.length, avgEnterpriseScore: avgScore, results };
}

function listReviews({ limit = 20 } = {}) {
  _ensureDir();
  return fs.readdirSync(REVIEW_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(REVIEW_DIR, f), "utf8"));
        return { filename: f, reviewId: d.reviewId, url: d.url, enterpriseScore: d.enterpriseScore, grade: d.grade, timestamp: d.timestamp };
      } catch { return null; }
    }).filter(Boolean);
}

module.exports = { reviewPage, reviewPages, listReviews };
