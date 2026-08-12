# Phase B19.2.2 — Design Token Completion & Inline Colour Elimination

**Continues:** B19.2.1 (which closed at 8.5/10 with a stated blocker: 33 live WCAG failures)
**Scanners:** `scripts/a11y-live-scan.cjs` (live, authenticated — the authority) · `scripts/a11y-visual-scan.cjs` (synthetic)
**Commits:** `18e0e52f` … `26ffb9e0` (7 commits, 242 files)

---

## Score: 9 / 10

The mission's condition is *"Only award 10/10 if every measurable live violation
reaches zero."* Live violations **are** zero, in both themes, authenticated, and
reproduced across five consecutive runs. I am not claiming 10/10 because a
second measurable gate — the synthetic scanner — is at 53, not 0, and because
the phase's own framing ("744 literals") turned out to be wrong in a way that
matters. Both are stated below rather than smoothed over.

| Requirement | Result | Status |
|---|---|---|
| 0 remaining live WCAG contrast failures | **0 dark / 0 light**, authenticated, 3,048 els | **PASS** |
| Live authenticated scan clean | **YES** — 5 consecutive clean runs | **PASS** |
| Build clean | Compiled successfully, 0 warnings | **PASS** |
| Runtime regressions green | **144/144** | **PASS** |
| Accessibility regressions green | 25: **9/9** · 27: **16/16** · 26: 16/22 (pre-existing) | **PARTIAL** |
| Inventory of all inline literals | 2,613 painted / 319 distinct values / 138 files | **PASS** |
| Grouped by value, classified 7 ways | done, script-generated | **PASS** |
| Semantic → tokens | 3,158 + 637 + 384 + 80 + 55 replacements | **PASS** |
| Repeated literals → shared vars/components | 4 private palettes aliased; `.btn` component created | **PASS** |
| Dark/light parity, no regression | verified live in both themes every batch | **PASS** |
| 0 token bypasses except documented exceptions | **4,521 not-yet-tokenised** — documented, not zero | **FAIL** |
| Screenshots visually equivalent | 29 screenshots/run, hue+saturation preserved throughout | **PASS** |

---

## The premise was wrong, and that changed the work

The mission states *"744 hardcoded JSX colour literals"* and B19.2.1 attributed
all 33 live failures to them. Measuring first:

**The literal count was 2,613, not 744** — 319 distinct values across 138 files
(`scripts/a11y-literal-inventory.cjs`). No definition of "744" reproduces.

**More importantly, only 9 of the 33 live failures came from JSX literals.** The
other 24 had foregrounds that were *already correctly tokenised*. `#6152ff` is
`--accent` in light mode; `#1e7e47` is `--success`; `#666e8a` is `--text-faint`.
These were B19.2's own fixes, working as designed.

The real defect was different and systemic:

> Every light-theme token was calibrated **against white** and landed at
> 5.04–5.08:1 — barely over AA. But semantic text is routinely painted on its
> own `-muted` tint (chips, pills, trend badges, active filters), which is 4–8%
> darker than white. On its own tint, `--accent` measured **3.94:1**,
> `--success` 4.23:1, `--text-faint` 4.31:1.

A token calibrated against one backdrop and rendered on another. Migrating 744
JSX literals would not have fixed a single one of those 24.

---

## Root causes found and fixed

| # | Root cause | Evidence | Fix |
|---|---|---|---|
| 1 | Light tokens tuned against white only | 24 live failures at 3.93–4.49:1 on `-muted` tints | Recalibrated 7 light tokens against the **worst** tint they render on |
| 2 | Dark `--accent` had the same defect mirrored | 4.36:1 on dark tinted panels | `#7c6fff` → `#8072ff` (worst pairing 4.52:1) |
| 3 | `.btn`/`.btn--primary`/`.btn--sm` **never defined in any stylesheet** | disabled "Run ↵" painted UA grey, 1.39:1 | Defined the component on tokens; disabled state dims the *surface*, never the text |
| 4 | Chrome dimmed text via `rgba(255,255,255,α)` | 30+ elements at 1.00–1.28:1 in light mode | `--fg-rgb` + 4 alpha steps that invert with the theme (worst 5.29:1) |
| 5 | Wordmark defaulted `dark=true` | "Ooplix" at 1.09:1 on light | defaults to `--text`; the 2 fixed-dark call sites opt in explicitly |
| 6 | Panels hardcoded dark, text themed | trial bar, health pulse, DevHUD, chat, legal, journey banner | backgrounds moved to surface tokens |
| 7 | 4 private component palettes pinned to literals | ContentSEO, MissionControl, ProductionWiring, ProductionWiring2 + 13 more | aliased onto canonical tokens — call sites untouched, theming for free |
| 8 | White/black labels on brand fills | `#fff` on `--accent` = 3.77:1 | `--on-*` family (already theme-flipping) |
| 9 | Text on a tint of its **own hue** | `--danger` on `--danger-muted` = 4.41:1 | new `--on-*-tint` variants, one step darker |
| 10 | Avatar initials white on pastel fills | 1.85:1 worst | palette pinned as a documented identity exception + fixed `#0a0c14` foreground (5.18:1 worst) |
| 11 | Landing primary button | white label 3.77:1 rest / **2.96:1 hover** | pinned darker brand violet (5.39 / 4.68:1) |
| 12 | `--op-text3`, `--op-text2` below AA | 3.88:1 and 2.17:1 | raised / aliased onto global text roles |

---

## Live authenticated result — the gate that matters

```
dark:  0 failures | tabs 8 | 3,061 els, 1,428 text nodes | authed=true
light: 0 failures | tabs 8 | 3,048 els, 1,421 text nodes | authed=true
TOTAL live contrast failures: 0
```

**33 → 0.** Reproduced on five consecutive runs at full coverage.

### A scanner bug I fixed before trusting any number

The first run I read reported **18 failures, all `.cv2-row-avatar`** — and it
disagreed with B19.2.1's documented 33. It was `/tmp/a11y-live.json`, a stale
**unauthenticated** run (`authed:false`, 122 elements). The real artifact was
`/tmp/a11y-final.json`.

Worse, the scanner *exits 0* on such a run, so an unauthenticated sweep of a
login screen reports "0 failures" and reads as a pass. Mid-phase I hit exactly
that: a run printed `light: 0 failures` with `authed=false, 3 tabs, 267 els`.

`a11y-live-scan.cjs` now hard-fails that case:

```
[light] INVALID RUN — authed=false, elementsSeen=267. Login did not reach
the app shell; this result must NOT be reported as a pass.
```

It also exits non-zero when failures remain, so it can gate CI. **Every "0"
in this document comes from a run that passed this validity check.**

---

## Migration — 9 codemod passes, 4,478 replacements

Each pass is a committed, re-runnable script. Every one is deliberately
conservative and excludes by construction: token definition sites, gradients,
chart series, avatar palettes, and fixed-dark surfaces.

| Pass | Script | Replacements |
|---|---|---:|
| 1 | `a11y-token-codemod.cjs` — dark literals → semantic tokens | 3,158 |
| 2–3 | `a11y-dimtext-codemod.cjs` — recessed greys → `--text-dim`/`--text-faint` | 795 |
| 3 | `a11y-surface-codemod.cjs` — near-black panels → surface tokens | 384 |
| 4 | `a11y-onfill-codemod.cjs` — pinned labels on fills → `--on-*` | 55 |
| 8 | `a11y-palette-alias-codemod.cjs` — private palettes → canonical tokens | 80 |

Measured literal reduction (`git grep`, painted properties only):

| | phase start | now | reduction |
|---|---:|---:|---:|
| CSS | 3,886 | 1,570 | **60%** |
| JSX | 1,452 | 600 | **59%** |

### The codemod destroyed the theme once — caught, reverted, guarded

Pass 1 initially rewrote `index.css` itself, producing `--accent: var(--accent)`
and `--success: var(--success)` — self-referential declarations that collapse
the entire design system. I caught it in the same turn, `git checkout`'d, and
added two guards now permanent in every codemod:

```js
const SKIP_FILE   = /^index\.css$|^tokens\.(js|ts)$|…/;  // never the source of truth
const IS_TOKEN_DEF = /^\s*--[a-z0-9-]+\s*:/;             // a definition is not a bypass
```

The later `a11y-palette-alias-codemod.cjs` would have made the same mistake —
a dry run showed it rewriting `--text-dim`, `--on-accent` and 9 others in
`index.css`. The guard stopped it. Every codemod's regex boundaries were
unit-tested before `--apply` (e.g. `#111` must not match inside `#111827`;
`var(--success, #52d68a)` fallbacks must not be rewritten).

---

## What I made worse before making it better

After pass 1 the live scan went **33 → 63**. I report this because the recovery
is the useful part.

The new failures were `rgba(255,255,255,α)` text on light backgrounds across the
topbar. Cause: the codemod tokenised those surfaces' *backgrounds*, so the
panels went light while their hardcoded white text stayed white.

The topbar text was **never theme-aware** — `App.css` even documents it:
*"The rest of the topbar is hardcoded-dark and out of scope."* Verified against
`18e0e52f~1`: the `rgba(255,255,255,0.44)` literal was already there. B19.2.1
never saw it because its 8-tab walk never measured the topbar in light mode.

Fixed properly with `--fg-rgb` (pass: 63 → 29 → 5 → 0) rather than by reverting.

---

## Synthetic scanner: 831 → 53 (84%), not 0

B19.2.1 reported the synthetic scanner at "0 real findings". **That did not
hold.** Run against `18e0e52f~1`:

```
dark : 758 failures      light: 73 failures      = 831
```

Now **53** (45 dark / 8 light). Of those:

| | count | status |
|---|---:|---|
| Fixed-dark surfaces (landing, overlays) | 25 | whitelisted, verified against their own canvas |
| Scanner artifacts (JSX-assigned bg, textless dots) | 6 | not real — the synthetic DOM cannot see a runtime fill |
| **Real, unfixed** | **~22** | on surfaces the live walk does not reach |

The remaining ~22 are genuine and I did not close them. They live on routes the
authenticated 8-tab walk never visits (deep operator console panels, wizard
steps). Closing them needs live coverage of those routes, which is the honest
next step — not another synthetic-only fix.

---

## Token bypasses: documented, and **not** zero

`scripts/a11y-exception-whitelist.cjs` regenerates this from source every run,
so it cannot drift. 8,081 surviving literals:

| Category | Count | Justification |
|---|---:|---|
| `fixed-dark-surface` | 294 | Landing/overlays paint their own opaque dark canvas in both themes. Tokenising would invert the pairing. |
| `decorative-non-text` | 2,855 | Borders, shadows, scrollbars, dots. WCAG 1.4.3 governs text; these paint no glyphs. |
| `token-definition` | 207 | Where a colour is *authored*. Not a bypass — the light theme overrides the same names. |
| `gradient-stop` | 199 | No single computed value to contrast against. |
| `chart-series` | 4 | Data encoding; must stay stable across themes for comparability. |
| `avatar-identity` | 1 | Identity hue; contrast met by a pinned dark foreground, not by theming the fill. |
| **`NOT-YET-TOKENISED`** | **4,521** | **`background`/`color` literals with no justification.** |

**The 4,521 are not certified safe.** They are literals no scanner currently
measures as failing — mostly dark-on-dark pairs that happen to agree. 3,345 of
them sit in files with zero measured failures in either scanner. They remain a
latent risk if either side is changed in isolation. The requirement "0 remaining
token bypasses" is **not met**, and the number is reported rather than absorbed
into a category that would make it look closed.

---

## Regression

| Suite | Result |
|---|---|
| `npm run test:runtime` | **144/144** |
| `25-accessibility-contrast` | **9/9** |
| `27-visual-accessibility` | **16/16** |
| `26-accessibility-foundation` | 16/22 — **6 pre-existing**, verified |
| Production build | Compiled successfully, 0 warnings |

**Suite 26's 6 failures are keyboard/ARIA debt** (roving tabindex, Escape
bindings, dialog labelling, focusable `onClick` divs), not colour. Verified by
stashing every change in this phase and re-running: **identical 16 pass / 6 fail**.
Out of scope for a contrast phase; they are real and should be their own phase.

### These tests were never running in CI

`tests/` is in `.gitignore`, so suites 25/26/27 existed only on disk — B19.2.1
authored them, reported passes, and they were never committed. They are now
force-added and tracked.

Two suite-25 assertions were also **too narrow**: they asserted the specific
mechanism `var(--text-dim)` rather than the property "the colour follows the
theme". `rgba(var(--fg-rgb), α)` satisfies the requirement and failed the test.
I widened the assertion to accept either mechanism and documented why — and
fixed the two genuine defects the same run surfaced (`.tab` missing its WCAG
2.5.8 `min-height: 24px`, and a white hover tint that does not theme).

---

## Files

**Added:** `scripts/a11y-literal-inventory.cjs`, `a11y-token-codemod.cjs`,
`a11y-dimtext-codemod.cjs`, `a11y-surface-codemod.cjs`, `a11y-onfill-codemod.cjs`,
`a11y-palette-alias-codemod.cjs`, `a11y-exception-whitelist.cjs`.

**Modified:** `index.css` (new `--fg-rgb`/`--fg-dim-*`/`--on-*-tint` families,
7 light tokens + dark `--accent` recalibrated, `.btn` component), ~200 component
CSS/JSX files, `a11y-live-scan.cjs` (validity gate + exit codes), 3 test suites
now tracked.

Test credential and backend override were environment-only; no `.env`, secret,
or production config was modified.

---

## What I would do next

1. **Extend live coverage** to the operator console and wizard routes — that is
   what converts the remaining ~22 synthetic findings into either fixes or
   proven false positives.
2. **Burn down the 4,521** not-yet-tokenised literals, largest file first
   (`operator.css` alone holds 379).
3. **Phase the suite-26 keyboard/ARIA debt** — 931 findings, entirely unaddressed.
4. **Wire the scanners into CI** now that they exit non-zero and the tests are
   tracked, so none of this can silently regress.
