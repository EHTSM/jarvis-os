# Razorpay Launch Checklist — Ooplix

All backend code is implemented. The following manual steps are required in the Razorpay dashboard and `.env`.

---

## Current Status (auto-detected)

| Item | Status |
|---|---|
| Webhook HMAC verification code | ✅ Implemented (`backend/services/paymentService.js`) |
| Subscription creation API call | ✅ Implemented (`backend/services/billingService.js`) |
| Payment link fallback | ✅ Implemented |
| Webhook route | ✅ `/webhook/razorpay` + `/razorpay-webhook` |
| RAZORPAY_KEY_ID in .env | ❌ Missing |
| RAZORPAY_KEY_SECRET in .env | ❌ Missing |
| RAZORPAY_WEBHOOK_SECRET in .env | ❌ Missing |
| RAZORPAY_PLAN_ID_STARTER in .env | ❌ Missing |
| RAZORPAY_PLAN_ID_GROWTH in .env | ❌ Missing |

---

## Step 1 — Create Razorpay Account

1. Go to [https://dashboard.razorpay.com/signup](https://dashboard.razorpay.com/signup)
2. Complete KYC verification (required for live keys):
   - Business type: **Sole Proprietorship** or **Private Limited**
   - PAN card + bank account details
   - Expected approval time: 1–3 business days
3. Once approved, switch to **Live** mode (top-right toggle)

---

## Step 2 — Get API Keys

1. Dashboard → **Settings** → **API Keys** → **Generate Live Key**
2. Copy:
   - **Key ID**: `rzp_live_XXXXXXXXXXXX`
   - **Key Secret**: shown once — save immediately

```env
RAZORPAY_KEY_ID=rzp_live_XXXXXXXXXXXX
RAZORPAY_KEY_SECRET=<paste-secret>
```

For testing before going live, use test keys:
```env
RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXX
RAZORPAY_KEY_SECRET=<paste-test-secret>
```

---

## Step 3 — Create Subscription Plans

The backend maps plans to Razorpay Plan IDs via env vars:
- `RAZORPAY_PLAN_ID_STARTER` → ₹999/month
- `RAZORPAY_PLAN_ID_GROWTH` → ₹2,499/month

### Create each plan in Razorpay Dashboard:

1. Dashboard → **Subscriptions** → **Plans** → **+ Create Plan**
2. For **Starter plan**:
   - Plan name: `Ooplix Starter`
   - Billing amount: `999`
   - Currency: `INR`
   - Billing period: `monthly`
   - Interval: `1`
   - Copy the generated **Plan ID** (format: `plan_XXXXXXXXXXXX`)
3. For **Growth plan**:
   - Plan name: `Ooplix Growth`
   - Billing amount: `2499`
   - Currency: `INR`
   - Billing period: `monthly`
   - Interval: `1`
   - Copy the **Plan ID**

```env
RAZORPAY_PLAN_ID_STARTER=plan_XXXXXXXXXXXX
RAZORPAY_PLAN_ID_GROWTH=plan_XXXXXXXXXXXX
```

---

## Step 4 — Configure Webhook

1. Dashboard → **Settings** → **Webhooks** → **+ Add New Webhook**
2. Webhook URL: `https://app.ooplix.com/webhook/razorpay`
3. Secret: Generate a strong random string:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. Select events to subscribe:
   - ✅ `payment.captured`
   - ✅ `payment.failed`
   - ✅ `subscription.activated`
   - ✅ `subscription.cancelled`
   - ✅ `subscription.charged`
5. Click **Save**
6. Copy the **Secret** you used:

```env
RAZORPAY_WEBHOOK_SECRET=<paste-secret-you-generated>
```

---

## Step 5 — Test the Webhook

Use Razorpay's test webhook trigger or `curl`:

```bash
# Trigger a test event from Razorpay dashboard:
# Settings → Webhooks → your webhook → "Send Test Event"

# Or test locally with ngrok:
ngrok http 5050
# Update webhook URL to your ngrok URL temporarily
```

The backend logs webhook events:
```bash
pm2 logs jarvis | grep "\[Webhook\]"
```

Expected success log:
```
[Webhook] Event: payment.captured
[Webhook] Payment captured — phone=+91XXXXXXXXXX id=pay_XXXX
```

---

## Step 6 — Upgrade Flow Verification

Test the full upgrade flow:

```bash
# 1. Get billing status (should show trial)
curl -H "Cookie: jarvis_auth=<token>" \
  https://app.ooplix.com/billing/status

# 2. Initiate upgrade
curl -X POST \
  -H "Cookie: jarvis_auth=<token>" \
  -H "Content-Type: application/json" \
  -d '{"plan":"starter"}' \
  https://app.ooplix.com/billing/upgrade

# Expected: { "success": true, "subscriptionId": "sub_XXX", "paymentUrl": "https://rzp.io/..." }
```

---

## Step 7 — Billing State

Current plan structure (from `backend/services/billingService.js`):

| Plan | Price | Features |
|---|---|---|
| `trial` | Free | 7-day trial, limited features |
| `starter` | ₹999/month | Full access |
| `growth` | ₹2,499/month | Full access + priority |
| `scale` | Custom | Enterprise |

Billing state is persisted to `data/billing.json`. After a `payment.captured` webhook, `billing.activatePlan()` is called automatically.

---

## Step 8 — Complete `.env` for Payments

```env
# Razorpay — REQUIRED for paid subscriptions
RAZORPAY_KEY_ID=rzp_live_XXXXXXXXXXXX
RAZORPAY_KEY_SECRET=<secret>
RAZORPAY_WEBHOOK_SECRET=<webhook-secret>
RAZORPAY_PLAN_ID_STARTER=plan_XXXXXXXXXXXX
RAZORPAY_PLAN_ID_GROWTH=plan_XXXXXXXXXXXX
```

---

## Remaining Manual Steps Summary

| # | Task | Where | Done? |
|---|---|---|---|
| 1 | Complete Razorpay KYC | razorpay.com | ❌ |
| 2 | Get live API keys | Dashboard → Settings → API Keys | ❌ |
| 3 | Create Starter plan (₹999/mo) | Dashboard → Subscriptions → Plans | ❌ |
| 4 | Create Growth plan (₹2,499/mo) | Dashboard → Subscriptions → Plans | ❌ |
| 5 | Create webhook with HMAC secret | Dashboard → Settings → Webhooks | ❌ |
| 6 | Set all 5 env vars in `.env` on server | VPS `.env` file | ❌ |
| 7 | Test upgrade flow end-to-end | curl / Postman | ❌ |

---

## Notes

- **Webhook verification** is already implemented with HMAC SHA-256. It rejects requests without a valid signature in production (`NODE_ENV=production`).
- **Raw body capture** is implemented in `backend/middleware/rawBody.js` — required for HMAC to work (JSON re-serialisation changes byte order).
- **Subscription cancellation** is handled via `POST /billing/cancel`.
- **Free tier / trial** does not require Razorpay — new accounts get a 7-day trial automatically.
