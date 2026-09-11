# Phase B.19.5 — Live Evidence

Raw measurements from the running, authenticated application. Every figure in
the certification report traces to a run recorded here.

---

## Validity gate

Both scanners refuse to report a result from an unauthenticated session:

```js
const authed = await page.evaluate(() => !document.querySelector('.app-auth-gate, .auth-card'));
if (!authed) {
  console.error('INVALID RUN — never authenticated. A zero here would describe the login screen.');
  process.exit(2);
}
```

The live contrast scanner additionally requires the app shell to have rendered
(`elementsSeen > 1000`) — the marketing landing page has no password field
either, so "no password field visible" is not proof of authentication.

**Every run below reports `authed=true`.** An earlier phase established that a
build without `REACT_APP_API_URL` silently breaks auth and invalidates all
measurements; the build under test was produced with it set.

---

## 1. axe-core AA gate — final state

Configuration: axe-core 4.13.0, `runOnly` tags
`wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`. Best-practice rules excluded so
they cannot inflate or deflate the AA verdict.

### 1440 × both themes (15 surfaces)

```
theme=dark  viewport=1440 surfaces=15 authed=true
AA violations: 0 distinct rules, 0 nodes

theme=light viewport=1440 surfaces=15 authed=true
AA violations: 0 distinct rules, 0 nodes
```

### Responsive sweep (11 surfaces each)

```
390   dark   theme=dark  viewport=390  surfaces=11 authed=true  AA violations: 0 distinct rules, 0 nodes
390   light  theme=light viewport=390  surfaces=11 authed=true  AA violations: 0 distinct rules, 0 nodes
430   dark   theme=dark  viewport=430  surfaces=11 authed=true  AA violations: 0 distinct rules, 0 nodes
430   light  theme=light viewport=430  surfaces=11 authed=true  AA violations: 0 distinct rules, 0 nodes
768   dark   theme=dark  viewport=768  surfaces=11 authed=true  AA violations: 0 distinct rules, 0 nodes
768   light  theme=light viewport=768  surfaces=11 authed=true  AA violations: 0 distinct rules, 0 nodes
1024  dark   theme=dark  viewport=1024 surfaces=11 authed=true  AA violations: 0 distinct rules, 0 nodes
1024  light  theme=light viewport=1024 surfaces=11 authed=true  AA violations: 0 distinct rules, 0 nodes
1440  dark   theme=dark  viewport=1440 surfaces=11 authed=true  AA violations: 0 distinct rules, 0 nodes
1440  light  theme=light viewport=1440 surfaces=11 authed=true  AA violations: 0 distinct rules, 0 nodes
```

**Surfaces measured (dark 1440), 4,760 cumulative DOM nodes:**
Dashboard · Contacts · Payments · Pipeline · AI · Getting Started · Billing ·
Settings · Help & Guides · Beta Checklist · Overview · Workflow Automation ·
Analytics · History · Reports

---

## 2. Live composited contrast sweep — final state

```
dark:  0 failures | tabs walked 8 | cumulative DOM 3042 els, 1425 text nodes | authed=true
light: 0 failures | tabs walked 8 | cumulative DOM 3050 els, 1425 text nodes | authed=true

TOTAL live contrast failures: 0
```

This scanner is the contrast authority: it walks the real rendered DOM,
composites the actual ancestor backdrop stack (alpha *and* element opacity,
accumulated multiplicatively up the chain), and applies the large-text
threshold by measured font size and weight.

---

## 3. Negative test — detection is not weakened

`settle()` was added to stop the scanner measuring mid-animation. Because that
change *removes* findings, it was proven not to blind the scanner. A 1.4:1
defect injected into the shipped build:

```
=== clean run ===
dark:  0 failures | authed=true
light: 0 failures | authed=true
TOTAL live contrast failures: 0

=== negative test: inject a 1.6:1 defect ===
dark:  1 failures | authed=true
   1.4:1 (need 4.5) [initial] span.cmd-pulse-label  "Runtime"  rgb(42, 49, 66) on rgb(17,21,31)
TOTAL live contrast failures: 1
```

Build restored from backup after the test.

---

## 4. Target-size root cause — how it was actually found

axe reports the rule and a truncated selector. Two CSS-inspection guesses were
wrong. A DOM probe was written to ask the page directly.

**Step 1 — axe's real message** (the elements were already ≥24px):

```
[target-size] 763x42 input.cmd-dispatch-input
   Target has insufficient size because it is partially obscured
   (smallest space is 763.3px by 6px, should be at least 24px)
[target-size] 93x24 button.cmd-chip "Health check"
   (smallest space is 92.7px by 8px, should be at least 24px)
```

**Step 2 — first hypothesis (off-screen) tested and rejected.** The elements sat
at y=1490/1543, below the fold. Scrolling them into view (y=429/482 in a 900px
viewport) did **not** clear the violation:

```
after scrollIntoView: {"input":[763,42,429],"chip":[93,24,482],"vh":900}
axe after scroll: target-size x6
```

**Step 3 — overlap probe named the cause:**

```
.cmd-dispatch-input  763x42 @y 429
    OVERLAP 251x24  section.cmd-panel.cmd-col-dispatch > div.mt-root > div.mt-grid > button.mt-card
    OVERLAP 299x24  section.cmd-panel.cmd-col-dispatch > div.mt-root > div.mt-grid > button.mt-card
    OVERLAP 201x24  section.cmd-panel.cmd-col-dispatch > div.mt-root > div.mt-grid > button.mt-card
.cmd-chip  93x24 @y 482
    OVERLAP 93x16   section.cmd-panel.cmd-col-dispatch > div.mt-root > div.mt-grid > button.mt-card
```

Two sibling panels both carried `cmd-col-dispatch` → both claimed
`grid-area: dispatch` → Grid stacked them.

---

## 4a. Critical user journeys

Run end to end against the live authenticated app, with axe executed at every
step — a journey passes only if it completes *and* leaves no AA violation.

```
valid session: {"authed":true,"tabs":6}

PASS  | AA 0  | A. Authenticate via the real login form
PASS  | AA 0  | B. Bypass nav via skip link (keyboard only)
PASS  | AA 0  | C. Palette open/search/arrow (active option announced)
PASS  | AA 0  | D. Execute palette command (navigates, dialog closes)
PASS  | AA 0  | E. Switch to light theme in place
PASS  | AA 0  | F. Dismiss dialog with Escape
```

### The journeys found a defect the surface sweep could not

The first run of this sequence reported:

```
PASS | AA nodes   1 | C. Palette open/search/arrow
PASS | AA nodes  18 | D. Execute palette command
PASS | AA nodes  18 | E. Switch to light theme
PASS | AA nodes  18 | F. Dismiss dialog with Escape
```

Tracing it showed the palette's ArrowDown selects **Runtime Observer**, not
Settings — a surface the tab walk never visits:

```
palette selected: ◉Runtime Observer
[color-contrast] n=19  foreground #555555, background #0d0d0d, ratio 2.6, 11px
```

That is finding F7. Direct navigation to Settings measured 0, which is why only
the journey path surfaced it.

### An invalid journey run was caught and discarded

An earlier attempt reported six results from a page that had never
authenticated — the exact false-pass the validity gate exists to prevent:

```
FAIL  | AA nodes   0 | A. Authenticate
FAIL  | AA nodes   0 | B. Bypass nav via skip link
PASS  | AA nodes   0 | D. Execute palette command      ← measured on a dead page
```

Root cause: the static server had stopped, so the app never rendered
(`els=93`). The gate was tightened to require the app **shell** (≥5 primary tabs
and the skip target), the server was restarted, and the run repeated. The
discarded results are not reported anywhere as measurements.

---

## 5. Keyboard gate

```
tab stops reached: 40 | without visible focus indicator: 0
skip link: {"found":true,"text":"Skip to content","href":"#main-content"}
landmarks: {"main":1,"nav":2,"banner":1,"h1":1}
```

### Skip link — before and after

```
BEFORE
  skip target:      {"targetExists":true,"targetTag":"MAIN","tabindex":null}
  first tab stop:   {"cls":"skip-link","text":"Skip to content"}
  after activating: {"id":"","tag":"BODY","hash":"#main-content"}   ← focus never moved

AFTER
  after skip:       {"id":"main-content","tag":"MAIN"}
  next tab stop:    {"cls":"cmd-pulse-refresh","insideMain":true}
```

---

## 6. Dialogs

Live, both themes — command palette opened via ⌘K:

```
dark   palette={"open":true,"role":"dialog","modal":"true","label":"Command palette",
                "focusInside":true,"active":"INPUT.cp-input","overlayHidden":false}
       escapeCloses=true
light  palette={"open":true,"role":"dialog","modal":"true","label":"Command palette",
                "focusInside":true,"active":"INPUT.cp-input","overlayHidden":false}
       escapeCloses=true
```

`overlayHidden: false` is the regression check on `overlayProps()`, which
previously set `aria-hidden="true"` on the overlay — and because every modal
nests its panel *inside* the overlay, that would have hidden all 15 dialogs from
assistive technology.

Static inventory across the codebase:

```
dialogs: 15 across 13 files
  missing aria-modal: 0
  no Escape handling: 0
  unlabelled:         0
```

### Palette `aria-activedescendant` — after two ArrowDowns

```
{"activedescendant":"cp-opt-10","resolves":true,"text":"⬡Execution Engine","selected":"true"}
```

The id resolves to a real element that carries `aria-selected="true"` — the
announcement path is wired, not merely declared.

---

## 7. Form labelling — live confirmation of `G1-B193`

Static scan totals:

```
findings: 763   P0: 763   P1: 0   P2: 0
  518 FORM-PLACEHOLDER-ONLY
  245 FORM-UNLABELED
inventory: 258 files, 1949 buttons, 532 inputs, 193 selects, 99 textareas,
           17 forms, 15 dialogs, 199 labels
```

Live accessible-name source for every form control rendered across the
reachable surfaces:

```
{ "total": 9, "visibleLabel": 0, "ariaLabel": 3, "ariaLabelledby": 0,
  "titleOnly": 0, "placeholderOnly": 6, "none": 0 }
```

This reconciles the two instruments: axe reports 0 for its `label` rule because
it accepts a `placeholder` as an accessible name. WCAG 3.3.2 does not — a label
that disappears on input is not a label. **The gap is real and live-confirmed,
and the static scanner is not over-reporting.**

---

## 8. `G2-B195` — every alternative tested, not reasoned about

Each candidate structure was run through axe directly:

```
A: pin INSIDE option                  -> nested-interactive
B: presentation row, pin sibling      -> aria-required-children
C: pin sibling directly in group      -> aria-required-children
D: pin OUTSIDE listbox                -> CLEAN
```

Only D conforms, and it requires a DOM/layout restructure of the palette —
outside a recovery-only mandate. Recorded OPEN with the verified remedy.

---

## 9. Known page error (not a regression)

```
dark:  ["Not a member of this workspace"]
light: ["Not a member of this workspace"]
```

A backend authorization response for the operator credential against a
workspace it does not belong to. Present in prior phases' runs.

---

*Phase B.19.5 · Ooplix V1 · Confidential*
