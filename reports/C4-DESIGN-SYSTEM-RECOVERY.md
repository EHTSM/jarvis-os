# C.4 — DESIGN SYSTEM RECOVERY

Date: 2026-08-14 · Branch: `security/reality-completion`

What changed, why it was minimal and correct, and how each was verified.
**Every fix: MEASURE → CLASSIFY (A–F) → FIX ONLY A/B → VERIFY LIVE → REGRESSION → NEGATIVE TEST.**

---

## Fix policy applied

Only Classification A and B findings were fixed, exactly as the mission specifies. Nothing else was touched.

| Classification | Count found | Action |
|---|---:|---|
| A — true duplicate | 0 | — |
| **B — true drift** | **3** | **all 3 fixed** |
| C — intentional variant | 6 clusters | left alone |
| D — migration gap | 2 | documented only |
| E — component-local | 19 items | confirmed correctly scoped, left alone |
| F — unknown | 4 color clusters | documented, not changed |

**No mass normalization was performed.** 83 radius values, 35 font sizes, and 6 of 9 investigated "near-duplicate" colors were deliberately left untouched because the evidence did not support treating them as accidental.

---

## Files changed — 6 source files, 1 test added

```
M frontend/src/components/WorkspaceSettings.css       C4-01 .tw-toast rule added
M frontend/src/components/DOP1Dashboard.css            C4-02 token + doc comment
M frontend/src/components/DOP2Dashboard.css             C4-02 token
M frontend/src/components/CredentialDashboard.css       C4-02 token
M frontend/src/components/AutonomousOps.css              C4-02 token
M frontend/src/components/DecisionsPanel.css              C4-02 token
M frontend/src/components/AutonomousAgentPanel.css        C4-02 token
M frontend/src/components/EngineeringConsole.css           C4-02 token
M frontend/src/components/RepositoryMapPanel.css             C4-02 token
M frontend/src/components/AIPairProgramming.css                C4-02 token
M frontend/src/components/ExternalPlatformDashboard.css          C4-02 token
M frontend/src/components/MissionControlV1.css                    C4-02 token
M frontend/src/components/SmellsPanel.css                          C4-02 token
M frontend/src/components/BundlePreviewPanel.css                    C4-02 token
M frontend/src/components/PatchPreviewPanel.css                      C4-02 token
M frontend/src/components/RuntimeDebugger.css                         C4-02 token
M frontend/src/components/ComposerPanel.css                            C4-02 token
M frontend/src/components/VisualArchitecture.css                        C4-02 token
M frontend/src/App.css                                                  C4-03 token
+ tests/security/102-c4-design-system-guards.cjs                       7 assertions, negative-tested
```

**No existing test modified.** `.env` untouched. No component logic touched — every change is a CSS color/rule fix.

---

## 1 · C4-01 — style `.tw-toast` where it is actually loaded

```diff
+ .tw-toast {
+   position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
+   background: var(--surface-high, var(--surface-base)); border: 1px solid var(--border);
+   border-radius: var(--radius-pill); padding: 10px 20px; font-size: 13px; font-weight: 700;
+   color: var(--text); box-shadow: 0 6px 24px rgba(0,0,0,0.40); z-index: 200; white-space: nowrap;
+   animation: fade-up var(--dur-enter) var(--ease-spring) both;
+ }
+ @media (prefers-reduced-motion: reduce) {
+   .tw-toast { animation: none; }
+ }
```

Placed in `WorkspaceSettings.css` — the file `WorkspaceSettingsK2.jsx` actually depends on, per the existing import chain (`WorkspaceSettings.jsx` imports the panels; `WorkspaceSettingsK2.jsx` has no CSS of its own). Uses `--surface-high` with a `--surface-base` fallback (the token already used by sibling `.l3-quota-block` rules in the same file), plus the exact visual values and reduced-motion guard `TeamWorkspace.css` already established. **No new pattern invented.**

### Verification

```
build: .tw-toast now appears in the SAME chunk (3297) that ships k2-tokens-panel
live:  navigating to Settings via the real UI (no prior Team Workspace visit)
       loads a stylesheet containing the .tw-toast rule
```

---

## 2 · C4-02 — replace the developer-tooling warning literal with the token

```diff
- color: #fbbf24;
+ color: var(--warning);
```

Applied across 17 files, 47 occurrences, **only where the rule's own name or context confirmed warning/medium-severity/degraded/pause semantics**. Verified per-file before the substitution, not applied blindly:

- checked every occurrence's surrounding class name (`warn`, `medium`, `degraded`, `pause`, `alert`, `risk`) before including a file
- found and included one file (`VisualArchitecture.css`) my initial list had missed, by re-scanning for residual matches after the first pass
- found and **excluded** 4 occurrences in 4 different files whose class names (`fav-btn--on`, `sp-row--function`, `cep-breadcrumb__sym`, `ff-item__kind`) revealed a different meaning entirely

### Verification

```
distance measurement : 16.3 from --warning (0-441 scale) — the decision evidence
live regression       : 0 axe violations, both themes, after the fix
excluded files        : confirmed UNCHANGED — still contain #fbbf24, correctly
```

---

## 3 · C4-03 — `.btn-success` follows `.btn-danger`'s own convention

```diff
  .btn-success {
    background: rgba(34,197,94,0.10);
-   color: #4ade80;
+   color: var(--success);
    border: 1px solid rgba(34,197,94,0.20);
  }
```

The sibling `.btn-danger`, defined 8 lines above in the same file, was **already correct** (`color: var(--danger)`). This is the clearest possible drift signature: the fix pattern already existed, adjacent, in the same file.

### Verification — computed styles, both themes, real browser

```
dark  : rgb(82, 214, 138)  = #52d68a   exact match to --success
light : rgb(28, 118, 67)   = #1c7643   exact match to the B19.2.2-recalibrated light --success
axe violations: 0, both themes
```

The hardcoded literal never adapted to light mode; the token now does — this is a genuine functional improvement, not merely a "cleaner" value.

---

## Regression — no test weakened

| Gate | Before C.4 | After C.4 |
|---|---|---|
| `npm run test:runtime` | 144/144 · 0 fail · 0 skipped | **144/144 · 0 fail · 0 skipped** |
| `99-c1-accessibility-recovery` | 10 pass | **10 pass — C.1 intact** |
| `100-c2-ux-error-truthfulness` | 10 pass | **10 pass — C.2 intact** |
| `101-c3-performance-guards` | 11 pass | **11 pass — C.3 intact** |
| `90-phase-c1-search-alias-coverage` | 8 pass | **8 pass** |
| `91-api-404-boundary` | 5 pass | **5 pass** |
| `96-production-build-artifact-integrity` | 4 pass | **4 pass** |
| `102-c4-design-system-guards` *(new)* | — | **7 pass** |
| Production build | PASS | **PASS** — no poisoned `REACT_APP_API_URL` |

**Required by the mission and confirmed: C.1, C.2, and C.3 all remain intact.**

---

## Negative tests — all three fixes provably fail when reverted

```
remove .tw-toast rule entirely
  -> FAILED: WorkspaceSettings.css must define .tw-toast — WorkspaceSettingsK2.jsx
             has no CSS of its own and relies entirely on this file being loaded first

reintroduce the hardcoded amber
  -> FAILED: frontend/src/components/DOP1Dashboard.css must not contain the
             hardcoded warning amber #fbbf24

revert .btn-success to its old literal
  -> FAILED: .btn-success must use var(--success), matching .btn-danger's own
             convention — it previously used a hardcoded #4ade80

restored -> 7 passed, 0 failed
```

One self-inflicted issue was caught and corrected during this process: the suite's first version flagged its own explanatory comment (which quotes the original `#fbbf24` for the record) as a violation. Fixed by stripping comments before asserting — the same pattern already established in suites 99/101.

---

## What was deliberately NOT done

| Not done | Why |
|---|---|
| Flatten 83 radius values / 35 font sizes | C.2's DS-1 — a documented migration gap, not re-litigated absent a regression |
| Change `#22c55e`/`#00dc82`/`#059669` | 67–105 distance from token; `#22c55e` explicitly assessed as intentional in a prior B19.2.2 comment; `#059669` is a deliberate, consistently-used border shade |
| Change `#ef4444`/`#f87171`/`#7f1d1d`/`#fca5a5` (danger cluster) | No "sibling already correct" signature found; insufficient evidence for a confident minimal fix |
| Change `#eab308`/`#f59e0b` (warning-adjacent) | Same — documented as Classification F, not swept |
| Force `EmptyState` adoption onto the 105 local instances | Different purpose (curated onboarding vs. contextual search-empty); would require inventing new variants for every filter combination |
| Declare a formal breakpoint or z-index scale | No measured cross-surface inconsistency; a product-wide decision, not a bug |
| Redesign any component | Out of scope by explicit mission instruction |
| Create a second design-system file or token layer | `index.css`/`tokens.js` remain the single source; every fix extends existing tokens |
