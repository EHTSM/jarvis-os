# Phase B19.2.1 — Visual Accessibility Recovery (Final)

**Continues:** B19.2 (4,959 → 180 component-CSS findings)
**Scanners:** `scripts/a11y-visual-scan.cjs` (synthetic) · `scripts/a11y-live-scan.cjs` (**live, authenticated** — new)
**Regression:** `tests/runtime/27-visual-accessibility.test.cjs`

---

## Score: 8.5 / 10 — blocker stated below, not inflated

The mission's own condition applies: *"Only award 10/10 if every measurable
requirement above is satisfied. Otherwise stop exactly at the highest
evidence-backed score."*

| Requirement | Result | Status |
|---|---|---|
| WCAG AA passes (tokens) | 90/90 pairs | **PASS** |
| 0 remaining real violations (synthetic CSS) | 180 → **0** real | **PASS** |
| 0 scanner false positives | 3 classes eliminated, self-tested | **PASS** |
| Light mode passes | live: **31 failures remain** | **FAIL** |
| Dark mode passes | live: **2 failures remain** | **FAIL** |
| Forced colors verified | `--text=CanvasText`, media active | **PASS** |
| High contrast verified | `--text=#ffffff`, media active | **PASS** |
| Reduced transparency | implemented; **browser lacks support** | **N/A** |
| **Live authenticated app verified** | **YES — real session, 3,035 els, 8 tabs, both themes** | **PASS** |
| Production build clean | Compiled successfully, 0 warnings | **PASS** |
| All regressions green | 144/144 + 47/47 | **PASS** |

**Blocker: 33 contrast failures remain in the live authenticated app** (31
light, 2 dark). Root cause identified and measured — see below.

---

## The headline finding: the synthetic scanner was hiding the app

B19.2 reported "0 live failures". That was **wrong**, and this phase proves it.

The live probe bailed out of any element whose ancestor painted a
`background-image`. `<body>` carries a decorative ambient gradient over an
opaque `--bg` — so **almost every element in the app was silently skipped**.

I found this by **injecting a known defect** (`.tab { color: #0b0d12 }`) and
observing the scanner report 0 failures. After the fix, the same injection
surfaced 49 findings. That single scanner bug was concealing more real defects
than every CSS fix in B19.2 corrected.

```
effBg(): bail on background-image  →  bail only when it is NOT <body>/<html>
live failures: 0 (false) → 52 (true)
```

---

## Findings: 180 → 0 synthetic, and what the live app really shows

| Stage | Synthetic | Live (authenticated) |
|---|---:|---:|
| B19.2 close | 180 | 0 *(scanner blind)* |
| After false-positive elimination | 94 | — |
| After root-cause fixes | **0** | — |
| After live-scanner repair | 1* | **52** |
| **Final** | **1*** | **33** |

\* the single synthetic finding is `.cv2-row-avatar`, whose background is
assigned in JSX — a known synthetic-DOM limitation, verified correct live.

---

## Scanner false positives eliminated (3 classes, ~86 findings)

| # | False-positive class | Count | Root cause | Fix |
|---|---|---:|---|---|
| 1 | Rule never applied to the probe node | ~72 | A CSS comment before a rule was captured into the selector group, so `chainFor()` built an element the rule could not match. The probe then measured an **unstyled** node. | Strip comments from selectors; add an unstyled reference node and skip any probe node that computes the inherited default while its rule declares a colour. |
| 2 | Decorative glyphs | 9 | `·`, `›`, `◈` separators/icons measured as text. WCAG 1.4.3 covers text, not ornament. | Derive the decorative set **from the JSX** (242 classes): a class qualifies only when *every* rendering is a lone non-alphanumeric glyph. Never hardcoded. |
| 3 | Gradient/8-digit-hex backdrops | ~5 | `#10b98115` parsed as opaque `#10b981`, giving a phantom 1:1. | Parse `#RRGGBBAA`/`#RGBA` alpha correctly. |

**Proof the scanner is not merely blinded:** injecting three defect classes
(low-contrast text, white-on-light-fill, low-alpha text) — all three **DETECTED**.

---

## Real defects recovered this phase (147 rules)

| Class | Count | Root cause | Recovery |
|---|---:|---|---|
| Text on token brand fills | 22 | `background: var(--accent)` with hardcoded `#fff`/`#000`; fills flip per theme, foreground did not | `var(--on-*)` |
| Hardcoded dark fills | 215 | `#0a0e17`, `#111827`, `#1e293b`… never theme | surface tokens |
| Dim-text literals | 66 | `#1e2333`, `#2a3050` at 1.29–1.57:1 on real content ("Updated 3:42 PM") | `--text-dim` |
| Operator dim text | 14 | `rgba(145,163,184,α)` — below α 0.80 fails (2.36:1 at the common 0.45) | `--op-text3` |
| Alpha tints | 14 | text on a low-alpha tint of its own colour, 4.2–4.47:1 | tint alpha lowered to the measured minimum |
| Component-local brand tokens | 6 | `--do-accent: #7c6fff` pinned to the dark literal | aliased to `--accent` |
| Component-local palettes | 12 | private dark canvases/text in 4 panels | aliased to themed tokens |
| Opaque dark `rgba()` fills | 114 | near-black rgba panels painted dark in light mode | `--surface-base` |
| Avatar initials **(live-only)** | 1 | white on a runtime-assigned bright palette, 1.85–3.77:1 | `#0a0c14` (worst 5.18:1) |

The avatar defect is the proof that live measurement matters: the fill is set
in JSX, so **no static or synthetic analysis could ever have found it**.

---

## Live authenticated verification — method

A real session, not a stub:

1. Generated a scrypt test credential; started the backend on `:5099` with
   `OPERATOR_PASSWORD_HASH` + `ALLOWED_ORIGINS` **via environment only** (`.env` untouched).
2. Built the frontend against it, served on `:8899`.
3. Playwright drives the **real login form** (operator auth is password-only —
   supplying an email routes to user-account auth and is rejected).
4. Waits for `.app-auth-gate` to disappear, opens the `More (82)` overflow,
   walks 8 tabs, probes after each, in **both themes**.

Evidence: `docs/a11y-evidence/{dark,light}-Dashboard.png`, 29 screenshots in `/tmp/a11y-shots`.
Coverage: **3,035 elements / 1,415 text nodes**, `authed=true`.

---

## The blocker — measured, not estimated

**33 live failures remain.** Root cause: **744 hardcoded brand colour literals
in JSX inline styles**:

```jsx
<Kpi label="Accuracy" color="#52d68a" />                     // FounderTwinConsole:62
<span style={{ color: … ? "#52d68a" : "#f0b429" }}>…</span>  // FounderTwinConsole:105
```

`#52d68a` is the **dark-mode** success green. On white it measures **1.85:1**.
These bypass the token layer entirely, so no CSS change reaches them.

Representative remaining failures:

| Ratio | Theme | Element | Colour on background |
|---:|---|---|---|
| 1.09:1 | light | `span` "Ooplix" | `rgba(255,255,255,.96)` on `rgb(244,245,248)` |
| 1.19:1 | light | `.sc-trial-bar-cta` "Upgrade →" | `#fff` on `rgb(245,232,235)` |
| 1.70:1 | light | `.dv2-trend--up` "▲12%" | `#52d68a` on `rgb(233,249,240)` |
| 1.85:1 | light | KPI "0" | `#52d68a` on white |
| 1.39:1 | dark | `.btn--primary` "Run ↵" | `rgba(16,16,16,.3)` on `rgb(84,86,93)` |

**Why I stopped here:** fixing 744 JSX literals is a distinct migration — each
needs its semantic role determined and a token substituted, then re-verified
live. Doing it partially would leave the app in a mixed state without closing
the gate, and I could not complete and verify it within this session. I am
reporting it precisely rather than claiming a 10/10 the evidence contradicts.

**What closes it:** migrate the 744 JSX literals to `var(--success)` etc. (they
already resolve correctly per theme), then re-run `scripts/a11y-live-scan.cjs`
until it reports 0/0.

---

## Regression

| Suite | Result |
|---|---|
| `27-visual-accessibility` | 16/16 |
| `26-accessibility-foundation` | 22/22 |
| `25-accessibility-contrast` | 9/9 |
| `npm run test:runtime` | 144/144 |
| Production build | Compiled successfully, 0 warnings |

**A near-miss worth recording:** a `git stash` intended to revert two landing
files silently discarded **all** B19.2 landing fixes. The regression suite
caught it immediately (16 → 13 pass). All 15 alpha rules, both button fills and
the `--text2` fix were restored and re-verified. This is exactly the failure
mode negative-tested regressions exist to catch.

---

## Accessibility modes — verified live

| Mode | Media active? | Result |
|---|---|---|
| `forced-colors: active` | yes | `--text` → `CanvasText` |
| `prefers-contrast: more` | yes | `--text` → `#ffffff` |
| `prefers-reduced-transparency` | **no** | implemented + asserted structurally; **cannot be verified** in this Chromium build |

---

## Files

**Added:** `scripts/a11y-live-scan.cjs` (live authenticated sweep),
`docs/a11y-evidence/` (screenshots).
**Modified:** `scripts/a11y-visual-scan.cjs` (line numbers, 3 false-positive
classes, JSX-derived decorative detection); ~90 component CSS files.

Test credential and backend override were environment-only; no `.env`, secret,
or production config was modified.
