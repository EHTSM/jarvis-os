# A.11.1 — Empty State Register (F5)

**Instrument:** literal inventory across all JSX, classified A–E per the mission.
**Raw data:** `/tmp/a111-f5.json`

**Mission rule applied:** *do not replace all automatically; only category E
should be recovered; reuse the existing canonical EmptyState; do not create
another empty-state implementation.*

---

## Canonical component — verified present

`components/EmptyState.jsx` exists and answers all three questions the mission
requires, per variant:

```
what is this?          → title
why should I care?     → description
what should I do next? → steps[] + primaryAction
```

Example (`pipeline` variant), read from source:

> **"Your pipeline is empty"** — *"The pipeline tracks every lead from first
> contact to paid. Add a contact to start the loop…"* → 3 numbered next steps.

This is the pattern to reuse. Nothing new was created.

---

## Classification of 342 measured literals

| Cat | Meaning | Count | Action |
|---|---|---:|---|
| **A** | Genuine empty state that already names a next action | **55** | none — already meets the bar |
| **B** | Loading state | **0** | none |
| **C** | Error state | **0** | none — errors surface separately |
| **D** | Intentional inline microcopy, or a *success*-as-empty | **221** | none — see below |
| **E** | **Should use the canonical EmptyState** | **66** | recover |

**A.11's figure was 277 "bare" literals. That number was too blunt.** Refining
it against the mission's own A–E taxonomy shows only **66** are genuine
category-E candidates. The correction is recorded rather than carried forward.

### Why 221 are category D, not defects

Two distinct groups, both legitimate:

1. **Success-as-empty** — `"No issues found."`, `"No conflicts"`,
   `"No vulnerabilities"`. Emptiness is the *good* outcome; prompting a next
   action would be wrong.
2. **Inline microcopy ≤ 28 chars** — `"No data"`, `"No recent activity"` inside
   a table cell, a chart legend or a compact card. Rendering a full
   EmptyState block with steps and a CTA inside a 60px cell would be a
   regression, not an improvement.

---

## Category E — the recoverable 66

Distribution across files (top rows):

| Count | File |
|---:|---|
| 3 | `components/ContentSEO.jsx` |
| 3 | `components/EngineeringConsole.jsx` |
| 3 | `components/FounderJournal.jsx` |
| 3 | `components/operator/BrowserAutomationPanel.jsx` |
| 2 | `components/AutonomousOps.jsx` |
| 2 | `components/ExecutiveDashboard.jsx` |
| 2 | `components/JarvisBrainCenter.jsx` |
| 2 | `components/OperationsCenter.jsx` |
| … | spread thinly across ~40 further files |

---

## Verdict

# OPEN — CONTENT WORK, NOT PATTERN RECOVERY

### Why not recovered in this phase

`EmptyState` is **variant-driven**: each usage needs a `variant` entry carrying
a title, a description and 2–3 concrete next steps written for *that* surface.
The component cannot be applied mechanically — substituting it without authoring
those three fields would produce an empty shell that says less than the literal
it replaced.

That is authoring, not recovery. The mission's rule is explicit: only category E
should be recovered, **using the existing canonical component** — and doing so
honestly requires 66 pieces of surface-specific copy.

### Exact scope for the phase that takes it on

1. For each of the 66 sites, write a variant entry (title / desc / steps).
2. Replace the literal with `<EmptyState variant="…" onNavigate={…} />`.
3. Measure: canonical usage 9 files → target, bare category-E literals 66 → 0.
4. Regression: assert each new variant renders all three fields.

### Measured before/after for this phase

| Metric | Before | After |
|---|---:|---:|
| Canonical `EmptyState` importers | 9 | **9** (unchanged — nothing forced) |
| Category-E literals | 66 | **66** |
| Literals correctly reclassified out of "bare" | — | **211** (277 → 66) |

The only change this phase made to F5 is a **more honest count**.
