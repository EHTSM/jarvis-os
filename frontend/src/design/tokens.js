/**
 * Ooplix Design System — JS Token Mirror
 * Mirrors CSS custom properties for use in Framer Motion, inline styles,
 * and any JS-driven styling. Source of truth remains index.css.
 *
 * Import: import { color, motion, space } from '../design/tokens';
 */

// ── Color ──────────────────────────────────────────────────────────────────
export const color = {
  // Canvas
  void:    '#03050a',
  ground:  '#05070d',

  // Brand
  accent:  '#7c6fff',
  accentHover: '#9488ff',
  teal:    '#4ecdc4',
  tealHover:   '#63d9d1',

  // Semantic
  success: '#52d68a',
  warning: '#f0b429',
  danger:  '#f55b5b',
  info:    '#5dc8f5',

  // Text
  text:    '#dde2ec',
  dim:     '#8994b0',
  faint:   '#4a5470',

  // Zone accents
  zones: {
    command:      '#7c6fff',
    intelligence: '#4ecdc4',
    engineering:  '#60a5fa',
    workflows:    '#a78bfa',
    operations:   '#34d399',
  },
};

// ── Execution state fills (rgba) ───────────────────────────────────────────
export const execColor = {
  idle:     'rgba(124, 111, 255, 0.00)',
  queued:   'rgba(124, 111, 255, 0.06)',
  running:  'rgba(124, 111, 255, 0.12)',
  thinking: 'rgba(78,  205, 196, 0.10)',
  done:     'rgba(82,  214, 138, 0.09)',
  error:    'rgba(245, 91,  91,  0.10)',
  paused:   'rgba(240, 180, 41,  0.08)',
};

export const execBorder = {
  idle:     'rgba(124, 111, 255, 0.00)',
  queued:   'rgba(124, 111, 255, 0.16)',
  running:  'rgba(124, 111, 255, 0.30)',
  thinking: 'rgba(78,  205, 196, 0.26)',
  done:     'rgba(82,  214, 138, 0.22)',
  error:    'rgba(245, 91,  91,  0.26)',
  paused:   'rgba(240, 180, 41,  0.22)',
};

export const execDot = {
  idle:     '#4a5470',
  queued:   '#7c6fff',
  running:  '#7c6fff',
  thinking: '#4ecdc4',
  done:     '#52d68a',
  error:    '#f55b5b',
  paused:   '#f0b429',
};

// ── Motion ─────────────────────────────────────────────────────────────────
export const motion = {
  // Duration in seconds (Framer Motion uses seconds)
  duration: {
    instant:  0.08,
    fast:     0.14,
    standard: 0.22,
    enter:    0.28,
    slow:     0.36,
    breathe:  2.4,
  },

  // Spring configs — pass directly to Framer Motion `transition`
  spring: {
    snappy: { type: 'spring', stiffness: 500, damping: 32 },
    crisp:  { type: 'spring', stiffness: 350, damping: 28 },
    smooth: { type: 'spring', stiffness: 220, damping: 24 },
    float:  { type: 'spring', stiffness: 160, damping: 20 },
  },

  // Easing arrays — pass to Framer Motion `ease`
  ease: {
    out:    [0.16, 1, 0.3, 1],
    in:     [0.4,  0, 1,   1],
    std:    [0.25, 0.46, 0.45, 0.94],
    spring: [0.22, 1, 0.36, 1],
    back:   [0.175, 0.885, 0.32, 1.275],
  },
};

// ── Space ──────────────────────────────────────────────────────────────────
export const space = {
  1:  4,
  2:  8,
  3:  12,
  4:  16,
  5:  20,
  6:  24,
  8:  32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
};

// ── Radius ─────────────────────────────────────────────────────────────────
export const radius = {
  xs:   4,
  sm:   10,
  base: 14,
  md:   18,
  lg:   22,
  xl:   28,
  pill: 9999,
};

// ── Component dimensions ───────────────────────────────────────────────────
export const size = {
  zoneNavHeight:    56,
  zoneSubNavHeight: 44,
  topbarHeight:     62,
  drawerWidth:      320,
  paletteWidth:     560,
  dotSize:          7,
  dotSizeLg:        10,
};
