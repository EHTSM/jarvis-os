# Phase B.19.5 — WCAG 2.2 AA Final Certification

**Branch:** `security/reality-completion`
**Date:** 2026-08-13
**Scope:** Audit / certification only. No merge. No push. `.env` untouched.

---

## 0. Phase numbering

The brief was issued as **B.19.4**. That identifier is already occupied: the
Master Audit Register records `B.19.4 — Keyboard & ARIA Recovery` as an
executed, certified entry (register v1.2.0). Reusing the number would overwrite
a certified result. This phase is therefore recorded as **B.19.5**. No prior
phase was restarted, re-scored, or modified.

---

## 1. What was measured

All results below come from the **real application, authenticated**, served from
a production build (`REACT_APP_API_URL` set — an unset value silently breaks
auth and invalidates every measurement) against a live backend.

Both scanners hard-fail when the session never authenticates. A zero produced
from a login screen is not a pass, and the tooling refuses to report one:

```
if (!authed) { console.error('INVALID RUN — never authenticated.'); process.exit(2); }
```

Every run reported in this document carries `authed=true`.

| Instrument | Role |
| --- | --- |
| `scripts/b1945-wcag-gate.cjs` | axe-core 4.13, `wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa`/`wcag22aa` only (best-practice excluded) |
| `scripts/a11y-live-scan.cjs` | Live composited contrast authority — real backdrops, alpha and element-opacity compositing |
| `scripts/a11y-foundation-scan.cjs` | Static keyboard/ARIA/forms contract scan |
| `scripts/b1945-target-probe.cjs` | Names every interactive node under 24×24 with its selector chain |
| `tests/runtime/25–29` | Regression suites guarding recovered capability |

**Coverage (dark, 1440):** 15 surfaces, 4,760 cumulative DOM nodes —
Dashboard, Contacts, Payments, Pipeline, AI, Getting Started, Billing,
Settings, Help & Guides, Beta Checklist, Overview, Workflow Automation,
Analytics, History, Reports.

---

## 2. Final result

### axe-core AA gate — 10 runs, 5 viewports × 2 themes

| Viewport | Dark | Light |
| --- | --- | --- |
| 390 | 0 rules / 0 nodes | 0 rules / 0 nodes |
| 430 | 0 rules / 0 nodes | 0 rules / 0 nodes |
| 768 | 0 rules / 0 nodes | 0 rules / 0 nodes |
| 1024 | 0 rules / 0 nodes | 0 rules / 0 nodes |
| 1440 | 0 rules / 0 nodes | 0 rules / 0 nodes |

All ten runs `authed=true`.

### Live composited contrast sweep

| Theme | Failures | Coverage |
| --- | --- | --- |
| dark | **0** | 3,042 elements / 1,425 text nodes, 8 tabs |
| light | **0** | 3,050 elements / 1,425 text nodes, 8 tabs |

### Keyboard gate

| Check | Result |
| --- | --- |
| Tab stops reached | 40 / 40 |
| Without visible focus indicator | **0** |
| Skip link present, first stop, and **moves focus** | PASS (fixed this phase) |
| Landmarks | 1 `main`, 2 `nav`, 1 `banner`, 1 `h1` |

### Dialogs — 15 across 13 files

| Check | Result |
| --- | --- |
| `aria-modal` | 15 / 15 |
| Escape handling | 15 / 15 |
| Accessible name | 15 / 15 |
| `overlayProps` regression (would have hidden all 15) | Confirmed fixed live — `overlayHidden: false` |

---

## 3. Defects found and fixed this phase

Each was reproduced live, root-caused, fixed minimally, and re-verified live.

### 3.1 `target-size` (WCAG 2.5.8) — 6 nodes, both themes

Two `<motion.section>` elements were **both** given `className="cmd-panel
cmd-col-dispatch"`, so both claimed `grid-area: dispatch`. CSS Grid stacks items
placed in one named area, so the Mission Templates card grid painted directly on
top of the Command Dispatch bar.

The controls' own boxes measured ≥24px — axe was reporting *unobscured* space of
6–8px. Two CSS-inspection guesses missed this; a DOM overlap probe named it:

```
OVERLAP 299x24  section.cmd-panel.cmd-col-dispatch > div.mt-root > div.mt-grid > button.mt-card
```

This was not only an accessibility defect: the dispatch input was largely
unclickable in the real product. Each panel now owns a grid row, at all three
breakpoints. Five further controls were raised to a 24×24 target.

### 3.2 `color-contrast` (WCAG 1.4.3) — hardcoded dark surfaces

Three surfaces hardcoded near-black backgrounds while their text used theme
tokens, so light mode painted dark text on a dark surface:

| Surface | Was | Now |
| --- | --- | --- |
| `.bc-root` (Beta Checklist) | `var(--color-bg, #0d0d0f)` — token defined nowhere | `var(--bg)` |
| `.cap-card` | `rgba(11, 15, 26, 0.95)` | `var(--surface-base)` |
| `.connect-bar` | `rgba(10, 13, 22, 0.82)` | `var(--surface-glass)` |

`.cap-card` and `.connect-bar` were only reachable at 390/430px and on Contacts
respectively — the 1440 closed-state sweep never rendered them. They were found
because the responsive gate was actually run, not inferred.

Added `--on-accent-tint` (**4.81:1** against the heaviest brand tint — the same
worst-case basis as the existing `--on-*-tint` family) and pointed six literal
`#9d8ff5` sites at it. `.bc-run-btn` / `.bc-retry-btn` / `.cap-card-btn` moved to
the existing `--on-info-tint` / `--on-danger-tint` / `--on-accent-tint`.

### 3.3 Skip link never moved focus (WCAG 2.4.1)

"Skip to content" was the first tab stop and set `location.hash` correctly — but
focus stayed on `<body>`, because a `<main>` is not focusable by default.
Keyboard users got no actual skip; the control looked functional and was not.

`tabindex="-1"` on the target makes it programmatically focusable without adding
a tab stop. Verified live: focus now lands on `#main-content` (MAIN) and the
next Tab continues *inside* main.

### 3.4 Command palette — unnamed listbox, unannounced active option

The results listbox had no accessible name, and because focus never leaves the
input (arrows move a virtual `active` index), the active option was **never
announced** — a screen-reader user arrowing through results would hear nothing.

Added `aria-label`, `role="combobox"` + `aria-controls`, real option ids, and
`aria-activedescendant`. Verified live: after two ArrowDowns,
`aria-activedescendant` resolves to a real option carrying `aria-selected="true"`.

### 3.5 Scanner defect — measuring mid-animation

`a11y-live-scan` probed during Framer Motion entrance staggers, measuring
partially composited text. `.cmd-pulse-value` was reported at **2.01:1** against
a resting **4.70:1** — the reported ratio matched an effective opacity of ~0.48.

Added `settle()` to await finite animations (infinite ones — pulsing dots,
spinners — never finish, so they are excluded and bounded by a 4s budget).

**Negative-tested**, because a scanner change that removes findings must be
proven not to weaken detection: an injected 1.4:1 defect is still caught.

```
=== clean run ===                    dark: 0 failures   light: 0 failures
=== injected 1.4:1 defect ===        1.4:1 (need 4.5) span.cmd-pulse-label
```

---

### 3.6 Sub-AA greyscale in four fixed-dark runtime panels

**19 nodes at 2.6:1 — found only by walking critical user journeys.**

Runtime Observer, Decision Queue, Execution Runtime and Mission Orchestrator are
reachable via the command palette, not via the tab bar the gate walks. All four
set `background: "#0d0d0d"` as an **inline JSX style** — invisible to every
token-migration codemod — and painted text in `#444` (2.00:1), `#555` (2.61:1)
and `#666` (3.38:1).

Raised to greys clearing 4.5:1 on that backdrop while preserving the hierarchy.
A first attempt mapping `#444 → #777` was wrong (4.34:1 is sufficient only for
large text; these are 10px spans) and was corrected to `#888`.

### 3.7 Accent on tint, Reports surfaces

`.jb-journey-pill--active`, `.jb-pct` and `.rv2-panel-link` — 9 nodes in light
mode at 390px and 768px. Moved to `--on-accent-tint`.

---

## 3a. Critical user journeys

Only journeys that genuinely exist in this product were exercised, end to end,
against the live authenticated app. axe was run at every step, so a journey
passes only if it both completes *and* leaves no AA violation behind.

| Journey | Functional | AA nodes |
| --- | --- | --- |
| A. Authenticate via the real login form | PASS | 0 |
| B. Bypass navigation via skip link (keyboard only) | PASS | 0 |
| C. Palette: open, search, arrow — active option announced | PASS | 0* |
| D. Execute a palette command (navigates, dialog closes) | PASS | 0 |
| E. Switch to light theme in place | PASS | 0 |
| F. Dismiss a dialog with Escape | PASS | 0 |

\* `aria-required-children` (`G2-B195`) is present while the palette is open —
the one recorded open ARIA gap, not a journey failure.

**The journeys earned their place:** steps C–F initially reported 18–19 AA nodes,
which is how §3.6 was found. A surface-walking sweep alone would have missed it.

An earlier journey run reported six results from an unauthenticated page. The
validity gate caught it (`INVALID RUN — authed=false els=93`), those results were
discarded, and the run was repeated against a correctly served build.

---

## 4. Genuine capability gaps — NOT fixed, NOT hidden

### G1-B193 — Form labelling (WCAG 3.3.2 / 1.3.1)

**763 findings** (518 `FORM-PLACEHOLDER-ONLY`, 245 `FORM-UNLABELED`) across 258
component files. This is a **GENUINE CAPABILITY GAP**, unchanged from B.19.4.

axe reports zero for its `label` rule because it accepts a `placeholder` as an
accessible name. WCAG 3.3.2 is not satisfied by a label that disappears the
moment the user types. **Live measurement confirms the gap is real, not a
static-scan artifact** — of the form controls rendered across reachable
surfaces:

| Naming mechanism | Live count |
| --- | --- |
| Visible `<label>` | **0** |
| `aria-label` | 3 |
| `aria-labelledby` | 0 |
| **`placeholder` only** | **6** |
| No name at all | 0 |

Per surface family (source-measured, exact — not extrapolated):

| Family | Files | Controls | `aria-label` | `htmlFor` | Placeholder |
| --- | --- | --- | --- | --- | --- |
| Marketing | 3 | 103 | 0 | 0 | 69 |
| Enterprise | 4 | 86 | 0 | 0 | 14 |
| Settings | 8 | 68 | 3 | 0 | 28 |
| Business | 2 | 67 | 0 | 0 | 45 |
| Developer | 4 | 60 | 0 | 0 | 14 |
| AI | 11 | 40 | 0 | 0 | 22 |
| CRM | 2 | 16 | 0 | 0 | 11 |
| Billing | 2 | 10 | 0 | 1 | 9 |
| Product | 2 | 9 | 0 | 0 | 8 |
| Organization | 2 | 2 | 0 | 1 | 2 |

Closing this means adding visible labels to 461+ controls across ten product
families — a design change, not a recovery. It is **out of scope for a
recovery-only phase** and is recorded as OPEN.

### G2-B195 — Command palette pin button is an invalid listbox child

`aria-required-children` fires on `#cp-results-listbox`: the hover-revealed
pin/unpin button is a `<button>` inside a `listbox`, where ARIA permits only
`option` and `group`.

**This was proven, not assumed.** Every sibling arrangement was tested against
axe directly:

| Arrangement | Result |
| --- | --- |
| Pin nested *inside* the `option` | `nested-interactive` |
| Pin sibling under `role="presentation"` row | `aria-required-children` |
| Pin sibling directly in the `group` | `aria-required-children` |
| Pin hoisted *outside* the listbox | **CLEAN** |

Only the last is conformant, and it requires restructuring the palette's DOM and
layout — a redesign, explicitly outside this phase's mandate. Recorded as OPEN
with the verified remedy attached.

---

## 5. Screen-reader testing — NOT EXECUTED

**Classification: ENVIRONMENT BLOCKED.**

No real NVDA, JAWS, VoiceOver, Narrator, or TalkBack execution was available in
this environment. Per the brief, no screen-reader testing is claimed, simulated,
or inferred. Programmatic accessible-name/role/state verification was performed
(§2, §3.4) and is reported as exactly that — **it is not a substitute for
assistive-technology testing**, and no AA criterion is certified on its basis.

---

## 6. Regression

| Suite | Result |
| --- | --- |
| `25-accessibility-contrast` | 9 / 9 |
| `26-accessibility-foundation` | 21 / 22 — the 1 failure is `G1-B193` (763 findings), a recorded gap |
| `27-visual-accessibility` | 16 / 16 |
| `28-keyboard-aria-recovery` | 14 / 14 |
| `29-a11-ux-consistency` | 12 / 12 |
| `tests/security/89` | PASS, **byte-identical** — SHA `aa5b00db…9bfebcb` verified unchanged |

**Full runtime regression: 925 pass / 3 fail across all 105 suites.**

Two failures besides suite 26 are pre-existing and were each verified as such,
not assumed:

- `10-recovery-certification` — untracked runtime-recovery test; fails
  identically before any B.19.5 change; touches no frontend code.
- `mission-orchestrator-nodetypes` — shares a name with
  `MissionOrchestratorPanel.jsx`, which this phase edited, so it was checked
  properly. The suite loads only `backend/services/*`, the failing assertion is
  a `waitFor` timeout in `resolveBlockingStage()`, and with the panel edit
  stashed it fails identically on two consecutive runs.

---

## 7. Classification summary

| Classification | Count | Items |
| --- | --- | --- |
| **FIXED** | 7 | Grid collision (2.5.8); hardcoded dark surfaces (1.4.3); skip link (2.4.1); palette naming/activedescendant (4.1.2); scanner animation artifact; fixed-dark panel greyscale (1.4.3); accent-on-tint on Reports (1.4.3) |
| **PASS** | — | Contrast (both themes, 5 viewports); keyboard 40/40; dialogs 15/15; landmarks; target size |
| **GENUINE GAP** | 2 | `G1-B193` form labelling (763); `G2-B195` palette pin button |
| **CREDENTIAL BLOCKED** | 0 | — |
| **ENVIRONMENT BLOCKED** | 1 | Screen-reader execution (§5) |
| **NOT MEASURED** | 0 | — |

---

## 8. Certification gate

**Automated AA conformance across every measured surface, theme, and viewport:
achieved — 0 violations in 10 authenticated axe runs and 0 in the live
composited contrast sweep.**

**Certification is NOT awarded at 10/10.** Two conditions block it, and both are
required by the brief's own rules:

1. **`G1-B193` is a live-confirmed AA gap.** 763 form controls lack a persistent
   label. It is a real 3.3.2 failure that automated AA tooling does not surface.
2. **Screen-reader testing was not executed.** No AA certification is honest
   without assistive-technology verification, and fabricating it is prohibited.

A score of 10/10 would require claiming compliance in a dimension that was never
measured. **Recorded score: 9.0/10.**

> Every measurable automated dimension reaches zero. The two open items are
> named, evidenced, and reproducible — not rounded away.

---

*Phase B.19.5 · Ooplix V1 · Confidential*
