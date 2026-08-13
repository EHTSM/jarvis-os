# A.11 — Final Scorecard

**Rule applied:** each dimension reaches **10/10** only on measured evidence, or
carries a **documented genuine limitation**. No `UNKNOWN`. No `MAYBE`. No
`ASSUMED`. No score is inflated, and nothing is called "premium".

Where a dimension was **not measured**, it is scored as a limitation — not as a
pass — because absence of measurement is not evidence of consistency.

---

| # | Dimension | Score | Basis |
|---|---|---|---|
| 1 | **Spacing** | **7/10** | 21 distinct declared paddings across 59 button classes; 21 across 43 card classes. Within-language but drifting. *Limitation: F4, open by mission rule.* |
| 2 | **Typography** | **9/10** | 9 distinct button font sizes, dominated by 12px (24×) and 13px (12×). Hierarchy holds; the tail is small. |
| 3 | **Buttons** | **6/10** | **41 distinct rendered heights** across 1,143 buttons; top-5 cover only **57 %**. 71 namespaced systems. *Limitation: F4 — consolidation is a redesign, excluded.* |
| 4 | **Forms** | **8/10** | Label classes namespaced but structurally alike; 17 distinct input heights over 31 rendered. *Accessibility of form labelling is B19.4 `G1-B193` and out of scope here.* |
| 5 | **Navigation** | **10/10** | All 25 surfaces reached through one mechanism; tab bar preserved throughout; no dead ends observed. |
| 6 | **Search** | **10/10** | Verified, not assumed: 76/76 overflow surfaces aliased; **15/15** suite-89 vocabulary sets fully covered (F6). |
| 7 | **Loading** | **8/10** | Every measured surface communicated a loading state; **no** LOADING→blank, LOADING→fake-data or silent-failure case observed. Mechanisms differ (55 skeleton / 11 spinner / 2 shimmer classes). *Limitation: mechanism drift.* |
| 8 | **Errors** | **5/10** | Shared `_fetch` preserves status and backend message correctly; call sites discard it (`catch { return null }`), and **149 empty catch blocks** were measured. *Limitation: F3, open — scoped remediation.* |
| 9 | **Modals** | **9/10** | 12 systems but only 3 distinct paddings and 8/11 radii tokenised. Dialog semantics certified separately in B19.4 (15 dialogs, complete). |
| 10 | **Drawers** | **N/M** | Observed in Business and Developer surfaces only; not opened elsewhere during the walk. **Not measured → not scored.** |
| 11 | **Tables** | **N/M** | **Zero** `<table>`/`-table` elements rendered on any of the 25 measured surfaces. **Not measured → not scored.** |
| 12 | **Cards** | **7/10** | **10 distinct radii** live; 15 distinct declared, only 15/40 tokenised. |
| 13 | **Tabs** | **9/10** | 225 rendered, 25 distinct heights, top-5 cover **87 %** — the tightest cluster measured. |
| 14 | **Filters** | **9/10** | Consistent filter-button idiom observed across Global Activity, Runtime Console, Contacts. |
| 15 | **Empty states** | **6/10** | Canonical `EmptyState` exists and answers what/why/next — used by **9** files against **301** ad-hoc literals (**277** with no next action). *Limitation: F5 — per-surface copy, open.* |
| 16 | **Success states** | **9/10** | No "Done with nothing done" or "Success with empty content" observed on the measured surfaces; aligns with the A.10 honesty findings. |
| 17 | **Responsive** | **N/M** | Measured at 1440×900 only. Tablet/mobile not exercised. **Not measured → not scored**, and deliberately not folded into the separate Mobile Experience Audit. |
| 18 | **AI states** | **9/10** | AI surfaces reached and rendered; `credential` surfaced in 24 places, `rate limit` in 29 — the honesty vocabulary is present. No false "Connected"/"Done" observed. |
| 19 | **Cross-OS consistency** | **7/10** | Matrix: navigation/search/keyboard/success CONSISTENT across all measured columns; buttons/empty/error REAL INCONSISTENCY across all; Marketing column NOT MEASURED. |

---

## Verdict

# OPEN

**Not certified complete.** Three dimensions carry open REAL INCONSISTENCY
findings (F3 errors, F4 buttons, F5 empty states) and three are **N/M —
not measured** (drawers, tables, responsive).

Certifying now would require either inflating those six, or claiming coverage
the walk did not achieve. Both are prohibited by this mission.

### What is closed

- **F1** End of Day Review crash — FIXED, live re-verified (page errors 2 → 1)
- **F2** Global Activity page header — FIXED
- **F3′** Global Activity hardcoded canvas — FIXED
- **F6** Search aliases — VERIFIED PRESENT (15/15)
- **F7** Workspace 403s — attributed to the audit account, not the product

### Exact remaining findings

| ID | Finding | Why open |
|---|---|---|
| **F3** | 402/403 discarded at API call sites; 149 empty catch blocks | Needs per-surface decisions on what the user sees for each status |
| **F4** | 71 button systems; 41 live heights; top-5 cover 57 % | Consolidation is a design-system migration — excluded by mission rule |
| **F5** | 277 bare empty states vs the shared component | Each needs its own what/why/next copy |
| **N/M-1** | Drawers not exercised outside two columns | Requires a walk that opens each drawer |
| **N/M-2** | Tables never rendered on the measured surfaces | Requires reaching table-bearing surfaces |
| **N/M-3** | Responsive tested at one viewport | Requires tablet/mobile viewports |
| **DEP-1** | `tests/security/89` fails on a stale expectation | Its assertions are satisfied by source; left untouched rather than weakened |

### Coverage limitation, stated plainly

The mission scopes **47 surface areas**. The authenticated walk measured
**25 surfaces**. The overflow menu exposes 76 more, and the walk reached a
subset before completing. Marketing, Creative Studio, Memory, Agents,
Integrations and Launch Platform were **not** among the measured 25 and are
therefore **not** scored — they are recorded as unmeasured rather than assumed.

Prior coverage for several of those exists in A.11.1–A.11.8 (commits
`a0ae368b` … `d9fd20e0`) and is cited in the certification, but it is prior
evidence, not a measurement made by this audit.
