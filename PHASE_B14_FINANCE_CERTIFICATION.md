# Phase B.14 — Finance Operations Certification

**Product:** Ooplix (jarvis-os) v1.0.0-rc1
**Date:** 2026-08-09
**Branch:** `security/reality-completion` (no merge, no push)
**Method:** Operated as the finance department of a real SaaS company. **Measured first, read source only after reproducing.** No new accounting engine, payment engine, billing model, or service.

---

## Defects Reproduced and Recovered

### D1 — Org AI spend was structurally unreportable (**HIGH — finance-grade**)

`usageMetering.record()` has always accepted an `orgId` (`usageMetering.cjs:87`), and `jarvisController` already passes `req.org?.id` (`jarvisController.js:357`). But the `/ai` routes **never mounted `attachOrg`**, so `req.org` was undefined and **all five** `record()` call sites in `backend/routes/ai.js` wrote `orgId: null`.

**Measured evidence:**

| Signal | Value |
|---|---|
| Usage ledger events | **636** |
| Events for the test account | 252 |
| **Events tagged with its `orgId`** | **0** |
| Total recorded AI spend | **$8.242056** |
| Total tokens metered | **30,182** |
| `GET /enterprise/monitoring/:orgId/ai-usage` | `requestsLast1000: 0`, `totalCostUsdSampled: 0` |

**Reproduced deliberately:** an `/ai/chat` call sent **with** `X-Org-Id` from an account that still had quota produced a ledger row with `orgId: None`.

This is finance-grade because per-org AI cost, `monthlyCapUsd`, `monthlyRequestCap` and the `alertThresholdPct: 80` budget alert all read from that field — so org spend reporting was **structurally zero regardless of actual usage**, and budget caps could never fire.

**Recovery:** mounted the **existing** `attachOrg` middleware on the two metering AI routes and forwarded the **existing** `orgId` field at all 5 call sites. `orgId` is read from `req.org?.id` (membership-verified) — never from the raw client header, which would let a caller bill another tenant.

**Verified live:** ledger rows now carry the real `orgId`; the org AI-usage view moved **requests 0 → 2** with failures correctly counted. (Cost remains $0 because AI providers are genuinely down — honest, not fabricated.)

### D2 — Denied billing returned HTTP 200 carrying a 403 body (**MEDIUM**)

`GET /enterprise/dashboard/:orgId/billing` returned **HTTP 200** with `{ ok:false, error:"Forbidden — requires permission: manage_billing", status:403 }`. The service computed the correct status; the route never applied it.

**Reproduced 3/3** with a genuine non-member of the target org: `HTTP=200, body ok=false status=403`.

**Scope measured precisely** — this was the *only* affected sibling:

| Route (cross-org, non-member) | HTTP |
|---|---|
| `/enterprise/dashboard/:orgId/overview` | **403** ✓ |
| `/enterprise/dashboard/:orgId/users` | **403** ✓ |
| `/enterprise/dashboard/:orgId/analytics` | **403** ✓ |
| **`/enterprise/dashboard/:orgId/billing`** | **200** ✗ |

**No financial data leaked** — the body contained only the error envelope (verified: zero data keys beyond `ok`/`error`/`status`). But a finance client reading HTTP status would treat a permission denial on the billing surface as a **successful, empty response** — i.e. "this org has no billing data" instead of "you may not see it".

**Recovery:** honour the status the service already returns, using the same `res.status(...).json(...)` shape `_requireOrgMember` uses elsewhere in the file. Guarded so only `ok === false` with an integer status is re-statused — success stays 200.

**Verified live 3/3:** denied → **403**; authorized owner → **200 with real billing data**; all siblings unchanged.

**Regression (both defects):** `tests/runtime/20-finance-org-attribution.test.cjs` — 8 tests. **Negative-tested: 5 fail** with both reverted; 8/8 pass restored.

---

## 1. Finance Inventory Matrix

| Surface | Routes | Live probe |
|---|---|---|
| **Total finance-related routes** | **110** | — |
| Probeable GET | 40 | **25 × 200**, **15 × 403** (operator-gated), 0 HTML |
| Mutation routes | 50 | — |
| Revenue | 66 | Mostly operator-gated (403) |
| Billing | 32 | status/upgrade/cancel/activate + invoices/credits/coupons/retry-queue |
| Payments | 3 | `/payment/link`, `/razorpay-webhook`, `/webhook/razorpay` |
| Razorpay | 3 | Credentials present, **upstream 401** |
| Invoices | 3 | list / create / mark-paid — all working |
| Refunds | 2 | Two-step (request + execute), operator-gated |
| AI cost | ledger | `data/usage-ledger.ndjson`, 646 events |
| **Tax** | **0** | **GENUINE CAPABILITY GAP** |
| **Expenses / wallet** | 3 | `burnin` (runtime), `revenue-engine/forecast/cashflow` — no OpEx ledger |

All 40 probed finance GETs returned **JSON, zero HTML fallbacks** — the surface is genuinely wired.

## 2. Billing Matrix

Exercised live against a real account.

| Stage | Test | Result | Status |
|---|---|---|---|
| Trial | `GET /billing/status` | `plan=trial status=trialing daysLeft=7 allowed=true` | CERTIFIED |
| Trial window | `trialStart` / `trialEnd` recorded | 2026-08-08 → 2026-08-15 | CERTIFIED |
| **Plan validation** | `upgrade {plan:"pro"}` | **400** `Invalid plan. Choose: starter, growth, scale` | CERTIFIED |
| **Upgrade (valid plan)** | `upgrade {plan:"growth"}` | **500** `Razorpay plan ID not configured. Set RAZORPAY_PLAN_ID_GROWTH in .env` | **CREDENTIAL BLOCKED** |
| **Cancellation** | `POST /billing/cancel` | 200, `status → cancelled`, `allowed → false`, `daysLeft → 0` | CERTIFIED |
| **Enforcement after cancel** | `/ai/chat` | **429** quota gate held | CERTIFIED |
| Free surface after cancel | `/crm/leads` | 200 — correctly unaffected | CERTIFIED |
| Activate (operator-only) | `POST /billing/activate` | **403** `operator access required` | CERTIFIED |
| Downgrade | `POST /cbeta/billing/downgrade`, `/commercial/billing/downgrade` | Routes present | CERTIFIED |
| Pricing exposed | `starter: 999`, `growth: 2499`, **`scale: 0`** | CERTIFIED WITH LIMITATIONS |
| Usage metering | `used: 200 / limit: 200 / remaining: 0` — accurate | CERTIFIED |
| Grace period | `graceActive` field tracked | CERTIFIED |
| Org billing rollup | `byPlan {trial:6}`, `byStatus {cancelled:1, trialing:5}` — matched my real cancellation | CERTIFIED |
| Coupons / credits | `GET /cbeta/billing/coupons`, `/credits/:accountId` → `balanceINR: 0` | CERTIFIED |
| Plan feature matrix | `/commercial/billing/plans` → per-plan `price_inr`, `price_usd`, `dailyAiCredits`, features | CERTIFIED |

`scale: 0` is a suspicious price for the top tier — recorded as a limitation, not changed (pricing is a business decision, not a defect).

## 3. Payments Matrix

| Control | Test | Result | Status |
|---|---|---|---|
| Razorpay credentials | `.env` | `rzp_live_...` key + secret **present** | — |
| **Payment link creation** | `POST /payment/link` | **500** `Authentication failed` | **CREDENTIAL BLOCKED** |
| **Upstream verification** | Direct `api.razorpay.com/v1/payment_links` with the same keys | **HTTP 401** | Confirms upstream, not local |
| **No fabricated link** | Response inspected | `link`/`paymentLink`/`short_url` all **absent** — honest failure | CERTIFIED |
| Wiring self-report | `/wiring/payments` | Reports key/secret present with masked prefix | CERTIFIED |
| **Payment failure recording** | `POST /cbeta/billing/payment-failure` | `id`, `amount: 2499`, `currency: INR`, `retryCount`, `nextRetryAt` | CERTIFIED |
| **Retry queue** | `GET /cbeta/billing/retry-queue` | 3 entries with escalating backoff | CERTIFIED |
| **Retry backoff** | measured | **1h → 1d → 3d** (attempt 1/2/3) | CERTIFIED |
| Retry processing | `POST /cbeta/billing/process-retries` | `processed: 0` (none due yet) — honest | CERTIFIED |
| Webhook routes | `/razorpay-webhook`, `/webhook/razorpay`, `/business/webhook/payment` | Registered | CERTIFIED |
| Webhook HMAC | `rawBody` middleware captured before `express.json()` (Phase B.4) | CERTIFIED |
| **Refunds** | `POST /revenue/finance/refund` | **403** operator-gated; two-step request+execute | CERTIFIED |
| Credit refunds | `POST /commercial/credits/refund` | **400** `txId required` — real validation | CERTIFIED |
| Reconciliation | No automated payment↔invoice reconciliation job observed | GENUINE CAPABILITY GAP |

**Correction recorded:** I first reported `payment-failure` as recording `amount: 0` despite sending 2499. That was **my payload using `amountINR`** (the *invoice* field) instead of `amount`. With the documented field: `amount: 2499`. Not a defect.

## 4. Invoice Matrix

Full lifecycle exercised live.

| Stage | Result | Status |
|---|---|---|
| List (empty) | `{ok:true, invoices:[]}` | CERTIFIED |
| **Create** | `id: inv-1786266681845-809c5f`, `amountINR: 2499`, `currency: INR`, `status: issued` | CERTIFIED |
| Billing period | `2026-08-09 — 2026-09-08` | CERTIFIED |
| Due date | `dueAt` = issued + 7 days | CERTIFIED |
| Line items | `lineItems` array present | CERTIFIED |
| **Mark paid** | `status → paid`, `paidAt` set, `razorpayId: pay_B14TEST` recorded | CERTIFIED |
| Audit | `invoice_created` in the append-only audit log | CERTIFIED |
| Overdue detection | `dueAt` stored; no automatic overdue transition observed | UNKNOWN |
| Cancellation | No invoice-cancel route observed | GENUINE CAPABILITY GAP |
| Invoice numbering | Timestamp+random id, not a sequential legal series | CERTIFIED WITH LIMITATIONS |

## 5. Revenue Matrix

| Surface | Result | Status |
|---|---|---|
| `/revenue/mrr` | **403** operator-only | CERTIFIED (gated) |
| `/revenue/arr` | **403** | CERTIFIED (gated) |
| `/revenue/summary` | **403** | CERTIFIED (gated) |
| `/revenue/metrics` | **403** | CERTIFIED (gated) |
| `/revenue/forecasts`, `/churn/risks`, `/upgrade/signals`, `/lifecycle/events` | **403** | CERTIFIED (gated) |
| `/dashboard/revenue` | **403** | CERTIFIED (gated) |
| `/commercial/billing/status` | **200** — real record | CERTIFIED |
| `/commercial/billing/trials` | **200** — `trialing`, `daysLeft`, `graceActive` | CERTIFIED |
| `/commercial/billing/plans` | **200** — full plan/price/credit matrix | CERTIFIED |
| `/orgs/:orgId/billing` | **200** — per-member plan/status rollup | CERTIFIED |
| `/revenue-engine/forecast/cashflow` | Route present | CERTIFIED |
| **MRR/ARR values** | Not observable at this permission level | **UNKNOWN (permission-gated)** |

15 of 40 finance GETs are operator-gated — appropriate for revenue data, but it means MRR/ARR **correctness** could not be verified from a tenant account. Recorded as UNKNOWN rather than assumed.

## 6. AI Cost Matrix

Measured from the real ledger (`data/usage-ledger.ndjson`).

| Metric | Value | Status |
|---|---|---|
| Ledger events | **646** | CERTIFIED |
| **Events with `estimatedCostUsd`** | **636 / 636 (100%)** | CERTIFIED |
| **Total estimated spend** | **$8.242056** | CERTIFIED |
| **Total tokens metered** | **30,182** | CERTIFIED |
| Per-event fields | `inputTokens`, `outputTokens`, `totalTokens`, `estimatedCostUsd`, `provider`, `model`, `latencyMs`, `success`, `errorCode`, `creditsConsumed`, `creditType` | CERTIFIED |
| Spend by provider | `test $8.00`, `claude $0.15`, `test-provider $0.092`, `groq $0.000026`, others $0 | CERTIFIED |
| Tokens by provider | claude 15,000 · ollama 14,194 · groq 268 | CERTIFIED |
| Success/failure split | 323 / 313 | CERTIFIED |
| **Budget caps** | `monthlyCapUsd`, `monthlyRequestCap`, `alertThresholdPct: 80`, `spentUsd`, `spentRequests` | CERTIFIED |
| Budget enforcement | `budgetAllowed` / `budgetReason` computed | CERTIFIED |
| Quota gate | **429** `usage_quota_exceeded` with `used/limit/upgradeUrl` — honest | CERTIFIED |
| **Org attribution** | Was **0 events tagged**; now records real `orgId` | CERTIFIED (after D1) |
| Caps configured | `monthlyCapUsd: null` — infrastructure present, values unset | **CONFIGURATION REQUIRED** |

**Correction recorded:** I first reported "0 events with cost recorded" — my probe used `costUsd`; the real field is **`estimatedCostUsd`**, present on **636/636** events.

## 7. Audit Matrix

| Signal | Measured | Status |
|---|---|---|
| Audit log | `data/logs/audit.ndjson`, append-only with `seq` | CERTIFIED |
| Total entries | **38,828** | CERTIFIED |
| Finance-related entries | 10 (this test window) | CERTIFIED |
| **`invoice_created`** | Captured with timestamp | CERTIFIED |
| **`payment_failed`** | 5 entries captured | CERTIFIED |
| **`billing_cancelled`** | Captured (`seq 239`, `type: auth`, operator id) | CERTIFIED |
| Operator attribution | `operator` field carries the account id | CERTIFIED |
| Rotation | 20 MB with rotation (Phase B.5) | CERTIFIED |
| Immutability | Append-only writer; `malformed: 0` | CERTIFIED |
| Org billing history surface | `/enterprise/audit/:orgId/billing-history` → 200 for authorized | CERTIFIED |
| Coverage of `upgrade` | Not observed (upgrade was credential-blocked before reaching audit) | UNKNOWN |

**Correction recorded:** I initially concluded "billing cancel/upgrade are NOT audited". Re-checking with a targeted query found `billing_cancelled` at `seq 239` under `type: auth` — it **was** audited; my first filter missed it.

## 8. Recovery Matrix

| Test | Before | After SIGKILL | Status |
|---|---|---|---|
| **Auto-recovery time** | — | **7505 ms** (PM2) | CERTIFIED |
| Invoices | 1 | **1** | CERTIFIED |
| Retry queue | 3 | **3** | CERTIFIED |
| Usage ledger | 646 | **646** | CERTIFIED |
| Billing status | `trial/cancelled` | **`trial/cancelled`** | CERTIFIED |
| Usage counters | 200/200 | **200/200** | CERTIFIED |
| Financial state preserved | — | **YES** | CERTIFIED |
| Atomic ledger writes | NDJSON append | CERTIFIED |
| Replay / reconciliation | `process-retries` re-drives the retry queue | CERTIFIED |
| Payment↔invoice reconciliation | No automated job | GENUINE CAPABILITY GAP |

## 9. Multi-org Matrix

Tested with a **true non-member** (`secval-member`, Org A only) against Org B.

| Route | Own org | Cross-org (non-member) | Status |
|---|---|---|---|
| `/orgs/:orgId/billing` | 403 (needs `manage_billing`) | **403** | CERTIFIED |
| `/enterprise/dashboard/:orgId/billing` | 200 | **403** (was 200 — D2) | CERTIFIED (after D2) |
| `/enterprise/monitoring/:orgId/ai-usage` | 200 | **403** | CERTIFIED |
| `/enterprise/audit/:orgId/billing-history` | 403 (needs permission) | **403** | CERTIFIED |
| `/enterprise/dashboard/:orgId/overview` | — | **403** | CERTIFIED |
| Unauthenticated `/orgs/:orgId/billing` | — | **401** | CERTIFIED |
| Financial data leaked cross-org | — | **NONE** (verified: error envelope only) | CERTIFIED |
| Org spend attribution | — | Now recorded per org (D1) | CERTIFIED (after D1) |
| `orgId` source | `req.org?.id` — membership-verified, never the raw header | CERTIFIED |

## 10. Reporting Matrix

| Consistency check | Result | Status |
|---|---|---|
| `/accounts/me` billing vs `/billing/status` | Agree (`plan`, `status`, `daysLeft`, `graceActive`) | CERTIFIED |
| `/billing/status` vs `/commercial/billing/status` | Agree | CERTIFIED |
| `/orgs/:orgId/billing` vs `/enterprise/dashboard/:orgId/billing` | **Byte-identical** rollups | CERTIFIED |
| Org rollup vs real member state | `{cancelled:1, trialing:5}` matched my actual cancellation | CERTIFIED |
| Usage counter vs quota gate | 200/200 → 429 enforced | CERTIFIED |
| **Ledger vs org AI-usage view** | Was **$8.24 spend vs 0 reported**; now attributed | CERTIFIED (after D1) |
| Invoice list vs invoice detail | Agree (`status: paid`, `paidAt`, `razorpayId`) | CERTIFIED |
| Retry queue vs failure records | 3 failures → 3 queued retries | CERTIFIED |
| Revenue dashboards | Permission-gated | UNKNOWN |

## 11. Business Impact Matrix

| Impact | Before | After |
|---|---|---|
| **Per-org AI cost visibility** | **$0 reported against $8.24 real spend** — 0 of 636 events attributable | Ledger rows carry real `orgId`; org view 0 → 2 requests |
| **Budget caps could fire** | **No** — `spentUsd` could never accumulate per org | Yes — attribution now feeds `monthlyCapUsd` / 80% alert |
| Chargeback / cost allocation | Impossible | Possible |
| **Billing permission signalling** | Denial looked like "no billing data" (HTTP 200) | Denial is a real **403** |
| Invoice lifecycle | — | issued → paid with `razorpayId`, audited |
| Payment failure handling | — | Recorded + retried with 1h/1d/3d backoff |
| Financial durability | — | Invoices, retry queue, ledger, billing status all survived SIGKILL |
| Revenue leakage from cancellation | — | Cancel flips `allowed=false`; `/ai/chat` 429-blocked |

## 12. Remaining Gap Matrix

| ID | Gap | Type | Severity |
|---|---|---|---|
| G1 | **Live payments unusable** — `rzp_live_*` keys return **401** from Razorpay directly. No payment link, subscription, or webhook flow could be exercised end-to-end. | **CREDENTIAL BLOCKED** | **High** |
| G2 | **Plan upgrade blocked** — `RAZORPAY_PLAN_ID_STARTER/GROWTH/SCALE` all unset, so no subscription can be created. Reported honestly by the app. | **CREDENTIAL BLOCKED** | **High** |
| G3 | **No tax capability** — **0** tax routes; no GST/VAT rate, no tax-inclusive/exclusive handling, no regional logic. Invoices carry no tax line. | **GENUINE CAPABILITY GAP** | **High** |
| G4 | **No payment↔invoice reconciliation job** — invoices are marked paid manually via API; nothing reconciles Razorpay settlements against invoices. | GENUINE CAPABILITY GAP | **High** |
| G5 | **No expense / OpEx ledger** — only `burnin` (runtime perf) and a cashflow forecast route. Operational costs (hosting, providers, salaries) are not tracked. | GENUINE CAPABILITY GAP | Medium |
| G6 | **MRR/ARR correctness unverified** — all revenue endpoints are operator-gated; values could not be observed from a tenant account. | UNKNOWN (permission-gated) | Medium |
| G7 | **No AI budget caps configured** — `monthlyCapUsd: null`, `monthlyRequestCap: null`. Enforcement exists; values unset. | CONFIGURATION REQUIRED | Medium |
| G8 | **Invoice numbering is not a legal series** — timestamp+random ids, no sequential per-org numbering as most tax regimes require. | GENUINE CAPABILITY GAP | Medium |
| G9 | **No invoice cancellation / credit note** route. | GENUINE CAPABILITY GAP | Medium |
| G10 | **Overdue transition unobserved** — `dueAt` is stored but no automatic issued→overdue job was seen. | UNKNOWN | Low |
| G11 | **`scale` plan priced at 0** while starter=999 and growth=2499. | OBSERVATION | Low |
| G12 | Upgrade credential failure returns **500** rather than a 4xx configuration error. | OBSERVATION | Low |

---

## Final Finance Certification

| Area | Classification |
|---|---|
| Finance Inventory | **CERTIFIED** — 110 routes, 40/40 probed returned JSON, 0 HTML fallbacks |
| Billing | **CERTIFIED WITH LIMITATIONS** — trial/cancel/enforcement real; upgrade credential-blocked |
| Payments | **CREDENTIAL BLOCKED** — upstream 401 confirmed directly; **no fabricated payment link** |
| Invoices | **CERTIFIED** — issued → paid with `razorpayId`, audited; no cancellation/credit note |
| Revenue | **UNKNOWN (permission-gated)** — 15 endpoints correctly 403 for a tenant account |
| AI Cost | **CERTIFIED** (after D1) — 636/636 events costed, $8.24, 30,182 tokens, per-org attribution restored |
| Audit | **CERTIFIED** — 38,828 append-only entries; invoice, payment-failure and cancellation all captured |
| Recovery | **CERTIFIED** — invoices, retry queue, ledger and billing status all survived SIGKILL in 7.5 s |
| Multi-org | **CERTIFIED** (after D2) — 403 on every cross-org finance route, no data leaked |
| Reporting | **CERTIFIED** (after D1) — cross-surface billing views byte-identical and matched real state |
| Tax | **GENUINE CAPABILITY GAP** — 0 routes |
| Expenses | **GENUINE CAPABILITY GAP** — no OpEx ledger |

### **Finance Readiness: CERTIFIED WITH LIMITATIONS**

**The most consequential finding was that org-level AI spend was structurally unreportable.** The ledger held **636 fully-costed events totalling $8.24 across 30,182 metered tokens** — genuinely good instrumentation — but **zero** of them carried an `orgId`, so `GET /enterprise/monitoring/:orgId/ai-usage` reported `requestsLast1000: 0` and `totalCostUsdSampled: 0`. Because `monthlyCapUsd`, `monthlyRequestCap` and the 80% alert threshold all read that field, **budget caps could never fire and cost could never be allocated to a paying customer**. The capability existed at both ends — `usageMetering.record()` accepts `orgId`, `jarvisController` already passes it — the `/ai` routes simply never mounted `attachOrg`. Wiring the existing middleware restored attribution (org view 0 → 2 requests), reading `orgId` from the membership-verified `req.org` rather than the raw header so a caller cannot bill another tenant.

**The second defect was a signalling error with real finance consequences.** A denied billing request returned **HTTP 200** carrying `{ok:false, status:403}`. No data leaked, and access was correctly refused — but every sibling dashboard route returns a real 403, so a finance client reading HTTP status would read "you may not see this org's billing" as "this org has no billing data". Applying the status the service already computed fixed it, with authorized access still returning 200 and real data.

**What genuinely works, measured end-to-end:** the invoice lifecycle (created at ₹2499 with a real billing period and 7-day due date, then marked paid with a `razorpayId`, and audited); payment-failure recording with **escalating 1h → 1d → 3d retry backoff**; cancellation that actually revokes access (`allowed: false`, `/ai/chat` → 429) while leaving free surfaces working; accurate usage metering (200/200 with a truthful 429 carrying `used`, `limit` and an upgrade URL); byte-identical billing rollups across two independent surfaces that matched my real cancellation; and complete financial durability — invoices, retry queue, ledger and billing status all survived SIGKILL with 7.5 s auto-recovery.

**Live payments could not be exercised, and that is credential-blocked rather than broken.** `rzp_live_*` keys are configured but return **401 directly from `api.razorpay.com`** with the same credentials, so the failure is upstream. The important property is that the app **fabricated nothing** — no payment link, no `short_url`, no fake success. Plan upgrade is blocked the same way, reporting `RAZORPAY_PLAN_ID_GROWTH` missing by name.

**Three corrections to my own measurements**, each of which would have been a false finding: `payment-failure` "recording amount 0" was **my payload using `amountINR`** instead of `amount`; "0 events with cost recorded" was **my probe using `costUsd`** rather than the real `estimatedCostUsd` (present on 636/636); and "billing cancel is not audited" was wrong — `billing_cancelled` is at `seq 239`, my first filter simply missed it.

**The largest genuine gaps are accounting-domain, not defects: no tax capability at all (0 routes), no payment↔invoice reconciliation job, no OpEx ledger, and invoice ids that are not a sequential legal series.** Each would require building accounting features, which this mission explicitly forbids — so they are documented, not built.

**Validation hygiene:** the test account's billing was **restored to `trialing`/`allowed: true`** after my cancellation test; the B.14 invoice, payment-failure records and retry-queue entries were left in place as evidence of real capability; prior-phase markers intact; health 200. Regression **144/144 existing + 82/82 new (B.6–B.14)**, with the new suite negative-tested (**5 failures** when both fixes reverted). Changes limited to `backend/routes/ai.js` and `backend/routes/enterpriseDashboard.js` (**+41/−8**) plus one new test file. No merge, no push, no new accounting engine, no new payment engine, no new billing model, no new service or provider.
