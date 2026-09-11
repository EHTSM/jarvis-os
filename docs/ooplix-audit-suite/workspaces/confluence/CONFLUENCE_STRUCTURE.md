# OOPLIX V1 — Confluence Space Structure

**Space key:** `OPXAUD` · **Space name:** Ooplix V1 Audit & Certification
**Space type:** Documentation · **Permissions:** restricted by default, see §Permissions

---

## Page tree

```
OPXAUD — Ooplix V1 Audit & Certification
│
├── 1. Evidence Integrity Statement           [read first — restricted from edit]
├── 2. Executive Summary
├── 3. Master Audit Register
│   ├── 3.1 Layer 1 — Foundation
│   ├── 3.2 Layer 2 — Engineering
│   ├── 3.3 Layer 3 — Intelligence
│   ├── 3.4 Layer 4 — Operations
│   └── 3.5 Layers 5–6 — Planned
├── 4. Audit Method & Standards
│   ├── 4.1 Six-step protocol
│   ├── 4.2 The four constraints
│   └── 4.3 Limitations of this method
├── 5. Findings Detail
│   ├── 5.1 Critical findings (17)
│   └── 5.2 High-severity findings
├── 6. Residual Gap Register
│   ├── 6.1 The three critical gaps
│   └── 6.2 Remediation programme R1–R3
├── 7. Scorecards & Maturity
├── 8. Roadmap to Certification
├── 9. Evidence Library
└── 10. Verification Guide
```

---

## Page templates

### Template: Audit Entry

Applied to every audit page for consistency.

```
{status:colour=Green|title=CERTIFIED}     ← or Yellow / Red / Grey per verdict
{info}Audit ID · Layer · Date of record · Evidence artifact{info}

h2. Scope
h2. Findings Summary
{table}  Severity | Count  {table}
h2. Headline Finding
h2. Detail
  h3. Reproduction
  h3. Measurement
  h3. Root cause
  h3. Recovery
  h3. Regression & reverification
h2. Residual Gaps
{children:page=Gap entries}
h2. Evidence
{jira:...} or artifact link
```

### Template: Gap Entry

```
{status:colour=Red|title=CRITICAL — OPEN}
{warning}This gap is recorded, not closed. Reason below.{warning}

h2. Measurement
h2. Reproduction
h2. Why this remains open
h2. Closing audit
h2. Remediation reference
```

---

## Macros

| Page | Macro | Configuration |
|---|---|---|
| 1. Evidence Integrity | `{panel}` | Border `#B00020`; states 31 executed / 7 planned |
| 2. Executive Summary | `{chart}` | Type `bar`, findings by layer |
| 3. Master Register | `{table-filter}` + `{table-excerpt}` | Filterable by Layer, Status, Verdict |
| 3.5 Planned | `{note}` | "No score, no findings, no evidence exists for these audits." |
| 6. Gap Register | `{table-filter}` | Default filter: Severity = CRITICAL |
| 7. Scorecards | `{chart}` | Type `radar` per scored audit |
| 8. Roadmap | `{roadmap}` | Executed lanes solid; planned lanes with no dates |
| All | `{page-info}` | Last modified, version — visible on every page |

**Critical macro rule.** On the register table, the `Score` column must render an em-dash for unscored rows, never `0`. Confluence's `{chart}` macro coerces empty numeric cells to zero — so scored charts must draw from a filtered table excerpt containing only the six scored audits.

---

## Labels

| Label | Applied to |
|---|---|
| `executed` | 31 audit pages |
| `planned` | 7 audit pages |
| `critical-gap` | 3 gap pages |
| `certified` / `certified-limited` / `not-certified` | By verdict |
| `layer-l1` … `layer-l6` | By layer |
| `evidence` | Evidence Library children |
| `diligence` | Pages included in the external-share set |

---

## Permissions

| Group | Space | Notes |
|---|---|---|
| Audit programme | Add / Edit / Delete | Owners of the record |
| Engineering | View + Comment | Cannot edit certification records |
| Executive | View + Comment | — |
| External diligence | View on `diligence`-labelled pages only | Time-boxed, per-engagement |

**Page restrictions.** Apply edit restriction to pages 1, 3, and 6 — the Evidence Integrity Statement, the Master Register, and the Gap Register. These function as certification records; an untracked edit voids their evidentiary value. Changes go through the change-control table on page 3, not through direct edits.

---

## Change control

Page 3 carries a mandatory change-control table:

| Version | Date | Change | Author | Approver |
|---|---|---|---|---|
| 1.0.0 | 2026-08-09 | Initial register | Audit Programme | — |

**Amendment rules, stated on the page:**
1. A PLANNED row moves to EXECUTED only with a committed certification document containing measured evidence.
2. Scores may never be added to a PLANNED row.
3. A NOT CERTIFIED verdict may not be revised without a new dated audit.
4. Gap closure requires a negative-tested regression, recorded in the gap entry.
