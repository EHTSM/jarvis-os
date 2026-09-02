# MISSION 80 — VPS DEPLOYMENT DECISION CLOSURE

**Date:** 2026-09-02
**Branch:** `security/reality-completion`
**Predecessor:** `reports/MISSION-79-VPS-DEPLOYMENT-PREFLIGHT.md` (READY WITH MANUAL CONFIGURATION)

> **THIS MISSION DID NOT DEPLOY ANYTHING.** No SSH session was opened, no VPS/DNS/TLS/Nginx/PM2 was touched or activated, no credential was provisioned, no real provider call was made, no production DB was modified, no external communication was sent, and nothing was committed or pushed. Two narrow code/template fixes were made (§"Changes Made") — both are local file edits, not deployment actions.

---

## Executive Verdict

Of Mission 79's 5 decisions, **1 was closed by direct repository evidence** (the Nginx default-path question — `setup-vps.sh` already unambiguously installs the generic single-domain config; `nginx-multisite.conf` is an unreferenced, dormant alternative, not a competing default). **4 genuinely require owner/business input and are not guessed here** (RPO, RTO, which optional integrations launch, cloud storage vs. local disk) — per this mission's explicit "no guessing" rule.

One real, narrow security defect was found and fixed: `WA_VERIFY_TOKEN`'s insecure template default was reachable through **two** independent code paths, not one — the `.env.example` placeholder Mission 79 already flagged, and a second, previously-undiscovered hardcoded fallback (`"ooplix_verify"`) live inside `backend/routes/settings.js`'s in-app WhatsApp settings-save route. Both are fixed narrowly (fail-closed instead of fail-open-with-a-known-value) and covered by a new regression test (9/9 passing).

The backup-entrypoint "ambiguity" is not actually an ambiguity — `backup.sh` and `scripts/safe-backup.cjs` serve two distinct, legitimate triggers (pre-update snapshot vs. scheduled hardened backup) and both are correctly wired to their respective callers. Documented explicitly below, nothing changed.

The `COOKIE_DOMAIN`/`DISABLE_X_POWERED_BY`/`ENABLE_CSP` toggles are confirmed to be **(C) intentionally-superseded legacy checklist code** — `server.js` already unconditionally implements the real behavior these variables were meant to gate; the audit-checklist module simply hasn't been updated to recognize that. Not a security defect (fails toward more security, not less), not touched, documented as a P3 informational item exactly as Mission 79 left it.

**FINAL VPS STATUS: READY WITH MANUAL CONFIGURATION.**

---

## Mission 79 Findings Revalidated

Every item below was re-inspected directly against the actual files (not re-derived from the Mission 79 report text alone), per this mission's Step 2 instruction.

- **5 decisions required** (Mission 79 §24): Nginx topology; RPO; RTO; which optional integrations launch; cloud storage vs. local disk. Confirmed unchanged — re-read `deploy/setup-vps.sh`, `deploy/nginx-jarvis.conf`, `deploy/nginx-multisite.conf` directly.
- **20 manual actions** (Mission 79 §21): confirmed present, reconciled below in §"Manual Action Reconciliation" — count unchanged, no items invented or dropped.
- **2 hard environment requirements**: `JWT_SECRET`, `OPERATOR_PASSWORD_HASH` — re-confirmed directly in `backend/middleware/authMiddleware.js` (throws if `JWT_SECRET` unset) and `deploy/start-production.sh` (`die`s on either missing). `BASE_URL` remains a near-hard requirement (§"BASE_URL Findings" below) — re-verified against `deploy/start-production.sh` lines 25, 45-47.
- **Hard infrastructure requirements**: VPS, domain, DNS access, TLS-via-certbot — confirmed unchanged, no new infrastructure requirement discovered.
- **Optional configuration**: confirmed unchanged — the ~85 provider-specific credential set in Mission 79 §22 was not re-enumerated line-by-line here (out of this mission's scope, which is decision closure, not a re-audit), but the two hard-required/near-hard-required vars and the security-relevant defaults were re-verified.
- **Credential requirements**: unchanged — 2 hard + ~85 optional.
- **Deployment order**: Phases A–O (Mission 79 §17) re-read and confirmed internally consistent with the actual scripts (`setup-vps.sh`, `start-production.sh`, `https-setup.sh`) — no reordering needed.
- **Nginx ambiguity**: confirmed real (two configs exist, only one is wired into any script) — closed below in §"Nginx Decision."
- **Backup ambiguity**: confirmed real as a *naming* ambiguity, not a functional defect — closed below in §"Backup Entrypoint Decision."
- **Webhook security issue**: confirmed and found to be *worse* than Mission 79 reported — a second live code path carried the same defect class. Fixed below.
- **Rollback path**: `deploy/rollback.sh` re-read at the operations level (destructive extraction confined to a temp directory, `rm -rf "${_RTMP}"` only) — confirmed safe-by-design, unchanged, not modified.

---

## Decision Register

### DECISION-1 — Nginx Topology

- **QUESTION:** Should this VPS deployment use the generic single-domain config (`nginx-jarvis.conf`) or the `ooplix.com`-hardcoded 3-vhost split (`nginx-multisite.conf`)?
- **CURRENT OPTIONS:** (a) single-domain, generic placeholders, installed by `setup-vps.sh` today; (b) 3-vhost split, hardcoded to the real `ooplix.com` domain family, live (uncommented) certificate paths, but referenced by **zero** scripts anywhere in the repo.
- **REPOSITORY EVIDENCE:** `deploy/setup-vps.sh:97-98` unconditionally does `cp "$APP_DIR/deploy/nginx-jarvis.conf" /etc/nginx/sites-available/jarvis` — confirmed by direct read of the full script this mission. No script (`setup-vps.sh`, `https-setup.sh`, `update.sh`, `start-production.sh`, `validate-production.sh`, `rollback.sh`) references `nginx-multisite.conf` anywhere — confirmed via `grep -rn "nginx-multisite" deploy/ package.json`. `nginx-multisite.conf` is real, complete, and not stale (its cert paths, upstream, and SSE tuning all match the current codebase), but it is a **dormant, unreferenced artifact** — no automation path currently activates it.
- **RECOMMENDED OPTION:** (a) single-domain (`nginx-jarvis.conf`) is the **de facto current default** — this half of the decision is not actually ambiguous and required no guess: it is what the existing, unmodified tooling does today. Whether to ever switch to the multisite topology (and update `setup-vps.sh` to install it instead) remains a genuine product/business decision this mission does not make on the operator's behalf, since it depends on facts no code inspection can supply (is `ooplix.com` definitely the launch domain? is a split API subdomain wanted for this launch?).
- **WHY:** A default that already exists, is exercised by every dry-read of `setup-vps.sh`, and has never been wired to the alternative file is not an open technical question — it is the currently-shipping behavior. The *remaining* open question (should the default ever change) is a business call about the intended domain architecture, not something `grep` can resolve.
- **IMPACT:** No code change needed to close the "which does the script currently do" half of this question — it already does (a) unambiguously. If (b) is later chosen, `deploy/setup-vps.sh` line 97 must be changed to copy `nginx-multisite.conf` instead, and `deploy/https-setup.sh`'s single `-d "$DOMAIN"` certbot invocation (line ~54) must be replaced with the 4-SAN form Mission 79 §10 already documented.
- **FILES AFFECTED (if (b) is ever chosen):** `deploy/setup-vps.sh`, `deploy/https-setup.sh`.
- **MANUAL VPS IMPACT:** None from this mission — nothing was activated. An operator choosing (b) later must manually edit `setup-vps.sh` before running it, or manually copy `nginx-multisite.conf` into place themselves.
- **SECURITY IMPACT:** None either way — both configs carry equivalent security headers, rate limiting, and TLS handling; the choice is purely architectural (single vs. split-domain), not a hardening difference.
- **ROLLBACK:** Trivial — swapping which file is copied is a one-line script edit, reversible by re-editing the same line; no data or running state is involved until `setup-vps.sh` is actually executed on a VPS (which this mission did not do).

**Status: TECHNICAL HALF CLOSED (default confirmed = single-domain). Business half remains DECISION REQUIRED (see §"Remaining Blockers").**

### DECISION-2 — RPO (Recovery Point Objective)

- **QUESTION:** What is the maximum acceptable data loss window if the VPS fails?
- **CURRENT OPTIONS:** No numeric candidates exist anywhere in the repository to choose between.
- **REPOSITORY EVIDENCE:** The backup schedule (`cron_restart: "0 2 * * *"`, daily 02:00) implies a *default* RPO ceiling of ~24 hours if nothing else is configured, but no file anywhere states this as an intended target — it is an artifact of the current cron expression, not a declared SLA.
- **RECOMMENDED OPTION:** None offered — inventing a target from the cron interval alone would misrepresent an operational artifact as a business decision. Per the mission's explicit instruction, this is **not fabricated**.
- **WHY:** RPO is a business-risk tolerance decision (how much re-entered/lost data is acceptable), not something derivable from reading code.
- **IMPACT:** If the eventual decision is "24h is too coarse," the cron expression must change and/or a secondary intra-day backup mechanism must be added.
- **FILES AFFECTED:** `ecosystem.config.cjs` (`cron_restart` value), potentially `scripts/safe-backup.cjs` if a different backup shape is chosen.
- **MANUAL VPS IMPACT:** N/A until decided.
- **SECURITY IMPACT:** None directly (data-loss risk, not confidentiality/integrity risk).
- **ROLLBACK:** N/A.

**Status: DECISION REQUIRED — not guessed.**

### DECISION-3 — RTO (Recovery Time Objective)

- **QUESTION:** What is the maximum acceptable downtime to restore service after a VPS failure?
- **CURRENT OPTIONS:** No numeric candidates exist anywhere in the repository.
- **REPOSITORY EVIDENCE:** `deploy/rollback.sh` exists and is a real, working restore path (audited/fixed in Mission 77), but no file states how long a full restore is expected to take, nor an acceptable ceiling.
- **RECOMMENDED OPTION:** None offered.
- **WHY:** Same as RTO's sibling — this is a business continuity decision, not a code fact.
- **IMPACT:** A tight RTO target might require a documented, timed rollback drill before launch (not performed by this mission — would require executing `rollback.sh` against real data, explicitly out of scope).
- **FILES AFFECTED:** None until decided.
- **MANUAL VPS IMPACT:** N/A.
- **SECURITY IMPACT:** None directly.
- **ROLLBACK:** N/A.

**Status: DECISION REQUIRED — not guessed.**

### DECISION-4 — Which Optional Integrations Launch

- **QUESTION:** Of the ~85 provider-specific credentials cataloged in Mission 79 §22 (payments processor choice, email provider choice, which social platforms, etc.), which are actually enabled at initial launch vs. deferred?
- **CURRENT OPTIONS:** Every provider-specific integration in the repo is independently optional and independently gateable (confirmed: each degrades to "not configured" without crashing the app, per Mission 79 §5.3, re-verified unchanged this mission).
- **REPOSITORY EVIDENCE:** No file in the repository declares a launch scope — this is inherently a product decision about which features the business wants live on day one.
- **RECOMMENDED OPTION:** None offered — the two hard-required variables (`JWT_SECRET`, `OPERATOR_PASSWORD_HASH`) plus `BASE_URL` are launch-blocking regardless of feature scope; everything else is genuinely a scope choice with no technical reason to force early.
- **WHY:** Mission 79 already established none of these integrations are code-blocking; forcing a choice here would be scope invention, not decision closure.
- **IMPACT:** Determines which rows of the Manual Action Register (§21 in Mission 79, reconciled below) are actually "before deploy" vs. "deferred indefinitely."
- **FILES AFFECTED:** None — this is purely a `.env` population decision the operator makes, not a code change.
- **MANUAL VPS IMPACT:** Determines which OAuth apps/API keys must be obtained before go-live.
- **SECURITY IMPACT:** Each unconfigured optional integration is strictly safer (smaller attack surface) than a configured-but-misconfigured one — deferring is never a security regression.
- **ROLLBACK:** N/A — enabling an integration later is additive, not a rollback concern.

**Status: DECISION REQUIRED — not guessed.**

### DECISION-5 — Cloud Storage vs. Local Disk

- **QUESTION:** Provision Cloudflare R2/AWS S3 before launch, or rely on the local-disk fallback?
- **CURRENT OPTIONS:** (a) provision R2 or S3 now; (b) launch on local disk, add cloud storage later.
- **REPOSITORY EVIDENCE:** `backend/services/storageService.cjs`'s priority order (R2 → S3 → local) is unchanged from Mission 79 — re-confirmed via direct grep this mission (`R2_ACCESS_KEY_ID` checked before `AWS_ACCESS_KEY_ID`). Local-disk fallback is a real, working code path, not a degraded stub.
- **RECOMMENDED OPTION:** (b) is technically safe to start with (confirmed: no crash, no missing-feature 500s, just files land on local disk instead of cloud), but the choice has real operational consequences (disk fills up over time without off-VPS storage, no CDN-backed delivery) that are a capacity/product-planning decision, not a code fact.
- **WHY:** Same reasoning as DECISION-4 — the code supports both, so this is a business/ops planning choice, not a technical blocker.
- **IMPACT:** If (b), monitor VPS disk usage over time (already covered by `deploy/validate-production.sh`'s "disk usage <80%" check).
- **FILES AFFECTED:** None from this mission.
- **MANUAL VPS IMPACT:** If (a), R2/S3 bucket + IAM credentials must be provisioned before launch (Mission 79 §21 item 14).
- **SECURITY IMPACT:** Local disk means backups/exports/uploads are one-VPS-failure-away from being unrecoverable if not otherwise backed up — already covered by the backup pipeline decision (BACKUP_OFFSITE_DIR), not a new gap.
- **ROLLBACK:** Switching from local to cloud storage later requires migrating any already-written local files — not automated anywhere in this repo; would be a future manual migration task if this path is chosen.

**Status: DECISION REQUIRED — not guessed.**

---

## Nginx Decision

(Full detail in DECISION-1 above.) Direct inspection this mission of `deploy/setup-vps.sh` (full file re-read), `deploy/nginx-jarvis.conf`, and `deploy/nginx-multisite.conf` confirms:

- **Which config corresponds to the current intended production architecture:** `nginx-jarvis.conf` is what the deployment tooling *actually does* today — this is not ambiguous.
- **Whether the multisite config is authoritative:** No — it is unreferenced by any script. It reads as a previously-prepared alternative for a specific `ooplix.com` split-domain launch that was never wired into the automated setup path.
- **Whether the generic config is the intended template:** Yes, by virtue of being the one `setup-vps.sh` actually installs.
- **Whether either contains stale assumptions:** No new staleness found — both configs' upstream (`127.0.0.1:5050`), SSE tuning, and security headers match the current codebase exactly (re-verified, not assumed from Mission 79's report text).
- **Whether both can safely coexist:** Yes, as files on disk — they are never both active at once (Nginx uses whichever is in `sites-enabled`), and no script attempts to activate both simultaneously.
- **Whether `setup-vps.sh` must be adjusted:** Only if the business later decides on the multisite topology (DECISION-1's business half) — not adjusted by this mission, since that would be scope invention, not decision closure, absent that business input.

No code/documentation fix was required to remove the *technical* ambiguity — it did not exist once the actual script was read; the only genuine ambiguity was always the business question of domain architecture, correctly left as DECISION REQUIRED.

---

## Backup Entrypoint Decision

Both `backup.sh` and `scripts/safe-backup.cjs` were read in full this mission.

| | `backup.sh` (643 bytes) | `scripts/safe-backup.cjs` (17.3 KB) |
|---|---|---|
| **Purpose** | Fast, minimal pre-update safety snapshot | Full hardened, verifiable production backup |
| **Invocation** | `npm run backup` (called by `deploy/update.sh` before every `git pull`) | PM2 `cron_restart: "0 2 * * *"` on the `ooplix-backup` app (`ecosystem.config.cjs`) |
| **Data coverage** | `data/` only, excluding `data/autonomous` and `data/futureTech` | `data/` plus explicitly enumerated `M6_STATE_FILES`, `CORE_BUSINESS_FILES` (including `fdios-state.json`, flagged "declared critical in rc1-manifest.json"), and `BUSINESS_OS_FILES` — broader, deliberately curated coverage |
| **Integrity verification** | None — a bare `tar -czf`, no hash, no manifest | SHA-256 per captured file, a JSON manifest (`archiveSha256`, per-file `{name, bytes, sha256}`), plus a separate `verifyManifest()` function that re-extracts and diffs against the manifest |
| **Retention** | Keeps the 14 most recent `jarvis_*.tar.gz` (`ls -t ... | tail -n +15 | xargs rm -f`) | Keeps N most recent `jarvis_full_*.tar.gz` (own retention logic, also removes orphaned manifests for pruned archives) |
| **Offsite export** | None | Yes — `BACKUP_OFFSITE_DIR`/`BACKUP_DEST`-driven, via the companion `scripts/export-offsite.cjs` |
| **Encryption** | None | Supported via `BACKUP_PASSWORD` (optional) |
| **Exit codes** | `set -e`, but the `tar` line itself has `|| true`, so a tar failure does not fail the script (a known, narrow gap in this specific minimal script) | Explicit `archiveOk`/`offsiteFailed` tracking, propagated as a real exit code (Mission 77 fix, re-confirmed present, not re-modified) |
| **Scheduler** | None built in — purely reactive, invoked by `update.sh` | PM2 `cron_restart`, i.e. genuinely scheduled |
| **Restore compatibility** | Its plain `tar.gz` of `data/` is restorable by a bare `tar -xzf` — no special tooling needed, but also no manifest to verify against | Restorable via `deploy/rollback.sh`, which understands the `snapshot_*` layout and manifest |

**Determination: both are authoritative for their own distinct purpose — this is not a legacy-vs-current split.** `backup.sh` is the lightweight **pre-deploy safety net** invoked automatically inside `deploy/update.sh` before any code update touches the filesystem (a quick "just in case the update goes wrong" snapshot). `scripts/safe-backup.cjs` is the **production disaster-recovery backup**, scheduled daily, hardened with manifests/hashing/offsite export per Mission 77's certification. Neither is dead code; neither should be deleted or silently replaced by the other — `update.sh`'s pre-flight snapshot doesn't need SHA-256 verification or offsite export (it's a same-host, same-moment safety net, consumed within minutes if at all), and the daily cron job needs exactly the rigor `safe-backup.cjs` provides for genuine DR coverage.

**No code change made.** The one real, narrow gap found (`backup.sh`'s `tar ... || true` masking a tar failure) is a pre-existing minor robustness gap in a low-stakes safety-net script, not a defect this mission's scope (WA_VERIFY_TOKEN + decision closure) covers — noted as a P3 item, not fixed, to avoid mission-scope creep per the explicit "do not expand this into another general security audit" instruction.

---

## WhatsApp Verify Token Security

**Trace performed, in full, this mission:**

1. **`.env.example`** (line 392, before fix): `WA_VERIFY_TOKEN=change_this_to_a_random_secret` — a real, non-blank, publicly-known string (this file is committed to the repository).
2. **Configuration loader**: no dedicated loader — `process.env.WA_VERIFY_TOKEN` is read directly wherever needed; `.env` values reach `process.env` via the standard `dotenv` load at process start.
3. **WhatsApp webhook verification**: `backend/routes/whatsapp.js:78-82` (`GET /whatsapp/webhook`) delegates to `backend/services/whatsappService.js:206-216`'s `verifyWebhook(query)`. This function's own fail-safe (`if (!verifyToken) { ...error...; return { valid: false }; }`) only triggers when the variable is **completely absent/empty** — it has no concept of "present but is a known public placeholder," because it cannot distinguish a real secret from the template string by inspection alone.
4. **Runtime comparison**: `query["hub.mode"] === "subscribe" && query["hub.verify_token"] === verifyToken` — a plain string equality check against whatever `WA_VERIFY_TOKEN` resolves to at the moment of the request.
5. **Documentation**: `backend/services/pcs2ExternalPlatforms.cjs:904` labels this variable `priority: "required"` in its own internal readiness catalog; `backend/services/co3UserSuccess.cjs:645` surfaces setup instructions to end users mentioning `WA_VERIFY_TOKEN` by name.
6. **A second, previously-undocumented live code path** (found by this mission, not by Mission 79): `backend/routes/settings.js:109` (before fix) — the in-app `POST /settings/whatsapp` route, which lets an authenticated operator configure WhatsApp credentials without SSH access, silently fell back to a **second hardcoded, guessable constant** (`"ooplix_verify"`) whenever the request body omitted `verifyToken` and none was already in `process.env`. This value was then **persisted to `data/settings.json` and hot-loaded into `process.env.WA_VERIFY_TOKEN`**, taking effect immediately with no server restart — meaning an operator using the in-app settings UI to configure WhatsApp (without separately, manually setting `WA_VERIFY_TOKEN` first) would silently end up with a second, equally-guessable public secret in production, with no error or warning surfaced anywhere.

**Determination: yes, the runtime could accidentally use an insecure placeholder — via two independent paths, not one.**

**Fix made (both narrow, both fail-closed):**

- `.env.example` line 392: default changed from the literal placeholder to blank (`WA_VERIFY_TOKEN=`), matching the convention used by every other secret-shaped variable in the file (e.g. `RAZORPAY_WEBHOOK_SECRET=`). An operator who forgets to set this now gets the code's **existing, already-correct** fail-safe (`verifyWebhook()` rejects and logs an error) instead of a working public secret. A comment explaining why was added.
- `backend/routes/settings.js`: the `POST /settings/whatsapp` route now computes `resolvedVerifyToken` from the request body or an already-set `process.env.WA_VERIFY_TOKEN` only — if neither yields a real value, the request is rejected with `400` and an explicit message ("verifyToken is required — set a real random value..."), rather than silently choosing `"ooplix_verify"` on the operator's behalf.

**Acceptable behavior achieved:** MISSING/INVALID SECRET → configuration failure (400 on the settings route; `{valid: false}` + logged error on the webhook itself). **Not:** MISSING SECRET → known public placeholder — confirmed by the new regression test (`tests/security/163-wa-verify-token-insecure-fallback.cjs`, 9/9 passing).

No real production secret was generated, printed, or guessed at any point.

---

## Template Secret Safety

Focused scan performed across `.env.example` (full file, 594 lines post-edit), `deploy/*.sh`, `ecosystem.config.cjs`, `Dockerfile.production`, and `backend/routes/settings.js`'s in-app credential-save routes (the one place besides `.env.example` where a "default if not supplied" pattern could exist) — specifically for known public placeholders, weak default passwords, predictable tokens, example keys/JWT secrets/webhook tokens/encryption keys that could become real runtime credentials.

**Findings:**

- `WA_VERIFY_TOKEN` — the one dangerous default found; fixed above (both the template and the in-app fallback).
- Every other secret-shaped variable in `.env.example` (`JWT_SECRET`, `OPERATOR_PASSWORD_HASH`, all AI provider keys, all OAuth client secrets, `RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET`, all email provider keys, `BACKUP_PASSWORD`, storage credentials, `SENTRY_AUTH_TOKEN`, etc.) — confirmed via `grep -nE "^[A-Z_]+_(SECRET|TOKEN|KEY|PASSWORD|PASS)=.+" .env.example` to have **zero** non-blank literal defaults. Every one is either blank or a genuinely non-secret configuration value (a model name, a region string, a timeout in ms, `WA_API_VERSION=v19.0`, etc.) — confirmed by cross-referencing the grep output against Mission 79's own full variable trace, re-verified directly this mission.
- `backend/routes/settings.js`'s Razorpay save route (`POST /settings/razorpay`) was checked for the same fallback-to-guessable-constant pattern found in the WhatsApp route — confirmed **no such pattern exists there**: `webhookSecret: (webhookSecret || "").trim()` correctly defaults to blank, not a guessable string, and `keyId`/`keySecret` are both hard-required by an earlier `if (!keyId || !keySecret)` 400 check in the same route. The WhatsApp route's `"ooplix_verify"` fallback was a one-off anomaly, not a repeated pattern across this file.
- `deploy/*.sh` scripts: no hardcoded example API keys, JWT secrets, or passwords found in any script — all scripts either read from `.env` at runtime or `die`/`warn` on missing values (confirmed by re-reading `start-production.sh`'s validation block and `setup-vps.sh` in full this mission).
- `ecosystem.config.cjs`: no secrets present — only non-secret operational config (ports, memory limits, restart policy), consistent with the values already documented in Mission 79.
- No Docker example/sample config files with embedded credentials were found (`Dockerfile.production` was checked — it copies application code and sets non-secret build args only, no embedded credential defaults).

**No broad new security audit was performed** — this scan was scoped exactly to "template default capable of becoming a real runtime credential," per the mission's explicit instruction, and found exactly one class of defect (already fixed above), with no second instance discovered elsewhere.

---

## Security Toggle Findings

`COOKIE_DOMAIN`, `DISABLE_X_POWERED_BY`, `ENABLE_CSP` — re-inspected directly this mission (`backend/services/securityHardeningLayer.cjs` lines 95-96, 110, 205, 305; `backend/server.js` lines 95, 100-133; `backend/routes/auth.js`'s `COOKIE_OPTS` object).

**Classification: (C) intentionally-unused legacy config — specifically, checklist code whose gated behavior was later implemented unconditionally elsewhere, making the gate itself redundant rather than broken.**

Evidence for this classification over the alternatives:
- **Not (A) documentation drift** — there is no user-facing documentation claiming these variables do something; the only place they're referenced is the audit-checklist module itself and its own self-consistent (if now-redundant) logic.
- **Not (B) incomplete implementation** — the behaviors these variables were meant to gate (disabling `x-powered-by`, setting a CSP header) are not *missing*; they are **already fully implemented, unconditionally**, directly in `backend/server.js` (line 95: `app.disable("x-powered-by")` runs regardless of any env var; lines 100-133: a full CSP header is set unconditionally). The checklist module's checks (`securityHardeningLayer.cjs:205,110`) simply weren't updated to recognize that the code moved past needing an opt-in flag — they still check for the flag's presence rather than the actual header's presence.
- **`COOKIE_DOMAIN` is the one partial exception**: `securityHardeningLayer.cjs:95-96` warns if unset, but `auth.js`'s real `COOKIE_OPTS` (confirmed via direct read: `httpOnly`, `secure`, `sameSite`, `maxAge`, `path` — no `domain` key) never reads it at all. This is not "redundant with a stronger unconditional default" the way the other two are — it's a checklist warning about a knob that doesn't exist yet. This is real, but it is a **feature gap** (no subdomain cookie-sharing capability exists), not a bug that makes anything less secure — cookies default to same-host scoping, which is the more restrictive, safer behavior, not a vulnerability.

**Action taken: none, per the mission's explicit "do not automatically implement them" instruction.** This is correctly a documentation-accuracy note, not a security defect, and not something requiring code changes to close. If subdomain cookie-sharing is ever needed for the chosen production topology (relevant if DECISION-1's multisite option is ever chosen — `app.ooplix.com`/`api.ooplix.com` sharing a session cookie would need `COOKIE_DOMAIN=.ooplix.com` support added to `COOKIE_OPTS`), that is a **separate, explicitly named future blocker**, not scope-crept into this mission.

---

## BASE_URL Findings

Re-traced this mission, cross-checked against Mission 79's §5.2/§7/§8/§10 findings — no new consumer found, no consumer disappeared.

- **Mandatory?** Functionally yes for a real production deployment — `deploy/start-production.sh` (lines 25, 45-47, re-read in full this mission) hard-`die`s if `BASE_URL` is unset, contains `localhost`, or contains `YOUR_DOMAIN`, and separately `warn`s (non-fatal) if it doesn't start with `https://`. The app itself does not crash at the Node process level without it, but the production start script — the actual, intended production entrypoint — will not proceed without it.
- **OAuth?** Yes — `oauthIntegrationLayer.cjs`'s redirect-URI construction pattern for all providers without an explicit `*_REDIRECT_URI` override is `{BASE_URL}/{provider}/oauth/callback` (Mission 79 §7, re-confirmed unchanged).
- **Webhooks?** Indirectly — the Razorpay webhook URL an operator registers in the Razorpay dashboard is `{BASE_URL}/business/webhook/payment` (documentation/registration concern, not a runtime `BASE_URL` read inside the webhook handler itself).
- **Email links?** Yes — `emailService.cjs` was confirmed (Mission 79 discovery) to use `BASE_URL` for links inside transactional emails (e.g. password reset).
- **Frontend?** Only indirectly, via the separate `REACT_APP_API_URL` build-time variable for the split-API-domain topology — the frontend itself does not read `BASE_URL` (that's a backend/server-side variable); confirmed no `BASE_URL` reference exists in `frontend/src/`.
- **Payment?** Yes, directly — `backend/routes/payment.js` (Stripe path, lines 114-116 per Mission 79's original trace) 500s on checkout creation without a valid public `BASE_URL`. Not independently re-verified line-by-line this mission per the standing instruction not to dig into the concurrent ERA-2/Stripe session's files.
- **External callbacks?** Yes — this is the common thread across OAuth, webhooks, and email: `BASE_URL` is the single source of truth for "what is this server's own public address," consumed wherever the app needs to tell an external party how to call back.

**Exact production value format (from direct script inspection, not invention):** `https://yourdomain.com` — no trailing slash (confirmed pattern from `deploy/start-production.sh`'s log line `"Public URL: ${BASE_URL}"` immediately followed by `"Health URL: ${BASE_URL}/health"`, which only produces a correct URL if `BASE_URL` itself has no trailing slash), must be a real registered domain (not `localhost`, not containing the literal string `YOUR_DOMAIN`), and should use the `https://` scheme (enforced as a warning, not a hard failure, in the current script — Razorpay specifically requires HTTPS for webhooks per the script's own comment). **No domain is hardcoded here** — this format description is derived entirely from `start-production.sh`'s own validation logic, not invented.

---

## Canonical Production Target

Every field below is either direct repository evidence or explicitly marked MANUAL CONFIGURATION — none is invented.

```
FRONTEND DOMAIN:        MANUAL CONFIGURATION (placeholder in nginx-jarvis.conf: yourdomain.com;
                         real value ooplix.com/www.ooplix.com/app.ooplix.com only if the
                         multisite topology is chosen per DECISION-1 — not activated)
API DOMAIN:              Same as frontend domain by default (single-origin, REACT_APP_API_URL
                         blank) — MANUAL CONFIGURATION only if a split api.<domain> is chosen
BACKEND PORT:            5050 (confirmed: backend/server.js default, ecosystem.config.cjs
                         env/env_production, both Nginx configs' upstream — all three agree)
FRONTEND SERVING MODEL:  Static build served by Nginx from a local directory
                         (/opt/jarvis-os/frontend/build per nginx-jarvis.conf, matching
                         setup-vps.sh's APP_DIR) — not served by the Node process itself
DATABASE:                better-sqlite3, local file data/jarvis.db, self-healing on first
                         boot, no connection string, no migration system
STORAGE:                 Cloudflare R2 (if configured) → AWS S3 (if configured) → local disk
                         fallback (storageService.cjs priority order) — MANUAL CONFIGURATION
                         for which tier per DECISION-5
PM2 PROCESSES:           jarvis-os (fork, 1 instance, backend/server.js, always-on) +
                         ooplix-backup (cron_restart "0 2 * * *", scripts/safe-backup.cjs) —
                         exactly 2, per ecosystem.config.cjs, re-read in full this mission
SCHEDULER:               node-cron (in-process, within jarvis-os) for application-level
                         scheduled tasks + PM2's own cron_restart for the backup job — no
                         separate scheduler process
WORKER:                  None — no separate worker process exists; the in-process taskQueue
                         singleton inside jarvis-os handles async work (not cluster-safe,
                         hence instances:1)
NGINX CONFIG:            deploy/nginx-jarvis.conf (the config setup-vps.sh actually installs
                         today — confirmed, not the multisite alternative, per DECISION-1)
TLS:                     Let's Encrypt via certbot, deploy/https-setup.sh, single-domain
                         -d form as currently scripted (matching nginx-jarvis.conf's single
                         server_name pair)
BACKUP ENTRYPOINT:       scripts/safe-backup.cjs (authoritative scheduled production backup,
                         via PM2 cron_restart) — backup.sh is a separate, legitimate
                         pre-update safety-net entrypoint (npm run backup, called by
                         deploy/update.sh), not the production DR backup
HEALTH:                  GET /health (backend/routes/ops.js, no auth) — confirmed unchanged
READINESS:               No separate /ready endpoint found distinct from /health; PM2's own
                         wait_ready (process.send("ready") post-listen) is the process-level
                         readiness signal — MANUAL CONFIGURATION note: if a distinct
                         app-level readiness probe (vs. liveness) is wanted, none currently
                         exists as a separate route
ROLLBACK:                bash deploy/rollback.sh (unchanged, not modified this mission;
                         DB-level migration rollback does not exist and is not invented —
                         documented as unsupported, same as Mission 79)
```

---

## Deployment Script Safety

Static/local inspection only — nothing executed against a VPS.

- **`setup-vps.sh`** (full re-read this mission): idempotent guards confirmed present (`if ! command -v node`, `if ! id "$APP_USER"`, `if [ -d "$APP_DIR/.git" ]` then pull else clone, `if [ ! -f "$APP_DIR/.env" ]`). Does not silently select the wrong environment (no `NODE_ENV` is set by this script at all — that's `ecosystem.config.cjs`'s `--env production` flag's job, invoked separately by `start-production.sh`). Does not expose secrets (no credential is echoed, printed, or logged anywhere in this script). One real, previously-noted-by-Mission-79 non-idempotency: `ufw --force reset` runs unconditionally on every invocation, which would wipe any manually-added firewall rules on a re-run — confirmed unchanged, not newly discovered, not fixed here (a re-run-safety nicety, not a security defect, and out of this mission's narrow scope).
- **`deploy/rollback.sh`**: destructive operations (`rm -rf "${_RTMP}"`) confirmed scoped to a temporary extraction directory created by the script itself, not to `data/` or any live path — re-verified by direct grep for `rm -rf`/`rm -f` across the full file, finding only the one temp-dir cleanup. `tar -xzf` calls target the same temp directory, never extracting directly over live data in place.
- **`ecosystem.config.cjs`**: full re-read this mission confirms it matches Mission 79's transcription exactly — no drift, no stale path, no wrong domain (it contains no domain references at all), no insecure default (no secret values are embedded in this file; only non-secret operational settings).
- **Nginx scripts (`https-setup.sh`)**: `sed -i "s/yourdomain\.com/$DOMAIN/g"` is scoped to the one nginx conf file (`/etc/nginx/sites-available/jarvis`), not a blind global find/replace across the filesystem — confirmed by direct read of the exact `sed` invocation and its target path argument.
- **Backup scripts**: `backup.sh`'s one real gap (`tar ... || true` masking a tar failure, noted above) is a predictable-failure-behavior weakness — a failed backup would still print "[Backup] Created: ..." misleadingly. This is pre-existing, low-stakes (this script is a same-host pre-update safety net, not the DR-critical path), and out of this mission's narrow scope to fix (would require expanding into the backup scripts themselves, which is not what Mission 80 was chartered to do beyond the entrypoint-purpose documentation already provided above).

**No deployment script was executed against any VPS by this mission.**

---

## Manual Action Reconciliation

Mission 79's 20 manual actions (§21), reconciled — count unchanged (still 20; none invented, none dropped):

| # | Action | Classification |
|---|---|---|
| 1 | Provision a VPS | REQUIRED BEFORE DEPLOY |
| 2 | Decide domain/Nginx topology | DECISION REQUIRED (business half only — technical default confirmed, see DECISION-1) |
| 3 | Point DNS A record(s) at VPS IP | REQUIRED BEFORE DEPLOY |
| 4 | Run `deploy/setup-vps.sh` | REQUIRED DURING DEPLOY |
| 5 | Fill in `.env` — `JWT_SECRET` | REQUIRED BEFORE DEPLOY (credential) |
| 6 | Fill in `.env` — `OPERATOR_PASSWORD_HASH` | REQUIRED BEFORE DEPLOY (credential) |
| 7 | Fill in `.env` — `BASE_URL` | REQUIRED BEFORE DEPLOY |
| 8 | Obtain + set `GROQ_API_KEY` | OPTIONAL (soft-required for AI features) |
| 9 | Register OAuth apps for social/sign-in providers | OPTIONAL, per DECISION-4 |
| 10 | Obtain Razorpay/Stripe live credentials | OPTIONAL, per DECISION-4 |
| 11 | Set `RAZORPAY_WEBHOOK_SECRET`, register webhook | OPTIONAL, only if Razorpay chosen (DECISION-4) |
| 12 | Regenerate `WA_VERIFY_TOKEN` away from template default | **NO LONGER REQUIRED AS A MANUAL RISK ITEM — the template default itself is now blank and the in-app fallback is gone; an operator still MUST set a real value before exposing the WhatsApp webhook (this remains REQUIRED DURING DEPLOY if WhatsApp is used), but the specific *insecure-default* risk this action existed to warn about is now closed by code, not just by operator discipline** |
| 13 | Choose + configure an email provider | OPTIONAL, per DECISION-4 |
| 14 | Provision R2/S3 bucket + IAM credentials | OPTIONAL, per DECISION-5 |
| 15 | Set `BACKUP_PASSWORD` + `BACKUP_OFFSITE_DIR` | REQUIRED AFTER DEPLOY (for real DR coverage; app runs without it) |
| 16 | Run `deploy/https-setup.sh` | REQUIRED DURING DEPLOY |
| 17 | Add `deploy/healthcheck.sh` to crontab | REQUIRED AFTER DEPLOY |
| 18 | Install `pm2-logrotate` | OPTIONAL |
| 19 | Set `SENTRY_DSN`/Telegram/Datadog creds | OPTIONAL |
| 20 | Take a manual Nginx config backup before future changes | REQUIRED AFTER DEPLOY (ongoing discipline) |

No item was inflated or reduced without evidence — item 12 is reclassified (its underlying code risk is closed) but not removed, since a real value must still be manually chosen and set.

---

## Credential Requirements

Unchanged from Mission 79: **2 hard-required** (`JWT_SECRET`, `OPERATOR_PASSWORD_HASH`) **+ ~85 provider-specific/optional**, gated by DECISION-4. `WA_VERIFY_TOKEN` remains a required credential *if* WhatsApp is used (DECISION-4-gated), but its risk profile changed from "dangerous if forgotten" to "simply absent (and safely rejected) if forgotten," per the fix above.

---

## Infrastructure Requirements

Unchanged from Mission 79: **4 hard-required** (VPS, domain, DNS access, TLS-via-certbot) **+ 2 recommended-optional** (offsite backup destination, cloud storage bucket — the latter gated by DECISION-5).

---

## Remaining Blockers

**P0:**
- No VPS provisioned. **INFRASTRUCTURE-BLOCKED.**
- No domain/DNS configured. **INFRASTRUCTURE-BLOCKED.**
- `JWT_SECRET`/`OPERATOR_PASSWORD_HASH`/`BASE_URL` not set to real values. **CREDENTIAL-BLOCKED.**
- Nginx topology's *business* half (which domain architecture is the actual launch target). **DECISION REQUIRED.**
- RPO. **DECISION REQUIRED.**
- RTO. **DECISION REQUIRED.**

**P1:**
- Which optional integrations launch (payments processor, email provider, social platforms). **DECISION REQUIRED** (not a code blocker — Mission 79's own principle, reaffirmed: a provider-approval or credential gap is not automatically a code blocker).
- Cloud storage vs. local disk for launch. **DECISION REQUIRED** (not a code blocker).
- `WA_VERIFY_TOKEN` must still be set to a real value if WhatsApp is used. **CREDENTIAL-BLOCKED** (only if WhatsApp is in scope) — the *insecure-default* risk itself is now closed, this is a remaining ordinary credential requirement, not a security gap.
- `BACKUP_PASSWORD`/`BACKUP_OFFSITE_DIR` unset. **CREDENTIAL-BLOCKED** (optional, for full DR coverage).

**P2:**
- `pm2-logrotate` not installed. **INFRASTRUCTURE-BLOCKED** (optional).
- No monitoring/alerting configured. **CREDENTIAL-BLOCKED** (optional).

**P3 (informational only):**
- `COOKIE_DOMAIN`/`DISABLE_X_POWERED_BY`/`ENABLE_CSP` remain intentionally-redundant checklist toggles — no action needed (§"Security Toggle Findings").
- `backup.sh`'s `tar ... || true` masks a tar failure — pre-existing, low-stakes, not fixed (out of this mission's narrow scope).
- `setup-vps.sh`'s `ufw --force reset` is not fully re-run-safe — pre-existing, not fixed.

No manual action was mischaracterized as a code blocker; no credential requirement was mischaracterized as a code blocker; no provider-approval requirement was mischaracterized as a code blocker — consistent with this mission's explicit instruction.

---

## Tests

Focused tests only — no full CI run, no production deployment script executed.

- **New:** `tests/security/163-wa-verify-token-insecure-fallback.cjs` — 9/9 passing. Proves: (1) `.env.example`'s `WA_VERIFY_TOKEN` default is now blank; (2) the old public placeholder string is gone from the template; (3) `settings.js`'s old `"ooplix_verify"` hardcoded fallback is gone from live code; (4) the route now rejects a save request with no verify token available; (5) the rejected request never leaves `"ooplix_verify"` (or any other guessable value) in `process.env`; (6) a save with a real, explicit verify token still succeeds and stores exactly that value; (7) the underlying, unmodified `whatsappService.verifyWebhook()` still fails safe (rejects) when `WA_VERIFY_TOKEN` is entirely absent — proving the fail-safe this fix now correctly reaches is real, not assumed.
- **Regression:** `tests/security/06-whatsapp-webhook-security.cjs` (pre-existing) — re-run, 6/6 passing, confirming the fix introduced no regression in the existing HMAC-signature/replay-protection webhook test suite.
- Configuration-loading and deployment-config-parsing tests were not applicable — no deployment-config parser exists in this repository to test (env vars are read directly via `process.env`, not through a parsing layer).
- Backup entrypoint selection logic — no code was changed in either backup script, so no new test was needed there; the existing Mission 77 tests (`158`, `159`, `160`) remain the coverage for `scripts/safe-backup.cjs`/`scripts/export-offsite.cjs` and were not re-run here since neither file was touched this mission.

---

## Changes Made

Exactly two files modified, one file added — nothing else:

1. **`.env.example`** — `WA_VERIFY_TOKEN`'s default changed from the literal placeholder `change_this_to_a_random_secret` to blank, with an explanatory comment. Matches the existing convention already used by every other secret-shaped variable in this file.
2. **`backend/routes/settings.js`** — `POST /settings/whatsapp` no longer falls back to a hardcoded `"ooplix_verify"` constant when no verify token is supplied or already configured; it now rejects the request with `400` and an explicit error message.
3. **`tests/security/163-wa-verify-token-insecure-fallback.cjs`** (new) — regression test for both fixes above, 9/9 passing.

No other file was touched. No VPS/DNS/TLS/Nginx/PM2 action was taken. No credential was provisioned, rotated, or printed. No production database was touched. No external communication was sent. Nothing was committed or pushed (per standing instruction — left for the user to review and commit explicitly).

---

## FINAL VPS STATUS

**READY WITH MANUAL CONFIGURATION**

The one security defect discovered this mission (`WA_VERIFY_TOKEN`'s dual insecure-default paths) is fixed and tested. The Nginx and backup "ambiguities" Mission 79 flagged are both resolved to the extent repository evidence allows — the Nginx default is unambiguous (single-domain, confirmed by direct script read), and the backup split is a legitimate two-purpose design, not a defect. The four genuinely business-owned decisions (Nginx's business half, RPO, RTO, integration launch scope, storage tier) are explicitly left as **DECISION REQUIRED** — not guessed, per this mission's primary instruction. Every other item Mission 79 catalogued as a manual action, credential requirement, or infrastructure requirement remains exactly that: something only a human operator with account access, a domain, and a VPS can supply. No code defect blocks VPS execution.

**This mission did not deploy anything. STOP.**
