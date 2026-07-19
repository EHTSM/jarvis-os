# 09 — SaaS Model

**Status of this document:** VERIFIED against `backend/routes/billing.js`, `backend/services/billingService.js`, `backend/middleware/orgMiddleware.cjs`, and `CUSTOMER_ONBOARDING.md`. PLANNED items (marketplace liquidity, broader monetization) are marked explicitly.

---

## Business Model Today

Ooplix is a **subscription SaaS product with a free trial**, currently in **closed beta**, deployed as both a hosted web/VPS product and a downloadable desktop app (see [02_CURRENT_PROJECT_STATUS.md](02_CURRENT_PROJECT_STATUS.md) for desktop-distribution caveats).

### Plans (VERIFIED — `backend/services/billingService.js`)

| Plan | Price (INR/month) | Monthly AI request quota |
|---|---|---|
| Trial | Free, 7 days | 200 |
| Starter | 999 | 2,000 |
| Growth | 2,499 | 10,000 |
| Scale | Custom/enterprise (0 in code — presumably negotiated) | Unlimited |
| Cancelled | — | 0 (access blocked) |

- **Trial logic**: 7-day trial (`TRIAL_DAYS=7`), then a 24-hour grace period where access still works with a banner, then a hard block.
- **Usage quota enforcement**: `requireUsageQuota` middleware returns HTTP 429 when a plan's monthly AI-request quota is exceeded. Local Ollama requests are excluded from quota counting.
- **Upgrade flow**: `POST /billing/upgrade` creates a real Razorpay subscription (`rz.subscriptions.create()`) if a `RAZORPAY_PLAN_ID_*` env var is set for the target plan; otherwise falls back to a one-time payment link. **Currently, the plan-ID env vars are not provisioned** — paid upgrades cannot complete in the live environment (see [02_CURRENT_PROJECT_STATUS.md](02_CURRENT_PROJECT_STATUS.md) blocker B7).
- **Cancel flow**: `POST /billing/cancel` sets status to "cancelled." **A discrepancy was found**: the user-facing cancellation message says access "continues until end of billing period," but the actual `checkAccess()` logic treats `cancelled` as immediately `allowed: false` — this should be fixed or the message corrected before relying on it in customer communication.
- **Manual/operator activation** exists separately from webhook-driven activation, for founder-assisted onboarding.

This is a **real payment integration** (live Razorpay SDK calls, real HMAC webhook verification), not a data-model-only stub — independently confirmed by two separate research passes in this documentation effort.

## Founder Mode vs. Customer Mode

**Not implemented as a distinct code concept.** A direct search for `founderMode`/`isFounder`/`customerMode` across the codebase found no such toggle. The closest real mechanism is a coarse `role: "operator"` vs. regular-user distinction used in billing and auth. If "Founder Mode" vs. "Customer Mode" is a desired product concept, it does not exist today and would need to be designed — this is a **PLANNED** gap, not a mislabeled existing feature.

## Multi-Workspace / Organizations

**Real, live-tested.** `backend/middleware/orgMiddleware.cjs` implements a two-tier authorization model: coarse operator/non-operator authentication, plus organization-scoped permissions (`requireOrgMember`, `requireOrgPermission`) layered on top. Org RBAC and workspace membership were both live-verified in the 2026-07-17 audit to correctly return 403 to a second "attacker" identity on both read and privileged (delete) operations.

- **Limits** (per `CHANGELOG.md` rc1): max 5 organizations and max 10 workspaces per account.
- **Workspace creation** is live-verified: `POST /workspace` creates a real workspace with a generated ID, creator auto-assigned Owner role.

**The critical caveat, repeated throughout this documentation because it is the single most consequential architectural fact**: this authorization logic is real, but it is the *only* isolation boundary. There is no database-enforced tenant isolation behind it — all state lives in flat JSON files. See [19_RISK_REGISTER.md](19_RISK_REGISTER.md) R2.

## Permissions

RBAC is real at the organization level (`hasPermission()` in the organization service, gated via `requireOrgPermission(action)`). A `ROLE_MATRIX.md` exists at the repo root documenting the intended role structure in more detail (not independently re-verified line-by-line in this audit — flagged as available for closer review).

## Billing

Covered above. Summary: real Razorpay integration, INR-denominated pricing, quota-based plan gating, feature-gating via `requireFeature()` (live-verified: a trial-plan account correctly receives 402 `feature_gated` with an upgrade-path message when hitting a Starter-or-higher-gated route like the marketplace catalog).

## Marketplace

`backend/routes/autonomousMarketplace.js` implements a real asset marketplace with **13 asset types** (agent, workflow, blueprint, product_template, company_template, plugin, sdk_package, automation_pack, design_system, ui_component, knowledge_pack, prompt_pack, deployment_recipe) and supporting engines: catalog, recommendation, certification, automation (lifecycle scan), economy (usage tracking, ratings), dashboard. A separate `marketplace.js` route handles third-party connector submission/review workflow.

**This is real, complete code — but there is no evidence of external sellers or buyers using it yet.** It should be treated as **internal scaffolding ready for a marketplace launch**, not an active two-sided marketplace with real transaction volume. This is a PARTIAL classification: the infrastructure is REAL, the market itself is not yet populated.

## Closed Beta State (VERIFIED — `CUSTOMER_ONBOARDING.md`)

Ooplix is currently in closed beta:
- Registration requires a valid invite code, **enforced server-side** (`co3UserSuccess.cjs`'s `checkBetaGate`), not just a UI gate.
- Capped at 50 accounts (`BETA_MAX_USERS`, default 50).
- **A real gap the founder has flagged explicitly**: mobile (Firebase) login auto-creates accounts and bypasses the invite-code gate entirely — worth fixing before wide mobile distribution during the beta period.

## Future Monetization (PLANNED)

Beyond the current subscription model, the codebase's architecture points toward but has not yet activated:
- **Marketplace transaction revenue** — the asset marketplace's economy engine already tracks usage/ratings; a real revenue-share or paid-listing model is not yet wired to actual payments.
- **Per-company billing** under the Company Factory model — see [10_17_COMPANY_STRATEGY.md](10_17_COMPANY_STRATEGY.md); requires the tenant-isolation work to be safe at scale.
- **Enterprise/Scale plan** — priced at 0 in the current plan table, implying manual/negotiated pricing rather than a self-serve enterprise tier.

---

*Next: [10_17_COMPANY_STRATEGY.md](10_17_COMPANY_STRATEGY.md) for the multi-company operating model.*
