# C.4 — DESIGN SYSTEM EVIDENCE

Date: 2026-08-14 · Branch: `security/reality-completion`

Raw measured evidence. Computed styles and axe verification used, not source inspection alone.
**No claim from source regex alone. No unmeasured property called PASS.**

---

## 1 · C4-01 — before / after, live

```
BEFORE — inject .tw-toast without visiting Team Workspace first:
  position       : static
  background     : rgba(0, 0, 0, 0)
  border         : none
  borderRadius   : 0px
  padding        : 0px
  fontWeight     : 400
  zIndex         : auto

build evidence:
  chunk shipping .tw-toast rule    : 7070.b71fbcba.chunk.css
  chunk shipping k2-tokens-panel   : 3297.45eadfcf.chunk.css   ← DIFFERENT chunk
```

```
AFTER — real navigation to Settings via the More menu, no prior Team Workspace visit:
  loaded CSS chunks: 4
  .tw-toast rule present in a loaded stylesheet: true

build evidence:
  chunk shipping k2-tokens-panel AND .tw-toast: 3297.9c3fcb14.chunk.css  ← SAME chunk
```

---

## 2 · C4-02 — distance measurement (the decision evidence)

```
--warning token: #f0b429  ->  RGB(240, 180, 41)
#fbbf24         ->  RGB(251, 191, 36)
euclidean distance: 16.3  (0-441 scale; for comparison, C4-03's #4ade80 measured 15.1
                            and both are visually indistinguishable from their token)
```

### All 47 occurrences classified individually before any edit

```
17 files INCLUDED (warning/medium/degraded/pause/alert/risk semantics confirmed):
  ComposerPanel.css(1) DOP1Dashboard.css(5) CredentialDashboard.css(6)
  AutonomousOps.css(5) DecisionsPanel.css(3) AutonomousAgentPanel.css(1)
  EngineeringConsole.css(2) RepositoryMapPanel.css(1) AIPairProgramming.css(1)
  ExternalPlatformDashboard.css(4) MissionControlV1.css(4) SmellsPanel.css(2)
  BundlePreviewPanel.css(1) PatchPreviewPanel.css(3) DOP2Dashboard.css(5)
  RuntimeDebugger.css(2) VisualArchitecture.css(1, found on residual re-scan)
  total: 47

4 files EXCLUDED (different semantic meaning, confirmed by inspection):
  FileExplorer.css   .file-explorer__fav-btn--on   (favorited/starred state)
  SymbolPanel.css    .sp-row--function .sp-row__icon (function-type icon color)
  CodeEditorPane.css .cep-breadcrumb__sym            (symbol-kind indicator)
  FuzzyFinder.css    .ff-item__kind                  (symbol-kind indicator)
```

### Residual check after the fix

```
grep -rn '#fbbf24' frontend/src (post-fix):
  SymbolPanel.css:83     .sp-row--function .sp-row__icon   <- correctly untouched
  FileExplorer.css:335   .file-explorer__fav-btn:hover     <- correctly untouched
  FileExplorer.css:336   .file-explorer__fav-btn--on       <- correctly untouched
  FuzzyFinder.css:88     (kind indicator)                  <- correctly untouched
  CodeEditorPane.css:668 .cep-breadcrumb__sym               <- correctly untouched
```

Exactly the 5 expected exclusions remain (4 files, one with 2 rules). No unexpected residue, no over-reach.

---

## 3 · C4-03 — before / after, both themes, real browser

```
distance from --success (#52d68a): 15.1  (0-441 scale)

BEFORE: .btn-success { color: #4ade80; }   — hardcoded, does NOT adapt to theme
.btn-danger sibling (8 lines above, unchanged): color: var(--danger);  — already correct
```

```
AFTER — computed style, live, authenticated session, modal dismissed:

[dark]  btnSuccessColor: rgb(82, 214, 138)   successToken: #52d68a   MATCH
[dark]  axe wcag2a/aa + wcag21a/aa violations: 0

[light] btnSuccessColor: rgb(28, 118, 67)    successToken: #1c7643   MATCH
[light] axe wcag2a/aa + wcag21a/aa violations: 0
```

The light-mode value (`#1c7643`) is the **B19.2.2-recalibrated** token — the hardcoded literal would have rendered `#4ade80` (a dark-mode-calibrated green) on a white background in light mode, which the token system exists specifically to prevent.

---

## 4 · Success-cluster distance table (why the other 3 greens were NOT touched)

```
color      distance from --success (#52d68a)   verdict
#4ade80    15.1    near-identical  -> FIXED (C4-03)
#22c55e    67.3    distinct        -> LEFT (B19.2.2 comment: explicitly assessed, intentional)
#00dc82    82.6    distinct        -> LEFT (consistent "AI live" brand green, 8+ files)
#059669    105.4   distinct        -> LEFT (deliberate border-only shade, paired with
                                            var(--success) text/bg in 15+ files)
```

## 5 · Danger-cluster distance table (why nothing was touched)

```
color      distance from --danger (#f55b5b)    verdict
#ef4444    33.1    borderline, no sibling-token signature found -> LEFT (Classification F)
#f87171    31.3    borderline, no sibling-token signature found -> LEFT (Classification F)
#dc2626    79.0    distinct                                     -> LEFT
#fca5a5    104.9   distinct (pale tint variant)                 -> LEFT
#7f1d1d    147.0   distinct (dark background variant)            -> LEFT
```

**Only the amber and one green cluster crossed the evidence bar for a confident, minimal fix.** The danger cluster and the remaining warning-adjacent colors did not, and were correctly left alone.

---

## 6 · C.1 fix integrity — re-verified, not re-audited

```
grep 'background: var(--surface-float)' CustomerFirstRunWizard.css CommandCenter.css : 1, 1
grep 'surface-elevated|surface-2, #' (excluding comments)                              : 0, 0

--surface-float declared in:
  :root (dark)                          : line 16
  :root[data-theme="light"]             : line 235
  @media (prefers-color-scheme:light)   : line 342
  forced-colors (both dark and light)   : lines 930, 1006, 1018
```

6 definitions = exactly 5 legitimate theme/accessibility contexts (one needed 2 lines). **Not duplication.**

---

## 7 · Regression gates

| Gate | Result | Counted as |
|---|---|---|
| `npm run test:runtime` | **144/144** · 50 suites · 0 fail · 0 skipped | **PASS** |
| `99-c1-accessibility-recovery` | 10/10 | **PASS — C.1 intact** |
| `100-c2-ux-error-truthfulness` | 10/10 | **PASS — C.2 intact** |
| `101-c3-performance-guards` | 11/11 | **PASS — C.3 intact** |
| `90-phase-c1-search-alias-coverage` | 8/8 | **PASS** |
| `91-api-404-boundary` | 5/5 | **PASS** |
| `96-production-build-artifact-integrity` | 4/4 | **PASS** |
| **`102-c4-design-system-guards`** *(new)* | **7/7** | **PASS** |
| Production build | Compiled successfully | **PASS** |
| `REACT_APP_API_URL` at build | unset | **PASS — no poisoned artifact** |
| `19-logging-consistency` | fails | **PRE-EXISTING FAIL** — untouched |

---

## 8 · Negative tests

```
remove .tw-toast rule
  -> FAILED: WorkspaceSettings.css must define .tw-toast ...

reintroduce #fbbf24 in a confirmed-warning file
  -> FAILED: ... must not contain the hardcoded warning amber #fbbf24

revert .btn-success to #4ade80
  -> FAILED: .btn-success must use var(--success), matching .btn-danger's own convention ...

restored -> 7 passed, 0 failed
```

---

## 9 · Constraint compliance

| Constraint | Status |
|---|---|
| `.env` not modified | **HELD** — 0 entries in `git status` |
| No test weakened | **HELD** — no existing test modified; one added |
| No second design system created | **HELD** — every fix extends `index.css`/`tokens.js` |
| No arbitrary token flattening | **HELD** — 83 radii, 35 font sizes, 6 color clusters left untouched |
| No mass normalization | **HELD** — 47 replacements were individually classified, not blind find-and-replace |
| C.1 remains intact | **HELD** — suite 99, 10/10 |
| C.2 remains intact | **HELD** — suite 100, 10/10 |
| C.3 remains intact | **HELD** — suite 101, 11/11 |
| No product architecture changed | **HELD** — CSS color/rule fixes only |
| No fabricated visual claim | **HELD** — every claim backed by computed styles or axe, in a real browser |
| No merge, no push | **HELD** |
