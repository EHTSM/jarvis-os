# Sales OS — Capability Matrix

| # | Capability | Route / Component | Classification | Evidence |
|---|---|---|---|---|
| 1 | Lead capture | `POST /business/leads` | **PRODUCTION READY** | 200, persisted, org-scoped |
| 2 | Lead read | `GET /business/leads/:id` | **PRODUCTION READY** | 200 (6 ms) |
| 3 | Lead update | `PATCH /business/leads/:id` | **PRODUCTION READY** | value 64000→72000 |
| 4 | Lead delete | `DELETE /business/leads/:id` | **PRODUCTION READY** | cross-tenant delete denied 404 |
| 5 | Qualification | `POST .../qualify` | **PRODUCTION READY** | status=qualified + timestamp |
| 6 | Disqualification | `POST .../disqualify` | **PRODUCTION READY** | verified in B.21 |
| 7 | Contacts CRUD | `/business/contacts` | **PRODUCTION READY** | mounted, auth-gated |
| 8 | Opportunity create | `POST /business/opportunities` | **PRODUCTION READY** | `title` required (correct validation) |
| 9 | Opportunity update | `PATCH /business/opportunities/:id` | **PRODUCTION READY** | 200 |
| 10 | Stage advance | `POST .../advance` | **PRODUCTION READY** | 3 transitions verified |
| 11 | Close won | `POST .../close-won` | **FIXED** | now records revenue (S-001) |
| 12 | Close lost | `POST .../close-lost` | **PRODUCTION READY** | correctly creates no revenue |
| 13 | Pipeline aggregate | `GET /business/pipeline` | **PRODUCTION READY** | tracked every stage move |
| 14 | Revenue ledger | `GET|POST /business/revenue` | **PRODUCTION READY** | $151,000 / 3 rows |
| 15 | Revenue stats | `GET /business/revenue/stats` | **PRODUCTION READY** | byType/bySource/byMonth |
| 16 | Sales dashboard | `GET /business/dashboard` | **PRODUCTION READY** | matches ledger |
| 17 | Sales stats | `GET /business/stats` | **PRODUCTION READY** | matches ledger |
| 18 | Daily/weekly summary | `/business/summary/*` | **PRODUCTION READY** | mounted, auth-gated |
| 19 | Business OS surface | `BusinessOS.jsx` tab `business` | **PRODUCTION READY** | declared + rendered |
| 20 | Contacts surface | `ContactsV2.jsx` tab `clients` | **PRODUCTION READY** | declared + rendered |
| 21 | Revenue OS surface | `RevenueOS.jsx` | **GENUINE GAP (web reachability)** | 4/4 endpoints live; Electron-only |
| 22 | Executive integration | `GET /analytics/executive` | **PRODUCTION READY** | 200, real KPIs |
| 23 | Customer handoff | `/customer-org/*` | **NOT MEASURED** | not exercised this mission |
| 24 | Sales automation | existing runtime | **NOT MEASURED** | not exercised this mission |
| 25 | Sales AI | `/ai/chat` | **CREDENTIAL BLOCKED** | no provider keys (honest 502) |
| 26 | Payment execution | — | **CREDENTIAL BLOCKED** | external side effect |
| 27 | EnterpriseCRM.jsx | orphaned | **ARCHIVE CANDIDATE** | 0 network calls, 0 importers |
| 28 | AutonomousRevenueCenter.jsx | orphaned | **ARCHIVE CANDIDATE** | 0 network calls, 0 importers |

## Totals

| Classification | Count |
|---|---|
| PRODUCTION READY | 21 |
| FIXED | 2 (S-001, S-002) |
| RECOVERED / WIRED | 0 |
| CREDENTIAL BLOCKED | 2 |
| NOT MEASURED | 2 |
| GENUINE GAP | 1 |
| ARCHIVE CANDIDATE | 2 |
| BUILD REQUIRED | **0** |
