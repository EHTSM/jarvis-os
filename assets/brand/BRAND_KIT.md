# Ooplix Brand Kit

## Colors

| Name | Hex | Usage |
|---|---|---|
| Primary | `#7c6fff` | Primary accent, CTAs, links |
| Secondary | `#4ecdc4` | Gradient end, highlights |
| Background | `#0a0a0f` | App background, dark surfaces |
| Surface | `#111118` | Cards, panels |
| Border | `#1e1e2e` | Borders, dividers |
| Text Primary | `#f0f0f0` | Headings, primary text |
| Text Secondary | `#888` | Captions, metadata |
| Success | `#22c55e` | Positive states, pass |
| Warning | `#f59e0b` | Warnings, in-progress |
| Error | `#ef4444` | Errors, failures |

### Brand Gradient

```css
background: linear-gradient(135deg, #7c6fff 0%, #4ecdc4 100%);
```

## Typography

| Use | Font | Weight | Size |
|---|---|---|---|
| Wordmark | Segoe UI / SF Pro Display / system-ui | 700 | varies |
| Headings | Segoe UI / system-ui | 600–700 | |
| Body | Segoe UI / system-ui | 400 | 14–16px |
| Code | JetBrains Mono / Fira Code / monospace | 400 | 13px |
| Tagline | Segoe UI | 400 | tracking: 0.5px |

## Logo

The production mark is the **OVERRIDE symbol** — two bars, thick over thin,
no curves, no letters. It is a code-generated SVG, not a static file, so it
renders pixel-identically at any size.

| Source | Context |
|---|---|
| `frontend/src/design/OoplixMark.jsx` / `OoplixWordmark.jsx` | React contexts — in-app UI (nav, auth screens) |
| `assets/brand/brandRegistry.cjs` (`renderMarkSVG()`) | Build-time/static contexts — favicons, app icons, OG images |
| `frontend/public/favicon.svg`, `logo192.svg`, `logo512.svg` | Generated output — browser tab, PWA icons |
| `electron/assets/icon.png` / `.ico` / `.icns` | Generated output — desktop app icon (all platforms) |
| `frontend/public/og-image.png`, `apple-touch-icon.png` | Generated output — social preview, iOS home screen |

`assets/brand/logo-*.svg`, `assets/icons/*.svg`, `assets/og/og-default.svg`
(a separate hexagon-mark design) predate the OVERRIDE mark's rollout into
the app and were **never wired into any real screen or build target** —
kept for history, not the source of truth. Do not use them for new work.

## Logo usage rules

- **Do:** Use the mark on the dark canvas (`--bg`/`--surface` tokens above) — it is white bars, not itself gradient-colored
- **Do:** Generate new sizes via `renderMarkSVG(size)` in `brandRegistry.cjs` rather than hand-drawing a new SVG
- **Do:** Maintain minimum clear space equal to the mark's own padding (12.5% of its bounding box) around it
- **Don't:** Recolor, stretch, rotate, or add effects to the mark
- **Don't:** Place the mark on backgrounds that reduce contrast below 4.5:1

## Voice & Tone

- **Direct:** We say what we do. No marketing fluff.
- **Capable:** We ship. Not "we're working on it."
- **Founder-first:** Written for the person running the company, not a committee.
- **Technical but not jargon-heavy:** Our users are smart. We respect their time.

## Company

| | |
|---|---|
| Company name | ALWALIY TECHNOLOGIES PRIVATE LIMITED |
| Product name | Ooplix |
| Website | [ooplix.com](https://ooplix.com) |
| Support | [support@ooplix.com](mailto:support@ooplix.com) |
| Security | [security@ooplix.com](mailto:security@ooplix.com) |
| Twitter | [@ooplixhq](https://twitter.com/ooplixhq) |
| Copyright | © 2026 ALWALIY TECHNOLOGIES PRIVATE LIMITED |
