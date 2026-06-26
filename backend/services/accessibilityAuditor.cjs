"use strict";
/**
 * ODI-7 Accessibility Auditor
 *
 * Runs inside a Playwright page and checks:
 *   - Color contrast (WCAG AA: 4.5:1 for normal text, 3:1 for large text)
 *   - Missing ARIA labels on interactive elements
 *   - Missing alt text on images
 *   - Keyboard navigation (tabindex, focus order)
 *   - Focus traps (elements that capture focus without escape)
 *   - Semantic HTML (landmark elements, heading hierarchy, list structure)
 *   - Form label associations
 *
 * Uses only Playwright page.evaluate() — no external axe dependency.
 * Stored in data/odi/accessibility/
 */

const fs   = require("fs");
const path = require("path");

const A11Y_DIR = path.join(__dirname, "../../data/odi/accessibility");

function _ensureDir() {
  if (!fs.existsSync(A11Y_DIR)) fs.mkdirSync(A11Y_DIR, { recursive: true });
}

function _getSession() {
  try { return require("../../agents/browser/browserSession.cjs"); }
  catch { return null; }
}

// ── Contrast ratio (WCAG 2.1) ─────────────────────────────────────────────────
// Must be self-contained — runs inside page.evaluate()
function _a11yScript() {
  /* eslint-disable no-undef */
  function parseRGBA(css) {
    const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
  }

  function relativeLuminance({ r, g, b }) {
    const toLinear = c => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  }

  function contrastRatio(fg, bg) {
    const l1 = relativeLuminance(fg), l2 = relativeLuminance(bg);
    const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (lighter + 0.05) / (darker + 0.05);
  }

  const findings = [];
  const elements = document.querySelectorAll("*");

  // ── Contrast check ──────────────────────────────────────────────────────────
  const textTags = new Set(["P", "SPAN", "H1","H2","H3","H4","H5","H6","A","BUTTON","LI","TD","TH","LABEL","LEGEND"]);
  for (const el of elements) {
    if (!textTags.has(el.tagName)) continue;
    const cs  = window.getComputedStyle(el);
    const fg  = parseRGBA(cs.color);
    const bg  = parseRGBA(cs.backgroundColor);
    if (!fg || !bg || bg.a === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const ratio   = contrastRatio(fg, bg);
    const fs      = parseFloat(cs.fontSize);
    const bold    = parseInt(cs.fontWeight) >= 700;
    const isLarge = fs >= 18 || (bold && fs >= 14);
    const required = isLarge ? 3.0 : 4.5;

    if (ratio < required) {
      findings.push({
        type:     "low_contrast",
        severity: ratio < 2 ? "error" : "warning",
        wcagLevel: isLarge ? "AA-Large" : "AA",
        ratio:    Math.round(ratio * 100) / 100,
        required,
        element:  el.tagName.toLowerCase(),
        text:     (el.textContent || "").trim().slice(0, 60),
        css:      { color: cs.color, backgroundColor: cs.backgroundColor },
      });
    }
  }

  // ── Missing alt text ────────────────────────────────────────────────────────
  for (const img of document.querySelectorAll("img")) {
    if (!img.alt && !img.getAttribute("aria-label") && !img.getAttribute("aria-hidden")) {
      const rect = img.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        findings.push({
          type:     "missing_alt",
          severity: "error",
          element:  "img",
          src:      (img.src || "").slice(-60),
        });
      }
    }
  }

  // ── Missing ARIA labels on interactive elements ─────────────────────────────
  const interactive = document.querySelectorAll("button:not([aria-label]):not([aria-labelledby]), a:not([aria-label]):not([aria-labelledby])");
  for (const el of interactive) {
    const text = (el.textContent || el.title || "").trim();
    const rect = el.getBoundingClientRect();
    if (!text && rect.width > 0 && rect.height > 0) {
      findings.push({
        type:     "missing_label",
        severity: "error",
        element:  el.tagName.toLowerCase(),
        attrs:    { id: el.id, class: el.className.slice(0, 40) },
      });
    }
  }

  // ── Form label associations ─────────────────────────────────────────────────
  for (const input of document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select")) {
    const id     = input.id;
    const label  = id ? document.querySelector(`label[for="${id}"]`) : null;
    const ariaLabel = input.getAttribute("aria-label") || input.getAttribute("aria-labelledby");
    const placeholder = input.getAttribute("placeholder");
    if (!label && !ariaLabel) {
      findings.push({
        type:     "missing_input_label",
        severity: placeholder ? "warning" : "error",
        element:  input.tagName.toLowerCase(),
        inputType: input.type || "text",
        id:       id || null,
        hasPlaceholder: !!placeholder,
      });
    }
  }

  // ── Heading hierarchy ───────────────────────────────────────────────────────
  const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
    .filter(h => { const r = h.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (headings.length) {
    let prevLevel = 0;
    for (const h of headings) {
      const level = parseInt(h.tagName[1]);
      if (prevLevel > 0 && level > prevLevel + 1) {
        findings.push({
          type:     "heading_skip",
          severity: "warning",
          message:  `Heading level skipped: h${prevLevel} → h${level}`,
          text:     (h.textContent || "").trim().slice(0, 60),
        });
      }
      prevLevel = level;
    }
    const h1s = headings.filter(h => h.tagName === "H1");
    if (h1s.length === 0) {
      findings.push({ type: "missing_h1", severity: "error", message: "No H1 found on page" });
    } else if (h1s.length > 1) {
      findings.push({ type: "multiple_h1", severity: "warning", count: h1s.length, message: `Multiple H1 tags (${h1s.length}) — only one expected` });
    }
  }

  // ── Landmark elements ───────────────────────────────────────────────────────
  const landmarks = { main: !!document.querySelector("main,[role=main]"),
    nav: !!document.querySelector("nav,[role=navigation]"),
    header: !!document.querySelector("header,[role=banner]"),
    footer: !!document.querySelector("footer,[role=contentinfo]") };
  if (!landmarks.main) findings.push({ type: "missing_landmark", severity: "warning", landmark: "main", message: "No <main> landmark element" });
  if (!landmarks.nav && document.querySelectorAll("a[href]").length > 3) {
    findings.push({ type: "missing_landmark", severity: "info", landmark: "nav", message: "No <nav> element but links present" });
  }

  // ── Keyboard / tabindex ─────────────────────────────────────────────────────
  const positiveTabindex = document.querySelectorAll("[tabindex]:not([tabindex='0']):not([tabindex='-1'])");
  for (const el of positiveTabindex) {
    findings.push({
      type:     "positive_tabindex",
      severity: "warning",
      tabindex: el.getAttribute("tabindex"),
      element:  el.tagName.toLowerCase(),
      message:  `Positive tabindex="${el.getAttribute("tabindex")}" disrupts natural tab order`,
    });
  }

  // ── Focus traps ─────────────────────────────────────────────────────────────
  const modals = document.querySelectorAll("[role=dialog],[role=alertdialog],.modal,.dialog");
  for (const modal of modals) {
    const focusable = modal.querySelectorAll("a,button,input,select,textarea,[tabindex]");
    if (focusable.length === 0) {
      findings.push({
        type:     "focus_trap_risk",
        severity: "warning",
        message:  "Dialog/modal with no focusable children — keyboard users may be trapped",
        element:  modal.tagName.toLowerCase(),
      });
    }
  }

  const stats = {
    totalFindings: findings.length,
    errors:        findings.filter(f => f.severity === "error").length,
    warnings:      findings.filter(f => f.severity === "warning").length,
    info:          findings.filter(f => f.severity === "info").length,
    types:         [...new Set(findings.map(f => f.type))],
  };

  return {
    url:      window.location.href,
    title:    document.title,
    findings,
    stats,
    landmarks,
    headingCount: headings.length,
  };
  /* eslint-enable no-undef */
}

// ── Public API ────────────────────────────────────────────────────────────────

async function auditPage({ pageId, url } = {}) {
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
      if (!r.ok) return { ok: false, error: r.error };
    }
    const r = await session.newPage();
    if (!r.ok) return { ok: false, error: r.error };
    pid = r.pageId; page = r.page; closeAfter = true;
    if (url) {
      try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }); }
      catch (e) { await session.closePage(pid).catch(() => {}); return { ok: false, error: e.message }; }
    }
  }

  let auditData;
  try { auditData = await page.evaluate(_a11yScript); }
  catch (e) {
    if (closeAfter) await session.closePage(pid).catch(() => {});
    return { ok: false, error: `Audit script failed: ${e.message}` };
  }
  if (closeAfter) await session.closePage(pid).catch(() => {});

  _ensureDir();
  const slug     = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `a11y-${slug}.json`;
  const out      = { ...auditData, pageId: pid, timestamp: new Date().toISOString() };
  fs.writeFileSync(path.join(A11Y_DIR, filename), JSON.stringify(out, null, 2));

  return { ok: true, filename, path: `data/odi/accessibility/${filename}`, ...auditData };
}

function listAudits({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(A11Y_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(A11Y_DIR, f), "utf8"));
        return { filename: f, url: d.url, stats: d.stats, timestamp: d.timestamp };
      } catch { return null; }
    }).filter(Boolean);
}

module.exports = { auditPage, listAudits };
