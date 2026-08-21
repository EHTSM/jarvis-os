# C.5 — MOBILE RECOVERY

Date: 2026-08-14 · Branch: `security/reality-completion`

What changed, why it was minimal and correct, what was investigated and deliberately NOT shipped, and how each was verified.
**Every fix: MEASURE → REPRODUCE → ROOT CAUSE → MINIMAL FIX → LIVE VERIFY (390/430/768/1440) → REGRESSION.**

---

## Fix policy applied

| Priority (mission order) | Applied |
|---|---|
| 1. correct broken layout constraints | **C5-01/01b** — the cascade-order bug |
| 3. fix overflow source | Root cause identified and partially closed |
| 6. fix navigation collapse | **Explicitly avoided** — C5-01c investigated, found unsafe, reverted |

**Never applied:** blanket `overflow-x: hidden`, hiding important information, deleting features, a duplicate mobile component system, forking the application, rewriting the design system, altering unrelated OS functionality.

---

## Files changed — 1 source file, 1 test added

```
M frontend/src/App.css                         C5-01/01b switcher max-width cascade fix
+ tests/security/103-c5-mobile-guards.cjs       6 assertions, negative-tested
```

**No existing test modified.** `.env` untouched. No JSX/component logic touched — the fix is CSS-only.

---

## C5-01/01b — the cascade-order fix

```diff
- .org-switcher-trigger { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
+ .org-switcher-trigger.org-switcher-trigger { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }

+ .ws-switcher-trigger.ws-switcher-trigger { max-width: 110px; overflow: hidden; text-overflow: ellipsis; }
```

Doubling the class selector raises specificity from (0,0,1,0) to (0,0,2,0) without `!important` and without reordering the file — the base rule (also 0,0,1,0, later in source order) previously always won. This is the minimal correct fix: it targets the exact mechanism of the defeat, nothing more.

### Live verification — before / after, all required viewports

```
            BEFORE overflow    AFTER overflow
 390×844         204px             123px
 430×932         164px              83px
 768×1024          0px               0px    (unchanged — desktop was never broken)
1024×1366          0px               0px    (unchanged)
1440×900           0px               0px    (unchanged — the required desktop check per Step 17)
```

**Desktop was verified NOT broken** — the `.trigger.trigger` selector only changes specificity, not the rule's applicability; the base 160px rule is untouched and still governs desktop.

---

## C5-01c — investigated, applied, measured, and REVERTED

This is documented in detail because the decision process matters as much as the outcome.

### What was tried

```css
.topbar-actions {
  overflow-x: auto;
  overflow-y: visible;
  -webkit-overflow-scrolling: touch;
  max-width: 100%;
}
```

The same pattern `.tabs` already uses successfully, with the same `overflow-y: visible` companion the codebase's own prior fix (documented in the `.tabs` comment) says is required to prevent `position:absolute` dropdown children from being clipped.

### What it actually did

```
document overflow at 390px : 123px -> 0px    (the overflow problem, fully closed)

org-switcher-dropdown click test : PASS -> FAIL
ws-switcher-dropdown click test  : PASS -> FAIL
  (document.elementsFromPoint at the dropdown's own center returned
   page content underneath it, at every sampled point across the
   dropdown's full bounding box — not a partial clip, a total miss)
```

### Why it was reverted rather than shipped with a caveat

The mission's Step 12 is explicit: **"Performance optimization must never trade correctness for speed"** and the equivalent instruction for this phase — never trade a working dropdown for a cosmetic overflow fix. Organization switching and workspace switching are core account-management functions; making them unreachable on the majority of real-world screen widths (390–430px covers the large majority of phones in active use) to close 123px of horizontal scroll would be a materially worse product than the overflow it "fixes."

### What investigation was done before giving up

Six distinct hypotheses were tested live, each disproven or found not to explain the discrepancy:

1. **Overflow-y not actually computing to `visible`** — confirmed `.tabs` itself also computes `overflowY: "auto"` (browser overflow-spec forcing), yet `.tabs`' own dropdown works. Ruled out as the sole explanation.
2. **Scroll position offset** — forcing `click({force:true})` without `scrollIntoViewIfNeeded()` still showed `scrollLeft:19`; not the cause on its own.
3. **z-index** — set to `auto` (matching `.tab-more-menu`'s working configuration) via injected stylesheet; dropdown still failed.
4. **`position: fixed` instead of `absolute`** — dropdown rendered off-screen (`top: 850` on an 844px viewport) — a different bug, not a fix.
5. **Forcing `overflow: visible` (the full shorthand, not split longhands)** on `.topbar-actions` — this DID restore the dropdown, conclusively proving `overflow-x:auto` is the true and sole cause, and ruling out z-index/stacking-context ancestors as red herrings.
6. **A/B comparison against the unmodified codebase** — confirmed the defect is caused by adding `overflow-x:auto`, not a pre-existing issue coincidentally surfaced by this audit.

**The precise mechanism by which `.tab-more-menu` tolerates the identical container pattern while `.org-switcher-dropdown`/`.ws-switcher-dropdown` do not was not isolated.** That is recorded honestly as the boundary of this audit's investigation, not glossed over.

### Current state

The CSS change was fully reverted. `.topbar-actions` carries **no** `overflow-x` declaration on mobile — the container remains at its C5-01/01b-reduced 123px overflow, with both dropdowns fully functional. This is locked by the regression suite (asserts the unsafe rule is absent) so a future attempt cannot silently reintroduce it without the suite catching it.

---

## Incident during investigation — disclosed

While diagnosing whether the dropdown defect pre-existed C5-01c, a `git stash` was run to test the unmodified codebase. **This stashed all uncommitted work from the entire multi-phase session** (C.1 through C.5's own fixes), not only the intended diagnostic CSS. It was immediately recovered with `git stash pop`, and every fix marker (`C1-D1`, `C2-01`, `C3-01`, `C4-01`, `C5-01c`) plus a full `npm run test:runtime` (144/144) was verified intact afterward. No work was lost. This should not have been the chosen method — a targeted `git diff`/`git checkout -- <file>` on the one file under test would have carried no risk to the shared working tree, and is the lesson taken from this incident.

---

## Regression — no test weakened

| Gate | Before C.5 | After C.5 |
|---|---|---|
| `npm run test:runtime` | 144/144 · 0 fail · 0 skipped | **144/144 · 0 fail · 0 skipped** |
| `99-c1-accessibility-recovery` | 10/10 | **10/10 — C.1 intact** |
| `100-c2-ux-error-truthfulness` | 10/10 | **10/10 — C.2 intact** |
| `101-c3-performance-guards` | 11/11 | **11/11 — C.3 intact** |
| `102-c4-design-system-guards` | 7/7 | **7/7 — C.4 intact** |
| `90-phase-c1-search-alias-coverage` | 8/8 | **8/8** |
| `91-api-404-boundary` | 5/5 | **5/5** |
| `96-production-build-artifact-integrity` | 4/4 | **4/4** |
| `103-c5-mobile-guards` *(new)* | — | **6/6** |
| Production build | PASS | **PASS** — no poisoned `REACT_APP_API_URL` |

---

## Negative tests — both guards provably fail when reverted

```
revert org-switcher specificity fix
  -> FAILED: the mobile org-switcher override must use a doubled selector
             (specificity 0,0,2,0) to beat the base rule's identical-specificity
             max-width:160px

reintroduce overflow-x:auto on .topbar-actions
  -> FAILED: "overflow-x: auto" must NOT be applied to .topbar-actions on
             mobile — proven live to make document.elementsFromPoint() miss
             .org-switcher-dropdown and .ws-switcher-dropdown entirely

restored -> 6 passed, 0 failed
```

The live half of the suite additionally re-proves both dropdowns are clickable at 390px on every run — this is not a static assertion alone, it is re-verified against the real running application.

---

## What was deliberately NOT done

| Not done | Why |
|---|---|
| `overflow-x: hidden` anywhere | Explicitly forbidden by the mission — hides broken layout instead of fixing it |
| Remove back/forward nav | Real function, keyboard shortcuts, no replacement interaction exists |
| Remove the emergency Stop/Resume control | Safety-critical (⌘⇧.) — must remain reachable per the mission |
| Ship `overflow-x:auto` on `.topbar-actions` | Proven to break org/workspace switching — correctness over cosmetic fix |
| Fix the 2 sub-24px touch targets | Pre-existing, unrelated to the topbar-overflow investigation this phase targeted |
| Restructure `.topbar-actions` into two zones | Requires a JSX change beyond a CSS-only minimal fix; recorded as a future option |
| Global font-size reduction | Not needed — 0 unhandled text overflow measured; would have been an unjustified blanket change |
