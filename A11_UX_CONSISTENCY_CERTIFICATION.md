# Phase A.11 — UX Consistency Certification

**Document ID:** OPX-CERT-A11
**Branch of record:** `security/reality-completion` · **Commit:** `d779ff84`
**Method:** REPRODUCE → MEASURE → IDENTIFY INCONSISTENCY → RECOVER EXISTING PATTERN → FIX → REGRESSION → RE-VERIFY
**Instruments:** `scripts/a11-ux-consistency-scan.cjs` · `scripts/a11-trace-page-errors.cjs`
**Companion documents:** `A11_FINDINGS_REGISTER.md` · `A11_UX_CONSISTENCY_MATRIX.md` ·
`A11_FIX_REGISTER.md` · `A11_REGRESSION_REPORT.md` · `A11_FINAL_SCORECARD.md`

---

# Verdict: OPEN

**Not certified complete.** Three open REAL INCONSISTENCY findings and three
dimensions that this audit did not measure. The exact remaining items are listed
below and in the scorecard.

Certifying would require inflating six dimensions or claiming coverage the walk
did not achieve.

---

## Relationship to the earlier A.11

A phase already carries the identifier **A.11 — Cross-Product Consistency**
(register: EXECUTED / CERTIFIED, 16 findings, commits `a0ae368b` … `d9fd20e0`,
sub-phases A.11.1–A.11.8, 2026-08-08). That work is **commit-evidenced only** —
it produced no certification document, and none of the six deliverables this
mission requires existed.

This audit therefore **did not restart** it. It:

- re-measured the product against this mission's 16 parts and 47-surface scope,
- verified the prior phase's own claims where they were checkable (F6),
- and produced the six missing deliverables.

Prior A.11 findings are cited as evidence, never re-counted as new.

---

## What was actually operated

Real running frontend, real backend, **real authenticated operator session** —
not screenshots, not source inference.

```
surfaces measured: 25 | DOM 315 els | authed=true
buttons  1,143 measured — 41 distinct heights, top-5 cover 57 %
tabs       225 measured — 25 distinct heights, top-5 cover 87 %
inputs      31 measured — 17 distinct heights, top-5 cover 52 %
cards               — 10 distinct radii
```

The scanner **hard-fails** an unauthenticated run rather than reporting a false
pass — the validity gate added in B19.2.2. Every number above comes from a run
that passed it.

---

## Findings

Full detail in `A11_FINDINGS_REGISTER.md`.

| # | Finding | Class | State |
|---|---|---|---|
| **F1** | End of Day Review crashed on any non-array response body | BROKEN | **FIXED** |
| **F2** | Global Activity was the only surface with no page header | REAL INCONSISTENCY | **FIXED** |
| **F3′** | Global Activity canvas hardcoded, ignoring the theme | REAL INCONSISTENCY | **FIXED** |
| **F3** | 402/403 discarded at API call sites (149 empty catches) | REAL INCONSISTENCY | **OPEN** |
| **F4** | 71 button systems; 41 live heights; top-5 cover 57 % | REAL INCONSISTENCY | **OPEN** (measured) |
| **F5** | 277 bare empty states vs a canonical shared component | REAL INCONSISTENCY | **OPEN** (measured) |
| **F6** | Search alias recovery | — | **VERIFIED PRESENT** |
| **F7** | Boot-time 403 storm | ENV | **NOT A PRODUCT DEFECT** |

### The highest-value finding

**F1** is the one that mattered most, and it is the same defect class as the
prior phase's own headline finding (A.11.8: a gated 402 rendered as "0"):

```js
const lessons = (lessonsData.lessons || lessonsData || []).slice(0, 5);
```

`a || b || []` is a **truthiness** guard, not a **type** guard. When `/lessons`
returned `{"error":"Unauthorized"}` — measured live — the expression fell
through to the response object itself and `.slice()` threw, crashing the whole
End of Day Review. The fetch's `.catch()` never fired, because the request
succeeded; only its body was an error.

Recovered with `Array.isArray()`, the guard already used **102×** in this
frontend. **Live re-verified: page errors 2 → 1.**

---

## Part 9 — search dependency, and a correction to my own reading

The mission instructed: verify the alias recovery if performed; do not silently
expand scope.

**Verified present.** All **76** overflow surfaces carry a search alias, and
**15/15** of the vocabulary sets asserted by `tests/security/89` are fully
covered.

**Correction.** My first measurement read `PRIMARY_TAB_ALIASES` (2 entries) and
concluded 15 alias sets were missing. That was wrong — aliases live on the
`MORE_TABS` entries. Recorded because the wrong number would have justified
scope expansion the mission forbids.

**Consequence.** Suite 89 still fails, but on an expectation the current source
satisfies — a stale test, not a product gap. **Left untouched**: editing a test
to make it green is the weakening Part 16 prohibits.

---

## What was deliberately NOT done

| Not done | Why |
|---|---|
| Consolidating 71 button systems | *"Do not create another button system. Do not redesign."* Measurement delivered instead. |
| Migrating 122 files to `EmptyState` | Each needs its own what/why/next copy — content work, not pattern recovery. |
| Fixing 149 empty catch blocks | Needs per-surface decisions on what the user sees per status; a partial pass leaves a mixed state. |
| Editing suite 89 to pass | Prohibited test weakening. |
| Re-opening B19.3/B19.4 keyboard & ARIA | Explicit audit boundary; used as evidence only. |
| Re-opening B19.2.3 colour/contrast | Explicit audit boundary; both scanners re-run to confirm no regression. |
| Tablet/mobile viewports | Belongs to the separate Mobile Experience Audit. |

---

## Regression

| Gate | Result |
|---|---|
| `npm run test:runtime` | **144 / 144** |
| `29-a11-ux-consistency` (new) | **7 / 7** |
| `25` / `27` / `28` | **9/9** · **16/16** · **14/14** |
| `26-accessibility-foundation` | **21 / 22** — the documented B19.4 form-label gap |
| Synthetic contrast scan | **0 / 0** |
| Live authenticated contrast scan | **0 / 0**, `authed=true` |
| Production build | Compiled successfully, 0 warnings |

No test weakened. One added.

---

## Coverage limitation, stated plainly

The mission scopes **47 surface areas**; the authenticated walk measured **25**.
Marketing, Creative Studio, Memory, Agents, Integrations and Launch Platform
were **not** among them and are scored **N/M — not measured**, never assumed
consistent. Drawers, tables and responsive behaviour are likewise N/M, with the
reason recorded for each.

That is the honest reason this document says OPEN rather than CERTIFIED
COMPLETE.

---

## Remaining work to reach CERTIFIED COMPLETE

1. **F3** — decide and apply per-surface handling for 402/403/5xx at the API
   call sites (the shared `_fetch` already carries the status and message).
2. **F4** — scope a button consolidation onto the existing `.btn` component as
   its own phase.
3. **F5** — migrate empty states to the canonical component, writing the
   what/why/next copy per surface.
4. **N/M-1..3** — extend the walk to open drawers, reach table-bearing
   surfaces, and add tablet/mobile viewports.
5. **DEP-1** — retire or re-baseline `tests/security/89`.

No `.env`, secret, or production config was modified. The test credential and
backend override were environment-only. **No merge. No push.**

**A.11 ends here. A.12 not started.**
