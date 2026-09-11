# A.11.1 — Button System Register (F4)

**Instruments:** static declaration inventory + JSX usage count
(`/tmp/a111-f4.json`) · live measurement of 1,143 rendered buttons across 25
authenticated surfaces.

**Mission rule applied:** *do not create a new Button component for this audit,
do not mass-codemod blindly, do not change visual design merely because two
specialised components differ.*

---

## Inventory summary

| Measure | Value |
|---|---:|
| Namespaced `-btn` class systems | **71** |
| …with explicit style declarations | **59** |
| …**actually used** in JSX | **58** |
| …**unused (0 JSX references)** | **1** |
| Distinct declared paddings | **21** |
| Distinct declared radii | **8** |
| Radii using a design token | **17 / 57** |
| Distinct rendered heights (live) | **41** across 1,143 buttons |
| Top-5 heights cover | **57 %** |

---

## Does a canonical system already exist?

**Yes.** `index.css` defines the unprefixed base component — `.btn`,
`.btn--primary`, `.btn--success`, `.btn--danger`, `.btn--sm`, `.btn--xs`, and a
`.btn:disabled` state that dims the *surface* rather than the label.

It was recovered in B19.2.2, where those classes were found applied in JSX but
**defined in no stylesheet at all** — so those buttons had been rendering with
user-agent styling.

The 71 namespaced systems predate it.

---

## Classification

### True duplicates → **none found mechanically safe to merge**

No two systems were found to be byte-identical in declaration *and* semantics.
The clustering is real but not duplicative: 21 paddings and 8 radii across 59
classes is drift, and drift is not duplication. Merging them requires deciding
which of the 21 paddings is correct per surface — a design decision, not a
recovery.

### Intentionally specialised → **the large majority**

Sampled evidence that the variance carries meaning rather than accident:

| System | Specialisation |
|---|---|
| `.cmd-chip` | horizontally scrolling dispatch chips, pill radius |
| `.pv2-btn--wa` | WhatsApp send action, brand-specific affordance |
| `.gaf-filter-btn` | activity-feed filter with an inline count badge |
| `.cv2-filter-btn` | contacts filter, active-state ring |
| `.dv2-btn--xs` | dense DevOps rows, deliberately 11px |
| `.op-send-btn--ready` | operator console readiness state |

These are not one design system fragmented — they are per-surface controls with
different jobs.

### Obsolete → **1**

| System | File | Evidence |
|---|---|---|
| `.fu-btn` | `components/PaymentPanel.css` | 0 JSX references |

### Actually used → **58 of 59**

The single highest-value finding of this inventory: **the systems are not dead
weight.** 98 % are live. Any consolidation touches shipping UI on 58 surfaces.

---

## Verdict

# GAP — DESIGN SYSTEM CONSOLIDATION

Classified as a gap, **not** pretended fixed.

### Why it is not fixed here

The mission forbids creating a new button component, mass-codemodding blindly,
and changing visual design because two specialised components differ. With 58 of
59 systems live and no mechanically-safe duplicates, every available action
would violate one of those rules.

### Exact migration scope, for the phase that does take it on

1. **Adopt `.btn` as the base** in `index.css` (already exists, no new system).
2. **Per-surface, not global:** 58 systems × their own variants. Each migration
   must preserve the specialisation in the table above.
3. **Sequence by risk:** start with the 12 systems that already reference
   `var(--radius-sm)` — they are closest to the canonical scale.
4. **Regression per surface:** the live button-height histogram
   (`scripts/a11-ux-consistency-scan.cjs`) gives a measurable target — drive the
   top-5 height coverage from 57 % upward, and treat any *increase* in distinct
   heights as a regression.
5. **Explicitly out of scope for consolidation:** `.cmd-chip`, `.pv2-btn--wa`,
   `.op-send-btn--ready` and the other specialised controls listed above.

### The one safe action available now

`.fu-btn` is dead code (0 references). It is left in place — removing it is a
cleanup with no UX consistency benefit, and this audit does not delete code it
was not asked to.
