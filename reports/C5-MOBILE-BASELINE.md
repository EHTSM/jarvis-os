# C.5 — MOBILE BASELINE

Date: 2026-08-14 · Branch: `security/reality-completion`
**Captured before any C.5 change. `.env` untouched.**

Companion documents: [Discovery](C5-MOBILE-DISCOVERY.md) · [Findings](C5-MOBILE-FINDINGS.md) · [Recovery](C5-MOBILE-RECOVERY.md) · [Evidence](C5-MOBILE-EVIDENCE.md) · [Certification](C5-MOBILE-CERTIFICATION.md)

---

## Gate baseline

```
git status           : 110 uncommitted files (carried from C.1-C.4, not C.5's own)
branch                : security/reality-completion
npm run test:runtime  : 144 tests · 50 suites · pass 144 · fail 0 · skipped 0
.env changes          : 0
```

## Existing mobile infrastructure

No Tailwind, no dedicated mobile-only stylesheet system. Responsive behavior lives in `@media` blocks inside `frontend/src/App.css` and `frontend/src/index.css`, established across prior phases:

```
@media (max-width: 640px)   — primary mobile breakpoint, .tabs/.topbar/.palette-trigger
@media (max-width: 480px)   — secondary tightening
@media (max-width: 380px)   — brand-name hiding
@media (pointer: coarse)    — touch tap-target sizing
```

`MobilePlatformCenter.jsx`/`.css` exist but are a **feature area** (native mobile app management for end users), not a responsive-layout system — not in scope for this audit.

## Prior carry-forward findings — read first

| Phase | Finding | Verdict at time |
|---|---|---|
| C.1 | "At 390px the document scrolls horizontally" | OUT OF SCOPE, deferred to C.5 |
| C.2 | "Mobile overflow (204px at 390px) recorded for C.5" | Deferred, not fixed |
| C.4 | Responsive scored 7/10 | "clean ≥768px; existing mobile gap correctly deferred" |

All three point to the same measured number: **204px overflow at 390px width.** C.5's job was to re-measure it live, not assume it was still exactly that.

## Baseline viewport overflow — measured, auth-verified

```
390x844   : overflow = 204px   (auth verified: hasTabs=true before measuring)
430x932   : overflow = 164px
768x1024  : overflow =   0px
1024x1366 : overflow =   0px
1440x900  : overflow =   0px
```

**Confirms the carried-forward figure exactly** — 204px at 390px, matching C.1/C.2's prior measurement precisely. Not a regression, not resolved by any intervening phase.

## Root cause — identified before any fix, per Step 5

```
document.documentElement.scrollWidth  : 594
document.documentElement.clientWidth  : 390
document.body.scrollWidth             : 594
document.body.clientWidth             : 390
```

Culprit-walk (widest element exceeding the viewport, excluding legitimate horizontal-scroll containers):

```
element  : <button class="topbar-status">
rectRight: 594
width    : 41px
parent   : .topbar-actions
```

`.topbar-actions` contains **9 always-visible controls** (back/forward nav, recent-pages, emergency Stop/Resume, workspace switcher, org switcher, theme toggle, palette trigger, status) totalling 504px of content in a 370px row, with `flex-wrap: nowrap` and `overflow: visible`.

Full breakdown, each child's actual rendered width at 390px:

```
back-arrow        26px
forward-arrow      26px
recent-pages        26px
emergency Stop/Resume 52px
workspace switcher    160px  ← base rule wins over mobile override
org switcher            151px  ← base rule wins over mobile override
theme toggle               29px
palette trigger              26px
status ("Live")                41px
                                     + 8 gaps × 6px = 48px
                                     = 504px total vs 370px container
```

**Not a single-cause overflow.** Two of nine items (workspace switcher, org switcher) account for 311px of the 504px — a specific, fixable cascade bug (below). The other seven are individually correctly sized but collectively still exceed budget once those two are fixed.
