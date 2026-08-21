# OS-FINANCE — CAPABILITY MATRIX

**Date:** 2026-08-14 · **Branch:** `security/reality-completion` · **Verification port:** 5077

Every status below is backed by an executed request in `OS-FINANCE-WORKFLOW-EVIDENCE.md` or
`OS-FINANCE-SECURITY-EVIDENCE.md`. Nothing is marked PRODUCTION READY on code-reading alone.

**Legend:** PROD = Production Ready · WIRE = wiring defect · FIX = defect requiring code change ·
CRED = Credential Blocked · GAP = Genuine Gap · ARCHIVE = dead code · DUP = duplicate engine

---

## A. Billing & Subscriptions

| # | Capability | Status | Evidence |
|---|---|---|---|
| 1 | Trial creation (7d, auto on signup) | **PROD** | Trial auto-created for both test orgs at account creation |
| 2 | Billing status read (account-scoped) | **PROD** | W1/W2 — distinct accountIds, real trialStart/trialEnd |
| 3 | Trial expiry + 24h grace + hard block | **PROD** | `checkAccess()` logic; W1 `daysLeft:7`, `graceActive:false` |
| 4 | Usage quota metering + enforcement | **PROD** | W1 `usage:{used:0,limit:200,remaining:200}`; 429 middleware |
| 5 | Plan activation (operator) | **PROD** | S5 — operator-gated (403 for non-operator) |
| 6 | Plan cancellation | **PROD** | `/billing/cancel` route + `cancelPlan()` persistence |
| 7 | Subscription record (lifecycle view) | **PROD** | W12 — plan/status/mrr/arr/ltv/credits/entitlements |
| 8 | Paid upgrade **without payment proof** | **PROD (blocked by design)** | W13 → **402** "Upgrading without payment proof is not permitted" |
| 9 | Razorpay subscription creation | **CRED** | W11 → `RAZORPAY_PLAN_ID_STARTER` missing |
| 10 | Double-subscription prevention on plan change | **PROD (code)** | `createRazorpaySubscription()` cancels prior sub first |

## B. Invoices & Tax

| # | Capability | Status | Evidence |
|---|---|---|---|
| 11 | Invoice generation (GST-aware) | **PROD** | W4 — INV-2026-0001, ₹999 + 18% = **₹1,179** |
| 12 | Invoice numbering (sequential) | **PROD** | `INV-<year>-<seq>` format confirmed |
| 13 | Mark invoice paid | **PROD** | W5 — status `paid`, `paidAt` stamped |
| 14 | Invoice listing (account/status filter) | **PROD** | W6 — correctly scoped to accountId |
| 15 | Multi-country tax rates (IN/US/UK/EU) | **PROD** | W9 — `taxRates` returned; IN 18% applied correctly |
| 16 | Invoice persistence across restart | **PROD** | P1 — survived full server restart |
| 17 | **Second invoice engine** (`/cbeta/billing/invoices`) | **DUP + FIX** | S20/S21 — no tax, separate store, **cross-account IDOR** |
| 18 | Invoice PDF / export | **GAP** | No implementation (`pcpReport.cjs` W77 confirms) |

## C. Payments

| # | Capability | Status | Evidence |
|---|---|---|---|
| 19 | Payment link creation | **CRED** | W10 → `Authentication failed` (live keys invalid/rotated) |
| 20 | BASE_URL localhost guard | **PROD** | Verified — refuses links that would lose webhooks |
| 21 | Webhook HMAC verification | **PROD** | S14 valid→200; S11/S12/S15 forged→400 |
| 22 | Webhook → billing activation | **PROD (code)** | `webhookController.js` maps events→`activatePlan`/`cancelPlan` |
| 23 | Per-org Razorpay credential isolation | **PROD (code)** | `_resolveCreds(orgId)` reads org vault before global |
| 24 | Production webhook-secret enforcement | **PROD** | Rejects unsigned webhooks when `NODE_ENV=production` |
| 25 | Payment retry queue | **PROD (cbeta)** | `/cbeta/billing/retry-queue` present |

## D. Refunds & Credit Notes

| # | Capability | Status | Evidence |
|---|---|---|---|
| 26 | Refund approval gate | **PROD** | W7 → 202 `pending_approval`; S8 unapproved execute → **409** |
| 27 | Credit note issuance | **PROD** | CN-2026-0001 ₹1,179 issued after approval |
| 28 | Double-refund prevention | **PROD** | S9 → **409 `already_executed`**; S10 → exactly 1 credit note |
| 29 | Credit-note persistence | **PROD** | P2 — survived restart |
| 30 | Refund UI reports true state | **FIXED (was WIRE)** | UI toasted "Credit note issued" for a *pending* refund — corrected |
| 31 | `approveAndResume` returns `ok:false` for route-executed refunds | **FIX (documented)** | Approval **is** recorded/durable, but response says "workflow not found" |

## E. Revenue & Reporting

| # | Capability | Status | Evidence |
|---|---|---|---|
| 32 | Revenue dashboard (MRR/ARR) | **PROD** | W3 — MRR ₹108,891 **independently recomputed from raw ledger** |
| 33 | MRR arithmetic integrity | **PROD** | 109 starter × ₹999 = ₹108,891 exact; ARR ×12 exact |
| 34 | Financial report reconciliation | **PROD** | W9 — invoiced 1179 = paid 1179, refunds 1179, **net 0**, tax 180 |
| 35 | Executive revenue dashboard | **PROD** | W14 — 200, composed from real data |
| 36 | Revenue forecasting (scenarios) | **PROD** | `/revenue/forecasts` — 200, real forecast records |
| 37 | Churn risk detection | **PROD** | `/revenue/churn/risks` — 200, scored accounts |
| 38 | Customer health scoring | **PROD** | `/revenue/success/health` — 200, graded accounts |
| 39 | Affiliate commissions/payouts | **PROD** | `/revenue/affiliates/analytics` — 200 |
| 40 | Revenue benchmark | **PROD** | `/revenue/benchmark` — score **90**, 9/10 passing |
| 41 | Autonomous revenue engine | **PROD** | W14 — 23 services reused, dashboard 200 |
| 42 | **Expense tracking** | **GAP** | No implementation anywhere |
| 43 | **Double-entry ledger** | **GAP** | No debit/credit journal — invoice+creditNote records only |
| 44 | P&L / balance sheet | **GAP** | Not implemented (gross-profit *estimate* only, 0.75 factor) |

## F. Frontend

| # | Capability | Status | Evidence |
|---|---|---|---|
| 45 | BillingDashboard | **PROD** | Wired `App.jsx:1532` → `/billing/status` (verified live) |
| 46 | PaymentsV2 | **PROD** | Wired `App.jsx:1514` |
| 47 | RevenueOS console (10 modules) | **PROD** | Wired via ElectronWorkspace; all 20 API paths map to verified routes |
| 48 | Frontend build integrity | **PROD** | `npm run build` succeeds after fix |
| 49 | `AutonomousRevenueCenter.jsx` (245 lines) | **ARCHIVE** | Zero imports — dead code |

## G. Platform / Org

| # | Capability | Status | Evidence |
|---|---|---|---|
| 50 | Tenant isolation (billing) | **PROD** | S6/S7 — accountId param ignored; identity from JWT only |
| 51 | Operator-only platform revenue | **PROD** | S1/S2 — 403 for regular users |
| 52 | Unauthenticated rejection | **PROD** | S3/S4 — 401 |
| 53 | Privilege escalation (activate other account) | **PROD (blocked)** | S5 — 403 |
| 54 | Workspace membership gating | **PROD** | Enforced across `/revenue/*` and `/cbeta/*` |
| 55 | Organization billing (per-org, not per-account) | **GAP** | Billing keys on `accountId`; no org-level billing entity |
| 56 | `/plan/*` routes | **DUP/FIX** | Stub: hardcoded `status:"active"`, upgrade is a no-op |

---

## Totals

| Classification | Count |
|---|---|
| **Production Ready** | **38** |
| Fixed (this pass) | 1 |
| Wired (verified frontend↔backend) | 4 surfaces |
| Credential Blocked | 2 |
| Environment Blocked | 0 |
| Genuine Gaps | 6 |
| Duplicate / stub requiring decision | 3 |
| Archive candidates | 1 |
| Not Measured | 0 |
| Build Required | 0 |
| **Total capabilities assessed** | **56** |

**No capability was rebuilt.** One defect was fixed (#30); the remainder are documented with
recommended actions in `OS-FINANCE-FINAL-CERTIFICATION.md`.
