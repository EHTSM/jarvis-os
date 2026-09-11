# C.5 — MOBILE EVIDENCE

Date: 2026-08-14 · Branch: `security/reality-completion`

Raw measured evidence. Every number traces to a live, auth-verified browser session.
**No claim from source inspection alone. No unmeasured property called PASS.**

---

## 1 · Auth verification — before every measurement, per Step 3

```
login POST /auth/login -> status 200
page.evaluate(() => !!document.querySelector(".tab")) -> true   BEFORE any measurement taken
```

One measurement window was invalidated when this check would have caught a `429` rate-limit response — the harness had continued measuring an unauthenticated public page. That entire window was discarded and redone with both checks explicit and logged.

---

## 2 · Document overflow — before / after, full viewport matrix

```
             BEFORE (baseline)   AFTER (C5-01/01b)
 390×844          204px               123px
 430×932          164px                83px
 768×1024           0px                 0px
1024×1366           0px                 0px
1440×900            0px                 0px
```

## 3 · Root cause — precise measurement

```
document.documentElement.scrollWidth  : 594   (before fix)
document.documentElement.clientWidth  : 390
culprit (widest overflowing element)  : button.topbar-status, rectRight=594

.topbar-actions children, individual widths at 390px BEFORE fix:
  back-arrow(26) forward-arrow(26) recent-pages(26) stop-btn(52)
  ws-switcher(160) org-switcher(151) theme-toggle(29) palette(26) status(41)
  = 537px content + 48px gaps = ~585px in a 370px container

.org-switcher-trigger computed style BEFORE fix:
  maxWidth: "160px"   (mobile rule declared 120px — DEFEATED)

.ws-switcher-trigger computed style BEFORE fix:
  maxWidth: "160px"   (no mobile rule existed at all)
```

## 4 · After C5-01/01b — switcher widths corrected

```
.org-switcher wrapper width: 151px -> 120px
.ws-switcher  wrapper width: 160px -> 110px

.topbar-actions children AFTER fix:
  back(26) forward(26) recent(26) stop(52) ws(110) org(120)
  theme(29) palette(26) status(41) = 456px + 48px gaps = 504px / 370px container
  remaining overflow: 123px (measured, matches document-level reading exactly)
```

---

## 5 · C5-01c — the investigated-and-rejected fix, full data

### Baseline (before overflow-x:auto)

```
org-switcher dropdown click test:
  rect: {left:141, top:104, width:240, height:193}
  document.elementsFromPoint(center) includes dropdown: TRUE
  topHit: "org-switcher-header"

ws-switcher dropdown click test: TRUE, topHit: "ws-switcher-header"
```

### With overflow-x:auto applied to .topbar-actions

```
document overflow: 123px -> 0px   (the fix DOES close the overflow)

org-switcher dropdown click test:
  document.elementsFromPoint(center) includes dropdown: FALSE
  topHit: "tb-cta tb-cta--default"  (trial banner button, underneath)

  sampled 9 points across the dropdown's full bounding box (fx/fy 0.1-0.9):
  ALL 9 returned page content underneath (tb-dismiss, customer-dashboard,
  cd-header) — not a partial clip at one edge, a total miss everywhere.

ws-switcher dropdown click test: FALSE, topHit: "tb-label"
```

### Isolation tests — six hypotheses checked

```
1. overflow-y:visible declared but computes "auto" (spec-forced)
   -> confirmed on BOTH .tabs (works) and .topbar-actions (fails) — not the sole cause

2. scroll position offset (scrollLeft:19 after click)
   -> click({force:true}) without scrollIntoViewIfNeeded still showed scrollLeft:19
      and still failed — scroll position alone does not explain it

3. z-index:auto (matching .tab-more-menu's working config, injected via stylesheet)
   -> dropdown STILL failed — not the cause

4. position:fixed instead of absolute
   -> dropdown rendered at top:850 on an 844px viewport (off-screen) — a NEW
      bug, not a fix; reverted immediately

5. overflow:visible (full shorthand) forced via inline style
   -> dropdown WORKS correctly — conclusively confirms overflow-x:auto (in any
      combination with overflow-y) is the true and sole trigger

6. A/B against the unmodified codebase (git stash / git stash pop)
   -> WITHOUT any C.5 change: dropdowns work correctly
   -> confirms the defect is introduced BY overflow-x:auto, not pre-existing
```

**Conclusion: the exact mechanism was not isolated within budget. The fix was reverted rather than shipped with a known regression.**

---

## 6 · False positive — JourneyBanner step track

```
.jb-track computed overflow-x : "auto"
.jb-track bounding box        : left=14, right=376 (within 390px viewport)
.jb-track scrollWidth/clientWidth : 690 / 362  (legitimately scrollable, contained)

culprit-finder EXCLUDING elements inside legitimate h-scroll containers:
  Contacts tab  -> button.topbar-status, right=456
  Dashboard tab -> button.topbar-status, right=513
  (both trace to the SAME root cause as the 390px baseline — confirms one
   single defect source across every page, not per-page defects)
```

---

## 7 · Forms, dialogs, dashboard, typography — 390px

```
[FORMS — Payments]
  inputCount: 6, clippedCount: 0, submitBtnReachable: true

[DIALOGS — Command palette]
  found: true, fitsViewport: true, width: 390 (== viewportWidth)
  escape closes: true

[DIALOGS — Settings / destructive confirmation]
  renders correctly, docOverflow: 80 (topbar baseline for that page)

[DASHBOARD]
  cardCount: (dashboard-specific), clippedCards: 0

[TYPOGRAPHY — 60 elements checked]
  unhandledOverflow: 0
```

---

## 8 · Touch targets — Chromium emulation, NOT real-device certified

```
total interactive elements measured: 36
below WCAG 2.5.8 AA 24x24 minimum: 2
  .tb-dismiss     21x20px
  .cd-panel-link  62x15px
```

Both pre-existing, unrelated to the topbar-overflow investigation. **MEASURED: Chromium viewport emulation. NOT MEASURED: real iPhone/Android hardware, Safari iOS, Android Chrome on a physical device.**

---

## 9 · Regression gates

| Gate | Result | Counted as |
|---|---|---|
| `npm run test:runtime` | **144/144** · 50 suites · 0 fail · 0 skipped | **PASS** |
| `99-c1-accessibility-recovery` | 10/10 | **PASS — C.1 intact** |
| `100-c2-ux-error-truthfulness` | 10/10 | **PASS — C.2 intact** |
| `101-c3-performance-guards` | 11/11 | **PASS — C.3 intact** |
| `102-c4-design-system-guards` | 7/7 | **PASS — C.4 intact** |
| `90-phase-c1-search-alias-coverage` | 8/8 | **PASS** |
| `91-api-404-boundary` | 5/5 | **PASS** |
| `96-production-build-artifact-integrity` | 4/4 | **PASS** |
| **`103-c5-mobile-guards`** *(new)* | **6/6** | **PASS** |
| Production build | Compiled successfully | **PASS** |
| `REACT_APP_API_URL` at build | unset | **PASS — no poisoned artifact** |
| `19-logging-consistency` | fails | **PRE-EXISTING FAIL** — untouched |

---

## 10 · Negative tests

```
revert org-switcher specificity fix
  -> FAILED: the mobile org-switcher override must use a doubled selector ...

reintroduce overflow-x:auto on .topbar-actions
  -> FAILED: "overflow-x: auto" must NOT be applied to .topbar-actions on
             mobile — proven live to make document.elementsFromPoint() miss
             .org-switcher-dropdown and .ws-switcher-dropdown entirely

restored -> 6 passed, 0 failed
```

---

## 11 · Constraint compliance

| Constraint | Status |
|---|---|
| `.env` not modified | **HELD** — 0 entries in `git status` |
| No test weakened | **HELD** — no existing test modified; one added |
| No blanket `overflow-x:hidden` | **HELD** — never used |
| No functionality removed or hidden | **HELD** — all 9 topbar controls remain reachable |
| No dropdown broken to fix overflow | **HELD** — C5-01c reverted specifically to prevent this |
| C.1 remains intact | **HELD** — suite 99, 10/10 |
| C.2 remains intact | **HELD** — suite 100, 10/10 |
| C.3 remains intact | **HELD** — suite 101, 11/11 |
| C.4 remains intact | **HELD** — suite 102, 7/7 |
| No product architecture changed | **HELD** — one CSS specificity fix, nothing else shipped |
| No fabricated visual claim | **HELD** — every claim traces to a live measurement |
| No merge, no push | **HELD** |
| OS track untouched | **HELD** — no OS-track files modified by C.5 (the `git stash` incident recovered pre-existing parallel-session changes, none altered by C.5 itself) |
