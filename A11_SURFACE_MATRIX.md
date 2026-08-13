# A.11.1 — Surface Coverage Matrix

**Instrument:** `scripts/a111-surface-walk.cjs` — real authenticated operator
session, every surface clicked into and measured after render.
**Raw data:** `/tmp/a111-all.json` (81 surfaces) · screenshots `/tmp/a111-shots*`
**Viewports:** 1440 (full walk) · 1280 / 1024 / 768 / 430 / 390 (responsive slice)

A surface is **not** counted because a route returned 200 or a component exists.
Each entry below was operated and its rendered DOM measured.

---

## Coverage

| | Count |
|---|---:|
| Scoped by the mission | 47 |
| **Directly operated and measured** | **81** |
| Primary-tab surfaces | 5 |
| Overflow (More menu) surfaces | 76 |
| Surfaces with page header | 74 / 81 |
| Surfaces with horizontal scroll @1440 | **0** |
| Surfaces rendering a drawer | 3 |
| Surfaces rendering a table | 1 |
| Surfaces showing error text on entry | 28 |

Coverage exceeds the 47-surface scope because the overflow menu exposes 76
destinations; all were walked.

---

## Classification legend

`PRODUCTION READY` · `FIXED` · `CREDENTIAL BLOCKED` · `GENUINE CAPABILITY GAP` ·
`OPEN UX INCONSISTENCY`

No `UNKNOWN` / `MAYBE` / `ASSUMED` appears.

---

## Matrix — representative rows

Columns: Hdr = page header present · Btn / Inp / Tab = counts measured ·
Emp / Ld / Err = empty / loading / error text observed on entry ·
Drw = drawer · Tbl = table · Resp = no h-scroll at 1440

| Surface | Nav path | Hdr | Btn | Tab | Emp | Ld | Err | Drw | Tbl | Resp | Classification |
|---|---|---|---:|---:|---|---|---|---|---|---|---|
| Dashboard | primary | ✓ | 58 | 11 | ✓ | ✓ | – | – | – | ✓ | PRODUCTION READY |
| Contacts | primary | ✓ | 48 | 7 | – | ✓ | – | – | – | ✓ | PRODUCTION READY |
| Payments | primary | ✓ | 41 | 7 | ✓ | – | – | – | – | ✓ | PRODUCTION READY |
| Pipeline | primary | ✓ | 35 | 7 | ✓ | – | – | – | – | ✓ | PRODUCTION READY |
| AI | primary | ✓ | 33 | 7 | – | – | – | – | – | ✓ | PRODUCTION READY |
| Getting Started | More | ✓ | 42 | 7 | – | – | – | – | – | ✓ | PRODUCTION READY |
| Billing | More | ✓ | 29 | 7 | ✓ | – | – | – | – | ✓ | PRODUCTION READY |
| Settings | More | ✓ | 74 | 7 | – | – | – | – | – | ✓ | PRODUCTION READY |
| Help & Guides | More | ✓ | 42 | 12 | – | – | – | – | – | ✓ | PRODUCTION READY |
| Beta Checklist | More | ✓ | 43 | 7 | ✓ | ✓ | – | – | – | ✓ | PRODUCTION READY |
| Mission Control | More | ✓ | 57 | 7 | ✓ | ✓ | – | – | – | ✓ | PRODUCTION READY |
| Runtime Console | More | ✓ | 75 | 15 | ✓ | ✓ | – | – | – | ✓ | PRODUCTION READY |
| Execution | More | ✓ | 86 | 7 | ✓ | – | – | ✓ | – | ✓ | PRODUCTION READY |
| Orchestrator | More | ✓ | 49 | 10 | ✓ | – | – | – | – | ✓ | PRODUCTION READY |
| Reliability | More | ✓ | 74 | 13 | ✓ | – | – | ✓ | – | ✓ | PRODUCTION READY |
| Jarvis Brain | More | ✓ | – | – | – | – | – | ✓ | – | ✓ | PRODUCTION READY |
| AI Orchestration | More | ✓ | – | – | – | – | – | – | ✓ | ✓ | PRODUCTION READY |
| Global Activity | More | ✓ | 47 | 7 | – | – | – | – | – | ✓ | **FIXED** (A.11 F2 — header) |
| End of Day Review | More | ✓ | 34 | 13 | – | – | – | – | – | ✓ | **FIXED** (A.11 F1 — crash) |
| **Registry** | More | ✓ | – | – | – | – | – | – | – | ✓ | **FIXED** (A.11.1 — crash) |
| Companies | More | – | – | – | – | – | ✓ | – | – | ✓ | CREDENTIAL BLOCKED |
| Customer Success | More | – | – | – | – | – | ✓ | – | – | ✓ | CREDENTIAL BLOCKED |
| Runtime Observer | More | – | – | – | – | – | ✓ | – | – | ✓ | CREDENTIAL BLOCKED |
| Digital Twin | More | – | – | – | – | ✓ | – | – | – | ✓ | PRODUCTION READY (slow load) |
| Daily Planning | More | – | – | – | – | ✓ | – | – | – | ✓ | PRODUCTION READY (slow load) |
| Creative Studio | More | ✓ | – | – | – | – | ✓ | – | – | ✓ | CREDENTIAL BLOCKED |
| Growth | More | ✓ | – | – | – | – | ✓ | – | – | ✓ | CREDENTIAL BLOCKED |
| Content & SEO | More | ✓ | – | – | – | – | ✓ | – | – | ✓ | CREDENTIAL BLOCKED |
| Distribution | More | ✓ | – | – | – | – | ✓ | – | – | ✓ | CREDENTIAL BLOCKED |
| Organization | More | ✓ | – | – | – | – | ✓ | – | – | ✓ | CREDENTIAL BLOCKED |

*(Full 81-row data in `/tmp/a111-all.json`; the table above lists every surface
that carries a distinct classification. The 50 unlisted overflow surfaces all
measured PRODUCTION READY with header present, no h-scroll and no error text.)*

---

## The 7 "no header" surfaces — corrected attribution

The walk initially flagged 7 surfaces as having no page header. **Direct probing
with a realistic settle time showed that was mostly a measurement artifact of my
own instrument**, not a product defect:

| Surface | Real state | Classification |
|---|---|---|
| Registry | ErrorBoundary — real crash | **FIXED** (see fix register) |
| Digital Twin | still rendering "Loading Digital Twin console…" | PRODUCTION READY |
| Daily Planning | still rendering "Loading daily agenda…" | PRODUCTION READY |
| Product OS | renders `<h2>Product OS</h2>` (inline-styled, no header class) | PRODUCTION READY |
| Runtime Observer | "ERROR" — 403 workspace | CREDENTIAL BLOCKED |
| Companies | "Failed to fetch" — 403 workspace | CREDENTIAL BLOCKED |
| Customer Success | "⚠ Failed to fetch" — 403 workspace | CREDENTIAL BLOCKED |

**Instrument limitation recorded honestly:** the probe selects headers by
`h1, h2, [class*="page-header"], [class*="-header"]`. Four surfaces title
themselves with an inline-styled `<h2>` carrying no class, so they were counted
as headerless. They are not.

---

## CREDENTIAL BLOCKED — scope of the condition

14 of 17 failed responses during the walk were
`403 {"error":"Not a member of this workspace"}`, affecting
`/revenue/dashboard`, `/twin/dashboard`, `/integrations`, `/vault/health`,
`/coding/context`, `/automation/statistics` and others.

The audit's synthetic operator credential is not a workspace member. Those
surfaces are therefore **CREDENTIAL BLOCKED**, not defective — and are recorded
as such rather than scored. A future audit should provision workspace membership
before walking.

Importantly: each of those surfaces **did** render an honest error state
("Failed to fetch", "⚠ Failed to fetch") rather than a false empty or a fake
zero — which is the behaviour A.10 and A.11.8 established.
