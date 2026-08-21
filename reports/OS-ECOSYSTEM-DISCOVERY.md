# OS-ECOSYSTEM — DISCOVERY REPORT

**Track:** OOPLIX OS #17 — Ecosystem/Integration OS
**Date:** 2026-08-15 · **Branch:** `security/reality-completion`
**Method:** Read every named source-of-truth document first (per mission Section 1), then verified
live with real two-tenant testing. **No new orchestration architecture was built.**
**Isolation:** Verification server on **port 5221**. The Audit Track's own concurrent server (port
5050) was checked before and after every process action this pass — confirmed running throughout,
including through several of its own legitimate self-initiated restarts (visible mid-restart once,
confirmed healthy again within seconds; never caused by this session).

---

## 1. Source-of-truth review

Read in full: `MASTER-OPEN-FINDINGS.md` (42 dispositioned items from the Audit Track's own C.10 +
Master Recovery work), `MASTER-RECOVERY-FINAL.md` (8/10, PARTIAL RECOVERY certification),
`MASTER-RECOVERY-CROSS-OS.md` (per-flow status), `OS-PRODUCT-FINAL.md` (this session's own prior
Product OS certification), `OS-REGISTER.md`. `MASTER-RESIDUAL-CLOSURE-FINAL.md` (named in the
mission) does not exist yet in the repository — proceeded without it, noted honestly rather than
fabricated.

**Key facts established before any new investigation:**
- Zero P0 findings remain open across the entire C.1–C.10 + Master Recovery arc (per
  `MASTER-RECOVERY-FINAL.md`'s own explicit "Are there any known V1-critical defects still silently
  unresolved? NO" section).
- The Audit Track's own concurrent session had, in real time during this very day, already fixed
  the identical root-cause class this pass would go on to find in Product OS: `unifiedIntelligenceLayer`'s
  `/intelligence/unified/*` routes were found and fixed to require `requireOrgMember` in addition to
  `attachOrg` (confirmed via `tests/runtime/10-c10-cross-system-closure.test.cjs`'s own test names,
  read during this pass's regression run).
- Product OS's own Final report (same-day, earlier) explicitly classified its 0/5 tenant isolation
  as an "architectural gap" requiring a schema migration — this pass's mandate (Section 3) was to
  re-investigate that verdict specifically, not accept it.

## 2. Product OS security re-investigation — the verdict was wrong

Re-investigated per the mission's explicit checklist (Section 3): "Can product records be
associated with existing organization context? Can existing middleware enforce membership? ... How
many records exist? Are records referenced elsewhere?"

**Blast-radius check (the step the earlier pass had not done thoroughly):**
```
grep -rln 'require.*productPlannerEngine|...productArchitectureEngine|...productAssemblyEngine|
           ...productValidationEngine|...productReleaseEngine' backend/
→ 14 files reference these modules by require(); of those, 9 do so ONLY for a health-check
  ping (ok: !!_ppe()) or a static architecture-catalog comment — zero actual function calls.
  Only productFactory.js (the route) and ProductOSCenter.jsx (the frontend) are real consumers.
```
**Record volume:** 146 plans, 111 architectures, 54 assemblies, 82 validations, 54 releases — all
currently unowned (no `orgId` field anywhere).

**Conclusion: safely recoverable with zero blast radius.** Fixed identically to the already-proven
`/dev/*` precedent (`developerOS.cjs`, C10-003): `orgId` required going forward on every
data-access function across all 5 engines + the dashboard's `getProductView()`; pre-existing
unowned records become invisible (not misattributed) to any real orgId query, matching the exact
"never fall back to all tenants'" contract already established in this codebase. See Security
report for the full fix detail and live verification.

## 3. A second, more severe finding — the recovery pattern itself had a gap

While verifying the Product OS fix against its own cited precedent (`/dev/*`), this pass tested the
**same forged-header vector** against `/dev/*` itself — and found it **also vulnerable**, despite
being the "already fixed" C10-003 exemplar this pass's own new Product OS fix was modeled on.

**Root cause:** `attachOrg` resolves `req.org` from a client-supplied `X-Org-Id` header with **no
membership verification** — it is explicitly documented as non-blocking in its own file header
(`orgMiddleware.cjs`: "Does NOT block requests — use requireOrgMember() for enforcement"). Both
`/dev/*`'s and this pass's first version of `/product-factory/*`'s gates used `attachOrg` alone
plus a bare `!req.org?.id` truthy check — which only verifies *some* real org resolved, not that
the caller is a genuine member of it.

**Live-reproduced on `/dev/*`:** account B, with `X-Org-Id` forged to account A's real org, both
**listed and created** repos under account A's org — a real cross-tenant read and write on the
platform's own cited "correctly fixed" exemplar.

**A third, differently-shaped instance found in `/customer-org/*`:** this file's own `_orgId(req)`
helper *correctly* returns `null` for a forged header the caller isn't a member of — but the
downstream service functions (`customerHealthEngine.listHealthRecords`, and the same pattern
elsewhere in the file) treat a `null` orgId as "don't filter" rather than "return nothing" (a
legitimate design choice for genuinely unscoped/operator callers elsewhere in the codebase). This
produced an **inverted** vulnerability: a forged-header "verified nobody" received *more* data (the
entire platform-wide record set, ~58 real records) than a genuine member of their own (empty) org.

All three fixed identically: `requireOrgMember` added to the router-level gate. See Security report
for full live verification of all three, plus the false-positive check on `crm.js` (which uses
`attachOrg` alone but is coincidentally safe due to an independent second filter — verified, not
assumed).

## 4. Canonical organization hierarchy — audited across the platform

Ran a systematic grep for every route file using `attachOrg`:
```
27 files reference attachOrg. 18 already pair it with requireOrgMember/requireOrgPermission
(correct). 9 use attachOrg alone — of those: 3 are false positives (mentioned only in comments,
not actually invoked: companyFactory.js, payment.js, whatsapp.js); 2 are legitimate usage-
attribution-only patterns where a forged header would misattribute billing, not disclose data
(ai.js, jarvis.js — lower severity, not fixed this pass, consistent with the C10-004b "escalated,
not blanket-fixed" precedent); 1 is coincidentally safe via an independent second filter (crm.js,
verified not assumed); 3 were the real, live, exploitable findings above (ops.js /dev/*,
productFactory.js, customerOrg.js), all now fixed.
```
No alternate organization model, no duplicate membership store, and no platform-global store
accidentally exposed was found beyond the three fixed above — the canonical
`organizationService.cjs` RBAC model (`Organization → Department → Team → Member → Role →
Permission`) is used consistently everywhere checked.

## 5. Cross-OS flows — status summary (full detail in Cross-OS report)

| Flow | Status |
|---|---|
| A. Lead → CRM → Sales → Opportunity → Closed Won → Revenue → Executive | **PASS** (re-confirmed, unaffected by this pass; churn/decrement path added in Master Recovery) |
| B. Customer → Customer Success → Support → Resolution → Executive | **PASS** (re-confirmed; the `/customer-org/*` forged-header fix strengthens this flow's isolation, doesn't change its function) |
| C. Marketing → Audience → Campaign → CRM identity → Customer/lead state | **PASS** (re-confirmed via Master Recovery's own Flow 2/3 findings, unaffected by this pass) |
| D. AI Workspace → Mission → Agent → Runtime → Result → Memory/Knowledge | **PARTIAL** — AI→Mission→Runtime real (credential-blocked in this environment, honest failure verified live); Memory leg fixed in Master Recovery (C10-004); Knowledge leg remains a genuine gap (C10-009, frontend not wired) |
| E. Developer → Mission → Runtime → Engineering result → Memory/Knowledge | **PASS** (Developer OS org-scoping now genuinely secure after this pass's forged-header fix, on top of C10-003's earlier fix) |
| F. Automation → Trigger → Scheduler/Event → Runtime/Mission → Result | **GENUINE GAP, unchanged** (C10-007 — no live execution loop exists; correctly escalated in Master Recovery, not built here, per the same "requires a trigger-model product decision" reasoning) |
| G. Organization → Workspace → Department → Team → OS access | **PASS** (verified live, real hierarchy, real RBAC) |

## 6. Executive reconciliation — a real, previously-unrecognized answer to C10-006

C10-006 left open whether `/org-executive/:orgId/*` (real, org-scoped, already built) should be
recognized as the completion of the Executive flow for regular org owners — flagged as a "product
decision," not verified live in Master Recovery.

**This pass verified it live:** `GET /org-executive/:orgId/summary` returns a real, composed,
org-scoped executive summary (member count, connector health, AI spend, knowledge-graph node count,
agent task success rate, automation savings) — genuinely reachable by a real org owner, genuinely
isolated (both a forged-header test and a direct non-member path test correctly returned 403), and
has a real frontend consumer (`OrgAdminCenter.jsx`). This resolves C10-006's open question with
live evidence: **the org-scoped Executive completion already exists and works** — it was simply not
independently re-verified until this pass.

---

**Outcome:** Ecosystem OS's job was to determine whether OOPLIX's OSs operate as one integrated
platform. The investigation found: (1) a genuine, safely-recoverable P0-class Product OS security
gap, now fixed; (2) that the fix's own cited precedent had an undiscovered, more severe variant of
the same defect, now also fixed, across 3 real route files; (3) that the canonical organization
hierarchy is otherwise used consistently; (4) that most named cross-OS flows genuinely work; (5)
that one open architectural question (C10-006) has a real, live, positive answer that was simply
not yet confirmed. **0 new systems built.**
