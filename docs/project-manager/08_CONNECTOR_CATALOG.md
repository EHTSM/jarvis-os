# 08 — Connector Catalog

**Status of this document:** VERIFIED. This is the most internally-inconsistent area of the codebase in terms of self-reported numbers — three different connector counts appear in different places (17, 47, 54, 57). This document reconciles them explicitly rather than picking one arbitrarily.

---

## Reconciling the Connector Count

Different parts of the codebase count "connectors" at different levels of granularity:

| Figure | What it actually counts | Source |
|---|---|---|
| **17** | Named, user-facing, distinct third-party *services* the mission-tracking documents evaluate (GitHub, Google, Slack, Discord, Stripe, Razorpay, PayPal, WhatsApp, Telegram, Notion, OpenAI, Anthropic, Gemini, Cloudflare, AWS, Supabase, S3/R2 combined) | `docs/current/phase4-6-connectors-electron.md`, `docs/current/production-credential-verification.md` |
| **47** | Distinct connector IDs actually registered in the runtime probe registry (`backend/services/integrationConnectors.cjs`), including all 12 AI sub-providers and infrastructure/email/auth sub-services counted individually | Direct count of `_record()` calls in `integrationConnectors.cjs`, independently verified in this documentation effort |
| **54** | Entries in `backend/services/secretVault.cjs`'s `KNOWN_CONNECTORS` list — the encrypted-credential vault's registry, a different list from the live-probe registry. The most recent commit touching this area (`ec016df`) explicitly references "54-connector vault" | Direct count |
| **57** | A stale figure repeated in code comments, route headers, and several `docs/current/` snapshot files (`connectorApi.js`, `founderVault.js`, `founderIdentityOS.cjs`, `rc3.cjs`) that does not match any of the three lists actually counted above | grep across codebase — appears to be a carried-forward approximation never reconciled with the real registries |

**Recommendation for anyone updating product copy: use "47" (the live-probe registry) for technical accuracy, or "17 named integrations" for user-facing marketing** — do not use "57," which does not correspond to any actual list in the code today.

---

## The 17 Named Connectors — Full Status (as of 2026-07-17 live audit)

| Connector | Category | Credential Required | Status | Notes |
|---|---|---|---|---|
| **Razorpay** | Payments | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | **CONNECTED (live)** | Real HMAC-SHA256 + `timingSafeEqual` webhook verification. A real endpoint typo (`/v1/payment-links` → `/v1/payment_links`) was found and fixed this session. Gap: subscription plan IDs (`RAZORPAY_PLAN_ID_*`) absent — paid upgrades cannot complete. |
| **Telegram** | Messaging | `TELEGRAM_TOKEN` | **CONNECTED (live)** | Real bot identity confirmed live: `@Alwaliy_Technologies_Jarvis_Bot`. |
| **OpenAI** | AI | `OPENAI_API_KEY` | **CONNECTED (live)** | `/v1/models` probe returns real 200; `/ai/chat` round-trips (may 429 under quota — a real provider response). |
| **GitHub** | Dev/Git | `GITHUB_TOKEN` or OAuth client ID/secret | WAITING FOR CREDS | Real code: token exchange + refresh (`oauthIntegrationLayer.cjs`), real `api.github.com` calls (`gitHubEngineeringAgent.cjs`). Reachable, public-read-only without a token. |
| **Google (OAuth)** | Auth | `GOOGLE_CLIENT_ID` (present, empty) + `GOOGLE_CLIENT_SECRET` (absent) | WAITING FOR CREDS | Live health probe hits a public discovery endpoint that returns 200 regardless of actual client credential validity — a known weak-verification gap in the connector code itself. |
| **Slack** | Messaging | `SLACK_BOT_TOKEN`, client ID/secret | WAITING FOR CREDS | Real `auth.test` probe, real `oauth.v2.access` exchange. |
| **Discord** | Messaging | Bot token, client ID/secret | WAITING FOR CREDS | Real `discord.com/api/v10/users/@me` probe. Not wired into the generic OAuth layer — bot-token auth only. |
| **Stripe** | Payments | Stripe secret key | WAITING FOR CREDS | **No Stripe webhook route exists anywhere in the codebase** — even with a key provisioned, webhook confirmation would not work without new route code. Razorpay is the only functioning payment processor. |
| **Notion** | Productivity | `NOTION_TOKEN` | WAITING FOR CREDS | Real `api.notion.com/v1/users/me` call with correct `Notion-Version` header; real OAuth exchange. |
| **Anthropic (Claude)** | AI | `ANTHROPIC_API_KEY` | WAITING FOR CREDS | Fully real code path in `aiService.js` (raw HTTP, no SDK). |
| **Gemini** | AI | `GEMINI_API_KEY` | WAITING FOR CREDS | Fully real code path in `aiService.js`. |
| **Cloudflare** | Infrastructure | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | WAITING FOR CREDS | Real `/user/tokens/verify` probe; R2 storage via hand-rolled SigV4. |
| **AWS** | Infrastructure | AWS keys | WAITING FOR CREDS | No AWS SDK installed — hand-rolled SigV4 signing in `storageService.cjs`. |
| **Supabase** | Infrastructure | `SUPABASE_URL`, keys | WAITING FOR CREDS | Real `${URL}/rest/v1/` probe. |
| **WhatsApp** | Messaging | `WA_TOKEN` + `WA_PHONE_ID` | **BROKEN — credential VALUE error, not missing** | Token is valid (200 on `/me`). `WA_PHONE_ID` in `.env` holds a WhatsApp *Business Account* ID, not a phone-number-id — the connector correctly follows Meta's Cloud API, but the wrong ID type causes a live 400. Fix is an operator action (fetch the correct value from `{WABA_ID}/phone_numbers`), not a code change. |
| **PayPal** | Payments | — | **NOT IMPLEMENTED** | Zero code anywhere in the repository. |
| **Gmail / Calendar / Drive** | Productivity | Google OAuth scope only | **NOT IMPLEMENTED** as standalone connectors | The app requests OAuth scope for these but makes zero outbound calls to any of the three actual Google APIs. Not counted in the 17 above; noted for completeness. |

## Summary Tally (mission's 4-label vocabulary, 17 connectors)

- **CODE READY (live-verified CONNECTED with real data): 3** — Razorpay, Telegram, OpenAI.
- **WAITING FOR CREDS (code-ready, no credential in this environment): 12** — GitHub, Google, Slack, Discord, Stripe, Notion, Anthropic, Gemini, Cloudflare, AWS, Supabase (S3/R2 ride the same code path as AWS/Cloudflare storage).
- **BROKEN (credential present, live call fails for a non-credential reason): 1** — WhatsApp.
- **NOT IMPLEMENTED (zero real vendor code): 1** — PayPal.

## The Full 47-Connector Runtime Registry (by phase)

`backend/services/integrationConnectors.cjs` organizes all 47 registered connector IDs into 12 lettered phases, each connector implementing a common `connect · health · status · reconnect · rotateCredentials · detectFailure · getMetrics` interface:

| Phase | Domain | Count | Connectors |
|---|---|---|---|
| A | AI Providers | 12 | groq, openai, anthropic, gemini, openrouter, deepseek, together, fireworks, cohere, nvidia, ollama (local), lmstudio (local) |
| B | Git | 3 | github, gitlab, bitbucket |
| C | Infrastructure | 6 | hostinger, cloudflare, firebase, supabase, aws, r2 |
| D | Payments | 4 | razorpay, stripe, paddle, lemonsqueezy |
| E | Email | 7-8 | resend, sendgrid, mailgun, postmark, brevo, ses, smtp |
| F | Messaging | 5 | whatsapp, telegram, twilio, discord, slack |
| G | Authentication (OAuth) | 6 | google, github, microsoft, linkedin, apple, discord |
| H | Productivity | 3 | google_workspace, m365, dropbox |
| I | Commerce | 3 | shopify, woocommerce, wordpress |
| J | Creative | 2 | figma, canva |
| K | Automation | 3 | zapier, make, n8n |
| L | Monitoring | 3 | sentry, datadog, uptime (UptimeRobot) |

**Verification tiers vary by phase** — worth knowing before trusting a "CONNECTED" status at face value:
- **Real, live vendor API calls**: most of Phases A-D, F, most of C.
- **Presence-only / weak verification** (reports CONNECTED from credential presence alone, no live call): GitHub/Apple/Discord OAuth (Phase G), Zapier (URL-format validation only).
- **Not actually probed**: Amazon SES (Phase E) — "cannot probe without sending," reports PARTIAL from credential presence alone. SMTP does a raw TCP connect check only, no protocol handshake.
- **Not a live call**: Firebase (Phase C) — only JSON-parses the service account file, no live call.

## Founder-Facing Setup

`CONNECTOR_SETUP_GUIDE.md` (root, founder-authored, 2026-07-17) is the authoritative practical setup guide. Key facts it documents:
- Only **Groq (AI)** and **Auth** (`JWT_SECRET`/`OPERATOR_PASSWORD_HASH`) are required — the server starts and runs without every other connector; the feature they power is simply disabled until configured.
- Exact webhook URLs and redirect URIs are documented for WhatsApp, Telegram, Razorpay, Resend, and 6 OAuth connectors.
- Explicit sharp-edge warnings: without `RAZORPAY_WEBHOOK_SECRET`, "payments never get marked as confirmed, even though the customer's card was charged." Without `WHATSAPP_APP_SECRET` in production, incoming webhooks fail closed (rejected outright).
- Generic webhook intake routes exist (`POST /business/webhook/{form,email,whatsapp,telegram,payment,calendar,:source}`) with **no signature verification** — documented as "internal/trusted integrations only."

## Limitations Summary

1. No credential rotation is truly automatic for externally-issued secrets (only internally-generated ones like JWT/webhook secrets are auto-staged for rotation).
2. The AI agent tool-calling bridge can report connector *status* but cannot yet perform connector *actions* (no "send Slack message" method exists in the codebase for any provider).
3. Several "CONNECTED" statuses in the dashboard reflect credential presence or a public-endpoint probe, not a fully authenticated live vendor call — see verification-tier notes above.

---

*Next: [09_SAAS_MODEL.md](09_SAAS_MODEL.md) for the business model this connector layer supports.*
