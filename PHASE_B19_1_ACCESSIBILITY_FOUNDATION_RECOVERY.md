# Phase B19.1 — Accessibility Foundation Recovery Certification

**Scope:** `frontend/src` — 258 components, 109,499 lines
**Method:** static JSX analysis, every finding reproduced at source before fixing
**Scanner:** `scripts/a11y-foundation-scan.cjs`
**Regression suite:** `tests/runtime/26-accessibility-foundation.test.cjs`

---

## Executive Scorecard

| Gate | Required | Result | Status |
|---|---|---|---|
| Controls named | 100% | 100% | PASS |
| Forms labeled | 100% | 100% | PASS |
| Dialogs accessible | 100% | 42/42 | PASS |
| Keyboard reachable | 100% | 100% | PASS |
| Placeholder-only fields | 0 | 0 | PASS |
| Unnamed interactive elements | 0 | 0 | PASS |
| Missing focus | 0 | 0 | PASS |
| Regression suite | passing | 22/22 | PASS |
| Existing runtime regression | no breakage | 144/144 | PASS |
| Production build | clean | clean, 0 warnings | PASS |

**Findings: 942 → 0. Foundation Accessibility: 10/10.**

---

## Foundation Inventory Matrix

| Element | Count | Baseline defects | Final |
|---|---:|---:|---:|
| Buttons | 2,075 | 1 | 0 |
| Inputs | 532 | 429 | 0 |
| Selects | 193 | 205 | 0 |
| Textareas | 99 | 132 | 0 |
| Dialogs | 42 (was 7) | 0 tracked | 0 |
| Forms | 17 | — | 0 |
| Tables | 40 | 0 | 0 |
| Navigation | 15 | 0 | 0 |
| Links | 34 | 0 | 0 |
| Images | 3 | 0 | 0 |
| Labels | 199 | — | — |
| Files scanned | 258 | 137 affected | 0 |

---

## Recovery Matrix

| Rule | Baseline | Final | Recovery method |
|---|---:|---:|---|
| `FORM-PLACEHOLDER-ONLY` | 518 | 0 | Real `<label>` association, or name derived from field-name placeholder copy |
| `FORM-UNLABELED` | 248 | 0 | `htmlFor`/`id` pairing, `aria-labelledby`, or name from bound state |
| `KBD-CLICK-NO-KEYBOARD` | 165 | 0 | `role="button"` + `tabIndex={0}` + Enter/Space handler |
| `FORM-NO-AUTOCOMPLETE` | 5 (→14 exposed) | 0 | `autoComplete` tokens on identity fields |
| `KBD-ROLE-NOT-FOCUSABLE` | 2 | 0 | Roving tabindex (tablist), focusable pin control |
| `CTRL-UNNAMED-BUTTON` | 1 | 0 | Named the shared `Toggle` switch |
| `CTRL-UNNAMED-WIDGET` | 1 | 0 | `aria-labelledby` on `role="switch"` |
| `ARIA-DANGLING-REF` | 1 | 0 | Added the missing `id="cmd-risk-hint"` target |
| `KBD-NO-KEY-HANDLER` | 1 | 0 | Keyboard handler on `MissionControl` tile |
| **Total** | **942** | **0** | |

### Naming discipline

Names were **derived from intent already in the code**, never invented:

1. An adjacent visible `<label>` → associated via `htmlFor`/`id` (also restores click-to-focus)
2. A label-ish `<span>`/`<div>` → `aria-labelledby`
3. Placeholder copy that reads as a field name → `aria-label`
4. The bound state field (`form.currency` → "Currency") → `aria-label`
5. Select option semantics ("All statuses" → "Status filter")

**Explicitly rejected as name sources:** placeholder copy that is a sample
*value* (`"e.g. Priya Sharma"`, `"5000"`, `"#4ecdc4"`, `"2026-12-31T23:59:59Z"`).
Naming a field after its example value is worse than leaving it unnamed, so
those fell through to a stricter pass or manual fix. This guard caught 3 raw
values that an earlier codemod pass would have shipped.

---

## Dialog Matrix

| Property | Before | After |
|---|---:|---:|
| Elements with `role="dialog"` | 7 | 42 |
| With `aria-modal` | 7 | 42 |
| With an accessible name | 7 | 42 |
| Dismissible by Escape | 10 files | 26 files |

36 modals were rendered as bare `<div>` overlays. Each inner surface received
`role="dialog"`, `aria-modal="true"`, and a name taken from the modal's own
existing title element.

**Backdrops were deliberately *not* marked `aria-hidden`.** The dialog is a
child of the backdrop, so hiding it would have hidden every modal's content
from screen readers. This was caught and reverted before it shipped.

**16 modals were keyboard-traps** — dismissible only by clicking the backdrop.
`useEscapeKey` now binds Escape to the same dismiss handler the backdrop calls.

---

## Keyboard Matrix

| Workflow | Before | After |
|---|---|---|
| Clickable rows/cards | mouse only | Enter/Space, focusable |
| Editor tabs | unreachable | roving tabindex + Arrow/Home/End |
| Modal dismissal | backdrop click only | Escape + backdrop |
| Toggle switches | unnamed | named, `type="button"` |
| OTP entry | unnamed digits | "OTP digit N of M" |
| Tab pin/unpin | unfocusable | focusable + Enter/Space |

Nested controls are protected: the injected handler only fires when
`e.target === e.currentTarget`, so Enter on a nested button never double-fires.

---

## Regression Matrix — negative-tested

Every fix class was **reverted in a scratch copy and the suite re-run**. All
10 turn the suite red, so no fix can be silently reverted:

| Defect class reverted | Suite result |
|---|---|
| Placeholder-only name | RED — caught |
| Binding-derived name | RED — caught |
| Keyboard access | RED — caught |
| Dialog role + name | RED — caught |
| Switch name | RED — caught |
| Tablist roving tabindex | RED — caught |
| Escape binding | RED — caught |
| Label association | RED — caught |
| `aria-describedby` target | RED — caught |
| OTP digit names | RED — caught |

The dialog-revert case initially passed **GREEN** (a silent revert). The
scanner had an over-permissive rule excusing any overlay in a file that bound
Escape anywhere. It was tightened to require the overlay to actually wrap a
dialog; the revert is now caught.

The suite also includes **positive controls** — correct markup that must *not*
be flagged — so a scanner that flagged everything could not pass.

---

## Verification

```
node scripts/a11y-foundation-scan.cjs frontend/src   → 0 findings
node --test tests/runtime/26-accessibility-foundation.test.cjs → 22/22
npm run test:runtime                                  → 144/144
node --test tests/runtime/25-accessibility-contrast.test.cjs → 9/9
cd frontend && npm run build                          → clean, 0 warnings
```

All 136 modified files were Babel-parsed after every codemod; 0 parse failures.
A duplicate-attribute sweep runs in the suite (5 duplicate `autoComplete`
attributes were introduced by a codemod and removed before commit).

---

## Files Added

- `frontend/src/hooks/useEscapeKey.js` — Escape-to-dismiss for modals
- `frontend/src/hooks/useClickableProps.js` — keyboard props for clickable elements
- `scripts/a11y-foundation-scan.cjs` — the foundation scanner
- `tests/runtime/26-accessibility-foundation.test.cjs` — regression suite

**137 component files modified.** No redesign, no architecture changes, no
visual changes — `[role="button"]:focus-visible` styling already shipped in
`polish.css`, so focus became visible without new CSS.

---

## Known Limitations

- Analysis is **static**. It proves markup contracts (names, roles, focusability,
  Escape bindings), not rendered behaviour. Focus-trap cycling and screen-reader
  announcement order are not verified here and warrant a runtime/AT pass.
- Contrast is covered by the separate existing suite (`25-accessibility-contrast`),
  not this one.
- Names derived from state bindings read as field names ("Currency", "Stage");
  where product copy would read better, they are safe to refine by hand.
