# C.8 — INTERNATIONALIZATION WORKFLOW EVIDENCE

Date: 2026-08-14 · Branch: `security/reality-completion`

Raw measured evidence from the real authenticated SPA and Node's `Intl` engine (the same engine the browser uses).
**No claim from source inspection alone where a live check was possible.**

---

## 1 · Document language attribute — live, authenticated session

```
login -> 200
document.documentElement.getAttribute("lang") -> "en"
document.title -> "Ooplix"
```

Matches source (`frontend/public/index.html`) and shipped build (`frontend/build/index.html`) exactly.

## 2 · Settings — no language control present

```
navigated: More menu -> Settings (real click sequence)
document.body.innerText scanned for /language|locale|idioma|langue|sprache/i
  -> false
```

No language selection surface exists anywhere in the live, authenticated product.

## 3 · Currency formatting — both formatters, representative values

```
ContactsV2._fmtINRExact  — Intl.NumberFormat("en-IN", {style:"currency", currency:"INR", maximumFractionDigits:0})
  1234567.89 -> "₹12,34,568"     (correct Indian lakh-grouping, value preserved)
  0          -> "₹0"
  -1234      -> "-₹1,234"        (sign correctly placed, value preserved)

BusinessOS._fmtAmt       — Intl.NumberFormat(undefined, {style:"currency", currency, maximumFractionDigits:0, minimumFractionDigits:0})
  1234567.89 (USD, Node's default locale) -> "$1,234,568"
```

Both formatters produce correct, value-preserving output. `_fmtINRExact` is deliberately locale-pinned (it is an India-specific formatter by name and purpose, not a general one); `_fmtAmt` is genuinely locale-adaptive. No inconsistency between them — they serve different, correctly-scoped purposes.

## 4 · Live currency rendering in the authenticated app

```
navigated to Payments tab
scanned all leaf DOM elements containing "₹"
  -> ["₹"]   (fresh test tenant has no payment records yet — symbol renders,
              no formatted amount to compare against a fresh account)
```

## 5 · Date/time formatting — locale-hint policy, investigated in full for the clearest case

```
144 genuine Date.toLocaleDateString/toLocaleTimeString call sites found
  (isolated from the 108 Number.toLocaleString currency-formatting calls,
   which are a separate, correctly-scoped pattern — see #3 above)

3 components mix BOTH a default-locale call and a hardcoded-locale call
internally: CommandCenter.jsx, ContentSEO.jsx, WorkflowOSV2.jsx
```

**`CommandCenter.jsx` investigated as the representative case:**

```js
// line 1013 — runtime event timeline, default locale
new Date(evt.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// line 1625 — page header "today" date, hardcoded en-GB
new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
```

Measured output (Node's `Intl` engine, the same one the browser uses):

```
en-GB header date  : "Fri 14 Aug"
default-locale time: "10:39:07 PM"
```

**Both are correct, human-readable formats.** They render in different UI regions for different purposes (a page-header date vs. an event-timeline timestamp) and do not create a visible clash — a user does not see the same kind of value rendered two different ways in the same view. **Not classified as a defect.** The underlying locale-hint policy (some call sites use `[]`/`undefined`, others hardcode `en-IN`/`en-US`/`en-GB`) is genuinely inconsistent across the 144 call sites and is recorded as a `VERIFY` item for a future consistency pass — not mechanically "fixed" here, per the mission's explicit warning against blind replacement.

## 6 · RTL — confirmed absent, not simulated

```
grep -rln 'dir="rtl"|direction:\s*rtl|\[dir=' frontend/src -> 0 results
```

No RTL locale was tested because no RTL support exists to test. Classified `NOT SUPPORTED`, not `NOT MEASURED` — the absence itself was the measurement.

## 7 · Fallback safety — not exercised, because no translation layer exists

The mission's fallback-safety test (break a translation key in a controlled copy, verify no blank UI/`undefined`/`[object Object]`, restore) requires a translation resource to break. **None exists.** No test copy was created or corrupted, and none needed to be restored — there was nothing to test against.

## 8 · Electron — source-level only, per environment constraints

```
grep -n 'language|locale' electron/main.cjs
  -> 1 match: a.name.localeCompare(b.name)   (file-list alphabetical sort, not i18n)
```

No live Electron app instance was launched for this check — the finding (no language-selection code exists in the main process) was conclusive from source alone, and launching the full Electron shell to confirm the absence of a feature that has zero supporting code would not add evidence. **Classified NOT MEASURED for live Electron behavior** (no live Electron session was run), while the source-level absence is classified GENUINE GAP with direct evidence.

---

## Regression evidence

```
npm run test:runtime : 144/144 · 0 fail · 0 skipped   (unchanged — no C.8 code changes were made)
99-c1-accessibility-recovery   : 10/10
100-c2-ux-error-truthfulness   : 10/10
101-c3-performance-guards      : 11/11
102-c4-design-system-guards    : 7/7
103-c5-mobile-guards           : 6/6
104-c6-cross-browser-guards    : 4/4
105-c7-offline-guards          : 7/7
96-production-build-artifact-integrity : 4/4
```

No new C.8 regression suite was added — no genuine defect was found requiring a fix, so there is nothing to lock in behind a negative-tested guard, per the mission's own instruction ("Add a focused C.8 regression suite **if** a real defect is fixed").
