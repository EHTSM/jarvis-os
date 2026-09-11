# OS-FINANCE — SECURITY EVIDENCE

**Date:** 2026-08-14 · **Server:** `localhost:5077` · **Method:** executed attack attempts, not review

Two real tenants were used throughout:
Org A `e3e9ded9f7a101ec3d4573b8` · Org B `74a9ca050fd708865b7c38e4`

---

## 1. Authentication

| # | Test | Expected | Actual | Verdict |
|---|---|---|---|---|
| S3 | `GET /revenue/finance/report` unauthenticated | 401 | `401 {"error":"Unauthorized"}` | ✅ |
| S4 | `GET /billing/status` unauthenticated | 401 | `401 {"error":"Unauthorized"}` | ✅ |
| — | Bearer token in `Authorization` header | rejected | `401` — **cookie-only auth** | ✅ hardened |

`requireAuth` also **fails closed** when `JWT_SECRET` is missing (503), and the dev bypass requires
an explicit `ALLOW_DEV_AUTH_BYPASS=1` opt-in rather than merely `NODE_ENV!=="production"`.

## 2. Authorization — platform revenue is operator-only

| # | Test | Actual | Verdict |
|---|---|---|---|
| S1 | Regular user → `GET /revenue/dashboard` | **403** | ✅ |
| S2 | Regular user → `GET /revenue/finance/invoices` | **403** | ✅ |
| S5 | Org A → `POST /billing/activate` for **Org B** | **403** `Forbidden — operator access required` | ✅ |

Platform-wide MRR/ARR/churn is not readable by ordinary customers. Customers get only their own
account-scoped `/billing/status`.

## 3. Tenant isolation — no IDOR on billing

| # | Test | Actual | Verdict |
|---|---|---|---|
| S6 | Org A calls `/billing/status?accountId=<OrgB>` | Returned **Org A's own** record; param ignored | ✅ |
| S7 | Org B record after A's escalation attempt | **Unchanged** (`trial`/`trialing`) | ✅ |
| S16 | Org B after unauthorized paid-upgrade attempt | **Unchanged** — still `trial` | ✅ |

Account identity is derived **solely from the JWT** (`req.user.sub`), never from client-supplied
parameters. This is the correct pattern and it holds across `/billing/*`.

## 4. Payment webhook forgery resistance

The highest-risk finance surface: a forged webhook could grant paid plans for free.

| # | Test | Actual | Verdict |
|---|---|---|---|
| S11 | `payment.captured` forging Org A upgrade, **no signature** | **400** `Invalid signature` | ✅ |
| S12 | `subscription.activated` forging Org A, **bad signature** | **400** `Invalid signature` | ✅ |
| S13 | Org A plan after both forgery attempts | **Still `trial`** — no escalation | ✅ |
| S14 | **Valid** HMAC (benign `payment.failed`, synthetic id) | **200** `{"status":"ok"}` | ✅ |
| S15 | Same body, signature altered by **one character** | **400** `Invalid signature` | ✅ |

S14 is essential: it proves verification **accepts genuine signatures** rather than rejecting
everything. Combined with S15, HMAC-SHA256 verification is correct, and
`crypto.timingSafeEqual` with a length pre-check prevents timing attacks.

In production, a missing `RAZORPAY_WEBHOOK_SECRET` causes webhooks to be **rejected** (fails closed).

## 5. Refund safety

| # | Test | Actual | Verdict |
|---|---|---|---|
| W7 | Request refund | **202 `pending_approval`** — no credit note issued | ✅ |
| S8 | Execute **without** approval | **409 `not_approved`** | ✅ |
| S9 | Execute the **same approved refund twice** | **409 `already_executed`** | ✅ |
| S10 | Credit notes after double-execute attempt | **Exactly one** (CN-2026-0001) | ✅ |

**No double-refund is possible.** Money cannot leave twice through this path.

## 6. Revenue integrity — fabrication resistance

| # | Test | Actual | Verdict |
|---|---|---|---|
| W13 | Grant paid plan **without payment proof** | **402** — explicitly refused | ✅ |
| W3 vs raw ledger | MRR recomputed independently from `billing.json` | **Exact match** (₹108,891) | ✅ |
| W9 | Report reconciliation | invoiced = paid; net revenue **0** after refund | ✅ |

The system will not report revenue it cannot substantiate, and will not grant paid entitlements
without a verified Razorpay subscription id.

---

# FINDINGS

## F-1 — `/cbeta/billing/*` invoices & credits are not account-scoped (HIGH)

**Status:** Confirmed exploitable · **Not fixed** (outside Finance Center; requires owner decision)

`backend/routes/closedBeta.js` gates `/cbeta/*` with `requireAuth` only. The invoice and credit
handlers take `accountId` **from the request** with no ownership check.

**Evidence — cross-account read (S20).** An authenticated workspace member listed **all** invoices,
disclosing another account's real financial record:
```json
{"ok":true,"invoices":[{"id":"inv-1786266681845-809c5f",
  "accountId":"3e5082c84321b4973339d574","plan":"growth","amountINR":2499,
  "status":"paid","razorpayId":"pay_B14TEST",...}]}
```

**Evidence — forged invoice against an unowned account (S21).**
```json
{"ok":true,"id":"inv-1786661363298-32e4f2","accountId":"74a9ca050fd708865b7c38e4",
 "plan":"enterprise","amountINR":9999,"status":"issued"}
```

**Evidence — arbitrary credit creation (S22/S23).** Reading an unowned balance succeeded, then:
```json
{"ok":true,"accountId":"74a9ca050fd708865b7c38e4","creditId":"cred-1786661480797-59507a",
 "amountINR":5000,"newBalance":5000}
```
Any authenticated member can mint monetary credit on **any** account. There is no operator gate.

**Impact:** cross-tenant financial data disclosure; forged billing records; unauthorized credit
issuance. Note `/revenue/finance/*` (the primary Finance Center) is **not** affected — it is
`operatorOnly`. Exposure is limited to the parallel `cbeta` engine.

**Both test artifacts were reverted** (invoice deleted; credit balance restored to `null`).

**Recommended fix:** scope reads to `req.user.sub`, ignore client `accountId` unless the caller is
an operator, and gate `POST /cbeta/billing/credits` behind `operatorOnly`. Preferred longer-term
action: retire this duplicate engine in favour of `/revenue/finance/*` (see F-3).

## F-2 — Refund approval reports failure after succeeding (MEDIUM)

**Status:** Confirmed · **Not fixed** (shared approval engine — change would affect other OS tracks)

`POST /approval/approve/:reqId` for `wf_refund_finance` returns:
```json
{"ok":false,"error":"workflow not found","reqId":"aq_1786660533444_uaml"}
```
**Yet the approval is genuinely recorded and durable** — the subsequent execute call succeeded and
issued CN-2026-0001.

**Root cause:** `approvalEngine.approveAndResume()` records the approval (`approvalQueue.approve()`,
line 149) and *then* calls `_resumeExecution()`, which looks the workflow up in
`founderWorkRegistry` (line 190). `wf_refund_finance` is an **approval policy**
(`approvalPolicy.cjs:86`), not a registered FWR workflow, so the lookup fails and `{ok:false}` is
returned — after the approval has already been persisted.

**Impact:** misleading API contract. An operator (or automation) reading `ok:false` may retry or
assume the approval failed, while it actually succeeded. **Security posture is not weakened** —
the gate still blocks unapproved refunds (S8) and double execution (S9).

**Recommended fix:** have `_resumeExecution` treat route-executed approval policies as a success
path (return `{ok:true, resumed:false, reason:"route_executed"}`) rather than an error.

## F-3 — Duplicate invoice engine with divergent tax behaviour (MEDIUM)

Two independent invoice engines exist:

| | `/revenue/finance/*` | `/cbeta/billing/*` |
|---|---|---|
| Service | `revenueOS.cjs` | `closedBeta.cjs` |
| Store | `data/revenue-os.json` | `data/m6b-billing-ext.json` |
| **Tax** | **GST applied** (18% IN, multi-country) | **none** |
| Numbering | `INV-2026-0001` | `inv-<ts>-<rand>` |
| Auth | `requireAuth` + `operatorOnly` | `requireAuth` only (**F-1**) |

Invoices in one are invisible to the other, so `/revenue/finance/report` **excludes** all cbeta
invoices — financial reporting is incomplete by construction. Tax-free invoices are also a
compliance risk for Indian GST.

**Recommended:** retire the cbeta billing block; migrate its records into `revenueOS.cjs`.

## F-4 — `/plan/*` is a stub that reports a false state (LOW)

`backend/routes/plan-management.js` returns a **hardcoded** `status:"active"` and reads plan from
`process.env.CURRENT_PLAN`, ignoring the real billing record. `POST /plan/upgrade` returns
`"Upgrade to X initiated"` while changing **no** state.

Any UI trusting `/plan/current` would show an active paid plan for an expired trial.
**Recommended:** delete these routes in favour of `/billing/status`.

---

## Security posture summary

| Dimension | Verdict |
|---|---|
| Authentication | **Strong** — cookie-only, fails closed |
| Authorization (Finance Center) | **Strong** — operator-gated |
| Tenant isolation (billing) | **Strong** — no IDOR; JWT-derived identity |
| Tenant isolation (cbeta billing) | **WEAK — F-1** |
| Webhook forgery resistance | **Strong** — HMAC verified both directions |
| Refund safety | **Strong** — approval-gated, idempotent |
| Revenue fabrication resistance | **Strong** — 402 without payment proof |
| Financial data integrity | **Strong** — reconciles to source ledger |

**No credentials, secrets, or `.env` values were modified at any point.**
