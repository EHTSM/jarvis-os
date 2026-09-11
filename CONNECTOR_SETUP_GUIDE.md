# Connector Setup Guide

Every external service Ooplix can talk to, the exact environment variables it reads, and the exact URLs you must register with each provider. All values assume `BASE_URL=https://yourdomain.com` — substitute your real domain everywhere.

Nothing in this guide is required except **AI (Groq)** and **Auth**. Every other connector is optional — the server starts and runs fine without them; the feature they power is simply disabled until configured.

---

## AI Provider — Groq [REQUIRED]

Powers `/jarvis` and `/ai/chat` — the core AI runtime.

| Step | Where |
|---|---|
| 1. Create account | [console.groq.com](https://console.groq.com) |
| 2. Generate API key | Console → API Keys → Create |

**Env vars:**
```
GROQ_API_KEY=gsk_...
LLM_PROVIDER=groq
```

No redirect URI, no webhook — this is a server-to-server API key.

### Optional additional AI providers
Each is independently optional; the AI router falls back across whatever's configured.

| Provider | Env vars | Where to get the key |
|---|---|---|
| OpenAI (Whisper STT only) | `OPENAI_API_KEY` | platform.openai.com → API Keys |
| DeepSeek | `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` | platform.deepseek.com → API Keys |
| Together AI | `TOGETHER_API_KEY`, `TOGETHER_MODEL` | api.together.ai → Settings → API Keys |
| Fireworks | `FIREWORKS_API_KEY`, `FIREWORKS_MODEL` | fireworks.ai → Account → API Keys |
| Cohere | `COHERE_API_KEY`, `COHERE_MODEL` | dashboard.cohere.com → API Keys |
| NVIDIA NIM | `NVIDIA_API_KEY`, `NVIDIA_MODEL` | build.nvidia.com → API Catalog |
| LM Studio (local) | `LM_STUDIO_URL`, `LM_STUDIO_MODEL` | Your own LM Studio server URL — no cloud account |

---

## Operator Auth [REQUIRED]

Not a third-party connector, but required for the console to be reachable at all — without both of these, **every request returns 503**.

```
JWT_SECRET=<32 random bytes>
OPERATOR_PASSWORD_HASH=<salted hash>
```

Generate both in one step:
```bash
node scripts/generate-password-hash.cjs <your-password>
```

---

## WhatsApp Business API

Powers WhatsApp automation — incoming messages, CRM webhook, automated follow-up.

| Step | Where |
|---|---|
| 1. Create a Meta App | [developers.facebook.com](https://developers.facebook.com) → My Apps → Create App → Business |
| 2. Add the WhatsApp product | App Dashboard → Add Product → WhatsApp → Set up |
| 3. Get a permanent token | System Users (Business Settings) → generate a token with `whatsapp_business_messaging` scope — the temporary 24h token in Quickstart will expire and break the connector |
| 4. Copy the Phone Number ID | WhatsApp → API Setup → "Phone number ID" |
| 5. Copy the App Secret | App Settings → Basic → App Secret |
| 6. Configure the webhook | WhatsApp → Configuration → Webhook → Edit |

**Webhook URL to register in Meta:**
```
https://yourdomain.com/whatsapp/webhook
```

**Verify token:** any string you choose — must be identical in Meta's webhook config and your `.env`.

**Webhook fields to subscribe to:** `messages` (minimum). Meta calls the URL above with a GET request first to verify it (`hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`) — Ooplix answers this automatically once `WA_VERIFY_TOKEN` matches.

**Env vars:**
```
WHATSAPP_TOKEN=EAAxxxx...          # or WA_TOKEN — both accepted
PHONE_NUMBER_ID=12345678901234     # or WA_PHONE_ID
WA_API_VERSION=v19.0
WA_VERIFY_TOKEN=<any secret string — must match Meta's webhook config exactly>
WA_BUSINESS_ACCOUNT_ID=<your WABA ID>
WHATSAPP_APP_SECRET=<App Settings → Basic → App Secret>   # verifies incoming webhook HMAC
```

> **Important:** `WHATSAPP_APP_SECRET` is what Ooplix uses to verify the `x-hub-signature-256` header on every incoming webhook call. In production, if this is unset, **incoming WhatsApp webhooks are rejected outright** (fails closed). In development the check is skipped with a console warning.

To disable WhatsApp sending without removing credentials: `DISABLE_WHATSAPP=true`

---

## Telegram

Powers the Telegram bot — automated replies, payment fallback links, crash alerts to the operator.

| Step | Where |
|---|---|
| 1. Create a bot | Telegram → message [@BotFather](https://t.me/BotFather) → `/newbot` → follow prompts |
| 2. Copy the token | BotFather replies with a token immediately after creation |
| 3. [Optional] Get your own chat ID for operator alerts | Message [@userinfobot](https://t.me/userinfobot) |

No redirect URI or webhook URL to register — Telegram bots poll, they don't require you to expose an endpoint (unless you later switch to Telegram's webhook mode, which this codebase does not use).

**Env vars:**
```
TELEGRAM_TOKEN=123456:ABC-xxxx
TELEGRAM_OPERATOR_CHAT_ID=<your numeric chat ID>    # crash alerts + EOD summaries
PAYMENT_FALLBACK_LINK=https://rzp.io/l/your-static-link   # shown if dynamic Razorpay link creation fails
```

---

## Razorpay (Payments)

Powers payment links and payment confirmation.

| Step | Where |
|---|---|
| 1. Get live API keys | Razorpay Dashboard → Settings → API Keys → Generate Live Key |
| 2. Configure the webhook | Dashboard → Settings → Webhooks → Add New Webhook |

**Webhook URL to register in Razorpay (either path works — both are wired to the same handler):**
```
https://yourdomain.com/webhook/razorpay
https://yourdomain.com/razorpay-webhook
```

**Events to subscribe to:** at minimum `payment.captured` — this is what marks a CRM lead as paid and triggers WhatsApp onboarding.

**Webhook secret:** Razorpay generates this when you save the webhook — copy it immediately, it's only shown once.

**Env vars:**
```
RAZORPAY_KEY_ID=rzp_live_...           # or RAZORPAY_KEY (legacy alias)
RAZORPAY_KEY_SECRET=...                # or RAZORPAY_SECRET (legacy alias)
RAZORPAY_WEBHOOK_SECRET=...
PRODUCT_PRICE=999
```

> **Critical:** without `RAZORPAY_WEBHOOK_SECRET` set, the webhook handler rejects every incoming call with an HMAC mismatch (`x-razorpay-signature` verification fails) and **payments never get marked as confirmed**, even though the customer's card was charged. Set this before accepting any real payment.

> **Critical:** `BASE_URL` must be your real HTTPS domain. Razorpay cannot call `localhost` — if `BASE_URL` is unset or still a placeholder, `start-production.sh` refuses to boot.

Optional subscription plans (Production Mission 6 — paid tier upgrades):
```
RAZORPAY_PLAN_ID_STARTER=plan_...
RAZORPAY_PLAN_ID_GROWTH=plan_...
RAZORPAY_PLAN_ID_ENTERPRISE=plan_...
```
Created in Dashboard → Products → Plans.

To disable payment link creation without removing credentials: `DISABLE_PAYMENTS=true`

---

## Email — Resend

Powers email verification and password reset. Without this, users who forget their password have no recovery path.

| Step | Where |
|---|---|
| 1. Create account | [resend.com](https://resend.com) |
| 2. Verify your sending domain | Resend Dashboard → Domains → Add Domain (adds DNS records) |
| 3. Generate an API key | Dashboard → API Keys → Create |

**Env vars:**
```
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=noreply@yourdomain.com   # must be on the verified domain
```

No redirect URI or webhook — outbound email only.

---

## OAuth Connectors

These let Ooplix act on a connected user's behalf (Gmail, GitHub repos, Slack messages, Notion pages, Outlook, LinkedIn posting). All six follow the identical URL pattern:

**Auth URL (start the flow):** `GET /oauth/:provider/url`
**Callback (provider redirects here):** `GET /oauth/:provider/callback`

**Redirect URI to register with each provider — replace `:provider`:**
```
https://yourdomain.com/oauth/google/callback
https://yourdomain.com/oauth/github/callback
https://yourdomain.com/oauth/slack/callback
https://yourdomain.com/oauth/notion/callback
https://yourdomain.com/oauth/microsoft/callback
https://yourdomain.com/oauth/linkedin/callback
```

If you don't set a `*_REDIRECT_URI` env var, Ooplix constructs it automatically from `APP_URL` or `BASE_URL` + the pattern above — but the provider's own dashboard still needs this exact URL registered, or the OAuth handshake will fail with a redirect URI mismatch.

### Google

| Step | Where |
|---|---|
| 1. Create a project | [console.cloud.google.com](https://console.cloud.google.com) |
| 2. Enable APIs you need | Gmail API, Drive API (as applicable) |
| 3. Configure OAuth consent screen | APIs & Services → OAuth consent screen |
| 4. Create OAuth credentials | APIs & Services → Credentials → Create → OAuth client ID → Web application |
| 5. Add authorized redirect URI | `https://yourdomain.com/oauth/google/callback` |

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://yourdomain.com/oauth/google/callback
```
Default scopes requested: `openid email profile gmail.readonly drive.readonly`

### GitHub

| Step | Where |
|---|---|
| 1. Create an OAuth App | github.com/settings/developers → OAuth Apps → New OAuth App |
| 2. Set Authorization callback URL | `https://yourdomain.com/oauth/github/callback` |

```
GITHUB_TOKEN=...                # separate: a PAT with repo scope for direct API use
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_REDIRECT_URI=https://yourdomain.com/oauth/github/callback
```
Default scopes: `read:user repo read:org`

### Slack

| Step | Where |
|---|---|
| 1. Create an app | [api.slack.com/apps](https://api.slack.com/apps) → Create New App |
| 2. Add redirect URL | OAuth & Permissions → Redirect URLs → Add |

```
SLACK_BOT_TOKEN=...             # separate: direct bot token, not the OAuth flow
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
SLACK_REDIRECT_URI=https://yourdomain.com/oauth/slack/callback
```
Default scopes: `channels:read chat:write files:write users:read`

### Notion

| Step | Where |
|---|---|
| 1. Create an integration | [notion.so/my-integrations](https://www.notion.so/my-integrations) → New integration → Public |
| 2. Set redirect URI | Integration settings → OAuth Domain & URIs |

```
NOTION_CLIENT_ID=...
NOTION_CLIENT_SECRET=...
NOTION_REDIRECT_URI=https://yourdomain.com/oauth/notion/callback
```

### Microsoft

| Step | Where |
|---|---|
| 1. Register an app | [portal.azure.com](https://portal.azure.com) → App Registrations → New registration |
| 2. Add redirect URI | Authentication → Add a platform → Web |

```
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
MICROSOFT_TENANT_ID=common      # or your specific tenant ID
MICROSOFT_REDIRECT_URI=https://yourdomain.com/oauth/microsoft/callback
```
Default scopes: `openid email profile User.Read offline_access`

### LinkedIn

| Step | Where |
|---|---|
| 1. Create an app | [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) |
| 2. Add redirect URL | Auth tab → OAuth 2.0 settings → Authorized redirect URLs |

```
LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...
LINKEDIN_REDIRECT_URL=https://yourdomain.com/oauth/linkedin/callback
```
Default scopes: `openid email profile`

### Checking connector status
```
GET /oauth/status          # (requires operator auth) — shows configured: true/false per provider
GET /oauth/connections     # list of connected accounts
```

---

## Other Integrations (env-only, no redirect URI)

These are read directly from `.env` — set them in **Ooplix UI → Settings → Integrations** where applicable, then restart the server. Never commit real keys to git. Full list lives in `.env.example`; the most commonly used:

| Category | Vars |
|---|---|
| Firebase (mobile auth) | `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT` (full service-account JSON, single line) |
| Git providers | `GITLAB_TOKEN`, `GITLAB_HOST`, `BITBUCKET_USER`, `BITBUCKET_APP_PASSWORD` |
| Infrastructure | `HOSTINGER_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_KEY`, `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`R2_ACCOUNT_ID` |
| Alt payment providers | `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY`/`STRIPE_WEBHOOK_SECRET`, `PADDLE_API_KEY`/`PADDLE_VENDOR_ID`/`PADDLE_WEBHOOK_SECRET`, `LEMONSQUEEZY_API_KEY`/`LEMONSQUEEZY_STORE_ID`/`LEMONSQUEEZY_WEBHOOK_SECRET` |
| Alt email | `MAILGUN_API_KEY`/`MAILGUN_DOMAIN`, `BREVO_API_KEY`, `AWS_SES_REGION`/`SES_FROM_EMAIL` |
| Alt messaging | `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_PHONE_NUMBER`, `DISCORD_BOT_TOKEN`/`DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`/`DISCORD_GUILD_ID`/`DISCORD_WEBHOOK_URL` |
| Commerce | `SHOPIFY_STORE_DOMAIN`/`SHOPIFY_ADMIN_TOKEN`, `WOOCOMMERCE_URL`/`WOOCOMMERCE_KEY`/`WOOCOMMERCE_SECRET`, `WORDPRESS_URL`/`WORDPRESS_USERNAME`/`WORDPRESS_APP_PASSWORD` |
| Automation | `ZAPIER_WEBHOOK_URL`, `MAKE_API_KEY`/`MAKE_WEBHOOK_URL`, `N8N_HOST`/`N8N_API_KEY` |
| Monitoring | `DATADOG_API_KEY`/`DATADOG_APP_KEY`/`DATADOG_SITE`, `UPTIMEROBOT_API_KEY` |

### Generic Business OS webhook intake
Independent of any specific provider — Ooplix can ingest arbitrary external events at:
```
POST /business/webhook/form
POST /business/webhook/email
POST /business/webhook/whatsapp
POST /business/webhook/telegram
POST /business/webhook/payment
POST /business/webhook/calendar
POST /business/webhook/:source      # any custom source name
```
No signature verification on these generic intake routes — use them for internal/trusted integrations only, not public-facing forms without additional validation.

---

## Verifying a connector is live

After setting env vars, restart the server (`pm2 restart jarvis-os`) — env vars are read at process start, not hot-reloaded. Then:

1. `GET /oauth/status` (operator auth) — per-provider `configured: true/false`
2. `bash deploy/monitor.sh` — shows overall service health including connector reachability where applicable
3. Send a real test event (a ₹1 Razorpay payment, a WhatsApp message to your business number, `/start` to your Telegram bot) and confirm it shows up in the CRM / logs
