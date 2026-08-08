# Phase A.11.6 — Reports + Executive + Analytics UX Consistency Certification

**Product:** Ooplix (repo: `/Users/ehtsm/jarvis-os`, branch `security/reality-completion`)
**Method:** Real browser (Playwright/Chromium, `node <script>.js` from repo root), a real authenticated founder account, real clicks, real `getComputedStyle()` measurement, real transport-layer network failure injection (`page.route(...).abort("failed")`), real backend cross-checks, real screenshots. Code was read only after real, observed behaviour prompted a consistency check, then cross-checked against a reference instance elsewhere in the codebase, per Reproduce→Measure→RootCause→Recover→Regression→Reverify. **The real backend route AND middleware were read before anything was called a bug** — and in this phase that reading is what turned a suspected "unknown value" into a provable **false claim**.
**Session:** reused A.11.5's `scratchpad/a11-ux-consistency/a115/a115_auth.json` (`jarvis_auth` for `a115audit1786180626618@ooplixtest.com`, `exp` 2026-08-08T17:18:09Z). JWT verified structurally unexpired **and** verified live against the real backend: `GET /auth/me` → `{"success":true,...}`. **No fresh signup was performed, so the 5/15min/IP registration rate limiter was never touched.**
**Environment:** frontend `http://localhost:3000`, backend `http://localhost:5050`, both already running (verified via `lsof -iTCP -sTCP:LISTEN -P`). **No backend restart was performed by this sub-phase** — all four fixes are frontend-side, so none required one. One real transient was hit and handled honestly: a `GET /health` call returned an empty body mid-run and recovered on the first retry (5.0s round-trip), consistent with this environment's documented background load; `/health` round-trips measured 0.004s–5.05s across the phase.
**Scope operated:** ReportsV2 (KPI cards, Pipeline Breakdown, Automation Summary, System Performance, Service Health, Export, Refresh), AnalyticsCenter (**all 6 sub-tabs**: Executive, Workspace Health, Automation ROI, AI Usage, Runtime Capacity, Enterprise Report), Executive Dash, Executive Loop, Executive OS (L6), the Finance/Billing search path, and `ExecutiveReports.jsx` (verified, deliberately not recovered).

---

## Summary

**4 genuine inconsistencies found and fixed.** **3 real, measured findings documented but correctly left unfixed** (UNKNOWN / out of recovery scope).

The headline finding is not a styling drift. It is an **AI-honesty violation established by reading the real backend middleware**, and it is the highest-value class the mission named for this scope:

> `GET /ops`, `GET /stats` and `GET /metrics` are `operatorOnly` server-side
> (`backend/routes/ops.js` line 74). Measured live with a real founder session:
> **all three return 403.**
>
> Reports nevertheless rendered, as statements of fact:
> **"WhatsApp — Not set up"**, **"Payments — Not configured"**, **"Tasks completed 0 / All healthy"**.
>
> The real, unauthenticated `GET /health` on that same running backend returned
> **`{"ai":false,"telegram":true,"whatsapp":true,"payments":true}`**.
>
> Two of those claims were therefore **not merely unknown — they were FALSE**,
> shown with a warning-coloured dot, on every single load, to every founder.

Separately, and proven by aborting the real request at the transport layer: a **total failure** of the one fetch every KPI card depends on rendered **"TOTAL LEADS 0 / CLOSE RATE 0% / 0 leads tracked"** with **no error banner at all** (`errorBanner === null`), plus the copy *"No lead data yet. Add contacts to see pipeline distribution."* — i.e. the page actively told a founder whose data had just failed to load that their pipeline was empty, and instructed them to fix it.

Stated plainly, because the mission asks for honesty over manufactured findings: **most of this scope is genuinely consistent and was measured as such.** All 6 Analytics sub-tabs rendered real, backend-cross-checked data with **zero page errors**. Every one of the 5 top-level destinations was reachable and rendered. Executive Dashboard's honest fabricated-data disclosure banner still fires (measured at **6,260 ms** this run). A.11.1's single-`<h1>` fix, A.10.7's data-source fix and A.10.7's Export fix all still hold. `ExecutiveReports.jsx` is still correctly orphaned. Negative results are reported in their own section as real results, not omitted.

---

## Finding 1 — Reports asserted service and queue state as fact from endpoints that return 403 to every founder

**Reproduce.** Opened Reports as a real founder (More menu → "report" → Reports). Read the Service Health and System Performance panels. Then probed the underlying endpoints directly with the same real session cookie.

**Measure (real values, pre-fix).**

Endpoints, probed live with the real session (`Cookie: jarvis_auth=…`):

| Endpoint | Real HTTP status | Real round-trip |
|---|---|---|
| `GET /stats` | **403** | 2.523 s |
| `GET /ops` | **403** | 0.0006 s |
| `GET /metrics` | **403** | 0.003 s |
| `GET /metrics/dashboard` | 200 | 0.004 s |

What Reports rendered from that 403, measured live off the DOM:

| Row | Rendered detail | Rendered dot | Reality |
|---|---|---|---|
| AI Engine | `Not configured` | `dot--warn dot--live` | Unknown (403). `/health` says `ai:false` — coincidentally right, still unfetched |
| **WhatsApp** | **`Not set up`** | `dot--warn dot--live` | **FALSE** — `/health` says `whatsapp: true` |
| **Payments** | **`Not configured`** | `dot--warn dot--live` | **FALSE** — `/health` says `payments: true` |
| Runtime | `Online` / `Reconnecting…` | real | Correct — `online` is real health-poll state owned by `App.jsx` |
| Tasks completed | **`0`**, sub **`All healthy`** | — | Unknown (403) |
| Messages Sent (KPI) | **`0`** | — | Unknown (403) |

Real backend ground truth, `GET /health` (unauthenticated, the same probe the app itself polls):
`{"ai":false,"telegram":true,"whatsapp":true,"payments":true}`

**Root Cause.** `ReportsV2.jsx`'s `refresh()` deliberately skips `getStats`/`getOpsData`/`getMetrics` for non-operators (an existing, correct A.6 fix that stopped a false "Backend unavailable" banner). The consequence was never followed through into the render: `opsData` is therefore **permanently `null` for every founder**, and `ServiceHealth` computed `const svcs = opsData?.services || {}` then rendered each row's *falsy* branch — `"Not set up"`, `"Not configured"` — as a positive assertion. `SystemPerf` did the same via `opsData?.queue?.counts?.completed ?? 0` plus the sub-label `"All healthy"`.

The page **already had the correct pattern one panel up**: `Memory usage` and `Avg response` both degrade to the app-wide `"—"` unknown placeholder when their value is genuinely `null`. This is the same convention A.11.5 used for TeamWorkspace's tiles and A.11.1 measured on Mission Control's metric cards. The unknown-dot state also already existed — `frontend/src/index.css` documents the vocabulary verbatim: *"Use with a color class: .dot--ok / .dot--warn / .dot--crit / .dot--dim"*.

**Recover.** `frontend/src/components/ReportsV2.jsx` + `.css` only. `ServiceHealth` and `SystemPerf` each derive a real `known` / `queueKnown` flag from whether the payload actually arrived, and render `"—"` with the existing neutral `dot--dim` when it did not. `.dot--dim` added to `ReportsV2.css` using the same `--text-faint` token `index.css` already uses for its own `.status-indicator.dot--dim`. **No new component, no new state, no new copy invented.**

**Anti-over-correction, deliberate and asserted.** `Runtime` was explicitly **left reporting its real value** (`known: true`) — `online` comes from `App.jsx`'s real health poll, not operator-gated telemetry, so sweeping it into the unknown branch would have been its own dishonesty. Verified live post-fix: Runtime still reads `Online` with `dot--ok`.

**Reverify (real values, post-fix — live).**

| Row | Pre-fix | Post-fix |
|---|---|---|
| WhatsApp | `Not set up` / `dot--warn dot--live` | **`—`** / `dot--dim` |
| Payments | `Not configured` / `dot--warn dot--live` | **`—`** / `dot--dim` |
| AI Engine | `Not configured` / `dot--warn` | **`—`** / `dot--dim` |
| Tasks completed | `0` / `All healthy` | **`—`** / (no sub-label) |
| Messages Sent | `0` | **`—`** / `Automation data unavailable` |
| **Runtime** (control) | `Online` | **`Online`** / `dot--ok` — unchanged, still real |

---

## Finding 2 — a total failure of the leads fetch was indistinguishable from a genuinely empty account

**Reproduce.** Injected a genuine transport-layer failure on the real request — `page.route("**/business/leads*", r => r.abort("failed"))` — not a mocked body, then opened Reports through the real UI.

**Measure (real values, pre-fix).**

| | Rendered under a genuine total failure |
|---|---|
| TOTAL LEADS | **`0`** (sub `0 hot · 0 paid`) |
| CLOSE RATE | **`0%`** (sub `0 leads tracked`) |
| Pipeline Breakdown | **`No lead data yet. Add contacts to see pipeline distribution.`** |
| Error banner | **`null` — nothing shown at all** |

**Root Cause.** `getLeadsV5()` **does not throw**. `frontend/src/businessApi.js` catches and returns `{ success: false, error: err.message, leads: [] }`. `ReportsV2`'s check was `Array.isArray(ledsResp?.leads)` — satisfied by that empty array — so `refresh()`'s `catch` never ran and `setError(null)` was called on the failure path. A failed load and an empty account produced byte-identical output.

Per the mission's explicit lesson, the real backend envelope was read before choosing a discriminator: `backend/routes/business.js`'s `_ok` is `res.json({ success: true, ...data })`. So `/business/leads` genuinely sends `success`, and **`success` is the correct field here** — the mirror image of A.11.5's finding that `r.ok` was correct for `/orgs/*`'s `{ok:true}`. This is the mission's named class ("false zeros asserted as fact under a failed load") on a financial surface.

**Recover.** `frontend/src/components/ReportsV2.jsx` only. `refresh()` now detects `ledsResp?.success === false`, sets `leads` to **`null`** (unknown) rather than `[]` (genuinely zero), and raises the page's **already-existing** `.rv2-error-banner`. `leadStats` derives a real `known` flag; the four KPI cards and the Pipeline empty state render the established `"—"` / an "unavailable" message when unknown. The Export payload gained an explicit `leadsAvailable` field so a file produced during a failed load cannot silently claim `totalLeads: 0`.

**Anti-over-correction, proven live in both directions.** The guard is conditional, never blanket:

| | Real load, genuinely empty account (0 leads) | Real load, 3 real leads | Genuine injected failure |
|---|---|---|---|
| TOTAL LEADS | **`0`** (real zero survives) | **`3`** | **`—`** |
| CLOSE RATE | **`0%`** (real zero survives) | `0%` | **`—`** |
| Pipeline | `No lead data yet. Add contacts…` | real bar `New=3 100%` | `Pipeline data unavailable — couldn't load leads.` |
| Error banner | **`null`** (correctly absent) | `null` | **shown** |

The `3` was cross-checked against the real backend in the same run: `GET /business/leads?limit=1000` → `total: 3`. Exact match, no fabrication.

---

## Finding 3 — Reports' page header was the sole typography outlier among six sibling screens

**Reproduce.** Measured the page title and subtitle on Reports and on every in-scope sibling with `getComputedStyle()`, then read the CSS for each.

**Measure (real values, pre-fix).**

| Surface | Title element | Computed |
|---|---|---|
| Analytics | `h1.anc-title` | 22px / **800** / `rgb(26,31,46)` / **-0.3px** |
| Organization | `h1.oac-title` | 22px / 800 / `-0.3px` |
| Team Workspace | `h1.tw-title` | 22px / 800 / `-0.3px` |
| Workspace Settings | `h1.ws-title` | 22px / 800 / `-0.3px` |
| Billing (A.11.5's fix) | `h1.bd-title` | 22px / 800 / `-0.3px` |
| **Reports** | `h1.rv2-page-title` | 22px / **700** / **-0.44px** |

Subtitles: five siblings `13.5px / var(--text-dim)`; **Reports `13px / var(--text-faint)`** (a dimmer token).

The five sibling CSS rules are byte-identical and all sit at lines 9–11 (17–19 for `.bd-`) of their own stylesheet:

```css
.{anc|oac|tw|ws|bd}-title    { font-size: 22px; font-weight: 800; color: var(--text); letter-spacing: -0.3px; margin: 0; }
.{anc|oac|tw|ws|bd}-subtitle { font-size: 13.5px; color: var(--text-dim); margin: 4px 0 0; }
```

**Root Cause.** Genuine drift, not intentional variation — decisively so, because **Analytics (`.anc-`) sits in the same "Operations" breadcrumb group as Reports** (`Dashboard › Operations › Reports` vs `Dashboard › Operations › Analytics`) and was already on the correct values. Reports predates the shared shape and was never brought along.

**Recover.** `frontend/src/components/ReportsV2.css` only — `font-weight: 700 → 800`, `letter-spacing: -0.02em → -0.3px`, subtitle `13px/--text-faint → 13.5px/--text-dim`. **The 22px size was already correct and was deliberately not touched** (asserted in the regression test as an anti-over-correction check). No markup change, no new class.

**Reverify (post-fix, live).** `h1.rv2-page-title` computes to **22px / 800 / -0.3px** with a **13.5px** subtitle — byte-identical to the measured sibling baseline — with an `h1` count of exactly **1** (no duplicate-title drift of the kind A.11.1 fixed on Executive Dashboard).

---

## Finding 4 — ⌘K could not resolve "finance" to Billing while the More menu could

**Reproduce.** Typed the same 9 terms into both search surfaces live, in the same session.

**Measure (real values, pre-fix).**

| Term | More menu | ⌘K |
|---|---|---|
| `reports` | `Reports` | `Reports` ✓ |
| `analytics` | `Analytics` | `Analytics` ✓ |
| `kpi` | `Analytics` | `Analytics` ✓ (A.10.7's fix, intact) |
| `executive` | `Executive Loop`, `Executive OS (L6)`, `Executive Dash` | all 3 ✓ |
| **`finance`** | **`Billing`** | **`Launch Platform`, `Product OS` — no Billing** |
| `revenue` | 0 results | 0 results (see UNKNOWN-C) |
| `export` | 0 results | 0 results (a button, not a destination — correct) |

**Root Cause.** `App.jsx:206` — `{ id: "billing", label: "Billing", group: "Account", alias: "finance" }`. `CommandPalette.jsx` maintains a **separate, hand-written `NAV_ACTIONS` registry** whose `nav-billing` entry carried no `keywords` field. Exactly A.10.7's `kpi` class and A.11.1's 12-missing-destinations class, recurring on a different entry. The correct mechanism already exists **one entry away** at `nav-analyticscenter` (`keywords: "kpi kpis"`).

**Recover.** `frontend/src/components/CommandPalette.jsx` only — added `keywords: "finance"` to the existing `nav-billing` entry. One additive field, zero new destinations.

**Reverify (post-fix, live).** ⌘K `finance` → **`["◇ Billing ↵", …]`**, Billing now the top result. Control re-checked in the same run: ⌘K `kpi` → Analytics still resolves (A.10.7's fix not disturbed).

**Scope discipline — a measured, deliberately-unfixed sibling gap.** A full static diff of all 18 `MORE_TABS` entries carrying an `alias` against their `CommandPalette` counterparts found **15 of 18 missing their `keywords` equivalent** (`settings`, `help`, `activity`, `reliability`, `eod`, `copilot`, `devops`, `observer`, `creative`, `growth`, `contentseo`, `companies`, `team`, `integrations`, and `billing`). Only `billing` is in this sub-phase's scope (mission scope item 4, Finance/Revenue reporting) and only `billing` was fixed. The other 14 are recorded here as a real, measured, cross-phase finding rather than silently expanding this phase's blast radius. See UNKNOWN-B.

---

## Negative findings — real results of the primary hunts, not padding

### `ExecutiveReports.jsx` is still correctly orphaned — verified, deliberately NOT recovered

A.10.7 deliberately left this component unwired. That decision was re-verified this phase and upheld:

- **0 references anywhere** outside its own file — exhaustive walk of `frontend/src`, `backend`, `agents` for every `.js/.jsx/.cjs/.mjs`. Not in `App.jsx` (0 occurrences).
- Still contains **6 `Math.random()`** calls.
- Still self-discloses at line 115: *"⚠ No monthly revenue/leads/conversion ledger is tracked yet — the figures below are illustrative seed data, not real account activity."*

Per the mission's explicit instruction, this is documented as an **AI Honesty finding, not "fixed" by making fake data look real**. Recovering it would newly expose 100%-fabricated revenue/conversion/retention figures to founders who currently cannot reach it at all. The regression test now **pins both facts** (zero external references AND the continued presence of `Math.random()` + the disclosure) so the decision cannot be silently reversed in either direction.

### Executive Dashboard's honest-disclosure mechanism still works

Measured live this phase: the banner **"⚠ Live data unavailable — showing example data. Check backend connectivity."** appeared at **6,260 ms** after navigation. A.10.7 measured up to ~25 s under peak load; 6.3 s this run is the same mechanism under lighter load, not a change. The gate (`dataError && !missionsLive`) is unchanged and is pinned in the regression test.

### The A.11.4 wrong-response-shape class is genuinely ABSENT from this scope

The mission asked whether Reports/Executive share the `/runtime/history` mis-read that produced a false "0% success rate". They do not. Every panel checked reads a field the real route genuinely sends:
- Analytics' `ExecutivePanel` reads `kpis.{healthScore,uptimeSeconds,totalRequests,errorRate,activeAgents,aiProvidersUp,runtimeRecs}` — cross-checked against the real `GET /analytics/executive`, which returns **exactly** those seven keys.
- `"0 AI Providers Up"` was investigated as a suspected false zero and is **genuinely real**: the backend returns `aiProvidersUp: 0`, consistent with `/health`'s `ai: false`. Reported as a real negative result, not manufactured into a finding.
- `K6Stat` already renders `{value ?? "—"}`, and `useAnalyticsFetch` already tracks a real `error` state distinctly from empty data (with its own in-code comment explaining that a prior `.catch(() => {})` made "no data" and "backend unreachable" look identical) — the correct pattern, already present.

### Analytics is genuinely clean — all 6 sub-tabs, zero errors

All six walked live with real waits. **Zero page errors.** Every number spot-checked traced to a real endpoint: `42 Active Agents`, `0 Total Requests`, `0% Error Rate` all match `GET /metrics/dashboard` exactly (`agents.count: 42`, `runtime.requests: 0`, `runtime.error_rate: 0`); `125 Groq calls`, `1532 total tasks`, `1 member` are real. No fabrication found.

### Prior-phase fixes in this scope all still intact

| Fix | Re-verified this phase |
|---|---|
| A.10.7 — Reports reads org-scoped `/business/leads`, not `/crm/leads` | holds (`getLeadsV5` only; no `getLeads(` in executable code) |
| A.10.7 — Export exports real on-screen state, not `/runtime/export/analytics` | holds; real download captured: `ooplix-report-2026-08-08.json`, `leadsAvailable: true`, `totalLeads: 3`, 3 real lead records |
| A.10.7 — `kpi`/`kpis` resolves Analytics in both surfaces | holds |
| A.11.1 — Executive Dashboard renders exactly one `<h1>` | holds (`h1Count: 1`, 0 local `<h1>` in source) |

---

## Documented but NOT fixed (real, measured — listed separately, not silently dropped)

### UNKNOWN-A — Executive Loop and Executive OS (L6) render no page title at any heading level

**Measure (live).** Across the 5 in-scope destinations: Reports `h1Count: 1` (`h1.rv2-page-title`), Analytics `h1Count: 1` (`h1.anc-title`), Executive Dash `h1Count: 1` (`h1.ph-title`, via the shared `PageHeader`). **Executive Loop: `h1Count: 0`, no `h2`, no `.ph-title` — no page title element of any kind.** Executive OS (L6): `h1Count: 0`, with an `h2` reading "Executive OS" at `21px / 700 / rgb(108,99,255)` — a differently-coloured, differently-weighted heading that is not the shared shape.

**Why not fixed.** This is the same *shape* as A.11.5's Billing finding (Finding 3 there), but the recovery is not equivalent. Billing had four sibling screens in its own scope sharing one byte-identical rule to copy. These two are console-style surfaces with no `.el-`/`OrgLevelStatus` title convention to converge on, and A.11.1 already established (UNKNOWN-A there) that Executive Loop is deliberately built as a permanently-dark operator console outside the themed CRUD-page system — its stylesheet remains **0 `var(--…)` references against 119 hardcoded colour values**, re-measured this phase and unchanged. Adding a `PageHeader` to either would be introducing a new structure to a screen that never had one, not recovering a drifted one. Left as measured, per the mission's "if unifying them would require designing something new… mark it UNKNOWN" rule.

### UNKNOWN-B — 14 further `MORE_TABS` aliases have no ⌘K `keywords` counterpart (outside this scope)

**Measure (static, exhaustive).** 18 `MORE_TABS` entries carry an `alias`; **15 lacked a `CommandPalette` `keywords` equivalent**. This phase fixed the one in scope (`billing`/"finance"). The remaining 14: `settings` ("notification notifications"), `help` ("shortcut shortcuts keyboard"), `activity` ("logs"), `reliability` ("incident alert monitoring"), `eod` ("shutdown close day daily summary wrap up end my day"), `copilot`, `devops`, `observer`, `creative`, `growth`, `contentseo`, `companies`, `team` ("invite employee"), `integrations`.

**Why not fixed.** Every one belongs to a different sub-phase's scope (A.11.2–A.11.5 and beyond). Fixing them here would mean editing surfaces this phase never operated live, which the mission's method forbids — each needs its own Reproduce→Measure step in the browser, not a bulk static patch. Recorded as a real, measured, cross-phase structural finding: **the two search registries drift because they are maintained separately**, and A.11.1's Finding 1 (12 missing *entries*) plus this (14 missing *keywords*) are the same root cause surfacing twice.

### UNKNOWN-C — "revenue" resolves nothing in either search surface

**Measure (live).** `revenue` → **0 results in the More menu AND 0 in ⌘K.** Confirmed against the real 82-item menu.

**Why not fixed.** A.10.7 already established that standalone business revenue is deliberately folded into Reports and Dashboard rather than existing as its own module — a reasonable product-organisation choice, not a gap. Adding a `revenue` alias would require choosing which of Reports / Dashboard / Billing is "the" revenue destination, which is a product decision, not the recovery of an existing pattern. The mission's scope item 4 (Finance/Revenue surfaces distinct from A.11.5's Billing) was satisfied by the `finance`→Billing path, which now works in both surfaces. Recorded as measured, deliberately not guessed at.

---

## Matrix 1 — UX Consistency Matrix (per-screen, live-measured)

| Screen | Layout/Cards | Typography | Buttons | Loading state | Breadcrumb | Theme-aware | Page errors |
|---|---|---|---|---|---|---|---|
| Reports | PASS (`.rv2-panel`, r12px) | **FIXED** (was 700/-0.44px/13px; now 22px/800/-0.3px + 13.5px) | PASS (`.rv2-export-btn`/`.rv2-refresh-btn`, 7px 14px, pill r9999px) | PASS (real `.rv2-skeleton` on KPIs + bars) | PASS (`Dashboard › Operations › Reports`) | PASS (body responds; `.rv2-panel` is a translucent overlay valid in both) | 0 |
| Analytics | PASS (`.k6-stat-grid`) | PASS (22px/800/-0.3px — the reference) | PASS (`.anc-subnav-btn` tab row) | PASS (real "Loading executive analytics…" + real `K6ErrorState` w/ Retry) | PASS (`Dashboard › Operations › Analytics`) | PASS | 0 across all 6 sub-tabs |
| Executive Dash | PASS (`.ed-stat-card`) | PASS (single `h1.ph-title`, A.11.1's fix holds) | PASS (pill related-links) | PASS (honest disclosure banner @ 6,260 ms) | PASS (`Dashboard › Enterprise › Executive Dash`) | PASS (card bg `rgba(255,255,255,.96)` → `rgba(10,14,24,.97)`) | 0 |
| Executive Loop | PASS (own dark console grid) | **UNKNOWN-A** (no title element at all) | PASS (internally consistent action set) | UNKNOWN (resolves 4–6 s per A.10.7; not re-timed) | PASS (`Dashboard › Intelligence › Executive Loop`) | **FAIL** (0 tokens / 119 hardcoded — A.11.1 UNKNOWN-A, unchanged) | 0 |
| Executive OS (L6) | PASS (token dark stat tiles) | **UNKNOWN-A** (`h2` 21px/700/accent-coloured, not the shared shape) | PASS (Refresh themed) | PASS (real error banner on genuine failure) | PASS (`Dashboard › Org Levels › Executive OS (L6)`) | UNKNOWN (inline styles) | 0 |

## Matrix 2 — Design System Matrix vs the A.11.1–A.11.5 baselines (drift flagged)

| Token category | A.11.1–A.11.5 baseline | This scope, measured | Drift? |
|---|---|---|---|
| Page title | 22px / 800 / `var(--text)` / -0.3px (`.oac-`/`.tw-`/`.ws-`/`.bd-`) | Analytics `.anc-title` **identical**; Reports `.rv2-page-title` was 22px/**700**/**-0.44px** | **YES → FIXED**; baseline now 6 screens |
| Page subtitle | 13.5px / `var(--text-dim)` | Analytics identical; Reports was **13px / `var(--text-faint)`** | **YES → FIXED** |
| Unknown placeholder | `"—"` (MissionControl metric cards, Billing summary, TeamWorkspace tiles post-A.11.5) | Reports already used it for Memory/Avg response; **now** also for services, queue, KPIs | was **partial** → now consistent |
| Status dot vocabulary | `index.css`: `.dot--ok / .dot--warn / .dot--crit / .dot--dim` | Reports defined only `ok`/`warn`; `dim` added from the documented vocabulary | reused, not invented |
| Section micro-label | 11–13.6px / 700 / uppercase | Reports `.rv2-section-label` **12px / 700 / uppercase / 0.96px** | within the measured family — **not** treated as a bug (same rationale as A.11.1) |
| Header action buttons | no single global button base exists (A.11.1 UNKNOWN-B) | Reports `7px 14px`, `r9999px` (pill), 13px/500 | own scoped class, consistent internally — not homogenised |
| Toast | shared `ToastContainer`, 3500 ms | none used in this scope (all surfaces read-only) | N/A |
| Error banner | `.ac-api-banner--error` "⚠ Live data unavailable — showing…" | Executive Dash uses it verbatim; Reports uses its own `.rv2-error-banner`; Analytics uses `.k2-error` | 3 distinct but each **honest** — not unified (A.11.1 reached the same conclusion) |

## Matrix 3 — Navigation Matrix

| Element | Result |
|---|---|
| Breadcrumbs | PASS — all 5 destinations render the shared `Home › Group › Page` shape correctly |
| Primary tab bar | PASS — `button.tab` computed styles identical across all 5 |
| More menu | PASS — resolves all 5 in-scope destinations on their first natural term |
| Command Palette (⌘K) | **FIXED** for `finance`→Billing; already correct for `reports`/`analytics`/`kpi`/`executive` |
| Org/Workspace switcher | PASS — unchanged, byte-identical (re-confirmed from A.11.5) |
| Dead ends | **none** — all 5 destinations + all 6 Analytics sub-tabs reached real content |

## Matrix 4 — Loading Matrix

| Screen | Pattern | Honest? |
|---|---|---|
| Reports | Real `.rv2-skeleton` on KPI values, sub-labels and pipeline bars | YES |
| Analytics (all 6) | Plain text "Loading … analytics…" + a real `K6ErrorState` with a working Retry | YES — error state is genuinely distinct from empty |
| Executive Dash | Honest disclosure banner rather than an indefinite spinner | YES |
| Executive Loop | Resolves its 12-endpoint `Promise.allSettled` batch (A.10.7: 4–6 s) | YES (transient, not stuck) |
| Executive OS (L6) | Plain text + real error banner on genuine failure | YES |

Skeleton-vs-plain-text remains split (1 skeleton, 4 plain text) — recorded as measured data, **not** force-homogenised, for the same reason A.11.1 gave: no single established loading component exists to converge on.

## Matrix 5 — Search Matrix

| Term | More menu | ⌘K (pre-fix) | ⌘K (post-fix) |
|---|---|---|---|
| `reports` / `report` | `Reports` | `Reports` ✓ | unchanged ✓ |
| `analytics` | `Analytics` | `Analytics` ✓ | unchanged ✓ |
| `kpi` | `Analytics` | `Analytics` ✓ | unchanged ✓ |
| `executive` | 3 real destinations | all 3 ✓ | unchanged ✓ |
| **`finance`** | `Billing` | **Launch Platform, Product OS — no Billing** | **`Billing` (top result)** ✓ |
| `revenue` | 0 | 0 | 0 — UNKNOWN-C, deliberate |
| `export` | 0 | 0 | 0 — correct (a button, not a destination) |

## Matrix 6 — Keyboard Matrix

| Interaction | Result |
|---|---|
| ⌘K opens palette | PASS |
| Escape closes palette | PASS — measured `input[placeholder*=Search]` count 1 → 0 |
| Enter selects top ⌘K result | PASS (`↵` affordance rendered on the active row) |
| Reports Export / Refresh | mouse-only buttons, keyboard-reachable via normal tab order; no dedicated hotkey (consistent with every prior sub-phase) |
| Analytics sub-tab row | real `<button>` elements, tab-reachable |
| Destructive actions | **none exist in this scope** — every surface is read-only, so no ConfirmDialog gate is applicable (correctly, not a gap) |

## Matrix 7 — Feedback Matrix

| Pattern | Where | Consistency |
|---|---|---|
| Shared `ToastContainer` (3500 ms) | not used in this scope | N/A — all surfaces read-only |
| Error banner | Reports `.rv2-error-banner` (now genuinely reachable), Executive Dash `.ac-api-banner`, Analytics `K6ErrorState` | 3 implementations, each honest, each with a working Retry — not unified (same judgement as A.11.1) |
| Retry affordance | Reports ✓, Analytics ✓, Executive OS ✓ | PASS |
| Unknown placeholder | `"—"` now used consistently across Reports' KPIs, services, queue | **FIXED** |

## Matrix 8 — AI Honesty Matrix (highest-priority dimension for this scope)

| Surface / value | Honest? | Evidence |
|---|---|---|
| Reports — Total Leads | **YES (fixed)** | `3` cross-checked against real `GET /business/leads` → `total: 3`. Genuine `0` still shows `0`; genuine failure shows `—` |
| Reports — Close Rate | **YES (fixed)** | real `0%` on a real empty account; `—` under genuine failure |
| Reports — WhatsApp / Payments | **WAS FALSE → FIXED** | claimed "Not set up"/"Not configured" while real `/health` said `whatsapp:true, payments:true`; now `—` |
| Reports — Tasks completed / "All healthy" | **WAS FALSE → FIXED** | asserted from a 403; now `—` |
| Reports — Messages Sent | **WAS UNKNOWN-AS-ZERO → FIXED** | now `—` with "Automation data unavailable" |
| Reports — Runtime | YES (unchanged) | real health-poll state; deliberately not suppressed |
| Reports — Pipeline empty state | **WAS MISLEADING → FIXED** | told a failed-load founder to "Add contacts"; now discloses unavailability |
| Reports — Export payload | **YES (hardened)** | `leadsAvailable` now explicit; real download verified with 3 real lead records |
| Analytics — all 6 sub-tabs | YES | `42 agents`, `0 requests`, `0% error rate`, `aiProvidersUp: 0` all match real endpoints exactly |
| Executive Dash — seeded data | YES | honest disclosure banner fires (6,260 ms measured), gate unchanged |
| Executive OS (L6) | YES | self-labels as read-only; real error banner on genuine failure |
| **`ExecutiveReports.jsx`** | **N/A — correctly unreachable** | 6× `Math.random()`, self-disclosing, **0 references**; deliberately left orphaned and pinned by test |

**Net:** 5 real AI-honesty violations found on Reports (2 of them provably **false**, not merely unknown), all 5 fixed. Zero violations found on Analytics or the three Executive surfaces.

---

## Fix Summary

| # | File(s) | Change | Test section |
|---|---|---|---|
| 1 | `ReportsV2.jsx`, `ReportsV2.css` | ServiceHealth + SystemPerf render `"—"`/`dot--dim` for operator-gated data they never fetched, instead of asserting false service/queue state | §2 |
| 2 | `ReportsV2.jsx` | Detect the real `success:false` envelope; `leads=null` on failure; KPIs/pipeline/export degrade honestly; the existing error banner now actually fires | §1 |
| 3 | `ReportsV2.css` | Page title/subtitle aligned to the 5-sibling baseline (22px/**800**/**-0.3px**, 13.5px/`--text-dim`) | §3 |
| 4 | `CommandPalette.jsx` | `keywords: "finance"` on the existing `nav-billing` entry | §4 |

Zero new components, zero new backend routes, zero schema changes, zero restyles of anything that was already correct. Every fix recovers a pattern already established elsewhere in this same codebase.

---

## Regression

**New test:** `tests/security/87-reports-executive-ux-consistency-false-zeros-service-claims-page-header-palette-finance.cjs`

**Final run: 57 passed, 0 failed, 0 skipped.**

Structure: §0 backend ground truth (the `operatorOnly` gate and the `{success:true}` envelope are re-read from the real source, so the test fails loudly if the premise ever changes) · §1–§4 the four fixes · §5 negative results and prior-phase pins · §6 live browser section (real boot with 8 retries + backoff, real navigation, real `getComputedStyle()`, real transport-layer failure injection, real backend cross-check, real ⌘K).

**Honest skip handling.** `todo()` is used — never `ok()` from a catch — for: playwright missing, no unexpired session, app shell not rendering after 8 real reload attempts, Reports not rendering after 4 retries, `/business/leads` unreadable after 4 retries, and the palette not opening after 4 retries. Skips are counted in a separate tally and the report states they are **NOT counted as passes**. Session selection verifies JWT expiry with a 60 s safety margin before use.

**Proof the test can genuinely fail** — two separate revert runs, each restored afterwards:

| Run | Reverted | Result | LIVE assertions that genuinely failed |
|---|---|---|---|
| baseline | nothing | **57 / 0 / 0** | — |
| **1** | Fix 2 (leads failure detection) | **48 / 9 / 0** | **6 LIVE**: 2 KPI cards re-asserted false zeros (`TOTAL LEADS "0"`, `CLOSE RATE "0%"`); Total Leads rendered `"0"` not `"—"`; Close Rate `"0%"`; **error banner measured `null`** under a genuine failure; Pipeline re-claimed *"No lead data yet. Add contacts…"* |
| **2** | Fixes 1, 3, 4 | **42 / 15 / 0** | **7 LIVE**: title `font-weight 700` (not 800); `letter-spacing -0.44px`; subtitle `13px`; WhatsApp `"Not set up"` w/ `dot--warn dot--live`; Payments `"Not configured"`; Tasks completed `"0"`; ⌘K `finance` → `Launch Platform, Product OS` (no Billing) |
| restore | — | **57 / 0 / 0** | — |

**13 distinct LIVE assertions** were proven to genuinely fail against real, reverted code in a real browser — not merely the static ones.

**Anti-over-correction assertions** (4 static + 3 live) confirm the guards never hide real data: a genuinely-loaded empty account still renders `0` and `0%`; a 3-lead account renders `3`; `Runtime` keeps its real value while its neighbours go unknown; no error banner appears on a successful load; the 22px title size was left untouched.

**Negative assertions** for hunted-and-absent bug classes: `dot--dim` was reused not invented (pinned against `index.css`); A.10.7's `kpi` keyword, data-source fix and Export fix all pinned; A.11.1's single-`<h1>` pinned; `ExecutiveReports.jsx`'s orphan status pinned in both directions; the 5-sibling header baseline itself is asserted still-shared so the alignment cannot become meaningless.

**Full regression suite:** `npm run test:runtime` — **144/144 passing, 0 failures**, matching the A.10.1–A.11.5 baseline exactly.

---

## Notes on method / blockers

- **No backend restart** was performed; no fix required one. One `GET /health` returned an empty body mid-run and recovered on the first retry — classified as this environment's documented background load, not a product defect and not a silent pass.
- The account used began with **0 real leads**, which was genuinely valuable: it made the anti-over-correction case (a real zero must still render as `0`) directly testable. 3 real leads were then created through the real API to prove the non-zero path and the Export payload.
- Two assertions failed on the first test run because ReportsV2's own A.10.7 **comment blocks quote the exact strings** those regressions hunt for (`/runtime/export/analytics`, `getLeads(`). Fixed by asserting against comment-stripped code. A first attempt at that strip used a greedy `/\*…\*\/` regex which silently removed ~13 KB of real JSX between `{/* … */}` markers — caught by verifying the stripped output still contained known-present code rather than trusting the pass, and replaced with a line-based strip. Recorded because a vacuous pass is exactly the failure mode this mission's test-integrity bar exists to prevent.
