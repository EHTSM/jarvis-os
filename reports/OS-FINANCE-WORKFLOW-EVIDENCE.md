# OS-FINANCE — WORKFLOW EVIDENCE

**Date:** 2026-08-14 · **Server:** `localhost:5077` (dedicated Finance verification instance)
**Test orgs:** Org A `e3e9ded9f7a101ec3d4573b8` · Org B `74a9ca050fd708865b7c38e4`
**Operator:** `33c4fb52d35e1c41f00788ec` (workspace `ws_1786660472626_22971bc3`)

All responses below are **verbatim** from executed HTTP requests. No output is reconstructed.

> **Financial safety:** No real financial transaction was executed. Razorpay live keys are
> present but invalid/rotated; all gateway calls failed at authentication and were classified
> Credential Blocked rather than forced through. `.env` was never modified.

---

## Trace path verified

```
Frontend (BillingDashboard/RevenueOS)
  → billingApi.js / fetch(credentials:"include")
  → Express route (/billing/*, /revenue/*)
  → requireAuth (cookie JWT) → operatorOnly → attachWorkspace/requireWorkspaceMember
  → billingService.js / revenueOS.cjs
  → data/billing.json + data/revenue-os.json (fs persistence)
  → JSON response
```

---

## W1 — GET /billing/status (Org A)

```json
{"success":true,"accountId":"e3e9ded9f7a101ec3d4573b8","plan":"trial","status":"trialing",
 "allowed":true,"daysLeft":7,"graceActive":false,
 "trialStart":"2026-08-13T22:25:32.358Z","trialEnd":"2026-08-20T22:25:32.358Z",
 "activatedAt":null,"prices":{"starter":999,"growth":2499,"scale":0},
 "usage":{"used":0,"limit":200,"remaining":200}}
```
**HTTP 200.** Real trial record; quota ledger read live.

## W2 — GET /billing/status (Org B)

```json
{"success":true,"accountId":"74a9ca050fd708865b7c38e4","plan":"trial","status":"trialing",
 "allowed":true,"daysLeft":7,"graceActive":false,
 "trialStart":"2026-08-13T22:25:32.398Z","trialEnd":"2026-08-20T22:25:32.398Z",...}
```
**HTTP 200.** Distinct accountId and distinct timestamps → per-account state, not shared.

## W3 — GET /revenue/dashboard (operator)

```json
{"ok":true,"dashboard":{"mrr":108891,"arr":1306692,"activeSubscriptions":879,
 "trialCount":770,"paidCount":109,"trialConversionRate":12,"churnRate":0.5,"ltv":11988,
 "expansionMRR":0,"grossMargin":75,
 "byPlan":{"trial":{"count":774,"mrr":0},"starter":{"count":109,"mrr":108891}},
 "totalAccounts":883,"cancelledCount":4}}
```
**HTTP 200.**

### Independent verification of the MRR arithmetic (anti-fabrication check)

Recomputed directly from `data/billing.json` without going through the service:

```
total accounts: 883
active: 109   trialing: 770   cancelled: 4
computed MRR: 108891   ARR: 1306692
byPlan(active): {"starter":109}
```

**Exact match** on every figure (109 × ₹999 = ₹108,891; ARR = ×12). Revenue is **derived from real
persisted records, not fabricated.**

## W4 — POST /revenue/finance/invoices (create, Org A)

Request: `{"accountId":"e3e9...","amount":999,"country":"IN","period":"Monthly"}`
```json
{"ok":true,"invoice":{"id":"inv-1786660507738-cnxkl","invoiceNumber":"INV-2026-0001",
 "accountId":"e3e9ded9f7a101ec3d4573b8","plan":"trial",
 "items":[{"description":"Trial Plan — Monthly","quantity":1,"unitPrice":999,"amount":999}],
 "subtotal":999,"taxRate":18,"taxAmount":180,"total":1179,"currency":"INR","country":"IN",
 "status":"issued","dueDate":"2026-08-28","paidAt":null,"issuedAt":"2026-08-13T22:35:07.739Z"}}
```
**HTTP 200.** GST correct: 999 + 18% (180) = **1179**.

## W5 — POST /revenue/finance/invoices/:id/pay

```json
{"ok":true,"invoice":{...,"status":"paid","paidAt":"2026-08-13T22:35:16.403Z",...}}
```
**HTTP 200.** State transition `issued → paid` persisted.

## W6 — GET /revenue/finance/invoices?accountId=A

Returns exactly the one invoice for Org A with `status:"paid"`. **HTTP 200.** Account filter works.

## W7 — POST /revenue/finance/refund (approval-gated)

```json
{"ok":true,"status":"pending_approval","reqId":"aq_1786660533444_uaml",
 "request":{"workflowId":"wf_refund_finance","risk":"high","approvalType":"PAYMENT_CONFIRM",
 "action":"Issue finance refund of 1179 for account e3e9... (invoice inv-...)"}}
```
**HTTP 202.** Refund did **not** execute on request — correctly queued for approval.

## W8 — Refund execution after approval

Credit note created only after the approval record existed:
```json
{"ok":true,"creditNote":{"id":"cn-1786660804792-jl05k","creditNoteNumber":"CN-2026-0001",
 "accountId":"e3e9ded9f7a101ec3d4573b8","invoiceId":"inv-1786660507738-cnxkl",
 "reason":"finance_os_verification","amount":1179,"status":"issued",
 "issuedAt":"2026-08-13T22:40:04.792Z"}}
```
**HTTP 200.** (See Finding F-2 in the security report regarding the approve endpoint's response.)

## W9 — GET /revenue/finance/report

```json
{"ok":true,"report":{"period":"monthly","mrr":108891,"arr":1306692,
 "totalInvoiced":1179,"totalPaid":1179,"totalOutstanding":0,"totalRefunds":1179,
 "totalTax":180,"netRevenue":0,"affiliateCosts":0,"grossProfit":0,
 "invoiceCount":1,"refundCount":1},
 "taxRates":{"IN":0.18,"US":0,"UK":0.2,"EU":0.21,"DEFAULT":0.18}}
```
**HTTP 200.** **Reconciles exactly** to the transactions executed above:
invoiced 1179 = paid 1179 → outstanding 0; refund 1179 → **net revenue 0**; tax 180. No drift.

## W10 — POST /payment/link

```json
{"error":"Authentication failed"}
```
**HTTP 500 — CREDENTIAL BLOCKED.** Razorpay live keys present but rejected by the gateway.
Not a code defect; the request reached Razorpay and failed at authentication.

**Guard verified separately** (no gateway call): with a localhost `BASE_URL`, the service refuses:
```json
{"success":false,"error":"BASE_URL is not set to a public domain. Set BASE_URL=https://yourdomain.com in .env so Razorpay can deliver payment webhooks."}
```
This correctly prevents creating live payment links whose webhooks would never arrive.

## W11 — POST /billing/upgrade (starter)

```json
{"error":"Razorpay plan ID not configured. Set RAZORPAY_PLAN_ID_STARTER in .env."}
```
**HTTP 500 — CREDENTIAL BLOCKED.** Accurate, actionable error. `.env` intentionally not modified.

## W12 — GET /revenue/subscriptions/:accountId (Org B)

```json
{"ok":true,"subscription":{"accountId":"74a9...","plan":"trial","status":"trialing",
 "planDetails":{"label":"Trial","priceMonthly":0,"maxSeats":1,"tier":0},
 "mrr":0,"arr":0,"ltv":0,"trialStart":"...","trialEnd":"...",
 "credits":{"plan_quota":20},"entitlements":["editor.basic",...]}}
```
**HTTP 200.** Composed from billingService + creditEngine + featureGate (reuse, no duplication).

## W13 — POST /revenue/subscriptions/:accountId/upgrade WITHOUT payment proof

```json
{"error":"razorpaySubId required — call billing.createRazorpaySubscription() (POST /billing/upgrade)
 first to obtain a real, verified Razorpay subscription before granting a paid plan.
 Upgrading without payment proof is not permitted."}
```
**HTTP 402.** **Revenue cannot be fabricated through the API.** Confirmed Org B remained `trial`
afterwards (S16) — no state change.

## W14 — Autonomous revenue engine + executive dashboard

`/revenue-engine/dashboard` → **HTTP 200**
```json
{"ok":true,"summary":{"revenueServicesReused":23,"mrr":108891,"arr":1306692,
 "pipelineValue":13141365.6,"forecastAccuracy":73,"renewalRate":100,
 "revenueHealthScore":90,"founderHoursSaved":1148.1}}
```
MRR/ARR agree with the independently verified figures.

## W15 — Remaining module sweep (operator, all HTTP 200)

| Route | Result |
|---|---|
| `/revenue/executive` | `mrr:108891, arr:1306692, netRevenue:0` |
| `/revenue/benchmark` | `score:90, passing:9, total:10, revenueReadiness:"nearly_ready"` |
| `/revenue/forecasts` | real forecast records returned |
| `/revenue/success/health` | scored accounts (e.g. `healthScore:41, grade:"C"`) |
| `/revenue/churn/risks` | scored risks (e.g. `riskScore:135, riskLevel:"critical"`) |
| `/revenue/affiliates/analytics` | `totalAffiliates:1, totalConversions:3` |
| `/revenue/lifecycle/events` | `events:[]` (empty — no events yet, honest result) |

---

## Persistence — verified across a full server restart

Server killed and restarted; state re-read from disk:

| Check | Result |
|---|---|
| **P1** Invoice `INV-2026-0001` | ✅ survived, still `status:"paid"` with `paidAt` intact |
| **P2** Credit note `CN-2026-0001` | ✅ survived, ₹1,179, invoice linkage intact |
| **P3** Org A billing record | ✅ survived, trial dates unchanged |

Persistence is **real file-backed durability**, not in-memory state.

---

## Performance

| Endpoint | Latency |
|---|---|
| `/revenue/dashboard` | 0.043 s |
| `/revenue/finance/report` | 0.061 s |
| `/revenue/executive` | 0.248 s |
| `/billing/status` | **0.654 s** |

`/billing/status` is the slowest: `checkUsageQuota()` calls `loadHistory(10000)` against the
290 KB `usage-ledger.ndjson` on **every** call. Acceptable today; a scaling concern as the ledger
grows (see Remaining Work).

---

## Regression

| Stage | Result |
|---|---|
| Baseline (before changes) | **144/144 pass** |
| After fix | **144/144 pass** |
| `tests/integration/11-closed-beta` | **96/96 pass** |
| `tests/integration/07-production-hardening` | **88/88 pass** |
| Frontend `npm run build` | **succeeds** |

No test was modified, skipped, or weakened.

---

## Test-artifact cleanup

Two artifacts created while probing the unscoped `/cbeta/billing/*` routes were **reverted**:

- Invoice `inv-1786661363298-32e4f2` (forged ₹9,999 enterprise invoice) — deleted
- Credit grant of ₹5,000 to Org B — deleted, balance restored to `null`

The intentional Finance-Center records (`INV-2026-0001`, `CN-2026-0001`) were **retained** as
reconciled evidence; they net to ₹0 revenue and are attributed to `finance_os_verification`.
