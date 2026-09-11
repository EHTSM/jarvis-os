# Phase B.16 — Customer Operations Certification

**Product:** Ooplix (jarvis-os) v1.0.0-rc1
**Date:** 2026-08-09
**Branch:** `security/reality-completion` (no merge, no push)
**Method:** Operated as a real Customer Success & Customer Lifecycle platform. **Measured first, read source only after reproducing.** No new CRM entity, Customer Success engine, or storage.

**Test rig:** two real organizations — A (`org_1786271632328_1`) and B (`org_1786271632578_2`) — and three customer records (`91888000001/2/3`) with unique markers (`B16CUSTALPHA_*`, `ORGA_SECRET_*`) so leakage was provable, not inferred.

---

## Defects Reproduced and Recovered

### D1 — Three customer statistics endpoints were unreachable (**HIGH**)

`/customer-org/journey/stats`, `/health/stats` and `/automation/stats` were registered **after** their `/:customerId` siblings, so Express matched the literal `stats` as a customer ID.

**Reproduced:** all three returned **404** — `{"ok":false,"error":"journey not found"}`, `"health record not found"`, `"automation not found"`.

**The capability existed and held real data** — verified in-process:

| Function | Live result |
|---|---|
| `customerJourneyEngine.getStats()` | 59 journeys, full `byStage` |
| `customerHealthEngine.getStats()` | 59 records, `avgScore 50.9`, **`atRisk 27`** |
| `customerAutomationEngine.getStats()` | 501 automations, `minutesSaved 12570` |

`/customer-org/journey/stages` was **already** ordered correctly ahead of `/:customerId`, which is what exposed the pattern as three ordering slips rather than a design choice.

**Recovery:** moved each literal path ahead of its parameterised sibling and removed a duplicate `/automation/stats` declaration. **Verified live: all three now 200** (`total=60`, `total=60`, `total=501`).

### D2 — Two customer-reporting surfaces disagreed on the same question (**HIGH**)

`getStats()` spread the **stored** `d.stats`, whose `byStage` was computed by `syncJourneys()` from the **pre-merge lead list**. Because `customerId` prefers `lead.userId`, several leads collapse into one journey — measured: **7 customerIds shared by 2–5 leads each** (one by 5). So `byStage` counted *leads* while `total` counted *distinct customers*.

**Reproduced:**

```
getStats().total = 60      byStage sum = 71      mismatch = 11

                  getStats   getStageDistribution
lead                  17              12
qualification         43              37
onboarding             6               6
adoption               5               5
```

A CS lead reading the pipeline got **17 leads or 12** depending on which endpoint they hit — with no way to know which was right. `getStageDistribution()` was the correct one; it already recomputed from the store.

**Recovery:** `getStats()` now recomputes `byStage` and `total` from the stored journeys, matching what `getStageDistribution()` always did.

**Verified live:** `total=60`, `byStage` sum **60**, and both surfaces agree stage-by-stage (12/37/6/5).

### D3 — Automation previews were reported as real executed work (**MEDIUM**)

`trigger(..., { skipExecute: true })` set `status = "executed"` and stamped `executedAt`, with the comment `// test mode`. The guard **did** correctly skip the real work — no workflow ran, no approval was requested, no outcome recorded — but the record then claimed it had executed.

**Reproduced live and in-process:** `skipExecute: true` and `false` were **indistinguishable** — both `status=executed` with an `executedAt` timestamp.

Impact measured: `getStats()` counts these toward `executed` (150) and toward **`minutesSaved: 12230` — ≈204 hours of claimed labour saved** that partly never happened.

**Recovery:** previews now record `status: "skipped"`, `skipped: true`, and **no `executedAt`**. `_updateStats` already filtered on `status === "executed"`, so skipped rows are automatically excluded from both `executed` and `minutesSaved`; added a `skipped` counter so previews remain visible.

**Verified live:** `skipExecute=true → status=skipped, executedAt=-`; `false → status=executed` with a timestamp.

### D4 — A tenant could orphan its own customer record beyond recovery (**MEDIUM**)

`PATCH /crm/lead/:phone` passed `req.body` straight to `updateLead`, so `orgId` and `userId` were client-editable.

**Reproduced:** `PATCH {"orgId":"org_HIJACK","userId":"someone_else"}` on the caller's **own** lead returned **200**, and the lead **vanished from its owner's list (3 visible → 2)** — stranded in a non-existent org.

There is **no way back**: `transfer`, `merge`, `archive`, `restore` and `DELETE` all return **404**. I had to repair `data/leads.json` directly to recover my own test record.

**Important boundary, verified:** stealing **another** org's lead was **already correctly blocked** — B's `PATCH` on A's lead returned **403 "Forbidden — not your lead"**. This is the reverse direction: self-inflicted data loss, not a cross-tenant breach.

**Recovery:** strip `orgId`/`userId` from a non-operator PATCH body — ownership is set at creation from the verified session. **Operators keep the ability to re-home a lead.**

**Verified live:** ownership fields ignored (`orgId` and `userId` unchanged), the legitimate `status: "hot"` still applied, lead still visible (3/3), and B's cross-org PATCH still **403**.

### D5 — Customer audit recorded no actor (**MEDIUM**)

`operatorAudit` wrote only request metadata — `method`, `path`, `status`, `ip`, `requestId`, `durationMs`.

**Reproduced:** **516 CRM audit entries**, including my 3 lead creations and 10 status changes, with **no field identifying who made any change** — the one question a customer audit trail exists to answer.

**Recovery:** added `actor` (`req.user.sub`), `actorRole`, and `orgId` (`req.org?.id`) — all already populated by `requireAuth`/`attachOrg` on every route that mounts this middleware. Kept fire-and-forget so audit failure can never break a request.

**Verified live:** new entries carry full attribution, including on a **403 denial** — `actor=4d9ebc55… role=user org=org_…_2 status=403`. Historical entries correctly remain `null`.

**Correction recorded:** I first concluded CRM writes were **not audited at all** after finding 0 entries in `data/logs/audit.ndjson`. `operatorAudit` writes to a **separate file**, `data/logs/operator-audit.ndjson`, where all 516 CRM entries were present. CRM *is* audited; the real defect was the missing actor.

**Regression (all five):** `tests/runtime/22-customer-ops-integrity.test.cjs` — **15 tests, 15/15 pass**. **Negative-tested: 9 fail** with all five reverted (the 6 that pass assert pre-existing capability).

---

## 1. Customer Inventory Matrix

| Surface | Routes | Store | Live probe | Reality |
|---|---|---|---|---|
| **CRM leads** | 7 (`/crm/*`) | `leads.json` — 51 records | **200** | org-scoped, `attachOrg` + `operatorAudit`, CSV export |
| **Customer journeys** | 6 | `customer-journeys.json` — 60 | **200** | 13 lifecycle stages, `STATUS_TO_STAGE` map |
| **Customer health** | 7 | `customer-health.json` — 60 + history | **200** | 6 weighted dimensions, grade, risk |
| **Success plans** | 6 | `customer-success-plans.json` — 3 | **200** | playbooks, actions, predictions |
| **Customer automations** | 5 | `customer-automations.json` — 500 (ring) | **200** | 11 types, approval gating |
| **CS dashboard** | 3 | derived | **200** | `totalCustomers 59`, `avgHealthScore 50.9`, 24 service checks |
| Business contacts / leads | 20 (`/business/*`) | `biz-contacts.json` (5), `biz-leads.json` (18) | **200** | separate B2B store |
| Company factory | 57 | `company-*.json` (4.9 MB) | — | synthetic org blueprints |
| Revenue success health | 4 | — | **403** operator-gated | permission-scoped |
| Support tickets (B.15) | 6 | `customer-support.json` — 190 | **200** | see Phase B.15 |
| **Total customer-related routes** | **289 in 56 files** | — | **14/15 GET → 200, 1 → 403** | 1 HTML fallback (`/crm/stats`, no such route) |

## 2. Lifecycle Matrix

| Stage transition | Result | Status |
|---|---|---|
| **Lead created** | `POST /crm/lead` → 200, `orgId` + `userId` stamped from session | CERTIFIED |
| Duplicate detection | `duplicate:false`; dedupe is per-`orgId`+phone (documented) | CERTIFIED |
| Lead → Contact/Qualified | `PATCH {status}` persists | CERTIFIED |
| → Won / Paid | persists; `paidAt` on real payment | CERTIFIED |
| → Onboarded | persists; `onboardedAt` | CERTIFIED |
| → Churned | persists; maps to `recovery` stage | CERTIFIED |
| **Win-back** | No distinct state; `churned → hot` works via status | CERTIFIED WITH LIMITATIONS |
| **Status validation** | ❌ `TOTALLY_INVALID_STAGE` **stored with 200** | **GENUINE CAPABILITY GAP** |
| **Journey stage validation** | ✅ `advanceStage` **does** validate against `LIFECYCLE_STAGES` | CERTIFIED |
| 13 lifecycle stages declared | lead→…→recovery, with `STATUS_TO_STAGE` bridge | CERTIFIED |
| Real distribution | lead 12, qualification 37, onboarding 6, adoption 5 | CERTIFIED |
| Expansion / renewal / advocacy | Declared but **0 customers** in any of them | OBSERVATION |

The lifecycle **vocabulary is declared** (`LIFECYCLE_STAGES` + `STATUS_TO_STAGE`) and `advanceStage` validates against it — but CRM `status` is free-form. An unmapped status silently falls back to `lead` via `STATUS_TO_STAGE[status] || "lead"`, so a typo quietly resets a customer to the top of the funnel. Left as a gap rather than fixed: `STATUS_TO_STAGE` covers 10 statuses while the store legitimately holds `won` and `contacted` too, so the authoritative CRM vocabulary is genuinely undefined — validating against the wrong list would break real records.

## 3. Health Matrix

| Capability | Measured | Status |
|---|---|---|
| **Scoring live** | `POST /health/score/:id` → `overall 48`, `grade D`, `risk high` | CERTIFIED |
| **6 weighted dimensions** | `product_usage 0.30`, `relationship 0.20`, `financial 0.20`, `lifecycle_progress 0.15`, `support_health 0.10`, `engagement` | CERTIFIED |
| Dimension values | 57 / 40 / 54 / 30 / 55 / 40 — real, differentiated | CERTIFIED |
| Grade + risk derivation | D → high; consistent with score | CERTIFIED |
| **At-risk detection** | **27 of 59** customers flagged `atRisk` | CERTIFIED |
| Health history | `getHealthHistory` per customer, 59 histories stored | CERTIFIED |
| Health trend | `getHealthTrend` present | CERTIFIED |
| Score-all sweep | `POST /health/score-all` works | CERTIFIED |
| Alerts array | Present but empty on my record | UNKNOWN |
| **`journey: null` on a scored record** | Journey existed but was not linked back | GENUINE CAPABILITY GAP |
| **Satisfaction / CSAT dimension** | ❌ none (B.15 confirmed no ticket CSAT to feed it) | GENUINE CAPABILITY GAP |

## 4. Journey Matrix

| Capability | Measured | Status |
|---|---|---|
| Journey per customer | 60 journeys, `stage`, `stageIndex`, `nextStage` | CERTIFIED |
| Completed / remaining stages | Both computed from the stage index | CERTIFIED |
| `daysInCRM` | Derived from `createdAt` | CERTIFIED |
| Churn risk banding | `<30 critical`, `<50 high`, `<70 medium`, else low | CERTIFIED |
| Health grade → stage refinement | `_gradeToStage`: A/B → expansion, D/F → retention | CERTIFIED |
| Sync from CRM + health | `syncJourneys` merges leads with direct signups | CERTIFIED |
| Manual stage advance | `advanceStage` validates the target stage | CERTIFIED |
| **Stage distribution consistency** | Was 71 vs 60; now consistent | CERTIFIED (after D2) |
| **`synced` vs `total`** | 71 built → 60 distinct (documented merge) | CERTIFIED |
| **Timeline of events** | ❌ no per-customer event log — journeys are point-in-time snapshots, not a CRM/Support/Billing/AI timeline | **GENUINE CAPABILITY GAP** |
| Multi-lead customers | 7 customerIds share 2–5 leads each | OBSERVATION |

## 5. Segmentation Matrix

| Filter | Surface | Result | Status |
|---|---|---|---|
| By org | `/crm/leads` | **A=3, B=0** — correct | CERTIFIED |
| By owner (`userId`) | `/crm/leads` | Own leads only for non-operators | CERTIFIED |
| By risk | `/customer-org/health?risk=high` | 28 | CERTIFIED |
| By grade | `?grade=D` | 28 | CERTIFIED |
| By stage | `/customer-org/journey?stage=lead` | 12, **0 wrong-stage rows** | CERTIFIED |
| By churn risk | `?churnRisk=high` | works | CERTIFIED |
| By status / severity | support tickets | works | CERTIFIED |
| By automation type/status | `/automation?type=&status=` | works | CERTIFIED |
| **Tags** | ❌ no tag field on leads or journeys | GENUINE CAPABILITY GAP |
| **CRM query params** | `/crm/leads` accepts **no** `status`/`limit`/`q` by design | OBSERVATION |
| Limit clamps | Now clamped 1–500 on 4 customer list routes | CERTIFIED |

**Correction recorded:** I initially read `/crm/leads?status=hot` returning 3 rows as "filter ignored — a defect". The route accepts **no query parameters at all**; it returns the caller's own org-scoped leads unconditionally. I was testing parameters that do not exist. Not a defect.

## 6. Cross-system Matrix

| Link | Measured | Status |
|---|---|---|
| **CRM → Journey** | `syncJourneys` reads `crmService.getLeads()`; status → stage | CERTIFIED |
| **CRM → Health** | `customerHealthEngine` reads leads (2 call sites) | CERTIFIED |
| **Health → Journey** | `_gradeToStage` refines stage from health grade | CERTIFIED |
| **Journey → Automation** | `trigger` stamps `context.stage` from the journey | CERTIFIED |
| **Health → Automation** | `context.healthScore` (48) carried into every automation | CERTIFIED |
| **Health → Success plan** | Plan carried `healthScore 48` and selected the `at_risk` playbook | CERTIFIED |
| **Success → prediction** | churn 0.6/high, expansion 0.15, renewal 0.4 | CERTIFIED |
| **Automation → Approval engine** | `requiresApproval: true` routes to `approvalEngine` | CERTIFIED |
| **Automation → Execution engine** | `executeWorkflow` on non-approval types | CERTIFIED |
| **Automation → Learning (CLE)** | `recordOutcome` on success | CERTIFIED |
| Revenue OS → Journey | `listCustomerHealth` merged for direct signups | CERTIFIED |
| **Journey → Health back-link** | ❌ `journey: null` on the health record | GENUINE CAPABILITY GAP |
| Customer → Support tickets | Tickets carry `customerId`; **no `orgId`** (B.15 G1) | GENUINE CAPABILITY GAP |
| Customer → Billing | ❌ no link from a lead to its billing/invoice record | GENUINE CAPABILITY GAP |
| Customer → Memory / Knowledge | ❌ not written to the memory store or graph | GENUINE CAPABILITY GAP |

## 7. Reporting Matrix

| Metric | Measured | Status |
|---|---|---|
| Total customers | 60 (journeys) / 59 (dashboard) | CERTIFIED |
| **Stage distribution** | Was inconsistent (71 vs 60); now exact | CERTIFIED (after D2) |
| **Two surfaces agree** | `getStats` == `getStageDistribution`, stage-by-stage | CERTIFIED (after D2) |
| Average health | `avgHealthScore 50.9` | CERTIFIED |
| At-risk count | **27 of 59** | CERTIFIED |
| Churn risk bands | `churnRisks` critical/high/medium/low | CERTIFIED |
| Churn prevented | `churnPrevented: 21` | CERTIFIED |
| **Automation `minutesSaved`** | Was inflated by previews; now executed-only | CERTIFIED (after D3) |
| `churnInterventions` | 484–489 (retention + detect_churn) | CERTIFIED |
| Service health rollup | 24 checks, 23 healthy / 1 degraded | CERTIFIED |
| Expansions triggered | `expansionsTriggered: 0` — honest zero | CERTIFIED |
| **Retention / growth rate** | ❌ no cohort or period-over-period retention | GENUINE CAPABILITY GAP |
| **Revenue per customer** | `revenue` field exists but is `0` unless `paymentStatus==="paid"` | CERTIFIED WITH LIMITATIONS |

## 8. Recovery Matrix

SIGKILL of the live process, measured before/after.

| Signal | Before | After | Status |
|---|---|---|---|
| **Recovery time** | — | **~12 s** (PM2) | CERTIFIED |
| Health endpoint | 200 | **200** | CERTIFIED |
| CRM leads (org A) | 3 | **3**, all markers | CERTIFIED |
| Journeys | 60 | **60** | CERTIFIED |
| Health records | 60 | **60** | CERTIFIED |
| Success plans | 3 | **3** | CERTIFIED |
| Automations | 501 | **501** | CERTIFIED |
| My health record | present | **present** | CERTIFIED |
| **Orphan customers** (no `customerId`) | — | **0 / 0** | CERTIFIED |
| Stores parseable | — | **yes** | CERTIFIED |
| Journey ring buffer | 500-record cap (`slice(-500)`) | documented | CERTIFIED |
| Atomicity | Whole-file `writeFileSync`, **no** `.tmp`+rename | CERTIFIED WITH LIMITATIONS |

## 9. Multi-org Matrix

Two real orgs, marker-verified.

| Probe | Result | Status |
|---|---|---|
| **A sees own leads** | 3, all markers | CERTIFIED |
| **B sees A's leads** | **0** | CERTIFIED |
| **B forges `X-Org-Id: ORGA`** | **0 leads, blocked** (B.7 `orgMiddleware` fix holding) | CERTIFIED |
| **B PATCHes A's lead** | **403** "not your lead" | CERTIFIED |
| `getLeads(status, orgId)` filter | ORGA→3, ORGB→0, null→27 | CERTIFIED |
| Ownership immutable via PATCH | Now stripped for non-operators | CERTIFIED (after D4) |
| Audit records acting org | Now `orgId` on every entry | CERTIFIED (after D5) |
| **B reads A's customer health** | **LEAKED** — `91888000002`, overall 48, grade D, all 6 dimensions | **GENUINE CAPABILITY GAP** |
| **B reads A's journey** | **LEAKED** — customer **name and phone number** | **GENUINE CAPABILITY GAP** |
| **B reads A's success plans / automations** | **LEAKED** — identical 60/3/500 views | **GENUINE CAPABILITY GAP** |
| `orgId` in the 5 customer engines | **0 occurrences in all five** | GENUINE CAPABILITY GAP |
| `orgId` on stored customer records | **0 of 123** (60 health + 60 journey + 3 plans) | GENUINE CAPABILITY GAP |

**Scope stated plainly.** CRM leads are **genuinely well isolated** — org-scoped reads, header forgery blocked, cross-org writes 403, and `crmService` documents the org fix at line 15. But that scoping is **discarded the moment data crosses into the derived engines**: `customerJourneyEngine`, `customerHealthEngine`, `customerSuccessEngine`, `customerAutomationEngine` and `customerOrganizationDashboard` contain **zero** `orgId` occurrences, call `getLeads()` with no org argument, and no engine function accepts an `orgId` parameter. Org B read Org A's customer health score and the customer's name and phone.

I did **not** fix this, and the reason is a rule, not convenience: the existing `getLeads(status, orgId)` filter proves the *source* is scopeable, but 0 of 123 stored customer records carry an `orgId`, no engine signature accepts one, and `customerOrg.js` mounts no `attachOrg`. Threading org through five engines and backfilling an ownership dimension into three stores is **new capability**, which this mission forbids. It is **G1**, the top remaining gap.

## 10. Business Impact Matrix

| Impact | Before | After |
|---|---|---|
| **CS statistics available** | **3 endpoints 404** — `atRisk 27`, `avgScore 50.9`, `minutesSaved` all unreachable | All three 200 |
| **Pipeline numbers trustworthy** | Two surfaces disagreed: **17 leads or 12** | Identical, stage-by-stage |
| **Stage totals internally consistent** | `byStage` summed 71 against `total` 60 | Sum == total |
| **Automation "work saved" honest** | Previews counted as executed; **12,230 min (~204 h) claimed** | Previews `skipped`, excluded from `executed` and `minutesSaved` |
| **Preview distinguishable from real run** | **No** — identical output | Yes |
| **Customer record recoverable** | A could push its own lead into a non-existent org, invisible (3→2), **no route back** | Ownership fields ignored |
| **Audit answers "who changed this customer?"** | **No** — 516 entries, no actor | `actor`, `actorRole`, `orgId` on every entry incl. 403s |
| Cross-org lead theft | Already blocked (403) | **Unchanged** |
| Operator capability | Full | **Unchanged** (can still re-home a lead) |
| Durability | — | 60 journeys / 60 health / 3 plans / 501 automations survived SIGKILL in ~12 s, **0 orphans** |

## 11. Remaining Gap Matrix

| ID | Gap | Type | Severity |
|---|---|---|---|
| **G1** | **Derived customer data is not org-scoped.** Org B read Org A's health score (48/D/high, 6 dimensions) and journey (**customer name + phone**). All 5 engines have **0** `orgId` occurrences; 0 of 123 records carry one; no engine signature accepts one; `customerOrg.js` mounts no `attachOrg`. CRM itself *is* correctly isolated — the scoping is lost at the engine boundary. | **GENUINE CAPABILITY GAP** | **Critical** |
| **G2** | **No customer event timeline.** Journeys are point-in-time snapshots; there is no per-customer log of CRM/Support/Billing/AI/Automation events, so "what happened to this customer" is unanswerable. | **GENUINE CAPABILITY GAP** | **High** |
| G3 | **CRM `status` is unvalidated** — `TOTALLY_INVALID_STAGE` stored with 200, and `STATUS_TO_STAGE[status] \|\| "lead"` silently resets an unmapped status to the top of the funnel. Not fixed because the authoritative vocabulary is genuinely undefined (the map covers 10 statuses; the store also holds `won`, `contacted`). | GENUINE CAPABILITY GAP | High |
| G4 | **No human-override routes** — `transfer`, `merge`, `archive`, `restore`, `DELETE` all **404**. Merging the 7 duplicate-customer lead groups is impossible through the API. | GENUINE CAPABILITY GAP | High |
| G5 | **`/customer-org/*` is entirely unaudited** — 0 entries for health scoring, journey sync, plan generation, or automation triggers. | GENUINE CAPABILITY GAP | High |
| G6 | **No customer↔billing link** — a lead cannot be traced to its invoice or subscription. | GENUINE CAPABILITY GAP | Medium |
| G7 | **No satisfaction/CSAT dimension** in health scoring (B.15 confirmed no ticket CSAT exists to feed it). | GENUINE CAPABILITY GAP | Medium |
| G8 | **Health record's `journey` back-link is `null`** even when a journey exists. | GENUINE CAPABILITY GAP | Medium |
| G9 | **No tags on customers** — segmentation is limited to stage/risk/grade/owner/org. | GENUINE CAPABILITY GAP | Medium |
| G10 | **No retention/growth/cohort reporting** — no period-over-period or cohort retention. | GENUINE CAPABILITY GAP | Medium |
| G11 | **Duplicate customers not reconciled** — 7 customerIds map to 2–5 leads each (one to 5), inflating per-lead views. `syncJourneys` merges them silently; nothing surfaces or resolves the duplication. | GENUINE CAPABILITY GAP | Medium |
| G12 | Customer stores write whole-file with **no `.tmp`+rename** (unlike `agents/taskQueue.cjs`). Not reproduced as data loss. | OBSERVATION | Low |
| G13 | Journey + automation stores are **500-record ring buffers** — customer history is silently discarded past 500. | OBSERVATION | Low |
| G14 | `expansion`/`renewal`/`advocacy` stages declared but **0 customers** ever in them. | OBSERVATION | Low |
| G15 | `/crm/stats` returns the **SPA HTML fallback** — no such route despite the sibling naming. | OBSERVATION | Low |
| G16 | Revenue-success health endpoints operator-gated; correctness unverifiable from a tenant account. | UNKNOWN (permission-gated) | Low |

---

## Final Customer Operations Certification

| Area | Classification |
|---|---|
| Customer Inventory | **CERTIFIED** — 289 routes / 56 files, 14/15 GET → 200, real data in every store |
| Lifecycle | **CERTIFIED WITH LIMITATIONS** — 13 stages, all transitions persist; CRM status unvalidated |
| Health Scoring | **CERTIFIED** — 6 weighted dimensions, grade/risk, 27/59 at-risk, history + trend |
| Journey | **CERTIFIED** (after D2) — stages, churn banding, grade refinement, consistent distribution |
| Segmentation | **CERTIFIED WITH LIMITATIONS** — org/owner/stage/risk/grade work; no tags |
| CS Workflows | **CERTIFIED** — playbook selection, churn 0.6, expansion/renewal prediction, approval gating |
| Cross-system Linkage | **CERTIFIED** — CRM→Journey→Health→Automation→Approval→Execution→Learning all genuinely wired |
| **Multi-org (CRM)** | **CERTIFIED** — org-scoped, header forgery blocked, cross-org write 403 |
| **Multi-org (derived engines)** | **GENUINE CAPABILITY GAP** — health, journey, plans, automations all cross-tenant readable |
| Reporting | **CERTIFIED** (after D2, D3) — surfaces agree; `minutesSaved` reflects real work only |
| Recovery | **CERTIFIED** — 60/60/3/501 preserved through SIGKILL in ~12 s, 0 orphans |
| Audit (CRM) | **CERTIFIED** (after D5) — actor, role, org on every entry including denials |
| Audit (customer-org) | **GENUINE CAPABILITY GAP** — 0 coverage |
| Human Override | **CERTIFIED WITH LIMITATIONS** — status/assignment editable; no transfer/merge/archive/restore |

### **Customer Operations Readiness: CERTIFIED WITH LIMITATIONS — with one critical residual gap (G1)**

**The most consequential finding is one I deliberately did not fix.** CRM lead isolation is genuinely good — Org B saw **0** of Org A's leads, forging `X-Org-Id` was blocked, cross-org writes returned 403, and `crmService` carries a documented org-isolation fix. But that scoping is **discarded at the engine boundary**: Org B read Org A's customer health score (48, grade D, high risk, all six dimensions) and Org A's journey record including the **customer's name and phone number**. All five customer engines contain **zero** `orgId` occurrences, none of their functions accept an org parameter, `customerOrg.js` mounts no `attachOrg`, and **0 of 123 stored customer records** carry an owner. The existing `getLeads(status, orgId)` filter proves the *source* is scopeable — but threading org through five engines and backfilling an ownership dimension into three stores is new capability, not recovery, and this mission forbids it. It is recorded as **G1, Critical**, with the exact reproduction and the precise reason it was not closed.

**What I did recover were five defects that made customer operations either invisible, inconsistent, dishonest, or unattributable.** Three statistics endpoints answered **404** because `/stats` was registered after `/:customerId` — Express matched "stats" as a customer ID — while the underlying functions held real data all along (**27 of 59 customers at risk**, `avgHealthScore 50.9`, 501 automations). Two customer-reporting surfaces gave **different answers to the same question**: `getStats` said 17 leads and 43 in qualification, `getStageDistribution` said 12 and 37, because `byStage` counted pre-merge *leads* (71) while `total` counted distinct *customers* (60) — a CS lead had no way to know which number was real. Automation previews reported `status: "executed"` with a timestamp, making `skipExecute` indistinguishable from real work and inflating **12,230 claimed minutes (~204 hours)** of labour saved. A tenant could **PATCH its own lead into a non-existent org**, making it vanish from its owner's list with **no transfer, merge, archive or restore route to recover it** — I had to repair the store by hand. And 516 CRM audit entries recorded method, path and IP but **never who made the change**.

**What genuinely works is substantial.** Health scoring is real and differentiated — six weighted dimensions producing distinct sub-scores, a grade, a risk band, plus per-customer history and trend. The CS workflow layer selected an `at_risk` playbook with five concrete steps, predicted churn at 0.6/high alongside expansion and renewal probabilities, and routed high-stakes automations through the approval engine while recording outcomes into the learning engine. The cross-system chain CRM→Journey→Health→Automation→Approval→Execution→Learning is wired end-to-end with real values flowing through it, not stubs. Recovery was clean: 60 journeys, 60 health records, 3 plans and 501 automations all intact after SIGKILL in ~12 s with **0 orphaned customers**.

**Three corrections to my own measurements**, each of which would otherwise have been a false finding: I concluded CRM writes were **not audited at all** after finding 0 entries in `audit.ndjson` — `operatorAudit` writes to a **separate file** where all 516 entries were present, so the real defect was the missing actor, not missing audit; I read `/crm/leads?status=hot` returning unfiltered rows as a broken filter, when the route accepts **no query parameters at all** by design; and I flagged `skipExecute` as executing for real, when the guard correctly skipped the work and the defect was narrower — it **lied about having executed**. A fourth near-miss: my first regression assertion compared absolute `executed` counts, which drifted because the automation store is a **500-record ring buffer** evicting older rows as I appended — the test was wrong, not the code, and I rewrote it to assert the structural invariant.

**Validation hygiene:** the lead I orphaned into `org_HIJACK` was restored to its real org and owner; test lead statuses were left at valid values (`hot`); the two temporary regression fixtures use a dedicated `b16-regression-*` customer id. Regression **144/144 existing + 113/113 new (B.6–B.16)**, with the new suite negative-tested (**9 of 15 fail** with all five fixes reverted, re-confirmed after the test rewrite). Changes limited to `backend/routes/customerOrg.js`, `backend/routes/crm.js`, `backend/services/customerJourneyEngine.cjs`, `backend/services/customerAutomationEngine.cjs`, and `backend/middleware/operatorAudit.js` (**+87/−19**) plus one new test file. No merge, no push, no new CRM entity, no new Customer Success engine, no new storage.
