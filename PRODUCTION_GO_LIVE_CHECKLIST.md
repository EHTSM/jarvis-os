# Production Go-Live Checklist — Master Document

Synthesized from every audit and launch document in this repository, cross-referenced and deduplicated. Where sources conflicted, the most recent and most rigorously verified finding wins. Items already resolved by later work are marked **[RESOLVED]** and kept in the list as a re-verification gate, not deleted — a launch checklist should prove a fix still holds, not assume it.

This is a planning document only. No code changes are proposed or implied here.

**Current baseline (updated 2026-08-04, Production Completion Week session)**: Production Readiness 94% — Frontend/Backend/Electron/Autonomous Runtime all certified via 5 independent parallel audits with file:line evidence this session (see `docs/audits/PRODUCTION-COMPLETION-WEEK.md`, `docs/audits/CONTINUOUS-AUTONOMOUS-OPERATIONS-CERTIFICATION.md`, `docs/audits/AUTONOMOUS-VERIFICATION-REGRESSION-CERTIFICATION.md`). 2 real code defects found and fixed this session (RuntimeObserverPanel unreachable in web nav; GrowthOS fabricated campaign delivery stats across email/SMS/WhatsApp/OTP) — both committed, regression-tested, live-verified. **This raises the 74/100 baseline below** — several items in this document that were accurate when written are now stale; items directly re-verified this session are marked **[RE-VERIFIED 2026-08-04]** with fresh evidence. Items not touched this session retain their original status and should not be assumed current without re-checking.

## Zero-code-work-remaining: the 5 real blockers

Per this session's audit, **no further engineering/code work is required to reach production readiness**. Every remaining item is one of exactly 5 categories — none fixable by writing more code, all requiring a real-world action outside this repository:

| # | Blocker | What's actually needed | Where it plugs in | Time to resolve once you act |
|---|---|---|---|---|
| 1 | **Live credentials** | Real API keys/secrets for the ~15 MISSING_CREDENTIALS providers in §2/§5/§6/§7 below (AI providers beyond Groq/OpenAI, Stripe, AWS/Supabase, Resend, etc.) | `.env` on the production server | Minutes each, once accounts exist |
| 2 | **Live integrations** | OAuth apps actually registered with Google/GitHub, WhatsApp/Razorpay accounts moved from sandbox to live mode, Firebase project created | Provider consoles, then `.env` | Hours to days (some involve provider review/KYC) |
| 3 | **Code signing certificates** | A real Apple Developer Program cert (`MACOS_CERT_P12`/`MACOS_CERT_PASSWORD`/`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`) and a real Windows code-signing cert (`WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`) as GitHub repo secrets. **Note**: this session found the CI signing config itself is correct, but a separate, real packaging blocker (§10, B17 — `node-pty` rebuild hang, root-caused this session to `@electron/rebuild`'s wrapper) currently prevents ANY installer from being produced at all, mac or Windows — certs won't matter until that's fixed first. | `.github/workflows/release.yml` (already reads these exact env var names) | 1-2 days procurement + $99/yr (Apple), AFTER B17 is resolved |
| 4 | **Production deployment** | A real VPS provisioned, DNS pointed at it, SSL obtained, nginx configured, PM2 running the real app — none of this exists yet outside a dev machine | §1/§8/§9 below | Half a day, mostly waiting on DNS propagation + Let's Encrypt |
| 5 | **Real user telemetry** | Actual traffic from actual users — GA4/GTM/Clarity IDs need to be real (not placeholders) and something has to actually visit the live site to produce data | `frontend/public/index.html`, then simply launching | Zero engineering time; happens automatically post-launch |

None of these can be closed by more repository auditing or code changes — they are credential-provisioning, procurement, and go-live-sequencing tasks. The detailed section-by-section checklist below maps every specific item under each of these 5 categories with exact commands/verification steps.

---

## How to read this table

- **Priority**: P0 = blocks launch entirely. P1 = blocks a specific feature/channel, not overall launch. P2 = nice-to-have, safe to ship without and fix post-launch.
- **Risk**: what concretely breaks if this item is skipped or done wrong.
- **Verification Method**: the real command, script, or process already documented elsewhere in this repo — not invented for this checklist.
- **Dependency**: what must be true first.

---

## 1. Infrastructure

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| Provision VPS (min 2 vCPU / 2GB RAM, Ubuntu 22.04) | P0 | 15 min | No server exists to deploy to — nothing downstream can proceed | Manual VPS provider console check | None |
| Open firewall ports 80, 443, 22 | P0 | 5 min | App unreachable from internet, or ops locked out of SSH | `sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 22/tcp` then `sudo ufw status` | VPS provisioned |
| Harden SSH: key-only auth, root login disabled, Fail2Ban active | P0 | 1-2 hrs | Password/root SSH is the primary compromise vector for the whole server, including secrets and backups stored on it | Manual `sshd_config` review; `fail2ban-client status sshd` | VPS provisioned |
| Clone/pull repository onto VPS | P0 | 10 min | No code present to run | Manual `git clone`/`git pull` check | VPS provisioned, SSH hardened |
| Install production dependencies (`npm install --production`) | P0 | 10 min | Server fails to boot on missing modules | `npm run env:check` | Repository cloned |
| Build frontend (`cd frontend && npm run build`) | P0 | 5-10 min | Express has no static assets to serve; app boots to a blank page | `frontend/build/index.html` exists | Dependencies installed |
| Create and verify `logs/` and `data/` directories are writable | P0 | 5 min | PM2 log redirection and all JSON-file persistence fail silently at first write | Manual directory + permissions check | Repository cloned |
| Run core import/wiring sanity check | P0 | 2 min | Broken `require()` paths crash the server at boot, discovered too late | `node -e "require('./agents/runtime/runtimeOrchestrator.cjs')"` | Dependencies installed |
| Start app under PM2 with production env | P0 | 10 min | No crash resilience, no auto-restart | `pm2 start ecosystem.config.cjs --env production` → `pm2 status` shows "online" | Frontend built, env vars set (§2) |
| Confirm PM2 config: fork mode (not cluster), memory ceiling, kill/listen timeouts | P0 | 5 min | Cluster mode is unsafe for this app's design; missing `max_memory_restart` risks an OOM crash loop; missing `kill_timeout` drops in-flight requests on deploy | Inspect `ecosystem.config.cjs`: `exec_mode:"fork"`, `max_memory_restart:"512M"`, `kill_timeout:8000` | PM2 started |
| `pm2 startup` + `pm2 save` | P0 | 5 min | A VPS reboot leaves the app down with no auto-recovery | `pm2 startup` (run generated command as root), then `pm2 save` | PM2 started |
| Confirm zero PM2 restarts / zero error lines in first 30s | P0 | 5 min | Silent boot failure goes unnoticed until a user reports it | `pm2 logs jarvis-os` — no ERROR lines | PM2 started |
| Local health check on app port before exposing via nginx | P0 | 2 min | Confirms the process is actually serving before it's made public | `curl http://localhost:5050/health` → HTTP 200 | PM2 started |
| Install and configure nginx reverse proxy | P0 | 20 min | No TLS termination, no clean public routing | `nginx -v`; deploy repo's `nginx.conf` to `/etc/nginx/sites-available/` | VPS provisioned |
| Symlink nginx site config, remove default site, deploy `proxy_params` | P0 | 10 min | Default nginx page served instead of the app; missing forwarded headers break auth/IP logging behind the proxy | Verify symlink in `sites-enabled/`, default removed, `proxy_params` present | nginx installed |
| Validate and reload nginx config | P0 | 5 min | A bad config takes nginx down entirely | `sudo nginx -t` → "syntax is ok"; `sudo systemctl reload nginx` — **note: nginx was unavailable in the last verified dev environment, so this specific live check has never actually been run against real nginx; treat as unproven until executed on the real VPS** | nginx site config deployed |
| Confirm rate-limit zones active in nginx (defense in depth beyond app-level limiting) | P1 | 10 min | No protection against request floods at the proxy layer | Inspect `nginx.conf` for `limit_req_zone` entries | nginx config validated |
| Verify graceful shutdown handling (SIGTERM/SIGINT/SIGUSR2) | P1 | 10 min | In-flight requests dropped or DB left inconsistent on restart/deploy | Code review: `backend/server.js` `_gracefulShutdown()`, 5s drain window | None — verification only |
| Verify SQLite WAL mode + `closeDB()` on shutdown | P1 | 10 min | DB corruption risk on hard restarts | Code review: `backend/db/sqlite.cjs` — `PRAGMA journal_mode = WAL` | None — verification only |
| **[RESOLVED, re-verify]** `missionMemory.cjs`/`taskQueue.cjs` cross-process write safety | P1 | 15 min re-verify | Reproducible `ENOENT` crash when a live server and a second process (script/test) write the same file concurrently | Re-run the concurrent-write regression (8 real child processes racing `taskQueue.addTask()`) — fix already verified 0/8 crashes vs. 3/8 before | Fix already committed (`abc1bbb8`) |
| Fix 124MB `repo-index.json` synchronous read on a hot route | P1 | 2-4 hrs | Blocks the Node.js event loop ~900ms per call under load, causing latency spikes | Load test the affected route before/after | None |
| Add file-lock protection for CRM concurrent writes (`leads.json`) | P1 | 2-4 hrs | Two simultaneous writes can corrupt `leads.json` under concurrent load | Concurrent-write stress test | None |
| Move `plan-management.js` off its stub implementation | P1 | 4 hrs | Billing/plan-management routes silently no-op | Manual route test against plan-management endpoints | None |
| Verify Docker path (optional deployment method) | P2 | Unproven | Docker image build has never been proven with a real daemon run in the dev environment; PM2-direct deployment is the proven path | `docker build` + `docker run` against a real Docker daemon | A machine with Docker actually running |
| Rebuild `node-pty` native module correctly for packaged Electron | P1 | 2 hrs | Electron terminal features fail in the packaged app if the native module ABI mismatches | CI packaging step verification | Electron packaging pipeline (see §5, blocked on B17) |
| Remove `_archive/` from git tracking | P2 | 15 min | Bloats clone size, slows CI/deploy pulls | `git rm --cached -r _archive/`, confirm repo size drop | None |
| Add real GA4 / GTM / Microsoft Clarity IDs (replace placeholders) | P1 | 30 min | Placeholder tracking IDs mean zero conversion/funnel data from day one | Inspect `frontend/public/index.html` for real IDs; confirm events fire in devtools against live prod | App deployed |
| Deploy live Privacy Policy and Terms of Service pages | P0 | 15 min | Legal/compliance gap; also a hard Play Store submission requirement | `curl https://<domain>/privacy` and `/terms` → HTTP 200 | App deployed |
| Split single React ErrorBoundary into per-tab boundaries | P2 | 1 day | One crashed component unmounts the entire operator console | Force an error in one tab, confirm others unaffected | None |
| Add pagination to ContactsV2 for 100+ leads | P2 | 4 hrs | UI renders all leads in one pass, degrades badly past ~1000 | Manual test with a large `leads.json` | None |

---

## 2. Credentials

Provider-by-provider status per `docs/audits/FINAL-PRODUCTION-INTEGRATION-REPORT.md` (most recent ground truth): **6 FULLY_OPERATIONAL** (OpenAI, Groq, Razorpay, Telegram, WhatsApp, GitHub OAuth-app half), **15 MISSING_CREDENTIALS** (backend+frontend wired, no key set), **2 NOT_IMPLEMENTED** (PayPal, Airtable — zero code exists, not a credential gap). This section covers core/system-level secrets; OAuth, Payments, AI Providers, Storage, and Email each have their own dedicated section below.

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| Set production `JWT_SECRET` (64-char hex, freshly generated) | P0 | 5 min | Vault encryption and all auth derive from this — server auth breaks entirely without it | `pm2 env 0 \| grep JWT_SECRET` present and non-default | None |
| Set production `OPERATOR_PASSWORD_HASH` (fresh scrypt hash) | P0 | 5 min | Operator/admin login impossible without it (required in production) | Login test via `/auth/login` | `JWT_SECRET` set |
| **[Historical exposure]** Rotate every secret that was ever committed to `.env` in plaintext (Razorpay key/secret/webhook, WA_TOKEN, OPENAI_API_KEY, GROQ_API_KEY, TELEGRAM_TOKEN, JWT_SECRET, OPERATOR_PASSWORD_HASH) | P0 | 30 min | Anyone with repo/git-history access can read payments, send messages, bill AI usage, or forge sessions using the old values | `git log -p -- .env` shows no live current values; each provider's dashboard confirms new key issued | None |
| **[Verify resolved]** Confirm `.env.bak.module8` (a previously-flagged plaintext-secret file not covered by `.gitignore`) is gone and was never committed | P0 | 10 min | If it still exists or was committed, a live key is exposed in git history | `ls .env.bak.module8` (should not exist); `git log --all --full-history -- .env.bak.module8` | None |
| Confirm `.env` file permissions are `600` on the production server | P0 | 2 min | World/group-readable `.env` on a shared or compromised host exposes every secret at once | `stat -c %a .env` → `600` | VPS access |
| Maintain a separate secure copy of `.env` outside the repo/backup system | P0 | 15 min | `.env` is deliberately excluded from all backups — if the VPS is lost with no separate copy, every credential must be regenerated from scratch | Confirm a password-manager/encrypted-note copy exists | None |
| Set `ALLOWED_ORIGINS` to the real production domain | P0 | 2 min | Cross-origin cookies rejected — frontend cannot authenticate against the API | `.env` value is not localhost | None |
| Set `BASE_URL` to the real production domain (https) | P0 | 2 min | Razorpay webhook URLs and OAuth redirect defaults resolve to localhost — webhooks and OAuth break | `.env` value is not localhost | Domain live |
| Set `APP_URL` to match production domain | P1 | 2 min | Narrower blast radius than `BASE_URL` (AI Referer header only) but should stay consistent | `.env` value is not localhost | None |
| Set `DISABLE_X_POWERED_BY=1` | P2 | 2 min | Minor Express fingerprinting info-disclosure | `curl -I` response has no `X-Powered-By` header | None |
| Verify `TELEGRAM_TOKEN` is genuinely live (FULLY_OPERATIONAL) | P1 | 5 min | Used for operator alert routing | `pm2 logs \| grep Telegram` confirms alert delivery | None |
| Set `TELEGRAM_OPERATOR_CHAT_ID` for crash/error alerts to phone | P1 | 10 min | Without it, alerts only surface in PM2 logs, requiring manual checking | Get chat ID via `@userinfobot` | Telegram token configured |
| Verify `WA_TOKEN`/`WA_PHONE_ID` are genuinely live (FULLY_OPERATIONAL) — core product feature, not optional | P0 | 15 min | WhatsApp automation is a core value proposition | Send/receive a real WhatsApp message via the connector | None |
| Confirm `WA_PHONE_ID` holds a real phone-number-id, not a WhatsApp Business Account ID | P1 | 15 min | A documented real mismatch risk — using the wrong ID type breaks WhatsApp sends | Verify the value against Meta's Graph API phone-number-id format | WA_TOKEN configured |
| **[RESOLVED, RE-VERIFIED 2026-08-04]** Add HMAC signature verification to the WhatsApp inbound webhook | P0 | Done | Was unauthenticated in the source audit; real `crypto.timingSafeEqual` HMAC-SHA256 verification confirmed present at `backend/routes/whatsapp.js:10-19` this session, with an explicit dev-only warning (not a silent bypass) when `WHATSAPP_APP_SECRET` is unset | Set `WHATSAPP_APP_SECRET` in production `.env`; confirm the warning no longer appears in logs | None |
| Add rate limiting to the WhatsApp webhook | P1 | 1 hr | Webhook currently accepts unlimited POST requests — DoS/cost risk | Confirm `rateLimiter(...)` applied to the route | None |
| Configure `SLACK_BOT_TOKEN` | P2 | 10 min | Slack listed MISSING_CREDENTIALS — explicitly non-blocking for launch | Test Slack connector call | Slack app created |
| Configure `DISCORD_BOT_TOKEN`/`_CLIENT_ID`/`_SECRET` | P2 | 10 min | Discord listed MISSING_CREDENTIALS | Test Discord connector call | Discord app created |
| Configure `NOTION_API_KEY` or OAuth client | P2 | 10 min | Notion listed MISSING_CREDENTIALS — non-blocking | Test Notion connector call | Notion integration created |
| Configure `SHOPIFY_STORE_DOMAIN`/`_ADMIN_TOKEN` | P2 | 10 min | Shopify listed MISSING_CREDENTIALS | Test Shopify connector call | Shopify store + token created |
| Configure `WOOCOMMERCE_URL`/`_KEY`/`_SECRET` | P2 | 10 min | WooCommerce listed MISSING_CREDENTIALS | Test WooCommerce connector call | WooCommerce site + keys created |
| **[RESOLVED, RE-VERIFIED 2026-08-04]** Remove `x-auth-token` header authentication bypass | P0 | Done | Was present in the source audit; confirmed genuinely absent from `backend/middleware/authMiddleware.js` this session (grep for the header/bypass pattern returns zero matches — cookie-only auth, as intended) | `grep -n "x-auth-token" backend/middleware/authMiddleware.js` → no matches | None |
| Enforce trial-expiry gate in billing middleware | P0 | 2 hrs | Expired-trial users can currently still reach paid features — revenue leak, bypassable billing gate | Manual test with an expired trial account | None |

---

## 3. OAuth

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| Enable Google sign-in in Firebase Console, set support email | P1 | 5 min | "Sign in with Google" (mobile) fails without it | Firebase Console → Authentication → Sign-in method | Firebase project created |
| Configure `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Google OAuth, distinct from Gemini) | P1 | 10 min | Google OAuth listed MISSING_CREDENTIALS — web "Sign in with Google" and Google-based integrations fail | `GET <domain>/oauth/status` → `google.configured: true` | Google Cloud Console OAuth client created |
| Configure `GITHUB_CLIENT_ID`/`_SECRET` (OAuth app) and `GITHUB_TOKEN` (PAT) | P1 | 15 min | OAuth-app half is FULLY_OPERATIONAL; PAT half is MISSING_CREDENTIALS — repo access / engineering agent features degrade to public-read-only | `GET <domain>/oauth/status` → `github.configured: true`; test an authenticated GitHub API call | GitHub OAuth App + PAT generated |
| Fix broken Google OAuth token passback inside the Electron app window | P0 | 1 day | Google OAuth is documented as broken specifically in the Electron desktop client (no token passback to the app window) even where it works on web | Manual test: complete Google OAuth inside the packaged Electron app, confirm the app receives the token | Electron packaging pipeline functional (§5) |

---

## 4. Payments

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| Verify Razorpay live key pair is genuinely live (`RAZORPAY_KEY_ID`/`_KEY_SECRET`) | P0 | 15 min | A previously-flagged 401 on the live key pair would mean 100% of real payments fail — confirmed FULLY_OPERATIONAL in the latest audit but must be re-verified against the actual go-live account | Razorpay Dashboard → API Keys; test `POST /billing/upgrade` end-to-end | Razorpay KYC approved |
| Complete Razorpay KYC (business verification) | P0 | 1-3 business days | Cannot obtain live API keys or accept real payments at all until KYC is approved | Razorpay Dashboard KYC status check | Razorpay account created |
| Set `RAZORPAY_WEBHOOK_SECRET`, confirm no leading/trailing whitespace | P0 | 5 min | Without it (or with a whitespace bug previously found and fixed), all payment webhooks are rejected — payments received but never confirmed | Razorpay Dashboard → Webhooks → "Test webhook" → expect HTTP 200 | Razorpay webhook registered |
| Register the Razorpay webhook endpoint and select the correct events (payment.captured, payment.failed, subscription.activated/cancelled/completed, refund.processed) | P0 | 10 min | Without a registered webhook, or with missing event subscriptions, specific billing state transitions never sync to the app | Razorpay Dashboard → Webhooks → confirm URL and event checklist | `BASE_URL` set, app deployed with HTTPS |
| Verify raw-body middleware runs before HMAC signature verification on the webhook route | P0 | 15 min | If JSON re-serialization happens before the signature check, HMAC verification always fails, rejecting all legitimate webhooks | Code review + test with a real webhook delivery | Webhook registered |
| Set `RAZORPAY_PLAN_ID_STARTER` / `_GROWTH` / `_SCALE` (not `_ENTERPRISE` — real naming mismatch documented in the canonical map) | P1 | 15 min | Missing plan IDs fall back to a one-time payment link instead of an auto-renewing subscription; the `_ENTERPRISE` name silently no-ops since `billingService.js`'s real plan set is `starter/growth/scale` | `POST /billing/upgrade` returns `subscriptionId`, not just `paymentUrl` | Plans created in Razorpay Dashboard |
| End-to-end upgrade flow test (billing status → upgrade → real payment) | P0 | 30 min | Confirms the full paid-conversion path actually works before real users hit it | `curl` billing status, then upgrade, expect a real `subscriptionId`/`paymentUrl` | Razorpay keys + plans configured |
| Configure `STRIPE_SECRET_KEY`/`_WEBHOOK_SECRET`/`_PUBLISHABLE_KEY` | P1 | 15 min | Stripe listed MISSING_CREDENTIALS — no alternate/international payment method available | Test a Stripe connector call | Stripe account created |
| **Do not build or advertise PayPal** | P2 | N/A | PayPal is NOT_IMPLEMENTED — zero code exists anywhere; any launch messaging referencing it is false | Code search confirms no PayPal connector/route | None |
| Fix Razorpay payment-failure messaging (explicit error + support contact, not a generic dead-end message) | P1 | 1 hr | Users who hit a failed payment currently see a generic message with no recovery path | Manual test: trigger a failed upgrade, confirm an actionable error is shown | None |
| Remove any hardcoded payment link in the CRM UI | P1 | 1 hr | Bypasses the dynamic billing/plan system, risking stale or incorrect payment amounts | Code review of the CRM payment component | None |
| Build a self-serve signup UI wired to the real registration endpoint | P0 | 2-4 hrs | Backend registration is fully implemented but no UI exists — new/anonymous users currently hit a dead end at the login page with no way to create an account | Manual UX walkthrough: landing → onboarding → signup → app | None — backend already ready |
| Route onboarding completion to the real signup flow instead of dropping users at login | P0 | 1 hr | Even once a signup UI exists, without this rewiring users still land on a password-only dead end | Manual UX walkthrough of the full onboarding path | Signup UI built |

---

## 5. AI Providers

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| Verify `OPENAI_API_KEY` and `GROQ_API_KEY` are genuinely live (both FULLY_OPERATIONAL) | P0 | 10 min | Groq is the default AI provider — if broken, primary AI chat (`POST /jarvis`) fails entirely; OpenAI also backs Whisper STT | `curl -X POST $BASE/jarvis -d '{"input":"Hello"}'` → real reply | None |
| Configure `ANTHROPIC_API_KEY` | P1 | 5 min | Anthropic listed MISSING_CREDENTIALS — Claude routing unavailable, no fallback to this provider | Test AI chat with Anthropic explicitly selected | None |
| Configure `GEMINI_API_KEY` | P1 | 5 min | Gemini listed MISSING_CREDENTIALS | Test AI chat with Gemini selected | None |
| Configure `OPENROUTER_API_KEY` | P1 | 5 min | OpenRouter listed MISSING_CREDENTIALS — fallback multi-model routing unavailable | Test fallback provider path | None |
| Audit the provider fallback chain end-to-end | P1 | 4 hrs | If the primary provider (Groq) fails, it is unverified whether fallback to secondary providers actually triggers correctly | Manual failure-injection test against the runtime's fallback logic | AI provider keys configured |

---

## 6. Storage

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| Configure `SUPABASE_URL`/`_ANON_KEY`/`_SERVICE_KEY` | P1 | 15 min | Supabase listed MISSING_CREDENTIALS | Test a Supabase-dependent connector call | Supabase project created |
| Configure `AWS_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY`/`_REGION`/`S3_BUCKET` | P1 | 15 min | AWS listed MISSING_CREDENTIALS; canonical map also flags a real Vault ENV_MAP type mismatch on the secret key | Test file upload/storage roundtrip | AWS IAM credentials created |
| Configure Cloudflare R2 (`R2_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY`/`_BUCKET`/`_ACCOUNT_ID`) as an optional alternate storage backend | P2 | 15 min | Optional — unavailable if not set, no launch impact if AWS/Supabase cover the need | Test R2-backed storage call | R2 bucket created |
| Configure `FIREBASE_SERVICE_ACCOUNT`/`FIREBASE_PROJECT_ID` (Firestore, also covers auth — see §2) | P0 | 15 min | Firebase listed MISSING_CREDENTIALS — mobile/web auth and Firestore chat/tasks non-functional | `curl <domain>/health \| grep firebase` → `"firebase": true` | Firebase project + service account created |
| Create Firestore database (production mode, correct region) | P0 | 5 min | Mobile chat/tasks storage has nowhere to write — feature fails entirely | Firebase Console → Firestore → confirm database exists | Firebase project created |
| Publish Firestore security rules (user-scoped access) | P0 | 10 min | Without rules, Firestore either denies all access or defaults to open access — a severe cross-user data leak in the latter case | Firebase Console → Firestore → Rules → confirm published rules match the intended per-user access pattern | Firestore database created |
| Configure `HOSTINGER_API_KEY` | P2 | 10 min | Hostinger listed MISSING_CREDENTIALS — non-blocking if VPS is managed manually | Test Hostinger connector call | Hostinger account + key created |
| Configure `CLOUDFLARE_API_TOKEN` + `_ACCOUNT_ID` | P1 | 10 min | Cloudflare listed MISSING_CREDENTIALS — automated DNS/CDN management via API unavailable (manual console still works) | Test a Cloudflare connector call | Cloudflare account + token created |
| **Do not build or advertise Airtable** | P2 | N/A | Airtable is NOT_IMPLEMENTED — zero code exists anywhere | Code search confirms no Airtable connector/route | None |

---

## 7. Email

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| Configure `RESEND_API_KEY` (email verification) | P0 | 10 min | Marked REQUIRED for beta — verification/transactional emails silently fail to send without it | Send a real test verification email, confirm delivery | Resend account created |
| Set `SMTP_FROM`/`EMAIL_FROM` sender identity (not the unused `RESEND_FROM_EMAIL`/`FROM_EMAIL` aliases) | P1 | 5 min | Outbound emails may be rejected/spam-flagged without a proper From address; the alias names are documented but never actually read by code | Confirm `.env` uses the real variable names | Email provider configured |
| Implement the forgot-password email flow (route + email send + reset UI) | P1 | 4 hrs | No password recovery path exists at all — for a multi-user public launch, locked-out users have no self-service recovery (acceptable only for single-operator deployments) | Manual test: trigger forgot-password, confirm a real reset email arrives and the reset flow completes | Email provider configured |
| Add a visible "Forgot password?" link on the login page | P1 | 1 hr | Even once the flow exists, users have no way to discover it without a visible link | Manual UX check on the login page | Forgot-password flow implemented |
| Add an email capture field to landing/onboarding | P1 | 2 hrs | No way to retarget/follow up with users who abandon before completing signup | Manual UX check — field present and submits | None |

---

## 8. DNS

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| Point production domain's A record to the VPS IP | P0 | 10 min | Domain does not resolve — app unreachable at its real URL | `dig +short <domain>` = VPS IP | VPS provisioned |
| Confirm DNS propagation before any cutover | P0 | up to 24 hrs (usually <1 hr) | Premature SSL issuance or cutover causes intermittent unreachability | `dig +short <domain>` matches VPS IP from multiple resolvers | A record set |

---

## 9. SSL

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| Obtain and install SSL certificate via certbot | P0 | 15 min | No HTTPS — browsers block/warn, secure cookies never sent, app effectively broken publicly | `certbot --nginx -d <domain>`; `curl -I https://<domain>/health` → 200, no cert warning | nginx installed, DNS propagated |
| Verify HTTP → HTTPS redirect | P0 | 5 min | Users on plain HTTP get an insecure/broken experience | `curl -I http://<domain>` → 301 to HTTPS | SSL certificate obtained |
| Confirm secure cookies are gated on `NODE_ENV=production` | P0 | 5 min | If `NODE_ENV` isn't set correctly, secure cookies silently don't get set over HTTPS | Code review: `auth.js` cookie options; confirm `NODE_ENV=production` | SSL certificate obtained |
| Set up SSL auto-renewal (certbot timer) | P0 | 15 min | Let's Encrypt certs expire ~90 days — an outage if not auto-renewed | `systemctl list-timers \| grep certbot` | SSL certificate obtained |

---

## 10. Electron (Desktop)

**Baseline: 94% certified this session (2026-08-04)** — auto-updater, code-signing config, IPC surface (5/5 spot-checked methods have real matching handlers), crash reporting/recovery, and the packaging manifest (`asarUnpack` correctly covers both real native deps, `node-pty` and `better-sqlite3`, both confirmed genuinely used in `backend/`) all independently re-verified this session with file:line evidence — see `docs/audits/PRODUCTION-COMPLETION-WEEK.md`.

**[RE-CONFIRMED LIVE + ROOT CAUSE NARROWED 2026-08-04]** B17 was directly re-reproduced this session: `npx electron-builder --mac --dir` progressed cleanly through `better-sqlite3` (`preparing` → `finished` in under a second), then genuinely hung on `node-pty`'s rebuild — confirmed via `ps aux`: the `@electron/rebuild` node-gyp worker process sat at 0.03s of accumulated CPU time after 3+ minutes of real wall-clock time (idle/stuck, not compiling).

**New this session — the hang is narrower than previously documented**: running `npx node-gyp rebuild --directory=node_modules/node-pty --verbose` **directly** (bypassing electron-builder's `@electron/rebuild` wrapper entirely) completes successfully in seconds — real `c++`/`clang` compilation of `pty.cc` and `spawn-helper.cc`, ending in `gyp info ok`, with real built artifacts confirmed on disk (`node_modules/node-pty/build/Release/pty.node`, 86520 bytes; `spawn-helper`, 50528 bytes). **The underlying native compilation is not broken** — Xcode Command Line Tools, Python, and node-gyp itself all work correctly against this exact `node-pty@1.1.0` on Node 24.11.1. The hang is specifically in how `@electron/rebuild` (electron-builder's own dependency) invokes or wraps that same rebuild step — a wrapper-layer bug/incompatibility, not a toolchain or source problem.

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| **[BLOCKER — B17, ROOT CAUSE NARROWED 2026-08-04]** Resolve `node-pty` rebuild hang specifically in `@electron/rebuild`'s wrapper (raw `node-gyp rebuild` works fine) | P0 | Now a bounded investigation, not open-ended | No installer (DMG/EXE/AppImage) can be produced by the real release pipeline until resolved. Confirmed NOT a toolchain/compile problem. | `npx electron-builder --mac --dir` should complete without hanging on the `node-pty` prepare step | **Tried this session, ruled out**: `npx electron-builder install-app-deps` (electron-builder's own suggested fix, printed in its own log output) hits the identical hang — same `@electron/rebuild` node-gyp worker, same near-zero CPU signature after 60s. **Real, untried lead**: the repo currently pins `@electron/rebuild@3.6.1` (`node_modules/@electron/rebuild/package.json`); the latest published version is `4.2.0` (`npm view @electron/rebuild version`) — a major version jump, likely containing real fixes for Node 24.x/newer node-gyp compatibility given how common this hang class is with older rebuild-tooling versions. **Not yet tested this session** — upgrading a build-toolchain dependency is a real change that needs its own verification pass (a fresh `--mac --dir` run after upgrade), not something to do inside a checklist-writing session. This is the highest-value next thing to try. |
| Obtain Apple Developer Program membership + signing cert (mac code signing) | P0 | 1-2 days + $99/yr | Unsigned DMG triggers Gatekeeper warnings; blocks Mac App Store/enterprise distribution | Confirm signing secrets present in CI (`APPLE_ID`, `APPLE_TEAM_ID`, cert + password) | B17 resolved first (builds must complete before signing matters) |
| Purchase Windows code-signing certificate | P0 | 1-3 days procurement | Unsigned EXE triggers SmartScreen warnings; blocks trusted Windows distribution | Confirm signing secrets present in CI (cert PFX + password) | B17 resolved first |
| Implement Electron download manager (`session.on('will-download')`) | P1 | 2-4 hrs | Users cannot download files triggered from in-app browser content — confirmed absent, not broken | Grep `electron/main.cjs` for `will-download` — currently zero matches | None — additive |
| Verify auto-update end-to-end against a real tagged GitHub release | P1 | 1 hr | Users on old versions never get update notifications if the publish target is misconfigured | Confirm `publish.owner`/`publish.repo` in `package.json` match the real release repo; trigger a real update check | B17 resolved (a real release artifact must exist to update to) |
| Decide on scanner/TWAIN-WIA support scope for v1 | P2 | Decision only | None if left as-is — current OS-handoff behavior is documented and correct without native driver access | Re-confirm current behavior matches the documented 88/100 audit | None |
| Re-audit IPC channel pairing after any future `main.cjs`/`preload.cjs` changes | P2 | 30 min per release | Orphaned/unhandled channels silently break renderer calls | Re-run the same IPC audit method used for the 87-channel/zero-orphan baseline | Baseline established |
| Add missing tray icon asset if absent (`electron/assets/icon.png`) | P2 | 15 min | Packaging warning, cosmetic tray fallback | `ls electron/assets/icon.png` | None |

---

## 11. Android

Real Capacitor scaffold exists (`mobile/android/app/build.gradle`) with a real signed-debug APK (5.1MB) and release AAB (3.9MB, 502 entries, CRC-clean) already built and verified this session. A separate, older Flutter track also exists with its own debug artifacts — these must be reconciled to one shipped app before Play Store submission.

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| Finalize package/app identity (`com.ooplix.jarvis` vs `com.jarvisai.app`, "Ooplix" vs "JARVIS AI") | P0 | 5 min | Cannot be changed after the first Play Store upload — a wrong choice here is permanent | `grep appId mobile/capacitor.config.ts`; `grep applicationId mobile/android/app/build.gradle` | None — must precede signed release build |
| Reconcile Capacitor (`mobile/`) vs Flutter (`flutter/`) as the single shipped Android app | P1 | 1-2 hrs (decision + cleanup) | Two parallel Android codebases with real built artifacts risk shipping the wrong one or duplicating maintenance | Compare both `build.gradle`s, confirm which AAB gets uploaded | Package/app-name decision |
| Generate a real release keystore and back it up securely (password manager + offline copy) | P0 | 10 min | Losing or never creating this means the app can never be updated after first publish | `keytool -genkey` per documented command | Package name finalized |
| Create Firebase project, add `google-services.json` to the Android app module | P0 | 20-30 min | Auth/Firestore non-functional in the shipped app without it | `ls mobile/android/app/google-services.json` | Firebase project created |
| Build a real signed-release AAB via `./gradlew bundleRelease` (not the debug/unsigned build already produced) | P0 | 30 min | Only a debug-signed APK and an unsigned-flow release AAB exist to date — Play Store requires a properly release-signed AAB | `./gradlew bundleRelease` with real keystore env vars; verify with `unzip -l` | Real keystore generated, signing config wired |
| Create app icons (launcher, adaptive foreground/background, notification icon) | P0 | 30-60 min | Play Console upload fails without required icon assets | Check `mipmap-*/ic_launcher.png` present | None |
| Register Google Play Console developer account ($25 one-time) | P0 | 5 min + processing | Cannot create any app listing or upload any build without this | Confirm account active at play.google.com/console | None |
| Complete Content Rating questionnaire + Data Safety form | P0 | 15-20 min | Play Store blocks publishing without both | Play Console → Policy → App content | Play Console account created |
| Add `android.permission.POST_NOTIFICATIONS` for FCM push | P1 | 2 min | Push notifications silently fail on Android 13+ without this | Grep the synced `AndroidManifest.xml` | FCM enabled |
| Add OAuth deep-link intent filter for Google/GitHub callback on mobile | P1 | 15 min | OAuth login cannot return to the app on mobile — users stuck in the browser | Grep `AndroidManifest.xml` for the auth intent filter | Package name finalized |
| Set `FIREBASE_SERVICE_ACCOUNT`/`FIREBASE_PROJECT_ID` in the backend `.env` | P1 | 10 min | Backend cannot verify Firebase-issued tokens from mobile clients — mobile auth calls 401 | Check backend `.env`/secret store | Firebase project + service account key generated |
| Deploy live Privacy Policy and Terms URLs | P1 | 15 min | Play Store requires a public, reachable privacy policy before publishing | `curl https://<domain>/privacy` and `/terms` → 200 | Backend/frontend deployed |
| Fix the 4 dead Flutter mobile routes (AI Chat, Tasks, Metrics, Settings) if the Flutter track is the one shipped | P0 | 2-4 hrs | Half the Flutter screens are entirely unreachable navigation dead-ends | Manual nav test: tap each dashboard tile, confirm route loads | Flutter chosen as the shipped app |
| Prepare Play Store listing assets (feature graphic, screenshots, description) | P2 | 1-2 hrs | Cannot submit the store listing without these; non-blocking for internal testing | Check Play Console listing draft | Play Console account created |
| Upload to Internal Testing track before any Production promotion | P0 | 30 min + review wait | Skipping internal QA risks shipping a broken build to all users at once | Play Console → Internal testing → upload signed AAB | Signed release AAB built |
| Add native splash screen resource | P2 | 10 min | Cosmetic only — JS-level Capacitor splash already works | Check drawable resource present | None |

---

## 12. iOS

**Honest status: genuinely blocked in the current development environment, not a short task list.** Confirmed via `xcode-select -p` (returns only Command Line Tools, no full Xcode.app) and direct inspection of `flutter/ios/` (contains only stub `Flutter/`/`Runner/` directories — no real `.xcodeproj`, no `Info.plist`). Zero iOS build has ever been produced. This entire section requires a Mac with full Xcode plus an active Apple Developer Program account before any item below can even begin.

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| Acquire a Mac with full Xcode.app and an active Apple Developer Program account | P0 | Not achievable in current environment | Zero iOS packaging is possible until this exists — a real, documented environment limitation | `xcode-select -p` currently returns Command Line Tools only | Apple Developer Program enrollment ($99/yr, identity verification) |
| Generate a real `flutter/ios` Xcode project via `flutter create --platforms=ios` | P0 | 1-2 hrs once Xcode exists | Currently only stub directories exist — no real project to build from | `find flutter/ios -iname "*.xcodeproj"` — currently empty | Full Xcode installed |
| Add `GoogleService-Info.plist` for Firebase iOS | P0 | 15 min once project exists | iOS Firebase Auth/Firestore non-functional without it | `ls flutter/ios/Runner/GoogleService-Info.plist` — currently absent | Firebase project created, real Xcode project scaffolded |
| Configure iOS code signing (provisioning profiles, distribution cert, Team ID) | P0 | 1-2 hrs once Apple account active | Cannot build a device-installable or submittable IPA without this | `find . -iname "*.mobileprovision"` — currently returns nothing | Apple Developer Program membership active |
| Build and archive a real signed IPA | P0 | 1-2 hrs once above resolved | No iOS binary has ever been produced — fully greenfield, unlike Android | `flutter build ipa --release` — never yet run in this environment | Xcode project, signing, Firebase config all complete |
| Set up App Store Connect app record + TestFlight beta | P0 | 1-2 hrs + Apple review (24-48h typical) | No path to beta or production iOS distribution without this | App Store Connect → New App | Apple Developer Program active, signed IPA built |
| Submit for App Store review | P1 | Apple review 1-3 days typical | N/A until all iOS P0 items above are resolved — listed for launch-sequence completeness | App Store Connect → Submit for Review | All iOS P0 items complete |
| Add iOS app icons and launch screen assets | P2 | 30-60 min once project exists | Cosmetic/submission requirement, not functional | Config already targets iOS in the icon generator tooling | Real Xcode project scaffolded |
| Explicitly document iOS as out of scope for the current release cycle | P2 | N/A | Prevents false expectations that iOS is "almost done" when it is fully unstarted | Reference this section as the canonical honest status | None |

---

## 13. Security

**Baseline**: real cross-org CRM data leak found and fixed this month (verified with two real orgs, zero leakage after fix). RBAC/org-scoping gaps remain in several non-core modules. Organizations/Enterprise modules are the strongest, with a documented fix for a prior orgId-spoofing vulnerability class.

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| **[RESOLVED, RE-VERIFIED 2026-08-04]** Fix SSRF in ODI browser-automation routes (no internal/private-IP blocklist, including cloud metadata endpoint) | P0 | Done | Was missing in the source audit; `backend/utils/urlSafety.cjs`'s `assertSafeNavigationTarget()` confirmed this session — blocks non-http(s) schemes, localhost, RFC1918/link-local IPv4, the 169.254.169.254 cloud metadata endpoint, IPv6 ULA/loopback, with DNS-rebinding protection — and confirmed wired into `interactionIntelligence.cjs`, `liveDesignEditor.cjs`, `visualCaptureService.cjs`, `domAnalyzerService.cjs`, `agents/browser/actionEngine.cjs` | Test against `169.254.169.254` and an RFC1918 address, confirm both rejected | None |
| **[RESOLVED, re-verify before each release]** Cross-org CRM data leak (`crmService.js`) | P0 | 15 min re-verify | Real cross-tenant PII exposure between paying customer orgs if regressed | Regression test: two real orgs sharing a phone number, confirm zero cross-leak | Fix already committed |
| Add RBAC/org-scoping to Creative Studio, Coding, Agents, Analytics, and Automation modules (currently `requireAuth` only) | P1 | Multi-day, per module | Not a confirmed leak today, but an inconsistent isolation model vs. Organizations/Enterprise — real risk if any module logic assumes tenant boundaries | Apply the same `requireOrgPermission` pattern already proven in the Organizations module | Organizations module pattern as template |
| Expand rate-limiting coverage beyond the current ~7 of ~126 route files | P1 | 1 day | A single valid token can issue unbounded requests to expensive AI-backed endpoints | Confirm rate-limit middleware applied per route family; nginx `limit_req_zone` is partial defense-in-depth | None |
| Add a dedicated CSRF-token layer (currently mitigated only by `sameSite:strict`) | P1 | 1-2 days | `sameSite:strict` covers most realistic vectors but is not complete | Code review — confirmed unchanged finding across multiple audit cycles | None |
| Run `bash deploy/validate-production.sh` before go-live | P0 | 5 min | Automates the JWT_SECRET/OPERATOR_PASSWORD_HASH/port/HTTPS/webhook-secret checklist — manual review is error-prone | Script output — all green | Env vars set |
| Address `npm audit` findings in `node-telegram-bot-api` (deprecated deps, known CVEs) | P2 | 1 day + testing | Production dependency carries known CVEs; blast radius assessed as limited (no PII/payment access) | `npm audit`; consider `telegraf` or a newer `node-telegram-bot-api` | None |
| Upgrade `electron-builder` to resolve high-severity build-tool vulnerabilities | P2 | Half day + validate packaging | Affects only the build/packaging pipeline, not the running app | `npm audit` on the build toolchain | Trusted CI for validation |
| Correct factual errors in `SECURITY.md` (bcrypt vs. actual scrypt; "no SSO" claim vs. actual Firebase OAuth) | P2 | 30 min | Reputational/compliance risk if relied on for a disclosure program | Direct source-code cross-check | None |
| Fix CORS rejection returning HTTP 500 instead of a clean 403 | P2 | 30 min | Not a vulnerability (rejection is real and correct) but a poor signal for debugging/monitoring | Code review of the CORS origin callback | None |
| Consider database-enforced tenant isolation (currently app-layer only) | P2 | Architectural — separate project | No backstop exists if a future app-layer RBAC bug occurs; explicitly out of scope for incremental fixes | N/A — deferred decision | None |
| Decide whether CRM operator-only bulk-read routes should also become org-scoped | P2 | Product decision | Currently intentional cross-org admin tooling, not a leak, but inconsistent with per-org isolation elsewhere | N/A — deliberate decision, not a bug | None |

---

## 14. Monitoring

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| Install cron healthcheck for auto-restart on crash (every 5 min) | P0 | 10 min | Without an independent watchdog, recovery relies solely on PM2's own crash-loop policy | `*/5 * * * * deploy/healthcheck.sh >> logs/healthcheck.log 2>&1` in crontab | `deploy/healthcheck.sh` present |
| Run `bash deploy/monitor.sh` and confirm all sections healthy before go-live | P0 | 10 min | Baseline health snapshot must be clean before declaring launch-ready | Script output — PM2/memory/errors/automation/CRM/webhooks all green | Backend running |
| Verify `/health`, `/stats`, `/ops`, `/runtime/stream` (SSE) all return correct live data | P0 | 15 min | These are the only in-app monitoring surfaces — if broken, operators have zero runtime visibility | Manual curl checks against each endpoint | App deployed |
| Configure Sentry (`SENTRY_DSN`) for error tracking | P1 | 30 min | No aggregated/alerted error tracking currently active — production errors only visible via raw PM2 logs | Confirm errors appear in Sentry dashboard after a forced test error | Sentry account/project created |
| Configure UptimeRobot (or equivalent) to monitor `/health` | P1 | 15 min | No external uptime monitoring — an outage could go undetected until a user reports it | Confirm alert fires on a simulated downtime | UptimeRobot account |
| Set `TELEGRAM_OPERATOR_CHAT_ID` for phone alerts | P1 | 10 min | Crash alerts otherwise only surface in logs requiring manual checking | (Duplicate of §2 credential item — single action, cross-referenced here for monitoring completeness) | Telegram token configured |
| Add `window.onerror`/`unhandledrejection` global handler (frontend) | P2 | 2-3 hrs | Uncaught frontend JS errors are currently never reported anywhere | Code review — global handler wired to error reporting | Sentry or equivalent configured |
| Optionally wire Datadog for deeper APM/tracing | P2 | 1-2 hrs | Not a launch blocker — Sentry + PM2 + UptimeRobot is a sufficient baseline | Confirm metrics flow to Datadog dashboard | Datadog account |
| Confirm PM2 ecosystem config: `wait_ready`, graceful shutdown, memory ceiling, log rotation all correct | P0 | 10 min | Misconfigured PM2 can mask crashes or fail to restart cleanly under load | Manual config review | `ecosystem.config.cjs` present |

---

## 15. Backups

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| Confirm the backup cron job is actually installed and running on the VPS (daily, e.g. 02:00) | P0 | 10 min | "Backup capability exists in code" does not mean backups are actually happening in production until verified live | `pm2 status \| grep backup` (or crontab `-l`) shows the job scheduled and its last run succeeded | PM2/cron deployed |
| Understand and document exact backup scope (what `backup.sh` covers and excludes) | P0 | 5 min | The script archives `data/` only, excludes some subpaths, and never includes `.env` — must be understood before relying on it as "full backup" | Read `backup.sh` directly | None |
| Run the documented test-restore procedure now, not during a real emergency | P0 | 10 min | This is the tested way to confirm the backup process actually works — if it silently fails, that's only discovered when it's needed most | Run the documented restore-validation script, confirm PASS | A real backup archive must exist |
| Fix the known restore-validator naming mismatch bug (validator expects a different filename than the backup script writes) | P1 | 30 min | Causes the restore validator to report a false failure even when the underlying data restore actually succeeds — undermines trust in the PASS/FAIL signal during a real incident | Re-run test-restore after the fix, confirm it reports PASS correctly | None |
| Set up off-server backup replication (rsync/scp to a second host, or object storage) | P0 | 1-2 hrs | **The single biggest gap identified**: backups currently live only on the same VPS — if the VPS is lost entirely, all on-server backups are lost with it | Confirm a scheduled job copies backup archives to a second host or S3/R2 | A second host or object storage target |

---

## 16. Disaster Recovery

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| Rehearse the code-rollback path (`deploy/rollback.sh --code <hash>`) | P1 | 15 min | Confirms rollback actually works before it's needed under real pressure | Run against a real prior commit, confirm app returns healthy | `deploy/rollback.sh` present |
| Rehearse the data-restore path (`deploy/rollback.sh <backup>.tar.gz`) | P1 | 15 min | Confirms the pre-rollback safety snapshot actually protects against restoring the wrong backup by mistake | Run against a real backup archive, confirm the automatic pre-rollback snapshot is created first | `deploy/rollback.sh` present |
| Document and rehearse full VPS-loss recovery (new VPS → restore `.env` → restore `data/` from off-server backup → DNS repoint → SSL → restart) | P0 | 20-40 min once rehearsed (mostly DNS/cert wait) | Without a rehearsed runbook, real recovery time in an actual VPS-loss event is unknown and likely far longer than any documented estimate | Full dry run on a throwaway VPS | Off-server backup replication (§10) must exist first — otherwise `data/` recovery is impossible |
| Confirm task-queue self-healing on corruption (auto-backs-up corrupt file, resets safely) still functions | P2 | 10 min | If self-heal silently discards a corrupt-but-recoverable queue, in-flight tasks are lost without operator awareness | Force a corruption, confirm a `.bak.*` file is created and the app recovers | None |
| Confirm operator-lockout recovery path is documented, and more than one person has server access | P2 | 5 min to verify | If the sole person with SSH access loses credentials, recovery degrades into a full VPS-loss scenario | Confirm the password-hash-regeneration procedure is documented and a second person has access | SSH/filesystem access to the server |

---

## 17. Founder Testing

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| Fix all P0 security/billing findings before founder testing is considered complete (`x-auth-token` bypass, WhatsApp webhook HMAC, trial-expiry bypass — all cross-referenced in §2/§8) | P0 | 1-2 days | These are real, exploitable gaps found by static audit — founder testing on top of them validates a broken foundation | Re-run the static audit until zero FAIL items remain | Security fixes applied |
| Complete a founder dogfooding log across all real product modules for at least 7 of 14 tracked days | P0 | 7-14 days | Undiscovered UX friction and broken flows reach paying customers if skipped | Dogfood dashboard shows ≥7 active days logged | Infrastructure deployed enough to dogfood against a real instance |
| Log and triage every "escape" (bug/friction) found during dogfooding, with zero unresolved critical escapes (crash/data-loss/auth-failure) before beta invites go out | P0 | Ongoing during dogfood period | Unresolved critical escapes will hit real users first if not fixed before beta | Dogfood escape log — zero open `fixRequired:true` entries in the critical categories | Dogfooding sessions logged |
| Founder personally completes one full customer journey against the real production instance (signup → login → CRM contact → payment link → WhatsApp follow-up → AI chat) | P0 | 1-2 hrs | Blind spots in onboarding go undetected until real customers hit them | Manual end-to-end walkthrough | Domain/server/env setup complete |
| Founder personally validates the full payment journey, including receiving own confirmation email/webhook | P0 | 30 min | Payment confirmations silently fail if `BASE_URL`/webhook secret are misconfigured — historically the single most critical launch blocker found | Send a real minimal-value test payment via Razorpay live keys, confirm webhook fires and billing updates | `BASE_URL` correct, webhook secret set correctly |
| Run `bash deploy/validate-production.sh` and `bash deploy/monitor.sh`, confirm both clean | P0 | 10 min | Undetected config errors or silent crash loops surface as live incidents otherwise | Script output review | `.env` fully configured, app running |
| Confirm founder knows the rollback procedure before needing it (dry-run `deploy/rollback.sh --list`) | P0 | 15 min | Panic-driven, untested rollback during a real incident causes more damage than the original issue | Dry-run command lists real prior commits correctly | Git history has a known-good prior state |
| Raise QA coverage meaningfully above the current baseline via real dogfooding-driven checks | P1 | 2-4 hrs | Modules with near-zero tested-check coverage ship with unknown defect rates | QA dashboard shows a materially higher checked-module percentage than the pre-dogfood baseline | Dogfooding sessions provide real usage |
| Verify idle memory usage stays within target (~400MB) | P1 | 10 min | Memory bloat causes VPS OOM kills under real load | `pm2 show jarvis-os \| grep memory` | App running under PM2 |
| Confirm security audit grade is at least a strong pass | P1 | 30 min | Unaudited security gaps reaching production undetected | Re-run the static security audit, confirm score | P0 security fixes applied |

---

## 18. Beta Testing

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| Fix known critical blockers before any paid customer reaches production (localhost `BASE_URL`, missing Firebase prod env vars, any leaked live keys, webhook-secret whitespace bug, broken Google OAuth in Electron, unlabeled "Coming Soon" stubs) | P0 | 1-3 days | Payments silently never confirm; auth limited to email-only; leaked keys are an active security incident; unlabeled dead-end UI erodes trust and conversion | Re-run the documented blocker checklist, confirm zero CRITICAL items remain | Founder Testing P0 items complete |
| Feature-gate or clearly label every "Coming Soon"/non-functional stub surface (Workflow Designer, Knowledge Base upload, Memory Shared Fabric, Email Marketing OS, and others) | P1 | 1 day | Unlabeled dead ends erode beta-tester trust and produce noisy, low-value bug reports | Manual UX walkthrough — every non-functional feature is either hidden or clearly badged | Product decision on which features to hide vs. badge |
| Fix any DEAD (unreachable) navigation routes in the mobile app before beta testers use it | P0 | 2-4 hrs | Testers hitting broken navigation immediately at the start of the beta period poisons early feedback | Manual nav test — tap every dashboard tile, confirm each route loads | Mobile app track decided (§6) |
| Recruit and onboard Phase 1 closed testers (a small, persona-matched group) | P0 | 1-2 days | Non-representative testers miss real onboarding friction and billing edge cases | Testers added to a closed track, opt-in confirmed | Founder Testing complete |
| Set up structured feedback channels (in-app feedback, group chat, issue tracker) and a bug report template | P1 | 2-3 hrs | Informally reported bugs get lost or are hard to triage by severity | Template distributed, channels confirmed active | Testers recruited |
| Run Phase 1 closed testing for ~2 weeks against defined success criteria (install→login conversion, first-session activation, crash-free rate, Day-2 retention, zero critical bugs shipped forward) | P0 | 2 weeks | Shipping unvalidated onboarding/crash issues to a larger cohort compounds churn and bad reviews | Analytics + crash reporting vs. the defined success-criteria table | Testers onboarded, feedback channels live |
| Recruit and launch Phase 2 open testing at a larger scale via multiple channels | P1 | 1 week | Under-recruitment produces statistically weak retention/crash signal before wider rollout | Public beta link live, tester count tracked | Phase 1 complete with zero critical bugs shipped forward |
| Run Phase 2 for ~2 weeks against defined success criteria, including at least one real completed payment | P0 | 2 weeks | The payment flow has never been proven against a real completed transaction until this gate — a silently broken billing system reaching GA is a severe risk | Analytics + real Razorpay payment records vs. the defined success-criteria table | Phase 1 success criteria met |
| For every reported payment issue, trace it through a structured protocol against real backend logs | P0 | 15-30 min per incident | Payment failures without root-cause tracing recur into general availability and cause revenue loss/support burden | Backend log grep + Razorpay Dashboard cross-check per incident | Webhook configured and firing |
| Confirm all go/no-go criteria before any production rollout beyond beta (crash-free rate, real paying customers, zero open P0 bugs, retention, store listing complete, privacy policy live, Firebase production setup, webhook secret set, PM2 auto-restart configured) | P0 | 1 day audit | Rolling out to production without these gates risks a public failure that damages trust before wider launch | Full checklist review against real, current data — not assumptions | Phase 2 success criteria all met |

---

## 19. Launch

Ordered in real execution sequence — pre-launch validation, then the actual go-live sequence, then post-launch monitoring windows.

| Item | Priority | Est. Time | Risk | Verification Method | Dependency |
|---|---|---|---|---|---|
| **[Pre-launch, morning of]** Run final health/readiness/security checks and confirm all thresholds met | P0 | 15 min | Launching without a final green-light check risks discovering a blocker after announcing publicly | Health check 200; readiness score above target; security score above target; PM2 shows zero restarts; logs show no error/fatal lines | All P0 items in §1-§11 complete |
| **[Pre-launch]** Smoke test production endpoints (auth rejects wrong password, AI chat responds, billing status correct, webhook test returns 200) | P0 | 20 min | An untested endpoint could be silently broken by an env misconfiguration that only manifests under real production settings | Documented curl sequence against the live production URL | Pre-launch checks passed |
| **[Pre-launch]** Verify the mobile app end-to-end if the Play Store internal track upload is done (install, email login, Google login, AI chat, billing status, logout) | P0 | 20 min | Mobile-specific auth/config bugs only surface on a real device | Manual device checklist | Play Store internal track uploaded, Firebase SHA-1 fingerprint registered |
| **[Go-live]** Announce: flip status page live, send beta-tester invites, post launch announcement, start an active 24-hour monitoring watch | P0 | 30 min | Launching without an active monitoring watch means early incidents go undetected until users complain | Manual checklist | All pre-launch checks green |
| **[Hour 0-1]** Actively watch PM2 for crashes and monitor memory | P0 | Continuous, 1 hr | The first hour is the highest-risk window and easiest to miss without active watching | Live `pm2 status`/log tail, memory ceiling watch | Launch announced |
| **[Hour 1-2]** First real (non-founder) user test — confirm install, login, AI chat, and (if attempted) webhook delivery and alert routing all succeed | P0 | 1 hr | The first non-founder user is the earliest real signal of an issue founder testing missed | Direct observation with one trusted tester | Hour 0-1 stable |
| **[24-hour check]** Confirm zero PM2 restarts, zero errors in logs, all webhooks returning 200, new signups visible, response time and memory stable | P0 | 30 min review | A slow memory leak or degrading webhook success rate is only visible after a full day of real traffic | Documented 24h checklist against real metrics | Hour 0-2 checks passed |
| **[Week-1 check]** Confirm testers installed and logged in, at least one real payment tested, OAuth tested by a real user, zero P0 bugs reported, no unaddressed critical store reviews | P0 | 1 hr review | Without a formal week-1 gate, the team may believe launch succeeded when core paid flows were never actually exercised by a real customer | Documented week-1 checklist against real data | 24-hour check passed |
| Confirm overall launch-success definition is met (health uptime, real users onboarded, at least one real completed payment, zero P0 bugs, crash-free rate target) before declaring launch complete | P0 | Ongoing rollup | Declaring "launched" without meeting this bar means proceeding into wider rollout on an unvalidated foundation | Documented success-definition checklist | Week-1 check complete |
| Transition to a repeatable daily operations routine post-launch (PM2 health, resource checks, queue/backup/log verification) | P1 | 15 min/day ongoing | Without a repeatable routine, regressions introduced after the initial monitoring window go unnoticed until a customer-facing incident | Daily operations checklist | Week-1 launch check passed |
| Treat known non-wiring feature gaps (Knowledge/Memory frontend pages, Marketing backend) as "beta-label, don't advertise as complete" rather than launch blockers | P1 | N/A — messaging discipline | Advertising non-functional or unbuilt features as production-ready generates support tickets and trust damage | Cross-reference `docs/audits/FINAL-PRODUCTION-INTEGRATION-REPORT.md` §3 | Feature-gating item in §13 complete |

---

## Summary — P0 items that must ALL be true before go-live

This is the minimum bar. Every other item in this document can slip to a fast-follow, but these cannot:

1. VPS provisioned, hardened (SSH), firewalled, app deployed and running under PM2 with persistence across reboot. **[Blocker category: Production deployment]**
2. DNS resolved and propagated; nginx installed and validated; SSL obtained with auto-renewal and HTTP→HTTPS redirect. **[Blocker category: Production deployment]**
3. `JWT_SECRET`, `OPERATOR_PASSWORD_HASH`, `ALLOWED_ORIGINS`, `BASE_URL` set to real production values — all historically-exposed secrets rotated. **[Blocker category: Live credentials]**
4. Razorpay live keys verified genuinely live, webhook registered and secret set correctly, end-to-end payment flow tested with a real transaction. **[Blocker category: Live integrations]**
5. Firebase configured (service account, project ID, Email/Password + Google sign-in enabled, Firestore rules published). **[Blocker category: Live integrations]**
6. ~~`x-auth-token` bypass removed~~ **[RESOLVED, RE-VERIFIED 2026-08-04]**; ~~WhatsApp webhook HMAC verification added~~ **[RESOLVED, RE-VERIFIED 2026-08-04]**; ~~ODI SSRF blocker (B1) fixed~~ **[RESOLVED, RE-VERIFIED 2026-08-04]**. **Still open**: trial-expiry billing gate enforcement — `billingService.js` computes an `"expired"` status and message but no middleware actually blocks a request on it (confirmed this session — genuine remaining gap, not a blocker category, a real fix still needed).
7. Backup cron job confirmed running in production; off-server backup replication in place; test-restore run and passing. **[Blocker category: Production deployment]**
8. Cron healthcheck + `deploy/monitor.sh` clean; `/health`/`/stats`/`/ops` verified live. **[Blocker category: Production deployment]**
9. Founder has completed a real end-to-end dogfooding pass (7+ days) with zero unresolved critical escapes, including a personally-verified real payment. **[Blocker category: Real user telemetry]**
10. Beta go/no-go criteria met, including at least one real completed payment from a real (non-founder) user. **[Blocker category: Real user telemetry]**
11. Full pre-launch smoke test, go-live sequence, and 24-hour/week-1 monitoring gates all executed and green. **[Blocker category: Production deployment + Real user telemetry]**

**Electron desktop distribution and iOS packaging remain genuinely blocked**, re-confirmed this session:
- **B17 (`node-pty` packaging hang) — root cause narrowed 2026-08-04.** Re-reproduced live: `electron-builder --mac --dir` hangs on `node-pty`'s rebuild step. New finding: the underlying `node-gyp rebuild` works perfectly when run directly (real compile, real linked `.node` binary produced in seconds) — the hang is specifically in `@electron/rebuild@3.6.1`'s wrapper, not the toolchain. `electron-builder install-app-deps` (electron-builder's own suggested fix) was tested and hits the identical hang. Highest-value untried next step: upgrade `@electron/rebuild` to `4.2.0` (currently pinned to `3.6.1`) and re-test — not done this session since it's a real dependency change requiring its own verification pass. **[Blocker category: Code signing certificates — this must be resolved before certs even matter, since no installer can be produced to sign yet]**
- **iOS packaging** — genuinely blocked by a missing development environment (no full Xcode.app, only Command Line Tools). **[Blocker category: Production deployment — requires a different physical/virtual environment, not fixable via credentials alone]**

Neither blocks the web/backend/Android launch above; both should be explicitly scoped out of the initial go-live announcement rather than silently promised.
