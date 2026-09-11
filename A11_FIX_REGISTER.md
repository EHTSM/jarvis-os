# A.11 — Fix Register

Every entry follows the mission rule:
REPRODUCE → MEASURE → IDENTIFY → **RECOVER EXISTING PATTERN** → FIX → REGRESSION → RE-VERIFY.

No new component, design system, button library, modal system or toast system
was created. No architecture changed.

**Commit:** `d779ff84`

---

## FIX-1 — End of Day Review crash on a non-array response body

| Step | Evidence |
|---|---|
| **Reproduce** | Live authenticated walk: `[End of Day Review] (o.lessons \|\| o \|\| []).slice is not a function` |
| **Measure** | `GET /lessons` → `401 {"error":"Unauthorized"}` — a body with no `.lessons` key |
| **Identify** | `EndOfDayReview.jsx:21` used `a \|\| b \|\| []`, a truthiness guard; the error object satisfied it and `.slice()` threw |
| **Recover** | `Array.isArray()` — the guard already used **102×** in the frontend |
| **Fix** | `components/EndOfDayReview.jsx` — `lessons` and the sibling `missions` line |
| **Regression** | `tests/runtime/29` — guard asserted **and** the old pattern negative-tested |
| **Re-verify** | Same live walk: page errors **2 → 1** |

**Diff shape** (no behaviour added, only the type guard):

```js
- const lessons = (lessonsData.lessons || lessonsData || []).slice(0, 5);
+ const lessons = (Array.isArray(lessonsData?.lessons) ? lessonsData.lessons
+   : Array.isArray(lessonsData) ? lessonsData : []).slice(0, 5);
```

---

## FIX-2 — Global Activity had no page header

| Step | Evidence |
|---|---|
| **Reproduce** | Header count measured on 25 authenticated surfaces; Global Activity was the only `0` |
| **Measure** | The surface opened directly onto `.gaf-toolbar` — a filter row, not a title |
| **Identify** | Its sibling `SystemHealthDashboard.jsx:393` carries `.shd-header → .shd-title + .shd-ts`; this surface carries only `.gaf-title`, a *per-event* title |
| **Recover** | The `SystemHealthDashboard` header pattern, expressed in this component's own `gaf-` namespace |
| **Fix** | `components/GlobalActivityFeed.jsx` + `.css` — header element, title, context line |
| **Regression** | `tests/runtime/29` — header present, styled, and titled |
| **Re-verify** | Rebuilt and re-walked live; surface renders with its header |

---

## FIX-3 — Global Activity canvas ignored the theme

| Step | Evidence |
|---|---|
| **Reproduce** | Found while applying FIX-2 |
| **Measure** | `.gaf-root { background: #08090e }` — a hardcoded near-black canvas |
| **Identify** | Same token-bypass class removed across ~200 files in B19.2.2/B19.2.3 |
| **Recover** | `var(--bg)`, the canonical canvas token |
| **Fix** | `components/GlobalActivityFeed.css` |
| **Regression** | `tests/runtime/29` — asserts the token **and** that the literal cannot return |
| **Re-verify** | Synthetic + live accessibility scans re-run: **0/0** both themes, unchanged |

---

## Deliberately NOT fixed

Recorded so the register cannot be read as complete when it is not.

| Finding | Why not fixed in A.11 |
|---|---|
| **F3** — 402/403 discarded at API call sites | Requires deciding, per surface, what the user sees for each status. That is scoped remediation, not mechanical recovery; a partial pass would leave a mixed state. 149 empty catch blocks measured. |
| **F4** — 71 button systems, 41 live heights | Consolidation is a design-system migration across every surface, explicitly excluded by *"do not create another button system / do not redesign"*. Measurement delivered instead. |
| **F5** — 277 bare empty states | Each needs its own copy (what/why/next). Content work, not pattern recovery. |
| **suite 89** stale expectation | Its assertions are satisfied by current source (15/15 verified). Editing a test to make it green would weaken it — prohibited by Part 16. Reported instead. |

---

## Regression impact

| Suite | Before | After |
|---|---|---|
| `npm run test:runtime` | 144/144 | **144/144** |
| `25-accessibility-contrast` | 9/9 | **9/9** |
| `26-accessibility-foundation` | 21/22 | **21/22** (B19.4 form gap) |
| `27-visual-accessibility` | 16/16 | **16/16** |
| `28-keyboard-aria-recovery` | 14/14 | **14/14** |
| `29-a11-ux-consistency` | — | **7/7** (new) |
| Production build | clean | **clean, 0 warnings** |

No test was weakened. One test file was added.
