# C.1 — ACCESSIBILITY EVIDENCE

Date: 2026-08-14 · Branch: `security/reality-completion`

Raw measured evidence. Every figure below was observed in a real browser against the running application, or produced by a named tool. **Nothing is simulated. No screen-reader result is inferred from the DOM.**

---

## Tooling

| Tool | Version | Source |
|---|---|---|
| axe-core | 4.13.0 | already in repo |
| Playwright (Chromium) | 1.61.1 | already in repo |

Ruleset: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`.
Nothing was installed for this audit.

---

## 1. Automated WCAG — before and after

Live, authenticated, first-run modal dismissed, across the 5 primary tabs.

| Theme | Baseline | After C.1 |
|---|---:|---:|
| dark | 0 | **0** |
| **light** | **17 nodes** (`color-contrast`) | **0** |

```
[DARK]  axe wcag2a/aa + wcag21a/aa across 5 tabs:  0 violations
[LIGHT] axe wcag2a/aa + wcag21a/aa across 5 tabs:  0 violations
```

Baseline violating elements (all light mode):

```
<span class="cfr-step-count">1/5</span>
<h2 class="cfr-title">Welcome to Ooplix</h2>
<p class="cfr-body">Your 7-day free trial has started…</p>
<button class="cfr-btn-skip">Skip for now</button>
```

---

## 2. Contrast — measured ratios

WCAG 2.x relative luminance, computed from the real token values.

**Before (light mode, undefined token → dark literal fallback):**

```
.cfr-card background: #12131c   (var(--surface-elevated, #12131c) — token UNDEFINED)
  --text        #1a1f2e   1.13:1   FAIL   (AA 4.5:1)
  --text-dim    #565f78   2.91:1   FAIL
  --text-faint  #636b86   3.50:1   FAIL

.cmd-stop-confirm-panel background: #1a1a2e   (var(--surface-2, #1a1a2e) — token UNDEFINED)
  --text        #1a1f2e   1.04:1   FAIL
  --text-dim    #565f78   2.68:1   FAIL
  --danger      #f55b5b   5.30:1   pass
```

**After:** both surfaces use `--surface-float`, defined in both palettes. axe reports **0 `color-contrast` violations** in either theme on the rendered modal.

**Skip link — measured, and correctly left alone:**

```
white on #6657e8 = 5.13:1   AA normal text (4.5:1): PASS
```

axe flagged it once when it sat off-screen (`top:-40px`) over an indeterminate backdrop; on a clean load no violation is reported. **A passing element was not "fixed".**

---

## 3. Accessible names — live DOM

Names computed by the browser through the accname precedence chain, not read from source.

**Baseline — 7 distinct unnamed controls (28 occurrences across viewports):**

```
[Contacts] input     placeholder-ONLY  "Search by name, phone, service…"
[Payments] input     placeholder-ONLY  "Search contacts…"
[Payments] input     placeholder-ONLY  "15000"
[Payments] input     placeholder-ONLY  "Website redesign — 50% advance"
[Payments] input     placeholder-ONLY  "+91-9876543210"
[Payments] textarea  placeholder-ONLY  "Type a message or choose a template above…"
[AI]       input     placeholder-ONLY  "Message Ooplix, or type a command…"
```

**After — 0 unnamed:**

```
[Contacts] 1 control   ok aria-label  Search contacts by name, phone or service
[Payments] 6 controls  ok label-for   Customer (optional)
                       ok label-for   Amount (₹) *
                       ok label-for   Description
                       ok label-for   Phone number
                       ok label-for   Message template
                       ok label-for   Message
[AI]       2 controls  ok aria-label  Select AI model
                       ok aria-label  Message Ooplix

NAMED: 9   UNNAMED: 0
```

Five of the six Payments names are **pre-existing human-written label text**, now programmatically associated. None was invented.

---

## 4. Keyboard

Live, authenticated, modal dismissed.

```
TAB          : reached 24 elements
               without a visible focus indicator: 0
SHIFT+TAB    : moved backwards: true
CMD+K        : opens palette dialog: true
               focus inside dialog (trap): true
ESCAPE       : closes dialog: true
```

**Every focusable element reached had a visible focus indicator** (outline or box-shadow). No mouse-only critical interaction was found on the measured surface.

---

## 5. Responsive widths

```
mobile   390px   tabs=6   h-scroll=true    violations: 0
tablet   768px   tabs=6   h-scroll=false   violations: 0
desktop 1440px   tabs=6   h-scroll=false   violations: 0
```

Horizontal scroll at 390 px is recorded as an observation for **C.5 (Mobile Experience)** — it breaches no AA criterion in the C.1 ruleset and C.1 did not expand scope to it.

---

## 6. Screen readers — BLOCKED, not simulated

```
platform            : Darwin 24.6.0
VoiceOver           : present (macOS system component) — NOT running, NOT launched
NVDA                : NOT AVAILABLE (Windows only)
Narrator            : NOT AVAILABLE (Windows only)
TalkBack            : NOT AVAILABLE (no Android device attached)
```

Launching VoiceOver would seize audio and keyboard control of the user's live desktop; the mission forbids that without confirming safety.

**No screen-reader PASS is claimed anywhere. B.19.3's NOT CERTIFIED verdict for screen-reader accessibility stands.**

---

## 7. Regression gates

| Gate | Result | Counted as |
|---|---|---|
| `npm run test:runtime` | **144/144** · 50 suites · 0 fail · 0 skipped | **PASS** |
| ├ `25-accessibility-contrast` (20) | pass | PASS |
| ├ `26-accessibility-foundation` (24) | pass | PASS |
| ├ `27-visual-accessibility` (19) | pass | PASS |
| └ `28-keyboard-aria-recovery` (30) | pass | PASS |
| `90-phase-c1-search-alias-coverage` | 8/8 | PASS |
| `91-api-404-boundary` | 5/5 | PASS |
| `92-c11-runtime-defect-regressions` | 9/9 | PASS |
| `93-os2-os3-fake-success-protection` | 6/6 | PASS |
| `94-business-routes-auth-required` | 4/4 | PASS |
| `95-marketing-os-integrity` | 4/4 | PASS |
| `96-production-build-artifact-integrity` | 4/4 | PASS |
| `97-enterprise-isolation-integrity` | **6/6** (after the rate-limit window cleared) | **PASS** |
| `98-b25-control-honesty` | **5/5** (after the rate-limit window cleared) | **PASS** |
| **`99-c1-accessibility-recovery`** *(new)* | **10/10**, negative-tested | **PASS** |
| Production build | Compiled successfully | **PASS** |
| `19-logging-consistency` | fails | **PRE-EXISTING FAIL** — untouched |

**Suites 97 and 98 — rate-limit disclosure.** On their first run during C.1 both self-reported `SKIPPED — signup rate limit` (5 registrations / 15 min / IP), the limit having been exhausted by C.1's own scan tenants. Rather than accept a SKIP, the run was repeated after waiting for a genuine `201` from the registration endpoint:

```
=== rate limit cleared — re-running 97 and 98 ===
  97-enterprise-isolation-integrity        6 passed, 0 failed
  98-b25-control-honesty                   5 passed, 0 failed
```

Both are recorded as **PASS** on that evidence. A later confirmation attempt was rate-limited again (the re-run itself consumed the window) and returned SKIPPED; the passing run is the authoritative one because it executed only after the limiter released, against the same code now in the tree — no C.1 edit touches enterprise isolation or control-honesty code. **The SKIPPED observations were never counted as passes.**

The 93 pre-existing accessibility assertions (suites 25–28) all still pass, so no earlier accessibility recovery was undone.

---

## 8. Negative tests — the new gate provably fails

```
reintroduce dark fallback  -> FAILED: CustomerFirstRunWizard must not fall back to a
                                      hardcoded colour … 1.13:1 against AA's 4.5:1
remove label association   -> FAILED: PaymentsV2 must associate its existing visible
                                      label with #pv2-amount
disable 404 boundary       -> missing asset returned 401
                              FAILED: … must not return 401 — a MISSING FILE reported
                                      as an AUTH FAILURE
restored                   -> 10 passed, 0 failed
```

---

## 9. Constraint compliance

| Constraint | Status |
|---|---|
| `.env` not modified | **HELD** — 0 entries in `git status` |
| No test weakened | **HELD** — no existing test modified; one added |
| No authentication code altered | **HELD** |
| No broad codemod | **HELD** — 6 files, each edited deliberately |
| No merge, no push | **HELD** |
| No OS-track work | **HELD** |
| No fabricated screen-reader result | **HELD** — BLOCKED recorded |
| No SKIPPED counted as PASS | **HELD** — suites 97, 98 |
| No UNKNOWN converted to PASS | **HELD** — 82 tabs NOT MEASURED |
| Score not rounded upward | **HELD** — see certification |
