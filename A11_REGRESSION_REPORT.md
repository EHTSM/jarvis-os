# A.11 / A.11.1 — Regression Report

**Date of record:** 2026-08-13
**Branch:** `security/reality-completion`
**Commits:** `d779ff84` (A.11) · `5daf87dd`, `8b7ce145`, `c7e0896c`, `665ecb77` (A.11.1)
**No merge. No push. `.env` unmodified.**

---

## 1. Runtime regression

```
npm run test:runtime
ℹ tests 144
ℹ pass  144
ℹ fail  0
```

---

## 2. Accessibility suites — B19 boundary check

Re-executed because A.11.1 touched component CSS and JSX. **The B19 status is
reported unchanged, not re-certified.**

| Suite | Result | Note |
|---|---|---|
| `25-accessibility-contrast` | **9 / 9** | unchanged |
| `26-accessibility-foundation` | **21 / 22** | the 1 failure is the B19.4 form-labelling gap `G1-B193` — **unchanged, still open, not converted to a pass** |
| `27-visual-accessibility` | **16 / 16** | unchanged |
| `28-keyboard-aria-recovery` | **14 / 14** | unchanged; also guards the drawer Escape recovered in D2 |
| `29-a11-ux-consistency` | **9 / 9** | +2 assertions added in A.11.1 |

**No WCAG completion is claimed.** Form labelling remains a genuine capability
gap per B19.4.

---

## 3. New regression coverage added in A.11.1

`tests/runtime/29-a11-ux-consistency.test.cjs` — 7 → **9** assertions:

| Assertion | Guards |
|---|---|
| every More-menu alias word is also a ⌘K keyword | the two-registry contract restored in this phase |
| NEGATIVE: alias→keyword drift is detectable | that the guard cannot rot into a tautology |

Existing 7 assertions retained unchanged.

---

## 4. Build

```
Compiled successfully.
```
Zero warnings, at every commit in this phase.

---

## 5. Live re-verification

| Fix | Instrument | Before | After |
|---|---|---|---|
| Registry crash | `a111-probe-surface.cjs` | DOM 160, ErrorBoundary hit, no headings | **DOM 967, heading "Agent Registry", boundary not hit** |
| Mobile overflow | `a111-surface-walk.cjs` @430 | 11/11 surfaces overflow, 191px | **1/9 surfaces, 35px** |
| Mobile overflow | `a111-surface-walk.cjs` @390 | 11/11 surfaces overflow, 231px | **9/9 at 18px** (Dashboard 75px, OPEN) |
| ⌘K keyword drift | contract re-check | 68 destinations drifted | **0** |
| EndOfDayReview crash (A.11) | `a11-trace-page-errors.cjs` | 2 page errors | **1** (the remaining one is the credential 403) |

---

## 6. Test integrity

**No test was weakened, skipped, or relaxed.**

### `tests/security/89` — adjudicated, preserved, and now satisfied

A.11 recorded this suite as failing on a "stale expectation". **A.11.1
re-read the assertion and that judgement was wrong.**

The suite asserts a *two-registry contract*: every `MORE_TABS` alias word must
also appear as a `NAV_ACTIONS` keyword, so the same vocabulary works in the More
menu and in ⌘K. A.11 had only verified the first registry.

Measured: 82/82 destinations had a ⌘K entry, but **68 had alias words missing
from their ⌘K keywords** — searching "webhook", "zapier" or "onboarding" in the
palette returned nothing while the same word worked in the More menu.

**Verdict: the test was NOT stale. The source was wrong.** The source was fixed
(drift 68 → 0), the test was left **byte-unmodified**, and the contract is now
additionally guarded by suite 29.

This is recorded as a correction to A.11's own finding, not smoothed over.

---

## 7. Variant sweep

| Variant | Result |
|---|---|
| Dark theme | contrast scanners 0/0 |
| Light theme | contrast scanners 0/0 |
| Authenticated operator | 81 surfaces operated |
| Unauthenticated | walker **hard-fails** rather than reporting a false pass |
| 1440 / 1280 / 1024 / 768 | 0 surfaces with h-scroll |
| 430 / 390 | measured; R1 fixed, R2 open |
