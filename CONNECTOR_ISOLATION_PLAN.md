# Connector Isolation Plan

Status: design only. No code changed.

Scope: `backend/services/integrationConnectors.cjs` (1278 lines, 40 `connect*` functions) and `backend/services/secretVault.cjs`. This is the plan referenced by Gap Analysis §4 and Migration Plan §3.

---

## Why this is the sharpest boundary in the system

Every other gap in this program (memory, knowledge, billing) is about data commingling within the platform. Connectors are different: a leaked or misscoped credential here reaches **outside** the platform — into a customer's Stripe account, Slack workspace, or email provider. There is zero tolerance for a scoping mistake in this subsystem, which is why it gets its own document and its own conservative, additive-only design.

## Current state (verified)

- 40 `connect*` functions, each taking zero or one non-tenant parameter (e.g. `connectAIProvider(providerId)`, `connectRazorpay()`, `connectSlack()`).
- Credential resolution via `_env(k)` (lines 70-84): vault lookup (`secretVault.cjs`, key format `` `${connectorId}::${type}` ``) first, `process.env[k]` fallback.
- Grep-confirmed: no `orgId`/`tenantId` parameter anywhere in `integrationConnectors.cjs`.
- `secretVault.cjs` is a flat key-value store, one `data/vault.json`, one global `JWT_SECRET`-derived encryption key, no namespacing hook.
- Universal operations already exist per connector: `reconnect`, `getHealth`, `getStatus`, `getAllStatus`, `getMetrics`, `rotateCredentialsGuide`, `detectFailures` — this lifecycle tooling is real and reusable; only the credential *scope* needs to change, not this tooling.

## Target model

### Three layers, per the approved blueprint

| Layer | What it is | Change required |
|---|---|---|
| **Platform Connector** | The connector *type*: auth flow, health check, capability schema (the 40 `connect*` functions' logic) | None — this is legitimately shared code and stays global |
| **Organization Connector** | One org's configured, credentialed instance of a connector type | New concept — today doesn't exist as a row anywhere |
| **Workspace Connector** | An optional narrower scope — a connector instance visible only within one Workspace inside an org (e.g. a client-specific Slack integration in Agency mode) | New concept, built on top of Organization Connector once that exists — not simultaneously |

Note: "Workspace Connector" here refers to the blueprint's Workspace node (Org → Workspace → Team), which — per the Gap Analysis §2 finding — is not the same as the repository's current `workspaceService.cjs`. Workspace-scoped connectors are not buildable until the Workspace/Organization reconciliation (roadmap M1) has landed and there's one coherent Workspace concept to scope against.

### Credential storage

`secretVault.cjs`'s `_vkey(connectorId, type)` → `` `${connectorId}::${type}` `` becomes `` `${orgId}::${connectorId}::${type}` ``, with a reserved sentinel `orgId` (`"__platform__"`) for:
- Connector types that are genuinely platform-level and never org-specific (if any emerge — none identified today; every current connector is a candidate for org-scoping).
- Backward compatibility during migration (see Migration Plan §3) — existing single-tenant deployments keep working unchanged under the sentinel.

`listSecrets(filter?)` gains an `orgId` filter parameter. `resolveAll(connectorId)` becomes `resolveAll(orgId, connectorId)`. All other vault API functions (`storeSecret`, `getSecret`, `deleteSecret`, `rotateSecret`, `resolveEnvKey`, `validateSecret`, `getHealth`, `getHistory`, `exportVault`, `importVault`, `getDashboard`) take the same additive `orgId` parameter, defaulting to the sentinel when omitted so nothing calling the old signature breaks during transition.

### Connector function signatures

Each of the 40 `connect*` functions gains a leading `orgId` parameter: `connectRazorpay(orgId)`, `connectSlack(orgId)`, `connectAIProvider(orgId, providerId)`. `_env(k)` becomes `_env(orgId, k)`, resolving through the org-scoped vault key first, then falling back to the sentinel-scoped vault entry, then `process.env[k]` last (three-tier fallback, so a deployment mid-migration never hard-fails on a connector call).

### Rotation

Existing `rotateCredentialsGuide`/`rotateSecret` logic is reused unchanged — it already operates per `(connectorId, type)`; extending it to `(orgId, connectorId, type)` is the same additive parameter pattern as above. No new rotation *logic* is needed, only scope.

### Revocation

New capability, doesn't exist today in any form: an explicit `revokeConnector(orgId, connectorId)` that deletes the org-scoped vault entry and marks the Organization Connector row (once that row exists per Migration Plan) as `revoked_at`. Revocation must be **org-scoped only** — revoking one org's Slack connection must never touch the sentinel-scoped or another org's Slack credentials, which is precisely why the vault key must include `orgId` as a prefix rather than a suffix or side-table (prefix keys make "delete everything under this org" a clean, auditable single operation).

### Audit

Every credential access (`getSecret`/`resolveAll` call from within a `connect*` function) gets logged with `{orgId, connectorId, type, accessedBy, timestamp}`. `secretVault.cjs` already has `getHistory` — extend its underlying log write, not its read API, to include `orgId`.

### Quota / usage

Per-org, per-connector-type call budgets, billable via the ledger described in `MIGRATION_PLAN.md` §2. This is new — today connector usage isn't metered per tenant at all, only per-account AI usage is (via `usageMetering.cjs`, itself account-scoped, not org-scoped — see Gap Analysis §5).

---

## Rollout shape (no code, sequencing only)

1. **Vault re-keying with sentinel default** — zero behavior change, ships first, is the prerequisite for everything else.
2. **Additive `orgId` parameter on all 40 `connect*` functions**, defaulting through the three-tier fallback — existing callers that don't pass `orgId` keep working exactly as today via the sentinel.
3. **Wire `orgId` from request context** (the same `orgId` `orgMiddleware.cjs` already resolves) into connector calls at the route layer, org by org, connector by connector — not all 40 at once. Highest-value/highest-risk connectors first (payments, then messaging with customer PII, then everything else).
4. **Quota + audit logging** once org-scoped calls are flowing.
5. **Explicit revocation UI/API** once (3) and (4) are stable — revocation without accurate audit logging first would be flying blind.
6. **Workspace-level connector scoping** only after the Workspace/Organization reconciliation (M1) is complete — do not build this early against the current, soon-to-be-reconciled `workspaceService.cjs`.

## Backward compatibility

At every step above, a deployment that never passes an `orgId` anywhere continues to function identically to today (the sentinel absorbs it). This matters concretely for the existing Electron single-user desktop build, which has no multi-org concept and should not be forced to acquire one.

## Rollback

Each step is a parameter addition with a default, not a breaking signature change — reverting any step is a code revert of that step's PR, with no data cleanup required as long as step 3's "explicit claim" re-keying (moving a credential from sentinel to a real `orgId`) hasn't been performed for a given connector. Once a credential has been explicitly claimed by an org, rolling back the *code* is still safe (the three-tier fallback still resolves it), but rolling back would mean that credential briefly becomes visible again under the sentinel to whatever the pre-migration access pattern was — so rollback after real-world claiming should be treated as a one-way door per connector, not per deployment.
