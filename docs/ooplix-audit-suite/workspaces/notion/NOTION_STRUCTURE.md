# OOPLIX V1 — Notion Workspace Structure

**Import path:** create the top-level page, then import `data/audit-register.json` into the Audit Register database via CSV export (`scripts/export-csv.js`).

---

## Page tree

```
🔷 Ooplix V1 — Audit & Certification
│
├── 📌 Start Here                          (page — read first)
├── 🗂️ Audit Register                      (database — 38 rows)
├── 🚨 Gap Register                        (database — 92 rows)
├── 📊 Executive Dashboard                 (page — linked views + charts)
├── 🧭 Method & Standards                  (page)
├── 🗺️ Roadmap                             (page — timeline views)
├── 📚 Evidence Library                    (database — 16 certifications + commits)
├── 📈 Scorecards                          (page)
└── 🔒 Diligence Room                      (page — external-share subtree)
```

---

## Database 1 — Audit Register

**38 rows.** 31 EXECUTED, 7 PLANNED.

| Property | Type | Configuration |
|---|---|---|
| `Audit ID` | Title | `A.1`, `B.14`, `C` |
| `Title` | Text | — |
| `Layer` | Select | L1 Foundation · L2 Engineering · L3 Intelligence · L4 Operations · L5 Vision · L6 Perfection |
| `Status` | Select | **EXECUTED** (green) · **PLANNED** (grey) |
| `Verdict` | Select | CERTIFIED (green) · CERTIFIED W/ LIMITATIONS (orange) · NOT CERTIFIED (red) · PLANNED (grey) |
| `Score` | Number | **Leave empty for unscored and planned audits.** Do not use 0. |
| `Date` | Date | Empty for planned |
| `Critical` / `High` / `Medium` / `Low` | Number | Empty for planned |
| `Total Findings` | Formula | `if(prop("Status") == "PLANNED", "", sum)` |
| `Headline` | Text | One-sentence finding |
| `Evidence` | Relation → Evidence Library | Empty for planned |
| `Gaps` | Relation → Gap Register | — |
| `Entry Criteria` | Text | Planned audits only |

**Critical property configuration:** `Score` must be a Number that stays *empty*, never zero. A zero renders as a real score in roll-ups and averages, which would silently corrupt every aggregate view.

### Views

| View | Type | Configuration |
|---|---|---|
| **Register** | Table | Group by Layer · sort Audit ID · default |
| **Executed only** | Table | Filter Status = EXECUTED · this is the diligence view |
| **Board by verdict** | Board | Group by Verdict |
| **Timeline** | Timeline | Date range · planned audits hidden (no date) |
| **Scored** | Table | Filter Score is not empty · sort Score ascending |
| **Planned** | Gallery | Filter Status = PLANNED · shows entry criteria |

> **Roll-up warning.** Any average over `Score` must filter `Score is not empty` first. Six of 31 executed rows carry a score; a naive average across all rows is meaningless.

---

## Database 2 — Gap Register

**92 rows.** Recorded but unclosed findings.

| Property | Type | Configuration |
|---|---|---|
| `Gap ID` | Title | `G1-B15` |
| `Phase` | Relation → Audit Register | — |
| `Severity` | Select | CRITICAL (red) · HIGH (orange) · MEDIUM (yellow) · LOW (grey) |
| `Title` | Text | — |
| `Measurement` | Text | The measured evidence |
| `Reason Open` | Text | **Required.** Why it was not closed |
| `Closes In` | Relation → Audit Register | Target audit |
| `Root Cause Group` | Select | Tenant ownership · Observability · API surface · Accessibility · Infrastructure |
| `Status` | Select | Open · In remediation · Closed · Verified |

### Views

| View | Type | Configuration |
|---|---|---|
| **Critical only** | Table | Filter Severity = CRITICAL · **the liability list** |
| **By root cause** | Board | Group by Root Cause Group — reveals the 3-gaps-1-cause structure |
| **Remediation** | Board | Group by Status |
| **By closing audit** | Table | Group by Closes In |

---

## Database 3 — Evidence Library

| Property | Type |
|---|---|
| `Artifact` | Title (`PHASE_B11_AGENT_CERTIFICATION.md`) |
| `Type` | Select — Certification · Commit · Test suite · Measurement |
| `Audit` | Relation → Audit Register |
| `Path` | URL / text |
| `Date` | Date |
| `Key measurements` | Text |

---

## Page — Start Here

Fixed content, in this order:

1. **Callout (blue):** "31 of 38 audits have been executed. The remaining 7 carry no score, no findings, and no evidence. Rows marked PLANNED are forecast only."
2. **Callout (red):** "3 residual CRITICAL gaps are open. They share one root cause. See Gap Register → Critical only."
3. Linked view: Audit Register → *Executed only*
4. Linked view: Gap Register → *Critical only*
5. Toggle: "How to verify any claim in this workspace"

---

## Page — Diligence Room

Subtree intended for external sharing. Share this page only — never the workspace root.

```
🔒 Diligence Room
├── Evidence Integrity Statement
├── Audit Register (linked view: Executed only, read-only)
├── Gap Register (linked view: all, read-only)
├── Method & Standards
├── Scorecards
└── Verification Instructions
```

**Sharing configuration:** publish-to-web off; per-guest access; comment permission only. Do not grant edit access to a register that functions as a certification record — an edited row destroys its evidentiary value.

---

## Synced blocks

| Block | Source of truth | Appears in |
|---|---|---|
| Evidence Integrity Statement | Start Here | Diligence Room, Executive Dashboard, Roadmap |
| Three Critical Gaps summary | Gap Register page | Start Here, Executive Dashboard, Diligence Room |
| Scored-audit table | Scorecards | Executive Dashboard, Diligence Room |

Use synced blocks rather than copies so a correction propagates. A stale duplicate of the gap summary is exactly the failure mode this suite exists to prevent.
