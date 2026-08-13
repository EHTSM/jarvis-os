# A.11 — Regression Report

**Date of record:** 2026-08-13
**Branch:** `security/reality-completion` · **Commit:** `d779ff84`
**No merge. No push.**

---

## 1. Runtime regression

```
npm run test:runtime
ℹ tests 144
ℹ pass  144
ℹ fail  0
```

---

## 2. Accessibility suites (re-run, not assumed)

The mission permits using certified results as evidence, but these were
**re-executed** because A.11 touched component CSS and JSX.

| Suite | Result | Note |
|---|---|---|
| `25-accessibility-contrast` | **9 / 9** | |
| `26-accessibility-foundation` | **21 / 22** | The single failure is the B19.4 form-labelling capability gap (`G1-B193`), documented and unchanged |
| `27-visual-accessibility` | **16 / 16** | |
| `28-keyboard-aria-recovery` | **14 / 14** | B19.4 suite; unaffected by A.11 |
| `29-a11-ux-consistency` | **7 / 7** | **new in A.11** |

---

## 3. Accessibility scanners (A.11 must not regress B19.2.3 / B19.4)

| Scanner | Result |
|---|---|
| `scripts/a11y-visual-scan.cjs` (synthetic) | **0 dark / 0 light** |
| `scripts/a11y-live-scan.cjs` (live, authenticated) | **0 / 0**, `authed=true` both themes |

FIX-3 moved a hardcoded canvas to `var(--bg)`; both scanners re-run clean, so
the change did not disturb the certified contrast position.

---

## 4. Live re-verification

Same instrument, same authenticated session, before and after:

```
BEFORE   page errors: 2
  [boot]                Not a member of this workspace          ← ENV (F7)
  [End of Day Review]   (o.lessons || o || []).slice is not a function

AFTER    page errors: 1
  [boot]                Not a member of this workspace          ← ENV (F7)
```

**F1 confirmed eliminated in the live app.** The remaining error is the audit
account's workspace membership (F7), not a product defect.

---

## 5. Production build

```
Compiled successfully.
```
Zero warnings.

---

## 6. Variant sweep

| Variant | Result |
|---|---|
| Dark theme | live scan 0 failures, `authed=true` |
| Light theme | live scan 0 failures, `authed=true` |
| Authenticated operator session | 25 surfaces reached and measured |
| Unauthenticated | scanner **hard-fails** the run rather than reporting a false pass (validity gate from B19.2.2) |

---

## 7. Test integrity

No test was weakened, skipped, or relaxed to obtain a pass.

One test file was **added**: `tests/runtime/29-a11-ux-consistency.test.cjs`
(7 assertions, each tied to a finding, with the F1 pattern negative-tested).

`tests/security/89-cross-product-ux-consistency-sweep.cjs` remains failing. Its
expectations are satisfied by current source (F6: 15/15 alias sets verified
covered), so the failure is a stale expectation. **It was deliberately left
untouched** — editing a test to make it green is exactly the weakening Part 16
prohibits. Recorded as a finding instead.
