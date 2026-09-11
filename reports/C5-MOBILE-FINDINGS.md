# C.5 — MOBILE FINDINGS

Date: 2026-08-14 · Branch: `security/reality-completion`

Ranked P0–P3. Every finding classified: FIXED · DEFERRED · NOT MEASURED · INTENTIONAL · UNKNOWN · GENUINE GAP.

---

## Summary

| Rank | Count | Fixed |
|---|---:|---:|
| **P0** | 0 | — |
| **P1** | 2 | 1 fixed, 1 documented as GENUINE GAP |
| **P2** | 1 | 0 (pre-existing, unrelated to topbar) |
| **P3** | 1 | 0 (out of scope) |
| **False positives caught** | 2 | n/a — correctly not treated as defects |

---

## P1 · C5-01/01b — switcher `max-width` overrides defeated by cascade order — **FIXED**

**Classification: FIXED.**

`.org-switcher-trigger` and `.ws-switcher-trigger` both had a mobile override defeated by an identical-specificity base rule appearing later in the file. Confirmed with computed styles (`maxWidth: "160px"` when the mobile rule declared `120px`), not assumed from source alone.

**Fix:** doubled the class selector (`.org-switcher-trigger.org-switcher-trigger`) to raise specificity to (0,0,2,0), beating the base rule without `!important` or reordering the file. Same treatment applied to the workspace switcher, which had the identical bug shape with no mobile override at all.

**Measured impact:**

```
390px overflow : 204px -> 123px   (40% reduction)
430px overflow : 164px ->  83px   (49% reduction)
```

**Live-verified in a real browser, both switcher triggers correctly truncate their labels and remain functional.**

---

## P1 · C5-01c — remaining topbar overflow requires a structural change — **GENUINE GAP, not fixed**

**Classification: GENUINE GAP.**

After C5-01/01b, `.topbar-actions` still holds 9 always-visible controls totalling 503px in a 370px row. Every item is real, working functionality — none can be removed without losing reachable functionality (the mission's explicit rule), and the emergency Stop/Resume control is safety-critical.

**The obvious fix — `overflow-x: auto` on `.topbar-actions`, matching the pattern already used successfully by `.tabs` — was investigated, applied, measured, and reverted** because it breaks `.org-switcher-dropdown` and `.ws-switcher-dropdown`:

```
without overflow-x:auto : both dropdowns receive clicks correctly
with overflow-x:auto    : both dropdowns receive ZERO clicks anywhere
                           inside their own reported bounding box
```

This was proven with a real authenticated session (after discarding an earlier, invalid unauthenticated measurement — see Discovery), using the same `document.elementsFromPoint()` technique the codebase's own prior `.tabs` fix used to prove *its* defect. Structural comparison between the two dropdown implementations (DOM nesting, `position` chain, z-index, stacking context) found no explanatory difference within this audit's investigation budget.

**Per the mission's Step 12 — never trade correctness for a fix — this was not shipped.** Making organization/workspace switching unreachable on mobile to save 123px of overflow would be a materially worse outcome than the overflow itself.

**Remaining overflow: 123px at 390px, 83px at 430px, 0px at ≥768px.**

### Options for a future phase (not attempted here — outside C.5's safe-fix budget)

1. Isolate the exact CSS mechanism that lets `.tab-more-menu` tolerate the scroll container while `.org-switcher-dropdown`/`.ws-switcher-dropdown` do not.
2. Restructure `.topbar-actions` into two zones — a scrollable strip for non-dropdown items (back/forward/recent-pages/stop) and a fixed zone for the two switchers — which arithmetic confirms would fit (350px of switcher+utility content in a 370px space) but requires a JSX/DOM change beyond a CSS-only fix.
3. Move less-essential items (theme toggle — already duplicated in Settings) into the "More" pattern on mobile only.

---

## P2 · Pre-existing, unrelated to the topbar — recorded, not fixed

**Touch targets.** 2 of 36 interactive elements measured below the WCAG 2.5.8 AA 24×24px minimum:

```
.tb-dismiss     21×20px  (TrialBanner dismiss button)
.cd-panel-link  62×15px  (CustomerDashboard panel link)
```

Neither is part of the topbar-overflow investigation. Both are pre-existing and outside this audit's scope. **Not fixed — recorded for a future accessibility or design-system pass.**

---

## P3 · Out of scope

**Real device certification.** All measurements in C.5 are Chromium viewport emulation. iOS Safari, Android Chrome, and physical hardware were **not tested** — see Device Limitations in the Certification report. This is explicitly out of scope per Step 20, not a defect.

---

## False positives — investigated and correctly NOT treated as defects

### FP-1 · `.jb-step--future` (JourneyBanner) flagged as an overflow source

The document-overflow culprit-finder initially reported `.jb-track`'s content extending to `right: 688` on the Contacts tab. Investigation:

```
.jb-track computed style : overflow-x: auto
.jb-track bounding box   : left=14, right=376 (fully within 390px viewport)
.jb-track scrollWidth    : 690   clientWidth: 362
```

`.jb-track` is a **correctly implemented, already-scrollable** step track. The flagged element's `getBoundingClientRect()` reports its position within the scrolled content, which is not the same as visible page overflow. Re-running the culprit search while excluding elements inside legitimate horizontal-scroll containers confirmed `.topbar-status` — not `.jb-step`  — as the actual, consistent overflow source on every page.

**Correctly not "fixed."** This is the same discipline C.1's skip-link and C.4's translucent-background false positives required: a tool flagging something is not the same as a defect existing.

### FP-2 · Unauthenticated-shell measurements

An entire measurement pass was invalidated mid-session when the login endpoint rate-limited (`429`) and the harness silently continued measuring the public marketing page (`app--public`). The `.tb-cta`/`.tb-label` elements that appeared to be "clipping" the org-switcher dropdown were `TrialBanner` content on the wrong page entirely. **Discarded and re-measured with `login status: 200` and `hasTabs: true` explicitly verified before every subsequent measurement**, per Step 3's explicit requirement.

---

## Deferred — none new

C.1/C.2's original 204px overflow finding is the same finding C.5 was assigned to resolve, not a deferral. No new mobile issue was deferred to a later phase; C5-01c is recorded as a GENUINE GAP within C.5 itself, with the investigation and rejected fix fully documented rather than pushed further down the line.
