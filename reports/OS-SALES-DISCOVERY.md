# Sales OS — Discovery

**Mission:** OS development / recovery track. Discovery-first: nothing was built
before the repository was searched and the existing capability traced.

**Baseline:** `c7314797` · runtime 144/144 · `.env` untouched

---

## Method

Routes were enumerated from the live Express router (`backend/routes/index.js`),
not guessed. Frontend reachability was determined by parsing App.jsx's actual
`lazy(() => import(...))` declarations and render guards — an early regex-based
attempt reported every component as unreachable **including `BusinessOS`, which
demonstrably renders**, so the method was corrected before any conclusion was
drawn.

---

## Finding: Sales OS already exists — inside Business OS

There is no separate `salesService`. The complete sales lifecycle is implemented
in `backend/services/businessDataService.cjs` and exposed under `/business/*`.

**32 sales-lifecycle routes, all mounted and auth-gated:**

| Stage | Route |
|---|---|
| Lead capture | `POST /business/leads`, `POST /crm/lead` |
| Lead read/update | `GET|PATCH|DELETE /business/leads/:id` |
| Qualification | `POST /business/leads/:id/qualify` · `/disqualify` |
| Contacts | `GET|POST|PATCH|DELETE /business/contacts` |
| Opportunity | `GET|POST|PATCH /business/opportunities` |
| Stage movement | `POST /business/opportunities/:id/advance` |
| Close | `POST .../close-won` · `POST .../close-lost` |
| Pipeline | `GET /business/pipeline`, `/pipeline/:entityType` |
| Revenue | `GET|POST /business/revenue`, `GET /business/revenue/stats` |
| Reporting | `GET /business/dashboard`, `/stats`, `/summary/daily`, `/summary/weekly` |

**Conclusion: no Sales OS needed building.** The correct action was to operate
it, find real defects, and fix them.

---

## Frontend inventory

| Surface | Declared in App.jsx | Rendered | Tab | Classification |
|---|---|---|---|---|
| `BusinessOS.jsx` | YES | YES | `business` | **EXISTING + WORKING** — the Sales surface |
| `ContactsV2.jsx` | YES | YES | `clients` | **EXISTING + WORKING** |
| `RevenueOS.jsx` (1,116 lines) | no | via ElectronWorkspace only | — | **EXISTING + UNREACHABLE (web)** |
| `EnterpriseCRM.jsx` (353 lines) | no | no | — | **DEAD / ORPHANED** |
| `AutonomousRevenueCenter.jsx` (245 lines) | no | no | — | **DEAD / ORPHANED** |

### RevenueOS — a real surface with no web route

`RevenueOS.jsx` calls **4 endpoints that are all mounted and live**:
`/revenue/executive`, `/revenue/dashboard`, `/revenue/lifecycle/events`,
`/revenue/upgrade/signals`. Its only consumer is `ElectronWorkspace.jsx`, which
App.jsx documents at line 77 as *"a documented pure passthrough in web mode"* —
so web users cannot reach it.

This is the codebase's own documentation, not an inference.

### The two orphans are presentational, not surfaces

`EnterpriseCRM` and `AutonomousRevenueCenter` make **zero network calls** and
take props (`health`, `status`) — they are child components whose parent was
removed, not standalone screens. **ARCHIVE CANDIDATE**, not recovery targets.

---

## Duplicate-risk check (architecture discipline)

| Risk | Verdict |
|---|---|
| Duplicate CRM | None created — `/business/*` reused |
| Duplicate pipeline | None — existing `getPipelineSummary` reused |
| Duplicate revenue ledger | None — existing `recordRevenue` reused (it already accepted `oppId`) |
| Duplicate customer system | None |
| Duplicate auth / org model | None |

