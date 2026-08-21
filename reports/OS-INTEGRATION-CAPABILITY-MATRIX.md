# OS-INTEGRATION — CAPABILITY MATRIX

**Track:** OOPLIX 25-OS Master Reconciliation — Integration OS
**Date:** 2026-08-15 · **Branch:** `security/reality-completion` · **Verification port:** 5303

Every row below is a live-tested or directly-source-verified capability. "CREDENTIAL BLOCKED"
means the capability is real code with no real external credential available in this environment
to complete a live positive-path test — never simulated as a fake success.

---

## 1. Connector abstraction (secretVault.cjs)

| Capability | Result | Evidence |
|---|---|---|
| Single storage schema across all connector types | **PASS** | `_vkey(connectorId, type, orgId)` — one key format, one `data/vault.json` shape, used by all 65 connectors uniformly |
| Encryption consistent, not per-connector | **PASS** | `_encrypt`/`_decrypt` (AES-256-GCM, HKDF-derived key) called from exactly 3 write paths (`storeSecret`, `rotateSecret`, `prepareRotationCandidate`) — no connector-specific encryption code found anywhere in `integrationConnectors.cjs` |
| Legacy ciphertext compatibility | **PASS** | `_decrypt()` detects `v2:` prefix vs. legacy 3-part hex format, uses the matching key deterministically — verified by code read, not live-tested (no legacy-format ciphertext exists in this fresh environment) |
| Vault-then-env resolution order, uniform | **PASS** | `resolveEnvKey()` and `integrationConnectors._env()` (via reverse `ENV_MAP` index) both implement "vault first, env fallback" identically — confirmed live: Razorpay fields showed `"Found in env var RAZORPAY_KEY_ID"` when only env was set (see matrix §2) |
| 12 credential types, one validation path | **PASS** | `CRED_TYPES` Set checked in `storeSecret()`; `validateSecret()` is the single function every credential type flows through (no type-specific validators found) |
| Org-scoping enforcement (Vault Security Hardening) | **PASS** | `_assertOrgAccess()` — opt-in (backward compatible with pre-multi-tenant callers), verified via `organizationService.hasPermission()`, not merely a storage-key convention |
| Audit trail on reveal | **PASS** | `_appendAudit()` — separate from operational history, records who/when/why on every plaintext reveal |

**Verdict: the abstraction is real, not per-connector copy-paste.** All 65 connectors read
credentials through the identical `_env()` → vault-then-env-fallback path; none implement their own
storage or encryption.

---

## 2. Credential handling without real credentials — 5 connectors live-sampled

Directly invoked via Node harness against `integrationConnectors.cjs` (in-process, real code path,
real env state — no mocking of the module under test):

| Connector | Env var(s) checked | Present in this env? | Reported status | Fabricated `CONNECTED`? |
|---|---|---|---|---|
| `issue:jira` | JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN | No | `READY` — "JIRA_HOST, JIRA_EMAIL, and JIRA_API_TOKEN not fully set" | **No** |
| `msg:slack` | SLACK_BOT_TOKEN | No | `READY` — "SLACK_BOT_TOKEN not set" | **No** |
| `monitor:sentry` | SENTRY_DSN | No | `READY` — "SENTRY_DSN not set" | **No** |
| `issue:linear` | LINEAR_API_KEY | No | `READY` — "LINEAR_API_KEY not set" | **No** |
| `git:github` | GITHUB_TOKEN | No | `READY` — "GITHUB_TOKEN not set — public read access available; set PAT for full access" | **No** |

`git:github`'s "READY with public access" nuance was independently checked against source: GitHub's
public API genuinely allows unauthenticated reads at lower rate limits, so this is an honest,
accurate distinction from a fully-missing connector — not an inflated status.

**Full-scan cross-check:** `runFullScan()` (real, all 13 category scanners) reported **55 of 65**
tracked connectors as failures (`detectFailures()`), consistent with an unprovisioned environment.
Sample of the failure list includes `ai:deepseek` (`MISSING`), `ai:anthropic` (`MISSING`),
`ai:gemini` (`MISSING`), `git:github` (`READY`, partial), `monitor:sentry` (`READY`) — every one
correctly attributed to a real missing env var, never a generic/opaque failure.

**Verdict: PASS.** Every sampled connector honestly reports "not configured" rather than faking a
connection. This pattern (credential absent → `MISSING`/`READY` with the literal missing var name
in `detail`; credential present but probe fails → `READY`/`PARTIAL` with the real HTTP status;
credential present and probe succeeds → `CONNECTED`) was confirmed structurally consistent by
reading 8 different `connect*()` function bodies (`connectGitHub`, `connectGitLab`,
`connectBitbucket`, `connectHostinger`, `connectCloudflare`, `connectFirebase`, `connectSupabase`,
`connectAWS`) — no divergent connector found that silently reports success without a real check.

---

## 3. Failure honesty — health-check / reconnect with no real credentials

| Operation | Target | Result |
|---|---|---|
| `reconnect("issue:linear")` | No `LINEAR_API_KEY` in env | Returned `READY`, `detail: "LINEAR_API_KEY not set"` — **never fabricated success** |
| `reconnect("nonexistent:fake")` | Unknown connector ID | Threw `Error: Unknown connector: nonexistent:fake` — **fails loudly, not silently** |
| `getHealth("monitor:sentry")` | Connector with 0 vault secrets stored | `totalSecrets: 0`, `score: 100` (vacuously — no secrets to be overdue), correctly distinct from "connected and healthy" |

**Verdict: PASS.** No code path found (across the 5 sampled connectors plus `reconnect`/
`detectFailures`) that returns a fabricated success for a connector with no real credentials.

---

## 4. Tenant attribution — Org A / Org B live isolation test

Two-tenant test against the tenant-facing `/my-connectors/*` surface (the surface a regular org
actually uses — `/integrations/*` is intentionally founder/operator-only and platform-wide, not
per-org, so it is out of scope for a *tenant* isolation test by design).

| Step | Org A | Org B | Result |
|---|---|---|---|
| `GET /my-connectors` before any credential stored | All 9 providers `connected:false`, "not configured" | Same | Both honest, no leak |
| Org A stores real-shaped fake Stripe `api_key` | `stripe.api_key.present = true` | — | Stored, isolated to Org A |
| `GET /my-connectors` — Org B re-checked | — | `stripe.api_key.present = false` | **Org B cannot see Org A's credential** |
| Org B sends `X-Org-Id: <Org A's real orgId>` header on `GET /my-connectors` | — | `403 Forbidden — requires permission: manage_connectors` | **Forged-header read blocked** |
| Org B sends `X-Org-Id: <Org A's orgId>` on `DELETE /my-connectors/stripe` | — | `403 Forbidden — requires permission: manage_connectors` | **Forged-header write blocked** |
| Org A's Stripe secret re-checked after the forged-delete attempt | `present: true` (unchanged) | — | **Confirmed intact — no destructive cross-tenant side effect occurred** |

**Verdict: PASS, fully fail-closed both directions.** `requireOrgPermission("manage_connectors")`
in `orgMiddleware.cjs` verifies real membership against `organizationService.cjs` — a client-
supplied `X-Org-Id` header alone cannot establish authorization, matching the documented behavior
of `attachOrg` (`"Does NOT block requests — use requireOrgMember() for enforcement"`) and the
already-hardened enforcement layer built on top of it in `myConnectors.js`.

### secretVault.cjs storage-level isolation (static + functional confirmation)

`_vkey(connectorId, type, orgId)` returns `orgId::connectorId::type` for any non-`GLOBAL_ORG` org —
Org A's Stripe key and Org B's Stripe key (if it stored one) would occupy physically distinct keys
in `data/vault.json`. Confirmed live: Org A's `stripe::api_key` entry did not appear under Org B's
`GET /my-connectors` scan, which internally calls `validateSecret(connectorId, type, orgId)` scoped
to the caller's own `orgId`.

---

## 5. Webhook/input identity model — C10-017b live re-confirmation

| Check | Result |
|---|---|
| `businessEventAdapter.cjs` — `orgId` anywhere in file | **0 matches** (`grep -c orgId` = 0) — confirmed unchanged from the original finding |
| `ingest(source, raw, opts)` accepts an orgId | **No** — signature is `(source, raw, opts = {})`; `opts` is inspected only for `automate`/`priority`/`alert`/`entityType` |
| `getEventLog({source, entityType, status, limit, offset})` accepts an orgId filter | **No** — 5 named filter params, none is `orgId` |
| Live webhook simulated: `POST /business/webhook/form` (no auth, no org header — matching how a real external system would call it) | Real event ingested: `eventId: bevt_1786794291024_1`, real mission created (`msn_5a9c4666...`), real lead persisted to `data/biz-leads.json` |
| Does the persisted lead carry an `orgId`? | **No** — confirmed by direct read of `data/biz-leads.json`: the record has no `orgId` field at all |
| Org A `GET /business/leads` (org-scoped store, filters by `req.org.id`) | Does **not** show the webhook lead — correctly invisible, since it has no `orgId` to match against |
| Org B `GET /business/leads` | Same — does **not** show it either |
| Org A `GET /business/events` (event log, `requireAuth`-only, no org filter) | **Shows the event** — `total:1`, full event including source/entityId |
| Org B `GET /business/events` | **Shows the identical event** — same `eventId`, same data |

**Verdict: C10-017b is fully re-confirmed accurate.** The underlying business record (lead) is
safely orphaned rather than misattributed — it lands in neither org's scoped view, consistent with
`businessDataService.cjs`'s documented "opt-in orgId" design (same pattern C10-017 already
validated as safe). But `GET /business/events` — a route not specifically named in the original
C10-017b writeup — is confirmed live as a **currently-open, platform-wide read surface**: any
authenticated user in any org can read every ingested webhook event's raw normalized data
(name/email/phone/message) regardless of which org (if any) triggered it. This is evidence
extending C10-017b, not a new root cause — the fix still requires the same founder decision on how
inbound events establish tenant identity. See `OS-INTEGRATION-SECURITY.md` for full detail and
disposition.

---

## 6. Output/event propagation — real ingested event → business record

| Step | Result |
|---|---|
| POST to `/business/webhook/form` with a secret-labeled test payload | `200 OK`, `success:true` |
| Entity mapped | `entityType: "lead"`, `score: 55` (computed via real `_autoScore()` — name+email present, no phone/company, non-manual source) |
| Mission created | Real `missionId` returned (`businessEntityModel.createBusinessMission()` — B1 stack, not stubbed) |
| Event log entry created | Confirmed present via `GET /business/events` (see §5) |
| runtimeEventBus emission | `_bus()?.emit("business:event", ...)` called (best-effort, wrapped in try/catch per the adapter's own resilience pattern) |
| Lesson recorded | `continuousLearningEngine.createLesson()` called (best-effort) |

**Verdict: PASS as a propagation mechanism** — a real event genuinely creates a real, traceable
business record and mission, end to end, with no fabrication at any step. The **honesty gap is
specifically at the tenant-identity layer**, not the propagation mechanism itself: the event
propagates correctly, but with no owner, and is then visible platform-wide via the event log —
exactly the shape C10-017b already predicted this architecture would produce once actually
exercised live.

---

## 7. Cross-OS integration — connector health feeding a real dashboard

| Consumer | Confirmed real? | Evidence |
|---|---|---|
| `companyDashboard.cjs` → `getCompanyComposition()` | **Yes** | Calls `integrationConnectors.getCompositionStatus(id)` for every department-declared connector; own source comment: *"REAL composition status (Phase 7) — never fabricated as connected"* |
| `rc3.cjs` / `rc4.cjs` (Release Certification) | **Yes** | Both load `integrationConnectors.cjs` directly for stability/readiness scoring, not mocked |
| `frontend/src/components/ConnectorSetupWizard.jsx` | **Yes** | Real `_fetch("/my-connectors")`/POST/DELETE calls, no seed/mock data found |
| `frontend/src/components/CommandPalette.jsx` | **Yes** (reference confirmed, not deep-tested this pass) | References the connector surface for quick-access |

**Verdict: PASS.** At least one real, non-fabricated cross-OS consumer chain confirmed
(Business/Company Factory OS → Integration OS → frontend), satisfying the mission's spot-check
requirement.

---

## Summary scorecard

| Dimension | Result |
|---|---|
| Connector abstraction | **PASS** — real, uniform, not copy-pasted |
| Credential-absent honesty (5/65 sampled) | **PASS** — 0 fabricated successes found |
| Failure honesty (reconnect/health) | **PASS** |
| Tenant attribution — `/my-connectors/*` | **PASS — fully fail-closed, forged-header and direct-attempt both blocked** |
| Tenant attribution — `/integrations/*` (founder-only) | **PASS by design** — correctly operator-gated, not per-org (403 for regular users, confirmed live) |
| Webhook/input identity model (C10-017b) | **RE-CONFIRMED OPEN — founder decision required, unchanged disposition** |
| Output/event propagation | **PASS as a mechanism; honesty gap is tenant-identity, not propagation** |
| Cross-OS integration | **PASS — real, non-fabricated consumer confirmed** |
| Credential-blocked items | C10-016 (Salesforce/HubSpot/Zendesk/QuickBooks/Shippo) — re-confirmed absent, correctly not built |
