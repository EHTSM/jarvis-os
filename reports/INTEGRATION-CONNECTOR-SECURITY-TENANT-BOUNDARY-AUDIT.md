# INTEGRATION & CONNECTOR SECURITY / TENANT-BOUNDARY AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-21 · **Branch:** `security/reality-completion`

---

## Scope

Fast, bounded audit of the existing connector/integration layer: `backend/services/
integrationConnectors.cjs` (56-connector platform-wide status/health service), `backend/services/
secretVault.cjs` (the shared encrypted credential store all connector-related routes use),
`backend/routes/integrations.js`, `backend/routes/myConnectors.js`, `backend/routes/companyFactory.js`'s
connector routes, and their real frontend consumer.

## Architecture Clarification (established before auditing further)

`integrationConnectors.cjs` is entirely founder/platform-level infrastructure — its `connect*()`/
`scan*()` functions probe credentials sourced from `secretVault.cjs`'s `GLOBAL_ORG` partition or raw
`process.env`, with **no orgId concept anywhere in the file**. The actual per-tenant, customer-facing
connector layer is `myConnectors.js` — a small, curated 9-provider wrapper over `secretVault.cjs`'s
existing per-org credential storage (confirmed already-hardened by a prior "Vault Security Hardening"
pass: `requireOrgPermission("manage_connectors")`, restricted to `org_owner`/`org_admin`). `/integrations/
*` (the founder's own platform-wide connector status routes) is already `operatorOnly`-gated at the
router level.

## Genuine Vulnerability Found — 1, proven live, shared root cause across 2 customer-reachable routes

**`secretVault.cjs`'s `validateSecret()` — cross-tenant credential-metadata disclosure (P1/P2).**
When no vault record exists for a given `(connectorId, type, orgId)`, `validateSecret()` fell back to
checking `process.env[ENV_MAP[...]]` **regardless of which `orgId` was passed** — a fallback that is
only correct for `GLOBAL_ORG` (the founder's own partition), matching `getSecret()`'s own convention
(confirmed by reading its body: `getSecret()` has no such fallback and correctly returns `null` for any
org with no matching record).

Live-reproduced via two independent real customer-reachable call sites:
- `POST /my-connectors/razorpay/validate` — a fresh customer account with zero credentials stored in
  their own org received `{present:true, valid:true, source:"env", detail:"Found in env var
  RAZORPAY_KEY_ID"}` — the founder's real, live-configured Razorpay key falsely reported as the
  customer's own connector.
- `POST /company-factory/companies/:id/connectors/:connectorId/:type/validate` — same underlying bug,
  but reachable with **caller-controlled `connectorId`/`type` path params**, letting a customer probe
  any of the full ~56-connector catalogue (not just the curated 9) to enumerate exactly which founder
  platform credentials exist (`ai:openai`, `pay:razorpay`, etc. all confirmed `present:true` for a
  customer org with zero stored credentials; `git:github` correctly `present:false` — accurately
  reflecting that credential is genuinely absent from both vault and env in this environment).

No secret *value* was ever exposed (`validateSecret()` never returns the decrypted value, only
`length`/metadata) — this is a metadata/existence disclosure and false-status bug, not raw credential
theft. Confirmed the actual execution path (`paymentService.js`'s real Razorpay call, via `getSecret()`)
was never affected — `getSecret()` has no such fallback, so no customer transaction could ever have
executed using the founder's real payment credentials.

## Fix

One change in `secretVault.cjs`'s `validateSecret()`: the `ENV_MAP` fallback lookup is now scoped to
`orgId === GLOBAL_ORG` only, matching `getSecret()`'s existing convention. No new mechanism — reuses
the same `GLOBAL_ORG` constant and exemption pattern `_assertOrgAccess()` already documents and uses.
Confirmed this doesn't affect the founder's own legitimate use: `founderVault.js`'s routes call
`validateSecret(connectorId, type)` with no `orgId` arg (defaults to `GLOBAL_ORG`), so the fallback
still resolves correctly there; `credentialImportTool.cjs`'s bulk-import classifier explicitly passes
`vault.GLOBAL_ORG` for `PLATFORM_SHARED` rows and a real customer `orgId` for org-scoped rows — both
paths behave identically to before.

## Other Areas Audited — Confirmed CLEAN, No Fix Needed

- **Cross-tenant IDOR via forged `X-Org-Id` header**: live-tested against `myConnectors.js`'s full
  route set (list/store/validate/delete) and `companyFactory.js`'s connector routes with two real
  customer accounts — all correctly rejected `403` (`requireOrgPermission`/`_requireCompanyOrgPermission`
  verify real membership before any handler runs, the same established pattern proven safe in the prior
  Customer-Reachable API mission).
- **Credential/log exposure**: no `console.log`/`logger.*` calls touching secret values anywhere in
  `secretVault.cjs`, `myConnectors.js`, or `companyFactory.js`'s connector routes.
- **Frontend**: `ConnectorSetupWizard.jsx` (the real customer-facing consumer) never pre-fills a form
  field from a fetched value, never writes to `localStorage`/`sessionStorage`, and uses the real
  `/my-connectors/*` API contract with no client-side secret handling.
- **Failure honesty**: `myConnectors.js`'s `_ok()`/`_err()` pattern is fully try/catch-honest — no path
  reports success on a caught error; `DELETE`'s `removed` count is a real tally, not a hardcoded success.
- **Rate limiting**: `myConnectors.js` and `companyFactory.js`'s connector routes make zero external
  HTTP calls (pure vault CRUD) — no external-call cost to rate-limit. `/integrations/*`'s live-probing
  routes (`scan`, `health`, `reconnect`) are `operatorOnly` (trusted founder traffic only) — not a
  customer-facing abuse surface.
- **OAuth/callbacks**: `myConnectors.js` uses direct bearer-token/password entry, not an OAuth exchange
  — the OAuth state/nonce/callback-binding audit items don't apply to this connector layer.
  `integrationConnectors.cjs` does read tokens `oauthIntegrationLayer.cjs` already obtained (for
  Teams/Google Workspace/Microsoft 365/Notion), but only through the already-`operatorOnly`-gated
  `/integrations/*` routes — no new OAuth dependency introduced by this connector flow, so the
  already-certified OAuth properties were correctly not re-audited.

## Live Verification

Two freshly registered ordinary customer accounts against the restarted production server:
- `POST /my-connectors/razorpay/validate` and `POST /company-factory/companies/:id/connectors/
  pay:razorpay/api_key/validate` both now correctly return `{present:false, source:"none", detail:"Not
  configured"}` for a customer org with no stored credential of its own.
- The founder's own `GLOBAL_ORG` resolution (`vault.validateSecret("pay:razorpay","api_key")`, no
  orgId) remains unaffected — still resolves the real, live-configured credential.
- Cross-tenant `X-Org-Id` forgery against all of `myConnectors.js`'s routes (list/validate/delete) and
  `companyFactory.js`'s connector routes correctly rejected `403`, with the legitimate owner's real
  stored credential (a Notion token, stored and later cleaned up during this audit) confirmed intact
  and correctly resolving via `source:"vault"` throughout.

## Limitations

- `integrationConnectors.cjs`'s ~56 `connect*()`/`scan*()` functions themselves were not individually
  re-verified for live-probe correctness — out of scope per the mission's explicit "do not blindly
  modify/re-verify all ~56 connectors" instruction; this audit focused on the authorization/tenant-
  isolation/credential-metadata boundary around them, which is where the actual customer-reachable risk
  lives (the connectors themselves are entirely founder-owned, operator-gated infrastructure).
- No credential-blocked or environment-blocked findings beyond the standard registration rate-limit
  wait already documented in prior missions this session.

## Regression

**Before:** 425/425 effective. **After:** 428/428 clean (0 failures, including the previously-flaky
tests all passing cleanly this run). **New tests:** 3 (block 164) — 1 structural + 1 unit-level + 1
live, covering the fix, the GLOBAL_ORG non-regression, and the real HTTP chain through both vulnerable
call sites. **Negative-tested**: reverted the fix, confirmed all 3 targeted tests failed for the exact
expected reasons, restored, confirmed all 3 passed again.

**Build:** PASS (`npm run build:frontend`, clean production build).
**Security suite:** `tests/security/97-enterprise-isolation-integrity.cjs` — 8/8 PASS (after waiting
out this environment's shared registration rate-limit window).
**Server:** restarted twice (`secretVault.cjs` is `require()`-cached), confirmed healthy after each
restart.
**`.env`:** untouched. **No merge. No push.** Unrelated uncommitted work in the working tree preserved
throughout.

**No OS-track record altered.**
