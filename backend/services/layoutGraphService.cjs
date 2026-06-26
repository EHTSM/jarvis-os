"use strict";
/**
 * ODI-3 Layout Graph Engine
 *
 * Consumes a DOM snapshot from domAnalyzerService and produces a layout graph:
 *   - Overlap detection (bounding box intersection)
 *   - Spacing analysis (gaps between siblings)
 *   - Alignment detection (left/center/right axis alignment)
 *   - Padding/margin inconsistencies
 *   - Flex issues (children overflowing flex container, missing flex-wrap)
 *   - Grid issues (children count vs declared columns)
 *   - Responsive breakpoint stress (detects elements wider than viewport)
 *
 * Returns a JSON graph: { nodes[], edges[], findings[], stats }
 */

const fs   = require("fs");
const path = require("path");

const LAYOUT_DIR = path.join(__dirname, "../../data/odi/layout");

function _ensureDir() {
  if (!fs.existsSync(LAYOUT_DIR)) fs.mkdirSync(LAYOUT_DIR, { recursive: true });
}

function _parsePx(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// ── Overlap detection ─────────────────────────────────────────────────────────
function _detectOverlaps(nodes) {
  const visible = nodes.filter(n => n.visibility.isVisible && n.bbox.w > 0 && n.bbox.h > 0);
  const findings = [];
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i], b = visible[j];
      // Skip direct parent-child — overlaps expected
      if (a.childIds.includes(b.nodeId) || b.childIds.includes(a.nodeId)) continue;
      const overlapX = Math.max(0, Math.min(a.bbox.x + a.bbox.w, b.bbox.x + b.bbox.w) - Math.max(a.bbox.x, b.bbox.x));
      const overlapY = Math.max(0, Math.min(a.bbox.y + a.bbox.h, b.bbox.y + b.bbox.h) - Math.max(a.bbox.y, b.bbox.y));
      if (overlapX > 4 && overlapY > 4) {
        findings.push({
          type:     "overlap",
          severity: "error",
          nodeA:    a.nodeId, tagA: a.tag, classesA: a.classes.slice(0, 3),
          nodeB:    b.nodeId, tagB: b.tag, classesB: b.classes.slice(0, 3),
          overlapPx: { x: overlapX, y: overlapY },
          message:  `<${a.tag}> overlaps <${b.tag}> by ${overlapX}×${overlapY}px`,
        });
      }
    }
  }
  return findings;
}

// ── Spacing consistency ───────────────────────────────────────────────────────
function _detectSpacingIssues(nodes) {
  const findings = [];
  // Group siblings (same parent)
  const byParent = new Map();
  for (const n of nodes) {
    if (n.parentId) {
      if (!byParent.has(n.parentId)) byParent.set(n.parentId, []);
      byParent.get(n.parentId).push(n);
    }
  }
  for (const [parentId, children] of byParent) {
    if (children.length < 2) continue;
    // Sort by vertical position
    const sorted = [...children].filter(n => n.visibility.isVisible).sort((a, b) => a.bbox.y - b.bbox.y);
    if (sorted.length < 2) continue;
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].bbox.y - (sorted[i - 1].bbox.y + sorted[i - 1].bbox.h);
      if (gap >= 0) gaps.push(gap);
    }
    if (gaps.length < 2) continue;
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
    if (variance > 400 && mean > 0) {
      findings.push({
        type:     "spacing_inconsistency",
        severity: "warning",
        parentId,
        gaps,
        mean:     Math.round(mean),
        variance: Math.round(variance),
        message:  `Inconsistent vertical spacing in parent ${parentId} — gaps vary from ${Math.min(...gaps)}px to ${Math.max(...gaps)}px`,
      });
    }
  }
  return findings;
}

// ── Alignment ─────────────────────────────────────────────────────────────────
function _detectAlignmentIssues(nodes) {
  const findings = [];
  const byParent = new Map();
  for (const n of nodes) {
    if (n.parentId && n.visibility.isVisible && n.bbox.w > 0) {
      if (!byParent.has(n.parentId)) byParent.set(n.parentId, []);
      byParent.get(n.parentId).push(n);
    }
  }
  for (const [parentId, children] of byParent) {
    if (children.length < 3) continue;
    const lefts  = children.map(c => c.bbox.x);
    const unique  = [...new Set(lefts)];
    if (unique.length === children.length && children.length > 3) {
      findings.push({
        type:     "alignment_drift",
        severity: "warning",
        parentId,
        message:  `Children of ${parentId} have ${unique.length} different left edges — possible alignment drift`,
        edges:    unique,
      });
    }
  }
  return findings;
}

// ── Flex issues ───────────────────────────────────────────────────────────────
function _detectFlexIssues(nodes, viewport) {
  const findings = [];
  const byParent = new Map();
  for (const n of nodes) {
    if (n.parentId) {
      if (!byParent.has(n.parentId)) byParent.set(n.parentId, []);
      byParent.get(n.parentId).push(n);
    }
  }
  const nodeMap = new Map(nodes.map(n => [n.nodeId, n]));
  for (const [parentId, children] of byParent) {
    const parent = nodeMap.get(parentId);
    if (!parent) continue;
    const isFlex = parent.layout.display === "flex";
    if (!isFlex) continue;
    // Children overflowing parent width
    for (const c of children) {
      if (!c.visibility.isVisible) continue;
      if (c.bbox.x + c.bbox.w > parent.bbox.x + parent.bbox.w + 4) {
        findings.push({
          type:     "flex_overflow",
          severity: "error",
          parentId, childId: c.nodeId,
          message:  `<${c.tag}> overflows flex parent by ${Math.round((c.bbox.x + c.bbox.w) - (parent.bbox.x + parent.bbox.w))}px`,
        });
      }
    }
  }
  // Elements wider than viewport
  for (const n of nodes) {
    if (n.visibility.isVisible && n.bbox.w > viewport.width + 4) {
      findings.push({
        type:     "viewport_overflow",
        severity: "error",
        nodeId:   n.nodeId, tag: n.tag,
        message:  `<${n.tag}> (${n.bbox.w}px wide) exceeds viewport width (${viewport.width}px)`,
      });
    }
  }
  return findings;
}

// ── Grid issues ───────────────────────────────────────────────────────────────
function _detectGridIssues(nodes) {
  const findings = [];
  const nodeMap  = new Map(nodes.map(n => [n.nodeId, n]));
  const byParent = new Map();
  for (const n of nodes) {
    if (n.parentId) {
      if (!byParent.has(n.parentId)) byParent.set(n.parentId, []);
      byParent.get(n.parentId).push(n);
    }
  }
  for (const [parentId, children] of byParent) {
    const parent = nodeMap.get(parentId);
    if (!parent?.layout?.gridCols) continue;
    // Count declared columns
    const cols = parent.layout.gridCols.split(" ").filter(Boolean).length;
    const visChildren = children.filter(c => c.visibility.isVisible).length;
    if (visChildren > 0 && visChildren % cols !== 0) {
      findings.push({
        type:     "grid_orphan",
        severity: "warning",
        parentId,
        cols, visChildren,
        message:  `Grid container ${parentId} has ${visChildren} children but ${cols} columns — last row is partially filled`,
      });
    }
  }
  return findings;
}

// ── Responsive breakpoint stress ──────────────────────────────────────────────
function _detectResponsiveIssues(nodes, viewport) {
  const BREAKPOINTS = [320, 375, 768, 1024, 1280, 1440, 1920];
  const findings = [];
  const risky = nodes.filter(n =>
    n.visibility.isVisible &&
    n.bbox.w > 0 &&
    n.bbox.x + n.bbox.w > viewport.width * 0.95
  );
  if (risky.length > 0) {
    findings.push({
      type:     "responsive_risk",
      severity: "warning",
      count:    risky.length,
      viewport,
      message:  `${risky.length} elements reach ≥95% of viewport width — may break at smaller breakpoints`,
      nodes:    risky.slice(0, 5).map(n => ({ nodeId: n.nodeId, tag: n.tag, widthPx: n.bbox.w })),
    });
  }
  // Fixed-px width on potentially responsive elements
  const fixedWidthResponsive = nodes.filter(n =>
    n.visibility.isVisible &&
    n.bbox.w > 200 &&
    !n.layout.gridCols &&
    n.layout.display !== "flex"
  );
  if (fixedWidthResponsive.length > 10) {
    findings.push({
      type:     "fixed_width_heavy",
      severity: "info",
      count:    fixedWidthResponsive.length,
      message:  `${fixedWidthResponsive.length} elements use wide fixed widths — verify they scale on mobile`,
    });
  }
  return findings;
}

// ── Padding/margin inconsistencies ────────────────────────────────────────────
function _detectPaddingIssues(nodes) {
  const findings = [];
  const buttons = nodes.filter(n => n.tag === "button" || n.classes.some(c => c.includes("btn")));
  if (buttons.length >= 2) {
    const paddingTops = buttons.map(b => _parsePx(b.spacing.paddingTop));
    const unique = [...new Set(paddingTops)];
    if (unique.length > 2) {
      findings.push({
        type:     "button_padding_inconsistency",
        severity: "warning",
        message:  `Buttons have ${unique.length} different paddingTop values: ${unique.join(", ")} — standardize for visual consistency`,
        values:   unique,
      });
    }
  }
  return findings;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function generateLayoutGraph(domSnapshot) {
  const { nodes = [], viewport = { width: 1280, height: 900 } } = domSnapshot;

  const findings = [
    ..._detectOverlaps(nodes),
    ..._detectSpacingIssues(nodes),
    ..._detectAlignmentIssues(nodes),
    ..._detectFlexIssues(nodes, viewport),
    ..._detectGridIssues(nodes),
    ..._detectResponsiveIssues(nodes, viewport),
    ..._detectPaddingIssues(nodes),
  ];

  // Layout graph nodes: visible elements with their position/size
  const graphNodes = nodes
    .filter(n => n.visibility.isVisible && n.bbox.w > 0)
    .map(n => ({
      nodeId:   n.nodeId,
      tag:      n.tag,
      classes:  n.classes.slice(0, 4),
      bbox:     n.bbox,
      depth:    n.depth,
      display:  n.layout.display,
      zIndex:   n.position.zIndex,
    }));

  // Layout graph edges: parent-child + overlap connections
  const graphEdges = [...domSnapshot.edges];
  for (const f of findings.filter(f => f.type === "overlap")) {
    graphEdges.push({ from: f.nodeA, to: f.nodeB, rel: "overlap", severity: f.severity });
  }

  const stats = {
    totalNodes:       nodes.length,
    visibleNodes:     graphNodes.length,
    findingCount:     findings.length,
    errors:           findings.filter(f => f.severity === "error").length,
    warnings:         findings.filter(f => f.severity === "warning").length,
    info:             findings.filter(f => f.severity === "info").length,
    findingTypes:     [...new Set(findings.map(f => f.type))],
  };

  return { nodes: graphNodes, edges: graphEdges, findings, stats };
}

async function analyzeLayout({ domFilename, domSnapshot } = {}) {
  let snapshot = domSnapshot;

  if (!snapshot && domFilename) {
    const fp = path.join(__dirname, "../../data/odi/dom", domFilename);
    if (!fs.existsSync(fp)) return { ok: false, error: `DOM file not found: ${domFilename}` };
    snapshot = JSON.parse(fs.readFileSync(fp, "utf8"));
  }

  if (!snapshot) return { ok: false, error: "domFilename or domSnapshot required" };

  const graph = generateLayoutGraph(snapshot);

  _ensureDir();
  const slug     = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `layout-${slug}.json`;
  const out = { ...graph, url: snapshot.url, title: snapshot.title, timestamp: new Date().toISOString(), domFilename };
  fs.writeFileSync(path.join(LAYOUT_DIR, filename), JSON.stringify(out, null, 2));

  return { ok: true, filename, path: `data/odi/layout/${filename}`, ...graph };
}

function listLayouts({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(LAYOUT_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(LAYOUT_DIR, f), "utf8"));
        return { filename: f, url: d.url, findingCount: d.findings?.length || 0, timestamp: d.timestamp };
      } catch { return null; }
    }).filter(Boolean);
}

module.exports = { analyzeLayout, generateLayoutGraph, listLayouts };
