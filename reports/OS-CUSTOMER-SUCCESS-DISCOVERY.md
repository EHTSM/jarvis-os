# OS-CUSTOMER-SUCCESS — DISCOVERY REPORT

**Track:** OOPLIX OS #10 — Customer Success OS
**Date:** 2026-08-14 · **Branch:** `security/reality-completion`
**Method:** Repository inspection BEFORE any change. **No new Customer Success platform was built.**
**Isolation:** Verification server on **port 5144**. The Audit Track's own concurrent server was
observed but not touched; two of this session's own stray processes were detected via `lsof` and
killed precisely (see Workflow Evidence).

---

## 1. Method

Traced actual route mounts in `backend/routes/index.js` rather than guessing paths. Every claim
below was confirmed by execution against real accounts and real organizations from the prior
Organization OS pass, not assumed from filenames.

---

## 2. The real Customer Success OS

| System | Route prefix | Role |
|---|---|---|
| **`customer-org` (POST-Ω P11)** | `/customer-org/*`, 32 routes | The genuine Customer Success OS: journey, health, success plans, support handoff, automation, dashboard |
| **`co3UserSuccess`** | `/co3/*` | Early-access/beta-program utility layer (invites, waitlist, feedback, KB, releases) — adjacent, not the mission's target |

`backend/routes/customerOrg.js`'s own header comment documents a **real, previously-fixed**
cross-tenant defect on support tickets: *"Support tickets previously carried no tenant field at
all, so listTickets() returned every org's tickets to every authenticated caller (reproduced live:
two separate companies received the SAME 50-ticket list, containing neither company's own
tickets)."* This is the exact defect class discovery found still present on three sibling engines
(§5).

## 3. Backend Inventory

| File | Lines | Role |
|---|---:|---|
| `backend/services/customerJourneyEngine.cjs` | 222 (+this pass's fix) | Lifecycle tracking (13 stages: lead → …→ recovery), reads `crmService`/`revenueOS`/`customerSuccess` |
| `backend/services/customerHealthEngine.cjs` | 220 (+fix) | 6-dimension health scoring, no hardcoded fallback score found |
| `backend/services/customerSuccessEngine.cjs` | 211 (+fix) | Success-plan generation, churn/expansion/renewal/satisfaction/support-demand/upsell predictions |
| `backend/services/customerSupportEngine.cjs` | — | Ticket creation/resolution — **already** org-scoped (the prior fix referenced above) |
| `backend/services/customerAutomationEngine.cjs` | — | Automation triggers/scans reading real journeys |
| `backend/services/customerOrganizationDashboard.cjs` | 211 | Composed dashboard views |
| `backend/services/onboardingEngine.cjs` | 229 | Real, exercisable onboarding (`/launch/onboarding/*`), account-scoped |
| `backend/routes/customerOrg.js` | 348 (+this pass's fix) | 32 endpoints, `attachOrg`-gated |

Route registration confirmed: `backend/routes/index.js:199` (`/customer-org`), `:131` (`/co3`).

## 4. Data stores (real, pre-existing production-shaped data)

| File | Records at verification |
|---|---:|
| `data/customer-journeys.json` | 68 real journeys |
| `data/customer-health.json` | 69 real health records |
| `data/customer-success-plans.json` | grows on generation (4 present after this pass's testing) |

Journeys and health are synced from **real CRM leads** (`data/` via `crmService.js`) and **real
revenue health** (`revenueOS.cjs`, the same service independently verified in the Finance OS pass).

## 5. Genuine defect found — the same tenant-leak class the file's own comment warns about

`customerJourneyEngine.cjs`, `customerHealthEngine.cjs`, and `customerSuccessEngine.cjs` records
carried **no `orgId` field at all** — confirmed by `grep -n "orgId"` returning zero matches in all
three files before this pass. Their list/get functions had no tenant filter. This is the identical
defect class `customerSupportEngine.cjs` already had fixed for tickets, left unfixed on three
sibling engines feeding the same `/customer-org/*` surface and the same `CustomerSuccessCenter.jsx`
frontend. **Fixed this pass** — see Security report for full reproduction and remediation.

## 6. Operational finding — an unrelated file's middleware leak blocks legitimate CS access

`backend/routes/security.js` registers `router.use(attachWorkspace)` /
`router.use(requireWorkspaceMember)` with no path prefix (already documented as accidentally
*protecting* `governance.js` in the Organization OS pass). Here the same leak has the opposite
effect: it **blocks** legitimate `/customer-org/*` and `/launch/onboarding/*` requests from users
who hold a real Organization membership but no matching Workspace membership, because
`customer-org` uses the `Org` tenant model (`orgMiddleware.cjs`), not the `Workspace` model
`security.js` leaks. Verified this is an **availability** defect, not a security hole — the leaked
gate genuinely validates real workspace membership and cannot be spoofed. Documented as a
Genuine Gap, not fixed this pass (fixing the root cause means editing `security.js`, outside this
pass's declared file scope — see Final report's Remaining Limitations).

## 7. Key Discovery Findings

1. **Customer Success OS already exists and is substantial** — 3 core engines (~650 lines
   combined) plus support/automation/dashboard, 32 routes, real CRM/Finance integration, real
   frontend wiring (`CustomerSuccessCenter.jsx` calls `/customer-org/*` directly).
2. **A real, reproducible cross-tenant data leak** on journey/health/success-plan records, fixed
   with the exact precedented pattern the codebase's own `customerSupportEngine.cjs` already used.
3. **A dead-logic bug** in `listJourneys()`'s stage filter (a string-vs-boolean comparison that
   silently emptied any stage-filtered query) found and fixed alongside the tenant-isolation work,
   since both required touching the same function.
4. **Onboarding is genuinely functional**, not UI mock data — real steps, real progress, real
   persistence, verified live.
5. **No fabricated health scores found** — no hardcoded `score: 50/75/100` fallback anywhere in the
   three engines.

---

**Outcome:** Customer Success OS is a recovery/verification target. One security defect (3 engines)
found, root-caused, and fixed with a negative test and live re-verification against two real
organizations. One dead-logic bug fixed as a byproduct. One operational gap documented. **0 systems
built.**
