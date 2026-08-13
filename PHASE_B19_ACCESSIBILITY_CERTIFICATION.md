# Phase B.19 — Accessibility & Inclusive UX Certification

**Product:** Ooplix (jarvis-os) v1.0.0-rc1
**Date:** 2026-08-09
**Branch:** `security/reality-completion` (no merge, no push)
**Standard:** WCAG 2.2 Level AA
**Method:** Measured the **rendered DOM in a real browser** (Chromium via the project's existing `playwright-core`) in both colour schemes and five viewports. Computed real contrast ratios and focus behaviour rather than reading CSS and inferring. No new project dependencies.

> **Numbering note:** this brief was labelled B.18, which was already used by the Business Continuity certification delivered earlier in this session. Filed as **B.19** so the certification record stays unambiguous.

---

## Scope and Honesty Statement

This phase **did not** achieve WCAG 2.2 AA compliance, and the mission's success criteria are not met. What it did achieve: a real measured baseline, one reproduced defect class recovered on the highest-traffic surface with a negative-tested regression, and an evidence-backed inventory of what remains.

**The single largest finding is systemic:** **330 hardcoded `color: rgba(255,255,255,α)` rules across 59 CSS files**, while 120 of 195 CSS files correctly use `var(--text*)`. Every one of those 330 rules is a light-mode contrast failure. Fixing all of them is a design-system migration across 59 files — not a defect recovery — and this mission forbids redesign. I fixed the reproduced instances on the primary navigation and topbar and am reporting the rest as a measured engineering gap with exact counts.

**Not performed** (declared rather than guessed): NVDA/VoiceOver runtime testing (no screen reader in this environment), Safari/Firefox/Edge engine testing (only Chromium available), and axe-core/Lighthouse scans (**axe-core is not installed and I did not add a dependency to the user's project**). The checks below implement WCAG success criteria directly against the live DOM.

---

## Defect Reproduced and Recovered

### D1 — Primary navigation was invisible in light mode (**HIGH**, WCAG 1.4.3 + 2.5.8)

Measured live, in-browser, in both schemes:

| Element | Colour | Light-mode ratio | Required |
|---|---|---|---|
| `.tab` (rest) | `rgba(255,255,255,0.44)` | **1.04 : 1** | 4.5 : 1 |
| `.tab.active` | `rgba(255,255,255,0.92)` | **1.08 : 1** | 4.5 : 1 |
| `.topbar-nav-arrow` | `rgba(255,255,255,0.35)` | **1.09 : 1** | 4.5 : 1 |
| `.topbar-logo-text` | `rgba(255,255,255,0.92)` | **1.09 : 1** | 4.5 : 1 |

White text on `#f4f5f8`. The **primary tab navigation of the entire product was effectively unreadable in light mode.** The resting tab state also measured **4.31 : 1 in dark mode** — marginally under AA even there.

**The theme system was never broken.** `index.css` defines `--text` and `--text-dim` and correctly flips both for `[data-theme="light"]` **and** for `prefers-color-scheme` (`#dde2ec → #1a1f2e`, `#8994b0 → #565f78`), verified live: `--bg` and `--text` swapped correctly between schemes. These rules simply **bypassed** the token system that the rest of the file uses in 20+ places.

**Also reproduced:** the tabs rendered **23px tall** (5px vertical padding) — one pixel under the WCAG 2.2 AA **2.5.8** 24px minimum, measured on 6 tab elements.

**Recovery — existing tokens only:** `.tab` → `var(--text-dim)`, `.tab.active`/`.tab:hover` → `var(--text)`, `.topbar-nav-arrow` → `var(--text-dim)`, `.topbar-logo-text` → `var(--text)`, borders → `var(--border)`, plus `padding: 6px` and `min-height: 24px`.

Computed ratios with the existing tokens:

| State | Light | Dark |
|---|---|---|
| `.tab` rest (`--text-dim`) | **5.83 : 1** ✓ | **6.64 : 1** ✓ |
| `.tab.active` (`--text`) | **15.06 : 1** ✓ | **15.50 : 1** ✓ |

**Verified in the built, served bundle** (`main.dafd16e5.css` confirmed to contain `color: var(--text-dim)` and `min-height: 24px`), re-scanned live:

| Measure | Before | After |
|---|---|---|
| `button.tab` contrast failures | **5** | **1** |
| `button.topbar-nav-arrow` failures | **3** | **0** |
| Targets below 24px | **17** | **11** |

**Regression:** `tests/runtime/25-accessibility-contrast.test.cjs` — **9 tests, 9/9 pass**. **Negative-tested: 5 fail** with the CSS reverted.

---

## 1. Accessibility Matrix

Static inventory across **258** component files (4.8 MB of JSX).

| Element / attribute | Count | Files |
|---|---|---|
| `<button>` | **1950** | — |
| `<input>` | **540** | — |
| `<select>` | 193 | — |
| `<textarea>` | 102 | — |
| `<label>` | 199 | — |
| `<div onClick>` (non-semantic control) | **204** | — |
| `<table>` | 40 | — |
| `<form>` | 17 | — |
| `<h1>` / `<h2>` / `<h3>` | 92 / 154 / 129 | — |
| **`<main>`** | **1** | 1 |
| `<nav>` | 14 | — |
| `role=` | 97 | 47 |
| `aria-label` | 91 | 42 |
| `onKeyDown` | 94 | 60 |
| `aria-hidden` | 44 | 23 |
| `aria-selected` | 18 | 13 |
| `aria-live` | 16 | 13 |
| `tabIndex` | 14 | 12 |
| `aria-expanded` | 12 | 8 |
| `htmlFor` | **10** | 4 |
| `aria-modal` | 7 | 5 |
| `aria-current` | 4 | 2 |
| `aria-labelledby` | 3 | 2 |
| `aria-describedby` | **1** | 1 |
| **`aria-invalid`** | **0** | 0 |
| **`aria-required`** | **0** | 0 |
| **`aria-controls`** | **0** | 0 |
| **`aria-atomic`** | **0** | 0 |

**Live rendered page** (authenticated app shell): `<main>` **1**, `<nav>` 2, `<h1>` 1, skip link **present**, live region **1**, images 0, dialogs 0 open.

## 2. WCAG Matrix

| SC | Criterion | Measured | Verdict |
|---|---|---|---|
| **1.1.1** | Non-text content | 0 `<img>` rendered; 3 `alt=` in source | UNKNOWN (no images on scanned surface) |
| **1.3.1** | Info & relationships | `<main>` 1, `<nav>` 2, headings present; **1 heading-level skip**; only 10 `htmlFor` for 540 inputs | **FAIL** |
| **1.4.3** | Contrast (minimum) | Nav/topbar recovered; **25 of 73** sampled text elements still below AA in light mode | **FAIL** (partially recovered) |
| **1.4.4** | Resize text | No horizontal overflow at 200% zoom | **PASS** |
| **1.4.10** | Reflow | **Horizontal overflow at 400% zoom** (598px content in 360px) and at **390px mobile** | **FAIL** |
| **1.4.11** | Non-text contrast | Borders moved to `var(--border)`; not exhaustively measured | UNKNOWN |
| **1.4.12** | Text spacing | Minimum rendered font **9px** | **FAIL** (below readable minimum) |
| **2.1.1** | Keyboard | 25 unique elements reachable by Tab; app operable | **PASS** |
| **2.1.2** | No keyboard trap | Escape leaves the shell intact; no trap observed | **PASS** |
| **2.4.1** | Bypass blocks | **Skip link is the first tab stop** ("Skip to content") | **PASS** |
| **2.4.3** | Focus order | 1 backward jump in 25 stops; follows visual order | **PASS** |
| **2.4.7** | Focus visible | **36 of 38** focusable elements change style on focus; 13 `:focus-visible` + 30 `:focus` rules | **PASS with exceptions** (2 elements) |
| **2.5.8** | Target size (min) | Nav tabs recovered to 24px; **11 targets still below 24px** | **FAIL** (partially recovered) |
| **3.3.2** | Labels or instructions | **360 inputs rely on placeholder only**; placeholders vanish on input | **FAIL** |
| **4.1.2** | Name, role, value | **0 unnamed** interactive elements on the live shell; but **179 source inputs have no name source at all** | **FAIL** |
| **4.1.3** | Status messages | 16 `aria-live` in source, 1 live region rendered; **0 `aria-atomic`** | **PARTIAL** |
| **2.3.3** | Animation from interactions | **22 `@media (prefers-reduced-motion)` CSS rules**, media query honoured | **PASS** |

## 3. Keyboard Matrix

| Test | Result | Status |
|---|---|---|
| **Skip navigation** | `A.skip-link` — **"Skip to content", first tab stop** | CERTIFIED |
| Tab reachability | 25 stops, **25 unique** (no focus loops) | CERTIFIED |
| Tab order | first five: skip-link → Dashboard → Contacts → Payments → Pipeline | CERTIFIED |
| Backward jumps | **1** of 25 (>40px upward) | CERTIFIED |
| Escape behaviour | App shell survives; no crash, no trap | CERTIFIED |
| Focus visibility | **36 / 38** elements visibly change on focus | CERTIFIED WITH LIMITATIONS |
| `:focus-visible` rules | **13** (modern keyboard-only focus) | CERTIFIED |
| `:focus` rules | 30 | CERTIFIED |
| `onKeyDown` handlers | 94 across 60 files | CERTIFIED |
| `<div onClick>` without key handler | **204 non-semantic controls** in source | GENUINE CAPABILITY GAP |
| Command palette / dialog traps | Not reachable on the scanned shell | UNKNOWN |

**Correction recorded:** my first automated pass reported **"38 of 38 elements have no visible focus"** — a **false finding**. That check only looked for a default `outline`, missing `box-shadow`/`border`/`background` focus treatments. A proper before/after computed-style comparison on focus showed **36 of 38 elements do change**, with 13 `:focus-visible` and 30 `:focus` rules present. Focus visibility is broadly **working**; only 2 elements (`button.topbar-nav-arrow`) genuinely lacked it.

## 4. Screen Reader Matrix

| Semantic | Measured | Status |
|---|---|---|
| Landmarks | `<main>` 1 rendered, `<nav>` 2, `<header>` 7 in source | CERTIFIED WITH LIMITATIONS |
| `<main>` in source | **1 across 258 components** | GENUINE CAPABILITY GAP |
| `role=` usage | 97 across 47 files | CERTIFIED |
| `aria-label` | 91 across 42 files | CERTIFIED WITH LIMITATIONS |
| Unnamed interactive (live shell) | **0** | CERTIFIED |
| `aria-modal` on dialogs | 7 in source | CERTIFIED WITH LIMITATIONS |
| Live regions | 16 `aria-live` in source; 1 rendered | PARTIAL |
| `aria-atomic` | **0** — live-region updates may be read partially | GENUINE CAPABILITY GAP |
| `aria-busy` | 1 | GENUINE CAPABILITY GAP |
| `aria-describedby` | **1 across the whole app** | GENUINE CAPABILITY GAP |
| `aria-controls` | **0** — expandable relationships not exposed | GENUINE CAPABILITY GAP |
| `aria-expanded` | 12 across 8 files (against many more disclosures) | PARTIAL |
| Heading hierarchy | **1 level skip** on the live page | GENUINE CAPABILITY GAP |
| **NVDA / VoiceOver runtime** | **Not testable in this environment** | **UNKNOWN — NOT PERFORMED** |

## 5. Forms Matrix

| Property | Measured | Status |
|---|---|---|
| `<input>` total | **540** | — |
| With `aria-label`/`aria-labelledby` | **1** | **FAIL** |
| Wrapped by `<label>` (implicit) | 34 | PARTIAL |
| Explicit `htmlFor` pairs | **10** | **FAIL** |
| **Placeholder as only label** | **360** | **FAIL (3.3.2)** |
| **No name source at all** | **179** | **FAIL (4.1.2)** |
| `aria-required` | **0** | GENUINE CAPABILITY GAP |
| `aria-invalid` | **0** — validation errors not exposed programmatically | GENUINE CAPABILITY GAP |
| `aria-describedby` for error text | **1** | GENUINE CAPABILITY GAP |
| `<form>` elements | 17 (against 540 inputs) | OBSERVATION |
| Autocomplete / input purpose | Not observed | GENUINE CAPABILITY GAP |
| OTP / MFA fields | `mfaToken` accepted at the API (B.17); no dedicated accessible field verified | UNKNOWN |

Placeholder-only labelling is the dominant pattern (**360 fields**). It fails 3.3.2 because the placeholder disappears once the user types, leaving no persistent label, and screen readers treat it inconsistently.

## 6. Colour Contrast Matrix

Real computed ratios from the rendered DOM, both schemes.

| Surface | Light | Dark | Status |
|---|---|---|---|
| **Theme tokens** `--text` on `--bg` | **15.06 : 1** | **15.50 : 1** | CERTIFIED |
| **Theme tokens** `--text-dim` on `--bg` | **5.83 : 1** | **6.64 : 1** | CERTIFIED |
| `.tab` rest (after fix) | **5.83 : 1** | **6.64 : 1** | CERTIFIED |
| `.tab.active` (after fix) | **15.06 : 1** | **15.50 : 1** | CERTIFIED |
| `.tab` rest (**before**) | **1.04 : 1** | 4.31 : 1 | FAIL → recovered |
| `.topbar-nav-arrow` (before → after) | 1.09 → **5.83** | — | CERTIFIED |
| `.topbar-logo-text` (before → after) | 1.09 → **15.06** | — | CERTIFIED |
| Accent on accent bg (`#1a1f2e` on `#6657e8`) | **3.20 : 1** | — | FAIL |
| `ws-switcher-icon` (`#7c6fff`) | **3.46 : 1** | — | FAIL |
| `org-switcher` (`#4ecdc4`) | **1.77 : 1** | — | FAIL |
| **Sampled text elements failing AA** | **25 of 73** | 26 of 73 | FAIL |
| **Hardcoded white-text rules** | **330 in 59 files** | — | **GENUINE CAPABILITY GAP** |
| CSS files using `var(--text*)` | 120 of 195 | — | CERTIFIED |
| Light theme activation | `[data-theme="light"]` **and** `prefers-color-scheme` | CERTIFIED |
| High-contrast theme | Not present | GENUINE CAPABILITY GAP |

## 7. Responsive Matrix

| Viewport | Width | Content width | H-overflow | Status |
|---|---|---|---|---|
| **Ultra-wide** | 2560 | 2560 | No | CERTIFIED |
| Desktop | 1440 | 1440 | No | CERTIFIED |
| **Tablet** | 820 | 820 | No | CERTIFIED |
| **Zoom 200%** (720 CSS px) | 720 | 720 | **No** | CERTIFIED (1.4.4) |
| **Zoom 400%** (360 CSS px) | 360 | **598** | **YES** | **FAIL (1.4.10)** |
| **Mobile** | 390 | **598** | **YES** | **FAIL (1.4.10)** |
| Minimum rendered font | — | **9px** | — | FAIL |

200% zoom reflows correctly — the common case works. 400% zoom and real phone widths force **598px of content into 360–390px**, requiring two-dimensional scrolling, which 1.4.10 prohibits.

## 8. Motion Matrix

| Test | Measured | Status |
|---|---|---|
| `prefers-reduced-motion: reduce` matched | **Yes** | CERTIFIED |
| **`@media (prefers-reduced-motion)` CSS rules** | **22** | CERTIFIED |
| Animated/transitioned elements | 162 of 199 sampled | OBSERVATION |
| Autoplay media | None observed | CERTIFIED |
| Blinking / flashing content | None observed | CERTIFIED |
| Parallax | None observed on the scanned shell | UNKNOWN |
| Per-animation reduced-motion coverage | 22 rules against 162 animated elements — not exhaustive | PARTIAL |

Reduced motion is genuinely wired (22 dedicated rules, media query honoured) — better than most products at this stage — but coverage is partial relative to the amount of animation present.

## 9. Cognitive UX Matrix

| Property | Measured | Status |
|---|---|---|
| Navigation consistency | Single persistent topbar + tab nav across surfaces | CERTIFIED |
| Skip-to-content | Present and first in tab order | CERTIFIED |
| Breadcrumbs | `.breadcrumb-item` styles present | CERTIFIED |
| **Destructive-action confirmation** | Unconfirmed deletes were recovered in Phase A.11.8 (prior work) | CERTIFIED (prior) |
| Empty states | Present (e.g. `{"ok":true,"tickets":[]}` surfaces render empty lists) | CERTIFIED |
| Error messaging honesty | AI failures return explicit 502 rather than fabricating (B.9/B.14/B.18) | CERTIFIED |
| Terminology consistency | Search vocabulary aligned in Phase A.13 (prior) | CERTIFIED (prior) |
| Undo | Patch undo exists (ACP-2); not global | PARTIAL |
| AI explanations | Per-decision explanation exists (Sprint 4) | CERTIFIED (prior) |
| Icon-only controls | 204 `<div onClick>` and icon buttons; naming inconsistent | GENUINE CAPABILITY GAP |

## 10. Browser Compatibility Matrix

| Browser | Engine | Result |
|---|---|---|
| **Chromium 149.0.7827.55** | Blink | **TESTED** — all measurements in this report |
| Chrome | Blink | Inferred equivalent (same engine); **not separately tested** |
| Edge | Blink | Inferred equivalent; **not separately tested** |
| **Safari** | WebKit | **NOT TESTED** — no WebKit build available |
| **Firefox** | Gecko | **NOT TESTED** — no Gecko build available |

Only Blink was available. Safari and Firefox are **UNKNOWN, not passing** — WebKit and Gecko differ materially in focus rings, `:focus-visible`, and form-control accessibility.

## 11. Recovery Matrix

| Item | Before | After | Verified |
|---|---|---|---|
| `.tab` colour | `rgba(255,255,255,0.44)` | `var(--text-dim)` | Built bundle + live scan |
| `.tab.active` / `:hover` | hardcoded white | `var(--text)` | Built bundle |
| `.topbar-nav-arrow` | `rgba(255,255,255,0.35)` | `var(--text-dim)` | Built bundle |
| `.topbar-logo-text` | `rgba(255,255,255,0.92)` | `var(--text)` | Built bundle |
| `.tab` height | 23px | **24px** (`padding 6px` + `min-height`) | Built bundle |
| Borders | `rgba(255,255,255,0.07)` | `var(--border)` | Built bundle |
| Nav-tab contrast failures | **5** | **1** | Live re-scan |
| Topbar-arrow failures | **3** | **0** | Live re-scan |
| Targets < 24px | **17** | **11** | Live re-scan |
| Regression suite | — | **9/9 pass** | `node --test` |
| Negative test | — | **5 of 9 fail** reverted | `git stash` |
| Existing regressions | 144/144 | **144/144** | `npm run test:runtime` |
| All new suites (B.6–B.19) | — | **142/142** | `--test-concurrency=1` |

## 12. Executive Scorecard

| Dimension | Score | Basis |
|---|---|---|
| **Keyboard operability** | **8 / 10** | Skip link first, 25 unique stops, 1 back-jump, Escape safe, 13 `:focus-visible` rules |
| **Focus visibility** | **8 / 10** | 36/38 elements visibly focus |
| **Motion accessibility** | **7 / 10** | 22 reduced-motion rules honoured; coverage partial |
| **Theme architecture** | **8 / 10** | Tokens correct and AA-compliant in both schemes, dual activation |
| **Responsive (≤200% zoom)** | **7 / 10** | Clean reflow to 720px; fails at 360–390px |
| **Landmarks & structure** | **4 / 10** | 1 `<main>`, 1 heading skip, skip link present |
| **Colour contrast** | **3 / 10** | 25/73 still failing; **330 hardcoded white rules** |
| **Forms accessibility** | **2 / 10** | 360 placeholder-only, 179 unnamed, 0 `aria-invalid`/`aria-required` |
| **Screen-reader semantics** | **3 / 10** | 1 `aria-describedby`, 0 `aria-controls`/`aria-atomic` |
| **Cross-browser** | **2 / 10** | Blink only; WebKit/Gecko untested |
| **Screen-reader runtime** | **0 / 10** | Not performed — no NVDA/VoiceOver available |
| **Overall WCAG 2.2 AA** | **NOT COMPLIANT** | 7 of 17 evaluated criteria fail |

---

## Final Accessibility Certification

### **Accessibility Readiness: NOT WCAG 2.2 AA COMPLIANT — baseline established, one defect class recovered**

**I did not meet this mission's success criteria, and I want to be direct about that rather than present a partial fix as compliance.** WCAG 2.2 AA requires all applicable criteria to pass; **7 of the 17 I could evaluate fail**, including three — form labelling, colour contrast, and reflow — that fail at scale. "Zero accessibility regressions" holds (144/144 + 142/142 green), but "WCAG 2.2 AA compliant" does not, and no amount of scoring language would make it true.

**What I did recover is real and verified end-to-end.** The product's **primary tab navigation was effectively invisible in light mode** — white text at `rgba(255,255,255,0.44)` on `#f4f5f8`, measured at **1.04 : 1** against AA's 4.5 : 1 requirement, with the active state at 1.08 : 1 and the topbar arrows and logo at 1.09 : 1. The resting tab even measured **4.31 : 1 in dark mode**, marginally failing there too. The theme system itself was never broken: `index.css` defines `--text` and `--text-dim` and flips both correctly for explicit choice *and* OS preference — these rules simply bypassed the tokens the rest of the file already uses in 20+ places. Switching to the existing tokens yields **5.83 : 1 light / 6.64 : 1 dark** at rest and **15.06 : 1 / 15.50 : 1** active, and I confirmed the change in the actually-served bundle before claiming it: nav-tab failures dropped **5 → 1**, topbar-arrow failures **3 → 0**, and sub-24px targets **17 → 11** after also fixing the 23px tab height (WCAG 2.5.8).

**The dominant remaining finding is systemic, and it is a design-system migration rather than a defect.** There are **330 hardcoded `color: rgba(255,255,255,α)` rules across 59 CSS files** — every one a light-mode contrast failure — while 120 of 195 CSS files correctly use the tokens. Converting all 59 files is exactly the "redesign" this mission prohibits, so I fixed the reproduced instances on the highest-traffic surface and am reporting the rest with exact counts instead of quietly widening scope.

**Forms are the weakest area and the most consequential for real users.** Of **540 inputs**, exactly **1** has an `aria-label`, **10** have an explicit `htmlFor` pairing, **360 rely on a placeholder as their only label** (which disappears the moment the user types — WCAG 3.3.2), and **179 have no accessible name at all** (4.1.2). There are **zero** uses of `aria-invalid` and `aria-required` across 258 components, so validation state is never exposed programmatically: a screen-reader user cannot tell that a field is required or that it failed validation.

**Several things are genuinely better than I expected, and I verified them rather than assuming.** The skip link is present and is the **first tab stop**; 25 unique elements are Tab-reachable with only one backward jump; Escape does not trap or crash; there are **13 `:focus-visible` rules** and **22 `@media (prefers-reduced-motion)` blocks** that the browser honoured. Reflow to 200% zoom is clean.

**Two corrections to my own measurements matter here.** My first automated pass reported **"38 of 38 focusable elements have no visible focus indicator"** — a **false finding** produced by only checking for a default `outline`. A proper before/after computed-style comparison on actual focus showed **36 of 38 do change**, and only two elements genuinely lacked an indicator. I also initially scanned the **marketing landing page** and reported 10 interactive elements as if that were the product; the app gates on `localStorage` keys (`jarvis_started`, `jarvis_biz_profile`), and satisfying those revealed the real authenticated shell. Every number in this report comes from the authenticated surface.

**What was not performed, stated plainly rather than scored:** no NVDA or VoiceOver runtime testing (no screen reader in this environment), no Safari or Firefox testing (only Blink available — WebKit and Gecko differ materially on focus and form-control accessibility), and no axe-core or Lighthouse scan, because **axe-core is not installed and I declined to add a dependency to the user's project**. The checks I ran implement WCAG success criteria directly against the live DOM in a real browser, which is stronger evidence than static analysis but narrower than a full audited toolchain.

**Validation hygiene:** the five temporary scan scripts were removed from the repo; the frontend was rebuilt and the server restarted so the served bundle matches source. Regression **144/144 existing + 142/142 new (B.6–B.19)**, with the new suite negative-tested (**5 of 9 fail** with the CSS reverted). Change limited to `frontend/src/App.css` (**+31/−9**) plus one new test file. No merge, no push, no redesign, no new architecture, and **no inflated score** — the failing criteria are listed as failing.
