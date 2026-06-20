# API Reference

Base URL: `http://localhost:5050` (development) / `https://app.ooplix.com` (production)

All authenticated routes require a JWT cookie set by `POST /auth/login`. The session cookie is HttpOnly — pass `credentials: "include"` on all fetch calls.

---

## Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | — | Login with operator credentials. Returns session cookie. Body: `{ password }` |
| POST | `/auth/logout` | ✓ | Invalidate session |
| GET | `/auth/me` | ✓ | Current operator identity and plan |

---

## Health & Ops

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Server health: status, uptime, memory, services |
| GET | `/ops` | — | Operational stats: CRM, automation, queue, errors |
| GET | `/stats` | — | Aggregate usage statistics |

---

## Accounts

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/accounts/register` | — | Create a new account |
| GET | `/accounts/me` | ✓ | Current account details |
| GET | `/accounts` | ✓ | All accounts (operator only) |

---

## Billing

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/billing/status` | ✓ | Current plan, trial status, expiry |
| POST | `/billing/upgrade` | ✓ | Upgrade plan |
| POST | `/billing/cancel` | ✓ | Cancel active plan |
| GET | `/plan/current` | ✓ | Current plan record |
| POST | `/plan/upgrade` | ✓ | Upgrade to a named plan |

---

## AI Runtime

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/jarvis` | ✓ | Direct AI query. Body: `{ input, context? }` |
| POST | `/ai/chat` | ✓ | Chat completion. Body: `{ messages, model? }` |
| POST | `/runtime/dispatch` | ✓ | Synchronous task dispatch. Body: `{ input, timeoutMs? }` |
| POST | `/runtime/queue` | ✓ | Async queue. Body: `{ input, priority? }` (0=HIGH, 1=NORMAL, 2=LOW) |
| GET | `/runtime/status` | ✓ | Orchestrator state, SSE connections, emergency stop state |
| GET | `/runtime/history` | ✓ | Execution history |
| GET | `/runtime/stream` | ✓ | SSE event stream for real-time agent output |
| POST | `/runtime/emergency-stop` | ✓ | Block all dispatches immediately |
| POST | `/runtime/emergency-resume` | ✓ | Resume after emergency stop |

---

## Mission Control

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/mission/runtime/list` | ✓ | All missions |
| POST | `/mission/runtime/create` | ✓ | Create mission. Body: `{ title, description, priority? }` |
| GET | `/mission/runtime/:id` | ✓ | Mission detail |
| POST | `/mission/runtime/:id/complete` | ✓ | Mark mission complete |
| GET | `/mission/timeline/:id` | ✓ | Mission execution timeline |
| GET | `/mission/graph/:id` | ✓ | Mission dependency graph |
| POST | `/mission/replay/:id` | ✓ | Replay mission execution |

---

## CRM

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/crm` | ✓ | All leads |
| POST | `/crm` | ✓ | Create lead |
| GET | `/crm/lead/:id` | ✓ | Lead detail |
| PUT | `/crm/lead/:id` | ✓ | Update lead |
| POST | `/crm-leads` | ✓ | Bulk lead import |

---

## Growth OS

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/growth/dashboard` | ✓ | Growth dashboard metrics |
| GET | `/growth/campaigns` | ✓ | All campaigns |
| POST | `/growth/campaigns` | ✓ | Create campaign |
| POST | `/growth/campaigns/:id/send` | ✓ | Send campaign |
| GET | `/growth/audiences` | ✓ | All audiences |
| POST | `/growth/audiences` | ✓ | Create audience |
| GET | `/growth/automations` | ✓ | All automation flows |
| POST | `/growth/automations` | ✓ | Create automation |
| GET | `/growth/templates` | ✓ | Template marketplace |
| GET | `/growth/analytics` | ✓ | Campaign analytics |
| POST | `/growth/benchmark` | ✓ | Run growth benchmark (10 checks) |

---

## Launch Platform

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/launch/dashboard` | ✓ | Launch metrics dashboard |
| GET | `/launch/readiness` | ✓ | Launch readiness checks |
| GET | `/launch/benchmark` | ✓ | Commercial benchmark |
| GET | `/launch/referral` | ✓ | Referral dashboard |
| POST | `/launch/referral/use` | ✓ | Use a referral code |
| POST | `/launch/referral/redeem` | ✓ | Redeem pending credits |
| GET | `/launch/pcp-report` | ✓ | Product Completion Report |
| GET | `/launch/pip-report` | ✓ | Production Integration Report |

---

## Deployment Report (OP-1)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/deployment/op1-report` | ✓ | Full production deployment audit |
| GET | `/deployment/active` | ✓ | Active deployments |
| POST | `/deployment/run` | ✓ | Run autonomous deployment |
| GET | `/deployment/:id/health` | ✓ | Deployment health snapshot |
| POST | `/deployment/:id/rollback` | ✓ | Manual rollback |

---

## Founder Journal (FOP-1)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/fop/days` | ✓ | All journal days |
| GET | `/fop/day/:date` | ✓ | Single day journal entry |
| POST | `/fop/day/:date` | ✓ | Update journal entry |
| POST | `/fop/day/:date/seal` | ✓ | Seal (finalize) a day |
| GET | `/fop/confidence` | ✓ | Launch confidence + GO/NOT YET verdict |
| GET | `/fop/report` | ✓ | Full founder report |

---

## WhatsApp

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/whatsapp/send` | ✓ | Send WhatsApp message |
| GET | `/whatsapp/status` | ✓ | Connection status |
| POST | `/whatsapp/webhook` | — | Webhook receiver (no auth — Meta sends here) |

---

## Payments

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/payment/create-link` | ✓ | Create Razorpay payment link |
| GET | `/payment/status/:id` | ✓ | Payment link status |
| POST | `/webhook/razorpay` | — | Razorpay webhook (HMAC verified) |

---

## Response format

All endpoints return JSON with an `ok` boolean:

```json
// Success
{ "ok": true, "data": { ... } }

// Error
{ "ok": false, "error": "Human-readable message" }
```

Error HTTP status codes: `400` (bad request), `401` (not authenticated), `403` (plan gate), `404` (not found), `429` (rate limited), `500` (server error).
