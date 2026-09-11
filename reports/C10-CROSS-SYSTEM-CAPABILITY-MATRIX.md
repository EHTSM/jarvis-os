# C.10 — CROSS-SYSTEM CAPABILITY MATRIX

Date: 2026-08-14/15 · Branch: `security/reality-completion`

`PRODUCTION READY` · `FIXED` · `VERIFY` · `NOT MEASURED` · `CREDENTIAL BLOCKED` · `ENVIRONMENT BLOCKED` · `GENUINE GAP` · `N/A`

---

## 26-area system map

| # | Area | Wiring | Tenant scoping model | Classification |
|---|---|---|---|---|
| A | Identity/Organization | FULL | `orgId`, real RBAC (`requireOrgMember`/`requireOrgPermission`) | PRODUCTION READY |
| B | Workspace context | FULL | `workspaceId`, per-account active-workspace map | PRODUCTION READY |
| C | Business OS | FULL (UI→route→service→store) | `orgId`, but **opt-in** — service's own comments document unscoped legacy records and silent cross-tenant operation when `orgId` is omitted at a call site | VERIFY (real and working for every call site tested; the opt-in design is a genuine latent risk) |
| D | Marketing/Growth OS | FULL | `orgId`, explicitly refuses to return unscoped data | PRODUCTION READY |
| E | "Sales OS" | N/A as a distinct system | Absorbed into CRM + Business OS | N/A — not a real gap, a template/reality mismatch |
| F | "Finance OS" | N/A as one distinct system | Split: `revenueOS.js` (platform-wide, operator-only), `billing.js` (per-account), `business.js` `/business/revenue*` (per-org, real, tested) | N/A as unified concept; the per-org piece is PRODUCTION READY |
| G | Developer/Engineering OS | FULL, but was P0-exposed | `/coding/*` (AI-facing) real per C.9; `/dev/*` (entity store) had **zero auth** (FIXED this session) and **zero org scoping** (documented gap) | **FIXED** (auth) / **GENUINE GAP** (tenant isolation) |
| H | Memory OS | FULL wiring, 3 parallel backends | **None** — zero `orgId` anywhere in any of the 3 memory engines | GENUINE GAP (unchanged from C.9, broader than previously scoped — now confirmed 3 separate unreconciled systems) |
| I | Mission OS | FULL | `orgId`/`teamId`/`deptId` exist at the metadata level; individual `/mission/*` routes don't independently filter | VERIFY |
| J | Executive OS | PARTIAL | `/eos/v6/*` platform-wide operator-only (correctly gated, confirmed 403 for non-operator); `/org-executive/:orgId/*` genuinely org-scoped | PRODUCTION READY (as two correctly-separated concepts, not one) |
| K | Organization OS | FULL | Same as A — effectively the same subsystem | PRODUCTION READY |
| L | Customer Success OS | FULL, recently hardened | `orgId`, live-verified fixed (see Security report) | PRODUCTION READY |
| M | Support OS (sub-module of L) | FULL backend, honestly-labeled demo frontend | `orgId`, live-verified read+write isolation | PRODUCTION READY (backend) / GENUINE GAP (frontend never calls it, but discloses this honestly via `SampleDataNotice`) |
| N | Automation OS | PARTIAL — CRUD real, execution loop absent | `workspaceId` (structurally different model from the `orgId` used elsewhere) | GENUINE GAP — no delete route, no live trigger/execution loop, no resume endpoint |
| O | Creative Studio | FULL | `orgId`, real asset library scoping | PRODUCTION READY |
| P | AI Workspace | Backend composed correctly, no confirmed frontend | `orgId` throughout | VERIFY (backend PRODUCTION READY, frontend NOT MEASURED — no consumer found) |
| Q | Runtime OS | FULL | N/A (execution history is explicitly ephemeral, in-memory only) | PRODUCTION READY, with an inherent, documented (in-code) persistence limitation |
| R | Agent OS | FULL but diffuse | Runtime/mission-linked | PRODUCTION READY — UI is a composite over 4+ legacy phase-numbered APIs, not one direct surface |
| S | Integration OS | FULL, 3 parallel backends | Mixed — `integrations.js` platform-wide/unscoped, `myConnectors.js` genuinely org-scoped | VERIFY |
| T | Product OS | FULL | Single-tenant model (not built for multi-org) | PRODUCTION READY (for its actual, narrower scope) |
| U | Knowledge OS | Backend FULL, frontend **100% fabricated** | 2 of 3 backends unscoped; frontend never calls any of them | GENUINE GAP — the "Knowledge" tab shown to users renders hardcoded seed data and never makes a network call |
| V | Enterprise OS | 3 non-integrated backends, 1 UI tab uses only 1 of them | The one actually wired backend (`enterpriseOS.cjs`) uses its own independent membership model, not `organizationService.cjs` | VERIFY — real risk of the two membership models drifting apart |
| W | Ecosystem OS | PARTIAL | `orgId`-adjacent, separate `data/ecosystem/*` store | PRODUCTION READY (status/summary only; deeper routes unexposed in UI) |
| X | Civilization OS | PARTIAL | Separate `data/civilization/*` store | PRODUCTION READY (status/summary only) |
| Y | Autonomous OS | PARTIAL | Separate `data/autonomous/*` store | PRODUCTION READY (status/summary only) |
| Z | Platform OS | Backend FULL, **zero frontend consumer found** | `orgId`-scoped deployment/version functions | GENUINE GAP — real backend, no UI wiring; the shared status component that surfaces J/V/W/X/Y explicitly omits Platform |

## 7 cross-OS flows

| Flow | Result |
|---|---|
| 1. Lead→Qualification→Opportunity→Close-Won→Revenue→Finance→Executive | **PASS through Revenue** (live-tested, $50,000 real linked flow); **FAILS the literal "Finance/Executive" hop** — no single Finance OS exists, and Executive OS's operator-only surface cannot be reached by the org that generated the revenue |
| 2. CRM identity→Audience→Campaign→Delivery→Analytics→Executive | **PASS on identity/campaign; HONEST FAILURE on delivery** (real, structurally accurate 400 — no email field in this phone-first CRM, not a fake "sent") |
| 3. Customer→Onboarding→CS→Support→Escalation→Executive | **PASS**, live-verified read+write tenant isolation on support tickets; a stale in-code comment claiming an open gap was proven FIXED by live test |
| 4. Command→AI Workspace→Memory/Knowledge→Mission→Agent→Runtime→history | **PASS at AI/Mission/History** (reuses C.9's extensive evidence); Memory hop confirmed still has zero org scoping |
| 5. Developer request→AI/Developer OS→mission→execution→history | **PASS on `/coding/*`** (C.9); **P0 found and FIXED on `/dev/*`** (zero auth); tenant isolation within Developer OS remains a genuine gap |
| 6. Automation trigger→Mission/Runtime→execution→event→outcome | **GENUINE GAP** — rules can be created and dry-run (simulated) only; no live automatic execution loop is wired |
| 7. Organization→Workspace→Department→Team→Role→Permissions→OS access→Audit | **PASS**, fully live-verified (direct-ID and forged-header tests both correctly blocked) |

## Tenant isolation — summary of live tests performed

| Surface | Read isolation | Write isolation | Result |
|---|---|---|---|
| `/orgs/:orgId/departments` | Tested | Tested | PASS (403 both directions) |
| `/orgs/me/context` with forged `X-Org-Id` | Tested | N/A | PASS (header ignored, own data returned) |
| `/customer-org/support/ticket/:id` | Tested | Tested | PASS (404 both — read AND resolve; contradicts a stale comment claiming resolve was open) |
| `/business/leads`, `/business/opportunities`, `/business/revenue` | Tested (own-org data only observed) | Tested (creation correctly org-tagged) | PASS |
| `/dev/repos` (Developer OS) | Tested | Tested | **FAIL, now partially FIXED** — auth gate closed; cross-tenant visibility among authenticated users remains open (documented gap) |
| `/cbeta/billing/credits/:accountId` | Tested | Tested | **FAIL, FIXED this session** — both read and write cross-account access confirmed live, then closed with `operatorOnly` |
| Prior C.9 findings (mission-context, coding patch-history) | Re-confirmed present | Re-confirmed present | Unchanged, still GENUINE GAP (documented, not rebuilt) |

## Authorization boundaries — live-verified

| Check | Result |
|---|---|
| Org owner ≠ platform operator | PASS — `/revenue/dashboard` and `/crm` both correctly 403 for a real org-owner account |
| Forged org header cannot widen access | PASS — tested on `/orgs/me/context` |
| Direct ID cannot bypass ownership | PASS — tested on departments, support tickets, business leads/opportunities |
| Unauthenticated access to privileged surfaces | **FAIL, then FIXED** — `/dev/*` (36 routes) was fully open; now requires a session |

## Persistence / restart

| Record type | Survived restart | Data correct | Duplicates |
|---|---|---|---|
| Business lead | Yes | Yes (status: qualified) | No |
| Opportunity | Yes | Yes (stage: closed-won, value: 50000) | No |
| Revenue record | Yes | Yes (total: 1, correctly linked) | No |
| Organization department | Yes | Yes | No |
| Support ticket | Yes | Yes (status: resolved) | No |

**Result: PASS** — full cross-OS persistence integrity confirmed across two real backend restarts during this audit.

## Failure honesty

| Scenario | Result |
|---|---|
| Email campaign send with no real recipient list | Real 400 with a structurally accurate explanation — not a fake "sent" |
| Unauthenticated `/dev/*` access (before fix) | Was a fake-success 200/201 for anyone — this itself was a form of dishonesty (implying the request was authorized when the system had no way to know who made it) |
| Cross-account billing forgery (before fix) | Was a real 200 success on a forged financial write — the most severe form of "success reported when it should have failed" found in this audit |

## Performance (spot measurements, representative calls)

| Call | Latency |
|---|---|
| `POST /business/leads` (create) | 169ms |
| `GET /business/opportunities` (list) | 86ms |
| `GET /business/dashboard` (aggregate) | 83ms |
| `GET /customer-org/support/tickets` (list) | 223ms |

No call exceeded 250ms. No performance defect found in the flows tested — not exhaustive across all 152 route files, but representative of the cross-OS flows this mission asked to measure.

## Regression / Build

| Check | Result |
|---|---|
| `npm run test:runtime` | **181/181**, 0 fail, 0 skipped (176 pre-existing + 5 new C.10 tests) |
| Negative-test self-check | Both C.10 fixes (`/dev/*` auth, `/cbeta/billing` operatorOnly) independently reverted and confirmed the regression suite catches them, then restored |
| `.env` | Untouched throughout |
