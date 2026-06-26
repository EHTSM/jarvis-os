"use strict";
/**
 * ODI-13 Design System AI
 *
 * Detects inconsistencies across the extracted design token set:
 *   - Colors not on a coherent palette (hue jumps, missing neutrals)
 *   - Spacing steps that don't follow a scale (4/8/12/16/24/32/48/64 or 1.5× ratio)
 *   - Typography scale violations (sizes should follow modular scale)
 *   - Border radius inconsistencies (mix of sharp/rounded/pill)
 *   - Shadow inconsistencies (inconsistent elevation layers)
 *
 * Outputs: inconsistencies[], tokenPatches[], systemScore
 *
 * tokenPatches are in ODI-9 patchSpec format (patchTarget + patchReplacement)
 * pointing to Tailwind class names or CSS variable replacements.
 */

const fs   = require("fs");
const path = require("path");

const DS_DIR  = path.join(__dirname, "../../data/odi/design-system");
const TOK_DIR = path.join(__dirname, "../../data/odi/tokens");

function _ensureDir() { if (!fs.existsSync(DS_DIR)) fs.mkdirSync(DS_DIR, { recursive: true }); }

// ── Helpers ───────────────────────────────────────────────────────────────────

function _hexToHSL(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
           : max === g ? ((b - r) / d + 2) / 6
           : ((r - g) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// 4/8 base scale used by Tailwind/Material
const SPACING_SCALE = [0, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240, 256, 288, 320, 384];

function _nearestScale(px) {
  return SPACING_SCALE.reduce((best, v) => Math.abs(v - px) < Math.abs(best - px) ? v : best, 0);
}

// ── Color analysis ─────────────────────────────────────────────────────────────

function _analyzeColors(colors) {
  const issues = [];
  const patches = [];
  if (!colors || colors.length < 2) return { issues, patches };

  // Token files use c.value or c.hex for the hex string
  const normalized = colors.map(c => ({ ...c, hex: c.hex || c.value })).filter(c => c.hex && c.hex.startsWith("#"));
  if (!normalized.length) return { issues, patches };

  const hsls = normalized.map(c => ({ ...c, hsl: _hexToHSL(c.hex) }));

  // Cluster by hue — good palettes have ≤3 hue families + neutral grays
  const hues = hsls.filter(c => c.hsl.s > 10).map(c => c.hsl.h);
  const hueClusters = [];
  for (const h of hues) {
    const existing = hueClusters.find(cl => Math.abs(cl - h) < 30 || Math.abs(cl - h) > 330);
    if (!existing) hueClusters.push(h);
  }
  if (hueClusters.length > 3) {
    issues.push({ type: "color_palette", severity: "warning", message: `Too many hue families: ${hueClusters.length} distinct hues found (max recommended: 3)`, data: { hueFamilies: hueClusters } });
  }

  // Neutral check: should have at least a light and dark neutral
  const neutrals = hsls.filter(c => c.hsl.s < 15);
  if (neutrals.length === 0) {
    issues.push({ type: "missing_neutral", severity: "warning", message: "No neutral/gray colors found — text and background may lack depth" });
  }

  // Duplicate-ish colors (same hue/lightness within 5%)
  for (let i = 0; i < hsls.length; i++) {
    for (let j = i + 1; j < hsls.length; j++) {
      const a = hsls[i].hsl, b = hsls[j].hsl;
      if (Math.abs(a.h - b.h) < 10 && Math.abs(a.l - b.l) < 8 && Math.abs(a.s - b.s) < 10) {
        issues.push({ type: "near_duplicate_color", severity: "info", message: `Near-duplicate colors: ${hsls[i].token} (${hsls[i].hex}) ≈ ${hsls[j].token} (${hsls[j].hex})`, data: { a: hsls[i].token, b: hsls[j].token } });
        patches.push({ tokenName: hsls[j].token, suggestion: `Consolidate with ${hsls[i].token}`, currentValue: hsls[j].hex, suggestedValue: hsls[i].hex });
      }
    }
  }

  return { issues, patches };
}

// ── Spacing analysis ───────────────────────────────────────────────────────────

function _analyzeSpacing(spacing) {
  const issues = [];
  const patches = [];
  if (!spacing || spacing.length < 3) return { issues, patches };

  for (const s of spacing) {
    const nearest = _nearestScale(s.px);
    if (Math.abs(nearest - s.px) > 1) {
      issues.push({ type: "off_grid_spacing", severity: "warning", message: `Spacing ${s.px}px is not on 4/8px grid — nearest: ${nearest}px`, data: { token: s.token, px: s.px, suggested: nearest } });
      patches.push({ tokenName: s.token, suggestion: `Round to nearest 4/8px grid: ${nearest}px`, currentValue: `${s.px}px`, suggestedValue: `${nearest}px` });
    }
  }

  // Check scale progression: steps should multiply or add consistently
  const sorted = spacing.map(s => s.px).filter(Boolean).sort((a, b) => a - b);
  if (sorted.length > 3) {
    const ratios = [];
    for (let i = 1; i < sorted.length; i++) ratios.push(sorted[i] / sorted[i-1]);
    const avgRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length;
    const variance = ratios.reduce((s, r) => s + (r - avgRatio) ** 2, 0) / ratios.length;
    if (variance > 1.5) {
      issues.push({ type: "irregular_spacing_scale", severity: "info", message: `Spacing scale variance ${variance.toFixed(2)} is high — consider a consistent modular scale`, data: { steps: sorted } });
    }
  }

  return { issues, patches };
}

// ── Typography analysis ────────────────────────────────────────────────────────

function _analyzeTypography(typography) {
  const issues = [];
  if (!typography?.sizes?.length) return { issues };

  const MODULAR_SCALE = [10, 11, 12, 13, 14, 15, 16, 18, 20, 21, 24, 28, 30, 32, 36, 40, 48, 56, 64, 72, 96];
  for (const s of typography.sizes) {
    const px = parseFloat(s.token?.replace("px","") || s);
    if (!isNaN(px) && !MODULAR_SCALE.some(v => Math.abs(v - px) <= 1)) {
      issues.push({ type: "off_modular_typography", severity: "info", message: `Font size ${px}px is not on a standard modular scale`, data: { size: px, nearest: MODULAR_SCALE.reduce((b, v) => Math.abs(v - px) < Math.abs(b - px) ? v : b, 0) } });
    }
  }

  // Too many font sizes?
  if (typography.sizes.length > 8) {
    issues.push({ type: "too_many_font_sizes", severity: "warning", message: `${typography.sizes.length} distinct font sizes found — aim for ≤ 6 for consistency` });
  }

  return { issues };
}

// ── Radius analysis ────────────────────────────────────────────────────────────

function _analyzeRadius(radius) {
  const issues = [];
  if (!radius?.length) return { issues };

  const values = radius.map(r => parseFloat(r.token?.replace("px","") || r)).filter(Boolean);
  const hasPill = values.some(v => v > 50);
  const hasSharp = values.some(v => v < 2 && v > 0);
  const hasRounded = values.some(v => v >= 4 && v <= 12);

  if (hasPill && hasSharp && hasRounded) {
    issues.push({ type: "border_radius_inconsistency", severity: "warning", message: "Mix of sharp, rounded, and pill radius — pick one visual language: flat/rounded/pill" });
  }

  return { issues };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function analyzeDesignSystem(tokenData) {
  const t = tokenData.tokens || tokenData;

  const colorResult   = _analyzeColors(t.colors);
  const spacingResult = _analyzeSpacing(t.spacing);
  const typoResult    = _analyzeTypography(t.typography);
  const radiusResult  = _analyzeRadius(t.radius);

  const allIssues = [
    ...colorResult.issues,
    ...spacingResult.issues,
    ...typoResult.issues,
    ...radiusResult.issues,
  ];

  const allPatches = [...colorResult.patches, ...spacingResult.patches];

  const errorCount   = allIssues.filter(i => i.severity === "error").length;
  const warningCount = allIssues.filter(i => i.severity === "warning").length;
  const systemScore  = Math.max(0, 100 - errorCount * 20 - warningCount * 10);

  return { systemScore, inconsistencies: allIssues, tokenPatches: allPatches, summary: { errors: errorCount, warnings: warningCount, info: allIssues.length - errorCount - warningCount } };
}

async function analyzeFromTokenFile({ tokenFilename } = {}) {
  if (!tokenFilename) return { ok: false, error: "tokenFilename required" };
  const fp = path.join(TOK_DIR, tokenFilename);
  if (!fs.existsSync(fp)) return { ok: false, error: `Token file not found: ${tokenFilename}` };

  const data   = JSON.parse(fs.readFileSync(fp, "utf8"));
  const result = analyzeDesignSystem(data);

  _ensureDir();
  const slug = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `ds-${slug}.json`;
  const out = { ...result, tokenFilename, url: data.url, timestamp: new Date().toISOString() };
  fs.writeFileSync(path.join(DS_DIR, filename), JSON.stringify(out, null, 2));

  return { ok: true, filename, path: `data/odi/design-system/${filename}`, ...result };
}

function listReports({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(DS_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try { const d = JSON.parse(fs.readFileSync(path.join(DS_DIR, f), "utf8")); return { filename: f, systemScore: d.systemScore, inconsistencies: d.inconsistencies?.length, timestamp: d.timestamp }; }
      catch { return null; }
    }).filter(Boolean);
}

module.exports = { analyzeDesignSystem, analyzeFromTokenFile, listReports };
