# OS-3 PROVISIONING CHECKLIST

Date: 2026-08-13
**`.env` untouched. No credential invented. No operator authentication bypassed.**

Everything here is blocked by configuration, not code. No engineering work is required for any item.

---

## PART 1 — OPERATOR ACCESS REQUIRED (12 surfaces)

`OPERATOR_PASSWORD_HASH` is set in the environment, but the plaintext is unavailable. I did **not** attempt to crack, guess, or bypass it. Every surface below returned `403 "Forbidden — operator access required"` and is therefore **UNKNOWN — neither working nor broken**.

**What is needed:** one operator-role session (credential held by the founder).

| # | OS | Capability | Surface | Workflow to verify | Evidence currently missing |
|---|---|---|---|---|---|
| 1 | Hosting | VPS provisioning | `GET /ops/infra/vps` | list → inspect host state | whether real VPS data returns |
| 2 | Hosting | Deployment targets | `GET /deployment/targets` | list targets → dry-run deploy | whether targets are real or seeded |
| 3 | Hosting | Ops health | `GET /ops/health` | read health snapshot | live health composition |
| 4 | Hosting | Ops stats | `GET /ops/stats` | read counters | whether counters are real |
| 5 | Hosting | Infra deployment | `GET /ops/infra/deployment` | deploy status | pipeline state |
| 6 | Hosting | Infra monitoring | `GET /ops/infra/monitoring` | alert/monitor list | monitor configuration |
| 7 | Hosting | Infra security | `GET /ops/infra/security` | security posture | scan results |
| 8 | Hosting | Infra database | `GET /ops/infra/database` | DB status/backup | backup verification |
| 9 | Cloud | Integrations | `GET /integrations` | connector list → health | 57-connector claim unverified |
| 10 | Cloud | Integration health | `GET /integrations/summary` | per-connector status | which connectors are live |
| 11 | Cloud | Vault dashboard | `GET /vault/dashboard` | secret inventory | vault contents/health |
| 12 | Cloud | Vault env status | `GET /vault/env/status` | env var coverage | required-vs-present diff |

**Until an operator session is obtained, Hosting's 51/80 and Cloud's 51/80 must NOT be read as functional scores.** They encode missing evidence, not proven weakness.

---

## PART 2 — API CREDENTIALS

| Capability | Variable(s) | State | Blocks | Priority |
|---|---|---|---|---|
| **AI generation** | `GROQ_API_KEY` | **valid but rate-limited (429)** | `/coding/ask`, `/ai/chat` | **P0** |
| **AI generation** | `OPENAI_API_KEY` | **present but INVALID (401)** | fallback provider | **P0** |
| Crash reporting | `SENTRY_DSN` | unset | production error visibility | **P0** |
| Email delivery | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SENDGRID_API_KEY`, `RESEND_API_KEY` | **all 5 unset** | email send | P1 |
| Push delivery | `FIREBASE_PROJECT_ID`, `FIREBASE_SERVER_KEY`, `FCM_SERVER_KEY` | unset | push send | P2 |
| SMS delivery | (no provider configured) | unset | SMS send | P2 |
| Repo integrations | `GITHUB_TOKEN`, `GH_TOKEN` | unset | `/integrations` GitHub | P2 |
| Stripe billing | `STRIPE_SECRET_KEY` | unset | Stripe path (Razorpay works) | P3 |
| Claude provider | `ANTHROPIC_API_KEY` | unset | Claude routing only | P3 |

**Already provisioned and verified:** `WA_TOKEN`, `WA_PHONE_ID`, `TELEGRAM_TOKEN`, `RAZORPAY_KEY`, `RAZORPAY_SECRET`, `GROQ_API_KEY`, `OPENAI_API_KEY` (present, invalid).

### The OpenAI key deserves attention
It is **present but returns 401**. Because Groq answers first, the invalid key is silently masked in normal operation — it only surfaces when Groq is rate-limited, which is exactly when the fallback is needed. Either replace it or remove it; leaving an invalid key in place makes the fallback chain one provider shorter than it appears.

---

## PART 3 — PLATFORM CONNECTORS (Distribution)

OS-3 found `distributionEngine.cjs` performs **no external HTTP call anywhere**. Publishing was simulated. The fix now labels this honestly (`status:"simulated"`, `postUrl:null`).

To make distribution real, per-platform connectors are required:

| Platform | Needed |
|---|---|
| LinkedIn | OAuth app + posting scope |
| X / Twitter | API v2 credentials + write scope |
| Facebook / Instagram | Meta app + page tokens |
| YouTube | Google OAuth + upload scope |
| Others (threads, pinterest, telegram, medium, wordpress) | per-platform credentials |

**This is provisioning plus connector integration — not a rebuild.** The job/approval/scheduling workflow around it is real and was preserved.

---

## PART 4 — TENANT FIXTURES

~450 endpoints return structurally valid but **empty** responses on a fresh tenant. They are **unproven, not broken**.

| Need | Unblocks |
|---|---|
| Populated tenant (leads, deals, missions, approvals, campaigns) | Business pipeline/deals/customers, Enterprise approvals, Developer pipeline |
| Real payment transaction | Business payments/invoices |
| Registered push device | Push delivery verification |
| Configured IdP | SSO/SCIM |

---

## Summary

| Category | Items | Engineering work |
|---|---:|---|
| Operator access | 12 surfaces | **none** |
| API credentials | 9 variables | **none** |
| Platform connectors | ~11 platforms | integration, not rebuild |
| Tenant fixtures | 4 categories | **none** |

**No item in this checklist requires new architecture.**
