# OS-FINANCE — DISCOVERY REPORT

**Track:** OOPLIX OS Development/Recovery — Finance OS
**Date:** 2026-08-14
**Branch:** `security/reality-completion`
**Method:** Repository-wide inspection BEFORE any build. No Finance capability was rebuilt.
**Isolation:** Verification server run on **port 5077** (dedicated). Port 5050 was observed being
restarted by the concurrent **Sales OS** session mid-run; moving to 5077 guaranteed zero interference
with Sales OS and Marketing/Growth OS work.

---

## 1. Discovery Method

Swept the repository for every Finance-domain artifact across the mandated surface areas
(billing, invoices, payments, subscriptions, plans, transactions, revenue, expenses, finance
dashboard, financial reporting, organization billing, Razorpay integration, refunds, payment
links, ledger, finance automation, finance AI, executive finance reporting).

Sources inspected: `backend/routes/`, `backend/services/`, `backend/controllers/`,
`backend/middleware/`, `frontend/src/`, `data/`, `tests/`.

---

## 2. Backend Inventory — Routes

| Route file | Lines | Mount | Purpose |
|---|---|---|---|
| `backend/routes/billing.js` | 112 | `/billing/*` | Trial status, upgrade, activate, cancel |
| `backend/routes/payment.js` | 30 | `/payment/*`, `/webhook/razorpay` | Payment link + Razorpay webhook |
| `backend/routes/revenueOS.js` | 330 | `/revenue/*` | **36 routes** — 10 revenue modules incl. Finance Center |
| `backend/routes/autonomousRevenue.js` | 201 | `/revenue-engine/*` | **28 routes** — discovery/optimization/pricing/forecast |
| `backend/routes/plan-management.js` | 39 | `/plan/*` | Current plan / upgrade (**stub**) |
| `backend/routes/closedBeta.js` (billing block) | — | `/cbeta/billing/*` | **Second** invoice + credits + coupons engine |
| `backend/routes/commercial.js` | — | `/commercial/*` | Credit engine, usage metering, billing core, feature gates |

Registration confirmed in `backend/routes/index.js` (lines 28, 30, 34, 117, 128, 142, 196, 210).

## 3. Backend Inventory — Services

| Service | Lines | Role |
|---|---|---|
| `billingService.js` | 335 | **Core billing.** Trial (7d + 24h grace), plan activate/cancel, usage quotas, Razorpay subscriptions, `requireActiveAccount` + `requireUsageQuota` middleware |
| `paymentService.js` | 175 | **Core payments.** Razorpay payment links, HMAC webhook verify, per-org credential isolation via secretVault |
| `revenueOS.cjs` | 1035 | **Finance Center.** Invoices w/ GST, credit notes/refunds, revenue report, MRR/ARR dashboard, subscription lifecycle, forecasting, affiliates |
| `closedBeta.cjs` (billing block) | — | **Duplicate** invoice engine + credits/coupons/retry queue |
| `revenueDashboard.cjs` | 290 | Revenue dashboard aggregation |
| `revenueForecastEngine.cjs` | 222 | Forecasting |
| `revenueAutomationEngine.cjs` | 241 | Finance automation |
| `revenueDiscoveryEngine.cjs` | 278 | Opportunity discovery |
| `revenueOptimizationEngine.cjs` | 225 | Pricing/optimization |
| `creditEngine.cjs` | — | Credit ledger (reused by refunds) |
| `usageMetering.cjs` | — | Usage ledger backing quota enforcement |
| `approvalQueue.cjs` / `approvalPolicy.cjs` | — | Refund approval gating (`wf_refund_finance`) |

## 4. Frontend Inventory

| Component | Lines | Wired? |
|---|---|---|
| `BillingDashboard.jsx` | 345 | ✅ `App.jsx:1532` |
| `PaymentsV2.jsx` | 424 | ✅ `App.jsx:1514` |
| `RevenueOS.jsx` | 1116 | ✅ `ElectronWorkspace.jsx:62,1221` |
| `PaymentPanel.jsx` | 307 | ✅ (payments surface) |
| `AutonomousRevenueCenter.jsx` | 245 | ❌ **Orphaned** — no import anywhere |
| `billingApi.js` / `paymentApi.js` | — | ✅ API clients |

## 5. Persistence Inventory

| File | Size | Contents |
|---|---|---|
| `data/billing.json` | 300 KB | **895 real accounts** — plan/status/trial/razorpaySubId |
| `data/revenue-os.json` | 4.9 MB | Invoices, credit notes, health, churn, forecasts, affiliates |
| `data/credit-ledger.json` | 316 KB | Credit ledger |
| `data/usage-ledger.ndjson` | 290 KB | Per-request usage metering (quota source) |
| `data/m6b-billing-ext.json` | 3 KB | **Duplicate store** — cbeta invoices/credits/coupons |
| `data/revenue-forecast.json` | 552 KB | Forecast runs |
| `data/revenue-automation.json` | 199 KB | Automation state |

## 6. Payment Integration State

Razorpay is the sole gateway (no Stripe implementation).

| Credential | State |
|---|---|
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY` | SET (23 chars) — **LIVE** key (`rzp_live_*`) |
| `RAZORPAY_KEY_SECRET` / `RAZORPAY_SECRET` | SET (24 chars) |
| `RAZORPAY_WEBHOOK_SECRET` | SET (64 chars) — **verified working** |
| `RAZORPAY_PLAN_ID_STARTER` | **MISSING** |
| `RAZORPAY_PLAN_ID_GROWTH` | **MISSING** |
| `BASE_URL` | SET (22 chars) |

Live API calls return `Authentication failed` → keys are invalid/rotated. Per mission constraints,
**no real financial transaction was executed** and `.env` was **not modified**.

## 7. Key Discovery Findings

1. **Finance OS already substantially exists.** ~2,800 lines of finance services + 64+ routes +
   4 wired UI surfaces, backed by 895 real billing accounts. Nothing needed rebuilding.
2. **Duplicate invoice engine** — `revenueOS.cjs` (GST-aware, `revenue-os.json`) and
   `closedBeta.cjs` (no tax, `m6b-billing-ext.json`) are independent and divergent.
3. **`/plan/*` is a stub** duplicating `/billing/*` with a hardcoded `status: "active"` and
   an upgrade endpoint that changes no state.
4. **No expense tracking** and **no double-entry ledger** anywhere — genuine gaps.
5. **Refunds are approval-gated** (`wf_refund_finance`) — a deliberate safety design.
6. **`AutonomousRevenueCenter.jsx`** is dead frontend code.

---

**Discovery outcome:** Finance OS is a recovery/verification target, not a build target.
Proceeded to MAP → VERIFY → RECOVER per mission order.
