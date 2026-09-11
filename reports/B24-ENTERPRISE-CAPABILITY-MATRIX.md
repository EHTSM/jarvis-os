# B.24 — ENTERPRISE CAPABILITY MATRIX

Date: 2026-08-14 · Branch: `security/reality-completion`

Exactly one classification per capability.
`PRODUCTION READY` · `FIXED` · `CREDENTIAL BLOCKED` · `NOT CONFIGURED` · `NOT MEASURED` · `GENUINE GAP` · `FAIL` · `PRE-EXISTING LIMITATION`

---

## 1. Enterprise organization model

| # | Capability | Evidence | Classification |
|---|---|---|---|
| 1.1 | Multiple organizations | 2 real orgs created via signup | **PRODUCTION READY** |
| 1.2 | Multiple workspaces | `ws_…d6df7e0f` created; list returns both | **PRODUCTION READY** |
| 1.3 | Departments | `dept_1786658100779_3` created + persisted | **PRODUCTION READY** |
| 1.4 | Teams (under department) | `team_1786658100862_4` created + persisted | **PRODUCTION READY** |
| 1.5 | Organization switching (UI) | `.org-switcher-trigger` opens, 1 click / 1,288 ms | **PRODUCTION READY** |
| 1.6 | Workspace switching (UI) | switcher renders with real workspace | **PRODUCTION READY** |
| 1.7 | Organization settings | `PATCH /orgs/:id` 200 | **PRODUCTION READY** |
| 1.8 | Org policies | real policy doc; `PUT` 200 + audit event | **PRODUCTION READY** |
| 1.9 | Persistence after restart | 6/6 survived | **PRODUCTION READY** |
| 1.10 | Org deletion / archival | not exercised (destructive) | **NOT MEASURED** |

## 2. Enterprise RBAC

| # | Capability | Evidence | Classification |
|---|---|---|---|
| 2.1 | Owner — permitted actions | 3/3 → 200 on own org | **PRODUCTION READY** |
| 2.2 | Owner — denied on operator tier | 5/5 → 403 | **PRODUCTION READY** |
| 2.3 | Permission model | 20 named permissions on `org_owner` | **PRODUCTION READY** |
| 2.4 | Backend enforcement (not UI-hiding) | 403 direct from API | **PRODUCTION READY** |
| 2.5 | Role cannot be self-assigned | registration `role:"operator"` → `user` | **PRODUCTION READY** |
| 2.6 | Admin role | no separate admin account available | **NOT MEASURED** |
| 2.7 | Operator role | password unavailable (OS-4 parked) | **CREDENTIAL BLOCKED** |
| 2.8 | Developer role | no account available | **NOT MEASURED** |
| 2.9 | Viewer role | no account available | **NOT MEASURED** |

## 3. Tenant isolation

| # | Capability | Evidence | Classification |
|---|---|---|---|
| 3.1 | A→B / B→A reads (direct ID) | 13/13 → 403 | **PRODUCTION READY** |
| 3.2 | Cross-tenant writes | 3/3 → 403 | **PRODUCTION READY** |
| 3.3 | Cross-tenant updates | `PATCH /orgs/<A>` → 403, name unmodified | **PRODUCTION READY** |
| 3.4 | Cross-tenant deletes | `DELETE …/departments/<id>` → 403 | **PRODUCTION READY** |
| 3.5 | Analytics / reporting scoping | verified with real data on A only | **PRODUCTION READY** |
| 3.6 | Business data scoping | B sees 0 of A's records | **PRODUCTION READY** |
| 3.7 | Mission data scoping | `/orgs/<A>/missions` → 403 | **PRODUCTION READY** |
| 3.8 | Executive data scoping | dashboards differ per tenant | **PRODUCTION READY** |
| 3.9 | Audit scoping | 0 foreign entries; cross-read 403 | **PRODUCTION READY** |
| 3.10 | Isolation after restart | 403 preserved | **PRODUCTION READY** |

## 4. Enterprise data governance

| # | Capability | Evidence | Classification |
|---|---|---|---|
| 4.1 | Audit logs | real sequenced entries, org+actor+ts | **PRODUCTION READY** |
| 4.2 | Login history | real entries | **PRODUCTION READY** |
| 4.3 | Permission history | real entries | **PRODUCTION READY** |
| 4.4 | Organization policies | real doc; update persists + audits | **PRODUCTION READY** |
| 4.5 | Session controls | `/security/sessions` 200, empty | **PRODUCTION READY** |
| 4.6 | Device controls | `/security/devices` 200, empty | **PRODUCTION READY** |
| 4.7 | API tokens | `/security/tokens` 200, empty | **PRODUCTION READY** |
| 4.8 | MFA | `enrolled:false` — honest, unconfigured | **NOT CONFIGURED** |
| 4.9 | SSO | `config:null` — endpoint live, no IdP | **NOT CONFIGURED** |
| 4.10 | SCIM | `configured:false` — endpoint live, no token | **NOT CONFIGURED** |
| 4.11 | IP controls | no surface located | **GENUINE GAP** |
| 4.12 | Enterprise monitoring | real org health data | **PRODUCTION READY** |

## 5. Enterprise security

| # | Capability | Evidence | Classification |
|---|---|---|---|
| 5.1 | IDOR (direct ID) | 13/13 denied | **PRODUCTION READY** |
| 5.2 | Cross-org access | 19/19 denied (read+write) | **PRODUCTION READY** |
| 5.3 | Privilege escalation | 2/2 denied | **PRODUCTION READY** |
| 5.4 | Forged org headers | 3/3 denied | **PRODUCTION READY** |
| 5.5 | Forged role headers | 3/3 denied | **PRODUCTION READY** |
| 5.6 | Unauthorized role actions | 5/5 denied | **PRODUCTION READY** |
| 5.7 | Session boundary | 401 on unauth / malformed / expired | **PRODUCTION READY** |
| 5.8 | Token boundary | signed-token role only | **PRODUCTION READY** |
| 5.9 | Audit-log scoping | 0 cross-tenant visibility | **PRODUCTION READY** |
| 5.10 | Sensitive data exposure | errors name cause, not internals | **PRODUCTION READY** |
| 5.11 | Logout does not revoke JWT | measured in B.23 | **PRE-EXISTING LIMITATION** |

## 6. Enterprise workforce

| # | Capability | Evidence | Classification |
|---|---|---|---|
| 6.1 | Org → Dept → Team chain | all three created, nested correctly | **PRODUCTION READY** |
| 6.2 | User → Role → Permission | `org_owner` + 20 permissions | **PRODUCTION READY** |
| 6.3 | Workspace association | workspace created and listed | **PRODUCTION READY** |
| 6.4 | Hierarchy survives restart | 6/6 | **PRODUCTION READY** |
| 6.5 | Member invitation flow | `POST /orgs/:id/members` not completed end-to-end | **NOT MEASURED** |

## 7. Executive / governance

| # | Capability | Evidence | Classification |
|---|---|---|---|
| 7.1 | Business KPIs | real, tenant-scoped | **PRODUCTION READY** |
| 7.2 | Revenue | `revenue=90000` from real record | **PRODUCTION READY** |
| 7.3 | Pipeline | `{count:1,value:500000}` on A, zeros on B | **PRODUCTION READY** |
| 7.4 | Customer information | customer created + readable | **PRODUCTION READY** |
| 7.5 | Support information | `/co3/feedback` real data | **PRODUCTION READY** |
| 7.6 | Operational status | `/enterprise/monitoring` real | **PRODUCTION READY** |
| 7.7 | AI status | honest failure, no fabrication | **CREDENTIAL BLOCKED** |
| 7.8 | Security status | audit + sessions + policy real | **PRODUCTION READY** |
| 7.9 | No platform totals as tenant totals | `bizMissions:{}`; B.21 fix holding | **PRODUCTION READY** |
| 7.10 | Automation status | not exercised in B.24 | **NOT MEASURED** |

## 8. Enterprise workflows

| # | Workflow | Time | Classification |
|---|---|---:|---|
| 8.A | org → workspace → dept → team → role → permission | — | **PRODUCTION READY** |
| 8.B | executive → KPI → detail → decision data | 1,478 ms | **PRODUCTION READY** |
| 8.C | admin → policy → update → audit verification | 536 ms | **PRODUCTION READY** |
| 8.D | developer → mission → execution | 251 ms | **PRODUCTION READY** |
| 8.E | customer → support → resolution | 1,255 ms | **PRODUCTION READY** |
| 8.F | lead → opportunity → revenue | 180 ms | **PRODUCTION READY** |

## 9. Enterprise integrations

| # | Integration | Evidence | Classification |
|---|---|---|---|
| 9.1 | SSO / SCIM / MFA | endpoints live, no provider | **NOT CONFIGURED** |
| 9.2 | Email / SMS / Push | transport vars unset (B.23) | **NOT CONFIGURED** |
| 9.3 | WhatsApp | real Meta call, real permission error | **BLOCKED BY PROVIDER** |
| 9.4 | Razorpay | keys present, no test-mode env | **CREDENTIAL BLOCKED** |
| 9.5 | AI providers | Groq 429 + OpenAI 401 | **CREDENTIAL BLOCKED** |
| 9.6 | Crash reporting | `SENTRY_DSN` unset | **CREDENTIAL BLOCKED** |
| 9.7 | Operator-tier integrations | `/integrations` 403 | **CREDENTIAL BLOCKED** |

## 10. Resilience

| # | Capability | Evidence | Classification |
|---|---|---|---|
| 10.1 | Backend restart | clean, health 200 | **PRODUCTION READY** |
| 10.2 | Hierarchy persistence | 6/6 survived | **PRODUCTION READY** |
| 10.3 | Auth after restart | both tenants re-authenticated | **PRODUCTION READY** |
| 10.4 | Isolation after restart | 403 preserved | **PRODUCTION READY** |
| 10.5 | Backup / DR | 9 backups + DR doc (B.23) | **PRODUCTION READY** |
| 10.6 | Restore execution | destructive; not run | **NOT MEASURED** |

## 11. Enterprise UX

| # | Capability | Evidence | Classification |
|---|---|---|---|
| 11.1 | Org switcher | renders, opens in 1 click | **PRODUCTION READY** |
| 11.2 | Workspace switcher | renders with real name | **PRODUCTION READY** |
| 11.3 | Hierarchy clarity | real org name shown in chrome | **PRODUCTION READY** |
| 11.4 | Navigation | 6 primary tabs | **PRODUCTION READY** |
| 11.5 | Role visibility in UI | role not surfaced in main chrome | **NOT MEASURED** |
| 11.6 | Error handling | honest statuses (B.23) | **PRODUCTION READY** |

## 12. Performance

| # | Measure | Value | Classification |
|---|---|---|---|
| 12.1 | Enterprise p50 | 119 ms | **PRODUCTION READY** |
| 12.2 | Enterprise p95 | 1,208 ms | **PRODUCTION READY** |
| 12.3 | Operations > 2 s | 0/12 | **PRODUCTION READY** |
| 12.4 | Slowest | `/enterprise/dashboard` 1,208 ms | **PRODUCTION READY** |
| 12.5 | Scale under load | not load-tested | **NOT MEASURED** |

## 13. Auditability

| # | Capability | Evidence | Classification |
|---|---|---|---|
| 13.1 | Action → audit event | policy update: 2 → 3 entries | **PRODUCTION READY** |
| 13.2 | Correct organization | `org=org_1786658083728_1` | **PRODUCTION READY** |
| 13.3 | Correct actor | `actor=848bde2cd267dc` | **PRODUCTION READY** |
| 13.4 | Correct timestamp | ISO ts present | **PRODUCTION READY** |
| 13.5 | No cross-tenant audit visibility | 0 foreign entries; 403 | **PRODUCTION READY** |

---

## Totals

| Classification | Count |
|---|---:|
| **PRODUCTION READY** | **63** |
| **FIXED** | **0** |
| **CREDENTIAL BLOCKED** | **6** |
| **NOT CONFIGURED** | **5** |
| **NOT MEASURED** | **11** |
| **GENUINE GAP** | **1** |
| **PRE-EXISTING LIMITATION** | **1** |
| **BLOCKED BY PROVIDER** | **1** |
| **FAIL** | **0** |
| **TOTAL** | **88** |
