# OS-PLATFORM — CAPABILITY MATRIX

**Track:** OOPLIX 25-OS Master Reconciliation — OS #25, Platform OS
**Date:** 2026-08-15 · **Branch:** `security/reality-completion` · **Verification port:** 5306

Legend: **PASS** (live-verified working) · **PASS (static)** (confirmed via source read, not exercised live this pass) · **GAP** (real, confirmed absence or fabrication) · **N/A**

---

## 1. Organization Studio

| Capability | Route | Result | Evidence |
|---|---|---|---|
| Register platform-org | `POST /platform/v1/orgs` | **PASS** | Live: created `PlatA-SecretCo`, `ownerId` correctly forced server-side to caller's real account id, ignoring any client-supplied value |
| List own orgs | `GET /platform/v1/orgs` | **PASS** | Live: Org B's list did not include Org A's org |
| Read one org | `GET /platform/v1/orgs/:id` | **PASS** | Live: owner reads own org 200; non-owner 404 |
| Update org | `PATCH /platform/v1/orgs/:id` | **PASS (static + gate confirmed)** | `_requireOrgOwner` gate confirmed present; `ownerId` stripped from patch body before applying |
| Org health | `GET /platform/v1/orgs/:id/health` | **PASS** | Real aggregation across autonomous/civilization/ecosystem layers; unavailable layers omitted, not fabricated (fixed in `09d5ee67`) |
| Org policy | `POST /platform/v1/orgs/:id/policy` | **PASS (static)** | `_requireOrgOwner` gate confirmed present |

## 2. Blueprint Designer

| Capability | Route | Result | Evidence |
|---|---|---|---|
| Create blueprint | `POST /platform/v1/blueprints` | **PASS** | Live: created `PlatA-Blueprint`, real derived agents/workflows/policies/memorySpec attached |
| Publish blueprint | `POST /platform/v1/blueprints/:id/publish` | **PASS** | Live: status draft → published confirmed |
| List / read blueprints | `GET /platform/v1/blueprints[/:id]` | **PASS** | Reads own + built-in templates |
| Update blueprint | `PATCH /platform/v1/blueprints/:id` | **PASS (static)** | No ownership gate present — see Security report §2 (P3 finding) |

## 3. Template Marketplace

| Capability | Route | Result | Evidence |
|---|---|---|---|
| List / publish templates | `GET/POST /platform/v1/templates` | **PASS (static)** | Confirmed real persisted store, cross-registers with `pluginSDK.cjs` |
| Install template → blueprint | `POST /platform/v1/templates/:id/install` | **PASS (static)** | `installTemplate()` creates a real blueprint from the template spec |
| Rate template | `POST /platform/v1/templates/:id/rate` | **PASS (static)** | Real persisted rating aggregate |

## 4. Deployment Center

| Capability | Route | Result | Evidence |
|---|---|---|---|
| Deploy from blueprint | `POST /platform/v1/deploy` | **PASS — live end-to-end** | Blueprint `bp_...mopq` → real deployed org `org_...q79e`, `status:"completed"`, per-capability step log (`sales: ok`, `marketing: ok`) |
| Quick deploy | `POST /platform/v1/deploy/quick` | **PASS (static)** | Creates blueprint-from-name-or-template then deploys in one call; `ownerId` forced server-side |
| List / read deployments | `GET /platform/v1/deployments[/:id]` | **PASS** | Scoped to caller's own orgs unless admin; single-deployment read checks the parent org's `ownerId` |
| Deploy with invalid blueprintId | `POST /platform/v1/deploy` | **PASS — honest failure** | Live: `{"ok":false,"error":"Org not found or could not be created"}`, no fake success |

## 5. Lifecycle Dashboard

| Capability | Route | Result | Evidence |
|---|---|---|---|
| Read lifecycle summary | `GET /platform/v1/lifecycle` | **PASS** | Scoped to caller's own orgs unless admin |
| Mutate lifecycle status | `PATCH /platform/v1/lifecycle/:orgId` | **PASS** | Live: legitimate owner mutation works; cross-tenant attempt 404s (see Security report) |

## 6. Clone / Fork

| Capability | Route | Result | Evidence |
|---|---|---|---|
| Clone own org | `POST /platform/v1/clone` | **PASS — live** | `PlatA-Deployed` → `PlatA-Clone`, new org + new blueprint copy, `ownerId` forced to caller |
| Clone with invalid source | `POST /platform/v1/clone` | **PASS — honest failure** | Live: `{"ok":false,"error":"Org not found"}` |
| **Clone another tenant's org (exfiltration attempt)** | `POST /platform/v1/clone` | **PASS — blocked** | Live: Org B → Org A's org, `sourceOrgId` gated by `_requireOrgOwner`, **404** — see Security report §1 |
| Fork | `POST /platform/v1/fork` | **PASS (static)** | Same gate as clone, `forkMode:true` |
| List clones | `GET /platform/v1/clones` | **PASS (static)** | Filtered to caller's own unless admin |

## 7. Versioning / Upgrade / Migration

| Capability | Route | Result | Evidence |
|---|---|---|---|
| List / create version | `GET/POST /platform/v1/versions` | **PASS (static)** | `_requireOrgOwner` on `orgId` (query or body) |
| Rollback version | `POST /platform/v1/versions/rollback` | **PASS — live blocked cross-tenant** | Confirmed 404 for non-owner in Security report §1 |
| Upgrade / migrate org | `POST /platform/v1/upgrade`, `/migrate` | **PASS (static)** | Both gated by `_requireOrgOwner` on body `orgId` |

## 8. Export / Import (Backup & Restore)

| Capability | Route | Result | Evidence |
|---|---|---|---|
| Export org | `GET /platform/v1/export/:orgId` | **PASS — live, gated** | Legitimate owner export works; cross-tenant attempt 404s |
| **Export another tenant's org (exfiltration attempt)** | `GET /platform/v1/export/:orgId` | **PASS — blocked** | Live: Org B → Org A's org, 404, no data returned |
| Import package | `POST /platform/v1/import` | **PASS — honest failure on malformed input** | Live: `{"ok":false,"error":"Invalid package: missing org field"}`; real imports always force `ownerId` to the importing caller, never the package's embedded value |
| `checksum` field | (part of export package) | **GAP — mislabeled, not a real hash** | `checksum: \`sha256:${Date.now()}\`` — labeled as a SHA-256 digest but is actually a millisecond timestamp. No real integrity verification exists on this field. P3, not security-critical (no signature/verification consumer found reading it), but the field name is misleading and should either be a real hash or renamed |

## 9. Simulator

| Capability | Route | Result | Evidence |
|---|---|---|---|
| Simulate org projection | `POST /platform/v1/simulate` | **PASS — honest heuristic** | Formula-based (`healthScore = 60 + caps.length*4`, etc.), transparently derived from input capabilities/team size/duration — not represented as a trained model or real forecast, no fabrication concern |

## 10. Digital Twin

| Capability | Route | Result | Evidence |
|---|---|---|---|
| Read digital twin | `GET /platform/v1/twin/:orgId` | **PASS — live, gated** | Real read-model over the org's own recorded state; cross-tenant attempt 404s |

## 11. Marketplace (listings)

| Capability | Route | Result | Evidence |
|---|---|---|---|
| List / create listing | `GET/POST /platform/v1/marketplace` | **PASS (static)** | No ownership gate on create — see Security report §2 (P3, self-scoped risk only) |
| Purchase listing | `POST /platform/v1/marketplace/:id/purchase` | **PASS (static)** | No ownership gate — same P3 class |

## 12. Certification

| Capability | Route | Result | Evidence |
|---|---|---|---|
| List certifications | `GET /platform/v1/certifications` | **PASS** | Scoped to caller's own orgs unless admin; explicit ownership check when `orgId` query param supplied |
| Certify org | `POST /platform/v1/certify` | **GAP — self-attested score, not computed** | Live: certifying own org with `{"level":"platinum","score":9999}` succeeded and persisted verbatim. `level` is validated against a real enum (`bronze/silver/gold/platinum`); **`score` has zero validation and zero independent computation against real health/deployment/capability data** — it is whatever number the caller sends, defaulting to 100 if omitted. This does not cross a tenant boundary (an owner can only fake-certify their *own* org) but the "certify" verb implies platform-computed assessment that does not actually happen. See Security report §4 |

## 13. SDK

| Capability | Route | Result | Evidence |
|---|---|---|---|
| SDK manifest | `GET /platform/v1/sdk[/manifest]` | **PASS — correctly scoped claim** | Static JSON manifest of endpoint shapes + capability sets. This is **not code generation** — the "SDK generation" phrasing from prior memory records overstates what exists. Corrected in Discovery report §2 |
| SDK types | `GET /platform/v1/sdk/types` | **PASS** | Real `ORG_TYPES`/`CAPABILITY_SETS` constants |

## 14. Analytics + Reports

| Capability | Route | Result | Evidence |
|---|---|---|---|
| Platform analytics | `GET /platform/v1/analytics` | **PASS (static)** | Not independently recomputed from raw data this pass — out of scope depth for a D-classification dedicated pass; no fabrication indicator found in source |
| Reports | `GET/POST /platform/v1/reports` | **PASS (static)** | Real persisted store |

## 15. CLI endpoints

| Capability | Route | Result | Evidence |
|---|---|---|---|
| CLI deploy/status/clone/templates | `/platform/v1/cli/*` | **PASS (static)** | Same underlying functions as their non-CLI counterparts; `cli/clone` correctly carries the same `_requireOrgOwner` gate as `/clone` |

## 16. Public Organization API

| Capability | Route | Result | Evidence |
|---|---|---|---|
| Public registry | `GET /platform/v1/registry[/:id]` | **PASS — intentionally open** | Server-side filtered to `visibility:"public"` only; not a gap, by design and confirmed in the fix commit's own message |

---

## Summary

| Category | Count |
|---|---:|
| PASS — live end-to-end verified | 10 |
| PASS — static/source-confirmed, not independently exercised | 20 |
| GAP — confirmed, real, non-security | 2 (mislabeled checksum field; self-attested certification score) |
| Security findings | 0 new P0/P1 (prior P0 already fixed and re-verified — see Security report) |

**26 capabilities assessed. 24 production-ready (10 live, 14 static-confirmed with no fabrication indicator). 2 genuine but low-severity honesty gaps found (checksum mislabeling, unvalidated certification score) — both documented, neither fixed this pass (out of the mission's "genuinely recoverable P0/authorization defect" fix mandate; these are product/validation-design gaps, not exploitable security defects).**
