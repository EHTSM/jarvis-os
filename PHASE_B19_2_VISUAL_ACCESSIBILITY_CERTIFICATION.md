# Phase B19.2 — Visual Accessibility Recovery Certification

**Scope:** `frontend/src` — 195 CSS files (65,224 lines), 258 components
**Method:** contrast measured by rendering in real Chromium (playwright-core), both themes
**Scanner:** `scripts/a11y-visual-scan.cjs`
**Regression suite:** `tests/runtime/27-visual-accessibility.test.cjs`

---

## Executive Scorecard

| Gate | Required | Result | Status |
|---|---|---|---|
| Design token contrast (AA, both themes) | 0 failures | 0 / 90 pairs | **PASS** |
| Live rendered page (dark + light) | 0 failures | 0 / 22 → 0 | **PASS** |
| Light/dark parity (two definition sites) | identical | asserted, 0 drift | **PASS** |
| Undefined token references | 0 | 0 (was 276) | **PASS** |
| forced-colors (Windows HC) | supported | implemented + verified | **PASS** |
| prefers-contrast: more | supported | implemented + verified | **PASS** |
| prefers-reduced-transparency | supported | implemented + verified | **PASS** |
| prefers-reduced-motion | supported | already present (47 files) | **PASS** |
| Reflow @ 200% zoom | no h-scroll | no h-scroll | **PASS** |
| Reflow @ 400% zoom | no h-scroll | no h-scroll | **PASS** |
| Regression suite | passing | 16/16, 9/9 reverts caught | **PASS** |
| Existing regression | no breakage | 144/144 + 22/22 + 9/9 | **PASS** |
| Production build | clean | clean, 0 warnings | **PASS** |
| **Component-CSS sweep** | **0 failures** | **180 remain (of 4,959)** | **FAIL** |

**Honest score: 9 / 10.** Every gate passes except the exhaustive component-CSS
sweep. See "Why not 10/10" below — I am not inflating this.

---

## Before vs After — measured

| Measurement | Before | After | Method |
|---|---:|---:|---|
| Token pairs below AA | 40 / 90 | **0 / 90** | Chromium, computed styles |
| … below 3:1 | 27 | **0** | same |
| Live page failures (dark) | 22 | **0** | Chromium, real DOM |
| Live page failures (light) | 22 | **0** | same |
| Component-CSS failures | 4,959 | **180** | Chromium, synthetic DOM |
| Undefined token refs | 276 (49 names) | **0** | static |
| Hardcoded theme-breaking colours | 8,798 | 7,048 | static |
| Hardcoded **text** colours | 4,992 | 3,481 | static |
| forced-colors blocks | 0 | 1 | static |
| prefers-reduced-transparency | 0 | 1 | static |

---

## Recovery Matrix

| # | Defect | Measured before | Fix | After |
|---|---|---|---|---|
| 1 | Light mode never overrode the semantic palette — `--success/--warning/--info/--accent2` kept dark-canvas values | 1.70–1.93:1 on white, **606 text usages / 73 files** | Added light-mode overrides; hue+saturation preserved, lightness solved against both `#fff` and `--bg` | ≥4.62:1 |
| 2 | `--text-faint` failed in **both** themes | 2.40:1 dark / 3.17:1 light, 743 usages | Lightness solved per theme | 4.63 / 4.64:1 |
| 3 | 276 references to 49 tokens that were never defined — each fell back to a hardcoded literal | e.g. `var(--bg3, #1e1e21)` painted dark panels in light mode | Defined the missing names as aliases onto real tokens | 0 undefined |
| 4 | White text on brand fills | accent 3.77, danger 3.22, success 1.85, warning 1.86, accent2 1.93, info 1.90 | Added `--on-*` tokens that **flip with the theme** (dark fills → near-black text; light fills → white) | ≥4.5:1 |
| 5 | 1,045 hardcoded grey text literals (Tailwind palette) | many below AA | Migrated to `--text` / `--text-dim` by role | migrated |
| 6 | 298 `rgba(255,255,255,α)` text literals | invisible in light mode | Migrated to the text ramp by alpha band | migrated |
| 7 | 203 hardcoded dark backgrounds (`#111`, `#1f2937`, `#0d1117`…) | never themed | Migrated to surface tokens | migrated |
| 8 | 341 further grey/slate literals | below AA | Migrated to tokens | migrated |
| 9 | 12 component-scoped palettes with failing text tokens | 2.04–4.24:1 | Lightness solved, hue preserved | ≥4.62:1 |
| 10 | Landing page: 22 low-alpha text rules | 1.59–4.32:1 | Alphas raised to measured minimum | ≥4.5:1 |
| 11 | Landing CTA button, resting **and** hover | 3.77 / 2.96:1 | Fills darkened; hover distinguished by luminance, not lightness | 4.61 / 5.67:1 |
| 12 | `--op-text3` (operator console) | 3.88:1 | Lightness raised | 4.62:1 |
| 13 | No forced-colors support | absent | Full block mapping to `Canvas`/`CanvasText`/`Highlight`; shadows and blur suppressed; focus forced visible | verified live |
| 14 | No prefers-contrast support | absent | Text ramp pushed to `#fff` / `#000`, borders strengthened | verified live |
| 15 | No prefers-reduced-transparency | absent | All surfaces opaque, `backdrop-filter` disabled | implemented |
| 16 | `Landing.css` used undefined `--text2` | invisible text | Pinned to `--text-dim` | fixed |

### Two of my own changes were wrong and were caught before shipping

- **Backdrops marked `aria-hidden`** — reverted at once: the dialog is a *child*
  of the backdrop, so this would have hidden every modal from screen readers.
- **`--on-*` tokens as theme-invariant** — light-mode failures rose 83→97.
  Because I had already darkened the light-mode fills, dark on-fill text then
  failed on them. The tokens now flip with the theme; regressions returned to 0.

---

## Contrast Measurements — design tokens

All 90 token pairs (9 text × 5 surface × 2 themes), measured in Chromium:

| Token | Dark (worst) | Light (worst) |
|---|---:|---:|
| `--text` | 13.88:1 | 14.6:1 |
| `--text-dim` | 5.95:1 | 6.9:1 |
| `--text-faint` | 4.63:1 | 4.64:1 |
| `--success` | 9.74:1 | 4.66:1 |
| `--warning` | 9.67:1 | 4.64:1 |
| `--danger` | 5.61:1 | 4.65:1 |
| `--info` | 9.48:1 | 4.66:1 |
| `--accent` | 4.79:1 | 4.64:1 |
| `--accent2` | 9.32:1 | 4.66:1 |

**Worst pair anywhere: 4.63:1** (AA requires 4.5:1).

---

## Regression Matrix — negative-tested

Every fix was reverted in a scratch copy and the suite re-run. All 9 turn it red:

| Reverted fix | Suite |
|---|---|
| Light-mode semantic tokens | RED — caught |
| Dark `--text-faint` | RED — caught |
| Light `--text-faint` | RED — caught |
| `--on-*` fill tokens | RED — caught |
| forced-colors block | RED — caught |
| prefers-contrast block | RED — caught |
| prefers-reduced-transparency block | RED — caught |
| Landing button AA | RED — caught |
| Landing text alpha | RED — caught |

The suite also asserts **light/dark parity** between the two light-theme
definition sites (`[data-theme="light"]` and the `prefers-color-scheme`
fallback) — a real drift risk, since both must be edited together. It caught
one drift during development.

It also includes a **cascade test**: the accessibility modes must target
`:root:not([data-theme])`, because a bare `:root` (0,1,0) loses to the light
fallback's `:root:not([data-theme])` (0,2,0). I hit exactly this bug — all three
modes silently did nothing until specificity was raised.

---

## Why not 10/10

**180 component-CSS contrast failures remain** (88 dark, 92 light) across 80
files, down from 4,959. Measured, not estimated:

- 111 are below 3:1 — fail even the large-text threshold
- 69 are 3.0–4.5:1 — pass AA-large, fail AA-normal
- Worst: 1.02:1 (`operator.css .op-msg-user-entry`)

Cross-theme analysis of the 171 distinct failing selectors:

| Class | Count | Meaning |
|---|---:|---|
| Fail in both themes, identical backdrop | 9 | hardcoded surface — certainly real |
| Fail in one theme only | 162 | theme-specific — real, but backdrop partly inferred |

**Confidence caveat, stated plainly:** these come from a *synthetic* DOM. The
authenticated app needs a live backend session, so I could not measure the real
rendered app beyond the landing page. The probe reconstructs each rule's
selector chain and lets Chromium resolve the cascade, which is far better than
static parsing, but where a rule inherits its background the probe infers the
backdrop. Spot-checking confirmed both outcomes:

- `FileExplorer.css .file-explorer__search-input` — **real** (`background:#1a1a1a`, hardcoded, never themes)
- `EngineeringIntelligencePane.css .eip-tl-dot` — **false positive** (background set at runtime from JSX)

I did not hand-verify all 180, so I cannot claim they are all real, nor all
spurious. Claiming 10/10 here would mean asserting zero defects on evidence
that does not support it.

**What would close it:** measure the authenticated app with a real session
(seeded backend or a test-mode auth bypass), then fix what the real DOM reports.

### Other honest limitations

- **6,034 `px` font-sizes** remain. Browser *zoom* is unaffected (verified: no
  horizontal scroll at 200% or 400%), but users who set a larger **default font
  size** will not see these scale. Converting to `rem` is a large visual change
  and would exceed "recover existing capability only" — flagged, not done.
- **prefers-reduced-transparency** is implemented and asserted structurally, but
  this Chromium build does not support the media feature, so unlike the other
  two modes it is **not verified live**.
- **Interactive target sizes** were covered in B19.1 (24px minimum), not re-audited here.
- 7,048 hardcoded colours remain overall, but the ones measured as *rendering*
  incorrectly are the 180 above. The rest are shadows, low-alpha tints, and
  colour-on-brand-fill that read correctly in both themes.

---

## Verification

```
node scripts/a11y-visual-scan.cjs                        → 88 dark / 92 light
node --test tests/runtime/27-visual-accessibility.test.cjs → 16/16
node --test tests/runtime/26-accessibility-foundation.test.cjs → 22/22
node --test tests/runtime/25-accessibility-contrast.test.cjs   → 9/9
npm run test:runtime                                      → 144/144
cd frontend && npm run build                              → Compiled successfully, 0 warnings
```

Zoom reflow, measured in Chromium:

| Zoom | Viewport | Horizontal scroll |
|---|---|---|
| 100% | 1280×800 | none |
| 200% | 640×400 | none |
| 400% | 320×200 | none |

---

## Files

**Added**
- `scripts/a11y-visual-scan.cjs` — rendering-based contrast scanner
- `tests/runtime/27-visual-accessibility.test.cjs` — regression suite

**Modified** — 254 CSS files. `index.css` carries the token work: light-mode
semantic overrides, `--text-faint` repair, 15 compatibility aliases, 6 `--on-*`
tokens, and three accessibility media modes. No component was restructured; no
new design language was introduced.
