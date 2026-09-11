# Mission 95 — VPS Deployment Preflight (Read-Only)

**Type:** Read-only infrastructure preflight. No production code modified, no runtime data modified, no `.env` modified, no external infrastructure contacted, no deploy performed, no commit made.

**Date:** 2026-09-08
**Branch:** `security/reality-completion`
**Certified baseline (per instruction):** `HEAD = 41867c0e9439e96ef2f89295910e5e8c42888d37` (Mission 94, email readiness fix, committed).

**Explicitly protected and NOT touched by this mission:** `agents/runtime/agentRegistry.cjs`, `backend/services/missionMemory.cjs`, `backend/services/toolExecutionLayer.cjs`, `reports/AGENT-ARMY-COMPLETE-CENSUS.md`, all existing mission reports, `backend/services/agentRuntimeSupervisor.cjs` (P1-1's 10 hunks). **Note for the record:** between this mission's start and its end, the concurrent session referenced in the prior mission's instructions continued working — `backend/services/approvalEngine.cjs` is now also modified (not present at Mission 94's commit time) and four new untracked test files appeared (`tests/runtime/agent-identity-phase2.test.cjs`, `tests/runtime/approval-engine-evaluation-gate.test.cjs`, `tests/runtime/mission-memory-credential-redaction.test.cjs`, `tests/runtime/tool-execution-agent-identity.test.cjs`). None of this was created, read in depth, or modified by this mission — noted here only because it is live evidence of ongoing concurrent work sharing this working tree, consistent with Missions 93/94's observations. `HEAD` itself is unaffected (still `41867c0e...`) since none of that work has been committed.

---

## Determination: Is a real VPS target/access available from this environment?

**NO.** Checked, not assumed:
- `~/.ssh/config` contains exactly one `Host` entry, and it is the literal placeholder from the `ssh_config` man page (`Host alias` / `HostName hostname` / `User user`) — not a real, addressed target.
- No `VPS_HOST`, `DEPLOY_HOST`, `SSH_HOST`, or similar environment variable is set in this shell (checked by presence-only grep, consistent with the credential-safety rules used throughout this mission chain).
- No cloud-provider CLI (`aws`, `doforge`, `hcloud`, etc.) session or credential file was found or searched further once the SSH-config check alone was sufficient to answer the question — searching deeper for provider credentials was intentionally not attempted, since the negative was already established and further searching would itself risk touching credential material.
- SSH/SCP/rsync binaries exist locally (`/usr/bin/ssh` etc.) — tooling is present, but tooling without a real target is not access.

**Conclusion for §K:** the real VPS rehearsal **cannot begin immediately** from this environment. A real host (IP or domain, reachable, with root/sudo SSH access) must be provisioned and its access handed to this session (or the commands below run manually by the founder) before any of Phase 2's live steps can execute. This mission produces the exact commands and inputs needed so that handoff is a copy/paste operation, not a redesign.

---

## A. VPS Preflight Checklist

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Setup script exists and is idempotent-safe | READY | `deploy/setup-vps.sh` (116 lines) — re-run-safe (`git pull` if repo exists, `id` check before `useradd`, `command -v node` guard) |
| 2 | Production start script exists with real pre-flight gates | READY | `deploy/start-production.sh` (120 lines) — hard-fails on missing `JWT_SECRET`/`OPERATOR_PASSWORD_HASH`/`BASE_URL`, warns on weak secrets and localhost `BASE_URL` |
| 3 | HTTPS/TLS automation exists | READY | `deploy/https-setup.sh` (124 lines) — DNS-match check before calling certbot, patches nginx domain via `sed`, verifies HTTPS reachability, sets up renewal |
| 4 | PM2 process config is production-shaped | READY | `ecosystem.config.cjs` — single fork-mode instance (justified: in-process singletons), `max_memory_restart: 1536M` (sized from a documented past OOM incident), `wait_ready`+`listen_timeout: 30000` (100+ agent boot), `kill_timeout: 8000` (>5s graceful drain) |
| 5 | Nginx reverse-proxy config exists, security-headered | READY | `deploy/nginx-jarvis.conf` (183 lines) — CSP/HSTS/X-Frame-Options set, SSE route (`/runtime/stream`) correctly unbuffered, webhook routes exempted from rate limiting, full Express mount-path allowlist (not filename-based) |
| 6 | Health endpoint exists and is reachable pre-auth | READY, MINOR GAP | `GET /health` (`backend/routes/ops.js:18`) — intentionally unauthenticated, used by PM2/nginx/monitoring. **Gap (pre-existing, previously flagged, re-confirmed this mission, not fixed — out of this read-only mission's scope):** line 53's `require("../../agents/metrics/metricsCollector.cjs")` targets an archived file; the `try/catch` masks this gracefully (no crash), but it is dead code inside a production-relevant endpoint. Does not block deployment. |
| 7 | Rollback procedure exists for both code and data | READY | `deploy/rollback.sh` (217 lines) — `--list`, `--code <ref>`, and default data-restore modes; auto-detects `backup.sh` vs `safe-backup.cjs` archive layout (a real, documented, previously-drilled fix — see script's own inline history, "Phase B.5"); always snapshots current `data/` before restoring, and always backs up `.env` first |
| 8 | Health-check/auto-recovery cron pattern exists | READY | `deploy/healthcheck.sh` (30 lines) — designed for `*/5 * * * *` cron, restarts PM2 on failure, logs recovery outcome |
| 9 | Monitoring dashboard script exists | READY | `deploy/monitor.sh` (217 lines) — PM2 status, `--live`, `--errors`, `--crm` modes |
| 10 | Update/redeploy script exists, with documented downtime | READY, KNOWN LIMITATION | `deploy/update.sh` — pulls, installs, rebuilds frontend, `pm2 reload`; **not zero-downtime by design** (fork mode has no second instance to shift traffic to; the script's own comment cites a measured ~5.6s outage, 56/200 health probes failed during a real reload drill) |
| 11 | 30-point production validator exists | READY | `deploy/validate-production.sh` (381 lines) — checks env/server/auth/routes/PM2/nginx/SSL/`.env` file permissions (expects `600`) |
| 12 | Real VPS target/credentials available in this session | **NOT AVAILABLE** | See determination above |
| 13 | Domain registered and DNS controllable | **UNKNOWN — requires founder input** | No domain name appears anywhere in this repo's config as a live value; `nginx-jarvis.conf`/`https-setup.sh` both use `yourdomain.com` as a placeholder pending substitution |
| 14 | Production `.env` populated with real secrets | **NOT DONE** | Confirmed by Mission 94's env-presence inventory: `.env` exists locally with dev/placeholder-shaped values for some keys; no evidence any of them are production-grade, rotated secrets intended for a public host |

## B. Exact Commands Required on a Fresh VPS (Ubuntu 22.04/24.04)

In the exact sequence the scripts themselves expect, unmodified from what already exists in `deploy/`:

```bash
# 1. One-time host bootstrap (as root) — installs Node 20, PM2, nginx, ufw,
#    certbot, creates the 'jarvis' app user, clones the repo, installs deps,
#    configures the firewall, installs (but does not yet enable HTTPS on) nginx.
sudo bash deploy/setup-vps.sh
#    (or the documented curl-pipe form — same script, same effect)

# 2. Manual: edit the real production .env (see §E for the exact variable
#    names required; values are never handled by any automated step here)
sudo -u jarvis nano /opt/jarvis-os/.env

# 3. Manual: point the domain's DNS A record at the VPS's public IP
#    (external action — see §D)

# 4. Obtain and install the TLS certificate, once DNS has propagated
sudo bash deploy/https-setup.sh yourdomain.com

# 5. Start the application under PM2 (builds the frontend if not already built,
#    runs the JWT_SECRET/OPERATOR_PASSWORD_HASH/BASE_URL pre-flight gate,
#    waits up to 40s for a real /health 200 before declaring success)
bash deploy/start-production.sh

# 6. Persist the PM2 process list across reboots (setup-vps.sh already ran
#    `pm2 startup`; this final `pm2 save` is what start-production.sh itself
#    already performs — listed here only for completeness, not a separate step)

# 7. Install log rotation (P1 backlog item, not yet done anywhere — confirmed
#    absent by Mission 91; a single command, safe to run any time after step 1)
pm2 install pm2-logrotate

# 8. Optional but recommended: register the health-check cron for auto-recovery
( crontab -l 2>/dev/null; echo "*/5 * * * * /opt/jarvis-os/deploy/healthcheck.sh >> /opt/jarvis-os/logs/healthcheck.log 2>&1" ) | crontab -

# 9. Run the 30-point production validator to confirm the above landed correctly
bash deploy/validate-production.sh
```

**None of the above was executed by this mission.** They are transcribed exactly as they exist in the scripts today (verified by direct read, not from memory or documentation), for use once a real target is available.

## C. Required Manual Inputs (founder-provided, not automatable)

1. A provisioned VPS (IP address, root or sudo SSH access). **Not available in this session.**
2. A registered domain name to replace every `yourdomain.com` placeholder in `deploy/nginx-jarvis.conf` (the file is edited in-place by `https-setup.sh` via `sed`, not manually, once the domain is supplied as its argument).
3. Every credential value listed in §E — none can be generated or guessed; each is either a real third-party API key/secret or a locally-generated cryptographic secret (commands given below for the two that can be generated locally).
4. A decision on which optional connectors are in scope for first launch (Stripe/Razorpay live keys, WhatsApp Business API, Telegram bot, email provider, Sentry DSN, offsite backup target) — per Mission 91's own open decision items, not re-litigated here.
5. Explicit authorization to run step 1 of §B against the real host, and separately, explicit authorization for each subsequent step — per this mission's own instruction not to execute anything without an established gate.

## D. Required DNS/TLS Inputs

- **A record**: `yourdomain.com` → VPS public IPv4 (and `www.yourdomain.com` if the nginx config's `server_name` line, which lists both, is to be honored for both).
- DNS propagation must complete **before** running `https-setup.sh` — the script itself checks `dig +short $DOMAIN` against the server's own detected public IP (`curl https://api.ipify.org`, falling back to `hostname -I`) and **aborts** (`die`) on a mismatch, specifically to avoid Let's Encrypt rate-limit exhaustion from repeated failed attempts.
- Certbot's `--non-interactive --agree-tos --email admin@$DOMAIN` — note this hardcodes `admin@$DOMAIN` as the registration email rather than taking a founder-supplied address; acceptable for cert issuance/expiry notices but worth the founder knowing before running it unattended.
- Auto-renewal: the script checks for `certbot.timer` (Ubuntu 22+'s systemd default) and only falls back to installing a manual cron line if that timer is absent — no redundant renewal job will be created if the timer already exists.
- Post-TLS manual step named by the script itself: set the real webhook URLs at the provider dashboards — `https://$DOMAIN/webhook/razorpay` and `https://$DOMAIN/whatsapp/webhook` — this is an external-provider-console action, not something any script here performs.

## E. Required Production Environment Variables (names only — cross-referenced against Mission 94's presence inventory and `scripts/check-startup-env.cjs`'s own gate, not re-stated as new discovery)

**Hard-blocking (server will not start / start-production.sh will `die`):**
- `JWT_SECRET`
- `OPERATOR_PASSWORD_HASH`
- `BASE_URL` (must be a real `https://` domain, not `localhost` or the literal placeholder)
- `GROQ_API_KEY` — confirmed by `scripts/check-startup-env.cjs`'s own `REQUIRED_ALWAYS` list (line ~36 onward), which `npm start` runs before `backend/server.js` even loads. This is a stricter, code-verified requirement beyond what `start-production.sh` alone checks — both gates must be satisfied.

**Warned-but-not-blocking (server starts, feature degrades honestly):**
- `RAZORPAY_WEBHOOK_SECRET` — payment webhooks rejected without it
- `WA_TOKEN` (or `WHATSAPP_TOKEN`) — WhatsApp messaging disabled without it
- `TELEGRAM_TOKEN` — Telegram bot disabled without it

**Recommended (per `envManager.cjs`'s own catalog, degrades honestly if absent):**
- `SENTRY_DSN`, `RESEND_API_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `PRODUCT_NAME`

**Conditionally required by feature scope (only if that feature is in the launch set — not required to boot):**
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` (if Stripe is in scope instead of/alongside Razorpay)
- `BACKUP_PASSWORD` / `BACKUP_OFFSITE_DIR` (offsite backup honestly no-ops without these — confirmed, not fixed, in Mission 94's inventory)
- `SMTP_HOST`+`SMTP_USER`+`SMTP_PASS` or `SENDGRID_API_KEY` or `RESEND_API_KEY` (at least one, for the email-readiness check now correctly wired per Mission 94)
- `ALLOWED_ORIGINS` — should be validated to contain the real production origin before go-live (value not inspected here, per credential-safety rules)

**Two secrets that can be generated locally (no external provider), commands as documented in the scripts themselves:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # JWT_SECRET
node scripts/generate-password-hash.cjs <yourpassword>                     # OPERATOR_PASSWORD_HASH (and can also output a JWT_SECRET)
```
No value was generated or written by this mission — commands are reproduced for the founder's own use.

## F. Deployment Sequence (first-time, fresh host)

1. Provision VPS, obtain root/sudo SSH access. *(blocked — not available this session)*
2. `sudo bash deploy/setup-vps.sh` — system packages, Node 20, PM2, nginx, ufw, app user, repo clone, `npm install --omit=dev`, firewall (22/80/443 only — 5050 never exposed externally), nginx install (HTTP-only until step 4).
3. Populate `/opt/jarvis-os/.env` with real production values (§E) — manual, off-script.
4. Point DNS A record at the VPS IP; wait for propagation.
5. `sudo bash deploy/https-setup.sh yourdomain.com` — verifies DNS, patches nginx domain, obtains Let's Encrypt cert, reloads nginx, verifies HTTPS reachability, updates `.env`'s `BASE_URL` if it doesn't already match, sets up renewal.
6. `bash deploy/start-production.sh` — pre-flight gate, optional frontend build, clears any stale startup-crash marker, `pm2 start ecosystem.config.cjs --env production`, `pm2 save`, polls `/health` for up to 40s.
7. `pm2 install pm2-logrotate` — closes the one confirmed-open P1 infra gap (Mission 91).
8. Register the `healthcheck.sh` cron (§B step 8).
9. `bash deploy/validate-production.sh` — final 30-point confirmation.
10. Set live webhook URLs at Razorpay/Meta dashboards (external, manual).

## G. Rollback Sequence

**Code rollback** (if a bad deploy needs reverting):
```bash
bash deploy/rollback.sh --list                 # see recent commits + available data backups
bash deploy/rollback.sh --code <commit-or-ref> # backs up .env, stops PM2, git checkout,
                                                # npm install, restarts, polls /health for 15s
```

**Data rollback** (if a bad data mutation needs reverting):
```bash
bash deploy/rollback.sh --list                 # see available jarvis_*.tar.gz backups
bash deploy/rollback.sh [FILE.tar.gz]           # defaults to newest; backs up .env,
                                                 # snapshots CURRENT data/ as a safety net first,
                                                 # auto-detects backup.sh vs safe-backup.cjs archive
                                                 # layout (previously a real, drilled bug — see script
                                                 # comment referencing "Phase B.5"), restores, verifies
```

Both paths always take a safety-net backup of current state before overwriting anything, and both poll the real `/health` endpoint (not just process-exists) before declaring success.

## H. Health Verification Sequence

1. `curl -sf http://localhost:5050/health` (or `https://$DOMAIN/health` externally) — expects `status: "ok"` (or `"degraded"` if ≥2 of `{ai, telegram, whatsapp, payments}` are unconfigured — this is a documented, intentional distinction, not a bug).
2. `pm2 status jarvis-os` — expects `online`, low `restart_time`.
3. `bash deploy/monitor.sh` — full snapshot (PM2 + memory + errors + CRM + webhook stats).
4. `bash deploy/validate-production.sh` — the 30-point check, including `.env` file permission (`600`) and `NODE_ENV=production`.
5. Certificate check: `certbot certificates` (confirms expiry date, auto-renew status).
6. Nginx: `nginx -t` (config syntax) — **note:** per Mission 91's own findings, `nginx -t` has never been run against a real nginx install in any environment this mission chain has touched; this remains true after this mission (no real nginx exists here to test against).

## I. Security Checks (pre-go-live, derived from existing scripts/docs, not newly invented here)

- `.env` file permission must be `600` (`validate-production.sh` checks this explicitly).
- `ALLOW_DEV_AUTH_BYPASS` must be **absent** in production (confirmed absent in the current local `.env` per Mission 94's inventory — must remain so on the real production host).
- `JWT_SECRET` must not contain `"your"`/`"change"` and must be ≥32 characters (`start-production.sh`'s own weak-secret warning).
- `BASE_URL` must be `https://`-prefixed (Razorpay webhook requirement, per the script's own warning).
- Port 5050 must never be opened externally — `setup-vps.sh`'s `ufw` rules only open 22/80/443; nginx is the sole public-facing proxy.
- Firewall default-deny-incoming, default-allow-outgoing (confirmed in `setup-vps.sh`).
- CSP/HSTS/X-Frame-Options/Referrer-Policy security headers already present in `nginx-jarvis.conf` — no changes needed unless the founder wants to loosen/tighten the CSP allowlist for a different set of third-party scripts.
- `pm2 install pm2-logrotate` before go-live — the one confirmed-open infra gap with a single-command fix (Mission 91/94's inventory both name this).

## J. Blockers / Dependencies

| Blocker | Type | Owner | Notes |
|---|---|---|---|
| No real VPS target/access in this session | HARD BLOCKER | Founder | Must provision a host and hand off access, or run §B's commands manually |
| No real domain configured anywhere in this repo's live config | HARD BLOCKER (for TLS step) | Founder | `yourdomain.com` remains a placeholder in `nginx-jarvis.conf` |
| Production-grade `.env` values (§E) not confirmed to exist anywhere outside this local dev `.env` | HARD BLOCKER | Founder | Mission 94's inventory found local `.env` has some values present but no evidence of production-intended rotation |
| Launch-scope decision (which connectors ship day one) | DECISION, not code | Founder | Per Mission 91 — unchanged since |
| `pm2-logrotate` not yet installed anywhere real | MANUAL, non-blocking | Ops | One command, run any time post-setup |
| `/health`'s dead `metricsCollector.cjs` require | COSMETIC, non-blocking | — | Try/catch-masked, does not affect deployment |

## K. Can the Real VPS Rehearsal Begin Immediately?

**No.** This session has no real VPS target, no real domain, and no evidence of production-grade credential values. Nothing in §B was executed. The moment a real host and domain are available and explicitly authorized, §B's 9 steps can be run in sequence exactly as transcribed, with §H used to verify each stage and §G available if any step needs reverting.

---

## Final State Confirmation

```
git status --short
```
```
 M agents/runtime/agentRegistry.cjs
 M backend/services/approvalEngine.cjs
 M backend/services/missionMemory.cjs
 M backend/services/toolExecutionLayer.cjs
?? reports/AGENT-ARMY-COMPLETE-CENSUS.md
?? reports/MISSION-90-PHASE-3-ISOLATION-CERTIFICATION.md
?? reports/MISSION-91-PRODUCTION-DEPLOYMENT-GATE.md
?? reports/MISSION-92-FULL-TECHNICAL-TEST-CORPUS-CERTIFICATION.md
?? reports/MISSION-93-PRODUCTION-READINESS-REMEDIATION-GATE.md
?? reports/MISSION-94-EMAIL-READINESS-ENV-DRIFT.md
?? reports/MISSION-95-VPS-PREFLIGHT.md
?? reports/PRODUCTION-ENV-PRESENCE-INVENTORY.md
?? tests/runtime/agent-identity-phase2.test.cjs
?? tests/runtime/approval-engine-evaluation-gate.test.cjs
?? tests/runtime/mission-memory-credential-redaction.test.cjs
?? tests/runtime/tool-execution-agent-identity.test.cjs
```
(The four `M` files and four untracked `tests/runtime/*` files belong to the concurrent session named in this mission's own instructions — **not created, read in depth, or modified by this mission**. Only `reports/MISSION-95-VPS-PREFLIGHT.md` was added by this mission.)

**HEAD:** `41867c0e9439e96ef2f89295910e5e8c42888d37` — unchanged, matches the certified baseline stated in this mission's instructions.

**P1-1 verification:**
```
git diff 7c229a52 HEAD -- backend/services/agentRuntimeSupervisor.cjs | grep -c "^@@"
→ 10
```

**Confirmation: `agents/runtime/agentRegistry.cjs`, `backend/services/missionMemory.cjs`, `backend/services/toolExecutionLayer.cjs`, and `reports/AGENT-ARMY-COMPLETE-CENSUS.md` were not touched by this mission** — their presence in `git status` reflects the concurrent session's own ongoing work, not this mission's actions.

**Confirmation: no secret or runtime-data value was read, modified, or exposed.** `.env` was not opened for read in this mission (its required-variable *names* were cross-referenced from Mission 94's own prior inventory and from the scripts'/`check-startup-env.cjs`'s own source code, not from a fresh read of `.env`'s contents). No `data/` file was modified. No SSH key material was read — only the non-secret `~/.ssh/config` host-alias metadata was viewed to answer the "is a real VPS available" question, and it was found to be the unmodified placeholder example. No external network call was made to any VPS, DNS provider, or certificate authority.

**STOP.**
