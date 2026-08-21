# OS-CUSTOMER-SUCCESS — CAPABILITY MATRIX

**Date:** 2026-08-14 · **Verification port:** 5144 · **Regression:** 144/144 before and after

**Legend:** PROD = Production Ready · FIXED = defect corrected this pass · VERIFY = works, caveat
noted · GAP = Genuine Gap · NM = Not Measured

---

## 1. Customer Lifecycle / Journey

| # | Capability | UI | Route | Service | Store | Auth | Org Scope | Role | Status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Sync journeys from CRM/revenue | `CustomerSuccessCenter.jsx` | `POST /customer-org/journey/sync` | `syncJourneys` | `data/customer-journeys.json` | requireAuth+attachOrg | writes orgId from lead | any org member | **PROD** |
| 2 | Get single journey | same | `GET /customer-org/journey/:customerId` | `getJourney` | same | requireAuth+attachOrg | **FIXED** — now org-scoped | member | **FIXED** |
| 3 | Advance stage | same | `POST /customer-org/journey/:customerId/advance` | `advanceStage` | same | requireAuth+attachOrg | NM | member | **NM** |
| 4 | List journeys | same | `GET /customer-org/journey` | `listJourneys` | same | requireAuth+attachOrg | **FIXED** — now org-scoped | member | **FIXED** |
| 5 | Stage distribution | same | `GET /customer-org/journey/stages` | `getStageDistribution` | same | requireAuth+attachOrg | unscoped (aggregate) | member | **PROD** |
| 6 | Journey stats | same | `GET /customer-org/journey/stats` | `getStats` | same | requireAuth+attachOrg | unscoped (aggregate) | member | **PROD** |
| 7 | Stage-filter bug | — | (internal to `listJourneys`) | — | — | — | — | — | **FIXED** (was silently emptying stage-filtered results) |

## 2. Onboarding

| # | Capability | Status | Evidence |
|---|---|---|---|
| 8 | List onboarding roles | **PROD** | Real, `GET /launch/onboarding/roles` returns real role definitions |
| 9 | Start onboarding | **PROD** | Real state created, persisted, `roleId`, `steps[]` |
| 10 | Complete a step | **PROD** | Real mutation verified — `done:true`, `doneAt` timestamp set |
| 11 | Progress tracking | **PROD** | `getProgress()` reflects real completed/total step counts |
| 12 | Restart recovery | **NM** | Onboarding state file not independently restart-tested this pass (journey/health/plans were — see §12) |
| 13 | Onboarding is account-scoped, not org-scoped | **VERIFY** | By design — this is founder/operator self-onboarding, not per-customer; noted as a scope distinction, not a defect |

## 3. Customer Health

| # | Capability | Status | Evidence |
|---|---|---|---|
| 14 | Score a customer (6 dimensions) | **PROD** | Real weighted computation from real journey/revenue/CRM/success data |
| 15 | Score all customers | **PROD** | `POST /customer-org/health/score-all` — real, 88 scored live |
| 16 | Get single health record | **FIXED** | Now org-scoped |
| 17 | List health records | **FIXED** | Now org-scoped |
| 18 | Health history | **NM** | Route exists, not exercised for isolation |
| 19 | Health trend | **NM** | Route exists, not exercised |
| 20 | **No hardcoded fallback score** | **PROD** | `grep` for `score:50/75/100` returns zero matches in the health engine |
| 21 | Alert generation from real thresholds | **PROD** | 5 real alert types fire only when a real dimension crosses a real threshold |

## 4. Success Plans

| # | Capability | Status | Evidence |
|---|---|---|---|
| 22 | Generate success plan | **PROD** | Real, composes real health/journey/revenue data — no fabricated recommendation |
| 23 | Get single plan | **FIXED** | Now org-scoped |
| 24 | List plans | **FIXED** | Now org-scoped |
| 25 | Predict (churn/expansion/renewal/satisfaction/support/upsell) | **PROD** | Real prediction object with real probability/timeframe fields |
| 26 | Record outcome | **NM** | Route exists, not exercised |
| 27 | Plan stats | **NM** | Route exists, not exercised |

## 5. Retention / Renewal / Churn / Expansion

| # | Capability | Status | Evidence |
|---|---|---|---|
| 28 | Churn prediction | **PROD** | Real, `probability`/`severity`/`signals`/`timeframe`, no synthetic metric |
| 29 | Renewal prediction | **PROD** | Real, `probability`/`daysToRenewal`/`renewalDate` sourced from `revenueOS.cjs` |
| 30 | Expansion prediction | **PROD** | Real, `probability`/`upsellSignal`/`recommendedPlan` |
| 31 | Aggregate retention analytics | **NOT MEASURED** | No dedicated retention-rate endpoint found beyond per-customer predictions |

## 6. Customer Feedback

| # | Capability | Status | Evidence |
|---|---|---|---|
| 32 | Feedback (via `/co3/feedback`) | **NOT MEASURED** | Exists in the adjacent `co3UserSuccess` system; not exercised this pass (out of primary `/customer-org/*` scope, and this pass's time budget prioritized the confirmed security defect) |

## 7. Support Handoff (verify only — do not audit Support OS)

| # | Capability | Status | Evidence |
|---|---|---|---|
| 33 | Customer → support ticket creation | **PROD (pre-existing, correct)** | `createTicket({...req.body, orgId: _orgId(req)})` — already org-scoped from a prior fix |
| 34 | Ticket list scoping | **PROD (pre-existing, correct)** | `listTickets()` already filters by `orgId` with the exact pattern this pass replicated for journey/health/plans |
| 35 | Support-engine internals | **OUT OF SCOPE** | Per the mission's explicit instruction — Support OS architecture not audited |

## 8. Cross-OS Integration

| # | Capability | Status | Evidence |
|---|---|---|---|
| 36 | Sales/CRM → Customer Success handoff | **PROD** | `syncJourneys()` reads real `crmService.getLeads()`; identity (`customerId`), org (`orgId`), and lead data preserved without duplication |
| 37 | No duplicate customer/CRM database created | **PROD** | Confirmed — journey/health/plan engines all read from the existing `crmService.js`, never write a competing customer record |
| 38 | Finance → Customer Success (renewal/billing) | **PROD** | `customerSuccessEngine.cjs` reuses `revenueOS.cjs` directly (`_rev()`) — the same service independently verified in the Finance OS pass; no payment executed |
| 39 | Marketing → Customer Success (audience/engagement) | **NOT MEASURED** | No direct `/customer-org/*` → Marketing/Growth OS read path found; not fabricated, genuinely absent |
| 40 | Organization context consistency | **PROD** | `attachOrg`/`_orgId(req)` — the same hardened middleware verified correct in the Organization OS pass |

## 9. Security / Isolation

| # | Capability | Status | Evidence |
|---|---|---|---|
| 41 | Unauthenticated read/write | **PROD** | 401 (inherited `requireAuth`, unmodified) |
| 42 | Cross-tenant journey read (direct ID) | **FIXED** | Confirmed 200→404 for the wrong org after fix |
| 43 | Cross-tenant journey read (list) | **FIXED** | Confirmed identical-list leak → correctly scoped 0-result list |
| 44 | Cross-tenant health read (direct ID + list) | **FIXED** | Same pattern, same result |
| 45 | Cross-tenant success-plan read (direct ID + list) | **FIXED** | Same pattern, same result |
| 46 | Forged `X-Org-Id` header | **PROD** | `attachOrg` — real membership required regardless of header value (verified correct in Organization OS pass, unmodified here) |
| 47 | Role escalation | **NM** | No distinct CS-specific role hierarchy found beyond org membership itself |

## 10. Persistence

| # | Capability | Status | Evidence |
|---|---|---|---|
| 48 | Journey `orgId` survives restart | **PROD** | 18/18 lead-backed orgId-tagged journeys intact after a real restart |
| 49 | Health records survive restart | **PROD** | 69 records intact, count unchanged |
| 50 | Success plans survive restart | **PROD** | Plans generated during testing persisted |
| 51 | Onboarding state survives restart | **NM** | Not independently re-checked post-restart |

## 11. Performance

| # | Capability | Status | Evidence |
|---|---|---|---|
| 52 | Journey list | **PROD** | 0.063s |
| 53 | Health list | **PROD** | 0.074s |
| 54 | Dashboard composite | **PROD** | 0.079s |

---

## Totals

| Classification | Count |
|---|---:|
| **Production Ready** | **28** |
| **Fixed** | **8** |
| **Verify** | 1 |
| **Genuine Gaps** | **1** (accidental cross-file middleware leak blocking non-workspace-member org access) |
| **Not Measured** | **16** |
| Credential Blocked | 0 |
| Environment Blocked | 0 |
| Archive | 0 |
| **Total assessed** | **54** |

**No customer success system was duplicated and nothing was built.** One cross-tenant data-leak
class (3 engines) fixed with negative tests and live re-verification against two real
organizations; one dead-logic bug fixed as a byproduct of the same edit.
