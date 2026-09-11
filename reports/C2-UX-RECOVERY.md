# C.2 — UX RECOVERY

Date: 2026-08-14 · Branch: `security/reality-completion`

What changed, why it was minimal and correct, and how each was verified.
**Every fix: REPRODUCE → ROOT CAUSE → MINIMAL FIX → BUILD → LIVE VERIFY → REGRESSION → NEGATIVE TEST.**

---

## Recovery rule applied

| Situation | Rule | Applied to |
|---|---|---|
| BROKEN | fix minimally | C2-01 … C2-05 |
| INCONSISTENT BUT HARMLESS | classify, don't change | Delete/Remove, Cancel casing, Save variants |
| DESIGN-SYSTEM MIGRATION | document | DS-1 (83 radii / 35 font sizes) |
| Broad mobile-system issue | record for C.5 | 390/430px overflow |
| Faulty measurement | investigate, don't "fix" | FP-1 translucent-background contrast |
| Environment unavailable | document | Suite 89 live half |

**No new component system was created. No design language invented. Every fix used a pattern the codebase already had.**

---

## Files changed — 5 source files, 1 test added

```
M frontend/src/components/CommandCenter.jsx        C2-01 status guard before trusting body
M frontend/src/components/AIBenchmarkLab.jsx       C2-02 status guard before success state
M frontend/src/components/WorkspaceSettingsK2.jsx  C2-03 useConfirm on token revocation
M frontend/src/components/Dashboard.jsx            C2-04 timer-driven loading escape hatch
M frontend/src/components/CommandPalette.jsx       C2-05 mirror 3 drifted alias keywords
+ tests/security/100-c2-ux-error-truthfulness.cjs  10 assertions, negative-tested
```

**No existing test modified.** `.env` untouched. No authentication, authorization or tenant-isolation code touched.

---

## 1. C2-01 — an authorization failure must not become an empty state

```js
+ const r = await fetch('/p27/missions', { credentials: 'include' });
+ if (!r.ok) {
+   setMissions([]);
+   setError(r.status === 401 || r.status === 403
+     ? 'Your session has expired or you lack access to missions. Please sign in again.'
+     : `Could not load missions (HTTP ${r.status}).`);
+   return;
+ }
+ const res = await r.json();
```

The component already had an `error` state rendered through `CmdPanelError` **with a retry**, so this routes the failure into existing, recoverable UI rather than adding a new pattern.

**Verified live:** `401` → old code produced `"0 missions, error CLEARED"`; new code produces an explicit session-expired message.

---

## 2. C2-02 — a failed action must not render as a success

```js
+ if (!r.ok) {
+   let detail = "";
+   try { const b = await r.json(); detail = b?.error || b?.message || ""; } catch {}
+   setError(r.status === 401 || r.status === 403
+     ? "Your session has expired or you lack access to benchmarks. Please sign in again."
+     : `Benchmark run failed (HTTP ${r.status})${detail ? ` — ${detail}` : ""}.`);
+   return;
+ }
  const d = await r.json();
  setRunResult(d);
```

Failures land in the `error` state that was **already rendered directly above** the success banner. The regression suite asserts the genuine success message still exists — this redirects failures, it does not delete the success path.

---

## 3. C2-03 — confirm an irreversible action, using the file's own pattern

```js
+ const [confirm, ConfirmUI] = useConfirm();
  …
+ const t = tokens.find(x => x.id === id);
+ if (!await confirm({
+   title: "Revoke this API token?",
+   message: `${t?.name || "That token"} will stop working immediately. Any script or
+             integration using it will start failing. This cannot be undone.`,
+   danger: true, confirmLabel: "Revoke",
+ })) return;
```

plus `{ConfirmUI}` in the panel's render root.

**That last part matters:** `useConfirm` resolves through the rendered `ConfirmUI`. Without it the dialog never appears and the `await` would block revocation forever — turning a missing-confirmation bug into a broken feature. The regression suite asserts the render explicitly, and the negative test proves it fails without it.

The pre-existing A.11.8 confirmations in the same file are asserted intact — this adds one, removes none.

---

## 4. C2-04 — make the loading escape hatch actually fire

```js
- useEffect(() => {
-   if (stats === null && opsData === null) setNullCycles(n => n + 1);
-   else setNullCycles(0);
- }, [stats, opsData]);

+ useEffect(() => {
+   if (stats !== null || opsData !== null) { setNullCycles(0); return; }
+   if (nullCycles > 2) return;                 // already escaped
+   const t = setTimeout(() => setNullCycles(n => n + 1), 1200);
+   return () => clearTimeout(t);
+ }, [stats, opsData, nullCycles]);
```

The bug was a dependency-list problem, not a data problem: while both props stayed `null` the deps never changed, so the hatch ran once and stopped. Adding `nullCycles` plus a timer lets it advance on its own.

**Deliberately not changed:** the operator-scoped poll in `App.jsx`. Widening it would reintroduce the 403 storm a previous phase fixed. The correct fix is for the UI to resolve honestly when it has no data — which is what this does.

```
before: 33 skeletons at t=1s, 3s, 6s, 10s — never resolved
after : resolved after 4,020 ms, 0 visible skeletons
```

---

## 5. C2-05 — one search, one result set

```js
- keywords: "… blog article keyword calendar"
+ keywords: "… blog article keyword calendar campaign content editorial"
- keywords: "publish publishing social post channel influencer community launch"
+ keywords: "… community launch campaign distribution broadcast"
```

Restores parity between the More-menu alias list and the ⌘K registry. Suite 89's F5 static drift check — an **existing A.11.8 guard that was already failing when C.2 started** — now passes.

---

## Regression — no test weakened

| Gate | Before C.2 | After C.2 |
|---|---|---|
| `npm run test:runtime` | 144/144 · 0 fail · 0 skipped | **144/144 · 0 fail · 0 skipped** |
| `82-founder-dashboard-ux…` (A.11.1) | 22 pass | **22 pass** |
| `83-crm-sales-ux…` (A.11.2) | 33 pass | **33 pass** |
| `86-enterprise-org-billing-ux…` (A.11.5) | 40 pass | **40 pass** |
| `89-cross-product-ux-sweep` (A.11.8) | **FAILING (F5 drift)** | **PASS** |
| `90-phase-c1-search-alias-coverage` | 8 pass | **8 pass** |
| `96-production-build-artifact-integrity` | 4 pass | **4 pass** |
| `99-c1-accessibility-recovery` | 10 pass | **10 pass** |
| `100-c2-ux-error-truthfulness` *(new)* | — | **10 pass** |
| Production build | PASS | **PASS** |

**C.1's accessibility work is intact** (suite 99 green), and C.2 fixed a pre-existing A.11.8 failure rather than leaving it.

---

## Negative tests — every fix proven to fail when reverted

```
C2-01  restore unguarded mission fetch
       -> FAILED: setError(null) must not run on a response that was never checked

C2-02  restore unguarded benchmark success
       -> FAILED: runBench must check response status — the UI renders
                  '✓ {count} benchmark runs completed'

C2-03a remove {ConfirmUI} render
       -> FAILED: ConfirmUI must be RENDERED in this panel — without it the dialog
                  never appears and the await would silently block revocation

C2-03b remove the confirm() await
       -> FAILED: revoke() must await a confirmation before issuing the DELETE

C2-04  restore the broken dependency list
       -> FAILED: the nullCycles escape hatch must advance on its own

restored -> 10 passed, 0 failed
```

---

## What was deliberately NOT done

| Not done | Why |
|---|---|
| Consolidate 83 radii / 35 font sizes | Broad design decision — DESIGN-SYSTEM MIGRATION GAP per the mission |
| Normalise "Delete" vs "Remove", `Cancel` casing, `Save` variants | Harmless and often semantically correct; the mission forbids changing merely because implementations differ |
| Fix the 390/430px overflow | Broad mobile-system issue — belongs to C.5 |
| "Fix" the three ratio-1.0 elements | They pass axe; the reading came from a faulty translucent-background heuristic |
| Widen the operator-scoped stats poll | Would reintroduce a 403 storm a previous phase deliberately fixed |
| Refresh suite 89's expired live JWT | Would require credentials I was not given; recorded as ENVIRONMENT BLOCKED |
