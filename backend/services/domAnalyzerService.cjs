"use strict";
/**
 * ODI-2 DOM Intelligence Engine
 *
 * Collects from a live Playwright page:
 *   - Full DOM tree (tag, id, classes, attributes, text snippet)
 *   - Computed CSS styles (color, background, font, visibility, z-index, position, box model)
 *   - Bounding boxes (x, y, width, height)
 *   - Font info (family, size, weight, line-height)
 *   - Color info (color, backgroundColor)
 *   - Visibility (isVisible, opacity, display, visibility property)
 *   - Z-index stack order
 *   - Parent-child relationship graph
 *
 * Stores JSON snapshots in data/odi/dom/
 */

const fs   = require("fs");
const path = require("path");

const DOM_DIR = path.join(__dirname, "../../data/odi/dom");

function _ensureDir() {
  if (!fs.existsSync(DOM_DIR)) fs.mkdirSync(DOM_DIR, { recursive: true });
}

function _getSession() {
  try { return require("../../agents/browser/browserSession.cjs"); }
  catch { return null; }
}

function _slug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// ── Core DOM extraction (runs inside page.evaluate) ───────────────────────────
// Must be a self-contained function — no closures over Node.js scope.
function _domExtractScript() {
  /* eslint-disable no-undef */
  const DEPTH_LIMIT = 8;
  const SKIP_TAGS   = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK"]);

  function extractNode(el, depth, parentId, nodeMap, edges) {
    if (depth > DEPTH_LIMIT) return null;
    if (SKIP_TAGS.has(el.tagName)) return null;

    const nodeId = `n${nodeMap.size}`;
    const rect   = el.getBoundingClientRect();
    const cs     = window.getComputedStyle(el);

    const text = (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3)
      ? el.childNodes[0].textContent.trim().slice(0, 120)
      : "";

    const node = {
      nodeId,
      parentId,
      tag:       el.tagName.toLowerCase(),
      id:        el.id || null,
      classes:   Array.from(el.classList),
      attrs:     {},
      text:      text || null,
      depth,
      // Bounding box
      bbox:      { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      // Font
      font:      {
        family:     cs.fontFamily,
        size:       cs.fontSize,
        weight:     cs.fontWeight,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
      },
      // Color
      color:     { fg: cs.color, bg: cs.backgroundColor },
      // Visibility
      visibility: {
        display:    cs.display,
        visibility: cs.visibility,
        opacity:    parseFloat(cs.opacity),
        isVisible:  rect.width > 0 && rect.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0,
      },
      // Positioning
      position:  {
        type:     cs.position,
        zIndex:   cs.zIndex === "auto" ? null : parseInt(cs.zIndex, 10),
        top:      cs.top, left: cs.left, right: cs.right, bottom: cs.bottom,
      },
      // Box model
      spacing:   {
        marginTop: cs.marginTop, marginRight: cs.marginRight, marginBottom: cs.marginBottom, marginLeft: cs.marginLeft,
        paddingTop: cs.paddingTop, paddingRight: cs.paddingRight, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
        borderWidth: cs.borderWidth, borderRadius: cs.borderRadius,
      },
      // Flex/Grid context
      layout:    {
        flexDir:   cs.flexDirection !== "row" ? cs.flexDirection : null,
        display:   cs.display,
        gridCols:  cs.gridTemplateColumns !== "none" ? cs.gridTemplateColumns : null,
        overflow:  cs.overflow !== "visible" ? cs.overflow : null,
      },
      childIds:  [],
    };

    // Collect relevant attributes
    for (const attr of ["href", "src", "alt", "role", "aria-label", "aria-hidden",
                         "aria-required", "tabindex", "type", "name", "placeholder",
                         "for", "data-testid"]) {
      const val = el.getAttribute(attr);
      if (val !== null) node.attrs[attr] = val;
    }

    nodeMap.set(nodeId, node);
    if (parentId) edges.push({ from: parentId, to: nodeId, rel: "child" });

    for (const child of el.children) {
      const childNode = extractNode(child, depth + 1, nodeId, nodeMap, edges);
      if (childNode) node.childIds.push(childNode.nodeId);
    }

    return node;
  }

  const nodeMap = new Map();
  const edges   = [];
  const root    = document.body || document.documentElement;
  extractNode(root, 0, null, nodeMap, edges);

  return {
    url:       window.location.href,
    title:     document.title,
    nodeCount: nodeMap.size,
    nodes:     Array.from(nodeMap.values()),
    edges,
    viewport:  { width: window.innerWidth, height: window.innerHeight },
    scrollY:   window.scrollY,
  };
  /* eslint-enable no-undef */
}

// ── Public API ────────────────────────────────────────────────────────────────

async function analyzePage({ pageId, url } = {}) {
  const session = _getSession();
  if (!session) return { ok: false, error: "Playwright not available" };

  let page, pid, closeAfter = false;

  if (pageId) {
    page = session.getPage(pageId);
    if (!page) return { ok: false, error: `Page ${pageId} not found` };
    pid = pageId;
  } else {
    if (!session.isRunning()) {
      const r = await session.launch({ headless: true });
      if (!r.ok) return { ok: false, error: `Browser launch failed: ${r.error}` };
    }
    const r = await session.newPage();
    if (!r.ok) return { ok: false, error: r.error };
    pid  = r.pageId;
    page = r.page;
    closeAfter = true;

    if (url) {
      try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }); }
      catch (e) {
        await session.closePage(pid).catch(() => {});
        return { ok: false, error: `Navigation failed: ${e.message}` };
      }
    }
  }

  let domData;
  try {
    domData = await page.evaluate(_domExtractScript);
  } catch (e) {
    if (closeAfter) await session.closePage(pid).catch(() => {});
    return { ok: false, error: `DOM extraction failed: ${e.message}` };
  }

  if (closeAfter) await session.closePage(pid).catch(() => {});

  const slug     = _slug();
  const filename = `dom-${slug}.json`;
  const snapshot = {
    ...domData,
    pageId:    pid,
    timestamp: new Date().toISOString(),
    capturedAt: Date.now(),
  };

  _ensureDir();
  fs.writeFileSync(path.join(DOM_DIR, filename), JSON.stringify(snapshot, null, 2));

  // Build compact summary for API response (full data in file)
  const visibleNodes  = snapshot.nodes.filter(n => n.visibility.isVisible);
  const zIndexNodes   = snapshot.nodes.filter(n => n.position.zIndex !== null).sort((a, b) => b.position.zIndex - a.position.zIndex);
  const uniqueClasses = [...new Set(snapshot.nodes.flatMap(n => n.classes))];
  const fontFamilies  = [...new Set(snapshot.nodes.map(n => n.font.family).filter(Boolean))];

  return {
    ok: true,
    filename,
    path:         `data/odi/dom/${filename}`,
    timestamp:    snapshot.timestamp,
    url:          snapshot.url,
    title:        snapshot.title,
    nodeCount:    snapshot.nodeCount,
    edgeCount:    snapshot.edges.length,
    visibleCount: visibleNodes.length,
    viewport:     snapshot.viewport,
    summary: {
      uniqueClasses:  uniqueClasses.length,
      fontFamilies,
      zIndexRange:    zIndexNodes.length ? { min: zIndexNodes[zIndexNodes.length - 1].position.zIndex, max: zIndexNodes[0].position.zIndex } : null,
      topZIndexNodes: zIndexNodes.slice(0, 5).map(n => ({ nodeId: n.nodeId, tag: n.tag, zIndex: n.position.zIndex })),
    },
  };
}

function listAnalyses({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(DOM_DIR)
    .filter(f => f.endsWith(".json"))
    .sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(DOM_DIR, f), "utf8"));
        return { filename: f, path: `data/odi/dom/${f}`, url: d.url, title: d.title, nodeCount: d.nodeCount, timestamp: d.timestamp };
      } catch { return null; }
    })
    .filter(Boolean);
}

function getAnalysis(filename) {
  const fp = path.join(DOM_DIR, filename);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, "utf8"));
}

module.exports = { analyzePage, listAnalyses, getAnalysis };
