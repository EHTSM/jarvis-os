"use strict";
/**
 * ODI-8 Responsive Simulator
 *
 * Tests a URL at 5 canonical viewports using Playwright:
 *   Mobile    375×667   (iPhone SE)
 *   Tablet    768×1024  (iPad portrait)
 *   Laptop    1280×800
 *   Desktop   1440×900
 *   Ultrawide 1920×1080
 *
 * Per viewport:
 *   - Takes a screenshot
 *   - Extracts DOM metrics (overflow, hidden text, stacked layout)
 *   - Detects horizontal scroll (viewport overflow)
 *   - Reports layout shift indicators
 *
 * Returns a full responsive report with per-viewport findings.
 */

const fs   = require("fs");
const path = require("path");

const RESPONSIVE_DIR = path.join(__dirname, "../../data/odi/responsive");

function _ensureDir() {
  if (!fs.existsSync(RESPONSIVE_DIR)) fs.mkdirSync(RESPONSIVE_DIR, { recursive: true });
}

function _getSession() {
  try { return require("../../agents/browser/browserSession.cjs"); }
  catch { return null; }
}

const VIEWPORTS = [
  { name: "mobile",    width: 375,  height: 667,  device: "iPhone SE" },
  { name: "tablet",    width: 768,  height: 1024, device: "iPad Portrait" },
  { name: "laptop",    width: 1280, height: 800,  device: "Laptop" },
  { name: "desktop",   width: 1440, height: 900,  device: "Desktop" },
  { name: "ultrawide", width: 1920, height: 1080, device: "Ultrawide" },
];

// Self-contained — runs inside page.evaluate()
function _responsiveMetrics() {
  /* eslint-disable no-undef */
  const body = document.body;
  const html = document.documentElement;

  const scrollWidth = Math.max(body.scrollWidth, html.scrollWidth);
  const viewWidth   = window.innerWidth;
  const hasHScroll  = scrollWidth > viewWidth + 4;

  // Detect truncated/hidden text
  const textNodes = document.querySelectorAll("p, h1, h2, h3, h4, li, span, a, button");
  let truncatedCount = 0;
  for (const el of textNodes) {
    if (el.scrollWidth > el.clientWidth + 2 && window.getComputedStyle(el).overflow !== "visible") {
      truncatedCount++;
    }
  }

  // Images wider than viewport
  const imgs = Array.from(document.querySelectorAll("img")).filter(img => {
    const r = img.getBoundingClientRect();
    return r.width > viewWidth + 4;
  });

  // Elements that overflow horizontally
  const overflowEls = Array.from(document.querySelectorAll("*")).filter(el => {
    const r = el.getBoundingClientRect();
    return r.x + r.width > viewWidth + 8 && r.width > 20;
  }).slice(0, 10).map(el => ({
    tag:     el.tagName.toLowerCase(),
    cls:     el.className.slice(0, 40),
    overflowBy: Math.round(el.getBoundingClientRect().right - viewWidth),
  }));

  // Stacking: elements that are side-by-side on desktop may stack differently
  const sideBySize = Array.from(document.querySelectorAll("[class*=col],[class*=flex],[class*=grid]"))
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > viewWidth * 0.9 && r.width > 200;
    }).length;

  return {
    viewport:       { width: viewWidth, height: window.innerHeight },
    hasHScroll,
    scrollWidth,
    viewWidth,
    overflowBy:     hasHScroll ? scrollWidth - viewWidth : 0,
    truncatedText:  truncatedCount,
    oversizedImages: imgs.length,
    overflowElements: overflowEls,
    fullWidthContainers: sideBySize,
  };
  /* eslint-enable no-undef */
}

async function _testViewport(page, vp) {
  try {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    // Wait for reflow
    await page.waitForTimeout(300);

    const metrics   = await page.evaluate(_responsiveMetrics);
    const buffer    = await page.screenshot({ type: "png", fullPage: false });
    const slug      = new Date().toISOString().replace(/[:.]/g, "-");
    const imgFile   = `responsive-${vp.name}-${slug}.png`;
    _ensureDir();
    const imgPath   = path.join(RESPONSIVE_DIR, imgFile);
    fs.writeFileSync(imgPath, buffer);

    const findings = [];
    if (metrics.hasHScroll) {
      findings.push({ severity: "error", type: "horizontal_scroll", message: `Page has horizontal scroll — ${metrics.overflowBy}px beyond ${vp.width}px viewport` });
    }
    if (metrics.truncatedText > 0) {
      findings.push({ severity: "warning", type: "text_truncation", count: metrics.truncatedText, message: `${metrics.truncatedText} text element(s) have truncated/hidden overflow` });
    }
    if (metrics.oversizedImages > 0) {
      findings.push({ severity: "warning", type: "oversized_image", count: metrics.oversizedImages, message: `${metrics.oversizedImages} image(s) wider than viewport` });
    }
    for (const ov of metrics.overflowElements) {
      findings.push({ severity: "error", type: "element_overflow", message: `<${ov.tag}> overflows by ${ov.overflowBy}px`, element: ov });
    }

    return {
      viewport:  vp,
      ok:        true,
      metrics,
      findings,
      screenshot: `data/odi/responsive/${imgFile}`,
      score:     findings.filter(f => f.severity === "error").length === 0
        ? (100 - findings.filter(f => f.severity === "warning").length * 10)
        : (50 - findings.filter(f => f.severity === "error").length * 15),
    };
  } catch (e) {
    return { viewport: vp, ok: false, error: e.message, findings: [], score: 0 };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

async function simulate({ url, viewports } = {}) {
  if (!url) return { ok: false, error: "url required" };

  const session = _getSession();
  if (!session) return { ok: false, error: "Playwright not available" };

  if (!session.isRunning()) {
    const r = await session.launch({ headless: true });
    if (!r.ok) return { ok: false, error: r.error };
  }
  const r = await session.newPage();
  if (!r.ok) return { ok: false, error: r.error };
  const { pageId, page } = r;

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
  } catch (e) {
    await session.closePage(pageId).catch(() => {});
    return { ok: false, error: `Navigation failed: ${e.message}` };
  }

  const targets = viewports && viewports.length ? viewports : VIEWPORTS;
  const results = [];
  for (const vp of targets) {
    results.push(await _testViewport(page, vp));
  }

  await session.closePage(pageId).catch(() => {});

  const summary = {
    totalViewports: results.length,
    passed:  results.filter(r => r.ok && r.findings.filter(f => f.severity === "error").length === 0).length,
    failed:  results.filter(r => r.ok && r.findings.filter(f => f.severity === "error").length > 0).length,
    errored: results.filter(r => !r.ok).length,
    avgScore: Math.round(results.filter(r => r.ok).reduce((s, r) => s + r.score, 0) / (results.filter(r => r.ok).length || 1)),
    allFindings: results.flatMap(r => r.findings.map(f => ({ viewport: r.viewport.name, ...f }))),
  };

  _ensureDir();
  const slug = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `responsive-report-${slug}.json`;
  const out = { url, results, summary, timestamp: new Date().toISOString() };
  fs.writeFileSync(path.join(RESPONSIVE_DIR, filename), JSON.stringify(out, null, 2));

  return { ok: true, filename, path: `data/odi/responsive/${filename}`, results, summary };
}

function listReports({ limit = 20 } = {}) {
  _ensureDir();
  return fs.readdirSync(RESPONSIVE_DIR)
    .filter(f => f.startsWith("responsive-report") && f.endsWith(".json"))
    .sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(RESPONSIVE_DIR, f), "utf8"));
        return { filename: f, url: d.url, summary: d.summary, timestamp: d.timestamp };
      } catch { return null; }
    }).filter(Boolean);
}

module.exports = { simulate, listReports, VIEWPORTS };
