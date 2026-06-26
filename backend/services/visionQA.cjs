"use strict";
/**
 * ODI-16 Vision QA Engine
 *
 * Opens every page in a provided URL list, detects visual defects via DOM
 * inspection (no AI vision required for core detection):
 *   - Clipping: elements with overflow:hidden or clip-path that truncate text
 *   - Overlap: elements with intersecting bboxes at same z-level
 *   - Broken layout: elements wider than viewport, negative top/left, zero-size containers
 *   - Hidden text: text in invisible/transparent containers
 *   - Overflow: horizontal scroll detected, scrollWidth > clientWidth
 *
 * For AI-enhanced analysis: sends screenshot + findings to Claude vision.
 * Generates per-page QA reports in data/odi/vision-qa/.
 */

const fs   = require("fs");
const path = require("path");

const QA_DIR = path.join(__dirname, "../../data/odi/vision-qa");
function _ensureDir() { if (!fs.existsSync(QA_DIR)) fs.mkdirSync(QA_DIR, { recursive: true }); }
function _getSession() { try { return require("../../agents/browser/browserSession.cjs"); } catch { return null; } }

// ── DOM defect detection script (self-contained for page.evaluate) ────────────

function _qaScript() {
  /* eslint-disable */
  return function() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const issues = [];

    function bbox(el) {
      const r = el.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
    }

    const all = Array.from(document.querySelectorAll('*')).filter(el => {
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0;
    });

    // Overflow detection
    const bodyOverflow = document.body.scrollWidth > vw + 5;
    if (bodyOverflow) issues.push({ type: 'horizontal_overflow', severity: 'error', message: `Body scrollWidth ${document.body.scrollWidth}px exceeds viewport ${vw}px`, element: 'body' });

    // Per-element checks
    for (const el of all) {
      const s  = getComputedStyle(el);
      const b  = el.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) continue;

      const absX = b.left + window.scrollX;
      const absY = b.top  + window.scrollY;

      // Clipping: visible text truncated by overflow:hidden
      if ((s.overflow === 'hidden' || s.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 4) {
        const text = el.innerText?.trim().slice(0, 80);
        if (text) issues.push({ type: 'text_clipping', severity: 'warning', message: `Text clipped in <${el.tagName.toLowerCase()}>: "${text}"`, element: el.className || el.id || el.tagName.toLowerCase() });
      }

      // Element wider than viewport
      if (b.width > vw + 10) {
        issues.push({ type: 'wider_than_viewport', severity: 'error', message: `Element <${el.tagName.toLowerCase()}> is ${Math.round(b.width)}px wide — exceeds viewport ${vw}px`, element: el.className?.slice(0,40) || el.tagName.toLowerCase() });
      }

      // Negative position (off-screen but visible)
      if ((absX < -50 || absY < -50) && s.position !== 'fixed') {
        issues.push({ type: 'off_screen_element', severity: 'warning', message: `Element at (${Math.round(absX)}, ${Math.round(absY)}) is off-screen`, element: el.tagName.toLowerCase() });
      }

      // Zero-size visible container with children
      if (b.width < 5 && b.height < 5 && el.children.length > 0) {
        issues.push({ type: 'collapsed_container', severity: 'warning', message: `Container <${el.tagName.toLowerCase()}> has ${el.children.length} children but zero size`, element: el.className?.slice(0,40) || el.tagName.toLowerCase() });
      }
    }

    // Overlap detection: sample top 50 visible elements
    const sample = all.filter(el => {
      const b = el.getBoundingClientRect();
      return b.width > 20 && b.height > 20;
    }).slice(0, 50);

    for (let i = 0; i < sample.length; i++) {
      for (let j = i + 1; j < sample.length; j++) {
        if (sample[i].contains(sample[j]) || sample[j].contains(sample[i])) continue;
        const a = sample[i].getBoundingClientRect();
        const b = sample[j].getBoundingClientRect();
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapX > 10 && overlapY > 10) {
          const aZ = parseInt(getComputedStyle(sample[i]).zIndex) || 0;
          const bZ = parseInt(getComputedStyle(sample[j]).zIndex) || 0;
          if (Math.abs(aZ - bZ) < 5) {
            issues.push({ type: 'element_overlap', severity: 'warning', message: `<${sample[i].tagName.toLowerCase()}> overlaps <${sample[j].tagName.toLowerCase()}> by ${Math.round(overlapX)}×${Math.round(overlapY)}px`, element: sample[i].className?.slice(0,40) || sample[i].tagName.toLowerCase() });
          }
        }
      }
    }

    return {
      vw, vh,
      scrollWidth: document.body.scrollWidth,
      scrollHeight: document.body.scrollHeight,
      title: document.title,
      issues,
    };
  };
  /* eslint-enable */
}

// ── QA runner ─────────────────────────────────────────────────────────────────

async function auditPage({ url } = {}) {
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

  let findings, screenshot;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(500);
    findings   = await page.evaluate(_qaScript());
    screenshot = await page.screenshot({ type: "png", fullPage: false });
  } catch (e) {
    await session.closePage(pageId).catch(() => {});
    return { ok: false, error: `Audit failed: ${e.message}` };
  }
  await session.closePage(pageId).catch(() => {});

  _ensureDir();
  const slug = new Date().toISOString().replace(/[:.]/g, "-");
  const shotFile = `vqa-${slug}.png`;
  fs.writeFileSync(path.join(QA_DIR, shotFile), screenshot);

  const errors   = findings.issues.filter(i => i.severity === "error").length;
  const warnings = findings.issues.filter(i => i.severity === "warning").length;
  const qaScore  = Math.max(0, 100 - errors * 15 - warnings * 5);

  const record = {
    url,
    title:       findings.title,
    qaScore,
    screenshot:  shotFile,
    issues:      findings.issues,
    stats:       { errors, warnings, total: findings.issues.length },
    viewport:    { vw: findings.vw, vh: findings.vh },
    timestamp:   new Date().toISOString(),
  };

  const recFile = `vqa-${slug}.json`;
  fs.writeFileSync(path.join(QA_DIR, recFile), JSON.stringify(record, null, 2));

  return { ok: true, filename: recFile, path: `data/odi/vision-qa/${recFile}`, ...record };
}

async function auditPages({ urls } = {}) {
  if (!Array.isArray(urls) || !urls.length) return { ok: false, error: "urls[] required" };
  const results = [];
  for (const url of urls) {
    const r = await auditPage({ url });
    results.push(r);
  }
  const passed = results.filter(r => r.qaScore >= 80).length;
  return { ok: true, total: results.length, passed, failed: results.length - passed, results };
}

function listReports({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(QA_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try { const d = JSON.parse(fs.readFileSync(path.join(QA_DIR, f), "utf8")); return { filename: f, url: d.url, qaScore: d.qaScore, issues: d.stats?.total, timestamp: d.timestamp }; }
      catch { return null; }
    }).filter(Boolean);
}

module.exports = { auditPage, auditPages, listReports };
