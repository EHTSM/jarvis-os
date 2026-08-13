# A.11.1 — Responsive Audit

**Method:** the authenticated app was operated at each required viewport and the
document's real `scrollWidth` vs `clientWidth` measured per surface. An
attribution probe then named the specific elements exceeding the viewport.
A.11 marked responsive `NOT MEASURED`; this closes that gap.

**Not claimed from CSS inspection.** Every number below is a live measurement.

---

## Viewport results

| Viewport | Surfaces walked | Surfaces with h-scroll | Worst overflow |
|---:|---:|---:|---:|
| 1440 | 81 | **0** | — |
| 1280 | 11 | **0** | — |
| 1024 | 11 | **0** | — |
| 768 | 11 | **0** | — |
| 430 | 11 → **9** after fix | 11 → **1** | 191px → **35px** |
| 390 | 11 → **9** after fix | 11 → **9** | 231px → **18px** (Dashboard 75px) |

Desktop and tablet are clean at every measured viewport. Mobile carried a real,
product-wide defect — now substantially recovered.

---

## R1 — The topbar forced 231px of overflow on EVERY surface — **FIXED**

**Reproduced.** At 390px, every one of 11 walked surfaces reported
`scrollWidth 621` against `clientWidth 390`. The identical 561–621px floor
across unrelated surfaces pointed at one shared element, not page content.

**Attributed, not guessed.** `scripts/a111-overflow-probe.cjs` asked the DOM
which nodes exceed the viewport:

```
w=111 right=572  header.topbar > div.topbar-actions > button.palette-trigger
w= 89 right=456  header.topbar > nav.tabs > div.tab-more-wrap
w= 86 right=416  header.topbar > div.topbar-actions > button.org-switcher-trigger
```

The header row never collapsed on mobile.

**Root cause.** `App.css` *does* carry a `@media (max-width: 640px)` block — but
it targets `.app-header`, while the shell actually renders `.topbar`. The real
header had never been given mobile treatment.

**Recovered.** Extended that existing block to `.topbar` with the same idiom it
already applies to `.tabs`: `min-width: 0` so the flex row may shrink, the tab
strip scrolling inside the viewport, and the palette trigger collapsing to its
icon (its function stays reachable via ⌘K and the More menu). **No new
responsive system.**

**Measured after:**

| Viewport | Before | After |
|---|---:|---:|
| 430 | 11/11 surfaces overflowed, 191px | **1/9**, 35px |
| 390 | 11/11 surfaces overflowed, 231px | 9/9 at **18px**; Dashboard 75px |

---

## R2 — Dashboard retains 75px of overflow at 390px — **OPEN**

**Measured.** After R1, `cmd-quick-actions` and `cmd-dispatch-chips` on the
Dashboard still extend past the viewport (`right=611`, `right=548`).

**What was tried.** Both rows already declare `overflow-x: auto` and are
*designed* to scroll. `min-width: 0` plus `flex-shrink: 0` on their children was
applied — the same idiom that fixed `.tabs`. The re-measurement showed the rows
unchanged, which means the constraint is **higher in the parent chain**, not on
the rows themselves.

**Why it is OPEN and not claimed fixed.** Finding the true constraining ancestor
requires walking the Dashboard's flex chain live. That is a bounded next step,
but it was not completed, and reporting it as fixed would be false.

**Residual impact:** 18px on ordinary surfaces (a hairline), 75px on Dashboard.

---

## Per-property checklist

| Property | 1440–768 | 430/390 | Note |
|---|---|---|---|
| Navigation | CONSISTENT | **FIXED** | tab strip now scrolls inside the viewport |
| Overflow | CONSISTENT | **PARTIAL** | R1 fixed; R2 open on Dashboard |
| Drawers | CONSISTENT | **NOT MEASURED** | no drawer surface reachable in the mobile slice |
| Tables | CONSISTENT | **NOT MEASURED** | no table rendered; see T1 in the table audit |
| Cards | CONSISTENT | CONSISTENT | no card-driven overflow measured |
| Forms | CONSISTENT | CONSISTENT | 0 h-scroll attributable to inputs |
| Buttons | CONSISTENT | CONSISTENT | wrap/scroll inside their rows |
| Tabs | CONSISTENT | **FIXED** | `.tabs` given `min-width: 0` |
| Command palette | CONSISTENT | **FIXED** | trigger collapses to icon; ⌘K unchanged |
| Dialogs | CONSISTENT | **NOT MEASURED** | no dialog opened during the mobile slice |
| Typography | CONSISTENT | CONSISTENT | existing `max-width: 360px` rule already lowers base size |
| Horizontal scrolling | none | R2 only | — |
| Clipped content | none observed | none observed | — |
| Inaccessible actions | none observed | none observed | palette trigger keeps its icon + aria-label |

---

## Verdict

**Responsive consistency: MEASURED.**

- Desktop / tablet (1440, 1280, 1024, 768): **clean — 0 surfaces with h-scroll.**
- Mobile (430, 390): a real product-wide defect **reproduced, attributed and
  recovered**; one residual (R2) remains open with its exact next step.

**Not claimed:** "mobile ready". Three properties are NOT MEASURED (drawers,
tables, dialogs at mobile widths) and R2 is open. This audit deliberately does
not extend into the separate Mobile Experience Audit.
