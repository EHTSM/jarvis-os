# Phase B.19.5 — Findings Register

Every finding raised in this phase, with its classification, evidence, and
disposition. Nothing is marked "probably okay".

---

## FIXED

### F1 — Two panels shared one grid area, obscuring the dispatch bar
**Criterion:** WCAG 2.5.8 Target Size (Minimum) · **Impact:** serious · **Nodes:** 6 (both themes)

Mission Templates and Command Dispatch both carried `className="cmd-panel
cmd-col-dispatch"`, so both resolved to `grid-area: dispatch`. Grid stacks items
in a shared named area; the templates card grid painted over the dispatch bar.

Reported boxes were already ≥24px — axe measured *unobscured* space at 6–8px:

```
[target-size] 763x42  input.cmd-dispatch-input
   smallest space is 763.3px by 6px, should be at least 24px
[target-size]  93x24  button.cmd-chip "Health check"
   smallest space is 92.7px by 8px, should be at least 24px
```

Two CSS-inspection guesses were wrong before a DOM overlap probe named the cause:

```
OVERLAP 299x24  section.cmd-panel.cmd-col-dispatch > div.mt-root > div.mt-grid > button.mt-card
```

**Fix:** dedicated `templates` grid area at all three breakpoints.
**Also a functional defect** — the dispatch input was largely unclickable.
**Verified:** dark 1440 → 0 nodes.

---

### F2 — Hardcoded dark surfaces with themed text
**Criterion:** WCAG 1.4.3 Contrast (Minimum) · **Impact:** serious

| Surface | Was | Measured | Now |
| --- | --- | --- | --- |
| `.bc-root` | `var(--color-bg, #0d0d0f)` (token undefined app-wide) | 76 nodes | `var(--bg)` |
| `.cap-card` | `rgba(11, 15, 26, 0.95)` | 6 nodes @ 390/430 | `var(--surface-base)` |
| `.connect-bar` | `rgba(10, 13, 22, 0.82)` | 2 nodes (Contacts) | `var(--surface-glass)` |

`.cap-card` and `.connect-bar` are reachable only at narrow viewports and on
Contacts. They were found because the responsive gate was executed, not inferred.

**Verified:** 0 nodes at all 5 viewports × both themes.

---

### F3 — Brand tint text on brand tint backdrop
**Criterion:** WCAG 1.4.3 · **Impact:** serious · **Nodes:** 6

`#9d8ff5` is a dark-mode brand tint painted on brand-tinted backdrops; measured
**2.05:1** in light mode.

**Fix:** added `--on-accent-tint` (light `#3a2fa6`, **4.81:1** against the
heaviest 0.35-alpha brand tint — the same worst-case basis used for the existing
`--on-*-tint` family; dark aliases to `--accent`, so dark is unchanged). Six
literal sites converted. `.bc-run-btn` / `.bc-retry-btn` / `.cap-card-btn` moved
to the existing `--on-info-tint` / `--on-danger-tint` / `--on-accent-tint`.

`frontend/src/design/brand.js` `p300` was **deliberately left alone** — it is a
palette *definition* site, the same class of site the B19.2.2 codemod guard
protects after an earlier codemod collapsed the theme by rewriting
`--accent: var(--accent)`.

---

### F4 — Skip link updated the hash but never moved focus
**Criterion:** WCAG 2.4.1 Bypass Blocks · **Impact:** serious

```
before:  first tab stop: {"cls":"skip-link","text":"Skip to content"}
         after activating: {"id":"","tag":"BODY","hash":"#main-content"}
```

A `<main>` is not focusable by default, so keyboard users got no actual skip.
The control looked functional and was not.

**Fix:** `tabIndex={-1}` on `#main-content` (programmatically focusable, not a
tab stop) + `.app-main:focus { outline: none }`.

```
after:   after skip: {"id":"main-content","tag":"MAIN"}
         next tab stop: {"cls":"cmd-pulse-refresh","insideMain":true}
```

---

### F5 — Command palette: unnamed listbox, unannounced active option
**Criterion:** WCAG 4.1.2 Name, Role, Value · **Impact:** serious · **Nodes:** 1

`aria-input-field-name`: `.cp-results` declared `role="listbox"` with no
accessible name. Worse, focus never leaves the input — ArrowUp/Down move a
virtual `active` index — so the active option was **never announced**. A screen
reader user arrowing through results would hear nothing.

**Fix:** `aria-label="Command results"`, `role="combobox"` + `aria-expanded` +
`aria-controls` on the input, `id={cp-opt-N}` on each option, and
`aria-activedescendant`. Groups declare `role="group"`.

**Verified live** after two ArrowDowns:
```
{"activedescendant":"cp-opt-10","resolves":true,"text":"⬡Execution Engine","selected":"true"}
```

---

### F6 — Live scanner measured mid-animation
**Class:** instrument defect (false positive) · **Impact:** measurement integrity

The probe fired during Framer Motion entrance staggers, measuring partially
composited text. `.cmd-pulse-value` reported **2.01:1** against a resting
**4.70:1**; the reported value matched an effective opacity of ~0.48.

Confirmed by computation rather than assumption:

| Opacity | label | value |
| --- | --- | --- |
| 1.0 | 6.02:1 | 4.70:1 |
| 0.5 | 2.43:1 | 2.10:1 |

**Fix:** `settle()` awaits finite animations; infinite ones (pulsing dots,
spinners) are excluded and bounded by a 4s budget.

**Negative-tested** — a scanner change that removes findings must be proven not
to weaken detection. An injected 1.4:1 defect is still caught:

```
clean run:       dark 0 / light 0
injected defect: 1.4:1 (need 4.5) span.cmd-pulse-label
```

---

### F7 — Sub-AA greyscale in four fixed-dark runtime panels
**Criterion:** WCAG 1.4.3 · **Impact:** serious · **Nodes:** 19

**Found by walking critical user journeys, not by the tab sweep.** Navigating
via the command palette reaches Runtime Observer, Decision Queue, Execution
Runtime and Mission Orchestrator — surfaces the gate's tab walk never visits.

All four set `background: "#0d0d0d"` as an **inline JSX style**, which is why
every token-migration codemod missed them, and paint text in greys that fail on
that backdrop:

| Colour | Ratio on `#0d0d0d` | Verdict |
| --- | --- | --- |
| `#444` | 2.00:1 | fail |
| `#555` | 2.61:1 | fail |
| `#666` | 3.38:1 | fail |
| `#777` | 4.34:1 | fail for text under 18.66px |
| `#888` | 5.48:1 | pass |
| `#999` | 6.82:1 | pass |

**Fix:** each failing step raised to one that clears 4.5:1, preserving the
hierarchy the greys encoded. A word-boundary guard prevents `#444` matching
inside a longer hex.

**A first pass mapped `#444 → #777` and was wrong.** 4.34:1 clears 4.5 only for
large text; these are 10px spans, so axe still flagged 14 nodes. Corrected to
`#888` and re-verified per panel:

```
Runtime Observer 0 | Decision Queue 0 | Execution Runtime 0 | Mission Orchestrator 0
```

---

### F8 — Accent on tint, Reports surfaces
**Criterion:** WCAG 1.4.3 · **Impact:** serious · **Nodes:** 9

`.jb-journey-pill--active`, `.jb-pct` (9px) and `.rv2-panel-link` painted
`--accent` on brand-tinted / light panels. Flagged in light mode at 390px
(7 nodes) and 768px (2 nodes) — viewports where these surfaces are reachable.

**Fix:** `--on-accent-tint`, the token added in F3. Dark is unchanged, since it
aliases to `--accent` there.

---

## GENUINE CAPABILITY GAP — OPEN

### G1-B193 — Form labelling
**Criterion:** WCAG 3.3.2 Labels or Instructions / 1.3.1 · **Findings:** 763
**Status:** OPEN — carried from B.19.4, re-measured, not closed

518 `FORM-PLACEHOLDER-ONLY` + 245 `FORM-UNLABELED` across 258 files.

axe reports 0 for `label` because it accepts a `placeholder` as an accessible
name. WCAG 3.3.2 is not satisfied by a label that vanishes when the user types.

**Live measurement proves the gap is real, not a static-scan artifact.** Of the
form controls rendered across reachable surfaces: 0 have a visible `<label>`,
3 use `aria-label`, and **6 are named by `placeholder` alone**.

Per-family exact counts are in the certification report §4. Closing this means
adding visible labels to 461+ controls across ten product families — a design
change, not a recovery, and out of scope for a recovery-only phase.

---

### G2-B195 — Palette pin button is an invalid listbox child
**Criterion:** WCAG 4.1.2 · **Nodes:** 1 · **Status:** OPEN

`aria-required-children` on `#cp-results-listbox`. The hover-revealed pin button
is a `<button>` inside a `listbox`, which permits only `option` and `group`.

**Every alternative was tested against axe directly rather than reasoned about:**

| Arrangement | Result |
| --- | --- |
| Pin nested inside the `option` | `nested-interactive` |
| Pin sibling under `role="presentation"` row | `aria-required-children` |
| Pin sibling directly in the `group` | `aria-required-children` |
| Pin hoisted outside the listbox | **CLEAN** |

Only the last conforms, and it requires restructuring the palette DOM and
layout — a redesign, outside this phase's mandate. Verified remedy recorded.

**Mitigating fact (measured, not assumed):** the pin button is `opacity: 0`,
revealed on `:hover`, and is not in the arrow-key model — it is a mouse-only
affordance, so the practical assistive-technology impact is limited to the
listbox's structural validity rather than a lost capability.

---

## ENVIRONMENT BLOCKED

### E1 — Screen-reader execution
No real NVDA, JAWS, VoiceOver, Narrator, or TalkBack was available. Per the
brief, nothing is claimed, simulated, or inferred. Programmatic name/role/state
checks were run and are reported as exactly that — not as a substitute.

---

## PRE-EXISTING, NOT ATTRIBUTED TO THIS PHASE

### P1 — `tests/runtime/10-recovery-certification`
Fails identically before any B.19.5 change. An untracked runtime-recovery test
touching no accessibility, CSS, or frontend code. Recorded for completeness.

### P2 — Page error `"Not a member of this workspace"`
A backend authorization response for the operator credential against a workspace
it does not belong to. Present in prior runs; not a regression from this phase.

---

*Phase B.19.5 · Ooplix V1 · Confidential*
