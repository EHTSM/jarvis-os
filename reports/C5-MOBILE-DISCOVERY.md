# C.5 — MOBILE DISCOVERY

Date: 2026-08-14 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched. No test weakened. No OS-track work.**

Companion documents: [Baseline](C5-MOBILE-BASELINE.md) · [Findings](C5-MOBILE-FINDINGS.md) · [Recovery](C5-MOBILE-RECOVERY.md) · [Evidence](C5-MOBILE-EVIDENCE.md) · [Certification](C5-MOBILE-CERTIFICATION.md)

---

## Method

Every measurement used a real authenticated session (login verified `200`, then `hasTabs === true` confirmed **before** any measurement — per Step 3, an unauthenticated shell was never mistaken for a mobile defect). Real Chromium via Playwright, viewport emulation. No screenshots as primary evidence — computed styles, `elementsFromPoint()`, and `getBoundingClientRect()` were used throughout.

**One measurement session was discarded and redone.** Mid-investigation, the login endpoint returned `429` (rate-limited) while my harness continued measuring — the page it actually loaded was the unauthenticated public marketing shell (`app--public`), not the real app. Every reading from that window was invalid and was explicitly re-taken with `login status: 200` and `hasTabs: true` confirmed first. This is exactly the trap Step 3 warns about, and it was caught, not silently absorbed into the findings.

---

## The two-part root cause

### Part 1 — a cascade bug identical in shape across two components

`.org-switcher-trigger` and `.ws-switcher-trigger` each have:
- a **mobile override** (inside `@media (max-width: 640px)`) capping width
- a **base rule**, appearing **later in the file**, with `max-width: 160px` and **identical selector specificity** (0,0,1,0)

CSS resolves ties by source order. The base rule, appearing later, always won — at every viewport, including mobile. This is not a media-query mismatch (both rules matched); it's a pure cascade-order defeat.

**Why `.palette-trigger`'s mobile fix worked and these didn't:** `.palette-trigger`'s base rule declares no `max-width` at all, so its mobile override never had a competing declaration to lose to. `.org-switcher-trigger`/`.ws-switcher-trigger` are the only two topbar items whose base rule happens to redeclare the exact property their mobile fix needs.

### Part 2 — even after fixing Part 1, the row still doesn't fit

After correcting the cascade bug, `.topbar-actions` measured 503px of content in a 370px container — genuinely too much content for the space, not a bug in any single rule. All 9 items are real, working functionality:

```
back/forward nav        — real, has keyboard shortcuts (⌘[/⌘])
recent-pages             — real, jump to a previously visited tab
emergency Stop/Resume    — SAFETY-CRITICAL, ⌘⇧., halts all execution
workspace switcher       — real, changes active workspace
org switcher             — real, changes active organization
theme toggle             — real, but ALSO available in Settings
palette trigger          — real, opens ⌘K (already correctly mobile-optimized)
status ("Live")          — real, navigates to System Health
```

---

## The investigated-and-rejected fix — the most important finding of C.5

The obvious next step, matching a pattern the codebase already uses successfully for `.tabs`, is `overflow-x: auto` on `.topbar-actions` so the row scrolls instead of overflowing the page.

**This was tried, measured, and found to break the org/workspace switcher dropdowns**, and was reverted before being shipped.

```
WITHOUT overflow-x:auto (baseline):
  org-switcher dropdown click test: hitsDropdown = true
  ws-switcher dropdown click test:  hitsDropdown = true

WITH overflow-x:auto applied:
  org-switcher dropdown click test: hitsDropdown = FALSE
  ws-switcher dropdown click test:  hitsDropdown = FALSE
  (document.elementsFromPoint at the dropdown's own bounding-box center
   returned page content underneath it, at every sampled point)
```

This reproduces even though the exact same overflow-x:auto + overflow-y:visible pattern is documented in this codebase as the fix for an **identical-looking** prior defect on `.tabs`' own dropdown (`.tab-more-menu`). Structural comparison — DOM nesting, `position:relative`/`position:absolute` pairing, z-index — found no difference between the two that explains why one tolerates the scroll container and the other does not. The discriminating cause was not isolated within this audit's safe-fix budget.

**Per the mission's Step 8/12 (never trade correctness for a fix; a modal must never lose click reachability), this was not applied.** It is documented as a P1 finding requiring investigation beyond C.5's scope, not shipped as a broken "fix."

---

## What else was measured

| Surface | Method | Result |
|---|---|---|
| Forms (Payments @ 390px) | live, auth-verified | 6 inputs, 0 clipped, submit button reachable |
| Command palette | live, ⌘K, both open/close | fits viewport exactly (390×390), Escape closes |
| Settings / destructive confirmation | live navigation | renders, no crash, 80px baseline overflow (topbar only) |
| Dashboard | live navigation | 0 clipped cards; overflow traced to topbar, not dashboard content |
| Contacts (data list) | live navigation | list renders; a false-positive overflow signal traced to `.jb-track`, a correctly-scrolling container |
| Typography | computed `scrollWidth` vs `clientWidth` across 60 elements | **0 unhandled text overflow** |
| Touch targets | `getBoundingClientRect()` on 36 interactive elements | 2 below the WCAG 2.5.8 24×24 minimum (pre-existing, unrelated to topbar) |
| Cross-viewport | 390/430/768/1024/1440 | overflow present only ≤430px, zero at ≥768px |

**A second false positive was caught and corrected.** The document-level culprit-finder initially flagged `.jb-step--future` (inside `JourneyBanner`'s step track) as an overflow source at `right: 688`. Investigation showed `.jb-track` already has `overflow-x: auto` and is correctly contained within the viewport (`right: 376` of 390) — the flagged element's `getBoundingClientRect()` reports its position within the *scrolled* content, not actual page overflow. Re-running the culprit search while excluding elements inside legitimate horizontal-scroll containers confirmed `.topbar-status` as the true, single, consistent culprit on every page.

---

## Surfaces measured — summary

| # | Area | Measured | Result |
|---|---|---|---|
| 1 | Global overflow | ✔ | 204px → 123px at 390px (fixed part), root cause identified precisely |
| 2 | Responsive navigation | ✔ | all 9 topbar functions remain reachable; none removed |
| 3 | Forms | ✔ | 0 clipped controls |
| 4 | Dialogs/overlays | ✔ | palette fits and closes; 2 dropdowns tested for click-reachability, one unsafe fix rejected |
| 5 | Tables/data-dense | ✔ | no defect found; one false positive corrected |
| 6 | Dashboards | ✔ | 0 clipped cards |
| 7 | Touch interaction | ✔ (emulation only) | 2/36 controls below 24×24, pre-existing |
| 8 | Typography | ✔ | 0 unhandled overflow across 60 elements |
| 9 | Orientation | Partial — width variation covered (390↔430↔768); true portrait/landscape rotation not separately tested |

**NOT MEASURED:** real device testing (Step 20 — explicitly out of scope for viewport emulation), drawers/sidebars beyond what the 5 primary tabs expose, the 82 "More" tabs' individual mobile layouts (same coverage limit as C.1-C.4), performance under real mobile network conditions (belongs to C.3, not repeated here).
