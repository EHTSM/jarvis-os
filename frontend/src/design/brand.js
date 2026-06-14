/**
 * Ooplix Brand System — OVERRIDE
 *
 * The mark is derived from the verb OVERRIDE:
 * a higher command sits above and displaces a lower command.
 * Two bars. No curves. No diagonals. No letters.
 *
 * Import: import { mark, palette, type, radius, shadow } from './brand';
 */

// ── Mark geometry ──────────────────────────────────────────────────────────
export const mark = {
  verb: 'override',
  geometry: {
    thickBar: { widthRatio: 1.0, heightRatio: 0.19, x: 'left-aligned' },
    thinBar:  { widthRatio: 0.72, heightRatio: 0.095, x: 'right-aligned' },
    gap:      { heightRatio: 0.28 }, // gap as % of thick bar height
  }
}

// ── Palette ────────────────────────────────────────────────────────────────
export const palette = {
  // Void — the canvas
  void:    '#03050a',
  ground:  '#05070d',
  surface: '#080b12',
  raised:  '#0d1117',
  overlay: '#111620',

  // Primary — Override violet (authority)
  p900: '#1a1533',
  p800: '#2d2460',
  p700: '#3d318a',
  p600: '#5144bb',
  p500: '#6657e8',  // primary brand
  p400: '#8070f0',
  p300: '#9d8ff5',
  p200: '#bdb5f8',
  p100: '#ddd9fc',
  p50:  '#f0eeff',

  // Accent — Execution teal
  a500: '#2dd4bf',
  a400: '#4ecdc4',
  a300: '#7eddd7',

  // Semantic
  success: '#22c55e',
  warning: '#f59e0b',
  danger:  '#ef4444',
  info:    '#3b82f6',

  // Text hierarchy
  text100: 'rgba(255,255,255,0.96)',
  text80:  'rgba(255,255,255,0.80)',
  text60:  'rgba(255,255,255,0.60)',
  text40:  'rgba(255,255,255,0.40)',
  text20:  'rgba(255,255,255,0.20)',
  text10:  'rgba(255,255,255,0.10)',
  text05:  'rgba(255,255,255,0.05)',
}

// ── Typography ─────────────────────────────────────────────────────────────
export const type = {
  // Font stack — system fonts prioritizing Inter/Geist
  sans: '"Inter", "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", "Geist Mono", "Fira Code", "Cascadia Code", monospace',

  // Scale
  scale: {
    '2xs': '10px',
    xs:    '11px',
    sm:    '12px',
    base:  '13px',
    md:    '14px',
    lg:    '15px',
    xl:    '17px',
    '2xl': '20px',
    '3xl': '24px',
    '4xl': '30px',
    '5xl': '38px',
    hero:  'clamp(2.8rem, 6vw, 5.2rem)',
  },

  // Weight
  weight: {
    regular:  400,
    medium:   500,
    semibold: 600,
    bold:     700,
    black:    800,
  },

  // Letter spacing
  tracking: {
    tight:  '-0.03em',
    snug:   '-0.02em',
    normal: '-0.01em',
    wide:   '0.04em',
    wider:  '0.08em',
    caps:   '0.12em',
  }
}

// ── Radius ─────────────────────────────────────────────────────────────────
export const radius = {
  xs:    3,
  sm:    6,
  base:  10,
  md:    14,
  lg:    18,
  xl:    24,
  '2xl': 32,
  pill:  9999,
}

// ── Shadow + Glow ──────────────────────────────────────────────────────────
export const shadow = {
  // Elevation system
  sm:    '0 1px 2px rgba(0,0,0,0.4)',
  md:    '0 4px 12px rgba(0,0,0,0.5)',
  lg:    '0 8px 32px rgba(0,0,0,0.6)',
  xl:    '0 16px 56px rgba(0,0,0,0.7)',
  '2xl': '0 32px 80px rgba(0,0,0,0.8)',

  // Glow system — use sparingly
  glow:     '0 0 24px rgba(102,87,232,0.25)',
  glowSm:   '0 0 12px rgba(102,87,232,0.18)',
  glowTeal: '0 0 24px rgba(78,205,196,0.20)',
}
