# Production Environment Variable Checklist

**Date:** 2026-07-17
**Method:** Cross-referenced `.env.example` (125 documented vars) against the real `.env` in this environment (33 vars present, name-only grep — no values printed) and actual `process.env.X` reads in `backend/`, `agents/`, `scripts/`. Every REQUIRED/OPTIONAL marker below is either taken from `.env.example`'s own `[REQUIRED]`/`[OPTIONAL]` annotation or verified against real startup/gating code (cited).

**Legend:** READY = present in `.env` with a real (non-placeholder) value. MISSING = documented but absent from `.env`. OPTIONAL = absent but the app degrades gracefully rather than failing.

---

## Server (all REQUIRED)

| Var | Status | Evidence |
|---|---|---|
| `PORT` | READY | Set to a real port in `.env`. |
| `ALLOWED_ORIGINS` | READY | Set to real production domains (`ooplix.com` family), not the template placeholder. |
| `NODE_ENV` | READY | `production`, not placeholder. |
| `BASE_URL` | READY | Set to real HTTPS domain. Degrades to a warning (not fatal) if unset — `backend/server.js:966` — but Razorpay webhooks silently never confirm payments without it (`paymentService.js:43`). |

## Auth (both REQUIRED — fatal without)

| Var | Status | Evidence |
|---|---|---|
| `JWT_SECRET` | READY | Set, 128 chars, real (not placeholder). `backend/server.js:49-50`: FATAL log + auth disabled if unset in production. |
| `OPERATOR_PASSWORD_HASH` | READY | Set, 161 chars, real. `backend/server.js:54-55`: FATAL log + operator console inaccessible if unset in production. |

## AI Provider (1 REQUIRED, 3 OPTIONAL)

| Var | Status | Evidence |
|---|---|---|
| `GROQ_API_KEY` | READY | `[REQUIRED]` per `.env.example:22`. Set, real value, live-CONNECTED in a prior session's connector audit. |
| `LLM_PROVIDER` | READY | Set to `groq`. |
| `OPENAI_API_KEY` | READY | `[OPTIONAL]` (Whisper STT only per doc comment, but also a full chat provider in `aiService.js`). Set, real, live-CONNECTED in a prior session. |
| `ANTHROPIC_API_KEY` | MISSING (OPTIONAL) | Not in `.env`. Code path is fully real (`aiService.js`); connector reports MISSING live per prior session's connector audit. |
| `GEMINI_API_KEY` | MISSING (OPTIONAL) | Not in `.env`. Code path fully real; reports MISSING live. |

## WhatsApp (REQUIRED for automation feature, BROKEN credential value)

| Var | Status | Evidence |
|---|---|---|
| `WHATSAPP_TOKEN` (documented name) | READY (via alias) | `.env` has `WA_TOKEN` instead — `whatsappService.js:10` and `integrationConnectors.cjs:609` both accept either name. Real value present. |
| `PHONE_NUMBER_ID` (documented name) | READY BUT WRONG VALUE TYPE | `.env` has `WA_PHONE_ID` (accepted alias). **Prior session's live connector test found this value is a WhatsApp Business Account ID, not a phone-number-id — the connector returns HTTP 400 live.** Marked BROKEN in `docs/current/v1-feature-matrix.json`, not a missing-credential issue. |
| `WA_API_VERSION` | READY | Set. |
| `WA_VERIFY_TOKEN` | READY | Set. |
| `WA_BUSINESS_ACCOUNT_ID` | READY | Set — and per the prior session's finding, this is the value that actually belongs in `PHONE_NUMBER_ID`'s sibling lookup path, not `WA_PHONE_ID`. |
| **Undocumented aliases actually in `.env`:** `WA_TOKEN`, `WA_PHONE_ID` | — | Real, used by code (`whatsappService.js:10-11`), but **absent from `.env.example`** — a documentation gap. Anyone following the example file literally would set `WHATSAPP_TOKEN`/`PHONE_NUMBER_ID` and it would still work (aliases), but `.env.example` should list both accepted names. |

## Telegram (REQUIRED)

| Var | Status | Evidence |
|---|---|---|
| `TELEGRAM_TOKEN` | READY | `[REQUIRED]`. Set, real, live-CONNECTED with real bot identity in a prior session. |
| `PAYMENT_FALLBACK_LINK` | MISSING (OPTIONAL) | Not in `.env`. Fallback-only per doc comment. |
| `TELEGRAM_OPERATOR_CHAT_ID` | READY | `[OPTIONAL]` per doc — set anyway, enables crash alerts. |
| **Undocumented but present:** `TELEGRAM_CHAT_ID` | — | Real, used via `_has("TELEGRAM_CHAT_ID")` in `productionWiring2.cjs:598,930` — absent from `.env.example`, documentation gap. |

## Razorpay (all REQUIRED for payments)

| Var | Status | Evidence |
|---|---|---|
| `RAZORPAY_KEY_ID` | READY | Set, real, 23 chars. Live-CONNECTED after last session's endpoint-typo fix. |
| `RAZORPAY_KEY_SECRET` | READY | Set, real, 24 chars. |
| `RAZORPAY_WEBHOOK_SECRET` | READY | `[REQUIRED in production]` — without it all webhooks are rejected (`.env.example:55`). Set, real, 64 chars. Live-verified real HMAC-SHA256 + timingSafeEqual in a prior session. |
| **Undocumented aliases actually in `.env`:** `RAZORPAY_KEY`, `RAZORPAY_SECRET` | — | Real, used in 6 files each — appear to be a second naming convention alongside `_ID`/`_SECRET`. Absent from `.env.example`, documentation gap. |
| `RAZORPAY_PLAN_ID_STARTER/GROWTH/ENTERPRISE` | MISSING | `[REQUIRED for paid upgrades]` per `.env.example:225`. Not in `.env` — **subscription plan upgrades cannot complete without these**, since `closedBeta.cjs`'s `PLAN_PRICES_INR` expects real Razorpay plan IDs. |

## Business

| Var | Status | Evidence |
|---|---|---|
| `PRODUCT_PRICE` | MISSING (OPTIONAL) | Confirmed absent from `.env` via direct grep. |

## Firebase (OPTIONAL — mobile app auth only)

| Var | Status | Evidence |
|---|---|---|
| `FIREBASE_PROJECT_ID` | MISSING | Not in `.env`. `backend/routes/auth.js:199` logs a dev-only warning and skips token verification if unset — degrades gracefully outside production, but mobile Firebase auth would not work. |
| `FIREBASE_SERVICE_ACCOUNT` | MISSING | Same as above. |

## Frontend

| Var | Status | Evidence |
|---|---|---|
| `REACT_APP_API_URL` | READY | Empty string (intentional — single-server nginx mode per the doc comment, relative paths used). This is a correct "set to blank on purpose" state, not a gap. |

## Logging

| Var | Status | Evidence |
|---|---|---|
| `LOG_LEVEL` | MISSING (OPTIONAL) | Confirmed absent from `.env` via direct grep. |

## Optional integrations (LinkedIn, Google — all OPTIONAL)

| Var | Status | Evidence |
|---|---|---|
| `LINKEDIN_CLIENT_ID` | READY but EMPTY VALUE | Key present in `.env` with no value set. |
| `LINKEDIN_CLIENT_SECRET` | READY but EMPTY VALUE | Same. |
| `LINKEDIN_REDIRECT_URL` | READY but EMPTY VALUE | Same. |
| `GOOGLE_CLIENT_ID` | READY but EMPTY VALUE | Same — matches prior connector audit finding ("GOOGLE_CLIENT_ID set, no SECRET"). |
| `GOOGLE_API` | MISSING | Not confirmed present. |

## Production Mission 3 — real integration env vars (all OPTIONAL, connector-specific)

All of the following are `MISSING` from `.env` (name-grep confirmed zero presence) and match the prior session's connector-by-connector audit ("WAITING FOR CREDS"):

**AI providers (additions):** `DEEPSEEK_API_KEY`, `TOGETHER_API_KEY`, `FIREWORKS_API_KEY`, `COHERE_API_KEY`, `NVIDIA_API_KEY` — all MISSING. `LM_STUDIO_URL`/`LM_STUDIO_MODEL` are OPTIONAL (local-only fallback, code probes `localhost:1234` and fails fast if absent per a prior session's finding).

**Git providers:** `GITHUB_TOKEN`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITLAB_TOKEN`, `BITBUCKET_USER`, `BITBUCKET_APP_PASSWORD` — all MISSING. GitHub connector code is fully real (live-verified reachable at `api.github.com` in prior sessions) but WAITING FOR CREDS.

**Infrastructure:** `HOSTINGER_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ACCOUNT_ID` — all MISSING.

**Payments (additions):** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `PADDLE_API_KEY`, `PADDLE_VENDOR_ID`, `PADDLE_WEBHOOK_SECRET`, `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET` — all MISSING. **No Stripe webhook route exists in the codebase at all** (confirmed in a prior session), so `STRIPE_WEBHOOK_SECRET` would need new route code even with a real key.

**Email (additions):** `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `BREVO_API_KEY`, `AWS_SES_REGION`, `SES_FROM_EMAIL` — all MISSING.

**Messaging:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`, `DISCORD_WEBHOOK_URL`, `SLACK_BOT_TOKEN`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` — all MISSING.

**Auth (additions):** `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_REDIRECT_URI`, `APPLE_TEAM_ID`, `APPLE_CLIENT_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` — all MISSING. Apple Sign-In requires a real Apple Developer account (Team ID, Key ID, a `.p8` private key) — none of this exists anywhere in this repo or environment; this is a genuine external credential acquisition, not a config oversight.

**Productivity:** `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `MS_GRAPH_TOKEN`, `DROPBOX_ACCESS_TOKEN` — all MISSING.

**Commerce:** `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`, `WOOCOMMERCE_URL`, `WOOCOMMERCE_KEY`, `WOOCOMMERCE_SECRET`, `WORDPRESS_URL`, `WORDPRESS_USERNAME`, `WORDPRESS_APP_PASSWORD` — all MISSING.

**Creative:** `FIGMA_ACCESS_TOKEN`, `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`, `CANVA_API_KEY` — all MISSING.

**Automation:** `ZAPIER_WEBHOOK_URL`, `MAKE_API_KEY`, `MAKE_WEBHOOK_URL` — MISSING. `N8N_HOST`/`N8N_API_KEY` — MISSING as documented, but `.env` has undocumented aliases `N8N_URL`, `N8N_API_KEY` (the latter IS documented) — `N8N_URL` vs `N8N_HOST` is a naming mismatch worth checking in code.

**Monitoring:** `DATADOG_API_KEY`, `DATADOG_APP_KEY`, `DATADOG_SITE`, `UPTIMEROBOT_API_KEY` — all MISSING.

## Production Mission 6 — Closed Beta Operations

| Var | Status | Evidence |
|---|---|---|
| `RESEND_API_KEY` | MISSING | `[REQUIRED for beta]` per `.env.example:215` — email verification and password reset will not work without a real email provider key. |
| `RESEND_FROM_EMAIL` | MISSING | Same requirement. |
| `BETA_MAX_USERS` | MISSING (OPTIONAL) | Defaults to hardcoded 50 per doc comment. |
| `RAZORPAY_PLAN_ID_STARTER/GROWTH/ENTERPRISE` | MISSING | See Razorpay section above — blocks paid upgrades. |

---

## Undocumented-but-present variables (documentation gaps in `.env.example`)

These are real, code-read variables present in `.env` that have no line in `.env.example` at all:

| Var | Used in | Purpose (inferred from code) |
|---|---|---|
| `APP_URL` | 3 files | Appears to be a second app-URL variable alongside `BASE_URL` — worth confirming they don't conflict. |
| `COOKIE_DOMAIN` | 1 file | Cookie domain scoping. |
| `DISABLE_X_POWERED_BY` | 1 file | Security header toggle. |
| `N8N_URL` | 1 file (`agents/automation/registerWorkflows.cjs:105`) | **Real naming split, not a simple alias**: the actual workflow-registration code reads `N8N_URL`, while the connector-status dashboard (`integrationConnectors.cjs:1005`, `pcs2ExternalPlatforms.cjs:866`) and `envManager.cjs:151` all read `N8N_HOST` instead. `.env` sets `N8N_URL`, so workflow registration works, but the connector dashboard will still report n8n as not configured since it never checks `N8N_URL`. This is a genuine code inconsistency, not just a documentation gap. |
| `RAZORPAY_KEY` / `RAZORPAY_SECRET` | 6 files each | Alias pair for `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`. |
| `TELEGRAM_CHAT_ID` | 2 files (via `_has()` helper) | Alias/duplicate of `TELEGRAM_OPERATOR_CHAT_ID`. |
| `VERIFY_TOKEN` | 1 file | Likely an alias for `WA_VERIFY_TOKEN`. |
| `WA_PHONE_ID` / `WA_TOKEN` | 4-6 files each | Real accepted aliases for `PHONE_NUMBER_ID`/`WHATSAPP_TOKEN`, confirmed in a prior session's connector audit. |

**Recommendation (not acted on — documentation-only change, deferred to avoid scope creep on a fixes-only pass):** `.env.example` should list these alias names alongside the primary documented names so an operator setting up a fresh deployment doesn't have to read source code to discover them.

---

## Summary counts

- **Total documented vars:** 125
- **READY (real value present):** 22 exact-name matches + 10 alias-name matches = **32 functionally ready**
- **READY but empty value:** 4 (`LINKEDIN_CLIENT_ID/SECRET/REDIRECT_URL`, `GOOGLE_CLIENT_ID`)
- **MISSING, REQUIRED-marked in `.env.example`:** `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RAZORPAY_PLAN_ID_STARTER/GROWTH/ENTERPRISE` — **6 vars block real production features** (email verification/password reset, paid plan upgrades) despite the app booting fine without them.
- **MISSING, OPTIONAL (connector credentials):** remaining ~90 vars, all connector/integration credentials that gate individual features, none of which prevent the core app from running.
