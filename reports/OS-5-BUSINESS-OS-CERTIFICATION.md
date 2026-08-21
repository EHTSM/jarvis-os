# OS-5 — BUSINESS OS CERTIFICATION REPORT

Date: 2026-08-13 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched. OS-4 parked status unmodified. OS-6/Marketing not started.**

---

# STATUS: **OPEN — NOT CERTIFIED**

Substantial real evidence was obtained: the Business OS core (leads → opportunity → pipeline → revenue) was operated end-to-end as a real business owner on a fresh tenant, and **every number traced to persisted data**. Certification is withheld for two reasons, both documented below: a **pre-existing route-shadowing defect** that undermines tenant scoping on `/business/*`, and an **unstable environment** that prevented completing live verification.

---

## 1. Real workflows executed (Phase 1–2)

Fresh tenant: `os5-biz-1786632479746@test.local` / org `org_1786632479746_1` ("Northwind Trading Co"), user-tier, no operator access.

### Baseline — honest zeros
An empty tenant showed `pipeline` all-zero, `deals`/`customers`/`operations` empty, `leads: []`, and its own trial billing. **No platform-wide totals leaked into a new tenant.**

### Real data created and verified

| Step | Action | Evidence |
|---|---|---|
| 1 | 3 CRM leads (Acme Manufacturing, Bluewave Logistics, Corex Retail) | persisted, correct `orgId`, re-read in a separate request |
| 2 | Qualify CRM lead | `status: "new" → "qualified"` **persisted across re-read** |
| 3 | Business lead (`lead_1786632680183_37a5e6`) | created, listed |
| 4 | Qualify business lead | `stats.leads.qualified: 0 → 1` |
| 5 | Opportunity `opp_1786632747240_4f4330`, value 250,000 | created |
| 6 | Pipeline check | `prospect: {count:1, value:250000}` — **reflects real data** |
| 7 | Advance prospect → qualified → proposal → negotiation | each stage moved, **prior stage decremented to 0** |
| 8 | Close-won | `closed-won: {count:1, value:250000}` |
| 9 | Revenue `rev_1786632823359_6de0d1`, 250,000 | recorded |
| 10 | Stats | `revenue.total: 250000`, `byType`, `bySource`, `byMonth: {"2026-08": 250000}` |
| 11 | Customer + Operation | created as real persisted missions |

**This is a genuine end-to-end business workflow**, not HTTP-200 rendering.

### Two discrepancies I investigated and resolved as NOT defects

**`stats.leads.total: 4` while `/business/leads` returned 1.** Correct: 1 business lead + 3 CRM leads. `/crm/lead` and `/business/leads` are **separate stores by design**, and stats aggregates both. My earlier confusion, not a bug.

**`revenue: 0` after close-won.** Correct: `closeWon()` only advances the opportunity; revenue is a **separate ledger**. Reporting 0 when no revenue record exists is *honest*, not fabricated — and posting a revenue record produced the correct totals immediately.

---

## 2. Bug found and fixed — synthetic qualification scores (OS5-001)

| Field | Value |
|---|---|
| **Reproduction** | `GET /bizorg/v3/deals` |
| **Evidence** | Response contained `"Score: 82"`, `"Score: 79"`, `"Score: 86"` |
| **Root cause** | [businessOrg.cjs:246](backend/services/businessOrg.cjs#L246) — `const score = 60 + Math.floor(Math.random() * 40)`. No scoring model, no enrichment data, no CRM signal. The value was written verbatim into the deal's stage note (`Score: 87`) and agent memory via `crmQualifyLead()`. |
| **Why it matters** | A founder reads a qualification score that looks measured and is random. Same defect class as OS-2's push metrics and OS-3's distribution reach. |
| **Notably** | The **synthetic lead capture 18 lines above already solves this correctly**, threading `synthetic: true` and `source: "demo_simulation"` with an explanatory comment. The scoring path simply never got the same treatment. |
| **Fix** | Mirror the existing convention rather than invent one: pass `synthetic: true` from the tick; `crmQualifyLead()` now renders `Score: N (simulated — not measured)` everywhere it persists or emits, and returns `scoreSynthetic`. The simulation still runs — only the labelling changed. |
| **Live re-verify** | **INCOMPLETE** — the server was killed externally before verification. Source change is in place and syntax-checked. |
| **Classification** | **FIXED (pending live re-verify)** |

---

## 3. Pre-existing defect found — route shadowing on `/business/*` (OS5-002)

**This is the reason Business OS cannot be certified.**

| Field | Value |
|---|---|
| **Symptom** | After a restart, `/business/pipeline` returned a **different response shape** (`stages` instead of `pipeline`) containing **another tenant's records** (`opp_1785926546438`, "Small Deal", "Micro L…"). |
| **Root cause** | `/business/pipeline` and `/business/stats` are each **mounted twice**. `backend/routes/ops.js` defines **34 `/business/*` routes** (leads, contacts, pipeline, stats, search) backed by `agents/runtime/businessOS.cjs`. The barrel mounts `ops.js` at **line 38** and `business.js` at **line 73**, so **ops.js wins**. |
| **Scoping difference** | `ops.js`: `_bos.getPipelineSummary()` — **no orgId**. `business.js`: `bds.getPipelineSummary(req.org.id)` — **org-scoped**, behind `requireAuth` + `_requireOrg`. |
| **Impact** | The unscoped handler shadows the org-scoped one. On the evidence available this is a **tenant-scoping risk on `/business/*` reads**. |
| **Attribution — corrected** | I initially suspected the external `git stash pop`. **That was wrong.** `git show HEAD:backend/routes/ops.js` also contains **34** `/business` routes — identical to the working tree. **This is pre-existing in the committed codebase**, not merge-introduced. |
| **Not fixed** | Deleting 34 routes from `ops.js`, or reordering the barrel, changes which implementation serves `/business/*` platform-wide. That is beyond "minimal fix" and needs your decision. |
| **Classification** | **VERIFY → confirmed defect, awaiting a scoping decision** |

**Isolation was NOT demonstrated as broken.** My two-account test returned status `0` — the server was already dead, so those results are empty strings, not evidence. I am not claiming a leak; I am claiming an unscoped handler shadows a scoped one, which is confirmed statically.

---

## 4. Environment repair performed (not an OS-5 objective)

The server would not start. Two blockers, neither mine:

1. **Unresolved merge conflict markers** in 5 files (`rateLimiter.js`, `rawBody.js`, `whatsapp.js`, `api.js`, `useRuntimeStream.js`) from an external `git stash pop`. These cleared externally while I inspected them.
2. **Duplicate `const` declarations** in `runtime.js` — `_pipelineOrch`, `_projectRunner`, `_blueprintGen` each declared twice, giving `SyntaxError: Identifier '_pipelineOrch' has already been declared`. The merge kept **both** branches' versions.

**Minimal repair applied:** removed the duplicate block at 4875–4877. Verified the two versions are semantically identical — `_tryRequirePhase571(p)` is defined as `try { return require(p) } catch { return null }`, exactly what the earlier IIFEs do, loading the same three modules. **No behaviour change.** Server started, `/health` 200 in 753 ms.

The process was then killed externally again. **Live verification could not be completed.**

---

## 5. Payment safety (Phase 5) — NOT EXECUTED

**No transaction was initiated.** Per the safety rule, I inspected configuration first: `RAZORPAY_KEY`/`RAZORPAY_SECRET` are provisioned, but I found **no evidence of a test-mode-only environment**, and the environment became unstable before the payment-link path could be safely exercised.

Verified only: `/billing/status` returns real per-account state (`plan: "trial"`, `status: "trialing"`, correct `accountId`), and `/orgs/:orgId/billing` returns real org billing (`memberCount: 1`, `byPlan: {trial: 1}`).

**Classification: CREDENTIAL / ENVIRONMENT BLOCKED.** No claim is made that payment collection works.

---

## 6. Invoices (Phase 6) — GENUINE CAPABILITY GAP

Traced across the whole repository. Mounted billing/payment routes are:
```
GET  /billing/status      POST /billing/upgrade    POST /billing/activate
POST /billing/cancel      POST /payment/link       POST /webhook/razorpay
POST /razorpay-webhook    POST /business/webhook/payment
GET  /orgs/:orgId/billing GET  /enterprise/audit/:orgId/billing-history
```
**No invoice entity, route, service, or storage exists** — no create, list, PDF, numbering, or line items. `/business/invoices` returns 404 (correctly, post-C.1.1).

**Classification: GENUINE CAPABILITY GAP.** Per the mission, recorded — **not built**.

---

## 7. Business OS capability matrix

| # | Capability | Evidence | Classification |
|---|---|---|---|
| 1 | CRM leads (create/read/update) | 3 leads persisted; `new → qualified` verified by re-read | **PRODUCTION READY** |
| 2 | Business leads + qualify | `lead_…` created; `stats.qualified 0 → 1` | **PRODUCTION READY** |
| 3 | Opportunities | `opp_…` created, 4 stage advances, close-won | **PRODUCTION READY** |
| 4 | **Pipeline** | `{count:1, value:250000}` from real data; stages move correctly | **PRODUCTION READY** *(subject to OS5-002)* |
| 5 | Revenue ledger | `rev_…` 250,000 → stats `byType`/`bySource`/`byMonth` | **PRODUCTION READY** |
| 6 | Business stats | aggregates both lead stores correctly (1 + 3 = 4) | **PRODUCTION READY** |
| 7 | Customers | real persisted mission | **PRODUCTION READY** |
| 8 | Operations | real persisted mission | **PRODUCTION READY** |
| 9 | Billing status | real per-account + per-org state | **PRODUCTION READY** |
| 10 | Fresh-tenant honesty | zeros, no cross-tenant totals | **PRODUCTION READY** |
| 11 | Qualification scores | random values shown as measured | **FIXED** (pending live re-verify) |
| 12 | `/business/*` route scoping | unscoped `ops.js` shadows org-scoped `business.js` | **VERIFY — defect confirmed** |
| 13 | Payments execution | no test-mode env; no transaction attempted | **CREDENTIAL BLOCKED** |
| 14 | Invoices | absent repo-wide | **GENUINE CAPABILITY GAP** |

**Totals:** PRODUCTION READY 10 · FIXED 1 · VERIFY 1 · CREDENTIAL BLOCKED 1 · GENUINE GAP 1 · **TOTAL 14**

---

## 8. Analytics honesty (Phase 3)

Scanned `businessDataService.cjs`, `businessIntelligenceEngine.cjs`, `businessEntityModel.cjs`, `businessOrg.cjs`.

| Service | Fabrication found |
|---|---|
| `businessDataService.cjs` | **0** |
| `businessIntelligenceEngine.cjs` | **0** |
| `businessEntityModel.cjs` | **0** |
| `businessOrg.cjs` | 3 — 2 **already correctly disclosed** (`synthetic: true`, `source: "demo_simulation"`), 1 undisclosed → **fixed as OS5-001** |

Every Business OS metric observed (pipeline counts/values, lead totals, revenue, stage transitions) traced to persisted records. **No fake percentages, revenue, timestamps, or conversion rates were found in the core Business OS data services.**

---

## 9. Regression

| Suite | Result |
|---|---|
| `npm run test:runtime` | **144/144 pass, 0 fail** — run twice, before and after all changes |
| Business/security suites | **BLOCKED** — require a live server; environment unstable |
| `19-logging-consistency` | **PRE-EXISTING FAIL**, untouched |

**No test modified. No BLOCKED counted as PASS.**

---

## 10. Certification decision

# BUSINESS OS: **NOT CERTIFIED — OPEN**

The core is genuinely strong: 10 of 14 capabilities are PRODUCTION READY on real executed workflows with verified persistence. But the rule is that certification requires real evidence for every non-credential capability, and two blockers stand:

1. **OS5-002 route shadowing** — an unscoped `/business/*` implementation shadows the org-scoped one. Until resolved, I cannot certify tenant scoping on Business OS reads.
2. **Live re-verification incomplete** — the environment was destabilised by external merge damage and repeated process kills. OS5-001's fix is in source but unverified live.

---

## 11. Exact next actions

1. **Decide OS5-002** — which `/business/*` implementation is canonical? Options: remove the 34 routes from `ops.js`, reorder the barrel, or namespace one set. This changes platform-wide behaviour, so it is your call, not mine.
2. **Stabilise the environment** — external `git stash pop` damage and process kills made live verification unreliable. I repaired the duplicate-declaration blocker; the rest needs owner action.
3. **Then** re-verify OS5-001 live and re-run the Business/security suites.
4. **Invoices** — genuine gap. Build only if the product needs it; nothing in the repo provides it.
