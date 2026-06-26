"use strict";
/**
 * ODI-6 Design Token Engine
 *
 * Automatically extracts design tokens from a DOM snapshot:
 *   - Colors (foreground, background, border — deduplicated, grouped by usage)
 *   - Spacing (padding + margin values normalized to px)
 *   - Typography (font families, sizes, weights, line-heights)
 *   - Shadows (box-shadow values)
 *   - Border radius values
 *   - Icon sizes (img/svg bounding boxes)
 *
 * Outputs W3C Design Token Community Group compatible JSON format.
 */

const fs   = require("fs");
const path = require("path");

const TOKENS_DIR = path.join(__dirname, "../../data/odi/tokens");

function _ensureDir() {
  if (!fs.existsSync(TOKENS_DIR)) fs.mkdirSync(TOKENS_DIR, { recursive: true });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _parsePx(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }

function _normalizeColor(c) {
  if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)") return null;
  return c.trim().toLowerCase();
}

function _freq(arr) {
  const m = new Map();
  for (const v of arr) m.set(v, (m.get(v) || 0) + 1);
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}

function _toHex(rgb) {
  // Convert "rgb(r, g, b)" or "rgba(r,g,b,a)" to hex
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return rgb;
  const hex = [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, "0")).join("");
  return `#${hex}`;
}

// ── Extraction ────────────────────────────────────────────────────────────────

function _extractColors(nodes) {
  const fg = [], bg = [], border = [];

  for (const n of nodes) {
    if (!n.visibility.isVisible) continue;
    const f = _normalizeColor(n.color?.fg);
    const b = _normalizeColor(n.color?.bg);
    if (f) fg.push(f);
    if (b) bg.push(b);
    if (n.spacing?.borderWidth && _parsePx(n.spacing.borderWidth) > 0) {
      // box border color not available in computed style shorthand — skip for now
    }
  }

  const fgFreq = _freq(fg).slice(0, 20).map(([v, count]) => ({ value: _toHex(v), css: v, count, role: "text" }));
  const bgFreq = _freq(bg).slice(0, 20).map(([v, count]) => ({ value: _toHex(v), css: v, count, role: "background" }));

  // Merge and assign token names
  const all   = [...fgFreq, ...bgFreq].sort((a, b) => b.count - a.count);
  const named = [];
  const seen  = new Set();
  let colorIdx = 1;
  for (const c of all) {
    if (seen.has(c.value)) continue;
    seen.add(c.value);
    named.push({ ...c, token: `color.${c.role === "background" ? "bg" : "text"}.${colorIdx++}` });
  }
  return named;
}

function _extractSpacing(nodes) {
  const values = new Set();
  for (const n of nodes) {
    const s = n.spacing || {};
    for (const key of ["paddingTop","paddingRight","paddingBottom","paddingLeft",
                        "marginTop","marginRight","marginBottom","marginLeft"]) {
      const px = _parsePx(s[key]);
      if (px !== null && px > 0 && px <= 200) values.add(px);
    }
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.map((px, i) => ({ token: `spacing.${i + 1}`, value: `${px}px`, px }));
}

function _extractTypography(nodes) {
  const families = new Map(), sizes = new Map(), weights = new Map(), lineHeights = new Map();

  for (const n of nodes) {
    if (!n.visibility.isVisible || !n.font) continue;
    const { family, size, weight, lineHeight } = n.font;
    if (family) families.set(family, (families.get(family) || 0) + 1);
    const sizePx = _parsePx(size);
    if (sizePx) sizes.set(sizePx, (sizes.get(sizePx) || 0) + 1);
    const w = parseInt(weight);
    if (!isNaN(w) && w >= 100 && w <= 900) weights.set(w, (weights.get(w) || 0) + 1);
    const lh = _parsePx(lineHeight);
    if (lh) lineHeights.set(lh, (lineHeights.get(lh) || 0) + 1);
  }

  const sortedFamilies = [...families.entries()].sort((a, b) => b[1] - a[1])
    .map(([v], i) => ({ token: `typography.fontFamily.${i + 1}`, value: v }));
  const sortedSizes = [...sizes.keys()].sort((a, b) => a - b)
    .map((px, i) => ({ token: `typography.fontSize.${i + 1}`, value: `${px}px`, px }));
  const sortedWeights = [...new Set(weights.keys())].sort((a, b) => a - b)
    .map((w, i) => ({ token: `typography.fontWeight.${i + 1}`, value: String(w) }));
  const sortedLH = [...new Set(lineHeights.keys())].sort((a, b) => a - b).slice(0, 10)
    .map((v, i) => ({ token: `typography.lineHeight.${i + 1}`, value: `${v}px`, px: v }));

  return { families: sortedFamilies, sizes: sortedSizes, weights: sortedWeights, lineHeights: sortedLH };
}

function _extractRadius(nodes) {
  const values = new Set();
  for (const n of nodes) {
    const r = _parsePx(n.spacing?.borderRadius);
    if (r !== null && r > 0 && r <= 100) values.add(r);
  }
  return [...values].sort((a, b) => a - b)
    .map((px, i) => ({ token: `radius.${i + 1}`, value: `${px}px`, px }));
}

function _extractIconSizes(nodes) {
  const sizes = new Set();
  for (const n of nodes) {
    if ((n.tag === "img" || n.tag === "svg") && n.visibility.isVisible) {
      const w = n.bbox.w, h = n.bbox.h;
      if (w > 0 && w <= 128 && h > 0 && h <= 128 && Math.abs(w - h) <= 4) {
        sizes.add(Math.round((w + h) / 2));
      }
    }
  }
  return [...sizes].sort((a, b) => a - b)
    .map((px, i) => ({ token: `icon.size.${i + 1}`, value: `${px}px`, px }));
}

// ── W3C token format builder ──────────────────────────────────────────────────
function _toW3CFormat(tokens) {
  const out = {};
  for (const section of Object.keys(tokens)) {
    const items = Array.isArray(tokens[section]) ? tokens[section] : Object.values(tokens[section]).flat();
    for (const item of items) {
      const parts = item.token.split(".");
      let cur = out;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]]) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = { $value: item.value, $type: section === "colors" ? "color" : "dimension" };
    }
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function extractTokens(domSnapshot) {
  const { nodes = [] } = domSnapshot;

  const colors     = _extractColors(nodes);
  const spacing    = _extractSpacing(nodes);
  const typography = _extractTypography(nodes);
  const radius     = _extractRadius(nodes);
  const iconSizes  = _extractIconSizes(nodes);

  const tokens = { colors, spacing, typography, radius, iconSizes };
  const w3c    = _toW3CFormat({ colors, spacing, radius, iconSizes });

  const stats = {
    colorCount:      colors.length,
    spacingSteps:    spacing.length,
    fontFamilies:    typography.families.length,
    fontSizes:       typography.sizes.length,
    fontWeights:     typography.weights.length,
    radiusValues:    radius.length,
    iconSizes:       iconSizes.length,
  };

  return { tokens, w3c, stats };
}

async function generateTokens({ domFilename, domSnapshot } = {}) {
  let snapshot = domSnapshot;
  if (!snapshot && domFilename) {
    const fp = path.join(__dirname, "../../data/odi/dom", domFilename);
    if (!fs.existsSync(fp)) return { ok: false, error: `DOM file not found: ${domFilename}` };
    snapshot = JSON.parse(fs.readFileSync(fp, "utf8"));
  }
  if (!snapshot) return { ok: false, error: "domFilename or domSnapshot required" };

  const { tokens, w3c, stats } = extractTokens(snapshot);

  _ensureDir();
  const slug = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `tokens-${slug}.json`;
  const out = { tokens, w3c, stats, url: snapshot.url, title: snapshot.title, timestamp: new Date().toISOString(), domFilename };
  fs.writeFileSync(path.join(TOKENS_DIR, filename), JSON.stringify(out, null, 2));

  return { ok: true, filename, path: `data/odi/tokens/${filename}`, tokens, w3c, stats };
}

function listTokens({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(TOKENS_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(TOKENS_DIR, f), "utf8"));
        return { filename: f, url: d.url, stats: d.stats, timestamp: d.timestamp };
      } catch { return null; }
    }).filter(Boolean);
}

module.exports = { generateTokens, extractTokens, listTokens };
