# OS-INTEGRATION — DISCOVERY

**Track:** OOPLIX 25-OS Master Reconciliation — Integration OS (row 18)
**Date:** 2026-08-15 · **Branch:** `security/reality-completion` · **Verification port:** 5303
**Method:** Read canonical sources → inventory connector/vault/adapter surfaces → cross-reference
against `25-OS-MASTER-INVENTORY.md` row 18 and `MASTER-OPEN-FINDINGS.md` (C10-016, C10-017b).
**NO NEW CONNECTOR OR PROVIDER WAS BUILT. NO CREDENTIALS WERE PROVISIONED.**

---

## What Integration OS actually is

Three real, non-duplicated layers:

1. **`backend/services/secretVault.cjs`** (897 lines) — the single encrypted credential store for
   all connectors. AES-256-GCM at rest, key = HKDF-SHA256(JWT_SECRET, per-install salt) with
   legacy-key fallback for pre-hardening ciphertext. 12 credential types. Org-scoped storage key
   (`orgId::connectorId::type`, with a `GLOBAL_ORG` partition for the founder/operator's own
   platform-wide credentials). Exposes `storeSecret/getSecret/listSecrets/deleteSecret/rotateSecret/
   validateSecret/getHealth/resolveEnvKey/resolveAll/getDashboard/getAccessAudit/
   resolveCredentialRef(s)`.

2. **`backend/services/integrationConnectors.cjs`** (1,676 lines) — the connector registry and
   live-probe engine for all 12 phases (A–M: AI, Git, Infra, Payments, Email, Messaging, Auth,
   Productivity, Commerce, Creative, Automation, Monitoring, Project Management). ~65 individual
   `connect*()` functions, each: reads credential via `_env()` (vault-first, then `process.env`
   fallback through a reverse `ENV_MAP` index built once from `secretVault.ENV_MAP`), returns
   `MISSING` if absent, else performs a real HTTP probe against the live provider and returns
   `CONNECTED`/`READY`/`PARTIAL` based on the actual response — never fabricates success. Also
   provides `reconnect()`, `getHealth()`, `detectFailures()`, `getMetrics()`, `runFullScan()`,
   `getScanSummary()`, `rotateCredentialsGuide()`, and a 4-hour background health-monitor tick.

3. **`backend/services/businessEventAdapter.cjs`** (573 lines) — normalizes external events
   (webhook/form/email/whatsapp/telegram/payment/calendar/manual) into business entities and
   routes them through the existing B1/B2/B3 business-entity/automation/intelligence stack. This
   is the **inbound** integration surface, architecturally separate from the outbound
   vault+connector-registry pair above.

### Route surfaces (2, intentionally separate, not duplicates)

| Route file | Mount | Audience | Gate |
|---|---|---|---|
| `backend/routes/integrations.js` (168 lines) | `/integrations/*` | Founder/operator platform-wide connector status (env-var-backed, shared infra) | `requireAuth + operatorOnly` |
| `backend/routes/myConnectors.js` (203 lines) | `/my-connectors/*` | Regular tenant's own connector credentials (curated 9-provider subset: WhatsApp, Razorpay, Stripe, SMTP, Teams, Notion, Jira, Linear, X/Twitter) | `requireAuth + attachOrg + requireOrgPermission("manage_connectors")` |
| `backend/routes/business.js` webhook block | `/business/webhook/:source`, `/business/events*` | External systems (unauthenticated inbound) + authenticated event-log inspection | Webhooks: none (by necessity — external caller can't log in). Event log/stats: `requireAuth` only, **no org scoping** |

`myConnectors.js`'s own header comment is explicit about the non-duplication: *"Does not duplicate
secretVault.cjs or integrationConnectors.cjs — this is a thin, org-scoped, curated-subset wrapper
over the existing vault."* Confirmed accurate by source read — it calls `vault.storeSecret/
validateSecret/deleteSecret` directly, no parallel storage.

---

## Connector inventory — 57 connectors across 12 phases (A–L), plus Phase M (Project Management)

Verified via `secretVault.cjs`'s own `KNOWN_CONNECTORS` list (65 entries — the dashboard's
superset, since it also tracks `git:bitbucket`, `prod:google_workspace`, `commerce:*` which sit
outside the original "57 A-L" count cited in the mission) and `integrationConnectors.cjs`'s
`getAllStatus()` (confirmed live: **65 connectors tracked** in `data/integration-connectors.json`
after a full scan).

| Phase | Label | Connectors (sample) |
|---|---|---|
| A | AI Providers | groq, openai, anthropic, gemini, openrouter, deepseek, together, fireworks, cohere, nvidia, grok, qwen, ollama, lmstudio |
| B | Git | github, gitlab, bitbucket |
| C | Infrastructure | aws, r2, cloudflare, hostinger, supabase, firebase |
| D | Payments | razorpay, stripe, paddle, lemonsqueezy |
| E | Email | resend, sendgrid, mailgun, postmark, brevo, smtp |
| F | Messaging | whatsapp, telegram, twilio, discord, slack, teams |
| G | Authentication | google, github, microsoft, linkedin, apple, discord |
| H | Productivity | google_workspace, m365, dropbox, notion |
| I | Commerce | shopify, woocommerce, wordpress |
| J | Creative | figma, canva |
| K | Automation | zapier, make, n8n |
| L | Monitoring | sentry, datadog, uptime |
| M | Project Management | jira, linear |

Every connector was reachable via static-source inspection; a stratified live sample of 5
credential-free connectors (Jira, Slack, Sentry, Linear, GitHub — see
`OS-INTEGRATION-CAPABILITY-MATRIX.md`) was directly exercised via a Node harness calling
`integrationConnectors.cjs` functions in-process (bypassing HTTP auth, since the target of this
test was the service layer's own honesty, not route-level gating, which was separately verified
live over HTTP).

---

## C10-016 re-confirmation (limited connector coverage)

`MASTER-OPEN-FINDINGS.md` C10-016 claims Salesforce/HubSpot/Zendesk/QuickBooks/Shippo are absent.
Re-confirmed by grep — zero references to any of these five providers anywhere in
`integrationConnectors.cjs`, `secretVault.cjs`'s `ENV_MAP`, or `myConnectors.js`'s `PROVIDERS`.
**Finding still accurate. CREDENTIAL BLOCKED, not attempted this pass** (per mission instruction —
building a provider without real credentials to test against would be a fake integration).

## C10-017b re-confirmation (businessEventAdapter has no orgId concept)

Re-confirmed directly against current source:

```
$ grep -n "orgId" backend/services/businessEventAdapter.cjs
(0 matches)
```

`getEventLog({ source, entityType, status, limit, offset })` (line 543) — no `orgId` parameter.
`ingest(source, raw, opts)` (line 419) — no `orgId` anywhere in its signature, body, or the
`toEntity()`/`_logEvent()` helpers it calls. **The finding is still 100% accurate against current
code.** No fix attempted — per the mission brief, this is a re-confirmation, not a fix target; the
root architecture question (how does an inbound webhook establish tenant identity — API key→org
mapping? per-org webhook URL? something else?) remains a founder/product decision, unchanged from
C10-017b's original disposition.

**New evidence surfaced this pass, extending but not contradicting C10-017b:** live-testing the
consequence of "no orgId concept" found that `GET /business/events` (the route that calls
`getEventLog()`) is `requireAuth`-only with no org filtering applied at the route layer either —
so the *symptom* of C10-017b is not just "an inbound webhook can't be attributed to a tenant," it
is "every authenticated user of every org can currently read every other org's raw webhook-ingested
event data (name/email/message) via this one route." See `OS-INTEGRATION-SECURITY.md` for the live
reproduction. This is additional live evidence for the *same* documented gap, not a new root cause
— filed as an addendum to C10-017b's evidence, not a new ID, since a fix requires the identical
founder decision C10-017b already named.

---

## Cross-OS integration confirmed real

`backend/services/companyDashboard.cjs`'s `getCompanyComposition()` calls
`integrationConnectors.getCompositionStatus(id)` for every connector a department declares, with
an explicit source comment: *"REAL composition status (Phase 7) — never fabricated as connected."*
Confirmed by source read — this is a genuine, non-mocked cross-OS consumer of connector health
(Business OS / Company Factory → Integration OS). `rc3.cjs`/`rc4.cjs` (Release Certification
services) also load `integrationConnectors.cjs` for their own stability scoring.

Frontend: `frontend/src/components/ConnectorSetupWizard.jsx` is a real, wired consumer of
`/my-connectors/*` (`_fetch("/my-connectors")`, POST/DELETE per provider) — not a mock.
`CommandPalette.jsx` also references the connector surface. No fabricated frontend data found in
either file for this surface.

---

## Test tenants used

Two fresh accounts registered directly against the isolated port-5303 instance (not reused from
`tmp/c10/`, since that setup predates this session and its cookies/JWTs would not be valid against
a freshly started process anyway):

- Org A: `intos_orga_1786794117@test.local` → `org_1786794117739_1` (org_owner)
- Org B: `intos_orgb_1786794117@test.local` → `org_1786794117803_2` (org_owner)

Both real accounts with real auto-created organizations, real JWT cookie sessions, real
`manage_connectors` permission via `organizationService.cjs`'s standard `org_owner` role — no
synthetic bypass.
