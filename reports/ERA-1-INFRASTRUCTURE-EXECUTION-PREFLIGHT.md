# ERA-1 — INFRASTRUCTURE EXECUTION PREFLIGHT

**Date:** 2026-09-09
**Branch:** `security/reality-completion`, HEAD `77f1cc0b421269134a2126d90caa4e2f078736dd` (unchanged)
**Scope:** Read-only preflight only. No credential invented, no `.env` change, no deployment, no
DNS change, no nginx change, no source code change, no production data change, no commit/push.

**Founder decisions this preflight is scoped against** (per `reports/ERA-1-FOUNDER-DECISION-REGISTER.md`,
locked 2026-09-09): 3-vhost nginx (`ooplix.com`/`app.ooplix.com`/`api.ooplix.com`), RPO 12h target,
RTO 4h target, phased connector launch, Cloudflare R2 primary + local-disk fallback retained.

**Concurrent-session work preserved, not touched:** `reports/OOPLIX-380-MASTER-COVERAGE-MATRIX.md`
(confirmed present, 148,372 bytes, last modified by another session) and every other file already
listed as concurrent in prior reports. Verified present and unmodified before and after this
preflight — see §Git state at the end.

---

## RESULT: STOP — infrastructure/credential access is not available

Per this task's own instruction ("If VPS/domain/R2 access is not available, STOP after producing
the exact provisioning checklist"), this preflight stops here with a checklist, not a deployment
plan. No infrastructure was contacted, no credential was invented, and this finding is not new —
it reconfirms Mission 96's already-live-verified conclusion, re-checked directly in this session
rather than merely cited.

---

## 1. VPS credentials/access — NOT AVAILABLE

- No VPS hostname/IP is configured anywhere reachable from this environment.
- `~/.ssh/config` exists but contains only the unmodified `ssh-keygen`-generated placeholder
  template (`Host alias` / `HostName hostname` / `User user`) — never filled in with a real host.
- An SSH keypair exists locally (`~/.ssh/id_ed25519`), but a keypair without a target host/IP and
  without confirmation the public key is authorized on any real server is not usable access —
  it's inert local material.
- No `SSH_HOST`/`VPS_HOST`/`DEPLOY_HOST`-shaped environment variable is set in this shell.
- **No connection attempt of any kind was made** to any host, per this task's read-only
  instruction — this finding is based entirely on local configuration inspection.
- Consistent with `reports/MISSION-96-VPS-CREDENTIAL-GATE-RECONCILIATION.md`'s live-verified
  conclusion ("no real VPS... exist in this environment") and Mission 80/95's independent
  corroboration — unchanged since those missions.

**STATUS: NOT AVAILABLE.**

## 2. Production domain/DNS access — NOT AVAILABLE

- `deploy/nginx-jarvis.conf` still contains the literal, unmodified placeholder
  `yourdomain.com`/`www.yourdomain.com` in its `server_name` directives — confirmed by direct
  read this preflight.
- `deploy/nginx-multisite.conf` (the config the founder-approved 3-vhost decision requires) does
  contain the real domain family `ooplix.com`/`app.ooplix.com`/`api.ooplix.com`, but this is a
  **static config file, not evidence of DNS control** — no A/CNAME record, registrar access, or
  DNS provider credential is present anywhere in this environment. Having the right hostnames
  typed into a config file is not the same as being able to point them at a server.
- No DNS provider API token (Cloudflare, Route53, etc.) is present as an environment variable in
  this shell.
- `deploy/https-setup.sh`'s own built-in safety check (`dig +short $DOMAIN` vs. the server's own
  public IP) would itself fail closed if run today, since there is no server IP to match against
  — this is a good, already-correct safety behavior, not something this preflight needed to test
  by actually running the script.

**STATUS: NOT AVAILABLE.**

## 3. R2 production credentials — NOT AVAILABLE (presence-only check; per this session's standing
environment restriction, `.env`'s existence itself cannot be checked)

- `backend/services/storageService.cjs` requires all four of `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ACCOUNT_ID` (or the `CLOUDFLARE_ACCOUNT_ID` +
  `CLOUDFLARE_R2_BUCKET` alias form) before it reports `configured: true` for R2 — confirmed by
  direct read of the provider-detection logic this preflight.
- `.env.example` (the template, not `.env` itself) lists `R2_ACCESS_KEY_ID=`, `R2_SECRET_ACCESS_KEY=`,
  `R2_BUCKET=`, `R2_ACCOUNT_ID=`, `R2_ENDPOINT=` all blank — confirming these are meant to be
  founder-supplied, not defaulted.
- **This session's sandbox does not permit checking even the bare presence/absence of `.env`
  itself** (a standing restriction carried forward from the prior mission in this same session,
  not something newly imposed here) — so this preflight cannot state whether R2 values are
  already set locally or not. This is reported as a genuine evidence gap, not interpreted either
  way (neither "configured" nor "not configured" is asserted).
- No R2 bucket, account ID, or API token was created, requested, or invented by this preflight.

**STATUS: NOT AVAILABLE (confirmed unprovisioned in code-declared terms; live presence in `.env`
could not be checked this session due to sandbox restriction — see manual action list).**

---

## 4. Current production branch/commit

- **Branch:** `security/reality-completion`
- **HEAD:** `77f1cc0b421269134a2126d90caa4e2f078736dd`
- This is **not** a branch named `main`/`production` — it is the active working branch this
  entire mission series (Phases 1–6, ERA-1 reconciliation, founder decisions) has been performed
  on. No branch switch, merge, or tag was created by this or any preceding mission in this
  session. Whether this exact commit is the intended production baseline is itself a decision
  this preflight does not make — flagged in the manual-action list below.
- Working tree currently has multiple uncommitted files (own + concurrent-session work) — not a
  clean state suitable for a deployment artifact as-is. See §Git state for the exact list.

## 5. Current deploy scripts and their expected inputs

| Script | Purpose | Required input(s) |
|---|---|---|
| `deploy/setup-vps.sh` | Fresh VPS bootstrap (installs Node/PM2/Nginx, clones repo, installs `nginx-jarvis.conf`) | Run **on** a real VPS as root/sudo; currently hardcodes installation of the single-domain config (line 97) — per the founder's approved 3-vhost decision, this line needs to install `nginx-multisite.conf` instead, which is source-code/script work not yet performed (this preflight did not modify it, per explicit instruction) |
| `deploy/https-setup.sh` | Certbot TLS provisioning | Positional arg: `$1` = domain (`Usage: bash deploy/https-setup.sh yourdomain.com`); self-checks DNS via `dig`+`ipify` before proceeding. Per the 3-vhost decision, this needs the 4-SAN certbot form (`-d ooplix.com -d www.ooplix.com -d app.ooplix.com -d api.ooplix.com`) instead of its current single-domain invocation — not yet changed |
| `deploy/start-production.sh` | Boots the app under PM2 in production mode | Requires `JWT_SECRET` and `OPERATOR_PASSWORD_HASH` set in `.env` (hard `die` if missing — confirmed by direct read); warns (does not block) if `BASE_URL` still contains `localhost`/a placeholder or isn't `https://` |
| `deploy/rollback.sh` | Restore to a prior state | Requires a prior `safe-backup.cjs` archive to exist; functionally certified (Mission 77) but never timed end-to-end |
| `deploy/validate-production.sh` | Post-deploy validation sweep | Runs against a live, already-deployed instance — not runnable meaningfully pre-deployment |
| `deploy/monitor.sh` / `deploy/healthcheck.sh` | Ongoing production monitoring | Assume a live, reachable instance |

**None of these scripts were executed by this preflight** — this table is derived from direct
file reads only.

## 6. Exact environment variables still required

| Variable | Purpose | Current state (code-declared requirement, not a live `.env` check — see §3 restriction) |
|---|---|---|
| `JWT_SECRET` | Session signing — hard-required, `start-production.sh` dies without it | Required, real value not confirmed present this session |
| `OPERATOR_PASSWORD_HASH` | Operator console login — hard-required | Required, real value not confirmed present this session |
| `BASE_URL` | Public app URL — near-hard-required (script warns, doesn't die, if it's a placeholder) | Must be set to the real chosen domain once DNS is live — depends on Decision 1 (3-vhost) being implemented first |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ACCOUNT_ID` (or `CLOUDFLARE_ACCOUNT_ID`+`CLOUDFLARE_R2_BUCKET` alias) | Storage — required per Decision 5 (R2 primary) | Required, not confirmed present this session |
| Any connector-specific credential (per the phased launch decision) | Only for whichever connectors are in the first launch wave | Not yet determined — Decision 4 approved a *policy*, not a named connector list, so this list cannot be finalized yet |

## 7. Exact external credentials/accounts still required

1. **A real VPS** (any provider) with root/sudo access and a public IP.
2. **Registrar/DNS control** for `ooplix.com` (or whichever domain is finally confirmed) — ability
   to create/edit A records for the bare domain, `app.`, and `api.` subdomains.
3. **A Cloudflare R2 account** with a bucket created and an API token scoped to it (per Decision 5).
4. **For the phased connector launch's first wave** (once named): real credentials for whichever
   of the 8 declared-core connectors (`git:github`, `pay:razorpay`, `pay:stripe`, `msg:whatsapp`,
   `msg:telegram`, `msg:slack`, `auth:github`, `auth:google`) or others are actually selected —
   not requestable yet since the exact first-wave list has not been named (per Decision 4's own
   "policy, not a named list" scope).
5. Real values for `JWT_SECRET` (generatable locally via the command `start-production.sh` itself
   prints — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — no
   external account needed for this one) and `OPERATOR_PASSWORD_HASH` (via
   `node scripts/generate-password-hash.cjs <password>` — also no external account needed, just a
   founder-chosen password).

## 8. Exact manual actions required from the founder

**Infrastructure provisioning (blocking, must happen before any deploy):**
1. Provision a VPS and provide this session (or whichever session performs deployment) with real
   SSH access (host/IP + credentials or key authorization).
2. Confirm DNS/registrar control for `ooplix.com` and create the 3 required host records
   (`ooplix.com`, `app.ooplix.com`, `api.ooplix.com`) pointing at the provisioned VPS's IP —
   these records must propagate *before* `https-setup.sh` is run (its own built-in `dig` check
   will otherwise correctly refuse to proceed).
3. Create a Cloudflare R2 bucket and generate an API token; provide the 4 resulting values
   (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ACCOUNT_ID`) for `.env`.
4. Generate and provide (or generate directly on the eventual VPS) `JWT_SECRET` and
   `OPERATOR_PASSWORD_HASH` using the two commands named in §7 item 5.
5. Decide and confirm the real `BASE_URL` (depends on #2 completing first).

**Decisions still needed before deployment scripts can be fully updated (non-infrastructure, but
blocking a complete deploy path):**
6. Name the exact first-wave connector list for the phased launch (Decision 4 approved the
   *policy*; a concrete list is still needed before those specific credentials can be requested).
7. Confirm whether commit `77f1cc0b` on `security/reality-completion` is the intended production
   baseline, or whether a merge to a `main`/`production` branch and a fresh commit is expected
   first — this preflight does not assume either way.

**Follow-on validation work (not blocking initial deploy, but required before RPO/RTO/DR can be
called certified, per the founder's own explicit "do not claim certification until validated"
instruction on those two items):**
8. Once VPS access exists, run a timed restore drill to validate the 4h RTO target.
9. Decide and implement how the 12h RPO target will actually be met (current cron cadence is
   ~24h — tightening the interval or adding a secondary intra-day mechanism, neither built today).
10. Extend `scripts/safe-backup.cjs`'s file lists to cover `data/exports/` (recommended
    regardless of R2 provisioning, since the local-disk fallback is being retained per Decision 5).

**None of the above was performed by this preflight** — this is the checklist, not the work.

---

## Git state (before and after this preflight — identical)

```
 M backend/routes/index.js
 M backend/routes/marketplace.js
 M backend/routes/phase20.js
 M backend/server.js
 M backend/services/improvementLoopEngine.cjs
 M backend/services/marketplaceAutomationEngine.cjs
 M backend/services/marketplaceCatalogEngine.cjs
 M backend/services/missionMemory.cjs
 M backend/services/missionOrchestrator.cjs
 M backend/services/skillRegistry.cjs
 M tests/runtime/auto-v10.test.cjs
 M tests/runtime/civ-v9.test.cjs
 M tests/runtime/eco-v8.test.cjs
 M tests/runtime/ent-v7.test.cjs
 M tests/runtime/eos-v6.test.cjs
?? (untracked reports, tests, and services from this and concurrent sessions —
    including reports/OOPLIX-380-MASTER-COVERAGE-MATRIX.md, confirmed present/untouched)
```

- HEAD: `77f1cc0b421269134a2126d90caa4e2f078736dd` — unchanged.
- P1-1 (`backend/services/agentRuntimeSupervisor.cjs`) diff vs `7c229a52`: **222** lines — unchanged.
- No file was created, modified, or deleted by this preflight other than this report.
- No commit, push, merge, reset, rebase, or stash was performed.
- `reports/OOPLIX-380-MASTER-COVERAGE-MATRIX.md` and every other concurrent-session file confirmed
  present and untouched.

## Deploy: NOT PERFORMED

No SSH session opened. No DNS record created or changed. No nginx config activated or modified.
No `.env` value read, set, or invented. No source file changed. No credential requested from any
external provider. This preflight is the checklist only, per this task's own explicit "STOP after
producing the exact provisioning checklist" instruction.

**Waiting on:** founder-provided VPS access, DNS/registrar access, and R2 account credentials
(items 1–5 in §8) before any further infrastructure execution step can proceed.
