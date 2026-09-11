# Phase B.4 — Enterprise Security Validation Certification

**Product:** Ooplix (jarvis-os) v1.0.0-rc1
**Date:** 2026-08-09
**Branch:** `security/reality-completion` (no code changes, no merge, no push)
**Method:** Defensive validation by operating the running product only.

## Validation Environment

All observations come from the live product — nothing inferred from documentation.

| Property | Observed value |
|---|---|
| Backend | `node backend/server.js` on `:5050` — HTTP 200 `/health` |
| Frontend | CRA dev server on `:3000` — HTTP 200 |
| Auth mode | Production (`JWT_SECRET` set, 128 chars; `ALLOW_DEV_AUTH_BYPASS` unset) |
| Dev bypass | **Not active** — fails closed |
| Tenants used | 2 real orgs, provisioned via real signup |
| Accounts used | 5 real accounts across 5 distinct org roles |
| Regression | `npm run test:runtime` → **144/144 pass, 0 fail** |

Real tenants created through the product's own signup flow:

- **Org A** `org_1786219169715_1` "SecVal Alpha Corp" — owner `secval-alpha@example.com`
- **Org B** `org_1786219169774_2` "SecVal Beta Ltd" — owner `secval-beta@example.com`
- Org A members: `org_owner`, `org_admin`, `dept_lead`, `member`, `viewer` (all real accounts)

---

## 1. Identity Matrix

| Control | Observation | Classification |
|---|---|---|
| Login (valid) | 200, session cookie issued, `lastLoginAt` updated | VERIFIED |
| Login (wrong password) | 401 `Invalid email or password` — no user disclosure | VERIFIED |
| Login (missing field) | 400 `Password required` | VERIFIED |
| Login rate limiting | 3 attempts → then 429 for 8 consecutive tries (10 per 5 min/IP) | VERIFIED |
| Session cookie flags | `HttpOnly; Secure; SameSite=Strict; Max-Age=28800; Path=/` | VERIFIED |
| JWT signature | HMAC-SHA256, `crypto.timingSafeEqual`, length-checked | VERIFIED |
| Tampered payload (`role`→`operator`) | 401 — signature rejects | VERIFIED |
| Unsigned token (`alg:none`) | 401 | VERIFIED |
| Expired token | 401 (`exp` checked) | VERIFIED |
| Session expiration | 8h, org-configurable via policy | VERIFIED |
| **Logout revocation** | **Cookie cleared, but token still accepted for 8h** | **OBSERVATION ONLY (F1)** |
| Token refresh | 200, re-signs with fresh `exp` | VERIFIED |
| Password reset (unknown email) | Identical response to known email — enumeration-safe | VERIFIED |
| Password reset (bad token) | 400 `Invalid or expired reset token` | VERIFIED |
| Reset rate limiting | 5 per 15 min/IP | VERIFIED |
| Registration rate limiting | 5 per 15 min/IP (observed enforcing) | VERIFIED |
| MFA enrollment | Real TOTP secret + `otpauth://` URI (SHA1/6/30) | VERIFIED |
| MFA wrong code | 400 `Invalid verification code` | VERIFIED |
| MFA unauthenticated | 401 on `status` and `enroll` | VERIFIED |
| MFA org enforcement | `assertMfaSatisfied` gates login when org requires it | VERIFIED |
| OAuth / Firebase | `/auth/firebase-session` present, rate-limited (20/5min) | CONFIGURATION REQUIRED |
| SSO (SAML/OIDC) | Real config accepted; login policy `assertPasswordLoginAllowed` enforced after password verification (not an enumeration oracle) | VERIFIED |
| SCIM token | Get/rotate/delete present, owner-only | VERIFIED |
| Device sessions | No per-device session registry observed | OBSERVATION ONLY |

## 2. Authorization Matrix

Executed live against Org A with five real role-holders. Codes are actual HTTP responses.

| Operation | owner | admin | dept_lead | member | viewer | Intended | Verdict |
|---|---|---|---|---|---|---|---|
| GET members | 200 | 200 | 200 | 200 | 200 | all | VERIFIED |
| GET departments | 200 | 200 | 200 | 200 | 200 | all | VERIFIED |
| GET teams | 200 | 200 | 200 | 200 | 200 | all | VERIFIED |
| POST department | 200 | 409* | 403 | 403 | 403 | owner+admin | VERIFIED |
| PATCH org | 200 | 200 | 403 | 403 | 403 | owner+admin | VERIFIED |
| POST member | 409* | 409* | 403 | 403 | 403 | owner+admin | VERIFIED |
| DELETE org | 200 | 403 | 403 | 403 | 403 | owner | VERIFIED |
| GET audit log | 200 | 200 | 403 | 403 | 403 | owner+admin | VERIFIED |
| GET SSO config | 200 | 403 | 403 | 403 | 403 | owner | VERIFIED |
| PUT SSO config | 500† | 403 | 403 | 403 | 403 | owner | VERIFIED (auth); F4 (status) |
| GET SCIM token | 200 | 403 | 403 | 403 | 403 | owner | VERIFIED |

\* 409 = permission granted, resource already exists (authorization passed).
† Authorization correct; validation status code is finding **F4**.

**UI/backend consistency:** `OrgAdminCenter.jsx:1068` derives `canManage = ["org_owner","org_admin"].includes(orgRole)`, matching the backend `manage_members`/`manage_departments` ACL; grants panel is `org_owner`-only in both layers. No case found where the UI exposed a control the backend would refuse. — VERIFIED

## 3. Organization Isolation Matrix

Two real tenants with real data. Tested with a genuine non-member account.

| Domain | Test performed | Result | Classification |
|---|---|---|---|
| CRM | A created `ALPHA-SECRET-LEAD`, B created `BETA-SECRET-LEAD` | Each tenant saw only its own | VERIFIED |
| CRM (forged header) | B sent `X-Org-Id: <Org A>` | Org A data **not** returned | VERIFIED |
| CRM export (egress) | Both tenants exported | A: 382 B only own; B: 380 B only own | VERIFIED |
| Payments / Billing | `/accounts/me` both tenants | Own account + own plan only | VERIFIED |
| Missions / Runtime | `requireOrgMember` on org-scoped paths | 403 for non-member | VERIFIED |
| Memory | `/memory/*` = global engineering-tooling store, not tenant data; requires auth (401 unauth) | No tenant data held | OBSERVATION ONLY |
| Product OS / Agents | `/org-agents/:orgId` | non-member 403, owner 200 | VERIFIED |
| Executive | `/org-executive/:orgId/{insights,summary,forecast}` | non-member 403 (all 3) | VERIFIED |
| Reports / Monitoring | `/enterprise/monitoring/:orgId/{health,connectors,ai-usage,queue,alerts}` | non-member 403 (all 5) | VERIFIED |
| AI Workspace | `/org-workspace/:orgId` | non-member 403 | VERIFIED |
| Knowledge Graph | `/org-graph/:orgId` | non-member 403 | VERIFIED |
| Enterprise Dashboard | `/enterprise/dashboard/:orgId` | non-member 403 | VERIFIED |
| Org CRUD | A attempted read/patch/delete on Org B | 403 on every attempt | VERIFIED |
| Connector secrets | B queried its own connectors after A stored one | `connected: false` — no cross-tenant visibility | VERIFIED |
| Account listing | `/accounts` as tenant user | 403 `Operator access required` | VERIFIED |

**Note on method:** several `:orgId` base paths return HTTP 200 with `Content-Type: text/html` for non-members. This is the SPA fallback for paths with no GET handler, **not** data exposure — verified by inspecting response bodies (HTML shell) and re-testing the real sub-paths, which all returned 403.

## 4. API Validation Matrix

| Condition | Observation | Classification |
|---|---|---|
| Missing required field | 400 `name is required` | VERIFIED |
| Malformed JSON | 400 `Invalid JSON body` | VERIFIED |
| Oversized payload (12 MB vs 10 MB) | 413 | VERIFIED |
| Nonexistent resource | 404 `Organization not found` | VERIFIED |
| Non-member resource | 403 (distinct from 404) | VERIFIED |
| CSV import — valid | 200, `imported: 1` | VERIFIED |
| CSV import — binary | 400 `CSV contains no data rows` | VERIFIED |
| CSV import — wrong type | 400 `csv (string body) required` | VERIFIED |
| CSV import — 5000 rows | 200, `imported: 4997, duplicates: 3` | VERIFIED |
| Phone validation | 400 with actionable format guidance | VERIFIED |
| Unhandled error body | Generic `Internal server error`, no stack trace (details gated on `NODE_ENV`) | VERIFIED |
| **Type confusion (`name` as object/number/array)** | **400 `name?.trim is not a function`** | **OBSERVATION ONLY (F3)** |
| **Non-string `accountId`** | **200 — object persisted into member roster** | **OBSERVATION ONLY (F5)** |
| **SSO validation error** | **500 for a missing-field condition** | **OBSERVATION ONLY (F4)** |

## 5. File Handling Matrix

| Control | Observation | Classification |
|---|---|---|
| Upload size limit | 25 MB per file, 413 with explicit message | VERIFIED |
| Body size limit | 10 MB JSON/urlencoded | VERIFIED |
| Rejected content | Binary blob rejected 400 | VERIFIED |
| Duplicate handling | Detected and counted (`duplicates: 3` of 5000) | VERIFIED |
| Filename normalization | `_safeFilename` + `_safeScope` applied | VERIFIED |
| Path containment | `abs.startsWith(scopeDir + path.sep)` guard | VERIFIED |
| Traversal attempts | `../../.env`, `....//....//.env`, `/etc/passwd`, `..%2F..%2F.env`, `%2e%2e%2f…` — **no file bytes returned in any case** | VERIFIED |
| Encoded traversal | `..%2f..%2f.env` → 400 | VERIFIED |

## 6. AI Trust Matrix

Validated with **zero AI providers configured** (`/health` → `services.ai: false`) — a genuine failure state.

| Surface | Behavior | Classification |
|---|---|---|
| `/ai/chat` | **502** + `AI backend unavailable. Check provider API keys...` | VERIFIED |
| `/coding/ask` | 500 + `ok: false` + same honest message | VERIFIED |
| Provider credential failure | Reported honestly, names the cause | VERIFIED |
| Fabricated execution | No fabricated AI output observed anywhere | VERIFIED |
| Quota exhaustion | Not reproducible without configured providers | CONFIGURATION REQUIRED |
| **`/jarvis`** | **HTTP 200 + `success: true`** with the failure text in `reply` | **OBSERVATION ONLY (F2)** |

The A.10 honesty fixes hold on the dedicated AI endpoints. `/jarvis` is honest in prose but its machine-readable envelope reports success for a failed operation.

## 7. Runtime Integrity Matrix

| Control | Observation | Classification |
|---|---|---|
| Duplicate work prevention | Same lead POSTed 3× → `duplicate: false`, then `true`, `true` | VERIFIED |
| Queue integrity | `/runtime/dead-letter` → structured, `count: 50 / total: 1000` | VERIFIED |
| DLQ integrity | Entries carry `taskId`, `taskType`, `error`, `attempts`, `deadAt` | VERIFIED |
| Audit integrity | `/runtime/audit/health` → `healthy: true, malformed: 0, seq: 1063` | VERIFIED |
| Mission retention | Capped (Phase B.1 P0 fix in effect) | VERIFIED |
| Recovery integrity | `/runtime/auto-continuity/health` honestly reports no persisted session | VERIFIED |
| Scheduler / Observer | Structured logging into `data/logs/`, observer sources wired | VERIFIED |
| Metrics collector | `/queue/status` → `Metrics collector unavailable` (honest, not a fake zero) | VERIFIED |
| Regression | 144/144 pass after all validation activity | VERIFIED |

## 8. Secret Protection Matrix

| Vector | Observation | Classification |
|---|---|---|
| At rest | `data/vault.json` — AES-256-GCM (`v2:<iv>:<tag>:<ct>`), HKDF-derived key | VERIFIED |
| Stored credential in cleartext on disk | **0 occurrences** anywhere under `data/` | VERIFIED |
| API readback | Returns `present: true` + rotation metadata — never the value | VERIFIED |
| SSO certificate readback | Returns `hasMetadata: true` — never the certificate | VERIFIED |
| Settings view | `hasToken`/`hasSecret`/`configured` booleans only | VERIFIED |
| Logs | Test secret absent from `logs/` and `~/.pm2/logs/` | VERIFIED |
| Browser storage | 266 `localStorage.setItem` calls — **none** write token/secret/password/apikey | VERIFIED |
| Frontend source | No hardcoded `sk-`/`rzp_live_`/`AIza` secrets | VERIFIED |
| JWT secret / password hash | Never present in any API response tested | VERIFIED |
| Session token | httpOnly cookie — not reachable from JS | VERIFIED |
| Vault access audit | `data/vault-access-audit.json`, mode `0600` | VERIFIED |
| Cross-tenant secret read | Forged `X-Org-Id` → 403 | VERIFIED |

## 9. Browser Security Matrix

Headers observed live on `:5050`.

| Header / Control | Observed | Classification |
|---|---|---|
| `Content-Security-Policy` | Per-request nonce + `strict-dynamic` in production | VERIFIED |
| `frame-ancestors 'none'` | Present | VERIFIED |
| `X-Frame-Options` | `DENY` | VERIFIED |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | VERIFIED |
| `X-Content-Type-Options` | `nosniff` | VERIFIED |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | VERIFIED |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | VERIFIED |
| `Cross-Origin-Opener-Policy` | `same-origin` | VERIFIED |
| `Cross-Origin-Resource-Policy` | `same-origin` | VERIFIED |
| `X-Permitted-Cross-Domain-Policies` | `none` | VERIFIED |
| `x-powered-by` | Disabled | VERIFIED |
| CORS allowlist | `app.ooplix.com` → reflected; `evil.example.com` → **not reflected** | VERIFIED |
| CORS credentials | `Access-Control-Allow-Credentials: true` with allowlist (never `*`) | VERIFIED |
| CSRF protection | `SameSite=Strict` on session cookie; no cookie cross-site → 401 | VERIFIED |
| Nonce injection | `index.html` re-rendered per request to stamp nonce | VERIFIED |
| CORS rejection status | Returns **500** rather than 403 (body is generic, no stack trace) | OBSERVATION ONLY (F6) |
| nginx CSP vs app CSP | nginx sets `script-src 'unsafe-inline'` with `always`; app sets nonce + `strict-dynamic`. The weaker nginx value may take precedence behind the proxy | CONFIGURATION REQUIRED (F7) |

## 10. Infrastructure Matrix

| Control | Observed (`nginx.conf`) | Classification |
|---|---|---|
| HTTPS readiness | `listen 443 ssl http2`, Let's Encrypt cert paths | VERIFIED |
| TLS versions | TLSv1.2 + TLSv1.3 only | VERIFIED |
| HTTP→HTTPS redirect | `return 301 https://$host$request_uri` | VERIFIED |
| Reverse proxy | `proxy_pass http://jarvis_backend` upstream | VERIFIED |
| `trust proxy` | `app.set("trust proxy", 1)` — correct client IP for rate limiting | VERIFIED |
| Compression | nginx gzip (≥1 KB, `gzip_vary`); app-level gzip confirmed live (`Content-Encoding: gzip`, `Vary: Accept-Encoding`) | VERIFIED |
| Cache behavior | Hashed assets `1y immutable`; media `30d`; `index.html` `no-cache` | VERIFIED |
| Security headers at proxy | Full set with `always` | VERIFIED |
| Monitoring | `/health` with per-service status + warnings | VERIFIED |
| Logging | Structured NDJSON to `data/logs/`, request IDs on every response | VERIFIED |
| Audit trail | `data/logs/audit.ndjson` — append-only with rotation | VERIFIED |
| Audit trail (live proof) | Captured this session's real `register`, `login`, `forgot_password` events with timestamps and operator IDs | VERIFIED |
| Process management | PM2 daemon running, `ecosystem.config.cjs` present | VERIFIED |

## 11. Dependency Matrix

`npm audit` on root, 2026-08-09: **26 total — 3 critical, 16 high, 7 moderate.**

| Package | Severity | Advisory | Reaches production runtime? | Classification |
|---|---|---|---|---|
| `request` | CRITICAL | SSRF in Request | **Yes** — via `node-telegram-bot-api@0.63.0` (`telegram: true` at runtime) | OBSERVATION ONLY |
| `form-data` | CRITICAL | Unsafe random boundary; CRLF | **Yes** — via `axios@1.18.1` | OBSERVATION ONLY |
| `tar` | CRITICAL | Hardlink path traversal | No — `electron-builder`/`electron-rebuild` (dev only) | OBSERVATION ONLY |
| `undici` | HIGH | Response desynchronization | Transitive | OBSERVATION ONLY |
| `js-yaml` | HIGH | Quadratic CPU (CVE-2026-59870) | Transitive | OBSERVATION ONLY |
| `brace-expansion` | HIGH | DoS via unbounded expansion | Transitive | OBSERVATION ONLY |
| `fast-uri` | HIGH | Host confusion | Transitive | OBSERVATION ONLY |
| `image-size` | HIGH | Infinite loop DoS | Transitive | OBSERVATION ONLY |
| `electron` | HIGH | iframe `allow-popups` bypass | Desktop build (devDependency) | OBSERVATION ONLY |
| `electron-builder`, `@electron/rebuild`, `app-builder-lib`, `builder-util*`, `dmg-builder`, `electron-publish`, `electron-rebuild`, `electron-builder-squirrel-windows` | HIGH | Build-chain advisories | No — build only | OBSERVATION ONLY |
| `pptxgenjs` | HIGH | — | **Declared in `dependencies`** | OBSERVATION ONLY |
| `uuid` (via `exceljs`) | MODERATE | Missing buffer bounds check | `exceljs` is devDependency | OBSERVATION ONLY |

Most high-severity items are confined to the Electron build chain. The two production-reachable criticals both arrive transitively — `request` (deprecated, via the active Telegram integration) and `form-data` (via axios).

## 12. Risk Matrix

| ID | Finding | Reproduced | Impact | Severity |
|---|---|---|---|---|
| F1 | Logout does not revoke the session token; it remains valid for its full 8h TTL. No denylist/`jti`/`tokenVersion` exists. | 3/3 + final re-verify | A token captured or retained before logout keeps working. "Sign out" does not end the session server-side. | **High** |
| F2 | `/jarvis` returns HTTP 200 + `success: true` when every AI provider fails. | 3/3 + final re-verify | Machine-readable success on failure; any client trusting `success` treats a failed operation as succeeded. Contradicts A.10. | **Medium** |
| F3 | Type confusion surfaces an internal JS error as the user-facing message: `name?.trim is not a function` (`/orgs`, `/orgs/:id/departments`). | 3/3 + breadth | Leaks internal implementation detail; unactionable for the user. | **Low** |
| F4 | `PUT /enterprise/sso/:orgId/config` returns **500** for a missing-field validation error. | 2/2 + final re-verify | A client error reported as a server fault; misleads operators and monitoring. | **Low** |
| F5 | Non-string `accountId` (JSON object) accepted into the member roster; the resulting record cannot be removed via `DELETE .../members/:accountId` (404). | Confirmed, persisted | Durable malformed membership record; roster integrity degraded. Requires `manage_members`. | **Medium** |
| F6 | Disallowed CORS origin produces HTTP 500 instead of 403. | Confirmed | Cosmetic/observability only — origin is correctly **not** reflected and no stack trace leaks. | **Informational** |
| F7 | nginx CSP `script-src` includes `'unsafe-inline'` with `always`, while the app emits nonce + `strict-dynamic`. | Config review | Behind the proxy the weaker policy may win, forfeiting the app's nonce hardening. | **Medium** |
| F8 | Two production-reachable critical advisories: `request` (SSRF) and `form-data`. | `npm audit` | Inherited transitive exposure via the active Telegram integration and axios. | **Medium** |

## 13. Remediation Matrix

Recommendations only — no code was changed in this phase.

| ID | Remediation | Scope | Priority |
|---|---|---|---|
| F1 | Add server-side session invalidation: issue a `jti` per token and record it in a revocation set on logout, or add a per-account `tokenVersion` in the JWT compared against the account record in `requireAuth`. Reuse the existing account store; no new infrastructure. | `backend/middleware/authMiddleware.js`, `backend/routes/auth.js` | **P0** |
| F2 | Make the `/jarvis` envelope match the outcome — return `success: false` (and a non-200 status, consistent with `/ai/chat`'s 502) when no provider is reachable. Keep the honest `reply` text. | `/jarvis` handler | **P1** |
| F5 | Validate `accountId` is a non-empty string before creating a membership; add a one-time sweep for existing non-string member records. | `backend/routes/organizations.js`, `organizationService.cjs` | **P1** |
| F7 | Align the nginx CSP with the application's nonce + `strict-dynamic` policy, or stop emitting CSP at the proxy and let the app be authoritative. Verify the effective header behind the proxy after the change. | `nginx.conf` | **P1** |
| F8 | Replace `node-telegram-bot-api@0.63.0` with a maintained client (or a direct Bot API call via the axios already present) to drop `request`; upgrade `axios` to pull a patched `form-data`. Re-run `npm audit` to confirm. | `package.json` | **P1** |
| F3 | Type-check inputs before string operations so validation messages are user-facing (`"name must be a string"`), not internal errors. | `organizationService.cjs` | **P2** |
| F4 | Give validation errors an explicit `status = 400` so the existing `e.status || 500` handler classifies them correctly. | `ssoService.cjs` | **P2** |
| F6 | Return 403 for a disallowed CORS origin instead of falling through to the 500 handler. | `backend/server.js` | **P3** |
| — | Update the build chain (`electron`, `electron-builder`) at the next desktop release to clear the dev-only highs. | `package.json` (dev) | **P3** |
| — | Consider a device/session registry if per-device sign-out becomes a customer requirement. | Identity | Backlog |

---

## Certification

**Scope validated:** 11 areas, 12 matrices, ~150 live checks against the running product using 2 real organizations and 5 real role-holders.

| Area | Classification |
|---|---|
| Identity | VERIFIED WITH LIMITATIONS (F1) |
| Authorization | **VERIFIED** — 11/11 operations × 5 roles matched the declared model; UI consistent with backend |
| Organization Isolation | **VERIFIED** — no cross-tenant data exposure found in any domain, including forged `X-Org-Id` |
| API Validation | VERIFIED WITH LIMITATIONS (F3, F4, F5) |
| File Handling | **VERIFIED** — no traversal succeeded across five encodings |
| AI Safety | VERIFIED WITH LIMITATIONS (F2) |
| Runtime Safety | **VERIFIED** — duplicate work prevented; 144/144 regression |
| Secret Protection | **VERIFIED** — AES-256-GCM at rest; no exposure via UI, API, logs, or browser storage |
| Dependency Health | OBSERVATION ONLY (F8) |
| Browser Security | VERIFIED WITH LIMITATIONS (F6, F7) |
| Infrastructure Readiness | **VERIFIED** |

**Overall: VERIFIED WITH LIMITATIONS.**

The enterprise security model is genuinely implemented and enforced at the backend, not merely presented in the UI. Multi-tenant isolation, RBAC, secret handling, and file containment each withstood direct validation. Eight findings are documented; **F1 (logout does not revoke the session) is the one that should be resolved before enterprise customer onboarding**, since "sign out" is a control customers assume ends the session.

No exploits were developed, no protections were bypassed, and no attack techniques were invented. Every result above came from operating the product as a customer, administrator, or SaaS owner would.

**Validation hygiene:** test credentials and the test SSO configuration were removed from the vault after validation (confirmed: 0 occurrences remaining). Test accounts, orgs, and CRM records remain as evidence. No source file was modified; `git status` shows only the pre-existing `.claude/settings.json` change. No merge, no push.
