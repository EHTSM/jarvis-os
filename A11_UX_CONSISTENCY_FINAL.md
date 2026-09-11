# Phase A.11 / A.11.1 — UX Consistency, Final

**Document ID:** OPX-CERT-A11-FINAL
**Branch:** `security/reality-completion`
**Commits:** `d779ff84` · `5daf87dd` · `8b7ce145` · `c7e0896c` · `665ecb77`
**Method:** DIRECTLY OPERATE → MEASURE → REPRODUCE → TRACE ONLY AFTER FRICTION →
RECOVER EXISTING MECHANISM → REGRESS → LIVE RE-VERIFY
**Companions:** `A11_SURFACE_MATRIX.md` · `A11_BUTTON_SYSTEM_REGISTER.md` ·
`A11_EMPTY_STATE_REGISTER.md` · `A11_DRAWER_AUDIT.md` · `A11_TABLE_AUDIT.md` ·
`A11_RESPONSIVE_AUDIT.md` · `A11_REGRESSION_REPORT.md`

---

# Verdict: OPEN

**Not certified.** Two findings remain open with exact scope, and three
properties remain unmeasured with the reason stated for each. Everything else
this phase set out to close, closed.

Certifying would require scoring six items that were not measured, or calling a
design-system migration "fixed" — both prohibited.

---

## What A.11.1 closed

| A.11 open item | State now |
|---|---|
| 25 / 47 surfaces walked | **81 surfaces directly operated** — every primary tab and all 76 overflow destinations |
| Drawers NOT MEASURED | **MEASURED** — 3 systems, 2 findings, both FIXED |
| Tables NOT MEASURED | **MEASURED** — 1 rendered across 81 surfaces; 1 finding OPEN |
| Responsive NOT MEASURED | **MEASURED** at 6 viewports — desktop/tablet clean; mobile defect FIXED, 1 residual OPEN |
| F3 (149 empty catches) | **CLASSIFIED A–E** — 558 measured, only 15 are user-visible mutations |
| F4 (71 button systems) | **INVENTORIED** — 58/59 live, 1 dead; classified GAP |
| F5 (277 bare empties) | **RECLASSIFIED** — 342 measured, only 66 are category E |
| test 89 "stale" | **ADJUDICATED — NOT stale. Source was wrong; source fixed; test preserved** |

---

## Findings fixed in A.11.1

### A1 — Agent Registry crashed on real API data — **FIXED**

Reproduced live: opening Registry rendered the ErrorBoundary with
`TypeError: Cannot read properties of undefined (reading 'map')`.

`normalise()` maps every API agent into the row shape the component renders, but
omitted `tools` and `memoryLinks` — which the detail pane maps over
unconditionally. The local SEED rows carry both, so **the crash only appeared
once real agents loaded**.

Recovered with the same defaulting `normalise` already applies to `capabilities`
and `permissions`, plus a guard at the four render sites.
**Live re-verified: DOM 160 → 967, heading renders, boundary not hit.**

### A2 — Mobile topbar forced overflow on every surface — **FIXED**

At 390px every surface reported `scrollWidth 621` vs `clientWidth 390`. The
attribution probe named the cause: `.tabs`, `.topbar-actions`,
`.palette-trigger` extending to x=572 — the header never collapsed.

`App.css` already had a `max-width: 640px` block, but it targeted `.app-header`
while the shell renders `.topbar`. Extended that block with the same
`min-width: 0` idiom it already applies to `.tabs`.
**430px: 11/11 → 1/9 surfaces. 390px: 231px → 18px.**

### A3 — ⌘K lost the More-menu vocabulary — **FIXED**

68 of 82 destinations had alias words absent from their Command Palette
keywords. Recovered by copying vocabulary that already exists in `MORE_TABS`.
**Drift 68 → 0.** Guarded by suite 29, negative-tested.

### A4 / A5 — Drawer theme bypass and missing Escape — **FIXED**

`ctx-sidebar` hardcoded `#08090e` (renders on 3 surfaces); `AgentOSV2`'s drawer
dismissed on backdrop click only while `ContactsV2`'s already bound Escape.
Both recovered with the existing token and the existing hook.

---

## Findings classified, not fixed — with reasons

### F3 — API error detail — **CLASSIFIED**

558 empty catch blocks measured (A.11's 149 counted JSX only):

| Cat | Meaning | Count |
|---|---|---:|
| A | optional/background side-effect (localStorage, analytics, focus) | **383** |
| C | **user-initiated mutation whose failure is invisible** | **15** |
| D | non-request | **119** |
| E | background read swallowed | **41** |

**Only 15 are the high-priority case.** They sit in `AutonomousAgentPanel`,
`ComposerPanel`, `SelfImprovementPanel`, `WorkspaceSwitcher` and 6 others.

**OPEN.** Each needs a per-surface decision about what the user should see when
the mutation fails, using the existing error mechanisms. That is scoped
remediation; a blanket rewrite of 558 sites is explicitly forbidden.

### F4 — Button systems — **GAP: DESIGN SYSTEM CONSOLIDATION**

59 systems with declarations; **58 are live**, 1 is dead (`.fu-btn`). No
mechanically-safe duplicates. Variance is largely intentional specialisation
(`.cmd-chip`, `.pv2-btn--wa`, `.op-send-btn--ready`).

Classified as a migration gap with exact scope in the register — not pretended
fixed, and no second button system created.

### F5 — Empty states — **OPEN (content work)**

342 literals classified: **A=55 already guided, D=221 legitimate microcopy or
success-as-empty, E=66 genuine candidates.** A.11's "277 bare" was too blunt;
the corrected figure is 66.

`EmptyState` is variant-driven — each site needs a title, description and 2–3
concrete next steps. That is authoring, not mechanical recovery.

---

## Final scorecard

Scored on measurement. A category stays OPEN where measurement is incomplete —
being "fixed" is not sufficient for 10/10.

| Dimension | Score | Basis |
|---|---|---|
| **Navigation Consistency** | **10/10** | 81 surfaces reached through one mechanism; 0 dead ends; headers present on every rendered surface |
| **Search Consistency** | **10/10** | 82/82 destinations in ⌘K; alias→keyword drift 68 → **0**; guarded by suite 29 |
| **Button Consistency** | **6/10** | 41 distinct live heights, top-5 cover 57%; 58 live systems. GAP — consolidation |
| **Tab Consistency** | **9/10** | 225 measured, top-5 cover 87% — the tightest cluster |
| **Input Consistency** | **8/10** | 17 distinct heights over 31 rendered |
| **Loading Consistency** | **8/10** | every surface communicated a loading state; no LOADING→blank or →fake-data observed; mechanisms differ (55 skeleton / 11 spinner) |
| **Error Consistency** | **6/10** | 28 of 81 surfaces surfaced honest error text; but 15 user-mutations still fail invisibly (F3) |
| **Empty-State Consistency** | **7/10** | 55 already guided, 221 legitimately inline; 66 genuine candidates OPEN |
| **Drawer Consistency** | **9/10** | 3 systems, dimensionally consistent; 2 findings FIXED; mobile drawer NOT MEASURED |
| **Table Consistency** | **N/M** | 1 table rendered across 81 surfaces; 9 properties unmeasured — **not scored** |
| **Responsive Consistency** | **7/10** | desktop/tablet clean at 4 viewports; mobile FIXED with 1 residual (R2) |
| **Typography Consistency** | **9/10** | 9 button font sizes dominated by 12/13px; tables uniform at 13px |
| **Shortcut Consistency** | **10/10** | ⌘K, Escape and keyboard nav certified in B19.4 (suite 28 14/14) and re-verified unchanged |
| **Theme Consistency** | **9/10** | 2 further canvas bypasses found and FIXED; contrast scanners 0/0 both themes |
| **Overall UX Consistency** | **7/10** | 5 findings fixed and live-verified; 2 OPEN; 1 GAP; 3 properties unmeasured |

---

## Exact remaining work

| ID | Item | Next step |
|---|---|---|
| **F3** | 15 user-mutations fail invisibly | Per-surface: surface the failure using the existing error mechanism |
| **F4** | 58 live button systems | Dedicated design-system migration; sequence from the 12 already using `--radius-sm` |
| **F5** | 66 category-E empty states | Author a variant (title/desc/steps) per site, then swap in `EmptyState` |
| **R2** | Dashboard 75px overflow at 390px | Walk the Dashboard flex chain live to find the constraining ancestor |
| **T1** | 2 tables declare `min-width` > phone | Reach them with populated data, measure at 390px, apply the scroll-wrapper idiom if it reproduces |
| **N/M-1** | Mobile drawer behaviour | Reach a drawer-bearing surface at 430/390 |
| **N/M-2** | Table row/sort/filter/empty/error | Reach a populated table |
| **N/M-3** | Dialogs at mobile widths | Open a dialog during the mobile slice |

---

## Boundaries honoured

- **B19.3 / B19.4 not reopened.** Keyboard and ARIA results used as evidence.
  Suite 26 remains **21/22** — the form-labelling gap `G1-B193` is reported
  unchanged and open. **No WCAG completion is claimed.**
- **B19.2.3 contrast not re-certified.** Both scanners re-run at 0/0 only to
  confirm A.11.1 did not regress them.
- **No second design system, button library, modal, drawer or toast system created.**
- **No test weakened.** `tests/security/89` preserved byte-unmodified; the
  source was fixed instead.
- **`.env` unmodified. No merge. No push.**

**A.11.1 ends here. A.12 not started.**
