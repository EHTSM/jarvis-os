# C.1 — ACCESSIBILITY RECOVERY

Date: 2026-08-14 · Branch: `security/reality-completion`

What was changed, why it was the minimal correct change, and how each was verified.
**Every fix follows: REPRODUCE → ROOT CAUSE → MINIMAL FIX → BUILD → LIVE VERIFY → REGRESSION → NEGATIVE TEST.**

---

## Recovery rule applied

The mission's classification rule drove every decision:

| Situation | Rule | Applied to |
|---|---|---|
| EXISTING + BROKEN | minimal recovery | C1-D1, C1-D4, C1-D2, C1-D3 |
| EXISTING + MISLEADING | correct the claim | — |
| EXISTING label text, unassociated | **wire it** — do not invent | 5 Payments controls |
| No visible label exists | minimal `aria-label` | Contacts search, chat input |
| Passing element flagged by a tool | **leave it** | skip link (5.13:1) |
| Environment unavailable | document, do not simulate | screen readers |
| Unmeasured surface | do not claim | 82 "More" tabs |

**Nothing was rebuilt from zero. No label was invented. No broad codemod was used.**

---

## Files changed — 6 source files, 1 test added

```
M backend/server.js                                     C1-D1 static 404 boundary
                                                        C1-D4 mtime-keyed index.html cache
M frontend/src/components/CustomerFirstRunWizard.css    C1-D2 theme-aware surface token
M frontend/src/components/CommandCenter.css             C1-D3 theme-aware surface token
M frontend/src/components/PaymentsV2.jsx                G1-B193 5 label associations
M frontend/src/components/ContactsV2.jsx                G1-B193 aria-label
M frontend/src/components/Chat.jsx                      G1-B193 stable aria-label
+ tests/security/99-c1-accessibility-recovery.cjs       10 assertions, negative-tested
```

**No existing test was modified.** `.env` untouched. No authentication code touched.

---

## 1. C1-D1 — missing build asset must be 404, never 401

**Minimal fix.** A 404 boundary scoped to build-asset directories, placed *after* `express.static` has had its chance, so present assets are unaffected.

```js
app.use(["/static", "/assets"], (req, res) => {
    res.status(404).json({
        success: false,
        error: `Not Found: ${req.method} ${req.baseUrl}${req.path}`,
        hint: "Static build asset not found — the frontend build may be stale or incomplete.",
    });
});
```

The reasoning is recorded in the code: build assets are public when present, so they must not become auth-gated by being absent.

**Verified.** Missing → `404` with a diagnostic hint. Real bundle → `200 text/javascript`. Shell → `200`.
**Negative-tested.** Boundary disabled → `401` returned and the suite failed with the exact message.

---

## 2. C1-D4 — pick up a redeploy without a restart

**Minimal fix.** Key the cached template on `mtime + size` rather than caching forever.

```js
const st = require("fs").statSync(indexHtmlPath);
stamp = `${st.mtimeMs}:${st.size}`;
if (_indexHtmlTemplate === null || _indexHtmlStamp !== stamp) { /* re-read */ }
```

One read per deploy, not per request. A `stat()` per request is negligible next to serving a blank app.

**Verified with a real content change** (a first attempt used a comment, which minification stripped — that test proved nothing and was redone):

```
served BEFORE : main.51b4f711.js
served AFTER  : main.4eea5632.js   disk: main.4eea5632.js   pid 6472 unchanged
```

---

## 3–4. C1-D2 / C1-D3 — theme-aware modal surfaces

**Root cause in both:** an undefined CSS custom property with a **dark literal fallback**, so light mode rendered dark-on-dark.

```css
- background: var(--surface-elevated, #12131c);   /* undefined  -> 1.13:1 */
+ background: var(--surface-float);               /* theme-aware -> passes */

- background: var(--surface-2, #1a1a2e);          /* undefined  -> 1.04:1 */
+ background: var(--surface-float);
```

`--surface-float` already existed as the repository's modal/tooltip token, defined in **both** palettes. **No new token was introduced** — the regression suite asserts it is defined in both themes, so the fix cannot become hollow.

**Verified.** axe `color-contrast` on the rendered first-run modal: **4 violations → 0**, with the modal confirmed present (not a false pass from an absent element).

---

## 5. G1-B193 — wire the labels that already existed

**The important finding: five controls already had human-written visible labels that were never associated.** The remedy was to connect them, following the pattern the repository itself established in B19.5 on `pv2-template`.

```jsx
- <label className="pv2-label">Amount (₹) <span className="pv2-req">*</span></label>
- <input className="pv2-input" placeholder="15000" … />
+ <label className="pv2-label" htmlFor="pv2-amount">Amount (₹) <span className="pv2-req">*</span></label>
+ <input id="pv2-amount" className="pv2-input" placeholder="15000" … />
```

Two controls had **no** visible label (icon-prefixed search, chat input) and received a minimal `aria-label`. The chat input's placeholder changes with connection state, so `aria-label` gives it one stable name while the placeholder keeps carrying the status hint.

**Verified live, modal correctly dismissed: 9 controls named, 0 unnamed** (was 7 unnamed).

---

## Regression — no test weakened

| Gate | Before C.1 | After C.1 |
|---|---|---|
| `npm run test:runtime` | 144/144 · 0 fail · 0 skipped | **144/144 · 0 fail · 0 skipped** |
| Security suites 90–96, 98 | PASS | **PASS** |
| `99-c1-accessibility-recovery` *(new)* | — | **PASS 10/10** |
| Production build | PASS | **PASS** |
| axe — dark, 5 tabs | 0 | **0** |
| axe — light, 5 tabs | **17 nodes** | **0** |

The 144 runtime tests include the 93 pre-existing accessibility assertions from B19.1–B19.3 (suites 25–28); all still pass, so no earlier accessibility recovery was undone.

---

## Negative tests — the new suite provably fails

Per the audit rule that a gate must be proven able to fail, each fix was reverted in turn:

```
reintroduce dark fallback  -> FAILED: CustomerFirstRunWizard must not fall back to a
                                      hardcoded colour … 1.13:1 against AA's 4.5:1
remove a label association -> FAILED: PaymentsV2 must associate its existing visible
                                      label with #pv2-amount
disable the 404 boundary   -> 401 returned
                              FAILED: … must not return 401 — a MISSING FILE reported
                                      as an AUTH FAILURE
restored                   -> 10 passed, 0 failed
```

A self-inflicted issue was also caught and corrected: the suite's first version matched the explanatory comments that quote the original buggy CSS. It now strips comments before asserting, so it tests real CSS rather than prose.

---

## What was deliberately NOT done

| Not done | Why |
|---|---|
| Label the 791 source-level bare controls | Not measured live; a bulk codemod would generate unverifiable labels across ten product families and risk damaging unrelated UI. The mission forbids broad codemods. |
| "Fix" the skip link | It measures **5.13:1 — it passes AA.** The axe flag was indeterminate-background, not a real failure. |
| Launch VoiceOver | Would seize audio and keyboard control of the user's live desktop. |
| Chase the mobile horizontal scroll | Belongs to C.5 (Mobile Experience). C.1 did not expand scope. |
| Add a new `--surface-elevated` token | `--surface-float` already existed for exactly this purpose. |
