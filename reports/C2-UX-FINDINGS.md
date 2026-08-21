# C.2 — UX FINDINGS

Date: 2026-08-14 · Branch: `security/reality-completion`

`BROKEN (fixed)` · `INCONSISTENT BUT HARMLESS` · `DESIGN-SYSTEM MIGRATION GAP` · `NOT MEASURED` · `ENVIRONMENT BLOCKED` · `FALSE POSITIVE`

---

## Summary

| Classification | Count |
|---|---:|
| **BROKEN — fixed** | **5** |
| INCONSISTENT BUT HARMLESS (left alone) | 3 |
| DESIGN-SYSTEM MIGRATION GAP | 1 |
| NOT MEASURED | 1 (grouped) |
| ENVIRONMENT BLOCKED | 1 |
| FALSE POSITIVE (correctly not "fixed") | 1 |
| Genuine gaps | 0 |

---

## C2-01 — an expired session rendered as "no active missions" — **FIXED**

**Severity: HIGH.** A backend authorization failure presented as a truthful empty state.

`CommandCenter.jsx` loaded missions with `fetch(...).json()` and **no status check**, then called `setError(null)`:

```js
const res = await (await fetch('/p27/missions', {credentials:'include'})).json();
const list = res.missions || res.data || [];
setMissions(active);
setError(null);            // ← clears the error for a response never checked
```

Measured live, unauthenticated:

```
GET /p27/missions -> 401 {"error":"Unauthorized"}
old behaviour  : "0 missions, error CLEARED"
new behaviour  : "explicit error: session expired"
```

The 401 body parses perfectly as JSON, so `res.missions` is `undefined` → `[]`. **The user sees an empty mission list while actually logged out**, and the error is actively suppressed.

This is the same defect class A.11.8 found in `MarketplaceCenter` (a real HTTP 402 rendered as "0") — which is exactly why it deserves a permanent guard rather than a one-off fix.

**Fix.** Check `r.ok` before trusting the body; route 401/403 to a sign-in message and other failures to an explicit HTTP status. `CommandCenter` already renders `CmdPanelError` with a retry, so the failure lands in a real, recoverable UI.

---

## C2-02 — a failed benchmark rendered a green success tick — **FIXED**

**Severity: HIGH.** A failed action presented as completed.

`AIBenchmarkLab.runBench()` stored the response unconditionally:

```js
const d = await r.json();
setRunResult(d);           // ← an error body makes this truthy
```

and the UI renders:

```jsx
{runResult && <div className="abl-run-result">✓ {runResult.count} benchmark runs completed</div>}
```

On a 401/403/500 the error body is truthy and `runResult.count` is `undefined`, so the user clicks **"Run Benchmark"** and sees **"✓ benchmark runs completed"** — a green checkmark for an action that failed.

**Fix.** Guard on `r.ok` before setting the success state; failures go to the `error` state already rendered directly above the success banner. The genuine success path is preserved, not removed.

---

## C2-03 — irreversible token revocation had no confirmation — **FIXED**

**Severity: MEDIUM-HIGH.** Destructive, irreversible, one click, no confirmation.

`WorkspaceSettingsK2.jsx` contains three panels. A.11.8 recovered destructive confirmation for the **Sessions** panel (line 82) using the app's `useConfirm`/`ConfirmDialog` pattern — but the **Tokens** panel was missed:

```js
// Sessions — confirms
if (!await confirm({ title: "Revoke this session?", danger: true, … })) return;

// Tokens — did NOT confirm
async function revoke(id) {
  await _fetch(`/security/tokens/${id}`, { method: "DELETE" });   // ← immediate
```

Revoking an API token is **strictly more damaging** than revoking a session: it is irreversible and instantly breaks any script or integration using it. The weaker action asked; the stronger one did not.

**Fix.** Same file, same established pattern — `useConfirm`, a `danger` dialog naming the token and its consequence, plus rendering `ConfirmUI` in that panel (without which the dialog never appears and the `await` would silently block revocation entirely).

---

## C2-04 — the Dashboard never escaped its loading state — **FIXED**

**Severity: HIGH.** A permanent fake-loading state for the product's primary audience.

`Dashboard.jsx` guards its skeletons with an escape hatch:

```js
const loading = stats === null && opsData === null && nullCycles <= 2;

useEffect(() => {
  if (stats === null && opsData === null) setNullCycles(n => n + 1);
  else setNullCycles(0);
}, [stats, opsData]);        // ← never re-runs while BOTH stay null
```

When both props stay `null`, the dependencies never change, so the effect runs **once**, `nullCycles` sticks at 1, and `loading` stays `true` forever.

That is not hypothetical. `App.jsx` deliberately scopes the stats/opsData poll to operators:

```js
if (healthy && user?.role === "operator") { … setStats(…); setOpsData(…); }
```

(a correct earlier fix — non-operators were getting a 403 on every poll). **So for every ordinary user — role `user`, the founders this product is built for — both props are permanently null and the Dashboard renders 33 skeleton elements indefinitely.**

Measured live before the fix:

```
t=1000ms  33 skeletons
t=3000ms  33 skeletons
t=6000ms  33 skeletons
t=10000ms 33 skeletons     ← never resolves
```

**Fix.** Advance `nullCycles` on a timer and include it in the dependency list, so the hatch fires on its own and the UI resolves to its real empty/zero state.

Measured after:

```
skeletons resolved after: 4020ms   final visible skeletons: 0
```

---

## C2-05 — the same search returned different results on two surfaces — **FIXED**

**Severity: MEDIUM.** Found by an existing A.11.8 guard that was already failing when C.2 began.

Suite 89's static check F5 asserts every More-menu alias word is also a ⌘K keyword. It was failing:

```
✗ F5 static — drifted: contentseo:campaign/campaign/editorial,
                       distribution:campaign/campaign/broadcast
```

`campaign`, `editorial` and `broadcast` were added to the `MORE_TABS` aliases during the Marketing/Growth OS work but never mirrored into `CommandPalette.jsx`. A user searching **"campaign"** found these surfaces in the More menu and **not** in ⌘K.

**This drift was introduced by earlier work in this programme**, and A.11.8's guard caught it — the guard doing exactly its job.

**Fix.** Mirror the three keywords into the palette registry. Suite 89 now passes.

---

## INCONSISTENT BUT HARMLESS — deliberately not changed

Per the mission: *"Do not change merely because two implementations differ."*

| # | Observation | Why left alone |
|---|---|---|
| H-1 | `Delete` (7) vs `Remove` (4) | Different semantics — removing an item from a list is not deleting a record |
| H-2 | `Cancel` (68) vs `cancel` (2) vs `✕ Cancel` (1) | Overwhelmingly consistent; the variants are visually distinct affordances, not confusion |
| H-3 | `Save` + 7 contextual variants ("Save draft", "Save preferences") | Contextual specificity **helps** the user; flattening to "Save" would lose meaning |

---

## DESIGN-SYSTEM MIGRATION GAP — documented, not forced

**DS-1.** 83 distinct `border-radius` values, 35 `font-size` values and 71 explicit heights across 196 CSS files, with design tokens and literals coexisting.

Consolidating these requires a product-wide design decision about the canonical scale, and a mechanical sweep risks damaging unrelated UI. The mission explicitly says to classify rather than force this. **Recorded as a migration gap; no consolidation attempted.**

---

## FALSE POSITIVE — correctly not "fixed"

**FP-1.** A custom contrast heuristic in the C.2 harness reported three elements at ratio **1.0** (`.tb-cta`, `.cd-org-role`, `.palette-trigger`) in both themes.

Investigated rather than fixed. Both use **semi-transparent backgrounds** (`rgba(255,255,255,0.15)`, `rgba(124,58,237,0.12)`); the heuristic walked up to the nearest opaque ancestor and ignored the translucent layer composited on top, computing the wrong background.

Verified with the authoritative tool, with all three elements confirmed present in the DOM:

```
[dark]  elements present: {cta:true, role:true, trigger:true}   axe color-contrast violations: 0
[light] elements present: {cta:true, role:true, trigger:true}   axe color-contrast violations: 0
```

**They pass. Changing them would have been a fabricated fix to satisfy a faulty measurement** — the same trap as C.1's skip link.

---

## ENVIRONMENT BLOCKED

**EB-1.** Suite 89's **live** assertions self-skip: `no usable session — saved JWT expired at 2026-08-08T17:18:09.000Z`. Its static assertions all run and now pass. The live half is **not counted as a pass**, and the suite correctly reports the block rather than passing silently.

---

## NOT MEASURED

Recorded honestly; none scored as passing.

| Surface | Why |
|---|---|
| Drawers, sidebars, tooltips | Not reached by the measured journeys |
| Tables at realistic data volume | Fresh tenant has no data; no seeded dataset |
| Multi-step workflows end-to-end | Requires provisioned integrations |
| Workspace / tenant switching under load | Single-tenant session |
| Toasts across all surfaces | Only the Payments path exercised |
| Back/cancel across every flow | Only palette + form paths exercised |
| **The 82 "More" tabs' internal UX** | Same coverage limit as C.1 |

---

## Deferred to C.5 — recorded, scope not expanded

**M-1.** Horizontal overflow at small widths:

```
390px  overflow 204px  5 controls offscreen
430px  overflow 164px  5 controls offscreen
768px+ clean
```

This is a broad mobile-layout system issue, and the mission explicitly says not to turn C.2 into the C.5 Mobile Experience Audit. **Recorded, not fixed here.**
