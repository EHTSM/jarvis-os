# C.1 — ACCESSIBILITY DISCOVERY

Date: 2026-08-14 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched. No test weakened. No OS-track work.**

Companion documents: [Findings](C1-ACCESSIBILITY-FINDINGS.md) · [Recovery](C1-ACCESSIBILITY-RECOVERY.md) · [Evidence](C1-ACCESSIBILITY-EVIDENCE.md) · [Certification](C1-ACCESSIBILITY-CERTIFICATION.md)

---

## Method — and why the previous counts were wrong

B.19.3 and B.25 both measured accessibility by regex over `.jsx` **source**. That method is structurally unable to answer the question it was asked, in both directions:

- it **over-counts** — controls that never render (conditional branches, unused components) are counted as defects
- it **under-counts** — a control named by a wrapping `<label>` looks unlabelled in source but is correctly named in the DOM
- it **cannot see** the accessible name at all, which is computed by the browser from a precedence chain (`aria-labelledby` → `aria-label` → `label[for]` → wrapping label → `title` → …)

C.1 therefore measured the **live rendered DOM in a real browser**, asking the browser for each control's computed accessible name, and ran **axe-core 4.13.0** against `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`.

Both tools were already in the repo (`axe-core`, `playwright`). Nothing was installed.

---

## What the discovery actually found first: the app would not load

The first scan returned `focusable=0` on every route. An application with zero focusable elements is impossible, so this was treated as a broken measurement, not a result.

Root cause was a real production defect (**C1-D1**), not a test artifact:

```
Refused to execute script from 'http://localhost:5050/static/js/main.<hash>.js'
because its MIME type ('application/json') is not executable
GET /static/js/main.<hash>.js -> 401 {"error":"Unauthorized"}
```

`express.static` calls `next()` when an asset is missing, so the request continued into the API stack and returned **401 Unauthorized** — a *missing file* reported as an *auth failure*.

A second defect (**C1-D4**) sat underneath it: the server cached `index.html` for the process lifetime, so after a rebuild it served HTML referencing deleted content-hashed bundles.

**Neither could be found by source analysis.** Both were found only because the audit tried to actually use the product.

---

## Correcting the measurement target

The initial harness navigated to `/dashboard`, `/crm`, `/business` etc. Those are **API prefixes, not frontend routes** — Ooplix has no URL router. `App.jsx` renders everything at `/` and switches panes by in-app tab state.

```
/dashboard -> 401 (an API prefix)
App.jsx    -> no BrowserRouter, no <Route>
```

The corrected harness logs in through the real signup + login flow and drives the actual tabs. A further correction was needed: the first-run onboarding modal blocks pointer interaction, so tab clicks silently did nothing until it was dismissed the way a user would.

**Three measurement corrections were required before any number in this report could be trusted.**

---

## Surface measured

| Dimension | Coverage |
|---|---|
| Themes | **dark** and **light** |
| Viewports | 390 px (mobile), 768 px (tablet), 1440 px (desktop) |
| Tabs | Dashboard, Contacts, Payments, Pipeline, AI (the 5 primary tabs) |
| Automated ruleset | axe-core 4.13.0 — `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` |
| Keyboard | Tab, Shift+Tab, Enter/Space, Escape, focus trap, focus visibility |
| Screen readers | availability checked — **not** simulated |

---

## Baseline inventory (live DOM, before fixes)

| Measure | Value |
|---|---:|
| Focusable elements per tab | 38–54 |
| Visible form controls (5 primary tabs) | 36 |
| Controls with a real accessible name | 8 |
| **Controls with placeholder only or no name** | **28 occurrences / 7 distinct** |
| axe violations — dark | 0 |
| **axe violations — light** | **17 nodes (all `color-contrast`)** |
| Dialogs detected | 1 (command palette) |

The 7 distinct unnamed controls:

```
[Contacts] input  placeholder "Search by name, phone, service…"
[Payments] input  placeholder "Search contacts…"
[Payments] input  placeholder "15000"
[Payments] input  placeholder "Website redesign — 50% advance"
[Payments] input  placeholder "+91-9876543210"
[Payments] textarea placeholder "Type a message or choose a template above…"
[AI]       input  placeholder "Message Ooplix, or type a command…"
```

**Five of these already had visible `<label>` text that was simply never associated with the control.** That is the single most important discovery in C.1 — the labels were already written by a human; only the `htmlFor`/`id` link was missing. No label had to be invented.

---

## Source-level inventory (for the unmeasured surface)

The 5 primary tabs are not the whole product — 82 further tabs exist behind "More". Those were **not** reached by the live scan, so their controls remain **NOT MEASURED**. Source analysis gives a bound, not a verdict:

```
components scanned              : 252
form controls in source         : 834
  aria-label / labelledby / title:   4
  wrapped in <label> (named in DOM): 39   <- invisible to earlier regex counts
  genuinely bare                 : 791

worst files: EnterpriseOS 67 · GrowthOS 52 · ContentSEO 40 · DeveloperOS 39
             BusinessOS 38 · DistributionOS 37 · UserSuccess 37
```

**Reconciling the historical numbers:** B.19.3 reported 763, B.25 reported 829, this pass finds 791 bare in source. These are the same defect measured three ways; the differences are regex scope (self-closing tags, wrapping labels), not regression or improvement. **None of the three is a live measurement**, which is why C.1 replaced the method rather than the number.

---

## Screen-reader availability

| Reader | Platform | Status |
|---|---|---|
| VoiceOver | macOS (this host) | present, **NOT running** — not launched |
| NVDA | Windows only | **NOT AVAILABLE** |
| Narrator | Windows only | **NOT AVAILABLE** |
| TalkBack | Android device/emulator | **NOT AVAILABLE** — no device attached |

Launching VoiceOver would seize audio and keyboard control of the user's live desktop. The mission explicitly forbids doing so without confirming safety, so it was not launched.

**Screen-reader certification is BLOCKED, not failed, and is not simulated anywhere in this report.** No screen-reader PASS is claimed from DOM inspection.
