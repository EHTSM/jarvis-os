"use strict";
/**
 * Universal Brand Registry — single production source of truth.
 *
 * This does NOT invent branding. Every value here is recovered from the
 * real, already-live brand system:
 *   - Colors: frontend/src/index.css:1-31 ("Ooplix Design System v2 —
 *     Single source of truth for all tokens"), the same values documented
 *     in assets/brand/BRAND_KIT.md.
 *   - Mark geometry: frontend/src/design/OoplixMark.jsx — the "OVERRIDE
 *     symbol" (two bars), actually rendered in the running app via
 *     OoplixWordmark in App.jsx and LandingPage.jsx. This is the ONLY
 *     logo geometry actually wired into production UI; it is therefore
 *     the canonical mark. (Other files found in the repo — the
 *     assets/brand/*.svg hexagon design, the letter-"J" favicon.svg, the
 *     frontend/src/design/logo/* exploration variants — were never wired
 *     into any real screen and are documented as superseded, not deleted.)
 *   - Company/legal: frontend/public/index.html schema.org block,
 *     assets/brand/BRAND_KIT.md.
 *
 * Every consumer (favicon, PWA manifest, Electron icons, mobile
 * launcher/splash, OG image, email branding) should read from this file
 * (or its generated outputs) rather than hold its own copy.
 */

const COLORS = Object.freeze({
  bg:          "#05070d",   // canvas background (index.css --bg)
  bgLegacy:    "#0a0a0f",   // background_color used in manifest.json/electron builder — same canvas, pre-v2-token value, kept for exact backward compat
  markBg:      "#03050a",   // OoplixMark.jsx default `bg` prop — the icon tile background
  accent:      "#7c6fff",   // violet — primary accent (index.css --accent)
  accent2:     "#4ecdc4",   // teal — secondary accent (index.css --accent2)
  accentHover: "#9488ff",
  accentActive:"#6455e8",
  accent2Hover:"#63d9d1",
  text:        "#dde2ec",
  textDim:     "#8994b0",
  success:     "#52d68a",
  warning:     "#f0b429",
  danger:      "#f55b5b",
  info:        "#5dc8f5",
  markFg:      "#ffffff",  // OoplixMark.jsx default `fg` — the bars themselves
});

const GRADIENT = Object.freeze({
  from: COLORS.accent,
  to:   COLORS.accent2,
  angleDeg: 135,
  css: `linear-gradient(135deg, ${COLORS.accent} 0%, ${COLORS.accent2} 100%)`,
});

const TYPOGRAPHY = Object.freeze({
  wordmarkFontFamily: '"Inter", "Geist", -apple-system, sans-serif',
  wordmarkWeight: 700,
  wordmarkLetterSpacing: "-0.025em",
  monoFontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', 'Consolas', monospace",
});

const COMPANY = Object.freeze({
  productName: "Ooplix",
  productFullName: "Ooplix — AI Operating System",
  legalName: "ALWALIY TECHNOLOGIES PRIVATE LIMITED",
  website: "https://ooplix.com",
  supportEmail: "support@ooplix.com",
  securityEmail: "security@ooplix.com",
  twitter: "@ooplix",
});

/**
 * Canonical mark geometry — mirrors OoplixMark.jsx exactly (the "OVERRIDE"
 * two-bar symbol) as a pure-function SVG generator, so every raster/static
 * output (favicon, PWA icons, Electron icons, mobile launcher icons) is
 * derived from the identical shape math instead of hand-redrawn per target.
 *
 * @param {number} size - canvas size in px (square)
 * @param {object} [opts]
 * @param {string} [opts.bg] - tile background color, or 'transparent'
 * @param {string} [opts.fg] - bar color
 * @returns {string} SVG markup
 */
function renderMarkSVG(size, opts = {}) {
  const bg = opts.bg ?? COLORS.markBg;
  const fg = opts.fg ?? COLORS.markFg;

  const borderRadius = Math.round(size * 0.15625); // ~5/32 ratio, matches OoplixMark.jsx
  const pad = size * 0.125;
  const inner = size - pad * 2;

  const thickH = Math.round(inner * 0.19);
  const thickY = pad + Math.round(inner * 0.27);
  const thickX = pad;
  const thickW = inner;

  const gap = Math.round(thickH * 0.28);

  const thinH = Math.round(thickH * 0.5);
  const thinW = Math.round(inner * 0.72);
  const thinY = thickY + thickH + gap;
  const thinX = pad + inner - thinW;

  const bgRect = bg !== "transparent"
    ? `<rect width="${size}" height="${size}" rx="${borderRadius}" fill="${bg}"/>`
    : "";

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${COMPANY.productName}">
  ${bgRect}
  <rect x="${thickX}" y="${thickY}" width="${thickW}" height="${thickH}" rx="1" fill="${fg}"/>
  <rect x="${thinX}" y="${thinY}" width="${thinW}" height="${thinH}" rx="1" fill="${fg}"/>
</svg>`;
}

/**
 * Registry of every real brand-asset consumption point in the repo, and
 * which file each one should be reading from. Used by the brand audit /
 * CI check to detect future drift (a new asset added that isn't in this
 * map, or a map entry whose target file no longer exists).
 */
const ASSET_MAP = Object.freeze({
  webFavicon:        "frontend/public/favicon.svg",
  webManifestIcon:   "frontend/public/favicon.svg",
  webPwaIcon192:      "frontend/public/logo192.svg",
  webPwaIcon512:      "frontend/public/logo512.svg",
  webOgImage:         "frontend/public/og-image.png",
  electronIconPng:    "electron/assets/icon.png",
  electronIconIco:    "electron/assets/icon.ico",
  electronIconIcns:   "electron/assets/icon.icns",
  androidLauncher:    "mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png",
  androidSplash:      "mobile/android/app/src/main/res/drawable/splash.png",
  flutterLauncher:    "flutter/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png",
  inAppMark:          "frontend/src/design/OoplixMark.jsx",
  inAppWordmark:      "frontend/src/design/OoplixWordmark.jsx",
});

module.exports = {
  COLORS,
  GRADIENT,
  TYPOGRAPHY,
  COMPANY,
  ASSET_MAP,
  renderMarkSVG,
};
