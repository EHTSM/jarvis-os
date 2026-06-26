"use strict";
/**
 * ODI-18 Brand Intelligence
 *
 * Validates brand consistency across a page:
 *   - Primary color presence and dominance
 *   - Typography consistency (font families match brand)
 *   - Logo detection (img with alt containing brand name, or known class patterns)
 *   - Tone consistency (formal vs casual vocabulary in text)
 *   - Visual language (rounded vs flat, dense vs spacious)
 *
 * Inputs: DOM snapshot (from ODI-2) + optional brand config
 * Output: brandScore, violations[], brandStrength, language
 */

const fs   = require("fs");
const path = require("path");

const BRAND_DIR = path.join(__dirname, "../../data/odi/brand");
function _ensureDir() { if (!fs.existsSync(BRAND_DIR)) fs.mkdirSync(BRAND_DIR, { recursive: true }); }

function _parsePx(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function _hexToRGB(hex) {
  const r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
  return { r, g, b };
}

// ── Brand analyzers ────────────────────────────────────────────────────────────

function _analyzeColors(nodes, brandColors) {
  const issues = [];
  const allColors = new Set();
  for (const n of nodes) {
    if (n.color?.fg && n.color.fg !== "rgb(0, 0, 0)" && n.color.fg !== "transparent") allColors.add(n.color.fg);
    if (n.color?.bg && n.color.bg !== "rgb(255, 255, 255)" && n.color.bg !== "transparent") allColors.add(n.color.bg);
  }

  if (brandColors?.primary) {
    // Check if primary brand color appears in the page
    const primaryAppears = [...allColors].some(c => {
      const raw = c.replace(/rgb\(|\)/g, "").split(",").map(Number);
      const brand = _hexToRGB(brandColors.primary);
      return Math.abs(raw[0] - brand.r) < 20 && Math.abs(raw[1] - brand.g) < 20 && Math.abs(raw[2] - brand.b) < 20;
    });
    if (!primaryAppears) {
      issues.push({ type: "missing_primary_color", severity: "error", message: `Brand primary color ${brandColors.primary} not found on page`, category: "color" });
    }
  }

  if (allColors.size > 12) {
    issues.push({ type: "too_many_colors", severity: "warning", message: `${allColors.size} unique colors detected — exceeds recommended maximum of 12`, category: "color" });
  }

  return { issues, colorCount: allColors.size };
}

function _analyzeTypography(nodes, brandFonts) {
  const issues = [];
  const families = new Set();
  for (const n of nodes) {
    if (n.font?.family && n.visibility?.isVisible) {
      const family = n.font.family.split(",")[0].trim().replace(/['"]/g, "");
      families.add(family);
    }
  }

  if (families.size > 3) {
    issues.push({ type: "too_many_fonts", severity: "warning", message: `${families.size} font families detected — aim for ≤ 3 (heading + body + mono)`, category: "typography", data: { families: [...families] } });
  }

  if (brandFonts?.primary) {
    const primaryPresent = [...families].some(f => f.toLowerCase().includes(brandFonts.primary.toLowerCase()));
    if (!primaryPresent) {
      issues.push({ type: "missing_brand_font", severity: "error", message: `Brand font "${brandFonts.primary}" not found on page`, category: "typography", data: { found: [...families] } });
    }
  }

  return { issues, fontFamilies: [...families] };
}

function _analyzeLogo(nodes, brandName) {
  const issues = [];
  if (!brandName) return { issues, logoFound: false };

  const images = nodes.filter(n => n.tag === "img");
  const logoFound = images.some(img => {
    const alt   = (img.attrs?.alt  || "").toLowerCase();
    const src   = (img.attrs?.src  || "").toLowerCase();
    const cls   = (img.classes     || []).join(" ").toLowerCase();
    const brand = brandName.toLowerCase();
    return alt.includes(brand) || src.includes("logo") || cls.includes("logo") || cls.includes("brand");
  });

  if (!logoFound && images.length > 0) {
    issues.push({ type: "logo_not_detected", severity: "warning", message: `Brand logo for "${brandName}" not found — check alt text and class names`, category: "brand" });
  } else if (images.length === 0) {
    issues.push({ type: "no_images", severity: "info", message: "No images found on page — logo may be CSS/SVG-based (manual verification needed)", category: "brand" });
  }

  return { issues, logoFound };
}

function _analyzeTone(nodes) {
  const issues = [];
  const textNodes = nodes.filter(n => n.text && n.visibility?.isVisible);
  const allText   = textNodes.map(n => n.text).join(" ").toLowerCase();

  if (!allText.trim()) return { issues, detectedTone: "unknown" };

  const formalWords   = ["please", "therefore", "pursuant", "hereby", "wherein", "shall", "whilst"];
  const informalWords = ["hey", "awesome", "cool", "super", "ya", "wanna", "gonna"];

  const formalCount   = formalWords.filter(w => allText.includes(w)).length;
  const informalCount = informalWords.filter(w => allText.includes(w)).length;

  const detectedTone = formalCount > informalCount ? "formal" : informalCount > formalCount ? "casual" : "neutral";

  return { issues, detectedTone, formalSignals: formalCount, informalSignals: informalCount };
}

function _analyzeVisualLanguage(nodes) {
  const RADII = nodes.map(n => _parsePx(n.spacing?.borderRadius)).filter(Boolean);
  const avgRadius = RADII.length ? RADII.reduce((s, v) => s + v, 0) / RADII.length : 0;

  const SPACING = nodes.map(n => _parsePx(n.spacing?.paddingTop)).filter(Boolean);
  const avgSpacing = SPACING.length ? SPACING.reduce((s, v) => s + v, 0) / SPACING.length : 0;

  const language = avgRadius > 12 ? "rounded" : avgRadius > 4 ? "slightly-rounded" : "flat";
  const density  = avgSpacing > 20 ? "spacious" : avgSpacing > 8 ? "balanced" : "dense";

  return { language, density, avgRadius: Math.round(avgRadius), avgSpacing: Math.round(avgSpacing) };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function analyzeBrand(domSnapshot, brandConfig = {}) {
  const { nodes = [], viewport = { width: 1280, height: 900 } } = domSnapshot;

  const colorResult = _analyzeColors(nodes, brandConfig.colors);
  const typoResult  = _analyzeTypography(nodes, brandConfig.fonts);
  const logoResult  = _analyzeLogo(nodes, brandConfig.name);
  const toneResult  = _analyzeTone(nodes);
  const visualLang  = _analyzeVisualLanguage(nodes);

  const allIssues   = [...colorResult.issues, ...typoResult.issues, ...logoResult.issues, ...toneResult.issues];
  const errors      = allIssues.filter(i => i.severity === "error").length;
  const warnings    = allIssues.filter(i => i.severity === "warning").length;
  const brandScore  = Math.max(0, 100 - errors * 20 - warnings * 10);

  const brandStrength = brandScore >= 85 ? "strong" : brandScore >= 65 ? "moderate" : "weak";

  return {
    brandScore,
    brandStrength,
    violations: allIssues,
    colorAnalysis: { colorCount: colorResult.colorCount },
    typographyAnalysis: { fontFamilies: typoResult.fontFamilies },
    logoAnalysis: { logoFound: logoResult.logoFound },
    toneAnalysis: { detectedTone: toneResult.detectedTone },
    visualLanguage: visualLang,
    stats: { errors, warnings, total: allIssues.length },
  };
}

async function analyzeFromDomFile({ domFilename, brandConfig } = {}) {
  if (!domFilename) return { ok: false, error: "domFilename required" };
  const fp = path.join(__dirname, "../../data/odi/dom", domFilename);
  if (!fs.existsSync(fp)) return { ok: false, error: `DOM file not found: ${domFilename}` };

  const snapshot = JSON.parse(fs.readFileSync(fp, "utf8"));
  const result   = analyzeBrand(snapshot, brandConfig || {});

  _ensureDir();
  const slug     = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `brand-${slug}.json`;
  const out = { ...result, url: snapshot.url, domFilename, brandConfig, timestamp: new Date().toISOString() };
  fs.writeFileSync(path.join(BRAND_DIR, filename), JSON.stringify(out, null, 2));

  return { ok: true, filename, path: `data/odi/brand/${filename}`, ...result };
}

function listReports({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(BRAND_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try { const d = JSON.parse(fs.readFileSync(path.join(BRAND_DIR, f), "utf8")); return { filename: f, url: d.url, brandScore: d.brandScore, brandStrength: d.brandStrength, timestamp: d.timestamp }; }
      catch { return null; }
    }).filter(Boolean);
}

module.exports = { analyzeBrand, analyzeFromDomFile, listReports };
