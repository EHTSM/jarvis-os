# A.11 — Cross-OS UX Consistency Matrix

**Source:** live authenticated walk, 25 reachable surfaces, 1,143 buttons,
225 tabs, 31 inputs measured. Raw data: `/tmp/a11-ux-full.json`,
screenshots `/tmp/a11-ux-shots`.

**Marks:** `CONSISTENT` · `MINOR DRIFT` · `REAL INCONSISTENCY` · `BROKEN` ·
`NOT MEASURED` (stated rather than guessed)

---

## Column mapping

The mission's column set is expressed in this product as the surface groups the
overflow menu actually uses. Mapping recorded so the matrix is checkable:

| Mission column | Measured surfaces |
|---|---|
| Business | Dashboard, Contacts, Payments, Pipeline, Billing, Reports |
| Marketing | *(reachable only via overflow; not in the 25 measured)* |
| Developer | Runtime Console, Execution, Orchestrator, Reliability, Operations |
| Enterprise | Settings, Overview, Analytics, System Health |
| AI | AI, Mission Control, End of Day Review |
| Communication | Global Activity, History |
| Hosting / Cloud | Mobile Platform, Workflow Automation |

---

## Matrix

| Row | Business | Developer | Enterprise | AI | Communication | Hosting/Cloud |
|---|---|---|---|---|---|---|
| **Navigation** | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT |
| **Page Header** | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | **BROKEN → FIXED** (F2) | CONSISTENT |
| **Create** | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | n/a | CONSISTENT |
| **Edit** | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | n/a | CONSISTENT |
| **Delete/Archive** | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | n/a | CONSISTENT |
| **Search** | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT |
| **Filter** | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT |
| **Loading** | MINOR DRIFT | MINOR DRIFT | MINOR DRIFT | MINOR DRIFT | MINOR DRIFT | MINOR DRIFT |
| **Empty** | REAL INCONSISTENCY (F5) | REAL INCONSISTENCY (F5) | REAL INCONSISTENCY (F5) | REAL INCONSISTENCY (F5) | REAL INCONSISTENCY (F5) | REAL INCONSISTENCY (F5) |
| **Error** | REAL INCONSISTENCY (F3) | REAL INCONSISTENCY (F3) | REAL INCONSISTENCY (F3) | REAL INCONSISTENCY (F3) | REAL INCONSISTENCY (F3) | REAL INCONSISTENCY (F3) |
| **Success** | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT |
| **Modal** | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | n/a | CONSISTENT |
| **Drawer** | CONSISTENT | CONSISTENT | NOT MEASURED | NOT MEASURED | n/a | NOT MEASURED |
| **Toast** | MINOR DRIFT | MINOR DRIFT | MINOR DRIFT | MINOR DRIFT | MINOR DRIFT | MINOR DRIFT |
| **Table** | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| **KPI** | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | n/a | CONSISTENT |
| **Tabs** | CONSISTENT | MINOR DRIFT | CONSISTENT | CONSISTENT | CONSISTENT | MINOR DRIFT |
| **Forms** | MINOR DRIFT | MINOR DRIFT | MINOR DRIFT | MINOR DRIFT | n/a | MINOR DRIFT |
| **Buttons** | REAL INCONSISTENCY (F4) | REAL INCONSISTENCY (F4) | REAL INCONSISTENCY (F4) | REAL INCONSISTENCY (F4) | REAL INCONSISTENCY (F4) | REAL INCONSISTENCY (F4) |
| **Keyboard** | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT |
| **Shortcuts** | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT |
| **Context switching** | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT | CONSISTENT |

---

## What each mark rests on

**CONSISTENT — Navigation / Context switching.** All 25 surfaces were reached
through the same primary-tab and overflow-menu mechanism, each rendered, and
each kept the tab bar. No dead ends encountered.

**CONSISTENT — Keyboard / Shortcuts.** Not re-audited here. Certified by
**B19.4** (keyboard findings 77 → 0; `tests/runtime/28` 14/14) and used as
evidence per the mission's audit-boundary rule.

**CONSISTENT — Search.** Verified, not assumed: 76/76 overflow surfaces carry
aliases; 15/15 of the vocabulary sets asserted by suite 89 are fully covered
(F6).

**MINOR DRIFT — Loading.** 55 skeleton classes, 11 spinner classes, 2 shimmer
classes and 211 `Loading…` literals coexist. Every measured surface *did*
communicate a loading state; the mechanisms differ. That is drift inside the
language, not a failure — no measured surface went LOADING → blank or
LOADING → fake data.

**MINOR DRIFT — Tabs / Forms / Toasts.** Tab heights cluster tightly (top-5
cover 87 %). Form label classes are namespaced but structurally alike. 34 toast
systems is high, but each surfaced its own state correctly where observed.

**REAL INCONSISTENCY — Buttons (F4).** 41 distinct rendered heights with the
dominant five covering only 57 %; 21 declared paddings across 59 classes.

**REAL INCONSISTENCY — Empty (F5) / Error (F3).** See the findings register.

**BROKEN → FIXED — Page Header (Communication).** Global Activity had no page
header; recovered from the SystemHealthDashboard pattern.

**NOT MEASURED — Tables.** Zero `<table>` / `-table` elements rendered on any of
the 25 measured surfaces; the data grids reached were card and row based. Marked
NOT MEASURED rather than CONSISTENT, because absence of measurement is not
evidence of consistency.

**NOT MEASURED — Drawer (Enterprise/AI/Cloud).** Drawers were observed in
Business and Developer surfaces only. The rest were not opened during the walk.

**n/a — Create/Edit/Delete on Communication.** Global Activity and History are
read-only feeds; the row does not apply.

---

## Marketing column

Marketing surfaces (Growth OS, Distribution, Content SEO, Creative Studio) sit
behind the overflow menu and were **not among the 25 surfaces the walk reached**
before the run completed. They are therefore **NOT MEASURED** in this matrix
rather than assumed consistent. Their prior coverage is A.11.3
(commit `20ccfdaf`).
