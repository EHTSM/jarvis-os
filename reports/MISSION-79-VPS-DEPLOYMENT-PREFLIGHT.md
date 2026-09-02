# MISSION 79 — VPS DEPLOYMENT PREFLIGHT
## Manual Configuration + Deployment Runbook Generation

**Date:** 2026-09-02
**Branch:** `security/reality-completion`
**Type:** Documentation-only. No code changed. No deployment performed.
**Predecessor:** `reports/MISSION-78-FINAL-PRE-VPS-AUDIT.md` (verdict: VPS-READY WITH MANUAL CONFIGURATION)

> **THIS MISSION DID NOT DEPLOY ANYTHING.** No SSH session was opened, no VPS was touched, no DNS record was created, no TLS certificate was issued, no Nginx/PM2 process was started or reloaded, no credential was provisioned or rotated, no production database was migrated or restored, no email/social/payment/WhatsApp/Telegram side effect occurred, and nothing was committed or pushed. Every command in this report is documentation of what an operator must run manually — none of it was executed by this mission.

---

## 0. Method Note — Cross-Checking "Authoritative" Docs Against Code

The mission brief named several docs as authoritative (`00_START_HERE.md`, `DOCUMENTATION_INDEX.md`, `FILE_REFERENCE.md`, `DELIVERY_SUMMARY.md`, `EVOLUTION_SYSTEM_DOCS.md`, `V1 Progress Audit.txt`). **None of these files exist in this repository** — confirmed by direct `ls`/`find`, not assumed. The real, current deployment documentation is:

- `PRODUCTION_DEPLOYMENT_GUIDE.md` (152 lines) — read in full. Verified accurate: every prose claim in it was independently cross-checked against the actual scripts it describes (`deploy/start-production.sh`, `ecosystem.config.cjs`) and matched exactly.
- `DEPLOY_CHECKLIST.md` (155 lines, self-dated "Generated: 2026-05-20") — read in full. **Found stale in one material respect**: it states PM2 `max_memory_restart: "512M"` and `node_args: "--max-old-space-size=400"`. The actual current `ecosystem.config.cjs` (verified by direct read, not grep alone) has `max_memory_restart: "1536M"` and `node_args: "--max-old-space-size=1024"`, with an in-file comment explaining these were resized after a real, measured OOM incident (peak RSS ~740MB at t+15s against the old 512M/400M ceiling). **This report uses the real, current values everywhere, not the stale checklist's.** This is exactly the failure mode the mission's Step 2 warned about ("Do not blindly trust them"), and it was caught, not assumed away.
- `DEPLOYMENT_RUNBOOK.md`, `DISASTER_RECOVERY.md`, `reports/MISSION-77-DR-BACKUP.md`, `reports/MISSION-78-FINAL-PRE-VPS-AUDIT.md` — used as secondary sources, cross-checked against code where reused here.

No other discrepancies between documentation and code were found during this mission's direct verification passes (server.js port/host logic, start-production.sh's exact validation conditionals, healthcheck.sh, validate-production.sh's section structure, nginx configs, ecosystem.config.cjs in full, all deploy/*.sh scripts, .env.example cross-referenced against real consumers).

---

## 1. Executive Summary

The repository is a single-VPS-deployable Express 5 + React (CRA) + Electron system with mature, already-built deployment tooling (`deploy/*.sh`, two Nginx configs, a PM2 ecosystem file, a validation script). Mission 78 certified the codebase itself as VPS-ready. This mission adds nothing to the code; it produces the exact command sequence, environment variable matrix, DNS/OAuth/webhook tables, and manual-action register an operator needs to actually run that deployment.

**Bottom line:** the blocking gaps are not code defects — they are configuration/credential/infrastructure items only a human with account access can supply (a VPS, a domain, OAuth app credentials, payment provider keys, a JWT secret, an operator password hash). These are enumerated exhaustively in §21 (Manual Action Register) and §25 (Deployment Blockers).

**FINAL STATUS: READY WITH MANUAL CONFIGURATION** (see §26).

---

## 2. Actual Production Stack

Verified directly, not inferred from documentation:

| Layer | Actual value | Evidence |
|---|---|---|
| OS target | Ubuntu 22.04/24.04 | `deploy/setup-vps.sh` header + `apt-get`/NodeSource commands |
| Runtime | Node.js 20 LTS | `deploy/setup-vps.sh` installs via NodeSource `setup_20.x` only if `node` absent |
| Package manager | npm (no pnpm/yarn lockfile present) | `package-lock.json` present at root and `frontend/` |
| Backend framework | Express 5.2.1 | `package.json` dependency; `req.query` is a read-only getter in this version — a confirmed, previously-exploited fact (Mission 78, `exportFiles.js`) |
| Frontend framework | Create React App (`react-scripts` 5.0.1), React 18.2.0 | `frontend/package.json`; not Vite |
| Database | `better-sqlite3`, file `data/jarvis.db` | Self-healing on first boot; most persistence is actually flat JSON under `data/` (600+ files), not SQL |
| Process manager | PM2, fork mode, `ecosystem.config.cjs` | 2 apps: `jarvis-os` (fork, 1 instance) + `ooplix-backup` (cron-restart only) |
| Reverse proxy | Nginx | Two alternate configs: `deploy/nginx-jarvis.conf` (single-domain) and `deploy/nginx-multisite.conf` (3-vhost split) |
| TLS | Certbot (Let's Encrypt) via `deploy/https-setup.sh` | `certbot --nginx` |
| Storage | Cloudflare R2 (preferred) → AWS S3 (fallback) → local disk | `backend/services/storageService.cjs`, priority order confirmed in code |
| Queue/workers | None separate — in-process `taskQueue` singleton inside the single `jarvis-os` PM2 process | Confirmed: no Redis, no BullMQ, no separate worker process anywhere in the repo |
| Scheduler | `node-cron` (in-process, 7+ call sites) + PM2's own `cron_restart` for the backup job | No second scheduling library exists — do not introduce one |
| Real-time transport | Server-Sent Events (SSE) only | `/runtime/stream` in both Nginx configs tuned for SSE (`proxy_buffering off`, `chunked_transfer_encoding on`, long `proxy_read_timeout`). **No actual WebSocket implementation exists anywhere** — no `ws`/`socket.io`/`engine.io` dependency in either `package.json`; the word "WebSocket" appearing in some internal deployment-audit service files (`dop1InfraValidation.cjs`, `dop2Deployment.cjs`, `productionDeployment.cjs`) and one frontend diagnostic string is legacy/imprecise naming for the SSE check, not real usage. Neither Nginx config sets `Connection: upgrade` — only `Connection: ""` (SSE tuning). |
| Desktop packaging | Electron, `electron-builder` (`dist:mac/win/linux/all`) | Separate distribution channel — **Electron is NOT a VPS service**; it is not part of this deployment |
| Supabase | Not used as primary DB — only referenced as one of many optional third-party integration credentials (`SUPABASE_URL/ANON_KEY/SERVICE_KEY`) consumed by `founderIdentityOS.cjs`/`integrationConnectors.cjs` | Confirmed via grep; not a required infra dependency |
| CI | GitHub Actions (`.github/workflows/ci.yml`, `.github/workflows/release.yml`) | `regression` job runs `test:runtime`+`test:security` via `scripts/run-test-suite.cjs`, outcome-gated |

No component was invented or assumed beyond what the above evidence shows.

---

## 3. Repository Deployment Requirements — Build & Start Commands (verbatim from `package.json`)

```
Frontend build:    npm run build:frontend        → cd frontend && npm run build
Backend start:     npm start                     → node scripts/check-startup-env.cjs && node backend/server.js
                   (production path is NOT `npm start` directly — see §11, use deploy/start-production.sh)
PM2 start:         npm run pm2:start             → pm2 start ecosystem.config.cjs --env production
PM2 restart:       npm run pm2:restart           → pm2 restart jarvis-os
PM2 logs:          npm run pm2:logs              → pm2 logs jarvis-os
PM2 stop:          npm run pm2:stop              → pm2 stop jarvis-os
Deploy setup:      npm run deploy:setup          → bash deploy/setup-vps.sh
Deploy start:      npm run deploy:start          → bash deploy/start-production.sh
Deploy update:     npm run deploy:update         → bash deploy/update.sh
Deploy rollback:   npm run deploy:rollback       → bash deploy/rollback.sh
Env check:         npm run env:check             → node scripts/check-startup-env.cjs
Backup (npm alias):npm run backup                → bash backup.sh   (NOTE: distinct from the PM2 cron job, which runs scripts/safe-backup.cjs directly — two different backup entrypoints exist, see §14)
Electron build:    npm run dist:mac/win/linux/all → npm run build:frontend && electron-builder ...
Electron smoke:    npm run electron:smoke        → node scripts/electron-smoke-test.cjs
Security check:    npm run security:no-raw-exec  → node scripts/check-no-raw-exec.cjs
```

**Never run `node backend/server.js` manually while PM2 manages the process** — it silently holds port 5050 with no error surfaced in PM2 logs, blocking future `pm2 restart`. Always use `pm2 restart jarvis-os` (project convention, `CLAUDE.md` §7/§21).

---

## 4. Node/Package Runtime

- Node 20 LTS required (installed by `setup-vps.sh` only if absent — idempotent, does not force-upgrade an existing newer Node).
- `npm install --omit=dev --ignore-scripts` is the production install command used by both `setup-vps.sh` and `update.sh` — `--ignore-scripts` is deliberate (skips arbitrary postinstall scripts from third-party packages as a supply-chain safeguard); this means any package needing a native build step (e.g. `better-sqlite3`) must already have a prebuilt binary available for the target platform, or the operator must separately run its build step. This was not independently re-verified against `better-sqlite3`'s actual npm prebuild coverage for Ubuntu 22.04/24.04 x64/arm64 in this mission — **flagged as a first-boot risk to watch for**, not a confirmed defect.
- No lockfile mismatch found — `package-lock.json` present at root and in `frontend/`.

---

## 5. Environment Master Matrix

Full variable-by-variable tracing was performed against real code consumers (not just `.env.example`'s own [REQUIRED]/[OPTIONAL] comments), cross-referenced against `backend/server.js`'s own `ENV_SERVICES` startup-validation object. Full detail (100+ variables) is preserved in this mission's working notes; the tables below extract everything that affects a go/no-go deployment decision.

### 5.1 `backend/server.js`'s own declared startup contract (ground truth, not doc-inferred)

```js
const ENV_SERVICES = {
    ai:       { vars: ["GROQ_API_KEY"],          required: true  },
    telegram: { vars: ["TELEGRAM_TOKEN"],         required: false },
    firebase: { vars: ["FIREBASE_PROJECT_ID"],    required: false },
    maps:     { vars: ["GOOGLE_API"],             required: false },
};
```
Plus two special-cased checks outside the loop: `payments` (`RAZORPAY_KEY||RAZORPAY_KEY_ID` and `RAZORPAY_SECRET||RAZORPAY_KEY_SECRET`, optional/info-logged) and `whatsapp` (`WA_TOKEN||WHATSAPP_TOKEN` and `WA_PHONE_ID||PHONE_NUMBER_ID`, optional/info-logged). Separately (not in this object), `JWT_SECRET && OPERATOR_PASSWORD_HASH` triggers a **hard production FATAL** if either is missing when `NODE_ENV===production` — auth routes return 503.

**Note:** `ENV_SERVICES.maps → GOOGLE_API` is dead/orphaned — no such variable exists anywhere in `.env.example` or the codebase (real Google integrations use `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, unrelated). Not a blocker; noted for accuracy.

### 5.2 REQUIRED — deployment blocks without these

| Variable | Consumer | Failure mode if missing |
|---|---|---|
| `JWT_SECRET` | `authMiddleware.js` (throws), `secretVault.cjs` (HKDF-derives the AES-256-GCM vault key) | **Production FATAL.** Login and all auth-gated routes 503. Also: this key doubles as the credential-vault encryption root — rotating it after first boot orphans every already-stored credential in the vault. Must be a high-entropy secret (script warns if <32 chars or contains "your"/"change"). |
| `OPERATOR_PASSWORD_HASH` | `backend/routes/auth.js`, `accountService.js` | **Production FATAL.** Login 503. Generate via `node scripts/generate-password-hash.cjs`. |
| `BASE_URL` | 25+ files (payment.js, billingService, emailService, oauthIntegrationLayer, `deploy/start-production.sh`'s own validator) | `start-production.sh` hard-`die`s if unset, contains `localhost`, or contains `YOUR_DOMAIN`. Must be `https://yourdomain.com` (no trailing slash, confirmed real prod value pattern). Stripe checkout (payment.js:114-116) 500s without a valid public value. |
| `GROQ_API_KEY` | `aiService.js`, `ENV_SERVICES.ai` | Soft — logs a warning, does not crash. But this is the only AI provider with zero fallback configured by default; without it (and without any of the other 13 AI keys) all AI-dependent features fail at request time, not at startup. |

### 5.3 Genuinely optional / provider-specific (deployment does not block on these)

All 13 other AI provider keys (OpenRouter, OpenAI, Anthropic, Gemini, DeepSeek, Together, Fireworks, Cohere, NVIDIA, Grok, DashScope/Qwen, Ollama, LM Studio) — pure fallback tier, app functions with zero set. Full list: Razorpay (`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET`/3 plan IDs), Stripe (owned by the concurrent ERA-2 session — noted, not inspected further), Paddle, LemonSqueezy, all 6 email providers (Resend→SendGrid→Mailgun→Postmark→Brevo→SMTP→SES fallback chain in `emailService.cjs`), Telegram, WhatsApp, Twilio, Discord, Slack, Teams, all 14 social-posting OAuth apps (Twitter/X, Facebook+Instagram, Threads, Pinterest, Reddit, GBP, YouTube, TikTok), all consumer sign-in OAuth apps (Google, Microsoft, LinkedIn, Apple, Discord, Notion), all git-provider integrations (GitHub, GitLab, Bitbucket), all cloud/infra integrations (Hostinger, Cloudflare, Supabase, Datadog, UptimeRobot), all productivity/commerce/creative/automation integrations (Dropbox, Notion, Shopify, WooCommerce, WordPress, Figma, Canva, Zapier, Make, n8n), Sentry (`SENTRY_DSN`/`SENTRY_AUTH_TOKEN`/etc.), `GNEWS_API_KEY`, `OPENWEATHER_API_KEY`. Each degrades its own feature gracefully to "not configured" — none crashes the app.

Storage: `R2_*` (Cloudflare R2, checked first) or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`S3_*` (fallback) — if both unset, `storageService.configured` is `false` and storage-dependent features degrade; app still boots.

`ALLOWED_ORIGINS` — functionally important (adds to the hardcoded production CORS allowlist in `server.js`, does not replace it) but does not crash the app if unset; cross-origin frontend calls simply fail if the real deployed frontend domain isn't in the effective allowlist.

### 5.4 Confirmed dead / templated-but-unused / functionally inert (do not treat these as real gaps)

These were positively confirmed by the discovery agent to have **zero real code consumers**, or to be consumed only by an internal audit-checklist function rather than the actual runtime behavior they appear to describe:

- `DEBUG`, `DEBUG_PIPELINE` — zero consumers anywhere in `backend/`/`agents/`/`scripts/`.
- `SES_FROM_EMAIL` — `emailService.cjs`'s real `FROM()` function only reads `SMTP_FROM`/`EMAIL_FROM` (the latter a working undocumented alias not present in `.env.example`), never `SES_FROM_EMAIL`.
- `GITHUB_APP_ID` — only ever displayed in a readiness/status catalog object; no live GitHub App JWT/installation-token flow reads it.
- `ENABLE_LOCAL_DESKTOP` / `ENABLE_RUNTIME_DESKTOP` — gate Electron/desktop bootstrap only, irrelevant to a headless VPS.
- `COOKIE_DOMAIN` — read only by `securityHardeningLayer.cjs`'s own audit-warning function; the actual `COOKIE_OPTS` object used in `backend/routes/auth.js` never reads it, so setting it changes nothing about real cookie behavior (it only silences the audit warning). **This is a real disconnect between the audit checklist and runtime code** — worth fixing in a future mission if subdomain cookie-sharing is ever needed, but out of scope here (docs-only mission).
- `DISABLE_X_POWERED_BY`, `ENABLE_CSP` — same pattern: `server.js` already unconditionally disables `x-powered-by` and sets a full CSP header regardless of these vars; they only mute the corresponding audit-checklist warning, not actual behavior.
- `REACT_APP_GTM_ID`, `REACT_APP_GA` — not read anywhere in `frontend/src/analytics.js` despite that file's own header comment suggesting they're configurable; the real GTM/GA container IDs are hardcoded literals in `frontend/public/index.html`.

### 5.5 Genuine security footgun found in the template default

`WA_VERIFY_TOKEN`'s `.env.example` default is the literal string `change_this_to_a_random_secret` — a **non-random, publicly-known placeholder committed to the template**. If an operator ever exposes the WhatsApp webhook without changing this, it is a predictable value and a real webhook-spoofing risk. **Manual action: this must be regenerated to a random value before enabling the WhatsApp webhook route** (see §21).

`RAZORPAY_WEBHOOK_SECRET` — production behavior hard-rejects an unsigned webhook if this is unset (`paymentService.js`), but non-production silently **accepts** an unsigned webhook. This is correct-by-design as long as `NODE_ENV=production` is set correctly on the VPS — a real risk only if `NODE_ENV` is ever misconfigured.

---

## 6. Domain/DNS Matrix

No IP address is invented anywhere below — `<VPS_IP>` is a literal placeholder for the operator to fill in.

| TYPE | HOST | TARGET | PURPOSE | REQUIRED? | MANUAL ACTION |
|---|---|---|---|---|---|
| A | `yourdomain.com` (single-domain path, `nginx-jarvis.conf`) | `<VPS_IP>` | Frontend + API, same origin | Yes (Path A) | Create in DNS provider; wait for propagation before running `https-setup.sh` (script itself verifies via `dig` and aborts on mismatch to avoid Let's Encrypt rate-limit burn) |
| A | `www.yourdomain.com` | `<VPS_IP>` | www redirect | Yes (Path A) | Same as above |
| A | `ooplix.com` (split-domain path, `nginx-multisite.conf`) | `<VPS_IP>` | Marketing/root site | Only if using split-vhost topology | Create in DNS provider |
| A | `www.ooplix.com` | `<VPS_IP>` | www alias | Only if split-vhost | Create in DNS provider |
| A | `app.ooplix.com` | `<VPS_IP>` | Frontend SPA (split-vhost) | Only if split-vhost | Create in DNS provider |
| A | `api.ooplix.com` | `<VPS_IP>` | API-only vhost (split-vhost) | Only if split-vhost | Create in DNS provider; if used, also set `REACT_APP_API_URL=https://api.ooplix.com` at frontend build time and add the domain to `ALLOWED_ORIGINS` |

**Decision required:** which topology — single-domain (`nginx-jarvis.conf`, placeholders, generic) or the already-configured split-vhost (`nginx-multisite.conf`, hardcoded to the real `ooplix.com` family and already has live-looking cert paths) — is the intended production topology for this VPS deployment. `nginx-multisite.conf` already assumes `ooplix.com` is the real domain; `nginx-jarvis.conf` is domain-agnostic. **DECISION REQUIRED** (see §24).

---

## 7. OAuth Callback Matrix

All 13 providers use the same construction pattern via `oauthIntegrationLayer.cjs`: `{BASE_URL}/{provider}/oauth/callback` (or the provider's own `*_REDIRECT_URI` var if independently set in `.env.example`, which takes precedence). None of these can be registered without a live `BASE_URL` and a live provider developer-console app.

| Provider | Redirect URI pattern | Credential vars | Required for |
|---|---|---|---|
| Google | `{BASE_URL}/google/oauth/callback` or `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI` | Consumer sign-in; also fallback for GBP/YouTube posting if their own creds unset | Google sign-in, GBP posting, YouTube posting |
| Microsoft | `{BASE_URL}/microsoft/oauth/callback` or `MICROSOFT_*` | Consumer sign-in | Microsoft/Teams sign-in |
| LinkedIn | `LINKEDIN_REDIRECT_URL` | Sign-in AND posting (same app, no separate posting credential) | LinkedIn sign-in + posting |
| Facebook | `FACEBOOK_REDIRECT_URI` | Sign-in AND Instagram posting (same app) | Facebook/Instagram — **requires Meta App Review**, external approval gate |
| Threads | `THREADS_REDIRECT_URI` | Posting | Threads posting |
| Pinterest | `PINTEREST_REDIRECT_URI` | Posting | Pinterest posting |
| Reddit | `REDDIT_REDIRECT_URI` | Posting | Reddit posting |
| TikTok | `TIKTOK_REDIRECT_URI` | Posting | TikTok posting |
| Discord | `DISCORD_REDIRECT_URI` | Sign-in AND bot/posting (same app) | Discord sign-in + posting |
| Notion | `NOTION_CLIENT_ID`/`SECRET`/`REDIRECT_URI` | Integration | Notion connector |
| GitHub | `GITHUB_CLIENT_ID`/`SECRET`/`REDIRECT_URI` | Sign-in/connector (separate from `GITHUB_TOKEN` PAT) | GitHub sign-in/connector |
| GitLab | Token-only, no OAuth redirect | `GITLAB_TOKEN`/`GITLAB_HOST` | GitLab connector |
| Apple | Key/cert scheme, not client-id/secret | `APPLE_TEAM_ID`/`CLIENT_ID`/`KEY_ID`/`PRIVATE_KEY` | Apple sign-in |

**Manual action for every provider actually used in production:** register the app in that provider's developer console with the exact `{BASE_URL}/{provider}/oauth/callback` (or explicit `*_REDIRECT_URI`) value, using the real production `BASE_URL`, before first login attempt via that provider. Facebook/Instagram additionally requires Meta App Review — an external approval process with unpredictable timeline, not something this mission or any code change can accelerate.

---

## 8. Webhook Matrix

| Route | Purpose | Signature verification | Notes |
|---|---|---|---|
| `POST /business/webhook/payment` (Razorpay) | Payment confirmation | Yes, via `RAZORPAY_WEBHOOK_SECRET` — hard-rejects unsigned in production, warns-and-accepts in non-production | Nginx exempts `/webhook` paths from rate limiting (`location ~ ^/(webhook|whatsapp/webhook)`, comment: "Razorpay + Meta require direct access") |
| WhatsApp webhook (`whatsapp/webhook`) | Inbound WhatsApp messages | Yes, via `WA_VERIFY_TOKEN` | **Template default is a non-random placeholder — must be changed before enabling** (§5.5) |
| Stripe webhook | Payment confirmation | Owned by concurrent ERA-2 session (`webhookController.js`, `rawBody.js`, `payment.js`, `paymentService.js`, `stripeService.js`) | **Not inspected further per standing instruction — noted as IN PROGRESS (concurrent session)** |
| Discord webhook (`DISCORD_WEBHOOK_URL`) | Outbound only (alerts) | N/A — outbound | Not an inbound attack surface |
| Slack webhook (`SLACK_WEBHOOK_URL`) | Outbound only | N/A | Not an inbound attack surface |
| Zapier/Make/n8n webhook URLs | Outbound only (this app calls out to them) | N/A | Not an inbound attack surface |

**Manual action:** register the Razorpay webhook URL (`https://yourdomain.com/business/webhook/payment`) and the WhatsApp webhook URL in their respective provider dashboards, using the real production `BASE_URL`, only after `RAZORPAY_WEBHOOK_SECRET`/`WA_VERIFY_TOKEN` are set to real random values.

---

## 9. Nginx Configuration

Two real, already-written configs exist — **neither was installed or activated by this mission.**

### 9.1 `deploy/nginx-jarvis.conf` (single-domain, 183 lines)
- Upstream: `127.0.0.1:5050` — matches `backend/server.js`'s confirmed default listen port and `ecosystem.config.cjs`'s `PORT: 5050`.
- `server_name yourdomain.com www.yourdomain.com` — literal placeholder, substituted in place by `deploy/https-setup.sh` (`sed -i "s/yourdomain\.com/$DOMAIN/g"`).
- Static frontend root: `/opt/jarvis-os/frontend/build` (matches `setup-vps.sh`'s `APP_DIR=/opt/jarvis-os`).
- SSL cert paths are **commented out** placeholders, annotated "Certbot populates these automatically via https-setup.sh."
- `client_max_body_size 10m`; `proxy_connect_timeout 10s`/`proxy_send_timeout 60s`/`proxy_read_timeout 60s` server-block defaults, overridden to `3600s` read-timeout only inside the `/runtime/stream` SSE location (`proxy_buffering off`, `proxy_cache off`, `chunked_transfer_encoding on`, `proxy_set_header Connection "";`).
- Rate limiting: single zone `jarvis_limit` at 30r/s (burst 20 general API, burst 5 `/auth`, burst 60 SPA `/`); `/webhook` and `/whatsapp/webhook` explicitly exempted.
- Full security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS, Permissions-Policy) set via `add_header ... always`.
- One discrepancy found: `/health` is included in the big regex path-alternation list at line 166, matching the general API/health-check catch-all correctly for this single-domain config.

### 9.2 `deploy/nginx-multisite.conf` (3-vhost, 314 lines)
- Same upstream (`127.0.0.1:5050`), same SSE tuning for `/runtime/stream`.
- Vhosts: `ooplix.com`/`www.ooplix.com` (marketing + `/health` in its regex list), `app.ooplix.com` (SPA frontend — **`/health` is absent from this vhost's own regex alternation**, only reachable via the SPA catch-all `location /` fallback, not a dedicated proxy match — flagged as a minor inconsistency to be aware of when health-checking this specific vhost), `api.ooplix.com` (API-only, no static root, `proxy_read_timeout 3600s` set at the server-block level).
- **SSL certificate paths are NOT commented out** in this file — they point live at `/etc/letsencrypt/live/ooplix.com/...` for all three vhosts, i.e. this config assumes a certificate already exists (obtained via `certbot --nginx -d ooplix.com -d www.ooplix.com -d app.ooplix.com -d api.ooplix.com`) before this config can pass `nginx -t`.
- Three separate rate-limit zones (`jarvis_api` 30r/s, `jarvis_auth` 5r/s, `jarvis_public` 60r/s) instead of one shared zone.
- Cookie forwarding (`proxy_set_header Cookie $http_cookie`) explicitly present on auth-gated/stream locations, since these vhosts rely on httpOnly cookie auth across the split domains.

### 9.3 Which config to use — DECISION REQUIRED
`nginx-jarvis.conf` is the generic, placeholder-driven config `setup-vps.sh` installs by default. `nginx-multisite.conf` is already hardcoded to the real `ooplix.com` domain family and assumes certs already exist — it looks like it was prepared for an already-decided specific production topology but is **not** the one `setup-vps.sh` installs automatically. **Manual decision needed: is this VPS deployment single-domain (default script path, generic domain) or the specific `ooplix.com` 3-vhost split (requires swapping which file `setup-vps.sh` copies, and obtaining a 4-SAN certificate up front)?** Neither config was installed or activated by this mission.

### 9.4 WebSocket / real-time
No `Upgrade`/`Connection: upgrade` header pair exists in either config — none is needed. The only real-time mechanism is SSE (`/runtime/stream`), already correctly tuned in both files. No action required here.

---

## 10. TLS Configuration

Handled by `deploy/https-setup.sh` (124 lines, not modified or run):

1. Resolves the VPS's own public IP (`curl https://api.ipify.org`, falls back to `hostname -I`).
2. Compares it against `dig +short $DOMAIN` — **aborts** (does not proceed) if DNS doesn't resolve to this server, specifically to avoid burning Let's Encrypt's rate limit on a doomed attempt.
3. Patches `/etc/nginx/sites-available/jarvis` in place (`sed -i "s/yourdomain\.com/$DOMAIN/g"`), `nginx -t`, reloads.
4. Installs `certbot python3-certbot-nginx` if absent.
5. Runs `certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "admin@${DOMAIN}" --redirect --keep-until-expiring` — **single-domain form** (`-d` used once). Note: this does not match the multi-SAN form (`-d ooplix.com -d www.ooplix.com -d app.ooplix.com -d api.ooplix.com`) that `nginx-multisite.conf`'s cert paths assume — if the multisite topology is chosen (§9.3), the certbot command must be run manually with all four `-d` flags, not via this script as-is.
6. Verifies `https://$DOMAIN/health` is reachable post-issuance.
7. Confirms/adds auto-renewal (`certbot.timer` if present, else a crontab line `0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'`).
8. Updates `.env`'s `BASE_URL` in place to `https://$DOMAIN` if not already matching.

**Manual action:** `sudo bash deploy/https-setup.sh yourdomain.com` — only after DNS is live and Nginx (HTTP-only) is already running from `setup-vps.sh`. **Not executed by this mission.**

---

## 11. PM2 Process Matrix

From `ecosystem.config.cjs` (156 lines, read in full — not modified). **No duplicate process architecture is proposed; the existing two-app config is reused exactly as written.**

| Field | `jarvis-os` (API) | `ooplix-backup` (scheduled job) |
|---|---|---|
| script | `backend/server.js` | `scripts/safe-backup.cjs` |
| cwd | `__dirname` (repo root) | `__dirname` |
| exec_mode | `fork` (explicitly not `cluster` — in-process singletons `taskQueue`/`learningSystem`/`contextEngine` are not cluster-safe; never set `instances > 1`) | n/a |
| instances | 1 | n/a |
| trigger | always-on | `cron_restart: "0 2 * * *"` (daily 02:00 server time) |
| env (dev) | `NODE_ENV: "development"`, `PORT: 5050` | `NODE_ENV: "production"` only |
| env_production | `NODE_ENV: "production"`, `PORT: 5050` | `NODE_ENV: "production"` only |
| autorestart | `true`, `max_restarts: 5`, `min_uptime: "15s"`, `restart_delay: 5000` | `false` |
| memory | `max_memory_restart: "1536M"`, `node_args: "--max-old-space-size=1024"` (real, current — see §0 for the stale-checklist discrepancy this corrects) | not set |
| kill_timeout / listen_timeout | `8000` / `30000`, `wait_ready: true` (server.js calls `process.send("ready")` post-`app.listen()`) | not set |
| logs | `logs/pm2-out.log`, `logs/pm2-err.log`, merged, `max_size: "10M"`, `retain: 5` | `logs/backup-out.log`, `logs/backup-err.log` |
| watch | `false`, ignores `node_modules`/`logs`/`data`/`_archive` | `false` |
| port | 5050 (both `env` and `env_production`) | n/a (not a server) |

**Gap noted (not a blocker, a real operational gap worth surfacing):** `max_size`/`retain` are `pm2-logrotate` module config keys, not core PM2 fields — **no `pm2-logrotate` module is installed**, so PM2 logs do not actually auto-rotate today. The file's own comment documents a real measured 45.7 MB unrotated log. **Manual action, recommended but not code-blocking:** `pm2 install pm2-logrotate` on the VPS after first boot.

**Reload caveat (repeated from `CLAUDE.md` §7 for completeness):** `pm2 reload jarvis-os` is **not zero-downtime** in this fork-mode, single-instance config — a real measured ~5.6s outage / 56-of-200 failed health probes during a reload was documented. Both `deploy/update.sh` and any manual reload must account for this brief window.

**No Electron process belongs on the VPS.** Electron is a separate desktop distribution channel (`electron-builder` output), not a server process — confirmed nothing in `ecosystem.config.cjs` or any deploy script starts Electron on the server.

**Manual action:** `pm2 start ecosystem.config.cjs --env production && pm2 save && pm2 startup systemd -u jarvis --hp /home/jarvis` (the last part is already run once by `setup-vps.sh`).

---

## 12. Database Setup

- Connection: none — `better-sqlite3` opens `data/jarvis.db` directly as a local file; no connection string, no network DB.
- Migration command: **none exists as a formal system.** The database is self-healing on first boot (`backend/` DB-init code creates the `tasks` and `migration_log` tables if absent). **Do NOT execute production migrations — none exist to execute; first boot handles schema creation itself.**
- Startup behavior: confirmed self-healing, not migration-gated — first boot with a missing `data/jarvis.db` creates it fresh.
- Required extensions: none (SQLite, no server-side extensions).
- Pool settings: not applicable (single-file embedded DB, single process).
- Health check: no dedicated DB health probe distinct from the general `/health` endpoint; `/health`'s own JSON response was not independently re-verified this pass to confirm it explicitly pings the DB (already covered in Mission 78's audit — not re-litigated here).
- **Most persistence is actually flat JSON under `data/` (600+ files), not SQL** — do not assume a schema migration is needed for JSON-store changes; there is none.

**Manual action:** ensure the `data/` directory exists with correct ownership (`jarvis:jarvis`) and write permissions before first boot — `setup-vps.sh` already does `mkdir -p logs data backups` and `chown -R jarvis:jarvis`. No separate DB provisioning step exists or is needed.

---

## 13. Storage Setup

- Priority order confirmed in `storageService.cjs`: Cloudflare R2 (`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`R2_ACCOUNT_ID`/`R2_ENDPOINT`) checked first, then AWS S3 (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`S3_BUCKET`/`S3_ENDPOINT`/`AWS_REGION`) as fallback. If neither is configured, `storageService.configured` is `false` and storage-dependent features (exports, uploads, generated assets) degrade gracefully — no crash.
- Local filesystem fallback locations already used by the app: `data/exports/`, likely others under `data/` for uploads/generated assets — not independently re-enumerated exhaustively this pass beyond what Mission 78 already covered for `exportFiles.js`/`exportFileService.cjs`.
- Backup archive location: `backups/` (created by `setup-vps.sh`'s `mkdir -p logs data backups`).
- **No cloud storage bucket, credentials, or directories were created by this mission.** If R2/S3 is the intended production storage tier, the bucket and IAM credentials must be created out-of-band in the respective provider console — this is a credential/infrastructure item, not a code task (see §21/§22).
- Required local directories (`logs/`, `data/`, `backups/`) and permissions (`jarvis:jarvis` ownership) are already handled idempotently by `setup-vps.sh`.

---

## 14. Backup/DR Setup

Reusing Mission 77's certified findings, not re-auditing the code:

- **Schedule:** PM2 `cron_restart: "0 2 * * *"` on the `ooplix-backup` app, running `scripts/safe-backup.cjs` directly (confirmed in `ecosystem.config.cjs`, §11 above).
- **Separate npm-level backup entrypoint:** `npm run backup` → `bash backup.sh` — **this is a different script from the PM2 cron job**, which calls `scripts/safe-backup.cjs` directly, not `backup.sh`. `deploy/update.sh` itself calls `npm run backup` (i.e. `backup.sh`) before pulling updates. **Two distinct backup entrypoints exist in this repo — both real, serving different triggers (scheduled cron vs. pre-update snapshot).** Not a defect; a fact operators must know to avoid assuming one script covers both cases.
- **Manifest/integrity:** `safe-backup.cjs` generates a manifest with SHA-256 hashes; `verifyManifest()` (Mission 77 fix) validates it; `BUSINESS_OS_FILES` coverage extended in the same mission.
- **Offsite export:** `scripts/export-offsite.cjs`, driven by `BACKUP_OFFSITE_DIR`/`BACKUP_DEST` — if unset, backups remain local-only (no crash, but a real DR gap worth flagging to the operator).
- **Encryption:** `BACKUP_PASSWORD` — if blank, local backup archives are **unencrypted**. Optional in code, but a real operational risk if backups will ever be stored anywhere off the VPS's own encrypted disk (if it even has one).
- **Restore:** `deploy/rollback.sh` (217 lines, already deeply audited/fixed in Mission 77 — not re-modified or re-inspected here) and drilled via `scripts/test-restore.cjs`/`scripts/test-portable-restore.cjs`.
- **RPO/RTO:** No authoritative source in this repository defines numeric RPO/RTO targets. **Per explicit mission instruction, these remain `DECISION REQUIRED` — not fabricated.**

**Manual action:** set `BACKUP_PASSWORD` (strong, unique) and `BACKUP_OFFSITE_DIR`/`BACKUP_DEST` (a real off-VPS destination) before relying on this backup pipeline for actual DR coverage. **No real backup was run against production data by this mission.**

---

## 15. Monitoring Setup

Reusing Mission 76's Monitoring-category findings:

- **Sentry:** `SENTRY_DSN` (runtime error capture, hand-rolled HTTP Envelope client in `sentryService.cjs`, no official SDK dependency) + `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_RELEASE` (release/sourcemap upload only, not runtime capture). A `_redact()` function (Mission 76/78 fix) strips sensitive fields from `tags`/`extra`/`user` before every capture — already fixed, not part of this mission's scope to re-touch.
- **Health/readiness:** `GET /health` (`backend/routes/ops.js`, no auth, used by Nginx implicitly, `healthcheck.sh`, and `validate-production.sh`); `GET /stats`; `GET /runtime/status` (auth-required).
- **Observability routes:** `/p21/obs` — Mission 78 fix added `requireAuth`+`operatorOnly` gating (already applied, not re-touched).
- **Cron-based auto-recovery:** `deploy/healthcheck.sh` (30 lines, read in full) — intended for `*/5 * * * * /opt/jarvis-os/deploy/healthcheck.sh >> logs/healthcheck.log 2>&1`; on failure, attempts `pm2 restart jarvis-os` (or `pm2 start ecosystem.config.cjs --env production` as fallback), re-checks after 5s, logs RECOVERED/FAILED.
- **Datadog/UptimeRobot:** optional, provider-specific credentials only (`DATADOG_API_KEY`/`APP_KEY`/`SITE`, `UPTIMEROBOT_API_KEY`) — not provisioned by this mission, external SaaS signup required if desired.
- **Telegram operator alerts:** `TELEGRAM_OPERATOR_CHAT_ID` + `TELEGRAM_TOKEN` — used for crash alerts / EOD summaries via `operationsAlertingLayer.cjs`; optional.

**Manual action:** add `deploy/healthcheck.sh` to the VPS crontab; optionally set `SENTRY_DSN` and/or `TELEGRAM_OPERATOR_CHAT_ID`+`TELEGRAM_TOKEN` for active alerting. Nothing was provisioned by this mission.

---

## 16. Security Baseline (checklist only — nothing executed)

- [ ] SSH key-based auth only; disable password SSH if the VPS provider allows post-provisioning hardening.
- [ ] Firewall: `ufw` — `setup-vps.sh` already scripts `ufw --force reset; deny incoming; allow outgoing; allow 22/tcp, 80/tcp, 443/tcp` — **port 5050 (the app's own port) is deliberately never opened externally**, only reachable via Nginx's reverse proxy on 127.0.0.1. Confirmed correct-by-design.
- [ ] App process runs under a dedicated non-root `jarvis` user (`setup-vps.sh` creates this user and `chown -R jarvis:jarvis`).
- [ ] `.env` file permissions restricted (`validate-production.sh`'s own Security section checks for `600`).
- [ ] HTTPS enforced, HSTS header present (already set unconditionally in both Nginx configs).
- [ ] Least-privilege DB/storage credentials (R2/S3 IAM scoped to the one bucket, not account-wide) — this is a provider-console configuration step, not code.
- [ ] Automatic OS security updates (`unattended-upgrades`) — not currently scripted by `setup-vps.sh`; **recommended manual addition**, not a blocker.
- [ ] Backup directory permissions restricted to the `jarvis` user.
- [ ] Rotate `JWT_SECRET`/`OPERATOR_PASSWORD_HASH` only via the documented process (never blindly — `JWT_SECRET` rotation orphans the credential vault, §5.2).

**None of the above was executed, installed, or configured by this mission** — it is a checklist for the operator to work through during actual deployment.

---

## 17. Exact Deployment Order (Phases A–O)

Adjusted from the mission's generic 15-phase template to match this repository's actual tooling exactly. **Documentation only — none of these phases were executed.**

- **Phase A — VPS base provisioning.** Operator provisions a fresh Ubuntu 22.04/24.04 VPS out-of-band (cloud console). Not scriptable from this repo.
- **Phase B — System packages + runtime + PM2 + firewall + Nginx (unconfigured) + repo clone + dependency install + `.env` template copy.** All handled by one command: `sudo bash deploy/setup-vps.sh`.
- **Phase C — Environment configuration.** Operator manually edits `/opt/jarvis-os/.env`, filling in every variable from §5's REQUIRED and chosen-provider-specific rows. **Never done by this mission; never should be done by an agent — credential entry is exclusively a human action per `CLAUDE.md` §20.**
- **Phase D — Domain/Nginx-topology decision.** Operator decides single-domain vs. multisite topology (§9.3) before proceeding — affects which Nginx config file is active and what certbot `-d` flags to use.
- **Phase E — Frontend build.** `npm run build:frontend` (with `REACT_APP_API_URL` set only if using the split-API-domain topology).
- **Phase F — Database/first-boot self-heal.** No separate step — handled automatically on first `pm2 start`.
- **Phase G — Storage bucket provisioning (if R2/S3 used).** Out-of-band, in the provider's console — not scriptable from this repo.
- **Phase H — PM2 process start.** `sudo -u jarvis bash deploy/start-production.sh` — this single script validates required env vars, optionally rebuilds the frontend, clears stale crash markers, and starts both PM2 apps (`jarvis-os` + `ooplix-backup`), then polls `/health` for up to 40s.
- **Phase I — Nginx activation with real domain.** Domain substitution already happened inside `setup-vps.sh`'s copy of the chosen config (placeholder `yourdomain.com`); `nginx -t && systemctl reload nginx` (already run once by `setup-vps.sh` itself with the placeholder in place — must be re-verified after `https-setup.sh` patches the real domain in).
- **Phase J — TLS issuance.** `sudo bash deploy/https-setup.sh yourdomain.com` (or, if multisite, a manual multi-`-d` certbot invocation per §10's caveat).
- **Phase K — DNS verification.** Confirm `dig yourdomain.com` resolves to the VPS IP (the `https-setup.sh` script itself performs this check and aborts on mismatch — not a separate manual step beyond ensuring DNS was set in Phase A/D's timeframe).
- **Phase L — Health/readiness verification.** `curl https://yourdomain.com/health`, then `bash deploy/validate-production.sh` (30+ automated checks across environment/PM2/health/routes/Nginx/SSL/data-dirs/backups/monitoring/security).
- **Phase M — Backup/cron wiring.** Add `deploy/healthcheck.sh` to crontab (every 5 min); confirm the `ooplix-backup` PM2 app shows in `pm2 jlist` with its `cron_restart` intact.
- **Phase N — Monitoring wiring.** Optionally set `SENTRY_DSN`, `TELEGRAM_OPERATOR_CHAT_ID`/`TELEGRAM_TOKEN`, Datadog/UptimeRobot credentials.
- **Phase O — Production smoke test.** See §19 — read-only/safe checks only, no real side effects.

---

## 18. First-Boot Verification (safe, read-only — commands only, not run by this mission)

```bash
curl -sf http://localhost:5050/health                 # backend health, no auth
curl -sf https://yourdomain.com/health                 # through Nginx + TLS
curl -i https://yourdomain.com/                         # frontend loads (expect 200, HTML)
curl -i https://yourdomain.com/auth/me                  # expect 401 (unauthenticated, proves route + auth gate alive)
pm2 jlist | python3 -m json.tool | grep -A3 '"name": "jarvis-os"'   # PM2 process status
pm2 jlist | python3 -m json.tool | grep -A3 '"name": "ooplix-backup"'
bash deploy/validate-production.sh                       # full 30+ check suite
```
Do **not** attempt a real login, real payment, real email send, real social post, or real WhatsApp/Telegram message as part of first-boot verification — those are explicitly out of scope (mission Step 16).

---

## 19. Production Smoke Test (safe subset only)

Per the mission's explicit boundary, only these are safe/appropriate immediately after first boot:

- `GET /health` → 200.
- `GET /auth/me` (unauthenticated) → 401 (proves the route and auth gate are both alive, without needing real credentials).
- Frontend root loads in a browser (visual check only).
- `GET /runtime/stream` opens and stays connected briefly (proves SSE path through Nginx works) — auth-gated, requires a real session cookie, so this step is deferred until an operator actually logs in with real credentials post-deployment; not part of the anonymous smoke test.
- Confirm PM2 shows both apps `online`/cron-scheduled via `pm2 jlist`.
- Confirm `data/jarvis.db` was created (self-heal proof) via `ls -la data/jarvis.db` on the VPS.
- Confirm `storageService.configured` reflects the intended state (check via an authenticated `/stats`-type endpoint if one surfaces it — not independently re-verified this pass which endpoint exposes this flag).

**Explicitly excluded from any smoke test:** real login with production operator credentials as a first action (defer until the operator is ready to actually use the system), any real payment/charge/refund, any real email send, any real social media post, any real WhatsApp/Telegram message, any write to a real external provider.

---

## 20. Rollback Procedure

- **Application/code rollback:** `bash deploy/rollback.sh` (217 lines, already deeply audited and fixed in Mission 77 — not re-modified here). Restores from the most recent verified backup manifest.
- **PM2 rollback:** `pm2 stop jarvis-os && git checkout <previous-known-good-commit> && npm install --omit=dev --ignore-scripts && pm2 restart jarvis-os` — standard git-based rollback, no special tooling beyond what's already in `update.sh`'s own pattern (it itself falls back through `pm2 reload` → `pm2 restart` → kill-stale-process-and-fresh-`pm2 start` if reload/restart both fail).
- **Nginx rollback:** re-copy the previous `/etc/nginx/sites-available/jarvis` from a manual backup taken before any config edit (not automated by any script — operator discipline required: **manual action, take a copy of the active Nginx config before every `https-setup.sh`/topology-swap run**).
- **Environment rollback:** restore `.env` from its own separately-held backup (never committed to git; operator must maintain their own secure copy).
- **Database rollback:** **No formal migration system exists, therefore no database migration rollback command exists to run.** Per the mission's explicit instruction ("Never invent a database rollback command. If unsupported: DOCUMENT IT"), this is documented as unsupported — the only DB-level recovery path is restoring `data/jarvis.db` (and the flat-JSON `data/` files) from a `safe-backup.cjs`/`export-offsite.cjs` archive via `deploy/rollback.sh`, which is a full data-directory restore, not a targeted schema/migration rollback.
- **Backup restore boundary:** restoring from backup is destructive to whatever current-state data exists on the VPS since the backup was taken — this must only be done deliberately, never as a routine step, and never against live production data by this mission (it was not).

**Rollback entry point:** `bash deploy/rollback.sh`.

---

## 21. Manual Action Register

| # | ACTION | WHO | INPUT REQUIRED | WHERE | RISK | BLOCKS DEPLOYMENT? | VERIFICATION |
|---|---|---|---|---|---|---|---|
| 1 | Provision a VPS | Operator | Cloud provider account | Cloud console | Low | Yes | `ssh` reachable |
| 2 | Decide domain/Nginx topology | Operator | Product decision | N/A | Low | Yes | §9.3 resolved |
| 3 | Point DNS A record(s) at VPS IP | Operator | Domain registrar access | DNS provider | Low | Yes | `dig` resolves correctly |
| 4 | Run `deploy/setup-vps.sh` | Operator | Root SSH | VPS | Medium (system-level changes) | Yes | Node/PM2/Nginx installed, `jarvis` user exists |
| 5 | Fill in `.env` — `JWT_SECRET` | Operator | Generate a real high-entropy secret | VPS `.env` | High (auth + vault key) | Yes | `start-production.sh` no longer `die`s |
| 6 | Fill in `.env` — `OPERATOR_PASSWORD_HASH` | Operator | `node scripts/generate-password-hash.cjs` | VPS `.env` | High (sole login credential) | Yes | Same |
| 7 | Fill in `.env` — `BASE_URL` | Operator | Real HTTPS domain | VPS `.env` | Medium | Yes | Same |
| 8 | Obtain + set `GROQ_API_KEY` (or accept AI degraded) | Operator | Groq account | VPS `.env` | Low | No (soft) | Startup log shows `ai` capability enabled |
| 9 | Obtain + register OAuth apps for each social/sign-in provider actually used | Operator | Each provider's developer console | Provider consoles + `.env` | Medium (external approval for Meta) | Only for providers actually used | Login/posting flow succeeds |
| 10 | Obtain Razorpay/Stripe live credentials | Operator | Payment provider dashboard | `.env` | High (real money) | Only if payments enabled at launch | Test-mode charge succeeds (deferred, not run by this mission) |
| 11 | Set `RAZORPAY_WEBHOOK_SECRET` to a real value, register webhook URL | Operator | Razorpay dashboard | `.env` + dashboard | High | Only if Razorpay enabled | Webhook signature check passes |
| 12 | Regenerate `WA_VERIFY_TOKEN` away from the template default | Operator | Random value | `.env` | High (spoofing risk if left default) | Only if WhatsApp webhook exposed | Value ≠ `change_this_to_a_random_secret` |
| 13 | Choose + configure an email provider (Resend/SendGrid/Mailgun/Postmark/Brevo/SMTP/SES) | Operator | Provider account | `.env` | Low | No (soft, but real user-facing feature) | Real test email delivered (deferred) |
| 14 | Provision R2 or S3 bucket + IAM credentials (if cloud storage desired) | Operator | Cloud console | `.env` | Medium | No (soft — local disk fallback works) | `storageService.configured===true` |
| 15 | Set `BACKUP_PASSWORD` + `BACKUP_OFFSITE_DIR`/`BACKUP_DEST` | Operator | Choose a strong password + real off-VPS path | VPS `.env` | High (DR integrity) | No (soft — local unencrypted backup still runs) | Manifest verifies, offsite copy lands |
| 16 | Run `deploy/https-setup.sh` | Operator | Root SSH, DNS already live | VPS | Medium | Yes | `https://` reachable, valid cert |
| 17 | Add `deploy/healthcheck.sh` to crontab | Operator | Root/`jarvis` crontab access | VPS | Low | No | Cron log shows periodic OK entries |
| 18 | (Optional) Install `pm2-logrotate` | Operator | `pm2 install pm2-logrotate` | VPS | Low | No | Log files rotate instead of growing unbounded |
| 19 | (Optional) Set `SENTRY_DSN`, Telegram alert vars, Datadog/UptimeRobot creds | Operator | Each provider account | `.env` | Low | No | Test error appears in Sentry (deferred) |
| 20 | Take a manual backup copy of any live Nginx config before every future topology/cert change | Operator | Ongoing discipline | VPS | Low | No | Rollback path exists |

**Never expose any secret value in any of the above verification steps or in any report.**

---

## 22. Credential Register (presence-only — no values ever inspected or printed)

Required: `JWT_SECRET`, `OPERATOR_PASSWORD_HASH`.
Provider-specific, needed only if that integration is enabled at launch: `GROQ_API_KEY` (+ up to 13 other AI provider keys, all optional fallbacks), `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET`, Stripe credentials (owned by concurrent session), one email provider's key(s), `WA_TOKEN`/`WA_PHONE_ID`/`WA_VERIFY_TOKEN`, `TELEGRAM_TOKEN`, up to 13 social-platform OAuth client id/secret pairs, up to 5 consumer sign-in OAuth apps (Google/Microsoft/LinkedIn/Apple/Discord/Notion), `FIREBASE_PROJECT_ID`/`FIREBASE_SERVICE_ACCOUNT`, R2 or S3 storage keys, `SENTRY_DSN`/`SENTRY_AUTH_TOKEN`, `BACKUP_PASSWORD`, plus a long tail of fully-optional third-party connector credentials (GitHub/GitLab/Bitbucket, Hostinger/Cloudflare/Supabase, Dropbox/Notion/Shopify/WooCommerce/WordPress/Figma/Canva/Zapier/Make/n8n/Jira/Linear/Datadog/UptimeRobot/Twilio/Discord/Slack).

**Exact count of distinct credential-shaped variables requiring a real value if their corresponding feature is enabled at launch: 2 hard-required + ~85 provider-specific/optional** (full enumeration is in the working discovery notes; this register intentionally does not reproduce all ~85 individually here since none of them are launch-blocking — only the 2 hard-required ones are).

---

## 23. Infrastructure Requirements

1. One VPS (Ubuntu 22.04/24.04, sized to at least accommodate the 1536M PM2 memory ceiling plus OS overhead — recommend 2GB+ RAM minimum given the documented real OOM incident at ~740MB peak RSS under the old, smaller ceiling).
2. One domain (or domain family, if multisite topology chosen).
3. DNS provider access to create A records.
4. TLS via Let's Encrypt (free, via certbot — no separate certificate purchase needed).
5. (Optional) Cloudflare R2 or AWS S3 bucket, if cloud storage is desired over local disk.
6. (Optional) An off-VPS backup destination (another server, cloud storage, etc.) for `BACKUP_OFFSITE_DIR`.
7. (Optional, per feature) Each third-party provider account actually used at launch (Groq, Razorpay/Stripe, an email provider, social platforms, Sentry, etc.).

**Exact count: 4 hard-required infrastructure items (VPS, domain, DNS access, TLS via certbot) + 2 recommended-but-optional (offsite backup destination, cloud storage bucket) + N provider accounts matching whichever optional integrations are enabled at launch.**

---

## 24. Decision Required

1. **Nginx topology:** single-domain (`nginx-jarvis.conf`, generic placeholders) vs. the already-`ooplix.com`-hardcoded 3-vhost split (`nginx-multisite.conf`). Affects which config `setup-vps.sh` should be told to install and what certbot `-d` flags to use.
2. **RPO (Recovery Point Objective):** no authoritative numeric target exists anywhere in this repository. Not fabricated here — remains a business decision.
3. **RTO (Recovery Time Objective):** same — no authoritative numeric target exists. Remains a business decision.
4. **Which optional integrations are actually enabled at launch** (payments processor: Razorpay vs. Stripe vs. both; which email provider; which social platforms) — determines which of the ~85 provider-specific credentials in §22 actually need to be obtained before go-live versus deferred to a later date.
5. **Cloud storage vs. local disk** for the initial launch — R2/S3 provisioning can be deferred (local disk fallback works) but should be a conscious choice, not a default-by-omission.

---

## 25. Deployment Blockers

**P0 (hard blockers — deployment cannot proceed without these):**
- No VPS provisioned. **INFRASTRUCTURE REQUIRED.**
- No domain/DNS configured. **DNS REQUIRED.**
- `JWT_SECRET` not set to a real value. **CREDENTIAL REQUIRED.**
- `OPERATOR_PASSWORD_HASH` not set to a real value. **CREDENTIAL REQUIRED.**
- `BASE_URL` not set to a real, non-localhost, non-placeholder HTTPS domain. **MANUAL CONFIG REQUIRED.**
- Nginx topology not decided. **DECISION REQUIRED.**

**P1 (should be resolved before public launch, do not block a private/internal first boot):**
- No payment processor credentials configured (if payments are part of launch scope). **CREDENTIAL REQUIRED / PROVIDER APPROVAL REQUIRED** (Meta App Review specifically, if Facebook/Instagram posting is in scope).
- `WA_VERIFY_TOKEN` left at its insecure template default, if the WhatsApp webhook will be exposed. **MANUAL CONFIG REQUIRED.**
- No email provider configured (transactional email, e.g. password reset, will silently degrade). **CREDENTIAL REQUIRED.**
- `BACKUP_PASSWORD`/`BACKUP_OFFSITE_DIR` unset (backups run but stay local and unencrypted). **MANUAL CONFIG REQUIRED.**

**P2 (recommended, non-blocking):**
- `pm2-logrotate` not installed (log growth unmanaged). **INFRASTRUCTURE REQUIRED (optional).**
- No cloud storage bucket provisioned (local disk fallback works fine at low/moderate scale). **INFRASTRUCTURE REQUIRED (optional).**
- No monitoring/alerting (Sentry/Telegram/Datadog) configured. **CREDENTIAL REQUIRED (optional).**
- No `unattended-upgrades` for OS security patches. **INFRASTRUCTURE REQUIRED (optional).**

**P3 (informational, not action items for this deployment):**
- `COOKIE_DOMAIN`/`DISABLE_X_POWERED_BY`/`ENABLE_CSP` are audit-checklist-only toggles with no effect on real runtime behavior — no action needed, documented for accuracy only (§5.4).
- `DEPLOY_CHECKLIST.md`'s PM2 memory values are stale relative to the real `ecosystem.config.cjs` — this report already uses the correct current values; the stale doc itself was not edited (out of scope, documentation-only mission, and editing docs wasn't part of the mission's fix authorization).

No manual task above has been mischaracterized as a code blocker — every P0/P1 item here requires either infrastructure provisioning, a real external account/credential, or a human product decision; none requires a code change.

---

## 26. Final VPS Deployment Checklist

- [ ] VPS provisioned, SSH access confirmed
- [ ] Domain purchased/available, Nginx topology decided (§24.1)
- [ ] DNS A record(s) created and propagated
- [ ] `sudo bash deploy/setup-vps.sh` run
- [ ] `.env` fully populated: `JWT_SECRET`, `OPERATOR_PASSWORD_HASH`, `BASE_URL` at minimum; provider-specific vars for every integration enabled at launch
- [ ] `npm run build:frontend` run (or handled automatically by `start-production.sh`)
- [ ] `sudo -u jarvis bash deploy/start-production.sh` run successfully (health check passes within 40s)
- [ ] `sudo bash deploy/https-setup.sh yourdomain.com` run successfully
- [ ] `bash deploy/validate-production.sh` passes (or documented warnings accepted)
- [ ] `deploy/healthcheck.sh` added to crontab
- [ ] First-boot verification (§18) performed
- [ ] Safe production smoke test (§19) performed
- [ ] Rollback entry point (`deploy/rollback.sh`) confirmed present and understood by whoever operates this VPS
- [ ] All P0 blockers (§25) resolved
- [ ] P1 items reviewed and consciously accepted or resolved before public launch

**FINAL STATUS: READY WITH MANUAL CONFIGURATION**

The codebase and its deployment tooling are complete and internally consistent — no code defect blocks deployment. Every remaining item is infrastructure provisioning, credential acquisition, or a product/business decision that only a human operator can make.

---

## Final Output

1. **Exact number of manual actions:** 20 (§21).
2. **Exact number of credential requirements:** 2 hard-required (`JWT_SECRET`, `OPERATOR_PASSWORD_HASH`) + ~85 provider-specific/optional (§22).
3. **Exact number of infrastructure requirements:** 4 hard-required (VPS, domain, DNS access, TLS-via-certbot) + 2 recommended-optional (§23).
4. **Exact number of decisions required:** 5 (§24).
5. **Exact deployment order:** Phases A→O (§17): VPS provisioning → `setup-vps.sh` → `.env` configuration → topology decision → frontend build → first-boot self-heal (automatic) → storage provisioning (if used) → `start-production.sh` → Nginx activation → `https-setup.sh` → DNS verification → health/readiness verification → backup/cron wiring → monitoring wiring → production smoke test.
6. **Exact first verification commands:**
   ```bash
   curl -sf http://localhost:5050/health
   curl -sf https://yourdomain.com/health
   bash deploy/validate-production.sh
   ```
7. **Exact rollback entry point:** `bash deploy/rollback.sh` (database-level migration rollback does not exist and is not invented — documented as unsupported per §20; the only DB/data recovery path is a full `data/` directory restore from a `safe-backup.cjs`/`export-offsite.cjs` archive via this same script).

**This mission did not deploy anything. STOP.**
