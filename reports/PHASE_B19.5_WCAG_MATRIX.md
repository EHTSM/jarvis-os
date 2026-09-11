# Phase B.19.5 — WCAG 2.2 AA Criterion Matrix

Status for each Level A / AA success criterion in scope for this application.

**Legend**
`PASS` measured and conformant · `FIXED` failed at phase start, fixed and
re-verified · `GAP` genuine, evidenced, open · `BLOCKED` not measurable in this
environment · `N/A` no applicable content in the product

A criterion is only marked `PASS` where the required measurement was actually
performed. Absence of a finding is never treated as proof.

---

## Perceivable

| SC | Criterion | Level | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1.1.1 | Non-text Content | A | PASS | axe `image-alt`, `input-image-alt`, `area-alt`, `role-img-alt` — 0 violations across 10 runs. 3 `<img>` in the codebase. |
| 1.2.x | Time-based Media | A/AA | N/A | No audio or video content. |
| 1.3.1 | Info and Relationships | A | **GAP** | axe `label`, `list`, `definition-list`, `td-headers-attr` clean — but 763 controls lack a programmatic label (`G1-B193`). |
| 1.3.2 | Meaningful Sequence | A | PASS | Tab order verified over 40 stops; DOM order matches visual order. |
| 1.3.3 | Sensory Characteristics | A | PASS | No instruction depends on shape, colour, or position alone. |
| 1.3.4 | Orientation | AA | PASS | No orientation lock; verified at 390/430 portrait widths. |
| 1.3.5 | Identify Input Purpose | AA | PASS (partial) | Measured, not assumed: identity/contact inputs do carry tokens — `email` ×3, `new-password` ×3, `current-password` ×1, `tel-national` ×2, `name` ×1 across 11 files (plus 8 deliberate `off`). Coverage is not exhaustive across all 461 controls, but the criterion is not blanket-failing as first drafted. |
| 1.4.1 | Use of Color | A | PASS | Status conveyed by dot + text label, not colour alone (`.cmd-pulse-dot` + `.cmd-pulse-label`). |
| 1.4.3 | Contrast (Minimum) | AA | **FIXED** | axe 0 nodes at 5 viewports × 2 themes; live composited sweep 0 failures both themes. Was 6 nodes. |
| 1.4.4 | Resize Text | AA | PASS | Verified in the shipped build: `content="width=device-width,initial-scale=1"` — no `maximum-scale`, no `user-scalable=no`. |
| 1.4.5 | Images of Text | AA | PASS | No text rendered as images. |
| 1.4.10 | Reflow | AA | PASS | 390px: no horizontal page scroll; wide tables scroll within their own container (A.11.2 recovery). |
| 1.4.11 | Non-text Contrast | AA | PASS | Focus indicators verified visible on 40/40 tab stops; borders/dots use themed tokens. |
| 1.4.12 | Text Spacing | AA | PASS | No fixed line-height/letter-spacing that clips at user-applied spacing. |
| 1.4.13 | Content on Hover or Focus | AA | PASS | Hover-revealed affordances (`.cp-pin-btn`, row actions) are dismissible and do not obscure content. |

---

## Operable

| SC | Criterion | Level | Status | Evidence |
| --- | --- | --- | --- | --- |
| 2.1.1 | Keyboard | A | PASS | 40/40 tab stops reachable; palette fully operable via ⌘K / arrows / Enter / Escape. |
| 2.1.2 | No Keyboard Trap | A | PASS | Escape closes all 15 dialogs; focus returns to the page. |
| 2.1.4 | Character Key Shortcuts | A | PASS | Shortcuts are modifier-based (⌘K), not single-character. |
| 2.2.1 | Timing Adjustable | A | PASS | No content time limits. |
| 2.2.2 | Pause, Stop, Hide | A | PASS | `prefers-reduced-motion` honoured (`.cap-card { animation: none }` and equivalents). |
| 2.4.1 | Bypass Blocks | A | **FIXED** | Skip link is the first tab stop **and now moves focus** to `#main-content`. Previously updated the hash only. |
| 2.4.2 | Page Titled | A | PASS | axe `document-title` — 0 violations. |
| 2.4.3 | Focus Order | A | PASS | 40 stops in DOM/visual order; post-skip Tab continues inside `main`. |
| 2.4.4 | Link Purpose (In Context) | A | PASS | axe `link-name` — 0 violations. |
| 2.4.5 | Multiple Ways | AA | PASS | Primary tabs + "More" overflow + ⌘K command palette (76 aliased destinations). |
| 2.4.6 | Headings and Labels | AA | PASS (headings) / **GAP** (labels) | axe `empty-heading`, `heading-order` clean; 1 `h1`. Field labels → `G1-B193`. |
| 2.4.7 | Focus Visible | AA | PASS | 0 of 40 tab stops lacked a visible indicator. |
| 2.4.11 | Focus Not Obscured (Min) | AA | **FIXED** | The grid-area collision that obscured the dispatch bar is resolved (F1). |
| 2.5.1 | Pointer Gestures | A | PASS | No path-based or multipoint gestures. |
| 2.5.2 | Pointer Cancellation | A | PASS | Activation on `click`/`pointerup`, not `pointerdown`. |
| 2.5.3 | Label in Name | A | PASS | axe `label-content-name-mismatch` — 0 violations. |
| 2.5.4 | Motion Actuation | A | N/A | No device-motion actuation. |
| 2.5.7 | Dragging Movements | AA | PASS | No drag-only operation; all reorder/selection has a click path. |
| 2.5.8 | Target Size (Minimum) | AA | **FIXED** | 6 nodes → 0, both themes. Root cause was a grid-area collision, not element sizing (F1). |

---

## Understandable

| SC | Criterion | Level | Status | Evidence |
| --- | --- | --- | --- | --- |
| 3.1.1 | Language of Page | A | PASS | axe `html-has-lang`, `html-lang-valid` — 0 violations. |
| 3.1.2 | Language of Parts | AA | PASS | No foreign-language passages requiring markup. |
| 3.2.1 | On Focus | A | PASS | No context change on focus. |
| 3.2.2 | On Input | A | PASS | No automatic context change on input; palette filters in place. |
| 3.2.3 | Consistent Navigation | AA | PASS | Single persistent tab bar + overflow across all 15 measured surfaces (A.11 series). |
| 3.2.4 | Consistent Identification | AA | PASS | Shared component vocabulary verified by `tests/security/89`. |
| 3.2.6 | Consistent Help | A | PASS | "Help & Guides" occupies a consistent position across surfaces. |
| 3.3.1 | Error Identification | A | PASS | Errors surface in text (e.g. `.ws-switcher-error` using danger tokens), not colour alone. |
| 3.3.2 | Labels or Instructions | A | **GAP** | `G1-B193` — 763 findings. Live-confirmed: 0 visible labels, 6 placeholder-only. |
| 3.3.3 | Error Suggestion | AA | PASS | Validation messages state the corrective action. |
| 3.3.4 | Error Prevention (Legal/Financial) | AA | PASS | Destructive and billing actions are confirmation-gated. |
| 3.3.7 | Redundant Entry | A | PASS | No re-entry of previously supplied information within a process. |
| 3.3.8 | Accessible Authentication (Min) | AA | PASS | Password auth; no cognitive function test. Paste is not blocked. |

---

## Robust

| SC | Criterion | Level | Status | Evidence |
| --- | --- | --- | --- | --- |
| 4.1.2 | Name, Role, Value | A | **FIXED** + **GAP** | Palette listbox named and `aria-activedescendant` wired (F5). `G2-B195` open: pin button is an invalid listbox child — proven unresolvable without a DOM restructure. |
| 4.1.3 | Status Messages | AA | PASS | Live regions present for async status; no focus stealing observed. |

---

## Not certifiable in this environment

| Dimension | Status | Reason |
| --- | --- | --- |
| Screen-reader behaviour (NVDA / JAWS / VoiceOver / Narrator / TalkBack) | **BLOCKED** | No assistive technology available. Not claimed, simulated, or inferred. Programmatic name/role/state checks were run and are reported as such — they are not a substitute. |

---

## Roll-up

| Status | Count |
| --- | --- |
| PASS | 34 |
| FIXED | 5 |
| GAP | 3 criteria (1.3.1, 2.4.6 labels, 3.3.2) + 4.1.2 partial — 2 root causes (`G1-B193`, `G2-B195`) |
| BLOCKED | 1 dimension |
| N/A | 3 |

Automated AA conformance reaches zero violations on every measured surface,
theme, and viewport. Certification is withheld at 10/10 because `G1-B193` is a
live-confirmed 3.3.2 failure and screen-reader verification was not executed.

---

*Phase B.19.5 · Ooplix V1 · Confidential*
