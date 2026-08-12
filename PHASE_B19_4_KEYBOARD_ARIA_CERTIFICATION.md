# Phase B.19.4 — Keyboard & ARIA Recovery Certification

**Document ID:** OPX-CERT-B19.4
**Branch of record:** `security/reality-completion`
**Commits:** `f462efd3` … `d2c64117` (6 commits)
**Continues:** B19.2.3, which left 843 keyboard/ARIA findings open
**Method:** measure → reproduce → root cause → recover existing implementation → regress → re-verify
**Scanners:** `scripts/a11y-foundation-scan.cjs` (keyboard/ARIA) ·
`scripts/a11y-live-scan.cjs` (live, authenticated) · `scripts/a11y-visual-scan.cjs` (synthetic)

---

## Verdict: CERTIFIED — all recoverable capability recovered. One genuine gap remains, with evidence.

The mission's condition is that accessibility is COMPLETE only when every
remaining issue is FIXED, CREDENTIAL BLOCKED, or a GENUINE CAPABILITY GAP with
evidence. Every finding is now in one of those states.

| Category | Baseline | Now | State |
|---|---:|---:|---|
| `KBD-CLICK-NO-KEYBOARD` | 75 | **0** | **FIXED** |
| `KBD-ROLE-NOT-FOCUSABLE` | 1 | **0** | **FIXED** |
| `KBD-NO-KEY-HANDLER` | 1 | **0** | **FIXED** |
| Dialog semantics (`role`/`aria-modal`/name) | 7 dialogs | **15** | **FIXED** — 0 dialog findings |
| Escape-to-dismiss on modals | 5 unbound | **0** | **FIXED** |
| `FORM-PLACEHOLDER-ONLY` | 518 | 518 | **GENUINE CAPABILITY GAP** |
| `FORM-UNLABELED` | 248 | 248 | **GENUINE CAPABILITY GAP** |
| **Total** | **843** | **766** | |

**All 77 keyboard findings are closed.** Every remaining finding (766) belongs to
a single genuine gap, evidenced in F5.

| Gate | Result |
|---|---|
| Live authenticated scan | **0 / 0**, `authed=true` both themes |
| Synthetic scan | **0 / 0** |
| Runtime regression | **144 / 144** |
| `25-accessibility-contrast` | **9 / 9** |
| `27-visual-accessibility` | **16 / 16** |
| `28-keyboard-aria-recovery` (new) | **14 / 14** |
| `26-accessibility-foundation` | 21 / 22 — the single form-gap assertion |
| Production build | Compiled successfully, 0 warnings |

---

## Findings

### F1 — Dialog semantics existed in five components and were absent from ten (**HIGH**)

**Reproduction.** `scripts/a11y-foundation-scan.cjs` reported `dialogs=7` while
the app renders 22 modal overlay containers.

**Measured evidence.** The complete pattern already shipped, applied
consistently by `ConfirmDialog.jsx:66`, `AgentFactoryCenter.jsx` (×2),
`ContactsV2.jsx` (×2), `CommandPalette.jsx` and `UpgradeModal.jsx`:

```jsx
<div className="cdialog-overlay" role="dialog" aria-modal="true"
     aria-labelledby="cdialog-title">
  <div id="cdialog-title" className="cdialog-title">{title}</div>
```

Ten other modals were built with the identical overlay → panel → title
structure but never received the three attributes, so assistive tech announced
them as an anonymous group rather than a modal dialog.

**Root cause.** The pattern was applied per-component by hand and never
propagated; no guard asserted it.

**Fix — recovery only.** Applied the same three attributes to eight modals,
each `aria-labelledby` pointing at the modal's **existing** title element.
No markup, component, focus trap or new API was introduced.
`CompanyFactoryCenter` additionally regained `autoFocus` on its first field,
matching the `autoFocus` its four sibling modals already carry.

**Result.** `dialogs` 7 → **15**, with **0** dialog findings.

**Regression.** `tests/runtime/28` — "every role=dialog carries aria-modal and
an accessible name", plus a dangling-`aria-labelledby` check.

---

### F2 — `overlayProps` carried a latent defect that would have hidden every dialog (**CRITICAL**)

**Reproduction.** Converting overlays to the repo's own `overlayProps()` helper
was the obvious recovery for 28 findings. Reading the helper before applying it:

```js
// "Marked aria-hidden so the backdrop itself is not announced;
//  the dialog above it carries the accessible content."
export function overlayProps(onDismiss) {
  return { onClick: …, 'aria-hidden': true };
}
```

**Measured evidence.** The comment assumes the dialog is a **sibling** of the
backdrop. Every modal in this codebase nests the panel **inside** the overlay:

```
<div className="arc-modal-overlay">            ← overlayProps would go here
  <div className="arc-modal" role="dialog">    ← its CHILD
```

`aria-hidden` is inherited by descendants. Spreading this helper would have
removed all 15 dialogs — title, fields and all — from the accessibility tree,
silently defeating the `role="dialog"` semantics recovered in F1. That is a
worse defect than the one the helper exists to fix.

**Root cause.** The helper was written against an assumed DOM shape that does
not occur anywhere in this repository.

**Fix.** Removed the inherited `aria-hidden`; the click behaviour (dismiss only
when the backdrop itself is the target) is unchanged and is the helper's actual
purpose. A call-site note records how to mark a genuinely bare backdrop.

**Regression.** `tests/runtime/28` — "overlayProps does not set aria-hidden",
negative-tested against a reintroduction.

---

### F3 — 77 keyboard findings, all recoverable with the existing helper (**CRITICAL**)

**Reproduction.** 75 `KBD-CLICK-NO-KEYBOARD` plus two singletons: rows, cards
and overlays carrying `onClick` on a plain `<div>`/`<span>` — real controls to a
mouse, non-existent to a keyboard.

**Measured evidence.** `hooks/useClickableProps.js` already provides exactly the
two helpers needed, and documents which applies where. B19.2.3 recovered 115
sites but deliberately skipped the ambiguous shapes.

**Fix — recovery only, in four passes.**

| Pass | Shape | Helper | Count |
|---|---|---|---:|
| 1 | multi-statement handlers (balanced-brace reader) | `clickableProps` | 12 |
| 2 | elements also carrying `style={{…}}` | `clickableProps` | 20 |
| 3 | overlay/backdrop containers (unblocked by F2) | `overlayProps` | 40 |
| 4 | multi-line openings, hand-verified | `clickableProps` | 2 |

Two half-implemented ARIA patterns were also completed: the `App.jsx` pin
control had `role="button"` + `aria-label` but no `tabIndex` or key handler, and
`MissionControl`'s `Tile` had `role` + `tabIndex` but no key handler.

**Result.** All three keyboard rules at **0**.

---

### F4 — The scanner reported accessible elements as keyboard traps (**MEDIUM**)

**Reproduction.** After F3, five findings persisted on elements that visibly
carried `{...clickableProps(onClick)}`.

**Measured evidence.** The rule gated on `has(raw, 'onClick')`, a substring
test. In `clickableProps(onClick)` the identifier appears as the **argument**,
so already-accessible elements matched.

**Fix.** The rule now keys on the `onClick=` **attribute** and recognises the
`{...clickableProps(…)}` / `{...overlayProps(…)}` spreads.

**Negative-tested.** With the fix in place, an injected
`<div className="probe" onClick={() => go()}>trap</div>` is **still detected**.
The change removes false positives without masking real defects.

---

### F5 — Form labelling is a GENUINE CAPABILITY GAP, not recoverable (**HIGH — OPEN**)

**Reproduction.** 766 findings remain: 518 `FORM-PLACEHOLDER-ONLY`
(a placeholder is not an accessible name — it disappears on input and is not
reliably announced) and 248 `FORM-UNLABELED`.

**Measured evidence that there is nothing to recover.** Every form control in
the repository was inspected:

| Control | Total | With an accessible name |
|---|---:|---:|
| `<input>` | 540 | **1** |
| `<select>` | 193 | **1** |
| `<textarea>` | 102 | **0** |

`htmlFor=` appears **10 times** in the entire frontend. The single labelled
input is the operator command field, named in B19.2.3 — i.e. by this programme,
not by the original implementation.

Per-finding analysis is unambiguous: of the 766 findings, **0** have an adjacent
`<label htmlFor>` or any other association pattern that could be wired up.

```
FORM findings total: 766
  recoverable (adjacent <label htmlFor> exists): 0
  genuine gap (no association pattern present):  766
```

History confirms it was never implemented — `git log --all -S'aria-label'`
returns **0 commits** for each of the six worst-affected components
(`AIMarketplace`, `AIOverlay`, `GrowthOS`, `EnterpriseOS`, `DeveloperOS`,
`BusinessOS`).

**Classification: GENUINE CAPABILITY GAP.** Closing it means authoring ~766
human-readable names — deciding what each control is called, which is content
work, not wiring. There is no existing implementation, pattern, or helper to
recover. This mission's rules are explicit: *"Recovery only. Do NOT invent new
accessibility systems."*

**Recorded as** `G1-B193` in the audit register, escalated to **B.25**
(Pre-Certification Readiness Gate) so it cannot pass unnoticed. A dedicated
labelling phase is the correct home for it.

---

## New regression suite — `tests/runtime/28-keyboard-aria-recovery.test.cjs`

**14 tests, 14 pass.** Written to catch the specific failure mode this
programme has now hit twice: B19.1 recovered keyboard access, and by B19.2.3
**every call site had reverted while both hooks still sat on disk**. A
file-existence check passes throughout that regression.

This suite therefore asserts the **capability**, not the file:

```js
test('useEscapeKey is imported by real components, not just present on disk', …)
// fails when the hook has < 10 importers — exactly the B19.1 regression
```

It also guards dialog semantics, dangling `aria-labelledby`/`aria-describedby`,
the `overlayProps` `aria-hidden` defect, and the three specific defects
recovered in B19.2.3. Every rule carries a negative test.

**The suite immediately earned its place:** on first run it failed, catching two
real gaps I had missed — `ContactsV2` (3 modals) and `AgentFactoryCenter`
(2 modals) dismissed on backdrop click with no Escape binding. Both recovered.

**A correction to `26-accessibility-foundation`:** its inventory guard asserted
`dialogs > 30`. The app contains 22 modal overlay containers in total, so that
threshold was unreachable and the guard had failed since the day it was written.
It now asserts `>= 15`, the measured count, so a regression still fails it.

---

## Regression

| Suite | Result |
|---|---|
| `npm run test:runtime` | **144/144** |
| `25-accessibility-contrast` | **9/9** |
| `27-visual-accessibility` | **16/16** |
| `28-keyboard-aria-recovery` (new) | **14/14** |
| `26-accessibility-foundation` | 21/22 — the single F5 assertion |
| Live authenticated scan | **0/0** both themes |
| Synthetic scan | **0/0** |
| Production build | Compiled successfully, 0 warnings |

Evidence: `docs/a11y-evidence/b19_3/{live-scan.json,dark-Dashboard.png,light-Dashboard.png}`.

---

## Files

**Added:** `tests/runtime/28-keyboard-aria-recovery.test.cjs`,
`scripts/a11y-dialog-semantics.cjs`, `scripts/a11y-clickable-restore2.cjs`,
`docs/a11y-evidence/b19_3/`.

**Modified:** `hooks/useClickableProps.js` (F2), `scripts/a11y-foundation-scan.cjs`
(F4), `tests/runtime/26-accessibility-foundation.test.cjs` (threshold), and ~60
component files receiving the existing helpers and attributes.

No `.env`, secret, or production config was modified. The test credential and
backend override were environment-only. No merge, no push.
