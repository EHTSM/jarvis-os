# A.11 — UX Consistency Findings Register

**Branch of record:** `security/reality-completion`
**Method:** REPRODUCE → MEASURE → IDENTIFY → RECOVER → FIX → REGRESSION → RE-VERIFY
**Instruments:** `scripts/a11-ux-consistency-scan.cjs` (live, authenticated, 25 surfaces,
1,143 buttons) · `scripts/a11-trace-page-errors.cjs` (per-surface error attribution)

Every finding below was reproduced against the **real running app with a real
authenticated operator session** — not inferred from source and not judged from
screenshots. Findings that could not be reproduced live are marked as such.

---

## Severity key

| Mark | Meaning |
|---|---|
| **BROKEN** | The surface fails or lies to the user |
| **REAL INCONSISTENCY** | A canonical pattern exists and this surface does not follow it |
| **MINOR DRIFT** | Within the design language; different but not conflicting |
| **ENV** | Caused by the audit environment, not the product |

---

## F1 — End of Day Review crashed on any non-array response — **BROKEN** — FIXED

**Reproduction.** Live walk of the authenticated app; the surface threw during
render:

```
[End of Day Review] (o.lessons || o || []).slice is not a function
```

**Measured evidence.** `GET /lessons` returns an error body when the caller is
not authorised:

```
$ curl -s http://127.0.0.1:5099/api/engineering/lessons
status: 401
{"error":"Unauthorized"}
```

`EndOfDayReview.jsx:21` read:

```js
const lessons = (lessonsData.lessons || lessonsData || []).slice(0, 5);
```

That object has no `.lessons`, so the expression fell through to
`lessonsData` — **the response object itself** — and `.slice()` threw, taking
the entire review down. The `.catch(() => ({ lessons: [] }))` on the fetch never
fired, because the request succeeded; only its *body* was an error.

**Root cause.** `a || b || []` is a truthiness guard, not a type guard. Any
non-array truthy body satisfies it. This is the same class as the A.11.8
"gated-402 rendered as 0" finding: an error body treated as data.

**Recovered pattern.** `Array.isArray()` — already used **102×** across the
frontend. No new utility.

**Fix.** `components/EndOfDayReview.jsx` — both `lessons` and the sibling
`missions` line, which carried the same latent flaw.

**Regression.** `tests/runtime/29` — asserts the guard and negative-tests that
the old pattern is still detectable.

**Re-verified live.** Page errors on the same walk: **2 → 1**.

---

## F2 — Global Activity was the only surface with no page header — **REAL INCONSISTENCY** — FIXED

**Reproduction.** Header-element count measured on each of 25 authenticated
surfaces. Every surface reported ≥1 except one:

```
surfaces with NO header element: Global Activity
```

The screen opened directly onto a filter toolbar, so it never named itself.

**Measured evidence.** Its direct sibling carries the canonical pattern:

```
SystemHealthDashboard.jsx:393   .shd-header → .shd-title + .shd-ts
GlobalActivityFeed.jsx          (none — .gaf-title is a per-EVENT title)
```

**Recovered pattern.** The `SystemHealthDashboard` header (title + context
line), expressed in this component's own `gaf-` namespace. No new component, no
new design system.

**Also fixed in the same file.** `.gaf-root` hardcoded `background: #08090e`,
ignoring the theme — the same token-bypass class B19.2.2/B19.2.3 removed
elsewhere. Now `var(--bg)`.

**Regression.** `tests/runtime/29` — header present and styled; canvas
tokenised; the hardcoded value cannot return.

---

## F3 — 402/403 responses are discarded at the API call site — **REAL INCONSISTENCY** — OPEN

**Reproduction.** 17 failed responses captured during the authenticated walk,
including a genuinely gated surface:

```
402  /metrics  {"error":"subscription_required",
                "message":"Your trial has expired. Up…"}
```

**Measured evidence.** The shared client is **correct** — `_client.js:215`
preserves the backend message and attaches the status:

```js
const msg = err.error || `HTTP ${res.status}`;
const e = new Error(msg); e.status = res.status; throw e;
```

The loss happens one layer up, at the call site:

```js
// telemetryApi.js:24
export async function getMetrics() {
  try { return await _fetch("/metrics"); }
  catch { return null; }          // ← status and message both discarded
}
```

The UI then cannot distinguish "gated" from "empty", which is precisely the
condition A.11.8 fixed for Marketplace.

**Why this is reported OPEN rather than fixed.** The pattern
`catch { return null; }` appears widely across the API modules, and **149 empty
catch blocks** were measured across the JSX layer. Correcting them requires
deciding, per surface, what the user should see for each status — that is a
scoped remediation, not a mechanical recovery, and doing it partially would
leave the product in a mixed state. Recorded with its exact reproduction so it
can be scoped deliberately.

**Not fabricated as fixed.** No change was made to this finding.

---

## F4 — Component-system proliferation — **REAL INCONSISTENCY** — OPEN (measured)

**Measured, statically and live.**

| Family | Distinct class systems | Live measurement |
|---|---:|---|
| Buttons | **71** namespaced `-btn` systems | 1,143 rendered; **41 distinct heights**; top-5 cover only **57 %** |
| Cards | 43 classes | **10 distinct radii** live |
| Modals | 12 systems | 3 distinct paddings |
| Toasts | **34** systems | — |
| Inputs | 35 classes | 31 rendered; **17 distinct heights**; top-5 cover **52 %** |
| Tabs | — | 225 rendered; 25 distinct heights; top-5 cover **87 %** |

Declared-value drift across the 59 button classes carrying explicit rules:
**21 distinct paddings, 8 distinct radii, 9 distinct font sizes**. Only 12 of 59
use `var(--radius-sm)`; the rest hardcode.

**Assessment against the mission's own bar.** The mission states the objective
is *"CONSISTENT DESIGN LANGUAGE, not monotonous UI"*, so distinct namespaces are
not themselves a defect. What the numbers show is stronger than namespacing:
**41 button heights with the dominant five covering only 57 %** is drift, not
variation.

**Why this is reported OPEN rather than fixed.** A canonical `.btn` component
exists (recovered in B19.2.2) but 71 systems predate it. Consolidating them is
a design-system migration touching every surface — explicitly outside this
mission's "do not redesign / do not create another button system" rule. The
measurement is delivered so the work can be scoped; no partial migration was
started.

---

## F5 — Empty states largely bypass the canonical component — **REAL INCONSISTENCY** — OPEN (measured)

**Measured.**

```
components/EmptyState.jsx exists — variant catalogue, and each variant answers
  what is this? / why care? / what next?   (the mission's three questions)

files importing EmptyState:        9
ad-hoc empty-state literals:     301   across 122 files
  of those: guided (name a next action):  61
            bare   (no next action):     277
```

**Assessment.** The canonical component is exactly what Part 8 requires, and it
is used by 9 files. The bar is *"every empty state must answer what/why/next"*,
and 277 measured literals answer only "what".

**Caveat recorded honestly.** Not all 277 are defects — several are *success*
states ("No issues found.") where emptiness is the good outcome and no next
action is appropriate. A precise defect count requires per-string judgement,
which was not performed, so **no fixed count is claimed**.

**Why OPEN.** Migrating 122 files to the shared component is a content and
design exercise (each needs its own copy), not a mechanical recovery.

---

## F6 — Search alias recovery — **VERIFIED PRESENT** — NO ACTION

Part 9 instructed: verify if already performed; do not silently expand scope.

**Verified.** All **76** `MORE_TABS` overflow surfaces carry a search `alias`.
Checked against the exact vocabulary list asserted by
`tests/security/89-cross-product-ux-consistency-sweep.cjs`:

```
fully covered: 15 / 15
```

**Correction to my own first reading.** I initially measured
`PRIMARY_TAB_ALIASES` (2 entries) and concluded 15 sets were missing. That was
wrong — aliases live on the `MORE_TABS` entries themselves. The corrected
measurement is above.

**Consequence for suite 89.** That suite still fails, but its expectation list
is satisfied by the current source; the failure is a **stale test expectation**,
not a product gap. Recorded, not "fixed" by editing the test.

---

## F7 — Boot-time 403 storm — **ENV** — NOT A PRODUCT DEFECT

14 of 17 failed responses were `403 {"error":"Not a member of this workspace"}`
(`/revenue/dashboard`, `/twin/dashboard`, `/integrations`, `/vault/health`, …).

**Attribution.** The audit's synthetic operator credential is not a member of a
workspace. This is a property of the test account, not of the product. Recorded
so it is not mistaken for a finding, and so a future audit provisions
membership first.

---

## Summary

| # | Finding | Class | State |
|---|---|---|---|
| F1 | End of Day Review crash on error body | BROKEN | **FIXED** |
| F2 | Global Activity had no page header | REAL INCONSISTENCY | **FIXED** |
| F3 | 402/403 discarded at API call sites | REAL INCONSISTENCY | **OPEN** |
| F4 | 71 button systems, 41 live heights | REAL INCONSISTENCY | **OPEN** (measured) |
| F5 | 277 bare empty states vs shared component | REAL INCONSISTENCY | **OPEN** (measured) |
| F6 | Search aliases | — | **VERIFIED PRESENT** |
| F7 | Workspace 403s | ENV | **NOT A DEFECT** |
