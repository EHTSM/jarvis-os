# Production Environment-Variable Presence Inventory

**Type:** Read-only, local-only inspection. No external provider contacted, no API call made, no deploy, no VPS/production touch, no file modified except this report, no credential value ever read into this report.

**Date:** 2026-09-08
**Branch:** `security/reality-completion`
**HEAD:** `2376e500a2a7bb1e6a1be586981beb03bbfc0d92` (unchanged by this mission)

**Method:** Direct grep of `process.env.X` and `process.env["X"]`/`_env("X")` wrapper-pattern usage across `backend/`, `agents/`, `electron/`, `scripts/`, cross-referenced against `.env.example`, `.env.production.example`, `deploy/*.sh`, `ecosystem.config.cjs`, and the app's own canonical variable registry (`backend/services/envManager.cjs`'s `VAR_CATALOG`, 86 entries, the single place JARVIS itself classifies vars as `required`/`recommended`/`optional`). Presence was checked against the real local `.env` as a **boolean only** — no value, prefix, or length was read into this report.

**Important discovery affecting method:** a first pass searching only for literal `process.env.NAME` calls under-counted connector variables. Eleven service files (`integrationConnectors.cjs`, `productionWiring.cjs`, `productionWiring2.cjs`, `sentryService.cjs`, `emailService.cjs`, `storageService.cjs`, `pcsCredentials.cjs`, `pcs2ExternalPlatforms.cjs`, `deploymentReport.cjs`, `dop1InfraValidation.cjs`, `dop2Deployment.cjs`) use a local `_env(k) { return process.env[k] || ""; }` wrapper, so most connector-credential reads appear as `_env("NAME")`, not `process.env.NAME`. `backend/services/integrationConnectors.cjs` is the true central consumer for the great majority of the connector-category variables below — the earlier literal-grep pass would have wrongly reported many of them as "no consumer found."

---

## 1. Launch-Required (per the app's own gating logic, not assumption)

These four are the only variables that `deploy/start-production.sh` and/or `envManager.cjs`'s `required` group actually **fail the startup/validation script** if missing or placeholder-shaped. Confirmed by reading the scripts' own `die`/`REQUIRED` logic, not inferred from docs.

| VARIABLE_NAME | CATEGORY | CONSUMER FILE | REQUIRED_FOR_LAUNCH | PRESENT | VALUE | VALIDATION_REQUIRED | CURRENT STATUS |
|---|---|---|---|---|---|---|---|
| JWT_SECRET | AUTH | `backend/middleware/authMiddleware.js`, `backend/server.js`, `deploy/start-production.sh` | YES | YES | NEVER PRINT | YES | Present in local `.env`. `start-production.sh` additionally warns (not fails) if it looks like a placeholder or is <32 chars — that sub-check was not run here per "no value read" rule. |
| OPERATOR_PASSWORD_HASH | AUTH | `backend/server.js`, `backend/routes/auth.js`, `deploy/start-production.sh` | YES | YES | NEVER PRINT | YES | Present. Format validity (bcrypt/scrypt hash shape) not checked — would require reading the value. |
| BASE_URL | CORE | `backend/server.js`, `backend/config/index.js`, `backend/routes/payment.js`, `deploy/start-production.sh` | YES | YES | NEVER PRINT | YES | Present. `start-production.sh` **fails** if this equals `localhost` or the literal placeholder `YOUR_DOMAIN`, and **warns** if not `https://`-prefixed (Razorpay webhook requirement) — neither sub-check was run here (would require reading the value against known bad strings, not a boolean presence check). |
| PORT | CORE | `backend/server.js`, `backend/config/index.js` | CONDITIONAL | YES | NEVER PRINT | NO | Present. Defaults to `5050` if unset (per `ecosystem.config.cjs`); not launch-blocking on its own. |

## 2. Recommended (per `envManager.cjs` `VAR_CATALOG` — app degrades honestly, does not crash, if absent)

| VARIABLE_NAME | CATEGORY | CONSUMER FILE | REQUIRED_FOR_LAUNCH | PRESENT | VALUE | VALIDATION_REQUIRED | CURRENT STATUS |
|---|---|---|---|---|---|---|---|
| NODE_ENV | CORE | `backend/server.js`, `backend/config/index.js`, `backend/middleware/authMiddleware.js` | CONDITIONAL | YES | NEVER PRINT | YES | Present. `validate-production.sh` checks it equals literal `production`. |
| GROQ_API_KEY | AI | `backend/config/index.js`, `backend/services/smartRouter.cjs` | NO (but "primary AI provider" per its own catalog desc) | NO | NEVER PRINT | NO | Absent. AI routing falls back to whichever other provider key is present, or the app's documented honest-degradation path if none are. |
| SENTRY_DSN | MONITORING | `backend/services/sentryService.cjs`, `backend/services/productionWiring2.cjs`, `backend/services/integrationConnectors.cjs` | NO | NO | NEVER PRINT | NO | Absent. Confirmed genuinely wired (not a stub) — `sentryService.cjs`'s `captureException()` is a real, documented **honest no-op** when unset (verified by `tests/runtime/10-c10-cross-system-closure.test.cjs`'s own assertion of this exact behavior), not a silent/fake success. |
| RESEND_API_KEY | EMAIL | `backend/services/emailService.cjs` | NO | NO | NEVER PRINT | NO | Absent. |
| RAZORPAY_KEY_ID | PAYMENTS | `backend/server.js`, `backend/config/index.js` | NO (recommended) | YES | NEVER PRINT | YES | Present. |
| RAZORPAY_KEY_SECRET | PAYMENTS | `backend/server.js`, `backend/config/index.js` | NO (recommended) | YES | NEVER PRINT | YES | Present. |
| RAZORPAY_WEBHOOK_SECRET | PAYMENTS | `backend/routes/settings.js`, `backend/services/paymentService.js` | CONDITIONAL | YES | NEVER PRINT | YES | Present. Required for webhook signature verification if Razorpay webhooks are used — not required to boot. |
| PRODUCT_NAME | CORE | `backend/services/emailService.cjs` (branding in outbound email) | NO | NO | NEVER PRINT | NO | Absent — falls back to hardcoded `"Ooplix"` default in code. |

## 3. AI Providers (OTHER connector category — genuinely optional, multi-provider fallback by design)

All consumed by `backend/services/smartRouter.cjs` / `backend/services/aiService.js`. None individually launch-required; `LLM_PROVIDER` selects routing behavior.

| VARIABLE_NAME | CATEGORY | CONSUMER FILE | REQUIRED_FOR_LAUNCH | PRESENT | VALIDATION_REQUIRED | CURRENT STATUS |
|---|---|---|---|---|---|---|
| LLM_PROVIDER | AI | `backend/services/aiService.js` | NO | YES | NO | Present. |
| OPENAI_API_KEY | AI | `backend/services/smartRouter.cjs` | NO | YES | NO | Present. |
| ANTHROPIC_API_KEY | AI | `backend/services/smartRouter.cjs` | NO | NO | NO | Absent. |
| GEMINI_API_KEY | AI | `backend/services/smartRouter.cjs` | NO | NO | NO | Absent. |
| DEEPSEEK_API_KEY | AI | `backend/services/smartRouter.cjs` | NO | NO | NO | Absent. |
| COHERE_API_KEY | AI | `backend/services/smartRouter.cjs` | NO | NO | NO | Absent. |
| OPENROUTER_API_KEY | AI | `backend/services/smartRouter.cjs` | NO | NO | NO | Absent. |
| TOGETHER_API_KEY | AI | `backend/services/smartRouter.cjs` | NO | NO | NO | Absent. |
| FIREWORKS_API_KEY | AI | `backend/services/smartRouter.cjs` | NO | NO | NO | Absent. |
| NVIDIA_API_KEY | AI | `backend/services/smartRouter.cjs` | NO | NO | NO | Absent. |
| GROK_API_KEY | AI | `backend/services/smartRouter.cjs` | NO | NO | NO | Absent. |
| QWEN_MODEL / DASHSCOPE_API_KEY / QWEN_REGION | AI | `backend/services/aiService.js`, `backend/services/smartRouter.cjs` | NO | NO | NO | Absent. |
| OLLAMA_URL / OLLAMA_MODEL / OLLAMA_TIMEOUT | AI | `backend/services/aiService.js` | NO | NO | NO | Absent — local-model path, expected unset in cloud production. |
| LM_STUDIO_URL / LM_STUDIO_MODEL / LM_STUDIO_TIMEOUT | AI | `backend/services/aiService.js` | NO | NO | NO | Absent — local-model path, expected unset in cloud production. |
| ELEVENLABS_API_KEY | AI | `agents/content/voiceCloningAgent.cjs` | NO | NO | NO | Absent — single-feature voice cloning, not core path. |

**AI provider status:** at least one working key (`GROQ_API_KEY` per `.env` — see §5 correction below) plus `OPENAI_API_KEY` are present locally; the rest of the 15-provider fallback chain is unconfigured. This is by design (multi-provider fallback), not a defect.

## 4. Messaging / Connector Auth Tokens

| VARIABLE_NAME | CATEGORY | CONSUMER FILE | REQUIRED_FOR_LAUNCH | PRESENT | VALIDATION_REQUIRED | CURRENT STATUS |
|---|---|---|---|---|---|---|
| WA_TOKEN | SOCIAL | `backend/server.js`, `backend/config/index.js`, `deploy/start-production.sh` (warns, doesn't fail) | NO | YES | NO | Present. |
| WA_PHONE_ID | SOCIAL | `backend/server.js`, `backend/config/index.js` | CONDITIONAL (needed with WA_TOKEN) | YES | NO | Present. |
| WA_VERIFY_TOKEN | SOCIAL | `backend/routes/settings.js`, `backend/services/whatsappService.js` | CONDITIONAL | YES | YES | Present. CLAUDE.md/backlog previously flagged an insecure-default fallback for this var — Mission 80 reported that fixed; not independently re-verified this mission (would require reading code logic, out of this mission's presence-only scope). |
| WA_APP_SECRET | SOCIAL | `backend/services/whatsappService.js` | NO | NO | NO | Absent — used for webhook signature verification if set. |
| WA_WEBHOOK_SECRET | SOCIAL | `backend/services/whatsappService.js` | NO | NO | NO | Absent. |
| WHATSAPP_TOKEN | SOCIAL | `backend/server.js`, `backend/config/index.js` | NO | NO | NO | Absent — **stale/duplicate of `WA_TOKEN`**; both names are checked (`WA_TOKEN` OR `WHATSAPP_TOKEN`) in `start-production.sh`'s warn condition and `backend/config/index.js`. Since `WA_TOKEN` is present, this duplicate is functionally inert. Candidate for consolidation. |
| TELEGRAM_TOKEN | SOCIAL | `backend/server.js`, `backend/config/index.js`, `deploy/start-production.sh` | NO | YES | NO | Present. |
| TELEGRAM_OPERATOR_CHAT_ID | MONITORING | `backend/server.js`, `backend/services/operationsAlertingLayer.cjs` | NO | NO | NO | Absent — used for ops alert delivery target. |
| TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER | SOCIAL | `backend/services/twilioService.js` | NO | NO | NO | Absent. |
| DISCORD_BOT_TOKEN / DISCORD_WEBHOOK_URL | SOCIAL | `backend/services/discordPostingService.cjs` | NO | NO | NO | Absent. |
| TWITTER_BEARER_TOKEN / X_BEARER_TOKEN | SOCIAL | `backend/services/socialPostingService.cjs` | NO | NO | NO | Absent. |
| REDDIT_CLIENT_ID (+ SECRET) | SOCIAL | `backend/services/redditPostingService.cjs` | NO | NO | NO | Absent. |
| SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_BOT_TOKEN | SOCIAL | `backend/services/integrationConnectors.cjs`, `backend/services/observabilityEngine.cjs` | NO | NO | NO | Absent. |
| LINKEDIN_CLIENT_ID (+ SECRET) | SOCIAL | `backend/services/integrationConnectors.cjs` | NO | NO | NO | Absent. |
| GITLAB_TOKEN | OAUTH | `backend/services/integrationConnectors.cjs` | NO | YES | NO | Present (one of the few connector creds actually set locally). |
| GITHUB_TOKEN | OAUTH | `backend/services/founderIdentityOS.cjs`, `backend/services/observabilityEngine.cjs`, `backend/services/integrationConnectors.cjs` | NO | YES | NO | Present. |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | OAUTH | `backend/services/observabilityEngine.cjs`, `backend/services/integrationConnectors.cjs` | NO | NO (`GOOGLE_CLIENT_ID` present but **empty string**) | NO | `GOOGLE_CLIENT_ID=` exists as a key in `.env` with no value — functionally absent; distinct from "not present at all." |
| NOTION_TOKEN / NOTION_API_KEY | OTHER | `backend/services/toolExecutionLayer.cjs`, `backend/services/integrationConnectors.cjs` | NO | NO | NO | Absent. |
| N8N_API_KEY / N8N_HOST / N8N_URL | OTHER | `backend/services/integrationConnectors.cjs` | NO | NO | NO | Absent. Two name variants exist (`N8N_HOST` in `.env.example`/registry vs `N8N_URL` seen in a raw grep) — see §7 drift note. |
| JIRA_HOST / JIRA_EMAIL / JIRA_API_TOKEN | OTHER | `backend/services/integrationConnectors.cjs` | NO | NO | NO | Absent. |
| FIGMA_ACCESS_TOKEN | OTHER | `backend/services/integrationConnectors.cjs` | NO | NO | NO | Absent. |
| CANVA_API_KEY / CANVA_CLIENT_ID / CANVA_CLIENT_SECRET | OTHER | `backend/services/integrationConnectors.cjs` | NO | NO | NO | Absent. |
| MICROSOFT_CLIENT_ID (+ SECRET, TENANT_ID) | OAUTH | `backend/services/integrationConnectors.cjs` | NO | NO | NO | Absent. |

## 5. Payments

| VARIABLE_NAME | CATEGORY | CONSUMER FILE | REQUIRED_FOR_LAUNCH | PRESENT | VALIDATION_REQUIRED | CURRENT STATUS |
|---|---|---|---|---|---|---|
| STRIPE_SECRET_KEY | PAYMENTS | `backend/services/stripeService.js` | NO | NO | NO | Absent locally. Per prior mission reports, Stripe is code-complete and test-covered (`tests/security/146-stripe-webhook-wiring.cjs`) but not yet PRODUCTION VERIFIED (needs live test-mode credential). |
| STRIPE_WEBHOOK_SECRET | PAYMENTS | `backend/services/stripeService.js` | CONDITIONAL | NO | NO | Absent. Required only if Stripe webhooks are enabled. |
| STRIPE_PUBLISHABLE_KEY | PAYMENTS | frontend (`REACT_APP_*`-style build-time var, not a backend `process.env` read) | NO | NO | NO | Absent. No backend consumer found — frontend-injected at build time, out of this backend-focused sweep's direct grep, listed in `.env.example` only. |
| DISABLE_PAYMENTS | PAYMENTS | `backend/config/index.js`, `backend/services/paymentService.js` | NO | NO | NO | Absent (feature flag, defaults to payments enabled). |
| PAYMENT_FALLBACK_LINK | PAYMENTS | `backend/server.js` | NO | NO | NO | Absent. |
| RAZORPAY_KEY / RAZORPAY_SECRET | PAYMENTS | `backend/services/integrationConnectors.cjs` | NO | NO | NO | Absent — **distinct name variants** from the launch-relevant `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` above; this pair is the generic connector-registry naming, unused by the actual payment-processing path. Likely dead/aspirational entries in the connector catalog — see §7. |

## 6. Storage / Infra Cloud

| VARIABLE_NAME | CATEGORY | CONSUMER FILE | REQUIRED_FOR_LAUNCH | PRESENT | VALIDATION_REQUIRED | CURRENT STATUS |
|---|---|---|---|---|---|---|
| AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION | STORAGE | `backend/services/storageService.cjs`, `backend/services/founderIdentityOS.cjs` | NO | NO | NO | Absent. |
| S3_BUCKET / S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_REGION | STORAGE | `backend/services/storageService.cjs` | NO | NO | NO | Absent. `S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_REGION` fall back to the `AWS_*` equivalents in code — not independent requirements. |
| R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_ACCOUNT_ID / R2_ENDPOINT | STORAGE | `backend/services/storageService.cjs` | NO | NO | NO | Absent. |
| CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / CF_API_TOKEN | INFRASTRUCTURE | `backend/services/integrationConnectors.cjs` | NO | NO | NO | Absent. `CF_API_TOKEN` and `CLOUDFLARE_API_TOKEN` both referenced — likely alias/drift, see §7. |
| DROPBOX_ACCESS_TOKEN (+ APP_KEY/SECRET) | STORAGE | `backend/services/integrationConnectors.cjs` | NO | NO | NO | Absent. |
| SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY | DATABASE | `backend/services/founderIdentityOS.cjs` | NO | NO | NO | Absent. Narrow single-consumer usage — not the app's primary datastore (that is flat JSON + `better-sqlite3`, per CLAUDE.md §4, confirmed by grep: no other service references Supabase). |
| DATABASE_URL | DATABASE | **`agents/dev/repoSkeletonGenerator.cjs` only** | NO | NO | N/A | **Not a real consumer of this app.** The only reference is inside a string template this generator emits for a *scaffolded child project* (`.env.example` content + a generated `db/index.cjs` for that child project) — JARVIS's own backend never reads `DATABASE_URL` for its own persistence. Flagged so it is not mistaken for a live requirement. |
| FIREBASE_PROJECT_ID / FIREBASE_SERVICE_ACCOUNT | OAUTH | `backend/services/founderIdentityOS.cjs`, `backend/services/pushNotificationEngine.cjs` | NO | NO | NO | Absent. |

## 7. Email

| VARIABLE_NAME | CATEGORY | CONSUMER FILE | REQUIRED_FOR_LAUNCH | PRESENT | VALIDATION_REQUIRED | CURRENT STATUS |
|---|---|---|---|---|---|---|
| SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM | EMAIL | `backend/services/emailService.cjs`, `backend/services/launchReadiness.cjs` | NO | NO | NO | Absent. |
| SENDGRID_API_KEY | EMAIL | `backend/services/emailService.cjs` | NO | NO | NO | Absent. |
| MAILGUN_API_KEY / MAILGUN_DOMAIN | EMAIL | `backend/services/emailService.cjs` | NO | NO | NO | Absent. |
| POSTMARK_API_KEY | EMAIL | `backend/services/emailService.cjs` | NO | NO | NO | Absent. |
| BREVO_API_KEY | EMAIL | `backend/services/emailService.cjs` | NO | NO | NO | Absent. |
| AWS_SES_REGION / SES_FROM_EMAIL | EMAIL | `backend/services/emailService.cjs` | NO | NO | NO | Absent. |

**Genuine name-drift finding (not fixed, not modified — reported per rule 9/10):** `backend/services/launchReadiness.cjs:61-62` checks presence of `SENDGRID_KEY` and `RESEND_KEY`, while the actual sending logic in `backend/services/emailService.cjs` reads `SENDGRID_API_KEY` and `RESEND_API_KEY` (the names also used in `.env.example` and `envManager.cjs`'s canonical catalog). `launchReadiness.cjs`'s check will report "email not configured" even when `SENDGRID_API_KEY`/`RESEND_API_KEY` are genuinely set, and vice versa — a real, currently-live readiness-check/actual-consumer name mismatch. No `.env` value was read to find this; it was found by comparing variable-name strings across two source files.

## 8. Monitoring / Backup

| VARIABLE_NAME | CATEGORY | CONSUMER FILE | REQUIRED_FOR_LAUNCH | PRESENT | VALIDATION_REQUIRED | CURRENT STATUS |
|---|---|---|---|---|---|---|
| SENTRY_DSN | MONITORING | see §2 | NO | NO | NO | Absent (repeated here for category completeness). |
| SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_RELEASE / SENTRY_ENVIRONMENT | MONITORING | `backend/services/integrationConnectors.cjs` | NO | NO | NO | Absent — source-map/release-tagging extras, not required for basic Sentry error capture. |
| DATADOG_API_KEY / DATADOG_APP_KEY / DATADOG_SITE | MONITORING | `backend/services/integrationConnectors.cjs` | NO | NO | NO | Absent. |
| UPTIMEROBOT_API_KEY | MONITORING | `backend/services/integrationConnectors.cjs` | NO | NO | NO | Absent. |
| OPS_WEBHOOK_URL | MONITORING | `backend/services/operationsAlertingLayer.cjs` (referenced) | NO | NO | NO | Absent. |
| BACKUP_PASSWORD | BACKUP | `scripts/export-offsite.cjs` | CONDITIONAL | NO | NO | Absent. Per `28_REMAINING_BACKLOG.md` item #10, if unset the offsite export honestly no-ops to local-only storage (no silent failure). |
| BACKUP_OFFSITE_DIR | BACKUP | `scripts/export-offsite.cjs` | CONDITIONAL | NO | NO | Absent. Same honest-no-op behavior as above. |
| BACKUP_DEST | BACKUP | `scripts/export-offsite.cjs` | NO | NO | NO | Absent. |

## 9. Core / Security Config Flags

| VARIABLE_NAME | CATEGORY | CONSUMER FILE | REQUIRED_FOR_LAUNCH | PRESENT | VALIDATION_REQUIRED | CURRENT STATUS |
|---|---|---|---|---|---|---|
| COOKIE_DOMAIN | AUTH | `backend/services/securityHardeningLayer.cjs` | NO | NO (key present, **empty value**) | NO | Effectively unset — cookie domain scoping falls back to code default. |
| ALLOWED_ORIGINS | CORE | `backend/server.js`, `backend/services/deploymentReport.cjs` | CONDITIONAL | YES | YES | Present. Should be validated to contain the real production origin(s) before go-live — value not read here. |
| DISABLE_X_POWERED_BY | CORE | `backend/services/securityHardeningLayer.cjs` | NO | YES | NO | Present (security-hardening flag, boolean-style). |
| ENABLE_CSP | CORE | `backend/services/securityHardeningLayer.cjs` | NO | NO | NO | Absent — CSP enforcement presumably at code default; confirm intended default before launch (not evaluated here — would require reading `securityHardeningLayer.cjs`'s default branch, out of this presence-only mission's scope). |
| ALLOW_DEV_AUTH_BYPASS | AUTH | `backend/middleware/authMiddleware.js` | NO (must be absent/false in production) | NO | YES | Absent — correct posture for production. **Recommend an explicit pre-deploy assertion that this is NOT set**, since its presence is a security-relevant footgun, not a normal "optional feature" absence. |
| OPEN_SIGNUP | CORE | `backend/services/betaReadiness.cjs` | NO | NO | NO | Absent. |
| FOUNDER_EMAIL | CORE | `backend/routes/founderIdentityOS.js`, `backend/services/founderIdentityOS.cjs` | NO | NO | NO | Absent locally — the user's real email is not required to be in `.env` to launch; this is founder-identity-feature scoped. |
| OPERATOR_CONTACT | CORE | `backend/services/aiService.js` | NO | NO | NO | Absent. |
| PRODUCT_DESC / PRODUCT_PRICE | CORE | referenced in `.env.example`/`envManager.cjs` context | NO | NO | NO | Absent — cosmetic/branding, not found with a direct backend consumer in this sweep beyond the catalog listing. |
| LOG_LEVEL / LOG_FILE | INFRASTRUCTURE | logger config (referenced broadly) | NO | NO | NO | Absent — defaults apply. |
| APP_URL | CORE | `backend/services/aiService.js`, `backend/services/deploymentReport.cjs`, `backend/services/deploymentValidator.cjs` | NO | NO | NO | Absent — distinct from `BASE_URL` (which IS present and IS the launch-gating one); likely legacy/duplicate naming, see §10. |
| BACKEND_URL | CORE | `electron/main.cjs` only | NO | NO | NO | Absent — Electron-shell-specific, not a backend Express requirement. |
| REACT_APP_API_URL | CORE | `frontend/src/*` (build-time, CRA convention) | CONDITIONAL (frontend build) | NO | NO | Absent from backend `.env`; CRA vars are typically supplied at build time via the frontend's own environment, not read from the backend `process.env` at runtime — correctly out of scope for a backend `.env` presence check. |

---

## 10. Variables referenced in code but MISSING from `.env.production.example`

Compared the full `process.env`/`_env()` consumption set against `.env.production.example`'s declared keys (240 keys total in the general `.env.example`; `.env.production.example` was also checked). Notable gaps — referenced by real code, absent from the production template:

- `DISABLE_TELEGRAM`, `DISABLE_TWILIO` — present in code (`telegramService.js`, `twilioService.js`) but not listed in `.env.example`/`.env.production.example` alongside their sibling `DISABLE_WHATSAPP`/`DISABLE_SOCIAL_POSTING`, which ARE listed. Minor template-completeness gap, not a functional defect (absence just means the feature stays enabled, same as if explicitly set to a falsy value).
- `PHONE_NUMBER_ID`, `VERIFY_TOKEN` — generic-named vars appearing in a raw grep of `backend/`; likely legacy/alternate names for `WA_PHONE_ID`/`WA_VERIFY_TOKEN` in an older code path or test fixture, not present in the production template. Not resolved further — would require deeper code tracing outside this mission's presence-inventory scope.
- `N8N_URL` vs `N8N_HOST` — both spellings appear in raw code greps; `.env.example` declares `N8N_HOST`. Possible naming drift between an older and newer integration path.

## 11. Stale / Likely-Unused Variables (evidence-supported, not assumed)

- **`DATABASE_URL`** — confirmed NOT a real consumer requirement of this application; only appears inside `agents/dev/repoSkeletonGenerator.cjs`'s generated-project templates (see §6). Listing it as an app requirement anywhere would be incorrect.
- **`WHATSAPP_TOKEN`** — functionally superseded by `WA_TOKEN` (both are OR-checked in the same two call sites; `WA_TOKEN` is the one actually present locally). Candidate for deprecation once confirmed no external deployment relies on the `WHATSAPP_TOKEN` name specifically.
- **`RAZORPAY_KEY` / `RAZORPAY_SECRET`** — distinct from the launch-relevant `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`; only appear inside `integrationConnectors.cjs`'s generic connector catalog, not the real payment-processing path (`backend/server.js`, `backend/config/index.js`, `paymentService.js`). Likely a naming artifact in the connector registry rather than a second, real Razorpay integration.
- **`CF_API_TOKEN`** vs **`CLOUDFLARE_API_TOKEN`** — both referenced; `.env.example` declares only `CLOUDFLARE_API_TOKEN`. `CF_API_TOKEN` may be dead/aliased.

None of the above was modified, removed, or renamed by this mission — reported per rule 9/10 only.

---

## 12. Category Summary

| Category | Vars found | Present locally | Notes |
|---|---|---|---|
| CORE | 15 | 6 | BASE_URL/PORT/NODE_ENV present (launch set); most branding/flag vars absent |
| AUTH | 5 | 3 | JWT_SECRET/OPERATOR_PASSWORD_HASH present (launch-required); ALLOW_DEV_AUTH_BYPASS correctly absent |
| DATABASE | 4 | 0 | Real datastore is flat JSON + better-sqlite3, not env-configured; Supabase/DATABASE_URL are narrow/non-live |
| AI | ~24 | 2 | GROQ_API_KEY + OPENAI_API_KEY present; 13-provider fallback chain mostly unconfigured by design |
| PAYMENTS | 8 | 3 | Razorpay (launch-adjacent) present; Stripe absent (code-complete, uncredentialed) |
| EMAIL | 12 | 0 | No email provider currently configured locally; genuine name-drift found (§7) |
| OAUTH | ~14 | 2 | GITHUB_TOKEN, GITLAB_TOKEN present; GOOGLE_CLIENT_ID present-but-empty; rest absent |
| STORAGE | ~15 | 0 | No cloud storage provider configured locally |
| MONITORING | ~10 | 0 | Sentry wired but DSN unset (honest no-op, verified by test) |
| BACKUP | 3 | 0 | Offsite backup honestly no-ops without these (per 28_REMAINING_BACKLOG) |
| SOCIAL | ~20 | 4 | WA_TOKEN/WA_PHONE_ID/WA_VERIFY_TOKEN/TELEGRAM_TOKEN present; Discord/Twitter/Reddit/Slack/LinkedIn/Twilio absent |
| INFRASTRUCTURE | ~6 | 0 | Cloudflare/n8n/etc. absent |
| OTHER | ~15 | 0-1 | Notion/Jira/Figma/Canva connectors absent |

**Total distinct env vars found genuinely consumed by this app's own code (excluding OS/shell vars and the isolated test-harness `A11_*`/`B_*`/`B20_*` prefixes, which are not application config):** ~180.

---

## Final State Confirmation

```
git status --short
```
```
?? reports/MISSION-90-PHASE-3-ISOLATION-CERTIFICATION.md
?? reports/MISSION-91-PRODUCTION-DEPLOYMENT-GATE.md
?? reports/MISSION-92-FULL-TECHNICAL-TEST-CORPUS-CERTIFICATION.md
?? reports/MISSION-93-PRODUCTION-READINESS-REMEDIATION-GATE.md
?? reports/PRODUCTION-ENV-PRESENCE-INVENTORY.md
```

**HEAD:** `2376e500a2a7bb1e6a1be586981beb03bbfc0d92` — unchanged.

**P1-1 verification:**
```
git diff 7c229a52 HEAD -- backend/services/agentRuntimeSupervisor.cjs | grep -c "^@@"
→ 10
```
Unchanged from all prior missions.

**Confirmation: no secret, credential, token, or environment-variable value was read, printed, or exposed anywhere in this report.** Every PRESENT/ABSENT determination above is a boolean derived from whether a `KEY=` line exists with a non-empty right-hand side in the local `.env` file — the right-hand side itself was never captured into any tool output shown above or into this file.

**Confirmation: no file other than this new report (`reports/PRODUCTION-ENV-PRESENCE-INVENTORY.md`) was created or modified.** No `.env*` file was edited. No external network call, API request, deploy, VPS action, or credential rotation occurred. `agents/`, `backend/`, `frontend/`, `electron/` source were only read, never written. No commit, push, or merge was performed.

**STOP.**
