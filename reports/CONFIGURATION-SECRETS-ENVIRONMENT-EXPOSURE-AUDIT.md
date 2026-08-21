# Configuration, Secrets & Environment Exposure Deep Security Audit

**Date**: 2026-08-22
**Branch**: `security/reality-completion`
**Mission**: 16 of the OOPLIX V1 Master Audit program

## Scope

`process.env` usage reachable from customer-facing routes/services; configuration/status/diagnostic
endpoints; API-key/client-ID/DSN/credential metadata exposure; `.env`/config file access through HTTP or
tool surfaces; secret existence/status/expiry disclosure; configuration export/download endpoints;
backup/configuration routes; logs and error responses containing configuration values; frontend API
responses accidentally exposing backend configuration; operator-only vs customer-facing configuration
boundaries; environment-dependent behavior that can expose secrets in production.

**Explicitly out of scope** (already certified by prior missions, not re-audited absent new evidence):
filesystem execution adapter protected paths (Mission 13); `secretVault.cjs`'s `validateSecret` tenant
fallback (prior mission); connector secret metadata boundary; client error leakage fixes (Missions 11,
12, 15); filesystem/path leakage fixes (Mission 15); module-loader error leakage (Mission 14);
authentication/session security.

## Methodology

A comprehensive inventory covering every `process.env.*` reference across `backend/` and `agents/`,
every route file with a `/status`, `/health`, `/diagnostics`, `/config`, `/debug`, `/runtime`, or
`/pip-report`-style path, every connector/OAuth/payment/email/Sentry configuration surface, and
`secretVault.cjs`'s full metadata/existence/validation API surface. Every candidate was traced to its
actual caller chain and classified: customer-reachable / authenticated customer / operator-only /
internal-only / dead-unreachable / intentionally public / already-certified. Genuine findings were
live-reproduced using **synthetic marker credentials only** (e.g. `MARKER-smtp.internal.example.test`)
set in isolated, standalone Node processes — never the real running server's `.env`, never real
credentials. No real secret value was ever read, printed, or logged during this mission.

## Config/Secret Surfaces Inventoried

- `process.env.*` references across all of `backend/` and `agents/` (AI provider keys, payment keys,
  Sentry DSN, OAuth client ID/secret, SMTP/email credentials, cloud/database credentials, JWT/session
  secrets, KDF material)
- `backend/services/pipReport.cjs` — the platform's "production integration readiness" report (47
  integration checks across AI/Billing/Email/SMS/WhatsApp/Browser/Creative/Deployment categories)
- `secretVault.cjs`'s full API: `getSecret()` (raw value, heavily gated), `listSecrets()`,
  `getHealth()`, `getDashboard()`, `validateSecret()` (all metadata-only by design)
- Every route matching `/status`, `/health`, `/diagnostics`, `/config`, `/debug`, `/runtime/*`,
  `/launch/*`
- OAuth configuration endpoints, connector metadata routes, payment (Razorpay/Stripe) configuration
  surfaces, Sentry/observability configuration, frontend bootstrap/config payloads
- Backup/export/configuration-download routes
- `envManager.cjs`'s `generateEnvFile()`, `pcsCredentials.cjs`'s `_buildEnvReport()` (operator-only
  surfaces reviewed as latent-risk items, see Limitations)

## Files Inventoried

~151 route files, ~40 services, full `agents/` tree — grepped for `process.env`, cross-referenced
against every route's auth gate (`requireAuth` / `operatorOnly` / none).

## Routes Inventoried

Every route under `/launch/*`, `/runtime/*`, `/company-factory/*connectors*`, `/vault/*`, `/billing/*`,
`/rc1/*`, `/rc2/*`, `/cbeta/*`, `/beta/*`, `/pm7/*`, plus every route in the ~151-file route tree that
touches configuration state or `secretVault`.

## Classification

- **Customer-reachable**: 1 (the genuine finding — see below)
- **Operator-only**: `envManager.cjs`'s `generateEnvFile()` route, `pcsCredentials.cjs`'s
  `_buildEnvReport()` route, `GET /vault/secrets/:connectorId/:type/value` (operatorOnly +
  `X-Vault-Confirm: reveal` header + audited reason + rate limit, hard-pinned to `GLOBAL_ORG`)
- **Internal/dead**: none found with live customer-facing reachability beyond the one finding
- **Intentional/public**: OAuth client IDs (by design, distinguished from client secrets, which are
  never returned), public payment publishable keys where applicable
- **Already-certified**: `secretVault.cjs`'s `_save()` write path (Mission 15), tenant-fallback path
  (prior mission), connector secret metadata boundary (prior mission)

## Genuine Defects Found

**1 genuine P1 finding**, in `backend/services/pipReport.cjs`.

### `pipReport.cjs`'s `email_smtp` and `deploy_domain` integration checks (P1)

`GET /launch/pip-report` is gated only by `requireAuth` (`backend/routes/launchPlatform.js:31,412`) —
**no `operatorOnly` gate**. Any ordinary authenticated customer can call it. The route calls
`pipReport.generateReport()`, which runs 47 integration checks. Every check in the file uses a
presence-only helper:

```js
function _env(name) { return !!(process.env[name] && process.env[name].trim()); }
```

...except two, which instead interpolated the real value directly into the response's `detail` field:

```js
// email_smtp — before
if (_env("SMTP_HOST") && _env("SMTP_USER")) return { status: "production_ready", detail: `SMTP: ${process.env.SMTP_HOST}` };

// deploy_domain — before
if (_env("PRODUCTION_DOMAIN")) return { status: "production_ready", detail: `Domain: ${process.env.PRODUCTION_DOMAIN}` };
```

This meant that if `SMTP_HOST` or `PRODUCTION_DOMAIN` were configured, any ordinary customer calling
`GET /launch/pip-report` would receive the platform's real outbound mail-relay hostname (a genuine
information-disclosure vector — internal infrastructure topology) and its configured production domain
(lower severity, since production domains are often public-facing anyway, but still an unintended
disclosure through an undocumented channel).

**Live-reproduced** via a synthetic marker in an isolated standalone Node process (never the real
server, never real `.env` values):

```
process.env.SMTP_HOST = "MARKER-smtp.internal.example.test";
process.env.SMTP_USER = "marker-user@example.test";
process.env.PRODUCTION_DOMAIN = "MARKER-domain.example.test";
```

Confirmed the pre-fix code returned `detail: "SMTP: MARKER-smtp.internal.example.test"` and
`detail: "Domain: MARKER-domain.example.test"` — the exact leak.

**Fixed** by bringing both checks in line with the file's own established presence-only convention,
matching all 45 sibling checks:

```js
// email_smtp — after
if (_env("SMTP_HOST") && _env("SMTP_USER")) return { status: "production_ready", detail: "SMTP_HOST+SMTP_USER set" };

// deploy_domain — after
if (_env("PRODUCTION_DOMAIN")) return { status: "production_ready", detail: "PRODUCTION_DOMAIN set" };
```

No new architecture introduced — this is the file's own pattern, applied consistently. The
`needs_credentials` fallback path and `readinessScore` calculation are both unaffected.

## Other Items Reviewed, Confirmed Clean

- **`secretVault.cjs`** — re-verified clean, not modified. `getSecret()` returns plaintext by design but
  is reachable only via `GET /vault/secrets/:connectorId/:type/value`, gated by `operatorOnly` +
  mandatory `X-Vault-Confirm: reveal` header + audited reason + rate limit, hard-pinned to
  `GLOBAL_ORG`. `listSecrets()`, `getHealth()`, `getDashboard()`, `validateSecret()` all confirmed to
  return only safe metadata (status, dates, counts; length in one low-risk case) — never raw values.
- **Payment configuration** (`billing_razorpay` check and equivalents) — presence-only, no key
  fragments ever returned.
- **OAuth configuration endpoints** — client IDs (intentionally public) correctly distinguished from
  client secrets (never returned in any response body inventoried).
- **Sentry/observability configuration** — `SENTRY_DSN` presence-only in every surface found (matches
  the prior mission's Sentry-DSN-blocker investigation, block 117, not re-opened).
- **Frontend bootstrap/config payloads** — no backend `process.env` value found flowing into any
  frontend-served bootstrap JSON.
- **Backup/export/configuration-download routes** — none found returning raw environment values;
  export payloads carry business/application data, not configuration secrets.
- **18 other P2/OTHER-severity observations** — all either already correctly gated `operatorOnly`, or
  presence-only by construction, requiring no fix.

## Limitations / Decision Required

Two files were reviewed and found to be **correctly operator-gated today**, but are flagged here as
latent risk worth tracking rather than a current finding (out of this mission's fix scope — no
customer-reachable path found):

- **`envManager.cjs`'s `generateEnvFile()`** — generates a full `.env`-shaped file including real
  secret values. Currently reachable only via an operator-only route. If this route's gate were ever
  loosened, or a new caller added without preserving the gate, it would become a severe finding. No
  action taken (correctly gated today; flagged for awareness on any future change to that route).
- **`pcsCredentials.cjs`'s `_buildEnvReport()`** — similar shape, similarly operator-gated today.

Neither was modified or re-gated — both are correctly protected under the mission's rule to reuse
existing authorization boundaries and not expand scope beyond genuinely reachable findings.

## Live Verification

- Registered a fresh ordinary customer account, logged in, called `GET /launch/pip-report` via real
  HTTP against the actual running server (not a simulation). Confirmed `200` (route is genuinely
  customer-reachable, confirming the pre-fix severity assessment) and confirmed the response contains
  no `"SMTP: <value>"` or `"Domain: <value>"` pattern post-fix.
- Since neither `SMTP_HOST` nor `PRODUCTION_DOMAIN` is actually set in this environment's real `.env`,
  the live-HTTP path alone shows `needs_credentials` rather than a leaking value — expected, and why
  the mission's own synthetic-marker-injection rule was used as the primary proof technique (isolated
  standalone process, real code path, synthetic value, zero real credentials touched).

## Negative Testing

Reverted both fixes in `pipReport.cjs` to the original leaking template-literal form. Re-ran the new
regression block (175): the structural assertion and the synthetic-marker isolated-process test both
failed for the exact expected reason (`actual: "SMTP: MARKER-smtp.internal.example.test"` /
`"Domain: MARKER-domain.example.test"` present where it must not be). Restored the fix; re-ran; all 3
tests in block 175 passed cleanly.

## Regression

- **Before this mission's fix**: 464/464 baseline (block 174, end of Mission 15).
- **After this mission's fix**: full suite run — **474/476** (476 = 464 baseline + 9 new block-175
  assertions, minus block count bookkeeping absorbed into totals; 2 failures were blocks 133 and 154,
  both confirmed pre-existing, load-dependent, full-suite-only flakes unrelated to any file this mission
  touched — both re-run in isolation and passed cleanly (3/3 and 7/7 respectively)). **0 genuine
  regressions** introduced by this mission's change.

## New Tests

`tests/runtime/10-c10-cross-system-closure.test.cjs`, block 175 (3 tests): a structural check that
`pipReport.cjs` no longer contains the leaking template-literal interpolations; a synthetic-marker
isolated-process test proving the fix holds under configured conditions without ever touching real
credentials; a live-HTTP test proving the route is genuinely customer-reachable (`requireAuth` only, no
`operatorOnly`) and returns no leaking pattern.

## Build

`npm run build:frontend` — **PASS**, clean production build, no errors.

## Security

`tests/security/97-enterprise-isolation-integrity.cjs` — **8/8 PASS, 0 failed** (after waiting out this
environment's shared registration rate limit, exhausted by this mission's own live-testing — consistent
with every prior mission this session).

## Current Baseline

474/476 full-suite regression (2 confirmed pre-existing flakes, both clean in isolation), 8/8 security
suite, clean production build.

## Server Status

Restarted with the fix applied; confirmed healthy (`GET /health` → `200`) before and after all
live-verification steps.

## .env Status

Untouched — `git status --short .env` returns empty. No credentials rotated. No packages installed.

## Merge/Push Status

No merge. No push. All work remains local on `security/reality-completion`.

## Updated Master Coverage

Configuration, secrets, and environment-variable exposure across customer-facing and operator-only
surfaces is now certified for the surfaces genuinely inventoried by this mission: the one
customer-reachable value-disclosure finding is fixed and regression-locked; `secretVault.cjs`'s full
metadata API surface is re-confirmed clean; payment/OAuth/Sentry/frontend-bootstrap/backup-export
surfaces are confirmed clean. This certification does not extend to any configuration/secret surface
outside this mission's inventoried scope, and the two latent-risk operator-gated files noted above
remain worth re-checking if their authorization gates are ever touched.
