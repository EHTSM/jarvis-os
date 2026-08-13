# A.11.1 — Table Audit

**Method:** every `table`, `[class*="-table"]`, `[role="table"]` and
`[role="grid"]` rendered during the 81-surface authenticated walk was measured
in place; table implementations were then read in source.
A.11 marked tables `NOT MEASURED`; this closes that gap — and the closure is
mostly a negative result, reported as such.

---

## The headline measurement

Across **81 operated surfaces**, exactly **one** table rendered:

| Surface | Class | Width | Height |
|---|---|---:|---:|
| AI Orchestration | `.aud-table` | 844px | 34px |

Every other data-bearing surface in this product presents rows as **cards and
flex rows**, not tables. That is a deliberate and consistent product pattern —
it is not a gap.

---

## Declared table systems (source inventory)

| System | File | Notable |
|---|---|---|
| `.aud-table` | audit surface | the one rendered live |
| `.tw-perms-table` | `TeamWorkspace.css` | `min-width: 540px` |
| `.er-table` | `ExecutiveReports.css` | `min-width: 560px` |

Three declared table systems for a 47-surface product — not proliferation.

---

## Checklist

Assessed against the one table measured live plus the three declared systems.

| Property | Result | Evidence |
|---|---|---|
| Column alignment | CONSISTENT | single rendered table; declared systems all use `border-collapse: collapse` |
| Row height | **NOT MEASURED** | one table with a single 34px header row rendered; no multi-row body reached |
| Headers | CONSISTENT | all three declared systems style `th` distinctly |
| Sorting | **NOT MEASURED** | no sortable table reached |
| Filtering | **NOT MEASURED** | no filterable table reached |
| Pagination | **NOT MEASURED** | no paginated table reached |
| Empty state | **NOT MEASURED** | no table rendered its empty state |
| Loading state | **NOT MEASURED** | no table rendered its loading state |
| Error state | **NOT MEASURED** | no table rendered its error state |
| Overflow | **OPEN — see T1** | two systems carry a `min-width` above the mobile viewport |
| Responsive behaviour | **OPEN — see T1** | same |
| Action placement | **NOT MEASURED** | — |
| Typography | CONSISTENT | all three declared at `font-size: 13px` |
| Density | CONSISTENT | uniform `13px` / collapsed borders |
| Keyboard navigation | CERTIFIED ELSEWHERE | B19.4; `RuntimeDebugger` table rows recovered with `clickableProps` |

**Nine properties are NOT MEASURED.** They are reported as such rather than
scored, because a table that never rendered cannot be certified.

---

## Findings

### T1 — Two table systems declare a `min-width` wider than a phone — **OPEN**

**Measured, statically:**

```
components/TeamWorkspace.css:159   .tw-perms-table { … min-width: 540px; }
components/ExecutiveReports.css:49 .er-table       { … min-width: 560px; }
```

At the 430px and 390px viewports in the responsive audit, either table would
force horizontal overflow on its surface.

**Why it is OPEN and not fixed:**

1. **Neither table rendered during the walk**, so the overflow was never
   reproduced live. Fixing an unreproduced defect would be a source-inferred
   change — exactly what this audit's method forbids.
2. A `min-width` on a data table is often *correct* — the standard recovery is
   a horizontally scrolling wrapper, not removing the floor. Choosing between
   them requires seeing the real table with real columns.

**Exact next step:** reach Team Workspace permissions and Executive Reports with
a credential that populates them, measure at 390px, and if overflow reproduces,
apply the scroll-wrapper idiom already used by `.cmd-dispatch-chips` and
`.tabs` rather than altering the tables.

---

## Verdict

**Table consistency: MEASURED — the product barely uses tables.**

One table rendered across 81 surfaces; three systems declared; typography and
density consistent across all three. One OPEN finding (T1) recorded with its
exact reproduction gap.

**No table was redesigned.** The mission's rule — *separate functional bugs from
design-system differences, do not redesign tables wholesale* — was applied by
reporting rather than acting on an unreproduced defect.
