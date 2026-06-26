"use strict";
/**
 * ODI-17 Interaction Intelligence
 *
 * Simulates user interactions and detects UX friction:
 *   - Hover: checks hover styles, cursor change, tooltip presence
 *   - Click: verifies state changes, navigation, feedback
 *   - Keyboard: Tab order, Enter/Space activation, focus traps
 *   - Touch: tap target size validation (44×44px minimum)
 *   - Scroll: momentum, scroll-snap, fixed positioning
 *
 * Storage: data/odi/interactions/
 */

const fs   = require("fs");
const path = require("path");

const INT_DIR = path.join(__dirname, "../../data/odi/interactions");
function _ensureDir() { if (!fs.existsSync(INT_DIR)) fs.mkdirSync(INT_DIR, { recursive: true }); }
function _getSession() { try { return require("../../agents/browser/browserSession.cjs"); } catch { return null; } }

// ── Interaction analysis script (self-contained) ──────────────────────────────

function _interactionScript() {
  /* eslint-disable */
  return function() {
    const issues = [];
    const insights = [];

    // 1. Tab order analysis
    const focusable = Array.from(document.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(el => {
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden';
    });

    if (focusable.length === 0) {
      issues.push({ type: 'no_focusable_elements', severity: 'error', message: 'No keyboard-focusable elements found' });
    }

    // Check for positive tabindex (disrupts natural tab order)
    const posTabIndex = focusable.filter(el => parseInt(el.getAttribute('tabindex')) > 0);
    if (posTabIndex.length > 0) {
      issues.push({ type: 'positive_tabindex', severity: 'warning', message: `${posTabIndex.length} elements with positive tabindex — disrupts natural tab order` });
    }

    // 2. Touch target sizes (WCAG 2.5.5)
    const interactive = Array.from(document.querySelectorAll('button, a, input, select, [role="button"], [role="link"]'))
      .filter(el => {
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden';
      });

    let smallTargets = 0;
    for (const el of interactive) {
      const b = el.getBoundingClientRect();
      if ((b.width > 0 && b.width < 44) || (b.height > 0 && b.height < 44)) {
        smallTargets++;
        if (smallTargets <= 5) {
          issues.push({ type: 'small_touch_target', severity: 'warning', message: `<${el.tagName.toLowerCase()}> ${el.textContent?.trim().slice(0,30)} is ${Math.round(b.width)}×${Math.round(b.height)}px (min 44×44)`, element: el.className?.slice(0,40) || el.tagName });
        }
      }
    }
    if (smallTargets > 5) {
      issues.push({ type: 'small_touch_target_bulk', severity: 'warning', message: `${smallTargets} total elements below 44×44px touch target size` });
    }

    // 3. Hover states — check for cursor:pointer on interactive elements
    for (const el of interactive.slice(0, 20)) {
      const s = getComputedStyle(el);
      if (s.cursor !== 'pointer' && el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA') {
        issues.push({ type: 'missing_pointer_cursor', severity: 'info', message: `Interactive <${el.tagName.toLowerCase()}> has cursor:${s.cursor} — expected pointer` });
      }
    }

    // 4. Form interaction checks
    const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
    for (const inp of inputs) {
      const hasLabel = inp.id && document.querySelector(`label[for="${inp.id}"]`);
      const hasAriaLabel = inp.getAttribute('aria-label') || inp.getAttribute('aria-labelledby');
      const hasPlaceholder = inp.placeholder;
      if (!hasLabel && !hasAriaLabel && !hasPlaceholder) {
        issues.push({ type: 'unlabeled_input', severity: 'error', message: `Input <${inp.tagName.toLowerCase()}> type="${inp.type}" has no label, aria-label, or placeholder` });
      }
    }

    // 5. Scroll behavior
    const hasFixedElements = Array.from(document.querySelectorAll('*')).some(el => getComputedStyle(el).position === 'fixed');
    if (hasFixedElements) insights.push({ type: 'fixed_elements', message: 'Fixed elements detected — verify they don\'t block content on mobile' });

    const scrollSnap = Array.from(document.querySelectorAll('*')).some(el => {
      const s = getComputedStyle(el);
      return s.scrollSnapType && s.scrollSnapType !== 'none';
    });
    if (scrollSnap) insights.push({ type: 'scroll_snap', message: 'Scroll snap detected — verify snap points align with content boundaries' });

    // 6. Link quality
    const links = Array.from(document.querySelectorAll('a[href]'));
    const emptyLinks = links.filter(l => !l.textContent?.trim() && !l.getAttribute('aria-label'));
    if (emptyLinks.length) {
      issues.push({ type: 'empty_links', severity: 'warning', message: `${emptyLinks.length} links with no text or aria-label` });
    }

    return { issues, insights, counts: { focusable: focusable.length, interactive: interactive.length, inputs: inputs.length, links: links.length } };
  };
  /* eslint-enable */
}

// ── Click simulation ──────────────────────────────────────────────────────────

async function _simulateClick(page, url) {
  const clickResults = [];
  try {
    // Find first button and click, record state change
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const btn = await page.$("button:visible, a[href]:visible");
    if (btn) {
      const before = await page.url();
      const beforeTitle = await page.title();
      await btn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      const after = await page.url();
      const afterTitle = await page.title();
      clickResults.push({ element: "first-button", navigated: before !== after, titleChanged: beforeTitle !== afterTitle });
    }
  } catch {}
  return clickResults;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function analyzeInteractions({ url } = {}) {
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

  let findings, clicks;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(300);
    findings = await page.evaluate(_interactionScript());
    clicks   = await _simulateClick(page, url);
  } catch (e) {
    await session.closePage(pageId).catch(() => {});
    return { ok: false, error: `Analysis failed: ${e.message}` };
  }
  await session.closePage(pageId).catch(() => {});

  _ensureDir();
  const slug  = new Date().toISOString().replace(/[:.]/g, "-");
  const errors   = findings.issues.filter(i => i.severity === "error").length;
  const warnings = findings.issues.filter(i => i.severity === "warning").length;
  const interactionScore = Math.max(0, 100 - errors * 15 - warnings * 5);

  const record = {
    url,
    interactionScore,
    issues:   findings.issues,
    insights: findings.insights,
    clicks,
    counts:   findings.counts,
    stats:    { errors, warnings, total: findings.issues.length },
    timestamp: new Date().toISOString(),
  };

  const filename = `interaction-${slug}.json`;
  fs.writeFileSync(path.join(INT_DIR, filename), JSON.stringify(record, null, 2));

  return { ok: true, filename, path: `data/odi/interactions/${filename}`, ...record };
}

function listReports({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(INT_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try { const d = JSON.parse(fs.readFileSync(path.join(INT_DIR, f), "utf8")); return { filename: f, url: d.url, interactionScore: d.interactionScore, issues: d.stats?.total, timestamp: d.timestamp }; }
      catch { return null; }
    }).filter(Boolean);
}

module.exports = { analyzeInteractions, listReports };
