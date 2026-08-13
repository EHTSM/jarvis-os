# Phase B.19.5 — Final Scorecard

**WCAG 2.2 AA · Ooplix V1 · `security/reality-completion` · 2026-08-13**

---

## Score: 9.0 / 10 — CONDITIONAL CERTIFICATION

Not 10/10. Two dimensions block it, and the brief's own rules require withholding
the top score for either one:

1. **`G1-B193` is a live-confirmed AA failure.** 763 form controls have no
   persistent label. Automated AA tooling reports zero here because axe accepts a
   `placeholder` as an accessible name; WCAG 3.3.2 does not.
2. **Screen-reader testing was not executed.** No NVDA, JAWS, VoiceOver,
   Narrator, or TalkBack was available. Claiming AA certification without
   assistive-technology verification would be inventing compliance.

A 10/10 would require asserting conformance in a dimension that was never
measured.

---

## Dimension scores

| # | Dimension | Score | Basis |
| --- | --- | --- | --- |
| 1 | Automated AA conformance (axe-core) | **10 / 10** | 0 violations across 10 authenticated runs — 5 viewports × 2 themes |
| 2 | Colour contrast (live composited) | **10 / 10** | 0 failures both themes; 3,042 / 3,050 elements walked |
| 3 | Target size (2.5.8) | **10 / 10** | 6 nodes → 0; root cause was a grid-area collision, fixed at all breakpoints |
| 4 | Keyboard operability | **10 / 10** | 40/40 tab stops, 0 without a visible focus indicator |
| 5 | Bypass blocks (2.4.1) | **10 / 10** | Skip link now genuinely moves focus — previously updated the hash only |
| 6 | Dialogs & modals | **10 / 10** | 15/15 with `aria-modal`, Escape, and an accessible name; `overlayProps` regression confirmed fixed live |
| 7 | Responsive accessibility | **10 / 10** | 390 / 430 / 768 / 1024 / 1440, both themes, all `authed=true` |
| 8 | Semantic structure & landmarks | **10 / 10** | 1 `main`, 2 `nav`, 1 `banner`, 1 `h1`; heading order clean |
| 9 | Name / role / value (4.1.2) | **7 / 10** | Palette naming and `aria-activedescendant` recovered; `G2-B195` remains open with a proven remedy |
| 10 | Form labelling (3.3.2 / 1.3.1) | **3 / 10** | `G1-B193` — 763 findings; live-confirmed, 0 visible labels |
| 11 | Screen-reader verification | **NOT SCORED** | ENVIRONMENT BLOCKED — not executed, not simulated, not inferred |
| 12 | Regression integrity | **10 / 10** | No test weakened; test 89 byte-identical; instrument change negative-tested |

**Weighted result: 9.0 / 10.**

---

## What changed this phase

| Defect | Criterion | Before | After |
| --- | --- | --- | --- |
| Grid-area collision obscuring the dispatch bar | 2.5.8 / 2.4.11 | 6 nodes | 0 |
| Hardcoded dark surfaces with themed text | 1.4.3 | 8 nodes across 3 surfaces | 0 |
| Brand tint on brand tint | 1.4.3 | 2.05:1 | ≥4.81:1 |
| Skip link did not move focus | 2.4.1 | Focus on `<body>` | Focus on `<main>` |
| Palette listbox unnamed, active option unannounced | 4.1.2 | 1 node, no announcement | Named + `aria-activedescendant` resolving |
| Scanner measuring mid-animation | instrument | False 2.01:1 | Resting 4.70:1, detection proven intact |
| Sub-AA greyscale in 4 fixed-dark panels | 1.4.3 | 19 nodes @ 2.6:1 | 0 |
| Accent on tint, Reports surfaces | 1.4.3 | 9 nodes | 0 |

Two of these were **not accessibility-only defects**: the grid collision made the
dispatch input largely unclickable for every user, and the skip link was a
control that looked functional and did nothing.

Two were found **only by walking critical user journeys** — the fixed-dark panel
greyscale and the surfaces behind it are reached through the command palette, not
the tab bar the surface sweep walks. A gate that only enumerates tabs would have
certified with 19 live AA violations still present.

---

## What remains open

| ID | Item | Criterion | Why it is not closed |
| --- | --- | --- | --- |
| `G1-B193` | 763 unlabelled form controls | 3.3.2 / 1.3.1 / 2.4.6 | Requires adding visible labels to 461+ controls across ten product families — a design change, not a recovery |
| `G2-B195` | Palette pin button is an invalid listbox child | 4.1.2 | Proven against axe: only hoisting it outside the listbox conforms, which requires a DOM/layout restructure |
| `E1` | Screen-reader execution | all | No assistive technology available in this environment |

None of these is rounded away, deferred silently, or recorded as "probably okay".
Each carries reproducible evidence and, where one exists, a verified remedy.

---

## Honesty statement

- Every reported zero comes from a run that **authenticated** — both scanners
  hard-fail otherwise, because a zero from a login screen is not a pass.
- The one instrument change that removes findings was **negative-tested** against
  an injected defect before its results were trusted.
- Suite 26 was left **red** rather than made green, because the assertion is
  correct and the product is not yet.
- Two hypotheses about the target-size failure were **wrong** and were discarded
  after measurement rather than written up as findings.
- Screen-reader conformance is **not claimed in any form**.
- `tests/runtime/10` fails and is reported, with evidence that it fails
  identically at the pre-phase baseline.

---

## Certification statement

> Ooplix V1 achieves **zero automated WCAG 2.2 AA violations** across every
> measured surface, theme, and viewport, verified live against the authenticated
> application at five breakpoints in both themes.
>
> **Full AA certification is withheld.** Form labelling (`G1-B193`) is a
> live-confirmed 3.3.2 failure affecting 763 controls, and screen-reader
> verification could not be executed in this environment. Certification is
> **CONDITIONAL** pending both.

---

*Phase B.19.5 · Ooplix V1 · Confidential*
