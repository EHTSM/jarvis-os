"use strict";
/**
 * ODI-4 Component Relationship Graph
 *
 * Operates on a DOM snapshot and identifies:
 *   - Duplicate components (same class signature appearing ≥2 times)
 *   - Orphan components (visible but no children, no meaningful text, tiny bbox)
 *   - Unused/invisible components (display:none, opacity:0, off-screen)
 *   - Nesting depth analysis (max depth, deep-nesting hotspots)
 *   - Render hierarchy (component tree from body down)
 *   - Component type classification (button, input, card, nav, list, image, heading, text, container)
 */

const fs   = require("fs");
const path = require("path");

const COMP_DIR = path.join(__dirname, "../../data/odi/components");

function _ensureDir() {
  if (!fs.existsSync(COMP_DIR)) fs.mkdirSync(COMP_DIR, { recursive: true });
}

// ── Component type classifier ─────────────────────────────────────────────────
function _classifyComponent(node) {
  const { tag, classes, attrs } = node;
  const cls = classes.join(" ").toLowerCase();
  const role = (attrs.role || "").toLowerCase();

  if (tag === "button" || role === "button" || cls.includes("btn") || cls.includes("button")) return "button";
  if (tag === "input" || tag === "textarea" || tag === "select") return "input";
  if (tag === "a") return "link";
  if (tag === "img" || tag === "svg" || cls.includes("icon")) return "image";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "nav" || role === "navigation") return "nav";
  if (tag === "ul" || tag === "ol" || tag === "li") return "list";
  if (tag === "table" || tag === "tr" || tag === "td" || tag === "th") return "table";
  if (tag === "form") return "form";
  if (tag === "header" || tag === "footer" || tag === "main" || tag === "section" || tag === "article" || tag === "aside") return "landmark";
  if (cls.includes("card") || cls.includes("tile") || cls.includes("panel")) return "card";
  if (cls.includes("modal") || cls.includes("dialog") || cls.includes("overlay")) return "modal";
  if (cls.includes("badge") || cls.includes("tag") || cls.includes("chip")) return "badge";
  if (cls.includes("tooltip") || cls.includes("popover") || cls.includes("dropdown")) return "overlay";
  if (cls.includes("spinner") || cls.includes("loading") || cls.includes("skeleton")) return "loader";
  if (tag === "p" || tag === "span") return "text";
  if (tag === "div" || tag === "section") return "container";
  return "unknown";
}

// ── Signature for duplicate detection ────────────────────────────────────────
function _signature(node) {
  const sorted = [...node.classes].sort().join(" ");
  return `${node.tag}|${sorted}|${node.attrs.role || ""}`;
}

// ── Detect duplicates ─────────────────────────────────────────────────────────
function _detectDuplicates(nodes) {
  const sigMap = new Map();
  for (const n of nodes) {
    const sig = _signature(n);
    if (!sigMap.has(sig)) sigMap.set(sig, []);
    sigMap.get(sig).push(n.nodeId);
  }
  return Array.from(sigMap.entries())
    .filter(([, ids]) => ids.length >= 2)
    .map(([sig, ids]) => ({ signature: sig, count: ids.length, nodeIds: ids }))
    .sort((a, b) => b.count - a.count);
}

// ── Detect orphans ────────────────────────────────────────────────────────────
function _detectOrphans(nodes) {
  return nodes.filter(n =>
    n.visibility.isVisible &&
    n.childIds.length === 0 &&
    !n.text &&
    n.bbox.w > 0 && n.bbox.h > 0 &&
    n.bbox.w < 8 && n.bbox.h < 8 &&
    !["input","img","svg","br","hr","button"].includes(n.tag)
  ).map(n => ({ nodeId: n.nodeId, tag: n.tag, bbox: n.bbox, classes: n.classes }));
}

// ── Detect unused / invisible ─────────────────────────────────────────────────
function _detectUnused(nodes, viewport) {
  return nodes.filter(n =>
    !n.visibility.isVisible ||
    n.bbox.x + n.bbox.w < 0 ||
    n.bbox.y + n.bbox.h < 0 ||
    n.bbox.x > viewport.width + 100 ||
    n.bbox.y > viewport.height + 2000
  ).map(n => ({
    nodeId: n.nodeId, tag: n.tag, classes: n.classes.slice(0, 4),
    reason: !n.visibility.isVisible ? `display:${n.visibility.display}` : "off-screen",
  }));
}

// ── Nesting depth analysis ────────────────────────────────────────────────────
function _analyzeDepth(nodes) {
  const depths = nodes.map(n => n.depth);
  const maxDepth = Math.max(...depths, 0);
  const deepNodes = nodes.filter(n => n.depth >= Math.max(maxDepth - 2, 6));
  const byDepth = {};
  for (const d of depths) byDepth[d] = (byDepth[d] || 0) + 1;
  return {
    maxDepth,
    meanDepth: Math.round(depths.reduce((a, b) => a + b, 0) / (depths.length || 1)),
    deepNodes: deepNodes.slice(0, 10).map(n => ({ nodeId: n.nodeId, tag: n.tag, depth: n.depth, classes: n.classes.slice(0, 3) })),
    distribution: byDepth,
  };
}

// ── Render hierarchy (compact tree) ──────────────────────────────────────────
function _buildHierarchy(nodes, maxDepth = 4) {
  const nodeMap = new Map(nodes.map(n => [n.nodeId, n]));
  const roots   = nodes.filter(n => !n.parentId);

  function buildTree(n, d) {
    if (d > maxDepth) return null;
    const children = n.childIds
      .map(id => nodeMap.get(id))
      .filter(Boolean)
      .map(c => buildTree(c, d + 1))
      .filter(Boolean);
    return {
      nodeId:    n.nodeId,
      tag:       n.tag,
      type:      _classifyComponent(n),
      classes:   n.classes.slice(0, 3),
      children:  children.length ? children : undefined,
    };
  }

  return roots.map(r => buildTree(r, 0)).filter(Boolean);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function generateComponentGraph(domSnapshot) {
  const { nodes = [], viewport = { width: 1280, height: 900 } } = domSnapshot;

  const classified = nodes.map(n => ({
    ...n,
    componentType: _classifyComponent(n),
  }));

  const duplicates   = _detectDuplicates(classified);
  const orphans      = _detectOrphans(classified);
  const unused       = _detectUnused(classified, viewport);
  const depthAnalysis = _analyzeDepth(classified);
  const hierarchy    = _buildHierarchy(classified);

  // Component counts by type
  const byType = {};
  for (const n of classified) {
    byType[n.componentType] = (byType[n.componentType] || 0) + 1;
  }

  // Relationship edges: parent-child + duplicate groups
  const edges = [...domSnapshot.edges];
  for (const dup of duplicates) {
    for (let i = 1; i < dup.nodeIds.length; i++) {
      edges.push({ from: dup.nodeIds[0], to: dup.nodeIds[i], rel: "duplicate" });
    }
  }

  const stats = {
    totalComponents:    classified.length,
    visibleComponents:  classified.filter(n => n.visibility.isVisible).length,
    duplicateGroups:    duplicates.length,
    duplicateInstances: duplicates.reduce((s, d) => s + d.count, 0),
    orphanCount:        orphans.length,
    unusedCount:        unused.length,
    maxNestingDepth:    depthAnalysis.maxDepth,
    componentTypes:     byType,
  };

  return { nodes: classified, edges, hierarchy, duplicates, orphans, unused, depthAnalysis, stats };
}

async function analyzeComponents({ domFilename, domSnapshot } = {}) {
  let snapshot = domSnapshot;
  if (!snapshot && domFilename) {
    const fp = path.join(__dirname, "../../data/odi/dom", domFilename);
    if (!fs.existsSync(fp)) return { ok: false, error: `DOM file not found: ${domFilename}` };
    snapshot = JSON.parse(fs.readFileSync(fp, "utf8"));
  }
  if (!snapshot) return { ok: false, error: "domFilename or domSnapshot required" };

  const graph = generateComponentGraph(snapshot);

  _ensureDir();
  const slug = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `components-${slug}.json`;
  const out = { ...graph, url: snapshot.url, title: snapshot.title, timestamp: new Date().toISOString(), domFilename };
  fs.writeFileSync(path.join(COMP_DIR, filename), JSON.stringify(out, null, 2));

  return { ok: true, filename, path: `data/odi/components/${filename}`, ...graph };
}

function listComponentGraphs({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(COMP_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(COMP_DIR, f), "utf8"));
        return { filename: f, url: d.url, stats: d.stats, timestamp: d.timestamp };
      } catch { return null; }
    }).filter(Boolean);
}

module.exports = { analyzeComponents, generateComponentGraph, listComponentGraphs };
