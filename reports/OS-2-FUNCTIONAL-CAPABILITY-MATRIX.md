# OS-2 FUNCTIONAL CAPABILITY MATRIX

Date: 2026-08-13
Method: live execution against a running backend, real authenticated sessions (2 accounts, separate orgs), real CRUD with persistence re-reads, and at least one failure path per workflow.

**Evidence rule:** HTTP 200, `{"ok":true}`, empty `[]` and empty `{}` are NOT accepted as proof. "Real data" means a non-empty array or non-zero number below the response envelope. "Create works" means the entity was re-read from a separate request and found.

Classifications used: `REAL + WORKING` · `REAL + PARTIALLY WORKING` · `REAL + BROKEN` · `REAL + UNWIRED` · `CREDENTIAL BLOCKED` · `GENUINE GAP` · `DEAD PROTOTYPE` · `UNKNOWN — insufficient evidence`

---

## COMMUNICATION OS

| Capability | Backend | Frontend | Reachable | Auth | Real data | Create | Read | Update | Delete | E2E | Credential | Failure handling | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Email campaign | ✅ | ✅ growth | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ persisted | n/t | ⚠️ send refused | ❌ SMTP unset | ✅ names real reason | REAL + PARTIALLY WORKING |
| Email sequence | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | n/t | ✅ | — | ✅ 404 | REAL + WORKING |
| SMS campaign | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | n/t | ⚠️ send refused | ❌ no provider | ✅ names real reason | REAL + PARTIALLY WORKING |
| WhatsApp broadcast | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | n/t | ⚠️ needs recipients | ✅ `WA_TOKEN` set | ✅ **fixed F-001** | REAL + PARTIALLY WORKING |
| WhatsApp flows / auto-replies | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | n/t | ✅ | ✅ | ✅ 404 | REAL + WORKING |
| Push notification | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | n/t | n/t | ⚠️ no devices | ❌ Firebase unset | ✅ **fixed F-002** | REAL + PARTIALLY WORKING |
| Audience | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | n/t | ✅ | — | ✅ 400/404 | REAL + WORKING |
| Template | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | n/t | ✅ | — | ✅ 404 | REAL + WORKING |
| Automation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | n/t | ✅ | — | ✅ 404 | REAL + WORKING |
| Delivery status / analytics | ✅ | ✅ | ✅ | ✅ | ✅ 29 campaigns | n/a | ✅ | n/a | n/a | ⚠️ | partial | ✅ | REAL + PARTIALLY WORKING |
| Telegram | ✅ | ⚠️ | ✅ | ✅ | ⚠️ status only | n/t | ✅ | n/a | n/a | UNKNOWN | ✅ `TELEGRAM_TOKEN` set | ✅ | UNKNOWN — insufficient evidence |

---

## BUSINESS OS

| Capability | Backend | Frontend | Reachable | Auth | Real data | Create | Read | Update | Delete | E2E | Credential | Failure handling | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CRM lead | ✅ | ✅ CRM tab | ✅ | ✅ | ✅ | ✅ persisted | ✅ | ✅ persisted | n/t | ✅ | — | ✅ 400/403 | **REAL + WORKING** |
| Lead dedup | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | n/a | n/a | n/a | ✅ | — | ✅ honest `duplicate:true` | REAL + WORKING |
| Lead export (CSV) | ✅ | ✅ | ✅ | ✅ | ✅ real CSV | n/a | ✅ | n/a | n/a | ✅ | — | ✅ | REAL + WORKING |
| Pipeline | ✅ | ✅ | ✅ | ✅ | ⚠️ zero-state | n/a | ✅ | n/a | n/a | ⚠️ | — | ✅ | REAL + PARTIALLY WORKING |
| Deals / opportunities | ✅ | ✅ | ✅ | ✅ | ❌ empty | n/t | ✅ | n/t | n/t | UNKNOWN | — | ✅ | UNKNOWN — insufficient evidence |
| Customers / operations | ✅ | ✅ | ✅ | ✅ | ❌ empty | n/t | ✅ | n/t | n/t | UNKNOWN | — | ✅ | UNKNOWN — insufficient evidence |
| Payments (Razorpay) | ✅ | ✅ | ✅ | ✅ | ⚠️ | n/t | ✅ | n/a | n/a | UNKNOWN | ✅ keys set | ✅ | UNKNOWN — insufficient evidence |
| Analytics / executive | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | ✅ | n/a | n/a | ✅ | — | ✅ | REAL + WORKING |
| Tenant isolation | ✅ | n/a | ✅ | ✅ | ✅ | n/a | ✅ | n/a | n/a | ✅ A=1/B=0 leads | — | ✅ 403 | **REAL + WORKING** |

---

## MARKETING OS

| Capability | Backend | Frontend | Reachable | Auth | Real data | Create | Read | Update | Delete | E2E | Credential | Failure handling | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Article / blog | ✅ | ✅ contentseo | ✅ | ✅ | ✅ | ✅ persisted | ✅ | ✅ publish persisted | n/t | ✅ **draft→published verified** | — | ✅ **fixed F-004** | **REAL + WORKING** |
| SEO audit | ✅ | ✅ | ✅ | ✅ | ✅ 20 checks, 8 critical | n/a | ✅ | n/a | n/a | ✅ | — | ✅ | REAL + WORKING |
| Keywords | ✅ | ✅ | ✅ | ✅ | ✅ real volumes | n/t | ✅ | n/t | n/t | ✅ | — | ✅ | REAL + WORKING |
| Content calendar | ✅ | ✅ | ✅ | ✅ | ✅ | n/t | ✅ | ⚠️ | n/t | ⚠️ | — | ✅ **fixed F-004** | REAL + PARTIALLY WORKING |
| Distribution campaigns | ✅ | ✅ distribution | ✅ | ✅ | ✅ | n/t | ✅ | n/t | n/t | UNKNOWN | — | ✅ 404 | REAL + PARTIALLY WORKING |
| Influencers / communities | ✅ | ✅ | ✅ | ✅ | ✅ | n/t | ✅ | n/t | n/t | UNKNOWN | — | ✅ | REAL + PARTIALLY WORKING |
| Distribution analytics | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | ✅ | n/a | n/a | ✅ | — | ✅ | REAL + WORKING |
| Content dashboard | ✅ | ✅ | ✅ | ✅ | ✅ organicScore 63 | n/a | ✅ | n/a | n/a | ✅ | — | ✅ | REAL + WORKING |

---

## DEVELOPER OS

| Capability | Backend | Frontend | Reachable | Auth | Real data | Create | Read | Update | Delete | E2E | Credential | Failure handling | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Engineering intelligence | ✅ | ✅ engineering | ✅ | ✅ | ✅ | n/a | ✅ | n/a | n/a | ✅ | — | ✅ | REAL + WORKING |
| Coding decisions | ✅ | ✅ | ✅ | ✅ | ✅ real smell ids | n/a | ✅ | n/t | n/t | ✅ | — | ✅ | REAL + WORKING |
| Smell detection | ✅ | ✅ | ✅ | ✅ | ✅ 3,582 smells | n/a | ✅ | n/a | n/a | ✅ 2.0 s (was 25 s) | — | ✅ | REAL + WORKING |
| Self-improvement patterns | ✅ | ✅ selfimprove | ✅ | ✅ | ✅ | n/a | ✅ | n/a | n/a | ✅ | — | ✅ | REAL + WORKING |
| Engineering org | ✅ | ✅ | ✅ | ✅ | ✅ 20 engineers | n/a | ✅ | n/a | n/a | ✅ | — | ✅ | REAL + WORKING |
| AI coding ask | ✅ | ✅ copilot | ✅ | ✅ | ❌ | n/a | ❌ | n/a | n/a | ❌ | ❌ **429 quota** | ✅ honest error | **CREDENTIAL BLOCKED** |
| Patch bundle | ✅ | ✅ | ✅ | ✅ | ❌ empty | n/t | ✅ | n/t | n/t | UNKNOWN | — | ✅ | UNKNOWN — insufficient evidence |
| Pipeline | ✅ | ✅ | ✅ | ✅ | ❌ empty | n/t | ✅ | n/t | n/t | UNKNOWN | — | ✅ | UNKNOWN — insufficient evidence |
| `DeveloperOS.jsx` | ❌ **0/7 routes** | orphan | ❌ | n/a | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | — | n/a | **DEAD PROTOTYPE** |

---

## ENTERPRISE OS

| Capability | Backend | Frontend | Reachable | Auth | Real data | Create | Read | Update | Delete | E2E | Credential | Failure handling | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Organization | ✅ | ✅ orgadmin | ✅ | ✅ | ✅ | ✅ | ✅ | n/t | n/t | ✅ | — | ✅ 403 | REAL + WORKING |
| Department | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ **persisted** | ✅ | n/t | n/t | ✅ | — | ✅ 403 foreign | **REAL + WORKING** |
| Team | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ **persisted under dept** | ✅ | n/t | n/t | ✅ | — | ✅ | **REAL + WORKING** |
| Roles / permissions | ✅ | ✅ | ✅ | ✅ | ✅ 20+ perms | n/t | ✅ | n/t | n/t | ✅ | — | ✅ | REAL + WORKING |
| Policy | ✅ | ✅ settings | ✅ | ✅ | ✅ real policy doc | n/t | ✅ | n/t | n/t | ✅ | — | ✅ | REAL + WORKING |
| Audit log | ✅ | ✅ | ✅ | ✅ | ✅ live entries | n/a | ✅ | n/a | n/a | ✅ | — | ✅ | **REAL + WORKING** |
| Enterprise dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | ✅ | n/a | n/a | ✅ | — | ✅ | REAL + WORKING |
| Approval queue | ✅ | ✅ | ✅ | ✅ | ❌ empty | n/t | ✅ | n/t | n/t | UNKNOWN | — | ✅ | UNKNOWN — insufficient evidence |
| SSO / SCIM | ✅ | ✅ | ✅ | ✅ | ❌ unconfigured | n/t | ✅ | n/t | n/t | UNKNOWN | ❌ no IdP | ✅ | CREDENTIAL BLOCKED |
| Cross-org isolation | ✅ | n/a | ✅ | ✅ | ✅ | n/a | ✅ | n/a | n/a | ✅ **12/12 denied** | — | ✅ 403 | **REAL + WORKING** |
| `EnterpriseOS.jsx` | ❌ **0/9 routes** | orphan | ❌ | n/a | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | — | n/a | **DEAD PROTOTYPE** |

---

## AI OS

| Capability | Backend | Frontend | Reachable | Auth | Real data | Create | Read | Update | Delete | E2E | Credential | Failure handling | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Agent registry | ✅ | ✅ registry | ✅ | ✅ | ✅ | n/a | ✅ | n/a | n/a | ✅ | — | ✅ | REAL + WORKING |
| Agent runtime supervisor | ✅ | ✅ agentruntime | ✅ | ✅ | ✅ live uptime | n/a | ✅ | n/a | n/a | ✅ | — | ✅ | REAL + WORKING |
| Knowledge graph | ✅ | ✅ knowledge | ✅ | ✅ | ✅ **2,321 nodes / 1,526 edges** | n/t | ✅ | n/t | n/t | ✅ | — | ✅ | **REAL + WORKING** |
| Missions | ✅ | ✅ mission | ✅ | ✅ | ✅ | ✅ **persisted** | ✅ | n/t | n/t | ✅ | — | ✅ 400 | **REAL + WORKING** |
| Intelligence insights | ✅ | ✅ intel | ✅ | ✅ | ✅ | n/a | ✅ | n/a | n/a | ✅ | — | ✅ | REAL + WORKING |
| Founder twin | ✅ | ✅ twin | ✅ | ✅ | ✅ 2,688 actions | n/a | ✅ | n/t | n/t | ✅ | — | ✅ | REAL + WORKING |
| Execution engine | ✅ | ✅ execution | ✅ | ✅ | ✅ 30 pending | n/t | ✅ | n/t | n/t | ✅ | — | ✅ | REAL + WORKING |
| AI chat / LLM | ✅ | ✅ chat | ✅ | ✅ | ⚠️ | n/a | ⚠️ | n/a | n/a | ⚠️ | ❌ **429 / 401** | ✅ honest, chain falls back | **CREDENTIAL BLOCKED** |
| Memory index | ✅ | ✅ memory | ✅ | ✅ | UNKNOWN | n/t | ⚠️ | n/t | n/t | UNKNOWN | — | ✅ | UNKNOWN — insufficient evidence |

---

## HOSTING OS

| Capability | Backend | Frontend | Reachable | Auth | Real data | Create | Read | Update | Delete | E2E | Credential | Failure handling | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Runtime status | ✅ | ✅ runtime | ✅ | ✅ | ✅ live queue+agents | n/a | ✅ | n/a | n/a | ✅ | — | ✅ | REAL + WORKING |
| Docker health | ✅ | ✅ devops | ✅ | ✅ | ✅ **Docker 29.4.1 reachable** | n/a | ✅ | n/a | n/a | ✅ | — | ✅ | REAL + WORKING |
| VPS / infra | ✅ | ✅ | ⚠️ operator | ✅ | UNKNOWN | n/t | ⚠️ 403 | n/t | n/t | UNKNOWN | — | ✅ 403 | UNKNOWN — insufficient evidence |
| Deployment targets | ✅ | ✅ | ⚠️ operator | ✅ | UNKNOWN | n/t | ⚠️ 403 | n/t | n/t | UNKNOWN | — | ✅ 403 | UNKNOWN — insufficient evidence |
| Ops health | ✅ | ✅ | ⚠️ operator | ✅ | UNKNOWN | n/a | ⚠️ 403 | n/a | n/a | UNKNOWN | — | ✅ 403 | UNKNOWN — insufficient evidence |
| Logs / recovery | ✅ | ✅ | ⚠️ operator | ✅ | UNKNOWN | n/t | ⚠️ | n/t | n/t | UNKNOWN | — | ✅ | UNKNOWN — insufficient evidence |

**Hosting note:** most surfaces are correctly operator-tier gated (403). No operator plaintext password was available, and I did not attempt to bypass authentication. These are **UNKNOWN, not working and not broken** — verification requires an operator session.

---

## CLOUD OS

| Capability | Backend | Frontend | Reachable | Auth | Real data | Create | Read | Update | Delete | E2E | Credential | Failure handling | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Platform orgs | ✅ | ✅ | ✅ | ✅ | ❌ empty | n/t | ✅ | n/t | n/t | UNKNOWN | — | ✅ | UNKNOWN — insufficient evidence |
| Ecosystem (L8) | ✅ | ✅ orglevel-eco | ✅ | ✅ | ✅ 578 tenants | n/a | ✅ | n/a | n/a | ⚠️ simulation | — | ✅ | REAL + PARTIALLY WORKING |
| Civilization (L9) / Auto (L10) | ✅ | ✅ orglevel-* | ✅ | ✅ | ✅ | n/a | ✅ | n/a | n/a | ⚠️ simulation | — | ✅ | REAL + PARTIALLY WORKING |
| Infra dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | ✅ | n/a | n/a | ⚠️ **global, not tenant-scoped** | — | ✅ | REAL + PARTIALLY WORKING |
| Extensions runtime | ✅ | ✅ | ✅ | ✅ | ❌ empty | n/t | ✅ | n/t | n/t | UNKNOWN | — | ✅ | UNKNOWN — insufficient evidence |
| Plugins / marketplace | ✅ | ✅ marketplace | ✅ | ✅ | n/a | n/t | ⚠️ 402 | n/t | n/t | ⚠️ | ⚠️ plan-gated | ✅ honest `feature_gated` | CREDENTIAL BLOCKED (plan tier) |
| Workspace mesh / physical | ✅ | ✅ | ⚠️ | ✅ | UNKNOWN | n/t | ⚠️ | n/t | n/t | UNKNOWN | — | ✅ 404 | UNKNOWN — insufficient evidence |

**Cloud note:** `/eco`, `/civ`, `/auto` are organisational **simulation** layers, not customer-facing resources. `/infra/dashboard` returns byte-identical payloads to both tenants — global infrastructure telemetry, not customer data, so not an isolation defect.

---

## Legend

`n/t` = not tested (out of the 5–10 highest-value workflows for that OS)
`⚠️` = partial / conditional
**UNKNOWN was never converted into a positive score.**
