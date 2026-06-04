# Razorpay Production Guide — JARVIS-OS / Ooplix

**Audit date:** 2026-06-05

---

## Audit Results

| Area | Status | Notes |
|------|--------|-------|
| Payment link creation | PASS | `paymentService.createPaymentLink()` — live keys set |
| Webhook HMAC verification | PASS | `crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)` on raw body |
| Raw body capture | PASS | `middleware/rawBody.js` runs before `express.json()` |
| Subscription flow | PASS | `billingService.createRazorpaySubscription()` — plan IDs via env |
| Billing lifecycle (activate/cancel) | PASS | `webhookController` handles `subscription.activated/cancelled/completed` |
| Payment captured → CRM update | PASS | `crm.updateLead()` + `automation.triggerFulfillment()` |
| Payment failed event | PASS (fixed) | Now logged in webhookController |
| Refund processed event | PASS (fixed) | Now logged in webhookController |
| Upgrade flow | PASS | Falls back to payment link if plan IDs not set |
| Webhook secret — dev mode | WARN | Passes without secret only in non-production NODE_ENV |
| Webhook secret — production | FAIL if blank | `RAZORPAY_WEBHOOK_SECRET` required — blocks all webhooks if missing |

---

## Architecture

```
User clicks Upgrade
       │
       ▼
POST /billing/upgrade
       │
       ├─ RAZORPAY_PLAN_ID_GROWTH set? ──► rz.subscriptions.create() → shortUrl → redirect user
       │
       └─ Plan ID not set? ─────────────► payment.createPaymentLink() → shortUrl → redirect user

User completes payment on Razorpay checkout
       │
       ▼
POST /webhook/razorpay   (or /razorpay-webhook)
       │
       ├─ rawBody captured before express.json()
       ├─ HMAC verify (SHA-256, RAZORPAY_WEBHOOK_SECRET)
       │
       ├─ payment.captured ──► crm.updateLead(paid) + triggerFulfillment()
       ├─ subscription.activated ──► billing.activatePlan(accountId, plan, subId)
       ├─ subscription.cancelled ──► billing.cancelPlan(accountId)
       ├─ subscription.completed ──► billing.cancelPlan(accountId)
       ├─ payment.failed ──► logger.warn (retry tracking)
       └─ refund.processed ──► logger.info
```

---

## Subscription Plan Mapping

Plans are mapped from Razorpay `plan_id` via environment variables:

```env
RAZORPAY_PLAN_ID_STARTER=plan_xxxx   # ₹999/month
RAZORPAY_PLAN_ID_GROWTH=plan_yyyy    # ₹2499/month
RAZORPAY_PLAN_ID_SCALE=plan_zzzz     # Custom pricing
```

If not set, all upgrades fall back to one-time payment links (no auto-renewal).

---

## Required Manual Steps

### Step 1 — Set Webhook Secret (BLOCKING)

Without this, all production webhooks are rejected and payments are never confirmed.

1. Open [Razorpay Dashboard](https://dashboard.razorpay.com) → **Settings → Webhooks**
2. Click **+ Add New Webhook**
3. URL: `https://app.ooplix.com/webhook/razorpay`
4. Events to enable:
   - `payment.captured`
   - `payment.failed`
   - `subscription.activated`
   - `subscription.cancelled`
   - `subscription.completed`
   - `refund.processed`
5. Secret: generate a strong random string and copy it
6. Set in `.env`:
   ```env
   RAZORPAY_WEBHOOK_SECRET=<your-webhook-secret>
   ```

### Step 2 — Create Subscription Plans (for auto-renewal)

If you want recurring subscriptions (vs one-time payment links):

1. Razorpay Dashboard → **Products → Subscriptions → Plans → Create Plan**
2. Create for each tier:

   **Starter** — ₹999/month:
   - Period: `monthly` | Interval: `1` | Amount: `99900` (paise)
   - Copy plan ID → `.env`: `RAZORPAY_PLAN_ID_STARTER=plan_xxxx`

   **Growth** — ₹2499/month:
   - Period: `monthly` | Interval: `1` | Amount: `249900`
   - Copy plan ID → `.env`: `RAZORPAY_PLAN_ID_GROWTH=plan_yyyy`

3. In subscription `notes`, pass `accountId` to link to a JARVIS account:
   ```json
   { "notes": { "accountId": "<user-account-id>" } }
   ```
   This is already done by `billingService.createRazorpaySubscription()`.

### Step 3 — Set BASE_URL to Production Domain

```env
BASE_URL=https://app.ooplix.com
```

Without this, payment callbacks point to `localhost:5050` and never reach your server.

### Step 4 — Switch from Test to Live Keys

Current `.env` has `rzp_live_*` key — **already on live mode**. Verify:

```bash
echo $RAZORPAY_KEY_ID   # Should start with rzp_live_
```

If still on test keys (`rzp_test_*`), replace with live keys from:
Razorpay Dashboard → **Settings → API Keys → Generate Live Key**

### Step 5 — Test End-to-End with Razorpay Test Mode

Before going fully live, run one test:

```bash
# 1. Create a payment link
curl -X POST http://localhost:5050/payment/link \
  -H "Content-Type: application/json" \
  -H "Cookie: jarvis_auth=<token>" \
  -d '{"amount": 999, "name": "Test User", "description": "Ooplix Starter"}'

# 2. Open the returned URL → complete payment with Razorpay test card
#    Card: 4111 1111 1111 1111  Expiry: any future date  CVV: any 3 digits

# 3. Check webhook received (in server logs):
#    [Webhook] Event: payment.captured
#    [Webhook] Payment captured — phone=... id=pay_xxx
```

### Step 6 — Configure Billing Grace Period (optional)

In `backend/services/billingService.js`:
```js
const GRACE_PERIOD_DAYS = 3;   // days after trial/subscription expiry before access cut
```
Adjust if needed before launch.

---

## Environment Variables — Complete Checklist

```env
# ── Already set ──────────────────────────────────────────────────────
RAZORPAY_KEY_ID=rzp_live_Sefw02YRABlczU      ✓ live key
RAZORPAY_KEY_SECRET=<secret>                  ✓ set

# ── Must set before launch ───────────────────────────────────────────
RAZORPAY_WEBHOOK_SECRET=                      ✗ REQUIRED — get from Razorpay Dashboard
BASE_URL=https://app.ooplix.com               ✗ REQUIRED — currently localhost

# ── Optional (enables auto-renewing subscriptions) ───────────────────
RAZORPAY_PLAN_ID_STARTER=                     ○ optional — one-time links work without it
RAZORPAY_PLAN_ID_GROWTH=                      ○ optional
RAZORPAY_PLAN_ID_SCALE=                       ○ optional
```

---

## Remaining Manual Blockers Summary

| Priority | Item | Effort |
|----------|------|--------|
| **CRITICAL** | Set `RAZORPAY_WEBHOOK_SECRET` from Dashboard | 5 min |
| **CRITICAL** | Set `BASE_URL=https://app.ooplix.com` | 1 min |
| High | Register webhook URL in Razorpay Dashboard | 5 min |
| Medium | Create subscription plans + set `RAZORPAY_PLAN_ID_*` | 15 min |
| Low | Run end-to-end test payment | 10 min |

**Code is production-ready. Only credentials and Dashboard config remain.**
