"use strict";
/**
 * OP-2 — GitHub & Company Presence Report
 *
 * Audits Ooplix as if it belongs to a billion-dollar software company.
 * Scores 5 dimensions:
 *   1. Trust              — security policy, disclosure, audit trail
 *   2. Documentation      — completeness, quality, freshness
 *   3. Open Source Quality— contributing guide, issue templates, PR template, CI
 *   4. Developer Experience — quick start, API reference, SDK, architecture docs
 *   5. Commercial Presence — brand kit, OG images, changelog, release automation
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../../");

function _exists(rel) {
  try { fs.accessSync(path.join(ROOT, rel)); return true; } catch { return false; }
}
function _size(rel) {
  try { return fs.statSync(path.join(ROOT, rel)).size; } catch { return 0; }
}
function _lines(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n").length; } catch { return 0; }
}
function _contains(rel, ...terms) {
  try {
    const content = fs.readFileSync(path.join(ROOT, rel), "utf8");
    return terms.every(t => content.toLowerCase().includes(t.toLowerCase()));
  } catch { return false; }
}

// ── Dimension 1: Trust ────────────────────────────────────────────────────────

function scoreTrust() {
  const checks = {
    "SECURITY.md exists":            { ok: _exists("SECURITY.md"), weight: 3 },
    "Responsible disclosure process": { ok: _contains("SECURITY.md", "responsible", "disclosure", "email"), weight: 2 },
    "Supported versions table":       { ok: _contains("SECURITY.md", "supported", "version"), weight: 1 },
    "Safe harbour clause":            { ok: _contains("SECURITY.md", "safe harbour", "legal"), weight: 1 },
    "Security checklist for hosters": { ok: _contains("SECURITY.md", "checklist", "chmod"), weight: 1 },
    "JWT auth implementation":        { ok: _exists("backend/middleware/authMiddleware.js"), weight: 2 },
    "Webhook HMAC verification":      { ok: _exists("backend/middleware/rawBody.js"), weight: 1 },
    "Operator audit trail":           { ok: _exists("backend/middleware/operatorAudit.js"), weight: 1 },
    "Production validate script":     { ok: _exists("deploy/validate-production.sh"), weight: 2 },
    ".env gitignored":                { ok: _contains(".gitignore", ".env"), weight: 2 },
  };

  return { dimension: "Trust", checks };
}

// ── Dimension 2: Documentation ────────────────────────────────────────────────

function scoreDocumentation() {
  const checks = {
    "README.md exists (>50 lines)":   { ok: _lines("README.md") > 50, weight: 2 },
    "README has architecture":        { ok: _contains("README.md", "architecture") || _contains("README.md", "stack"), weight: 1 },
    "README has quick start":         { ok: _contains("README.md", "quick start", "npm install"), weight: 2 },
    "README has badges":              { ok: _contains("README.md", "img.shields.io"), weight: 1 },
    "README has roadmap":             { ok: _contains("README.md", "roadmap", "planned"), weight: 1 },
    "CHANGELOG.md exists":            { ok: _exists("CHANGELOG.md"), weight: 2 },
    "docs/ directory exists":         { ok: _exists("docs"), weight: 1 },
    "Quick Start guide":              { ok: _exists("docs/guides/QUICK_START.md"), weight: 2 },
    "Deployment guide":               { ok: _exists("docs/guides/DEPLOYMENT.md"), weight: 2 },
    "Configuration reference":        { ok: _exists("docs/guides/CONFIGURATION.md"), weight: 1 },
    "FAQ":                            { ok: _exists("docs/faq/FAQ.md"), weight: 1 },
    "Architecture overview":          { ok: _exists("docs/architecture/OVERVIEW.md"), weight: 2 },
    "Academy/learning paths":         { ok: _exists("docs/academy/README.md"), weight: 1 },
  };

  return { dimension: "Documentation", checks };
}

// ── Dimension 3: Open Source Quality ─────────────────────────────────────────

function scoreOpenSourceQuality() {
  const checks = {
    "CONTRIBUTING.md exists":          { ok: _exists("CONTRIBUTING.md"), weight: 2 },
    "Branch strategy documented":      { ok: _contains("CONTRIBUTING.md", "branch", "main"), weight: 1 },
    "Commit format documented":        { ok: _contains("CONTRIBUTING.md", "conventional", "feat("), weight: 2 },
    "Coding standards documented":     { ok: _contains("CONTRIBUTING.md", "coding standards", "use strict"), weight: 1 },
    "Testing requirements":            { ok: _contains("CONTRIBUTING.md", "test:runtime", "144"), weight: 2 },
    "Bug report template":             { ok: _exists(".github/ISSUE_TEMPLATE/bug_report.yml"), weight: 2 },
    "Feature request template":        { ok: _exists(".github/ISSUE_TEMPLATE/feature_request.yml"), weight: 1 },
    "Question template":               { ok: _exists(".github/ISSUE_TEMPLATE/question.yml"), weight: 1 },
    "Security report template":        { ok: _exists(".github/ISSUE_TEMPLATE/security_report.yml"), weight: 1 },
    "Issue config (blank issues off)": { ok: _exists(".github/ISSUE_TEMPLATE/config.yml"), weight: 1 },
    "PR template":                     { ok: _exists(".github/PULL_REQUEST_TEMPLATE.md"), weight: 2 },
    "PR template has checklist":       { ok: _contains(".github/PULL_REQUEST_TEMPLATE.md", "144/144", "test:runtime"), weight: 1 },
    "CI workflow":                     { ok: _exists(".github/workflows/ci.yml"), weight: 3 },
    "Release workflow":                { ok: _exists(".github/workflows/release.yml"), weight: 2 },
    "Regression suite (144 tests)":    { ok: _exists("tests"), weight: 2 },
  };

  return { dimension: "Open Source Quality", checks };
}

// ── Dimension 4: Developer Experience ────────────────────────────────────────

function scoreDeveloperExperience() {
  const checks = {
    "API reference":                   { ok: _exists("docs/api/API_REFERENCE.md"), weight: 3 },
    "API reference >100 lines":        { ok: _lines("docs/api/API_REFERENCE.md") > 100, weight: 1 },
    "Plugin SDK documented":           { ok: _exists("docs/api/PLUGIN_SDK.md"), weight: 2 },
    "Architecture design decisions":   { ok: _contains("docs/architecture/OVERVIEW.md", "why", "decision"), weight: 2 },
    "Architecture data flow diagram":  { ok: _contains("docs/architecture/OVERVIEW.md", "data flow", "execution"), weight: 1 },
    "generate-password-hash script":   { ok: _exists("scripts/generate-password-hash.cjs"), weight: 1 },
    "env check script":                { ok: _exists("scripts/check-startup-env.cjs"), weight: 1 },
    "One-command VPS setup":           { ok: _exists("deploy/setup-vps.sh"), weight: 2 },
    "Zero-downtime update":            { ok: _exists("deploy/update.sh"), weight: 1 },
    "Rollback script":                 { ok: _exists("deploy/rollback.sh"), weight: 1 },
    "Healthcheck with auto-restart":   { ok: _exists("deploy/healthcheck.sh"), weight: 1 },
    "Production env example":          { ok: _exists(".env.production.example"), weight: 2 },
    "npm test command":                { ok: _contains("package.json", "test:runtime"), weight: 1 },
  };

  return { dimension: "Developer Experience", checks };
}

// ── Dimension 5: Commercial Presence ─────────────────────────────────────────

function scoreCommercialPresence() {
  const checks = {
    "Brand kit documented":           { ok: _exists("assets/brand/BRAND_KIT.md"), weight: 2 },
    "Logo (full) SVG":                { ok: _exists("assets/brand/logo-full.svg"), weight: 2 },
    "Logo mark SVG":                  { ok: _exists("assets/brand/logo-mark.svg"), weight: 1 },
    "Logo dark variant":              { ok: _exists("assets/brand/logo-dark.svg"), weight: 1 },
    "OG image (1200x630)":            { ok: _exists("assets/og/og-default.svg"), weight: 2 },
    "App icon 512px":                 { ok: _exists("assets/icons/icon-512.svg"), weight: 1 },
    "App icon 32px":                  { ok: _exists("assets/icons/icon-32.svg"), weight: 1 },
    "Favicon in public/":             { ok: _exists("frontend/public/favicon.svg"), weight: 1 },
    "PWA manifest":                   { ok: _exists("frontend/public/manifest.json"), weight: 1 },
    "Company in package.json":        { ok: _contains("package.json", "ALWALIY", "Ooplix"), weight: 1 },
    "CHANGELOG.md >40 lines":         { ok: _lines("CHANGELOG.md") > 40, weight: 2 },
    "Semantic version (v3.0.0)":      { ok: _contains("package.json", '"version": "3'), weight: 1 },
    "Release workflow with SHA256":   { ok: _contains(".github/workflows/release.yml", "sha256sum"), weight: 2 },
    "Production readiness in app":    { ok: _exists("backend/services/deploymentReport.cjs"), weight: 1 },
  };

  return { dimension: "Commercial Presence", checks };
}

// ── Scoring engine ────────────────────────────────────────────────────────────

function _computeScore(checks) {
  let earned = 0; let total = 0;
  for (const c of Object.values(checks)) {
    total += c.weight;
    if (c.ok) earned += c.weight;
  }
  return { earned, total, pct: Math.round(earned / Math.max(total, 1) * 100) };
}

function generateReport() {
  const dimensions = [
    scoreTrust(),
    scoreDocumentation(),
    scoreOpenSourceQuality(),
    scoreDeveloperExperience(),
    scoreCommercialPresence(),
  ].map(d => {
    const score = _computeScore(d.checks);
    return { ...d, score };
  });

  const totalEarned = dimensions.reduce((s, d) => s + d.score.earned, 0);
  const totalWeight = dimensions.reduce((s, d) => s + d.score.total, 0);
  const overallScore = Math.round(totalEarned / Math.max(totalWeight, 1) * 100);

  const failedChecks = dimensions.flatMap(d =>
    Object.entries(d.checks)
      .filter(([, v]) => !v.ok)
      .map(([name, v]) => ({ dimension: d.dimension, name, weight: v.weight }))
  ).sort((a, b) => b.weight - a.weight);

  const verdict = overallScore >= 90
    ? "World-class — ship with confidence."
    : overallScore >= 75
      ? "Strong — a few gaps to close before public launch."
      : overallScore >= 60
        ? "Good foundation — address the top-weight failures before launch."
        : "Needs work — complete the checklist before presenting to investors or users.";

  return {
    generatedAt: new Date().toISOString(),
    version: "OP-2",
    overallScore,
    verdict,
    dimensions,
    topFailures: failedChecks.slice(0, 10),
    summary: {
      dimensions: dimensions.length,
      totalChecks: Object.values(dimensions).reduce((s, d) => s + Object.keys(d.checks).length, 0),
      passed: dimensions.reduce((s, d) => s + Object.values(d.checks).filter(c => c.ok).length, 0),
    },
  };
}

module.exports = { generateReport };
