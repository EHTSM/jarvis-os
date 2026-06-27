"use strict";
/**
 * ODI-26 Live Design Editor
 *
 * Applies live CSS/layout changes to a running page via Playwright:
 *   - spacing, radius, colors, typography, layout adjustments
 *
 * Workflow:
 *   1. Open target page (or use existing pageId)
 *   2. Apply CSS change via page.addStyleTag({ content })
 *   3. Take before/after screenshots
 *   4. Return diff summary
 *   5. If approved: translate CSS change to Tailwind class patch (patchSpec)
 *      using ODI-9 uiPatchGenerator format for commit
 *
 * Preview-before-commit — changes are NOT written to disk unless explicitly
 * confirmed via /odi/editor/:sessionId/commit
 *
 * Storage: data/odi/editor/
 */

const fs   = require("fs");
const path = require("path");

const EDIT_DIR = path.join(__dirname, "../../data/odi/editor");
function _ensureDir() { if (!fs.existsSync(EDIT_DIR)) fs.mkdirSync(EDIT_DIR, { recursive: true }); }
function _getSession() { try { return require("../../agents/browser/browserSession.cjs"); } catch { return null; } }

// ── CSS change builders ───────────────────────────────────────────────────────

function _buildCSS(selector, changes) {
  const rules = [];
  if (changes.spacing != null)       rules.push(`padding: ${changes.spacing}px !important;`);
  if (changes.paddingTop != null)    rules.push(`padding-top: ${changes.paddingTop}px !important;`);
  if (changes.paddingX != null)      rules.push(`padding-left: ${changes.paddingX}px !important; padding-right: ${changes.paddingX}px !important;`);
  if (changes.margin != null)        rules.push(`margin: ${changes.margin}px !important;`);
  if (changes.radius != null)        rules.push(`border-radius: ${changes.radius}px !important;`);
  if (changes.color != null)         rules.push(`color: ${changes.color} !important;`);
  if (changes.backgroundColor != null) rules.push(`background-color: ${changes.backgroundColor} !important;`);
  if (changes.fontSize != null)      rules.push(`font-size: ${changes.fontSize}px !important;`);
  if (changes.fontWeight != null)    rules.push(`font-weight: ${changes.fontWeight} !important;`);
  if (changes.lineHeight != null)    rules.push(`line-height: ${changes.lineHeight}px !important;`);
  if (changes.gap != null)           rules.push(`gap: ${changes.gap}px !important;`);
  if (changes.flexDirection != null) rules.push(`flex-direction: ${changes.flexDirection} !important;`);
  if (changes.width != null)         rules.push(`width: ${changes.width} !important;`);
  if (changes.maxWidth != null)      rules.push(`max-width: ${changes.maxWidth} !important;`);
  if (changes.display != null)       rules.push(`display: ${changes.display} !important;`);
  if (!rules.length) return null;
  return `${selector} { ${rules.join(" ")} }`;
}

// ── Session manager ───────────────────────────────────────────────────────────

const _sessions = new Map();

async function startSession({ url } = {}) {
  if (!url) return { ok: false, error: "url required" };

  const session = _getSession();
  if (!session) return { ok: false, error: "Playwright not available" };
  if (!session.isRunning()) {
    const r = await session.launch({ headless: false }); // visible for live preview
    if (!r.ok) return { ok: false, error: r.error };
  }

  const r = await session.newPage({ viewport: { width: 1440, height: 900 } });
  if (!r.ok) return { ok: false, error: r.error };

  try {
    await r.page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  } catch (e) {
    await session.closePage(r.pageId).catch(() => {});
    return { ok: false, error: e.message };
  }

  const before = await r.page.screenshot({ type: "png" });
  const sessionId = `edit-${Date.now()}`;
  _sessions.set(sessionId, { pageId: r.pageId, page: r.page, url, appliedCSS: [], patches: [], before });

  _ensureDir();
  const beforeFile = `${sessionId}-before.png`;
  fs.writeFileSync(path.join(EDIT_DIR, beforeFile), before);

  return { ok: true, sessionId, url, beforeScreenshot: `data/odi/editor/${beforeFile}` };
}

async function applyChange({ sessionId, selector, changes } = {}) {
  if (!sessionId || !selector || !changes) return { ok: false, error: "sessionId, selector, changes required" };

  const s = _sessions.get(sessionId);
  if (!s) return { ok: false, error: `Session not found: ${sessionId}` };

  const css = _buildCSS(selector, changes);
  if (!css) return { ok: false, error: "No valid CSS changes provided" };

  try {
    await s.page.addStyleTag({ content: css });
    await s.page.waitForTimeout(200);
    const after = await s.page.screenshot({ type: "png" });

    const afterFile = `${sessionId}-after-${Date.now()}.png`;
    fs.writeFileSync(path.join(EDIT_DIR, afterFile), after);

    s.appliedCSS.push({ selector, changes, css });

    return { ok: true, sessionId, selector, cssApplied: css, afterScreenshot: `data/odi/editor/${afterFile}` };
  } catch (e) {
    return { ok: false, error: `Apply failed: ${e.message}` };
  }
}

async function previewChange({ sessionId, selector, changes } = {}) {
  const result = await applyChange({ sessionId, selector, changes });
  return result; // Preview IS the apply in headless — it's non-destructive (CSS only, not file)
}

function commitSession(sessionId, targetFile) {
  const s = _sessions.get(sessionId);
  if (!s) return { ok: false, error: `Session not found: ${sessionId}` };
  if (!s.appliedCSS.length) return { ok: false, error: "No changes to commit" };

  // Translate CSS changes to Tailwind patchSpecs
  const patchSpecs = s.appliedCSS.map(c => {
    const changeKeys = Object.keys(c.changes).join("+");
    return {
      patchTarget:     `/* ODI-26 editor will fill after file analysis — ${c.selector} ${changeKeys} */`,
      patchReplacement: c.css,
      selector:        c.selector,
      changes:         c.changes,
      note:           "Manual review required — apply Tailwind classes matching these CSS values",
    };
  });

  _ensureDir();
  const recFile = `${sessionId}-commit.json`;
  const record  = { sessionId, url: s.url, targetFile: targetFile || null, appliedChanges: s.appliedCSS.length, patchSpecs, committedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(EDIT_DIR, recFile), JSON.stringify(record, null, 2));

  return { ok: true, sessionId, patchSpecs, filename: recFile, path: `data/odi/editor/${recFile}`, message: "Patch specs generated — apply via ODI-9 patch generator for git commit" };
}

async function closeSession(sessionId) {
  const s = _sessions.get(sessionId);
  if (!s) return { ok: false, error: "Session not found" };
  const session = _getSession();
  if (session) await session.closePage(s.pageId).catch(() => {});
  _sessions.delete(sessionId);
  return { ok: true };
}

function listSessions() {
  return [..._sessions.entries()].map(([id, s]) => ({ sessionId: id, url: s.url, changes: s.appliedCSS.length }));
}

function listEdits({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(EDIT_DIR)
    .filter(f => f.endsWith("-commit.json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(EDIT_DIR, f), "utf8"));
        return { filename: f, sessionId: d.sessionId, url: d.url, changes: d.appliedChanges, committedAt: d.committedAt };
      } catch { return null; }
    }).filter(Boolean);
}

module.exports = { startSession, applyChange, previewChange, commitSession, closeSession, listSessions, listEdits };
