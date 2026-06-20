# Configuration Reference

All configuration is done through environment variables in `.env`.

Copy the template: `cp .env.production.example .env`

## Required

| Variable | Description | Example |
|---|---|---|
| `NODE_ENV` | Runtime mode — must be `production` for VPS | `production` |
| `PORT` | Backend port (nginx proxies this) | `5050` |
| `BASE_URL` | Public HTTPS URL of your server | `https://app.ooplix.com` |
| `JWT_SECRET` | JWT signing secret — min 32 random bytes | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `OPERATOR_PASSWORD_HASH` | Bcrypt hash of operator password | `node scripts/generate-password-hash.cjs yourpass` |
| `GROQ_API_KEY` | Groq API key (primary AI provider) | `gsk_...` |

## CORS

| Variable | Description |
|---|---|
| `ALLOWED_ORIGINS` | Comma-separated list of allowed frontend origins |
| `APP_URL` | Canonical public URL (used in CORS audit) |

## AI Providers (optional)

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key (fallback AI provider) |
| `ANTHROPIC_API_KEY` | Anthropic API key (additional fallback) |
| `LLM_PROVIDER` | Override default provider (`groq`, `openai`, `anthropic`) |

## Payments (optional)

| Variable | Description |
|---|---|
| `RAZORPAY_KEY_ID` | Razorpay live key ID |
| `RAZORPAY_KEY_SECRET` | Razorpay live key secret |
| `RAZORPAY_WEBHOOK_SECRET` | HMAC secret for webhook verification |
| `PAYMENT_FALLBACK_LINK` | Static payment link shown if Razorpay API fails |
| `DISABLE_PAYMENTS` | Set to `true` to disable without removing keys |

## WhatsApp (optional)

| Variable | Description |
|---|---|
| `WA_TOKEN` | WhatsApp Cloud API access token |
| `WA_PHONE_ID` | WhatsApp phone number ID |
| `WA_API_VERSION` | API version (e.g. `v19.0`) |
| `WA_VERIFY_TOKEN` | Webhook verification token |
| `DISABLE_WHATSAPP` | Set to `true` to disable without removing keys |

## Telegram (optional)

| Variable | Description |
|---|---|
| `TELEGRAM_TOKEN` | Telegram Bot API token |
| `TELEGRAM_CHAT_ID` | Default chat ID for notifications |
| `TELEGRAM_OPERATOR_CHAT_ID` | Your personal ID for crash/recovery alerts |

## Security

| Variable | Description |
|---|---|
| `DISABLE_X_POWERED_BY` | Set to `1` to remove `X-Powered-By: Express` header |
| `COOKIE_DOMAIN` | Cookie domain for subdomain sharing |

## Validate your configuration

```bash
node scripts/check-startup-env.cjs
bash deploy/validate-production.sh
```
