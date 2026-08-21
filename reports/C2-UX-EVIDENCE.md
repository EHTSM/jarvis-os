# C.2 — UX EVIDENCE

Date: 2026-08-14 · Branch: `security/reality-completion`

Raw measured evidence from the real authenticated SPA on `:5050`, driven by real clicks in Chromium.
**No screenshots as primary evidence. No invented user-testing results. No unmeasured property called PASS.**

---

## 1. Critical journeys — measured

### J1 · Shell and primary navigation

```
tabs: Dashboard · Contacts · Payments · Pipeline · AI · More (82) ▾
skip link: present · org switcher: present

              nav ms  spinners  empty  errors  focusable
Dashboard       947      0        5       0       36
Contacts        942      0        0       0       52
Payments        933      0        4       0       49
Pipeline        938     33 ←      0       0       36
AI              957      0        0       0       36
```

All five tabs render a page heading and reach interactive content in **<1 s**. `Pipeline`'s 33 skeletons with 0 empty states led to **C2-04**.

### J2 · Command palette

```
open            : 253 ms cold / 66 ms warm
focus trapped   : true
actions listed  : 93
search "payments"      -> 2 results, first = "Payments"
search "zzzznotathing" -> 0 results, honest empty state:
                          "No commands found for \"zzzznotathing\""
Escape          : closes
```

The empty state names the query back to the user rather than showing a bare "no results" — truthful and specific.

### J3 · More menu

```
items: 83 · has search: yes · overflow clipped: false
search "enterprise" -> 15 visible
```

### J4 · Validation failure

```
Payments · submit empty form
  -> inline error "Enter a valid amount."
  -> 0 toasts, 0 misleading success feedback
  -> 1,223 ms
```

Validation is **inline and specific**, not a generic toast.

### J5 · Responsive

```
 390px  h-scroll true   overflow 204px  offscreen controls 5   tabs 6
 430px  h-scroll true   overflow 164px  offscreen controls 5   tabs 6
 768px  h-scroll false  overflow   0    offscreen controls 0   tabs 6
1024px  h-scroll false  overflow   0    offscreen controls 0   tabs 6
1440px  h-scroll false  overflow   0    offscreen controls 0   tabs 6
```

Clean at 768 px and above. The small-width overflow is **recorded for C.5**, not fixed here.

### J6 · Themes

```
[dark]  axe wcag2aa color-contrast violations: 0
[light] axe wcag2aa color-contrast violations: 0
        (.tb-cta, .cd-org-role, .palette-trigger all confirmed PRESENT in the DOM)
```

---

## 2. C2-01 — the defect proven with live data

```
GET /p27/missions          -> 401 {"error":"Unauthorized"}
GET /p27/ai/providers      -> 401 {"error":"Unauthorized"}
GET /ai-ecosystem/creative -> 401 {"error":"Unauthorized"}

The 401 body parses cleanly as JSON, so an unchecked .json() cannot tell it from success:

  oldWouldShow : "0 missions, error CLEARED"
  newWouldShow : "explicit error: session expired"
```

---

## 3. C2-04 — infinite loading, before and after

**Before:**

```
t= 1000ms  33 visible skeletons  (dv2-skeleton, --label, --bar, --count)
t= 3000ms  33 visible skeletons
t= 6000ms  33 visible skeletons
t=10000ms  33 visible skeletons   ← never resolves
```

**After:**

```
skeletons resolved after: 4020 ms
final visible skeletons : 0
```

Root cause confirmed in source: `App.jsx` scopes the stats/opsData poll to `user?.role === "operator"`, so an ordinary user's props are permanently `null`, and the `[stats, opsData]` dependency list meant the escape hatch never re-ran.

---

## 4. C2-05 — the drift an existing guard caught

```
BEFORE (suite 89):
  ✗ F5 static — every More-menu alias word must also be a ⌘K keyword; drifted:
      contentseo:campaign/campaign/editorial
      distribution:campaign/campaign/broadcast

AFTER:
  Phase A.11.8 cross-product UX consistency checks passed.
```

---

## 5. Inventories

```
CSS files scanned              : 196
border-radius distinct values  :  83
font-size distinct px values   :  35
explicit height distinct values:  71

data-fetching components       : 114
  without error handling       :   0
  without loading indicator    :  11
  without empty-state signal   :  24

DELETE calls without confirmation: 1 of ~12  (fixed as C2-03)

action label vocabulary:
  CANCEL 68x "Cancel" · BACK 27x "← Back" · RETRY 20x "Retry"
  DELETE 7x "Delete" / 4x "Remove" · SAVE 6x "Save" + 7 contextual variants
```

---

## 6. Regression gates

| Gate | Result | Counted as |
|---|---|---|
| `npm run test:runtime` | **144/144** · 50 suites · 0 fail · 0 skipped | **PASS** |
| `82-founder-dashboard-ux…` (A.11.1) | 22 passed, 0 failed, 1 skipped | **PASS** |
| `83-crm-sales-ux…` (A.11.2) | 33 passed, 0 failed, 1 skipped | **PASS** |
| `86-enterprise-org-billing-ux…` (A.11.5) | 40 passed, 0 failed, 1 skipped | **PASS** |
| `89-cross-product-ux-sweep` (A.11.8) | **static PASS** (was FAILING) · live half SKIPPED | **PASS (static)** · live **NOT counted** |
| `90-phase-c1-search-alias-coverage` | 8 passed, 0 failed | **PASS** |
| `96-production-build-artifact-integrity` | 4 passed, 0 failed | **PASS** |
| `99-c1-accessibility-recovery` | 10 passed, 0 failed | **PASS** |
| **`100-c2-ux-error-truthfulness`** *(new)* | **10 passed, 0 failed** | **PASS** |
| Production build | Compiled successfully | **PASS** |
| `19-logging-consistency` | fails | **PRE-EXISTING FAIL** — untouched |

**127 prior UX assertions + 10 new = 137 UX assertions passing.**

**Suite 89's live half is ENVIRONMENT BLOCKED**, not passing: `no usable session — saved JWT expired at 2026-08-08T17:18:09.000Z`. The suite reports the block rather than passing silently, and it is **not counted as a pass**.

---

## 7. Negative tests — all five fixes provably fail when reverted

```
C2-01 unguarded mission fetch  -> FAILED: setError(null) must not run on a response
                                          that was never checked
C2-02 unguarded benchmark      -> FAILED: runBench must check response status
C2-03a remove {ConfirmUI}      -> FAILED: ConfirmUI must be RENDERED in this panel
C2-03b remove confirm() await  -> FAILED: revoke() must await a confirmation
C2-04 broken dependency list   -> FAILED: the nullCycles escape hatch must advance
                                          on its own
restored                       -> 10 passed, 0 failed
```

---

## 8. Security and data-safety constraints

| Constraint | Status |
|---|---|
| Authentication not weakened | **HELD** — no auth code touched |
| Authorization not weakened | **HELD** |
| Tenant isolation not weakened | **HELD** |
| Permission checks not weakened | **HELD** |
| **UX must not hide a backend authorization failure** | **STRENGTHENED** — C2-01 and C2-02 were exactly this defect, both fixed |
| A 403/401 must not become a fake success | **ENFORCED** by suite 100, negative-tested |

---

## 9. Constraint compliance

| Constraint | Status |
|---|---|
| `.env` not modified | **HELD** — 0 entries in `git status` |
| No test weakened | **HELD** — no existing test modified; one added |
| No duplicate component system | **HELD** — reused `useConfirm`/`ConfirmDialog`, existing error states |
| No broad codemod | **HELD** — 5 files, each edited deliberately |
| No merge, no push | **HELD** |
| No OS-track work | **HELD** |
| C.5 scope not expanded | **HELD** — mobile overflow recorded only |
| C.1 not reopened | **HELD** — suite 99 re-run as a regression check only |
| No unmeasured property called PASS | **HELD** — 7 surfaces listed NOT MEASURED |
| Score not rounded upward | **HELD** — see certification |
