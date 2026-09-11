# Superseded — design exploration, not production assets

Every SVG in this directory has **zero references anywhere in the codebase** (verified via repo-wide search during the Universal Brand System Certification, 2026-08-04). These are early design-exploration variants from the 2026-06-14 "Product Experience & Brand System" work (`favicon-d1/d2/d3`, `logo-d1-runtime-loop`, `logo-d2-kernel-pulse`, `logo-d3-operator-mark`, `app-icon-recommended`, `ooplix-mark-bracket/stack/v2`) that predate the mark that actually shipped.

**The real, live, production mark is `../OoplixMark.jsx`** (the "OVERRIDE" two-bar symbol) — rendered today via `../OoplixWordmark.jsx` in `App.jsx` and `LandingPage.jsx`, and mirrored for static/raster contexts in `assets/brand/brandRegistry.cjs` at the repo root.

Kept here for history, not deleted. Do not wire any file in this directory into production — use `OoplixMark`/`OoplixWordmark` (React contexts) or `assets/brand/brandRegistry.cjs`'s `renderMarkSVG()` (static/build-time contexts) instead.
