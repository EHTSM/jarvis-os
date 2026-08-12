# Phase B.19.3 — Accessibility Final Closure Certification

**Document ID:** OPX-CERT-B19.3
**Branch of record:** `security/reality-completion`
**Commits:** `3daca3de` … `5dee562f` (6 commits)
**Continues:** B19.2.2, which closed at 9/10 with three stated gaps
**Method:** measure → reproduce → root cause → recover → regress → re-verify
**Scanners:** `scripts/a11y-live-scan.cjs` (live, authenticated — the authority) ·
`scripts/a11y-visual-scan.cjs` (synthetic) · `scripts/a11y-foundation-scan.cjs` (keyboard/ARIA)

---

## Verdict: CERTIFIED — colour/contrast only. Keyboard/ARIA remains OPEN.

The mission's condition is *"Only certify COMPLETE when live scan, synthetic
scan and CI evidence all agree."* For contrast they now agree at zero. They do
**not** agree for keyboard/ARIA, so this certification is explicitly partial.

| Gate | Result | Status |
|---|---|---|
| Live authenticated scan (both themes) | **0 / 0**, 3,026 els, `authed=true` | **PASS** |
| Synthetic scanner (both themes) | **0 / 0** | **PASS** |
| Runtime regression | **144 / 144** | **PASS** |
| `25-accessibility-contrast` | **9 / 9** | **PASS** |
| `27-visual-accessibility` | **16 / 16** | **PASS** |
| `26-accessibility-foundation` | **20 / 22** | **FAIL — 2 open** |
| Production build | Compiled successfully, 0 warnings | **PASS** |

**Colour/contrast: CERTIFIED COMPLETE.** Every measurable contrast violation is
zero on both the live authenticated app and the synthetic scanner, and the
negative test proves the scanners still detect an injected defect.

**Keyboard/ARIA: NOT CERTIFIED.** 843 findings remain. They are pre-existing
gaps, not regressions — evidence in F4 — and closing them is new capability,
which this mission's rules exclude.

---

## Findings

### F1 — A B19.2.2 whitelist entry hid 21 real contrast defects (**HIGH**)

**Reproduction.** `node scripts/a11y-visual-scan.cjs` reported 53 findings, of
which 21 — the single largest cluster — were in `components/PublicLaunch.css`.
B19.2.2 had classified that file as a "fixed-dark marketing surface" and
excluded it from all five colour codemods.

**Measured evidence.** The exclusion was wrong:

```
components/ElectronWorkspace.jsx:1231
  <ErrorBoundary label="OP-1 Launch"><PublicLaunch /></ErrorBoundary>
```

`PublicLaunch` renders **inside the themed app shell as an ordinary tab**. It
paints no canvas of its own; it merely carried a private palette pinned to dark
literals (`--pl-muted: #666`, measured **2.79:1** on `--bg` in light mode).

**Root cause.** The `FIXED_DARK` exclusion list was populated by name similarity
("Launch" read as marketing) rather than by verifying where the component
mounts. The same stale list appeared in all five codemods.

**Fix.** Removed `PublicLaunch.css` from `FIXED_DARK` in all five codemods with
the evidence recorded inline, and aliased its private palette onto the canonical
tokens like every other. The two genuinely self-canvassing surfaces
(`LandingPage.css`, `ShortcutsOverlay.css`) were re-verified and retained.

**Regression.** `tests/runtime/27-visual-accessibility` — 16 tests, 0 fail.

---

### F2 — "Fixed-dark" was being used to excuse failing contrast (**HIGH**)

**Reproduction.** The two legitimately fixed-dark surfaces still carried
sub-AA text measured against **their own canvas**:

| Ratio | Element | Colour on backdrop |
|---:|---|---|
| 2.10:1 | `.lp-step-num` | `rgba(124,111,255,0.5)` on `#05070d` |
| 2.36:1 | `.shortcuts-group-label` | `rgba(255,255,255,0.28)` on `#05070d` |
| 3.74:1 | `.shortcuts-close` | `rgba(255,255,255,0.40)` on `#05070d` |

**Root cause.** A conflation. "Fixed-dark" justifies *not tokenising* a colour;
it does not justify *failing* contrast. B19.2.2's whitelist category said
"verified ≥4.5:1 against that fixed canvas" — that claim was not true.

**Fix.** Raised each alpha to the measured AA minimum on its own canvas
(white ≥0.52, accent ≥0.92). Hue unchanged.

**Regression.** Synthetic scanner, both themes — 0 findings.

---

### F3 — B19.1's keyboard recovery had silently regressed in full (**CRITICAL**)

**Reproduction.** `tests/runtime/26-accessibility-foundation` failed on two
guards it was written to protect:

```
components/AgentRegistryCenter.jsx lost its Escape binding
tabs must use roving tabindex
```

**Measured evidence.** Both B19.1 recovery hooks still existed on disk and were
imported by **zero** files:

```
grep -rl "useEscapeKey"      frontend/src --include=*.jsx   → (empty)
grep -rl "useClickableProps" frontend/src --include=*.jsx   → (empty)
```

The consequences, measured:

- **12 modals** could be dismissed only by clicking the backdrop — a mouse-only
  affordance that traps a keyboard user inside the dialog.
- **157 rows/cards** carrying `onClick` on a plain `<div>` had no focus stop and
  no Enter/Space activation: real controls to a mouse, non-existent to a keyboard.
- `CodeEditorPane`'s `role="tab"` nodes had no `tabIndex` and no key handler, so
  the editor tab bar was entirely unreachable by keyboard.
- The settings `Toggle` had `role="switch"` + `aria-checked` but **no accessible
  name**, and defaulted to `type="submit"` inside a form.
- The operator command input's `aria-describedby="cmd-risk-hint"` pointed at an
  element that did not exist, so its destructive-command warning was never
  announced.

**Root cause.** The hooks were never deleted, but every call site was lost —
most likely in a bulk revert. Because `tests/` is `.gitignore`d (recorded in
B19.2.2), the guards that would have caught this were not running in CI.

**Fix.** Rebound Escape on all 12 modals to the *same* handler each backdrop
`onClick` already calls; restored `clickableProps()` on 115 of the 157 clickable
elements; added roving tabindex + Arrow/Home/End to the tab bar; gave the Toggle
an `aria-labelledby` pointing at its existing visible label plus `type="button"`;
and created the missing `#cmd-risk-hint` element with `role="status"`.

The clickable codemod is deliberately conservative — it rewrites only the
unambiguous single-line `<div|span className onClick={expr}>` shape and **leaves
72 sites alone**, reporting them, because overlay backdrops need `overlayProps`
and Escape rather than a focus stop, and a wrong transform silently breaks a
control.

**Negative-tested:** two earlier placement passes were caught and corrected
before commit — one inserted a hook inside a `.map()` callback (a hook in a
loop), the other placed it before the `useState` it closed over (temporal dead
zone). Both were found by verifying declaration order, not by the build, which
compiled cleanly in both cases.

**Regression.** `26-accessibility-foundation` 16/22 → 20/22; keyboard/form
findings 931 → 843; runtime 144/144; live scan unchanged at 0/0.

---

### F4 — 843 keyboard/ARIA findings are pre-existing, not regressions (**MEDIUM**)

**Reproduction.** After F3, `scripts/a11y-foundation-scan.cjs` still reports:

```
518  FORM-PLACEHOLDER-ONLY
248  FORM-UNLABELED
 75  KBD-CLICK-NO-KEYBOARD   (the ambiguous shapes F3 deliberately skipped)
  2  KBD-ROLE-NOT-FOCUSABLE / KBD-NO-KEY-HANDLER
```

plus an inventory guard failing at `dialogs=7` — only 7 elements in the app
carry `role="dialog"`, against 14+ modal overlay containers.

**Measured evidence that these are not regressions.** Run against the phase-start
commit `080c1c4d` in a clean worktree: **931 findings, `dialogs=7`**. The
history shows the labels never existed:

```
git log --all -S'aria-label' -- components/{AIMarketplace,AIOverlay,GrowthOS,EnterpriseOS,DeveloperOS}.jsx
  → 0 commits, all five files
git log --all -S'role="dialog"' -- components/AgentRegistryCenter.jsx
  → 0 commits
```

**Classification.** These are genuine accessibility gaps that have never been
addressed in this repository's history. Closing them means adding accessible
names to ~766 form controls and dialog semantics (`role`, `aria-modal`, focus
trap, initial focus) to 14 modals — **new capability**. This mission's rules are
explicit: *"Do NOT redesign. Do NOT invent components. Recover only existing
capability."* They are therefore reported, not silently absorbed.

**Recommended next phase.** A dedicated keyboard/ARIA phase, scoped to form
labelling and dialog semantics, with the same measure→recover→regress method.

---

### F5 — Untokenised colour literals reduced 10.5% with no regression (**MEDIUM**)

**Reproduction.** `node scripts/a11y-exception-whitelist.cjs` reported 4,521
literals in the `NOT-YET-TOKENISED` category at phase start.

**Root cause.** A large family of Tailwind-palette values duplicating tokens
that already exist (`#f87171` ≈ `--danger`, `#94a3b8` ≈ `--text-dim`,
`#34d399` ≈ `--success`, …), each verified to be the same semantic role at
comparable contrast on `--bg` — so migrating them is a rename, not a colour
change.

**Fix.** 405 text literals migrated. That initially **split 14 pairs** — the
text themed while its panel stayed a Tailwind `-950` literal, producing
2.23–2.92:1 in light mode. Those panels were moved to the matching `-muted`
tokens in the same pass, restoring 0/0.

**Result.** 4,521 → **4,046** (10.5%). The remainder are dark-on-dark pairs that
currently agree; they are not certified safe, and the whitelist reports them
under `NOT-YET-TOKENISED` rather than a category implying closure.

**Regression.** Both scanners 0/0; live 0/0; runtime 144/144.

---

## Live authenticated verification — method and evidence

```
dark:  0 failures | tabs 8 | 3,026 els, 1,414 text nodes | authed=true
light: 0 failures | tabs 8 | 3,026 els, 1,414 text nodes | authed=true
TOTAL live contrast failures: 0
```

Evidence: `docs/a11y-evidence/b19_2_3/{dark,light}-Dashboard.png`, `live-scan.json`.

**A run was rejected mid-phase, correctly.** The validity gate added in B19.2.2
refused a light-theme sweep that never authenticated:

```
[light] INVALID RUN — authed=false, elementsSeen=264. Login did not reach the
app shell; this result must NOT be reported as a pass.
FAILED: light did not authenticate — rerun required.
```

Without that gate this phase would have recorded a false "0 failures" from a
scan of the login screen. Every zero in this document comes from a run that
passed the check.

## Synthetic scanner — 53 → 0, and why the last 3 were not defects

Three findings resisted every fix. Rather than suppress them, each was
classified with source evidence:

| Selector | Evidence | Classification |
|---|---|---|
| `.cv2-row-avatar` | `ContactsV2.jsx:480` — `style={{ background: color }}` | background assigned at runtime; the reconstructed DOM measures a backdrop the user never sees |
| `.eip-tl-dot` | `EngineeringIntelligencePane.jsx:483` — same pattern | same |
| `.op-exec-trust-dot` | zero JSX references anywhere in `frontend/src` | unused class; cannot reach a user |

The scanner now derives both sets from source (`runtimeStyledClasses()`), so
the exemption is regenerated each run and cannot go stale.

**Negative-tested.** With the filter active, an injected defect
(`.ac-detail-topbar { color: #0b0d12; background: #0c0f16 }`) is still detected
at **1.01:1 in both themes**. The filter excludes structural false positives, not
real defects.

---

## Regression

| Suite | Result |
|---|---|
| `npm run test:runtime` | **144/144** |
| `25-accessibility-contrast` | **9/9** |
| `27-visual-accessibility` | **16/16** |
| `26-accessibility-foundation` | 20/22 — 2 open, see F4 |
| Production build | Compiled successfully, 0 warnings |

---

## Files

**Added:** `scripts/a11y-escape-restore.cjs`, `scripts/a11y-clickable-restore.cjs`,
`docs/a11y-evidence/b19_2_3/`.

**Modified:** `scripts/a11y-visual-scan.cjs` (runtime-styled/unreferenced class
derivation), five colour codemods (`FIXED_DARK` correction), ~90 component
CSS/JSX files, `WorkspaceSettingsShared.jsx`, `CodeEditorPane.jsx`,
`operator/WorkflowPanel.jsx`, 12 modal components.

No `.env`, secret, or production config was modified. The test credential and
backend override were environment-only. No merge, no push.
