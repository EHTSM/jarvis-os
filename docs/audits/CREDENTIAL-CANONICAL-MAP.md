# Credential Canonical Map

**Generated:** 2026-07-25, via a full repository scan (EXECUTION MODE — read-only, no production code modified, no credentials imported, no secret values exposed).

**Method:** Every `process.env.*` literal, every `_env(k)`-style helper call, every `secretVault.cjs` `ENV_MAP` entry, and every `envManager.cjs` catalog entry was located and cross-referenced against the code path that actually consumes it. Nothing below is invented — every row cites the real file:line where the variable is read. No `.env` values were read or copied into this document.

**Legend**
- **TYPE**: `SECRET` (must never be logged/exposed), `ID` (semi-public identifier, e.g. OAuth client ID), `URL`, `CONFIG` (non-secret tuning value), `FILE` (file content pasted as env var)
- **STORAGE**: `VAULT` (has a `secretVault.cjs` `ENV_MAP` entry — Vault-native, encrypted at rest), `ENV_BOOTSTRAP` (read directly from `process.env`, no Vault entry — the Vault's own bootstrap secret `JWT_SECRET` is the canonical example), `CONFIG` (non-secret runtime setting)
- **REQUIRED**: per the code path's own behavior when absent (READY/degraded-but-running vs. a hard failure), not aspirational

---

## Part 1 — Core server / auth (2 required secrets)

| SERVICE | CANONICAL_KEY | TYPE | STORAGE | CONNECTOR_ID | REQUIRED | CODE LOCATION | ALIASES FOUND |
|---|---|---|---|---|---|---|---|
| JARVIS core | `JWT_SECRET` | SECRET | ENV_BOOTSTRAP | n/a | REQUIRED — Vault encryption key derives from this; server auth breaks without it | `secretVault.cjs:109`, `backend/server.js` | none |
| JARVIS core | `OPERATOR_PASSWORD_HASH` | SECRET | ENV_BOOTSTRAP | n/a | REQUIRED in production | `backend/server.js`, `envManager.cjs:58` | none |
| JARVIS core | `ALLOWED_ORIGINS` | CONFIG | CONFIG | n/a | REQUIRED for cross-origin cookies | `backend/server.js` | none |
| JARVIS core | `BASE_URL` | URL | CONFIG | n/a | REQUIRED (Razorpay webhooks, OAuth redirect defaults) | `backend/server.js`, `emailService.cjs:91`, `oauthIntegrationLayer.cjs` | none |
| JARVIS core | `APP_URL` | URL | CONFIG | n/a | OPTIONAL — overrides BASE_URL for AI Referer header only | `aiService.js:223` | none |
| JARVIS core | `PRODUCTION_DOMAIN` | URL | CONFIG | n/a | OPTIONAL — read by `pipReport.cjs` readiness check only | `pipReport.cjs:384` | none |
| JARVIS core | `ALLOW_DEV_AUTH_BYPASS` | CONFIG | CONFIG | n/a | OPTIONAL, dev-only — never set in production | `backend/server.js` | none |

## Part 2 — AI Providers (14 real providers, all SECRET/api_key type)

| SERVICE | CANONICAL_KEY | TYPE | STORAGE | CONNECTOR_ID | REQUIRED | CODE LOCATION | ALIASES FOUND |
|---|---|---|---|---|---|---|---|
| Groq | `GROQ_API_KEY` | SECRET | VAULT | `ai:groq` | REQUIRED (default `LLM_PROVIDER`) | `aiService.js:200`, `ENV_MAP` | none |
| OpenRouter | `OPENROUTER_API_KEY` | SECRET | VAULT | `ai:openrouter` | OPTIONAL fallback | `aiService.js:213`, `ENV_MAP` | none |
| OpenAI | `OPENAI_API_KEY` | SECRET | VAULT | `ai:openai` | OPTIONAL (also used for Whisper STT) | `aiService.js:234`, `ENV_MAP` | none |
| Anthropic | `ANTHROPIC_API_KEY` | SECRET | VAULT | `ai:anthropic` | OPTIONAL | `aiService.js:261`, `ENV_MAP` | none |
| Gemini | `GEMINI_API_KEY` | SECRET | VAULT | `ai:gemini` | OPTIONAL | `aiService.js:290`, `ENV_MAP` | none |
| DeepSeek | `DEEPSEEK_API_KEY` | SECRET | VAULT | `ai:deepseek` | OPTIONAL | `aiService.js:316`, `ENV_MAP` | none |
| Together AI | `TOGETHER_API_KEY` | SECRET | VAULT | `ai:together` | OPTIONAL | `aiService.js:330`, `ENV_MAP` | none |
| Fireworks | `FIREWORKS_API_KEY` | SECRET | VAULT | `ai:fireworks` | OPTIONAL | `aiService.js:344`, `ENV_MAP` | none |
| Cohere | `COHERE_API_KEY` | SECRET | VAULT | `ai:cohere` | OPTIONAL | `aiService.js:359`, `ENV_MAP` | none |
| NVIDIA NIM | `NVIDIA_API_KEY` | SECRET | VAULT | `ai:nvidia` | OPTIONAL | `aiService.js:383`, `ENV_MAP` | none |
| Grok (xAI) | `GROK_API_KEY` | SECRET | VAULT | `ai:grok` | OPTIONAL | `aiService.js:397`, `ENV_MAP` | none |
| Qwen (DashScope) | `DASHSCOPE_API_KEY` | SECRET | VAULT | `ai:qwen` | OPTIONAL | `aiService.js:411`, `ENV_MAP` | none |
| Ollama (local) | `OLLAMA_URL` | URL | CONFIG | n/a | OPTIONAL, no key required | `aiService.js:101` | none |
| LM Studio (local) | `LM_STUDIO_URL` | URL | CONFIG | n/a | OPTIONAL, no key required | `aiService.js:102` | none |
| ElevenLabs | `ELEVENLABS_API_KEY` | SECRET | ENV_BOOTSTRAP | n/a | OPTIONAL — falls back to `OPENAI_API_KEY` for STT | `pipReport.cjs:198` | none |

`*_MODEL` and `*_TIMEOUT` variables for every provider above (e.g. `GROQ_MODEL`, `ANTHROPIC_TIMEOUT`) are CONFIG-type tuning values, not credentials — full set in `.env.example`, all read at `aiService.js:95-174`.

## Part 3 — Git Providers

| SERVICE | CANONICAL_KEY | TYPE | STORAGE | CONNECTOR_ID | REQUIRED | CODE LOCATION | ALIASES FOUND |
|---|---|---|---|---|---|---|---|
| GitHub (PAT) | `GITHUB_TOKEN` | SECRET | VAULT | `git:github` | OPTIONAL — public read works without it | `integrationConnectors.cjs:309`, `gitHubEngineeringAgent.cjs:58`, `founderIdentityOS.cjs:405`, `ENV_MAP` (`personal_access_token`) | none |
| GitHub (OAuth App) | `GITHUB_CLIENT_ID` | ID | ENV_BOOTSTRAP (no ENV_MAP entry — semi-public, not a secret) | `auth:github` | OPTIONAL | `integrationConnectors.cjs:811`, `oauthIntegrationLayer.cjs:118` | none |
| GitHub (OAuth App) | `GITHUB_CLIENT_SECRET` | SECRET | VAULT | `auth:github` | OPTIONAL | `integrationConnectors.cjs:812`, `ENV_MAP` (`oauth_token`) | none |
| GitHub (OAuth App) | `GITHUB_REDIRECT_URI` | URL | CONFIG | `auth:github` | OPTIONAL | `integrationConnectors.cjs:813` | none |
| GitHub (App, declared but unused) | `GITHUB_APP_ID` | ID | CONFIG | n/a | Declared in `envManager.cjs:81` catalog only — **not read by any `connect*()` function** | `envManager.cjs:81` | none |
| GitLab | `GITLAB_TOKEN` | SECRET | VAULT | `git:gitlab` | OPTIONAL | `integrationConnectors.cjs:329`, `ENV_MAP` | `GITLAB_ACCESS_TOKEN` (real code-level fallback, line 329) |
| GitLab | `GITLAB_HOST` | URL | CONFIG | `git:gitlab` | OPTIONAL, defaults to gitlab.com | `integrationConnectors.cjs:328` | none |
| Bitbucket | `BITBUCKET_USER` | ID | ENV_BOOTSTRAP | `git:bitbucket` | OPTIONAL | `integrationConnectors.cjs:343` | `BITBUCKET_USERNAME` (real fallback) |
| Bitbucket | `BITBUCKET_APP_PASSWORD` | SECRET | VAULT | `git:bitbucket` | OPTIONAL | `integrationConnectors.cjs:344`, `ENV_MAP` | `BITBUCKET_TOKEN` (real fallback) |

## Part 4 — Infrastructure / Cloud

| SERVICE | CANONICAL_KEY | TYPE | STORAGE | CONNECTOR_ID | REQUIRED | CODE LOCATION | ALIASES FOUND |
|---|---|---|---|---|---|---|---|
| Hostinger | `HOSTINGER_API_KEY` | SECRET | VAULT | `infra:hostinger` | OPTIONAL | `integrationConnectors.cjs:367`, `ENV_MAP` | none |
| Cloudflare (API) | `CLOUDFLARE_API_TOKEN` | SECRET | VAULT | `infra:cloudflare` | OPTIONAL | `integrationConnectors.cjs:379`, `ENV_MAP` | `CF_API_TOKEN` (real fallback) |
| Cloudflare (API) | `CLOUDFLARE_ACCOUNT_ID` | ID | CONFIG | `infra:cloudflare` | OPTIONAL | `integrationConnectors.cjs:380` | none |
| Firebase | `FIREBASE_PROJECT_ID` | ID | CONFIG | `infra:firebase` | OPTIONAL, enables mobile auth | `integrationConnectors.cjs:393` | none |
| Firebase | `FIREBASE_SERVICE_ACCOUNT` | FILE (JSON) | VAULT | `infra:firebase` | OPTIONAL | `integrationConnectors.cjs:394`, `ENV_MAP` (`service_account_json`) | none |
| Supabase | `SUPABASE_URL` | URL | CONFIG | `infra:supabase` | OPTIONAL | `integrationConnectors.cjs:412` | none |
| Supabase | `SUPABASE_ANON_KEY` | SECRET | ENV_BOOTSTRAP (no ENV_MAP entry) | `infra:supabase` | OPTIONAL, primary key used | `integrationConnectors.cjs:413` | none |
| Supabase | `SUPABASE_SERVICE_KEY` | SECRET | VAULT | `infra:supabase` | OPTIONAL, fallback | `integrationConnectors.cjs:413`, `ENV_MAP` (mapped, but code prefers `SUPABASE_ANON_KEY` first) | none |
| AWS S3 | `AWS_ACCESS_KEY_ID` | SECRET | VAULT | `infra:aws` | OPTIONAL | `integrationConnectors.cjs:424`, `storageService.cjs:46`, `ENV_MAP` (`api_key`) | `S3_ACCESS_KEY` (real fallback, storageService.cjs:46) |
| AWS S3 | `AWS_SECRET_ACCESS_KEY` | SECRET | VAULT | `infra:aws` | OPTIONAL | `storageService.cjs:47`, `ENV_MAP` (`webhook_secret` — a real credential-type mismatch: this is an access-key secret, not a webhook secret) | `S3_SECRET_KEY` (real fallback) |
| AWS S3 | `AWS_REGION` | CONFIG | CONFIG | `infra:aws` | OPTIONAL, defaults us-east-1 | `storageService.cjs:50` | `S3_REGION` (real fallback) |
| AWS S3 | `S3_BUCKET` | CONFIG | CONFIG | `infra:aws` | OPTIONAL | `storageService.cjs:48` | none |
| Cloudflare R2 | `R2_ACCESS_KEY_ID` | SECRET | VAULT | `infra:r2` | OPTIONAL | `integrationConnectors.cjs:443`, `ENV_MAP` | none |
| Cloudflare R2 | `R2_SECRET_ACCESS_KEY` | SECRET | VAULT | `infra:r2` | OPTIONAL | `integrationConnectors.cjs:443`, `ENV_MAP` | none |
| Cloudflare R2 | `R2_BUCKET` | CONFIG | CONFIG | `infra:r2` | OPTIONAL | `storageService.cjs:37` | `CLOUDFLARE_R2_BUCKET` (real fallback, storageService.cjs:42) |
| Cloudflare R2 | `R2_ACCOUNT_ID` | ID | CONFIG | `infra:r2` | OPTIONAL | `integrationConnectors.cjs:443` | none |

## Part 5 — Payments

| SERVICE | CANONICAL_KEY | TYPE | STORAGE | CONNECTOR_ID | REQUIRED | CODE LOCATION | ALIASES FOUND |
|---|---|---|---|---|---|---|---|
| Razorpay | `RAZORPAY_KEY_ID` | SECRET (public key, but treated as sensitive) | VAULT | `pay:razorpay` | REQUIRED for payments | `integrationConnectors.cjs:465`, `ENV_MAP` (`api_key`) | `RAZORPAY_KEY` (real fallback) |
| Razorpay | `RAZORPAY_KEY_SECRET` | SECRET | **ENV_BOOTSTRAP — no ENV_MAP entry, bypasses Vault entirely** | `pay:razorpay` | REQUIRED for payments | `integrationConnectors.cjs:466`, `webhookController.js`, `billingService.js` | `RAZORPAY_SECRET` (real fallback) — spreadsheet-style name `RAZORPAY_LIVE_SECRET_KEY` does **not** appear in code anywhere |
| Razorpay | `RAZORPAY_WEBHOOK_SECRET` | SECRET | VAULT | `pay:razorpay` | REQUIRED in production (webhooks rejected without it) | `integrationConnectors.cjs`, `ENV_MAP` (`webhook_secret`) | none |
| Razorpay | `RAZORPAY_PLAN_ID_STARTER` | CONFIG (plan ID, not secret) | CONFIG | n/a | REQUIRED for paid upgrades | `billingService.js:243` (dynamic `RAZORPAY_PLAN_ID_${plan.toUpperCase()}`) | none |
| Razorpay | `RAZORPAY_PLAN_ID_GROWTH` | CONFIG | CONFIG | n/a | REQUIRED for paid upgrades | `billingService.js:243`, `webhookController.js:71` | none |
| Razorpay | `RAZORPAY_PLAN_ID_SCALE` | CONFIG | CONFIG | n/a | REQUIRED for paid upgrades | `billingService.js:243`, `webhookController.js:72` | **`RAZORPAY_PLAN_ID_ENTERPRISE`** (documented in the OLD `.env.example` and `rc1.cjs`/`rc4.cjs` audit output) is a real mismatch — `billingService.js`'s actual `PLAN_PRICES` set (line 34) is `starter/growth/scale`, not `.../enterprise`. **Not changed in code per rule 8 — flagged here only.** |
| Stripe | `STRIPE_SECRET_KEY` | SECRET | VAULT | `pay:stripe` | OPTIONAL | `integrationConnectors.cjs:484`, `ENV_MAP` | none |
| Stripe | `STRIPE_WEBHOOK_SECRET` | SECRET | VAULT | `pay:stripe` | OPTIONAL | `integrationConnectors.cjs`, `ENV_MAP` | none |
| Stripe | `STRIPE_PUBLISHABLE_KEY` | ID (public by design) | CONFIG | `pay:stripe` | OPTIONAL | `integrationConnectors.cjs:484` | none |
| Paddle | `PADDLE_API_KEY` | SECRET | VAULT | `pay:paddle` | OPTIONAL | `integrationConnectors.cjs:499`, `ENV_MAP` | none |
| Paddle | `PADDLE_WEBHOOK_SECRET` | SECRET | VAULT | `pay:paddle` | OPTIONAL | `ENV_MAP` | none |
| Paddle | `PADDLE_VENDOR_ID` | ID | CONFIG | `pay:paddle` | OPTIONAL | `.env.example` | none |
| LemonSqueezy | `LEMONSQUEEZY_API_KEY` | SECRET | VAULT | `pay:lemonsqueezy` | OPTIONAL | `integrationConnectors.cjs:513`, `ENV_MAP` | none |
| LemonSqueezy | `LEMONSQUEEZY_WEBHOOK_SECRET` | SECRET | VAULT | `pay:lemonsqueezy` | OPTIONAL | `ENV_MAP` | none |
| LemonSqueezy | `LEMONSQUEEZY_STORE_ID` | ID | CONFIG | `pay:lemonsqueezy` | OPTIONAL | `.env.example` | none |

## Part 6 — Email

| SERVICE | CANONICAL_KEY | TYPE | STORAGE | CONNECTOR_ID | REQUIRED | CODE LOCATION | ALIASES FOUND |
|---|---|---|---|---|---|---|---|
| Resend | `RESEND_API_KEY` | SECRET | VAULT | `email:resend` | REQUIRED for beta (email verification) | `integrationConnectors.cjs:541`, `emailService.cjs:136`, `ENV_MAP` | none |
| SendGrid | `SENDGRID_API_KEY` | SECRET | VAULT | `email:sendgrid` | OPTIONAL | `integrationConnectors.cjs:557`, `ENV_MAP` | none |
| Mailgun | `MAILGUN_API_KEY` | SECRET | VAULT | `email:mailgun` | OPTIONAL | `integrationConnectors.cjs:572`, `ENV_MAP` | none |
| Mailgun | `MAILGUN_DOMAIN` | CONFIG | CONFIG | `email:mailgun` | OPTIONAL | `integrationConnectors.cjs:573` | none |
| Postmark | `POSTMARK_API_KEY` | SECRET | ENV_BOOTSTRAP (no ENV_MAP entry) | `email:postmark` | OPTIONAL | `integrationConnectors.cjs:589` | none |
| Brevo | `BREVO_API_KEY` | SECRET | VAULT | `email:brevo` | OPTIONAL | `integrationConnectors.cjs:604`, `ENV_MAP` | none |
| Amazon SES | `AWS_SES_REGION` | CONFIG | CONFIG | `email:ses` | OPTIONAL, rides AWS creds above | `integrationConnectors.cjs:619`, `emailService.cjs:240` | none |
| Amazon SES | `SES_FROM_EMAIL` | CONFIG | CONFIG | `email:ses` | OPTIONAL | `integrationConnectors.cjs:619` | none |
| SMTP | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` | CONFIG/ID | CONFIG | `email:smtp` | OPTIONAL | `integrationConnectors.cjs:630-634` | none |
| SMTP | `SMTP_PASS` | SECRET | VAULT | `email:smtp` | OPTIONAL | `integrationConnectors.cjs`, `ENV_MAP` (`smtp_credentials`) | none |
| Email (sender identity) | `SMTP_FROM` | CONFIG | CONFIG | n/a | OPTIONAL | `emailService.cjs:89` (real, first-checked) | `EMAIL_FROM` (real fallback, same line). **`RESEND_FROM_EMAIL`** and **`FROM_EMAIL`** (both documented in the old `.env.example`/`envManager.cjs:115`) are **not read by any current code** — a documented-but-unused mismatch, flagged not fixed. |

## Part 7 — Messaging

| SERVICE | CANONICAL_KEY | TYPE | STORAGE | CONNECTOR_ID | REQUIRED | CODE LOCATION | ALIASES FOUND |
|---|---|---|---|---|---|---|---|
| WhatsApp Cloud | `WA_TOKEN` | SECRET | VAULT | `msg:whatsapp` | REQUIRED for WhatsApp automation | `integrationConnectors.cjs:658`, `ENV_MAP` | `WHATSAPP_TOKEN` (real fallback — matches the spreadsheet-style name in rule 7) |
| WhatsApp Cloud | `WA_PHONE_ID` | ID | ENV_BOOTSTRAP (no ENV_MAP entry) | `msg:whatsapp` | REQUIRED | `integrationConnectors.cjs:659` | `PHONE_NUMBER_ID` (real fallback — **must be a phone-number-id, not a WABA ID; a previously-diagnosed real mismatch, see production-credential-verification.md**) |
| WhatsApp Cloud | `WA_BUSINESS_ACCOUNT_ID` | ID | CONFIG | `msg:whatsapp` | OPTIONAL | `integrationConnectors.cjs:660` | none |
| WhatsApp Cloud | `WA_VERIFY_TOKEN` | SECRET (webhook shared secret) | ENV_BOOTSTRAP | `msg:whatsapp` | OPTIONAL | `.env.example`, `WHATSAPP_APP_SECRET` also appears in the raw env scan but **is not read by `connectWhatsApp()`** | `WHATSAPP_APP_SECRET` — declared but not consumed; flagged not fixed |
| Telegram | `TELEGRAM_TOKEN` | SECRET | VAULT | `msg:telegram` | REQUIRED for Telegram bot | `integrationConnectors.cjs:677`, `ENV_MAP` | Spreadsheet-style name `TELEGRAM_BOT_TOKEN` (rule 7) does **not** appear in any code path — `TELEGRAM_TOKEN` is the only real name |
| Twilio | `TWILIO_ACCOUNT_SID` | ID | ENV_BOOTSTRAP | `msg:twilio` | OPTIONAL | `integrationConnectors.cjs:690` | none |
| Twilio | `TWILIO_AUTH_TOKEN` | SECRET | VAULT | `msg:twilio` | OPTIONAL | `integrationConnectors.cjs:691`, `ENV_MAP` | none |
| Twilio | `TWILIO_PHONE_NUMBER` | CONFIG | CONFIG | `msg:twilio` | OPTIONAL | `.env.example` | none |
| Discord (bot) | `DISCORD_BOT_TOKEN` | SECRET | VAULT | `msg:discord` | OPTIONAL | `integrationConnectors.cjs:705`, `ENV_MAP` | none |
| Discord (bot) | `DISCORD_WEBHOOK_URL` | SECRET (URL contains a token) | ENV_BOOTSTRAP | `msg:discord` | OPTIONAL, webhook-only fallback | `integrationConnectors.cjs:706` | none |
| Slack | `SLACK_BOT_TOKEN` | SECRET | VAULT | `msg:slack` | OPTIONAL | `integrationConnectors.cjs:726`, `ENV_MAP` | none |
| Microsoft Teams | `TEAMS_WEBHOOK_URL` | SECRET | VAULT | `msg:teams` | OPTIONAL fallback (rides Microsoft OAuth) | `integrationConnectors.cjs:750`, `ENV_MAP` (`webhook_secret`) | none |

## Part 8 — Authentication (consumer OAuth apps)

| SERVICE | CANONICAL_KEY | TYPE | STORAGE | CONNECTOR_ID | REQUIRED | CODE LOCATION | ALIASES FOUND |
|---|---|---|---|---|---|---|---|
| Google | `GOOGLE_CLIENT_ID` | ID | ENV_BOOTSTRAP (no ENV_MAP entry) | `auth:google` | OPTIONAL | `integrationConnectors.cjs:796`, `oauthIntegrationLayer.cjs:108` | Spreadsheet-style bare name `CLIENT_ID` (rule 7) does **not** appear anywhere in code — every provider's client ID is namespaced (`GOOGLE_CLIENT_ID`, `GITHUB_CLIENT_ID`, etc.) |
| Google | `GOOGLE_CLIENT_SECRET` | SECRET | VAULT | `auth:google` | OPTIONAL | `integrationConnectors.cjs:797`, `ENV_MAP` | Spreadsheet-style bare name `SECRET_KEY` (rule 7) does **not** appear anywhere in code |
| Google | `GOOGLE_REDIRECT_URI` | URL | CONFIG | `auth:google` | OPTIONAL | `oauthIntegrationLayer.cjs:109` | none |
| Microsoft | `MICROSOFT_CLIENT_ID` | ID | ENV_BOOTSTRAP | `auth:microsoft` | OPTIONAL | `integrationConnectors.cjs:830` | none |
| Microsoft | `MICROSOFT_CLIENT_SECRET` | SECRET | VAULT | `auth:microsoft` | OPTIONAL | `ENV_MAP` (shared with `msg:teams`) | none |
| Microsoft | `MICROSOFT_TENANT_ID` | CONFIG | CONFIG | `auth:microsoft` | OPTIONAL, defaults "common" | `integrationConnectors.cjs:831` | none |
| Microsoft | `MICROSOFT_REDIRECT_URI` | URL | CONFIG | `auth:microsoft` | OPTIONAL | `.env.example` | none |
| LinkedIn | `LINKEDIN_CLIENT_ID` | ID | ENV_BOOTSTRAP | `auth:linkedin` | OPTIONAL | `integrationConnectors.cjs:844` | none |
| LinkedIn | `LINKEDIN_CLIENT_SECRET` | SECRET | VAULT | `auth:linkedin` | OPTIONAL | `ENV_MAP` | none |
| LinkedIn | `LINKEDIN_REDIRECT_URL` | URL | CONFIG | `auth:linkedin` | OPTIONAL | `integrationConnectors.cjs:846` | Note the spelling: `_URL` not `_URI`, unlike every other provider's redirect var |
| Apple | `APPLE_TEAM_ID` / `APPLE_CLIENT_ID` / `APPLE_KEY_ID` | ID | ENV_BOOTSTRAP | `auth:apple` | OPTIONAL | `integrationConnectors.cjs:862-864` | none |
| Apple | `APPLE_PRIVATE_KEY` | FILE (.p8 content) | VAULT | `auth:apple` | OPTIONAL | `ENV_MAP` (`ssh_key`) | none |
| Discord (OAuth) | `DISCORD_CLIENT_ID` | ID | ENV_BOOTSTRAP | `auth:discord` | OPTIONAL | `integrationConnectors.cjs:883` | none |
| Discord (OAuth) | `DISCORD_CLIENT_SECRET` | SECRET | VAULT | `auth:discord` | OPTIONAL | `ENV_MAP` | none |
| Discord (OAuth) | `DISCORD_REDIRECT_URI` | URL | CONFIG | `auth:discord` | OPTIONAL | `integrationConnectors.cjs:893` | none |

## Part 9 — Productivity, Commerce, Creative, Automation, Monitoring, Project Management

| SERVICE | CANONICAL_KEY | TYPE | STORAGE | CONNECTOR_ID | REQUIRED | CODE LOCATION | ALIASES FOUND |
|---|---|---|---|---|---|---|---|
| Dropbox | `DROPBOX_ACCESS_TOKEN` | SECRET | VAULT | `prod:dropbox` | OPTIONAL | `integrationConnectors.cjs:974`, `ENV_MAP` | none |
| Notion | `NOTION_API_KEY` | SECRET | VAULT | `prod:notion` | OPTIONAL, direct-token path | `integrationConnectors.cjs:993`, `ENV_MAP` | none |
| Notion | `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` | ID/SECRET | ENV_BOOTSTRAP/VAULT | `prod:notion` | OPTIONAL, OAuth path | `integrationConnectors.cjs:994`, `oauthIntegrationLayer.cjs:138` | none |
| Shopify | `SHOPIFY_STORE_DOMAIN` | CONFIG | CONFIG | `commerce:shopify` | OPTIONAL | `integrationConnectors.cjs:1036` | `SHOPIFY_DOMAIN` (real fallback) |
| Shopify | `SHOPIFY_ADMIN_TOKEN` | SECRET | ENV_BOOTSTRAP (no ENV_MAP entry) | `commerce:shopify` | OPTIONAL | `integrationConnectors.cjs:1037` | `SHOPIFY_ACCESS_TOKEN` (real fallback) |
| WooCommerce | `WOOCOMMERCE_URL` / `_KEY` / `_SECRET` | CONFIG/SECRET | ENV_BOOTSTRAP | `commerce:woocommerce` | OPTIONAL | `integrationConnectors.cjs:1052-1054` | `WC_URL`, `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET` (all real fallbacks) |
| WordPress | `WORDPRESS_URL` / `_USERNAME` / `_APP_PASSWORD` | CONFIG/ID/SECRET | ENV_BOOTSTRAP | `commerce:wordpress` | OPTIONAL | `integrationConnectors.cjs:1070-1072` | none |
| Figma | `FIGMA_ACCESS_TOKEN` | SECRET | VAULT | `creative:figma` | OPTIONAL | `integrationConnectors.cjs:1096`, `ENV_MAP` | `FIGMA_TOKEN` (real fallback) |
| Canva | `CANVA_CLIENT_ID` | ID | ENV_BOOTSTRAP | `creative:canva` | OPTIONAL | `integrationConnectors.cjs:1108` | none |
| Canva | `CANVA_API_KEY` | SECRET | VAULT | `creative:canva` | OPTIONAL | `integrationConnectors.cjs:1109`, `ENV_MAP` | none |
| Zapier | `ZAPIER_WEBHOOK_URL` | SECRET | VAULT | `auto:zapier` | OPTIONAL | `integrationConnectors.cjs:1135`, `ENV_MAP` (`webhook_secret`) | `ZAPIER_CATCH_HOOK` (real fallback) |
| Make | `MAKE_API_KEY` | SECRET | VAULT | `auto:make` | OPTIONAL | `integrationConnectors.cjs:1161`, `ENV_MAP` | `MAKE_API_TOKEN` (real fallback) |
| Make | `MAKE_WEBHOOK_URL` | SECRET | ENV_BOOTSTRAP | `auto:make` | OPTIONAL | `integrationConnectors.cjs:1162` | `INTEGROMAT_WEBHOOK_URL` (real fallback — Make's former product name) |
| n8n | `N8N_HOST` | URL | CONFIG | `auto:n8n` | OPTIONAL | `integrationConnectors.cjs:1183` | `N8N_BASE_URL` (real fallback) |
| n8n | `N8N_API_KEY` | SECRET | VAULT | `auto:n8n` | OPTIONAL | `integrationConnectors.cjs:1184`, `ENV_MAP` | none |
| Sentry | `SENTRY_DSN` | SECRET (DSN, treated sensitively) | VAULT | `monitor:sentry` | OPTIONAL | `sentryService.cjs:38`, `ENV_MAP` | none |
| Sentry | `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` | SECRET/ID | ENV_BOOTSTRAP | `monitor:sentry` | OPTIONAL, release tracking only | `sentryService.cjs:144` | none |
| Sentry | `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` | CONFIG | CONFIG | n/a | OPTIONAL | `sentryService.cjs:98-99` | none |
| Datadog | `DATADOG_API_KEY` | SECRET | VAULT | `monitor:datadog` | OPTIONAL | `integrationConnectors.cjs:1220`, `ENV_MAP` | none |
| Datadog | `DATADOG_APP_KEY` / `DATADOG_SITE` | SECRET/CONFIG | ENV_BOOTSTRAP/CONFIG | `monitor:datadog` | OPTIONAL | `integrationConnectors.cjs:1221-1222` | none |
| UptimeRobot | `UPTIMEROBOT_API_KEY` | SECRET | VAULT | `monitor:uptime` | OPTIONAL | `integrationConnectors.cjs:1235`, `ENV_MAP` | none |
| Jira | `JIRA_HOST` / `JIRA_EMAIL` / `JIRA_API_TOKEN` | CONFIG/ID/SECRET | ENV_BOOTSTRAP/VAULT | `issue:jira` | OPTIONAL | `integrationConnectors.cjs:1286-1288`, `ENV_MAP` (token only) | none |
| Linear | `LINEAR_API_KEY` | SECRET | VAULT | `issue:linear` | OPTIONAL | `integrationConnectors.cjs:1306`, `ENV_MAP` | none |

## Part 10 — Single-agent utility integrations (not part of the Connector Registry)

| SERVICE | CANONICAL_KEY | TYPE | STORAGE | CONNECTOR_ID | REQUIRED | CODE LOCATION | ALIASES FOUND |
|---|---|---|---|---|---|---|---|
| GNews | `GNEWS_API_KEY` | SECRET | ENV_BOOTSTRAP | n/a (no connector — direct agent) | OPTIONAL | `agents/internet/newsAggregatorAgent.cjs:58` | none |
| OpenWeatherMap | `OPENWEATHER_API_KEY` | SECRET | ENV_BOOTSTRAP | n/a | OPTIONAL | `agents/internet/weatherAgent.cjs:72` | none |

## Part 11 — Operations / launch / frontend / desktop

| SERVICE | CANONICAL_KEY | TYPE | STORAGE | CONNECTOR_ID | REQUIRED | CODE LOCATION | ALIASES FOUND |
|---|---|---|---|---|---|---|---|
| Backup | `BACKUP_PASSWORD` | SECRET | ENV_BOOTSTRAP | n/a | OPTIONAL — unencrypted backup if absent | `scripts/export-offsite.cjs:30` | none |
| Beta ops | `BETA_MAX_USERS` | CONFIG | CONFIG | n/a | OPTIONAL, defaults 50 | `closedBeta.cjs` | none |
| Frontend build | `REACT_APP_API_URL` | URL | CONFIG | n/a | OPTIONAL | frontend build config | none |
| Firebase (mobile, public by design) | `REACT_APP_FIREBASE_*` (6 vars) | CONFIG | CONFIG | n/a | OPTIONAL, mobile auth only | `frontend/src/*` | none |
| Desktop | `ENABLE_LOCAL_DESKTOP` / `ENABLE_RUNTIME_DESKTOP` | CONFIG | CONFIG | n/a | OPTIONAL | electron main process | none |

---

## Excluded from this map (real, but out of scope)

- **OS-level environment variables** (`HOME`, `SHELL`, `DISPLAY`, `WAYLAND_DISPLAY`, `COMSPEC`, `X`, `PM2_HOME`) — provided by the OS/process manager, never operator-set application credentials.
- **`DATABASE_URL`** — appears only inside `agents/dev/repoSkeletonGenerator.cjs`'s template-string generator functions (`_envExample()`, `_dbIndex()`), which scaffold *other* products via the Company Factory. Not consumed by JARVIS itself.
- **Test/internal-only vars** (`JARVIS_TEST_DATA_SUFFIX`, `JARVIS_BUS_FAST`, `SKIP_PLATFORM_REGISTER`, `CURRENT_PLAN`, `MAX_CONCURRENT_CYCLES`, `LIVE_MODE_INTERVAL_MS`, `VERIFY_TOKEN`) — internal test/runtime tuning flags, not third-party credentials.

---

## Spreadsheet-style name cross-check (rule 7)

| Spreadsheet-style name | Found in current code? | Real canonical name |
|---|---|---|
| `RAZORPAY_LIVE_API_KEY` | **No** | `RAZORPAY_KEY_ID` (no "LIVE" infix anywhere in code — live vs. test is not distinguished by variable name in this codebase) |
| `RAZORPAY_LIVE_SECRET_KEY` | **No** | `RAZORPAY_KEY_SECRET` (same — no LIVE infix in code) |
| `CLIENT_ID` (bare) | **No** | Always provider-namespaced: `GOOGLE_CLIENT_ID`, `GITHUB_CLIENT_ID`, `MICROSOFT_CLIENT_ID`, `LINKEDIN_CLIENT_ID`, `DISCORD_CLIENT_ID`, `CANVA_CLIENT_ID`, `NOTION_CLIENT_ID`, `APPLE_CLIENT_ID` — no bare `CLIENT_ID` exists |
| `SECRET_KEY` (bare) | **No** | Always provider-namespaced: `GOOGLE_CLIENT_SECRET`, `STRIPE_SECRET_KEY`, `RAZORPAY_KEY_SECRET`, `AWS_SECRET_ACCESS_KEY`, `S3_SECRET_KEY`, etc. — no bare `SECRET_KEY` exists |
| `TELEGRAM_BOT_TOKEN` | **No** | `TELEGRAM_TOKEN` is the only name read by any code path |
| `WHATSAPP_ACCESS_TOKEN` | **Partial** | Real fallback is `WHATSAPP_TOKEN` (not `_ACCESS_TOKEN`) → canonical `WA_TOKEN` |
| `AWS_ACCESS_KEY_ID` | **Yes, exact match** | `AWS_ACCESS_KEY_ID` |
| `AWS_SECRET_ACCESS_KEY` | **Yes, exact match** | `AWS_SECRET_ACCESS_KEY` |
| `GITHUB_CLIENT_ID` | **Yes, exact match** | `GITHUB_CLIENT_ID` |
| `GITHUB_CLIENT_SECRET` | **Yes, exact match** | `GITHUB_CLIENT_SECRET` |
| `GITHUB_TOKEN` | **Yes, exact match** | `GITHUB_TOKEN` (distinct credential from the OAuth pair above — PAT vs. OAuth app) |
| `CLOUDFLARE_API_TOKEN` | **Yes, exact match** | `CLOUDFLARE_API_TOKEN` (real fallback also accepted: `CF_API_TOKEN`) |

**Per rule 8, none of the above were changed in code** — this table only documents what the spreadsheet is likely to call these credentials versus what the code actually reads, so a future spreadsheet-to-Vault import can map correctly instead of guessing.

---

## Final counts

Derived mechanically from the full 212-line `.env.example` (every `KEY=` line classified by suffix/role, not eyeballed):

- **Total canonical keys documented:** 212
- **Total SECRET-type:** 81 (corrected 2026-07-25 — the initial mechanical count misclassified `AWS_ACCESS_KEY_ID` and `RAZORPAY_KEY_ID` as ID-type purely because they end in the "_KEY_ID" suffix pattern; both are documented SECRET at the row level in Parts 4-5 above and are now counted correctly)
- **Total ID-type:** 15
- **Total URL-type:** 24
- **Total CONFIG-type:** 90
- **Total FILE-type:** 2 (`FIREBASE_SERVICE_ACCOUNT`, `APPLE_PRIVATE_KEY`)
- **Real code-level aliases found:** 24 distinct alias pairs (all documented above and in `.env.example` inline comments)
- **Documented-but-unused mismatches found:** 3 (`RAZORPAY_PLAN_ID_ENTERPRISE` vs. real `_SCALE`; `RESEND_FROM_EMAIL`/`FROM_EMAIL` vs. real `SMTP_FROM`/`EMAIL_FROM`; `WHATSAPP_APP_SECRET` declared but never read)
- **Vault ENV_MAP entries:** 57 (unchanged from prior missions)
- **Credentials that bypass the Vault (`ENV_BOOTSTRAP`, no ENV_MAP entry):** `JWT_SECRET`, `RAZORPAY_KEY_SECRET`, `GITHUB_CLIENT_ID`, `GOOGLE_CLIENT_ID`, `SUPABASE_ANON_KEY`, `POSTMARK_API_KEY`, `SHOPIFY_ADMIN_TOKEN`, and every other provider's `*_CLIENT_ID` (semi-public by design) — full list per-row above
