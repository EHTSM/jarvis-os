# C.2 — UX DISCOVERY

Date: 2026-08-14 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched. No test weakened. No OS-track work.**

Companion documents: [Findings](C2-UX-FINDINGS.md) · [Recovery](C2-UX-RECOVERY.md) · [Evidence](C2-UX-EVIDENCE.md) · [Certification](C2-UX-CERTIFICATION.md)

---

## Prior evidence read first

The mission required reading prior UX evidence before measuring. There are **no `A.11*` report files on disk** — that phase's findings live entirely as executable regression suites:

| Suite | Phase | Assertions |
|---|---|---:|
| `82-founder-dashboard-ux-consistency…` | A.11.1 | 22 |
| `83-crm-sales-ux-consistency…` | A.11.2 | 33 |
| `84-marketing-growth-creative-ux-consistency…` | A.11.3 | — |
| `85-engineering-ai-runtime-ux-consistency…` | A.11.4 | — |
| `86-enterprise-org-billing-ux-consistency…` | A.11.5 | 40 |
| `87-reports-executive-ux-consistency…` | A.11.6 | — |
| `88-launch-integrations-support…` | A.11.7 | — |
| `89-cross-product-ux-consistency-sweep` | A.11.8 | static + live |

That is the real prior evidence, and it is **stronger** than a report: A.11 fixed its findings and locked each one behind a test. C.2's job was therefore to measure **new ground**, not restate A.11.

**One A.11 guard was already failing when C.2 started — see C2-05.**

---

## Method

Measured the **real authenticated production SPA** on `:5050`, driving actual clicks in Chromium. No screenshots as primary evidence; no invented user-testing numbers.

Three harness facts carried over from C.1, without which nothing measures correctly:

1. **Ooplix has no URL router.** Everything renders at `/` and switches by in-app tab state; `/dashboard`, `/crm` etc. are **API prefixes** that return 401.
2. **The first-run wizard blocks pointer interaction** — every click silently does nothing until it is dismissed as a user would.
3. **Signup is rate-limited** (5 / 15 min / IP) and *polling to detect when the window clears consumes a slot each probe*, so a naive wait loop starves itself. C.2 logs in with one fixed account instead.

---

## Surfaces measured

| # | Surface | Measured |
|---|---|---|
| 1 | Global shell | ✔ tabs, skip link, org switcher |
| 2 | Primary navigation | ✔ 5 tabs, timing + state per tab |
| 3 | More/overflow navigation | ✔ 83 items, search, clipping |
| 4 | Search (More menu) | ✔ filters to 15 on "enterprise" |
| 5 | Command palette | ✔ open, focus trap, search, empty state, Escape |
| 6 | Page headers | ✔ per-tab heading present |
| 7–10 | Buttons / forms / inputs / selects | ✔ via journeys + C.1 name audit |
| 13 | Empty states | ✔ counted per tab |
| 14 | Loading states | ✔ **infinite skeleton found** |
| 15 | Error states | ✔ **two fake-success defects found** |
| 16 | Success states | ✔ validated against real backend failures |
| 18 | Dialogs | ✔ palette + ConfirmDialog |
| 25–26 | Confirmation / destructive actions | ✔ **one unconfirmed irreversible action found** |
| 32 | Responsive behaviour | ✔ 390 / 430 / 768 / 1024 / 1440 |
| 33–34 | Dark / light theme | ✔ both, axe-verified |
| 35–36 | Keyboard / focus continuity | ✔ (C.1 baseline re-confirmed) |
| 40 | Perceived performance | ✔ nav, palette open, validation |

**Not measured:** drawers, sidebars, tooltips, tables at scale, multi-step workflows, workspace/tenant switching under load, toasts across all surfaces, back/cancel across every flow, and the **82 "More" tabs' internal UX**. These are recorded as NOT MEASURED, not as passes.

---

## Baseline measurements

### Navigation and shell

```
tabs: Dashboard · Contacts · Payments · Pipeline · AI · More (82) ▾
skip link: present    org switcher: present

           nav ms   spinners  empty  errors  focusable
Dashboard    947       0        5       0       36
Contacts     942       0        0       0       52
Payments     933       0        4       0       49
Pipeline     938      33 ←      0       0       36
AI           957       0        0       0       36
```

`Pipeline` showing **33 skeletons with 0 empty states** was the signal that led to C2-04.

### Command palette

```
open:            253 ms (later 66 ms warm) · focus trapped inside dialog · 93 actions
search "payments": 2 results, first = "Payments"
search "zzzznotathing": 0 results, honest empty state
                  "No commands found for \"zzzznotathing\""
Escape:          closes
```

### More menu

```
items: 83 · has search: yes · overflow clipped: false
search "enterprise" -> 15 visible
```

### Validation

```
Payments · submit empty form -> "Enter a valid amount."
inline error, 0 misleading toasts, 1,223 ms
```

### Responsive

```
 390px  h-scroll: true   overflow 204px  offscreen controls: 5
 430px  h-scroll: true   overflow 164px  offscreen controls: 5
 768px  h-scroll: false  overflow   0    offscreen controls: 0
1024px  h-scroll: false  overflow   0    offscreen controls: 0
1440px  h-scroll: false  overflow   0    offscreen controls: 0
```

---

## Design-system inventory

```
CSS files scanned: 196

border-radius : 83 distinct values
   410x var(--radius-sm) · 276x 4px · 267x var(--radius-pill) · 257x 50%
   219x 3px · 198x 8px · 198x var(--radius) · 158x 5px · 153x 6px

font-size     : 35 distinct px values
   1219x 11px · 1014x 12px · 936x 10px · 750x 13px · 436x 9px · 255x 14px
   150x 13.5px · 146x 12.5px · 142x 11.5px

explicit height: 71 distinct px values
```

Tokens (`--radius-sm`, `--radius-pill`, `--radius`) coexist with literals throughout. **Consolidating this is a broad design decision, not an audit fix** — classified as a DESIGN-SYSTEM MIGRATION GAP and deliberately not forced, per the mission.

---

## State-coverage inventory

```
data-fetching components        : 114
  without any error handling    :   0   ← the strongest result in C.2
  without any loading indicator :  11
  without any empty-state signal:  24
```

**0 of 114 components lack error handling.** That reflects the A.11 and B-phase work holding.

---

## Interaction-consistency inventory

Action vocabulary across all components:

```
CANCEL   68x "Cancel"    ·  2x "cancel"  ·  1x "✕ Cancel"
BACK     27x "← Back"    ·  2x "← Back to sign in"  · 1x "Back" · …
RETRY    20x "Retry"     ·  2x "retry"   ·  1x "Retry →"
DELETE    7x "Delete"    ·  4x "Remove"
CLOSE     4x "Close"     ·  2x "✕ Close" ·  1x "Close Review"
SAVE      6x "Save"      + 7 contextual variants ("Save draft", "Save preferences")
```

One dominant label per action, with variants that are contextually meaningful. Per the mission's rule — *"Do not change merely because two implementations differ"* — these are **INCONSISTENT BUT HARMLESS**, not defects, and were left alone.

---

## Destructive-action inventory

```
DELETE calls with no nearby confirmation: 1 of ~12
   WorkspaceSettingsK2.jsx:264  (API token revocation)
```

A.11.8's destructive-confirmation recovery is holding everywhere else. The single exception became **C2-03**.
