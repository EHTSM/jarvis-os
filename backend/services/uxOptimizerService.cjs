"use strict";
/**
 * ODI-12 Autonomous UX Optimizer
 *
 * Analyzes a DOM snapshot for UX quality across 7 dimensions:
 *   1. Spacing consistency
 *   2. Alignment quality
 *   3. Readability (font sizes, line-height, contrast indicators)
 *   4. Visual hierarchy (heading structure, size differentiation)
 *   5. CTA visibility (button size, contrast, count, placement)
 *   6. Whitespace balance (padding density)
 *   7. Visual balance (left/right content distribution)
 *
 * Returns: uxScore, professionalScore, consistencyScore, per-dimension scores,
 * issues[], improvements[].
 */

const fs   = require("fs");
const path = require("path");

const UX_DIR = path.join(__dirname, "../../data/odi/ux");
function _ensureDir() { if (!fs.existsSync(UX_DIR)) fs.mkdirSync(UX_DIR, { recursive: true }); }

function _parsePx(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

// ── Dimension scorers (0–100) ─────────────────────────────────────────────────

function _scoreSpacing(nodes) {
  const issues = [];
  const byParent = new Map();
  for (const n of nodes) {
    if (n.parentId && n.visibility.isVisible) {
      if (!byParent.has(n.parentId)) byParent.set(n.parentId, []);
      byParent.get(n.parentId).push(n);
    }
  }
  let badGroups = 0, totalGroups = 0;
  for (const [, children] of byParent) {
    if (children.length < 2) continue;
    totalGroups++;
    const pts = children.map(c => _parsePx(c.spacing?.paddingTop));
    const unique = [...new Set(pts.filter(v => v > 0))];
    if (unique.length > 2) {
      badGroups++;
      issues.push(`Inconsistent padding in sibling group: ${unique.join("px, ")}px`);
    }
  }
  const score = totalGroups > 0 ? Math.max(0, 100 - (badGroups / totalGroups) * 100) : 80;
  return { score: Math.round(score), issues };
}

function _scoreAlignment(nodes, viewport) {
  const issues = [];
  const visible = nodes.filter(n => n.visibility.isVisible && n.bbox.w > 20);
  if (!visible.length) return { score: 80, issues };

  // Check that main content blocks align to common left-edge groups
  const leftEdges = visible.map(n => Math.round(n.bbox.x / 8) * 8); // snap to 8px grid
  const edgeFreq  = new Map();
  for (const e of leftEdges) edgeFreq.set(e, (edgeFreq.get(e) || 0) + 1);
  const topEdges  = [...edgeFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([e]) => e);
  const aligned   = leftEdges.filter(e => topEdges.includes(e)).length;
  const pct       = aligned / leftEdges.length;
  const score     = Math.round(pct * 100);
  if (score < 70) issues.push(`Only ${score}% of elements align to a common grid`);
  return { score, issues };
}

function _scoreReadability(nodes) {
  const issues = [];
  const textNodes = nodes.filter(n =>
    n.visibility.isVisible && n.text && ["p","span","li","td","div"].includes(n.tag)
  );
  if (!textNodes.length) return { score: 80, issues };

  let smallText = 0;
  let tightLH   = 0;
  for (const n of textNodes) {
    const fs = _parsePx(n.font?.size);
    const lh = _parsePx(n.font?.lineHeight);
    if (fs > 0 && fs < 12) { smallText++; issues.push(`Text smaller than 12px: ${fs}px on <${n.tag}>`); }
    if (fs > 0 && lh > 0 && lh / fs < 1.3) tightLH++;
  }
  const penalty = (smallText / textNodes.length) * 50 + (tightLH / textNodes.length) * 30;
  return { score: Math.max(0, Math.round(100 - penalty)), issues };
}

function _scoreHierarchy(nodes) {
  const issues = [];
  const headings = nodes.filter(n => n.visibility.isVisible && /^h[1-6]$/.test(n.tag));
  if (!headings.length) { issues.push("No heading elements found — visual hierarchy unclear"); return { score: 40, issues }; }

  const sizes = headings.map(n => _parsePx(n.font?.size)).filter(Boolean);
  if (sizes.length < 2) return { score: 70, issues };

  // Good hierarchy: sizes should decrease for higher h-levels
  const levels = headings.map(n => parseInt(n.tag[1]));
  let violations = 0;
  for (let i = 1; i < headings.length; i++) {
    if (levels[i] > levels[i-1] && sizes[i] >= sizes[i-1]) violations++;
  }
  const score = Math.max(0, 100 - violations * 20);
  if (violations > 0) issues.push(`${violations} heading size violations — deeper headings should be smaller`);
  return { score, issues };
}

function _scoreCTAVisibility(nodes, viewport) {
  const issues = [];
  const buttons = nodes.filter(n => n.visibility.isVisible &&
    (n.tag === "button" || n.attrs?.role === "button" || n.classes.some(c => c.includes("btn"))));

  if (!buttons.length) {
    issues.push("No CTA buttons detected on page");
    return { score: 50, issues };
  }

  let score = 100;
  for (const btn of buttons) {
    // Minimum touch target: 44×44px (WCAG 2.5.5)
    if (btn.bbox.w < 44 || btn.bbox.h < 24) {
      score -= 15;
      issues.push(`Button too small: ${btn.bbox.w}×${btn.bbox.h}px (min 44×24)`);
    }
    // CTA should be visible in first viewport
    if (btn.bbox.y > viewport.height) {
      score -= 10;
      issues.push(`CTA below fold: y=${btn.bbox.y} > viewport height ${viewport.height}`);
    }
  }
  return { score: Math.max(0, Math.min(100, score)), issues };
}

function _scoreWhitespace(nodes, viewport) {
  const issues = [];
  const visible = nodes.filter(n => n.visibility.isVisible && n.bbox.w > 0 && n.bbox.h > 0);
  if (!visible.length) return { score: 80, issues };

  const totalUsedArea = visible.reduce((s, n) => s + n.bbox.w * n.bbox.h, 0);
  const viewportArea  = viewport.width * viewport.height;
  const density       = Math.min(1, totalUsedArea / viewportArea);

  // Good whitespace: 50–75% content density
  let score;
  if (density < 0.3)       { score = 60; issues.push("Too much whitespace — content may feel sparse"); }
  else if (density > 0.85) { score = 50; issues.push(`Content density ${Math.round(density*100)}% — too crowded`); }
  else                     { score = 90; }
  return { score, issues };
}

function _scoreVisualBalance(nodes, viewport) {
  const issues = [];
  const visible = nodes.filter(n => n.visibility.isVisible && n.bbox.w > 20 && n.bbox.h > 20);
  if (visible.length < 3) return { score: 75, issues };

  const mid    = viewport.width / 2;
  const left   = visible.filter(n => n.bbox.x + n.bbox.w / 2 < mid).length;
  const right  = visible.filter(n => n.bbox.x + n.bbox.w / 2 >= mid).length;
  const ratio  = Math.min(left, right) / Math.max(left, right, 1);
  const score  = Math.round(ratio * 100);

  if (ratio < 0.3) issues.push(`Strong visual imbalance: ${left} elements left vs ${right} right`);
  return { score, issues };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function scoreUX(domSnapshot) {
  const { nodes = [], viewport = { width: 1280, height: 900 } } = domSnapshot;

  const spacing   = _scoreSpacing(nodes);
  const alignment = _scoreAlignment(nodes, viewport);
  const readability = _scoreReadability(nodes);
  const hierarchy = _scoreHierarchy(nodes);
  const cta       = _scoreCTAVisibility(nodes, viewport);
  const whitespace = _scoreWhitespace(nodes, viewport);
  const balance   = _scoreVisualBalance(nodes, viewport);

  const dims = { spacing, alignment, readability, hierarchy, cta, whitespace, balance };

  // Weighted composite scores
  const weights = { spacing: 0.15, alignment: 0.15, readability: 0.2, hierarchy: 0.15, cta: 0.15, whitespace: 0.1, balance: 0.1 };
  const uxScore = Math.round(
    Object.keys(dims).reduce((s, k) => s + dims[k].score * weights[k], 0)
  );

  // Professional score: alignment + hierarchy + hierarchy (perception of craft)
  const professionalScore = Math.round((alignment.score * 0.4 + hierarchy.score * 0.35 + balance.score * 0.25));

  // Consistency score: spacing + alignment
  const consistencyScore = Math.round((spacing.score * 0.5 + alignment.score * 0.5));

  const allIssues = Object.entries(dims).flatMap(([dim, d]) =>
    d.issues.map(msg => ({ dimension: dim, message: msg }))
  );

  const improvements = allIssues
    .sort((a, b) => {
      const priority = { cta: 0, readability: 1, hierarchy: 2, spacing: 3, alignment: 4, whitespace: 5, balance: 6 };
      return (priority[a.dimension] || 9) - (priority[b.dimension] || 9);
    })
    .map(i => `[${i.dimension}] ${i.message}`);

  return { uxScore, professionalScore, consistencyScore, dimensions: dims, issues: allIssues, improvements };
}

async function analyzeUX({ domFilename, domSnapshot } = {}) {
  let snapshot = domSnapshot;
  if (!snapshot && domFilename) {
    const fp = path.join(__dirname, "../../data/odi/dom", domFilename);
    if (!fs.existsSync(fp)) return { ok: false, error: `DOM file not found: ${domFilename}` };
    snapshot = JSON.parse(fs.readFileSync(fp, "utf8"));
  }
  if (!snapshot) return { ok: false, error: "domFilename or domSnapshot required" };

  const result = scoreUX(snapshot);

  _ensureDir();
  const slug = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `ux-${slug}.json`;
  const out = { ...result, url: snapshot.url, title: snapshot.title, timestamp: new Date().toISOString(), domFilename };
  fs.writeFileSync(path.join(UX_DIR, filename), JSON.stringify(out, null, 2));

  return { ok: true, filename, path: `data/odi/ux/${filename}`, ...result };
}

function listUXReports({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(UX_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(UX_DIR, f), "utf8"));
        return { filename: f, url: d.url, uxScore: d.uxScore, professionalScore: d.professionalScore, consistencyScore: d.consistencyScore, timestamp: d.timestamp };
      } catch { return null; }
    }).filter(Boolean);
}

module.exports = { analyzeUX, scoreUX, listUXReports };
