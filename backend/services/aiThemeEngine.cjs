"use strict";
/**
 * ODI-24 AI Theme Engine
 *
 * Generates complete design themes from design tokens.
 * Supported themes: light, dark, glass, enterprise, minimal, luxury
 *
 * Each theme is a complete CSS variable + Tailwind config extension set:
 *   - Color palette (primary, secondary, surface, background, text, border, error, success, warning)
 *   - Typography (font families, sizes, weights)
 *   - Spacing scale
 *   - Border radius
 *   - Shadow set
 *   - Animation/transition config
 *
 * Output: CSS variables block + Tailwind config JSON + preview HTML
 * Storage: data/odi/themes/
 */

const fs   = require("fs");
const path = require("path");

const THEMES_DIR = path.join(__dirname, "../../data/odi/themes");
function _ensureDir() { if (!fs.existsSync(THEMES_DIR)) fs.mkdirSync(THEMES_DIR, { recursive: true }); }

// ── Built-in theme definitions ────────────────────────────────────────────────

const THEME_DEFINITIONS = {
  light: {
    name: "Light",
    description: "Clean, accessible light theme for general use",
    colors: {
      primary:    "#3B82F6",  // blue-500
      primaryHover:"#2563EB", // blue-600
      secondary:  "#8B5CF6",  // violet-500
      surface:    "#FFFFFF",
      background: "#F9FAFB",  // gray-50
      card:       "#FFFFFF",
      text:       "#111827",  // gray-900
      textMuted:  "#6B7280",  // gray-500
      border:     "#E5E7EB",  // gray-200
      error:      "#EF4444",  // red-500
      success:    "#10B981",  // emerald-500
      warning:    "#F59E0B",  // amber-500
      info:       "#06B6D4",  // cyan-500
    },
    typography: { heading: "Inter, system-ui, sans-serif", body: "Inter, system-ui, sans-serif", mono: "JetBrains Mono, monospace" },
    radius: { sm: "4px", md: "8px", lg: "12px", xl: "16px", full: "9999px" },
    shadows: { sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)", md: "0 4px 6px -1px rgb(0 0 0 / 0.1)", lg: "0 10px 15px -3px rgb(0 0 0 / 0.1)", xl: "0 20px 25px -5px rgb(0 0 0 / 0.1)" },
  },
  dark: {
    name: "Dark",
    description: "Eye-friendly dark theme with high contrast",
    colors: {
      primary:    "#60A5FA",  // blue-400
      primaryHover:"#93C5FD", // blue-300
      secondary:  "#A78BFA",  // violet-400
      surface:    "#1F2937",  // gray-800
      background: "#111827",  // gray-900
      card:       "#1F2937",  // gray-800
      text:       "#F9FAFB",  // gray-50
      textMuted:  "#9CA3AF",  // gray-400
      border:     "#374151",  // gray-700
      error:      "#F87171",  // red-400
      success:    "#34D399",  // emerald-400
      warning:    "#FBBF24",  // amber-400
      info:       "#22D3EE",  // cyan-400
    },
    typography: { heading: "Inter, system-ui, sans-serif", body: "Inter, system-ui, sans-serif", mono: "JetBrains Mono, monospace" },
    radius: { sm: "4px", md: "8px", lg: "12px", xl: "16px", full: "9999px" },
    shadows: { sm: "0 1px 2px 0 rgb(0 0 0 / 0.3)", md: "0 4px 6px -1px rgb(0 0 0 / 0.4)", lg: "0 10px 15px -3px rgb(0 0 0 / 0.5)", xl: "0 20px 25px -5px rgb(0 0 0 / 0.6)" },
  },
  glass: {
    name: "Glass",
    description: "Glassmorphism — frosted glass surfaces with depth",
    colors: {
      primary:    "#6366F1",  // indigo-500
      primaryHover:"#4F46E5", // indigo-600
      secondary:  "#EC4899",  // pink-500
      surface:    "rgba(255, 255, 255, 0.1)",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      card:       "rgba(255, 255, 255, 0.15)",
      text:       "#FFFFFF",
      textMuted:  "rgba(255, 255, 255, 0.7)",
      border:     "rgba(255, 255, 255, 0.2)",
      error:      "#F87171",
      success:    "#34D399",
      warning:    "#FBBF24",
      info:       "#38BDF8",
    },
    typography: { heading: "Inter, system-ui, sans-serif", body: "Inter, system-ui, sans-serif", mono: "JetBrains Mono, monospace" },
    radius: { sm: "8px", md: "12px", lg: "16px", xl: "24px", full: "9999px" },
    shadows: { sm: "0 2px 8px rgba(31,38,135,0.2)", md: "0 8px 32px rgba(31,38,135,0.3)", lg: "0 16px 48px rgba(31,38,135,0.4)", xl: "0 32px 64px rgba(31,38,135,0.5)" },
    special: { backdropFilter: "blur(16px) saturate(180%)", "-webkit-backdrop-filter": "blur(16px) saturate(180%)" },
  },
  enterprise: {
    name: "Enterprise",
    description: "Professional B2B SaaS — neutral, trustworthy, high-information density",
    colors: {
      primary:    "#1D4ED8",  // blue-700
      primaryHover:"#1E40AF", // blue-800
      secondary:  "#059669",  // emerald-600
      surface:    "#FFFFFF",
      background: "#F3F4F6",  // gray-100
      card:       "#FFFFFF",
      text:       "#1F2937",  // gray-800
      textMuted:  "#4B5563",  // gray-600
      border:     "#D1D5DB",  // gray-300
      error:      "#DC2626",  // red-600
      success:    "#059669",  // emerald-600
      warning:    "#D97706",  // amber-600
      info:       "#0284C7",  // sky-600
    },
    typography: { heading: "IBM Plex Sans, Inter, system-ui, sans-serif", body: "IBM Plex Sans, Inter, system-ui, sans-serif", mono: "IBM Plex Mono, monospace" },
    radius: { sm: "2px", md: "4px", lg: "6px", xl: "8px", full: "9999px" },
    shadows: { sm: "0 1px 3px rgb(0 0 0 / 0.1)", md: "0 2px 6px rgb(0 0 0 / 0.08)", lg: "0 4px 12px rgb(0 0 0 / 0.08)", xl: "0 8px 24px rgb(0 0 0 / 0.08)" },
  },
  minimal: {
    name: "Minimal",
    description: "Stripped-down, content-first design with maximum whitespace",
    colors: {
      primary:    "#000000",
      primaryHover:"#1F2937",
      secondary:  "#6B7280",
      surface:    "#FFFFFF",
      background: "#FFFFFF",
      card:       "#FAFAFA",
      text:       "#000000",
      textMuted:  "#9CA3AF",
      border:     "#F3F4F6",
      error:      "#EF4444",
      success:    "#10B981",
      warning:    "#F59E0B",
      info:       "#3B82F6",
    },
    typography: { heading: "Georgia, serif", body: "Inter, system-ui, sans-serif", mono: "Courier New, monospace" },
    radius: { sm: "0px", md: "0px", lg: "2px", xl: "4px", full: "9999px" },
    shadows: { sm: "none", md: "0 1px 0 0 #E5E7EB", lg: "0 2px 0 0 #E5E7EB", xl: "0 0 0 1px #E5E7EB" },
  },
  luxury: {
    name: "Luxury",
    description: "Premium brand feel — gold accents, deep surfaces, refined typography",
    colors: {
      primary:    "#C9A84C",  // gold
      primaryHover:"#B8973F",
      secondary:  "#8B7355",  // warm brown
      surface:    "#1A1A1A",
      background: "#0D0D0D",
      card:       "#1A1A1A",
      text:       "#F5F0E8",  // warm white
      textMuted:  "#8B7355",
      border:     "#2D2D2D",
      error:      "#C0392B",
      success:    "#27AE60",
      warning:    "#C9A84C",
      info:       "#2980B9",
    },
    typography: { heading: "Playfair Display, Georgia, serif", body: "Cormorant Garamond, Georgia, serif", mono: "JetBrains Mono, monospace" },
    radius: { sm: "1px", md: "2px", lg: "4px", xl: "8px", full: "9999px" },
    shadows: { sm: "0 1px 4px rgba(201,168,76,0.1)", md: "0 4px 16px rgba(201,168,76,0.15)", lg: "0 8px 32px rgba(201,168,76,0.2)", xl: "0 16px 64px rgba(201,168,76,0.25)" },
  },
};

// ── CSS variable generator ────────────────────────────────────────────────────

function _toCSSVars(theme) {
  const lines = [`:root {`];
  for (const [key, val] of Object.entries(theme.colors)) {
    lines.push(`  --color-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${val};`);
  }
  lines.push(`  --font-heading: ${theme.typography.heading};`);
  lines.push(`  --font-body: ${theme.typography.body};`);
  lines.push(`  --font-mono: ${theme.typography.mono};`);
  for (const [key, val] of Object.entries(theme.radius)) {
    lines.push(`  --radius-${key}: ${val};`);
  }
  for (const [key, val] of Object.entries(theme.shadows)) {
    lines.push(`  --shadow-${key}: ${val};`);
  }
  if (theme.special) {
    for (const [key, val] of Object.entries(theme.special)) {
      lines.push(`  --special-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${val};`);
    }
  }
  lines.push(`}`);
  return lines.join("\n");
}

// ── Tailwind config extension ─────────────────────────────────────────────────

function _toTailwindConfig(theme) {
  return {
    theme: {
      extend: {
        colors: {
          primary: { DEFAULT: theme.colors.primary, hover: theme.colors.primaryHover },
          secondary: theme.colors.secondary,
          surface: theme.colors.surface,
          card: theme.colors.card,
          muted: theme.colors.textMuted,
          border: theme.colors.border,
        },
        fontFamily: {
          heading: [theme.typography.heading],
          body:    [theme.typography.body],
          mono:    [theme.typography.mono],
        },
        borderRadius: theme.radius,
        boxShadow:    theme.shadows,
      },
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function generateTheme({ themeName, baseTokens } = {}) {
  const key = (themeName || "light").toLowerCase();
  const base = THEME_DEFINITIONS[key];
  if (!base) {
    return { ok: false, error: `Unknown theme: ${key}. Available: ${Object.keys(THEME_DEFINITIONS).join(", ")}` };
  }

  // Allow token override from ODI-6 design tokens
  const theme = { ...base };
  if (baseTokens?.colors) {
    const overrides = {};
    for (const c of baseTokens.colors) {
      if (c.role === "primary" || c.token?.includes("primary")) overrides.primary = c.value || c.hex;
      if (c.role === "text" && !overrides.text) overrides.text = c.value || c.hex;
    }
    theme.colors = { ...base.colors, ...overrides };
  }

  const cssVars        = _toCSSVars(theme);
  const tailwindConfig = _toTailwindConfig(theme);

  _ensureDir();
  const slug     = new Date().toISOString().replace(/[:.]/g, "-");
  const themeId  = `theme-${key}-${slug}`;
  const filename = `${themeId}.json`;

  const record = {
    themeId,
    themeName:    theme.name,
    description:  theme.description,
    theme,
    cssVars,
    tailwindConfig,
    generatedAt:  new Date().toISOString(),
  };

  fs.writeFileSync(path.join(THEMES_DIR, filename), JSON.stringify(record, null, 2));

  // Also write CSS file
  const cssFile = `${themeId}.css`;
  fs.writeFileSync(path.join(THEMES_DIR, cssFile), cssVars, "utf8");

  return { ok: true, themeId, filename, cssFile, path: `data/odi/themes/${filename}`, ...record };
}

function generateAllThemes({ baseTokens } = {}) {
  const results = {};
  for (const key of Object.keys(THEME_DEFINITIONS)) {
    results[key] = generateTheme({ themeName: key, baseTokens });
  }
  return { ok: true, themes: results, count: Object.keys(results).length };
}

function listThemes({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(THEMES_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, f), "utf8"));
        return { filename: f, themeId: d.themeId, themeName: d.themeName, description: d.description, generatedAt: d.generatedAt };
      } catch { return null; }
    }).filter(Boolean);
}

function getTheme(themeId) {
  _ensureDir();
  const files = fs.readdirSync(THEMES_DIR).filter(f => f.includes(themeId) && f.endsWith(".json"));
  if (!files.length) return null;
  try { return JSON.parse(fs.readFileSync(path.join(THEMES_DIR, files[0]), "utf8")); } catch { return null; }
}

module.exports = { generateTheme, generateAllThemes, listThemes, getTheme, THEME_DEFINITIONS };
