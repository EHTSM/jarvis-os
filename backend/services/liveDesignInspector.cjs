"use strict";
/**
 * ODI-25 Live Design Inspector
 *
 * Electron-compatible overlay inspector:
 *   - Injects an inspection script into any live Playwright page
 *   - Hover returns: spacing, padding, margin, typography, colors, hierarchy,
 *     component source path, CSS classes
 *   - In Electron: uses ipcMain to relay inspection data to renderer overlay
 *   - In headless: returns inspection data as JSON for a given selector
 *
 * The frontend overlay is a React component that renders a floating panel.
 * This backend service manages the inspection session and data retrieval.
 *
 * Storage: data/odi/inspector/ (session snapshots)
 */

const fs   = require("fs");
const path = require("path");

const INSP_DIR = path.join(__dirname, "../../data/odi/inspector");
function _ensureDir() { if (!fs.existsSync(INSP_DIR)) fs.mkdirSync(INSP_DIR, { recursive: true }); }
function _getSession() { try { return require("../../agents/browser/browserSession.cjs"); } catch { return null; } }

// ── Inspector script (self-contained, injected into page) ─────────────────────

function _inspectorScript() {
  /* eslint-disable */
  return function(selector) {
    const el = selector ? document.querySelector(selector) : null;
    if (!el) return { error: "Element not found: " + selector };

    const s     = getComputedStyle(el);
    const rect  = el.getBoundingClientRect();

    // Build ancestor chain (hierarchy)
    const hierarchy = [];
    let cur = el;
    while (cur && cur !== document.body && hierarchy.length < 6) {
      hierarchy.push({ tag: cur.tagName.toLowerCase(), id: cur.id || null, classes: Array.from(cur.classList).slice(0, 8) });
      cur = cur.parentElement;
    }

    // Try to find React fiber for component name
    let componentPath = null;
    try {
      const fiberKey = Object.keys(el).find(k => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
      if (fiberKey) {
        let fiber = el[fiberKey];
        const components = [];
        while (fiber && components.length < 5) {
          if (fiber.type && typeof fiber.type === "function" && fiber.type.name) {
            components.push(fiber.type.name);
          }
          fiber = fiber.return;
        }
        if (components.length) componentPath = components.join(" < ");
      }
    } catch {}

    return {
      selector,
      tag:     el.tagName.toLowerCase(),
      id:      el.id || null,
      classes: Array.from(el.classList),
      text:    el.innerText?.trim().slice(0, 100) || null,
      bbox:    { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
      spacing: {
        marginTop:    s.marginTop,
        marginRight:  s.marginRight,
        marginBottom: s.marginBottom,
        marginLeft:   s.marginLeft,
        paddingTop:   s.paddingTop,
        paddingRight: s.paddingRight,
        paddingBottom: s.paddingBottom,
        paddingLeft:  s.paddingLeft,
        gap:          s.gap,
      },
      typography: {
        fontFamily:  s.fontFamily.split(",")[0].trim().replace(/['"]/g, ""),
        fontSize:    s.fontSize,
        fontWeight:  s.fontWeight,
        lineHeight:  s.lineHeight,
        letterSpacing: s.letterSpacing,
        textAlign:   s.textAlign,
        color:       s.color,
      },
      colors: {
        foreground:  s.color,
        background:  s.backgroundColor,
        border:      s.borderColor,
        borderWidth: s.borderWidth,
        borderRadius:s.borderRadius,
        opacity:     s.opacity,
      },
      layout: {
        display:    s.display,
        position:   s.position,
        flexDir:    s.flexDirection,
        alignItems: s.alignItems,
        justifyContent: s.justifyContent,
        overflow:   s.overflow,
        zIndex:     s.zIndex,
        width:      s.width,
        height:     s.height,
      },
      hierarchy:     hierarchy.reverse(),
      componentPath: componentPath || "React component path unavailable (build without fiber IDs)",
      sourceFile:    null, // Source maps needed for precise file detection
    };
  };
  /* eslint-enable */
}

// ── Public API ────────────────────────────────────────────────────────────────

async function inspectElement({ url, pageId, selector } = {}) {
  if (!selector) return { ok: false, error: "selector required" };

  const session = _getSession();
  if (!session) return { ok: false, error: "Playwright not available" };

  let page, ownedPageId;

  if (pageId) {
    page = session.getPage?.(pageId);
    if (!page) return { ok: false, error: `Page ${pageId} not found` };
  } else if (url) {
    if (!session.isRunning()) {
      const r = await session.launch({ headless: true });
      if (!r.ok) return { ok: false, error: r.error };
    }
    const r = await session.newPage({ viewport: { width: 1440, height: 900 } });
    if (!r.ok) return { ok: false, error: r.error };
    ownedPageId = r.pageId;
    page = r.page;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  } else {
    return { ok: false, error: "url or pageId required" };
  }

  let data;
  try {
    data = await page.evaluate(_inspectorScript(), selector);
  } catch (e) {
    if (ownedPageId) await session.closePage(ownedPageId).catch(() => {});
    return { ok: false, error: `Inspection failed: ${e.message}` };
  }

  if (ownedPageId) await session.closePage(ownedPageId).catch(() => {});

  if (data.error) return { ok: false, error: data.error };

  _ensureDir();
  const slug = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `inspect-${slug}.json`;
  const record = { ...data, url: url || null, pageId: pageId || null, timestamp: new Date().toISOString() };
  fs.writeFileSync(path.join(INSP_DIR, filename), JSON.stringify(record, null, 2));

  return { ok: true, filename, path: `data/odi/inspector/${filename}`, ...record };
}

async function inspectMultiple({ url, selectors = [] } = {}) {
  if (!selectors.length) return { ok: false, error: "selectors[] required" };
  if (!url) return { ok: false, error: "url required" };

  const session = _getSession();
  if (!session) return { ok: false, error: "Playwright not available" };
  if (!session.isRunning()) {
    const r = await session.launch({ headless: true });
    if (!r.ok) return { ok: false, error: r.error };
  }
  const r = await session.newPage({ viewport: { width: 1440, height: 900 } });
  if (!r.ok) return { ok: false, error: r.error };
  const { pageId, page } = r;

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  } catch (e) {
    await session.closePage(pageId).catch(() => {});
    return { ok: false, error: e.message };
  }

  const results = [];
  for (const sel of selectors) {
    try {
      const data = await page.evaluate(_inspectorScript(), sel);
      results.push({ selector: sel, ok: !data.error, ...data });
    } catch (e) {
      results.push({ selector: sel, ok: false, error: e.message });
    }
  }

  await session.closePage(pageId).catch(() => {});
  return { ok: true, url, results };
}

function listInspections({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(INSP_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(INSP_DIR, f), "utf8"));
        return { filename: f, selector: d.selector, url: d.url, tag: d.tag, timestamp: d.timestamp };
      } catch { return null; }
    }).filter(Boolean);
}

module.exports = { inspectElement, inspectMultiple, listInspections };
