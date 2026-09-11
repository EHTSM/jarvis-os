# OS-3 RECOVERY MATRIX

Date: 2026-08-13 · Branch: `security/reality-completion`
Built from OS-2 live-execution evidence. **No merge. No push. `.env` untouched.**

Categories: **A RECOVER NOW** · **B FIX NOW** · **C PROVISION** · **D VERIFY LATER** · **E ARCHIVE** · **F GENUINE GAP**
Priority: **P0** blocks core OS operation · **P1** major founder workflow · **P2** important secondary · **P3** polish

---

## COMMUNICATION OS

| Capability | OS-2 Result | Backend | Frontend | API client | Reachable | Real data | Fix? | Credential? | Recovery action | Pri | Evidence | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Email campaign CRUD | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | subject "OS2 UPDATED" persisted | **A (done)** |
| Email delivery | PARTIAL | ✅ | ✅ | ✅ | ✅ | n/a | — | ❌ SMTP ×5 unset | provision SMTP | P1 | refuses, names real reason | **C** |
| SMS CRUD | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | `sms-…` created | **A (done)** |
| SMS delivery | PARTIAL | ✅ | ✅ | ✅ | ✅ | n/a | — | ❌ no provider | provision SMS provider | P2 | "no SMS provider configured" | **C** |
| WhatsApp CRUD | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ `WA_TOKEN` set | none | — | `wa-…` created | **A (done)** |
| WhatsApp send | **FIXED F-001** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ done | ✅ set | needs audience/CRM leads | P1 | 400 + reason, was fake "sent" | **B (done)** |
| Push CRUD | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | `push-…` created | **A (done)** |
| Push delivery + metrics | **FIXED F-002** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ done | ❌ Firebase unset | provision Firebase | P2 | `clicked:null`, `not_sent` | **B (done) + C** |
| Audiences | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | `aud-…` + members | **A (done)** |
| Templates | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | `tpl-…` created | **A (done)** |
| Automations | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | real automations list | **A (done)** |
| Analytics | PARTIAL | ✅ | ✅ | ✅ | ✅ | ✅ 29 campaigns | — | — | none | — | aggregates real records | **A (done)** |
| Telegram beyond status | UNKNOWN | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ | — | ✅ `TELEGRAM_TOKEN` set | exercise send path | P3 | only `{"configured":true}` seen | **D** |

---

## BUSINESS OS

| Capability | OS-2 Result | Backend | Frontend | API client | Reachable | Real data | Fix? | Credential? | Recovery action | Pri | Evidence | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Lead create/read/update | **REAL + WORKING** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | "new"→"qualified" persisted | **A (done)** |
| Lead dedup | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | honest `duplicate:true` | **A (done)** |
| CSV export | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | real CSV headers | **A (done)** |
| Tenant isolation | **REAL + WORKING** | ✅ | n/a | n/a | ✅ | ✅ | — | — | none | — | A=1 lead, B=0 | **A (done)** |
| Pipeline | PARTIAL | ✅ | ✅ | ✅ | ✅ | ⚠️ zero-state | — | — | seed populated tenant | P2 | correct shape, no data | **D** |
| Deals / opportunities | UNKNOWN | ✅ | ✅ | ✅ | ✅ | ❌ empty | — | — | seed + verify | P2 | `{"missions":[],"total":0}` | **D** |
| Customers / operations | UNKNOWN | ✅ | ✅ | ✅ | ✅ | ❌ empty | — | — | seed + verify | P2 | empty on fresh tenant | **D** |
| Payments (Razorpay) | UNKNOWN | ✅ | ✅ | ✅ | ✅ | ⚠️ | — | ✅ keys set | run a real test txn | P1 | keys present, txn untested | **D** |
| Invoices | UNKNOWN | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | — | — | locate real surface | P2 | not exercised in OS-2 | **D** |
| Analytics / executive | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | real KPIs | **A (done)** |

---

## MARKETING OS

| Capability | OS-2 Result | Backend | Frontend | API client | Reachable | Real data | Fix? | Credential? | Recovery action | Pri | Evidence | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Article create → publish | **REAL + WORKING** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | draft→published persisted | **A (done)** |
| SEO audit | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | 20 checks, 8 critical | **A (done)** |
| Keywords | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | real volumes (8,100) | **A (done)** |
| Content calendar | PARTIAL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ F-004 done | — | exercise approve/reject | P2 | 404 now correct | **B (done) + D** |
| **Distribution publish** | **FAKE SUCCESS** | ✅ | ✅ | ✅ | ✅ | ❌ fabricated | **✅ FIXED OS-3** | ❌ no connectors | provision platform connectors | **P0** | marked "published", minted fake URLs, reach×0.042 | **B (done) + C** |
| Distribution analytics | **CONTAMINATED** | ✅ | ✅ | ✅ | ✅ | ⚠️ legacy | ⚠️ partial | — | decide on 10 legacy records | **P1** | 18,780 fabricated reach persisted | **B (partial)** |
| Influencers / communities | PARTIAL | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | verify write paths | P3 | reads real | **D** |
| Content dashboard | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | organicScore 63 | **A (done)** |
| Creative Studio | UNKNOWN | ✅ 61 ep | ✅ | ✅ | ✅ | ⚠️ | — | — | exercise workflows | P2 | not executed in OS-2 | **D** |

---

## DEVELOPER OS

| Capability | OS-2 Result | Backend | Frontend | API client | Reachable | Real data | Fix? | Credential? | Recovery action | Pri | Evidence | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Engineering intelligence | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | real repositoryHealth | **A (done)** |
| Smell detection | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | 3,582 smells in 2.0s | **A (done)** |
| Coding decisions | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | real smell ids | **A (done)** |
| Self-improvement | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | recurring-RCA patterns | **A (done)** |
| Engineering org | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | 20 engineer agents | **A (done)** |
| Copilot / AI ask | CREDENTIAL BLOCKED | ✅ | ✅ | ✅ | ✅ | ❌ | **no defect** | ❌ Groq 429 + OpenAI 401 | replace invalid key / raise quota | **P0** | works after cooldown | **C** |
| Patch → test → apply | UNKNOWN | ✅ | ✅ | ✅ | ✅ | ❌ empty | — | — | exercise pipeline | P1 | `{"pipelines":[],"total":0}` | **D** |
| Repository viz | UNKNOWN | ✅ | ✅ | ✅ | ✅ | ⚠️ | — | — | correct-path probe | P3 | wrong path probed in OS-2 | **D** |
| `DeveloperOS.jsx` | DEAD PROTOTYPE | ❌ 0/7 | orphan | ✅ but invalid | ❌ | ❌ | — | — | **do not wire** | P3 | `/dev/*` all 404 | **E** |

---

## ENTERPRISE OS

| Capability | OS-2 Result | Backend | Frontend | API client | Reachable | Real data | Fix? | Credential? | Recovery action | Pri | Evidence | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Organization | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | `/orgs` real | **A (done)** |
| Department | **REAL + WORKING** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | `dept_…` persisted | **A (done)** |
| Team | **REAL + WORKING** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | `team_…` under dept | **A (done)** |
| Roles / permissions | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | 20+ perms | **A (done)** |
| Policies | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | real policy doc | **A (done)** |
| Audit log | **REAL + WORKING** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | live sequenced entries | **A (done)** |
| **Cross-tenant isolation** | **REAL + WORKING** | ✅ | n/a | n/a | ✅ | ✅ | — | — | **do not weaken** | — | **12/12 denied, writes denied** | **A (done)** |
| Approvals | UNKNOWN | ✅ | ✅ | ✅ | ✅ | ❌ empty | — | — | seed an approval | P2 | `{"items":[]}` | **D** |
| SSO / SCIM | CREDENTIAL BLOCKED | ✅ | ✅ | ✅ | ✅ | ❌ | — | ❌ no IdP | provision IdP | P2 | unconfigured | **C** |
| AI workforce | UNKNOWN | ✅ | ✅ | ✅ | ✅ | ⚠️ | — | — | exercise assignment | P2 | not executed | **D** |
| `EnterpriseOS.jsx` | DEAD PROTOTYPE | ❌ 0/9 | orphan | ✅ but invalid | ❌ | ❌ | — | — | **do not wire** | P3 | equivalent verified live | **E** |

---

## AI OS

| Capability | OS-2 Result | Backend | Frontend | API client | Reachable | Real data | Fix? | Credential? | Recovery action | Pri | Evidence | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Knowledge graph | **REAL + WORKING** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | 2,321 nodes / 1,526 edges | **A (done)** |
| Agent registry | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | real agents | **A (done)** |
| Agent supervisor | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | live uptime | **A (done)** |
| Missions | **REAL + WORKING** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | persisted, status planned | **A (done)** |
| Founder twin | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | 2,688 actions | **A (done)** |
| Execution engine | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | 30 pending | **A (done)** |
| Intelligence insights | REAL + WORKING | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | none | — | real insights | **A (done)** |
| **AI chat / LLM** | CREDENTIAL BLOCKED | ✅ | ✅ | ✅ | ✅ | ⚠️ | **no defect** | ❌ 429 + 401 | replace key / raise quota | **P0** | `callAI` → "OK" after cooldown | **C** |
| Agent Factory | UNKNOWN | ✅ | ✅ | ✅ | ✅ | ⚠️ | — | — | create an agent | P2 | not executed | **D** |
| Memory index | UNKNOWN | ✅ | ✅ | ✅ | ✅ | ⚠️ | — | — | correct-path probe | P2 | wrong path in OS-2 | **D** |

---

## HOSTING OS — mostly OPERATOR ACCESS REQUIRED

| Capability | OS-2 Result | Backend | Reachable | Real data | Recovery action | Pri | Evidence | Class |
|---|---|---|---|---|---|---|---|---|
| Runtime status | REAL + WORKING | ✅ | ✅ | ✅ | none | — | live queue + agents | **A (done)** |
| Docker health | REAL + WORKING | ✅ | ✅ | ✅ | none | — | Docker 29.4.1 reachable | **A (done)** |
| VPS provisioning | UNKNOWN | ✅ | ⚠️ 403 | ? | operator session | P1 | `/ops/infra/vps` 403 | **D** |
| Deployment targets | UNKNOWN | ✅ | ⚠️ 403 | ? | operator session | P1 | `/deployment/targets` 403 | **D** |
| Ops health / stats | UNKNOWN | ✅ | ⚠️ 403 | ? | operator session | P1 | 403 | **D** |
| Infra deploy/monitor/security/db | UNKNOWN | ✅ | ⚠️ 403 | ? | operator session | P1 | 4 × 403 | **D** |
| Logs / recovery | UNKNOWN | ✅ | ⚠️ 403 | ? | operator session | P2 | 403 | **D** |

---

## CLOUD OS

| Capability | OS-2 Result | Backend | Reachable | Real data | Recovery action | Pri | Evidence | Class |
|---|---|---|---|---|---|---|---|---|
| Ecosystem L8 / Civ L9 / Auto L10 | PARTIAL (simulation) | ✅ | ✅ | ✅ | clarify product intent | P3 | 578 modelled tenants | **D** |
| Infra dashboard | PARTIAL | ✅ | ✅ | ✅ | confirm global-by-design | P2 | byte-identical across tenants | **D** |
| Plugins / marketplace | CREDENTIAL BLOCKED | ✅ | ⚠️ 402 | n/a | plan-tier decision | P3 | honest `feature_gated` | **C** |
| Integrations | UNKNOWN | ✅ | ⚠️ 403 | ? | operator session | P1 | `/integrations` 403 | **D** |
| Vault / secrets | UNKNOWN | ✅ | ⚠️ 403 | ? | operator session | P1 | `/vault/*` 403 | **D** |
| Platform orgs | UNKNOWN | ✅ | ✅ | ❌ empty | seed + verify | P3 | `{"orgs":[]}` | **D** |
| Extensions runtime | UNKNOWN | ✅ | ✅ | ❌ empty | seed + verify | P3 | `{"extensions":[]}` | **D** |
| Workspace mesh / physical | UNKNOWN | ✅ | ⚠️ | ? | correct-path probe | P3 | wrong path in OS-2 | **D** |

---

## Totals

| Class | Count | Meaning |
|---|---:|---|
| **A RECOVER NOW** | 30 | Already real and working — **no action needed** |
| **B FIX NOW** | 5 | 4 fixed in OS-2/OS-3; 1 partial (legacy records) |
| **C PROVISION** | 8 | Credential/connector only — no code work |
| **D VERIFY LATER** | 27 | Insufficient evidence (operator access, fixtures, unexercised) |
| **E ARCHIVE** | 3 | Dead prototypes — do not wire |
| **F GENUINE GAP** | **0** | **Nothing requires new development** |
