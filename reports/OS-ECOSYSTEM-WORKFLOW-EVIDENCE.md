# OS-ECOSYSTEM — WORKFLOW EVIDENCE

**Date:** 2026-08-15 · **Server:** `localhost:5221` · **Auth:** real `POST /auth/login` sessions
only. **Audit Track's server (port 5050) confirmed running throughout, including through several
of its own legitimate self-initiated restarts.**

**Accounts reused from the same-day Product OS pass (real, registered):**

| Account | Org |
|---|---|
| `proda@test.local` ("A") | `org_1786772214216_1` |
| `prodb@test.local` ("B") | `org_1786772214279_2` |

---

## THE FIX — Product OS tenant isolation (Section 3, first priority)

### Blast-radius verification (done BEFORE writing any fix)

```
grep -rln 'require.*productPlannerEngine|...' backend/ → 14 files
  9 of 14: health-check ping only (ok: !!_ppe()) or static comment — 0 real calls
  2 real consumers: backend/routes/productFactory.js, frontend/src/components/ProductOSCenter.jsx
```
Confirmed safe to add real org-scoping with zero risk to other systems.

### Fix applied (all 5 engines + dashboard, same pattern as developerOS.cjs/C10-003)

```js
function _ownedBy(item, orgId) { return item.orgId === orgId; }
function _requireOrgId(orgId, fnName) { if (!orgId) throw new Error(`${fnName}: orgId is required`); }

function getPlan(orgId, id) {
  _requireOrgId(orgId, "getPlan");
  return _load().plans.find(p => p.id === id && _ownedBy(p, orgId)) || null;
}
// ... identically for listPlans, updatePlanStatus, createPlan, and the equivalent
// functions across productArchitectureEngine/productAssemblyEngine/
// productValidationEngine/productReleaseEngine/productFactoryDashboard.getProductView()
```

### Route layer

```js
router.use((req, res, next) => requireAuth(req, res, () => attachOrg(req, res, next)));
router.use("/product-factory", requireOrgMember);
// every handler now passes req.org.id as the first argument to every engine call
```

### Live re-verification (real HTTP, real accounts)

```
A lists plans BEFORE fix: 50 (every tenant's + legacy platform-wide plans)
A lists plans AFTER fix:   0  (honest — A has no plans of its own yet)

A creates a fresh plan → real orgId recorded: "org_1786772214216_1"

B, direct-ID read of A's fresh plan            → 404 "plan not found"
B, list plans                                   → total: 0 (A's plan correctly excluded)
B, POST architecture design against A's plan    → 400 "plan not found: pp_..." (WRITE blocked)
B, dashboard product view of A's plan           → 404 "plan not found: pp_..."

A, own plan read                                → 200, full real data (unaffected)
A, full pipeline (arch→assembly→validation→release) → all 4 stages succeed, all carry
   the correct real orgId, assembly's real mission id correctly captured (from the
   earlier same-day Product OS pass's own honesty fix, still working correctly
   layered under this pass's tenant-isolation fix)
```

Full pipeline result:
```json
{"status":"completed","orgId":"org_1786772214216_1","orchestratorMissionId":"msn_db02881e..."}
{"orgId":"org_1786772214216_1","productionReady":true}
{"orgId":"org_1786772214216_1","version":"1.0.754"}
```

Legacy (pre-fix) records verified honestly invisible, not deleted or misattributed:
```
A, direct-ID read of the OLD cross-tenant-vulnerable plan (pp_1786772228913_m2t9,
   created before this fix) → 404 "plan not found" — correctly invisible to
   everyone now, including its own original creator's account, since it predates
   real org tracking. Not deleted from disk (data/product-plans.json still contains
   it) — just correctly excluded from every scoped query.
```

---

## THE SECOND FINDING — `/dev/*`'s own C10-003 fix was incomplete

### Reproduction (against the "already fixed" precedent this pass's own fix was modeled on)

```
A creates a real repo: "A-SECRET-REPO-4471" → real orgId recorded

B, forged X-Org-Id: <A's real org>, GET /dev/repos
→ 200 {"repos":[{"name":"A-SECRET-REPO-4471","orgId":"org_1786772214216_1"}]}   ← LEAK

B, forged X-Org-Id: <A's real org>, POST /dev/repos {"name":"B test repo"}
→ 200 {"success":true,"repo":{"orgId":"org_1786772214216_1", ...}}              ← CROSS-TENANT WRITE
```

### Fix

```js
router.use("/dev", requireAuth, attachOrg, requireOrgMember);
```

### Live re-verification (post-fix)

```
B, forged X-Org-Id: <A's real org>, GET /dev/repos
→ 403 {"error":"Not a member of this organization"}

A, own access (no header)   → 200, unaffected
B, own access (no header)   → 200, unaffected
```

---

## THE THIRD FINDING — `/customer-org/*`'s "verified nobody gets more data" leak

### Reproduction

```
B, forged X-Org-Id: <A's real org>, GET /customer-org/health
→ 200, 58 real health records spanning many different real orgIds (platform-wide leak)

B, NO header at all (legitimate auto-resolve to B's own org)
→ 200, {"records":[]}   (correctly empty — B's own org genuinely has none)
```
**The forged-header path returned MORE data than the legitimate path** — the inverted shape
described in the Discovery report.

### Root cause (service layer, not the route's own `_orgId()` helper — which was already correct)

```js
// customerHealthEngine.cjs
function listHealthRecords({ risk, grade, limit = 50, orgId = null } = {}) {
  let list = _load().records;
  if (orgId) list = list.filter(r => r.orgId === orgId);   // orgId===null → NO FILTER APPLIED
  ...
}
```

### Fix

```js
router.use("/customer-org", requireAuth, attachOrg, requireOrgMember);
```
Closes the "verified nobody" path before any handler (and therefore before `listHealthRecords`)
can ever be reached with a null orgId from a forged-but-non-member header.

### Live re-verification (post-fix)

```
B, forged X-Org-Id: <A's real org>  → 403 "Not a member of this organization"
B, no header (own org auto-resolve)  → 200 {"records":[]}   (unaffected)
A, no header (own org auto-resolve)  → 200 {"records":[]}   (unaffected)
```

---

## A verified-safe false positive — `crm.js`

`GET /crm/leads` also uses `attachOrg` alone with no `requireOrgMember`. Tested the identical
forged-header vector:
```
A creates a real lead: "CRM-SECRET-A-lead"
B, forged X-Org-Id: <A's real org>, GET /crm/leads → 0 leads returned (no leak)
```
**Root cause of the coincidental safety, verified by reading the route:**
```js
const all = crm.getLeads(undefined, req.user.role === "operator" ? undefined : _orgId(req));
const mine = all.filter(l => l.userId === userId);   // independent second filter
```
A second, independent filter by the caller's own `userId` happens to close the gap this specific
route would otherwise have — confirmed by code inspection, not assumed from the empty result alone.
**Not fixed — genuinely not vulnerable**, documented as a real finding investigated to a
conclusion, not left ambiguous.

---

## Executive reconciliation — `/org-executive/:orgId/*` verified live (resolves C10-006)

```
GET /org-executive/org_1786772214216_1/summary   (A, own org)
→ 200 {"ok":true,"summary":"Product Alpha's Organization has 1 member(s) on the free plan.
        Connector health score: 100. AI spend so far (sampled): $0. Knowledge graph tracks
        0 node(s) for this organization. Agent task success rate: 0%. 0 active automation
        rule(s), an estimated 0h saved.", ...}

B, forged X-Org-Id header for A's org   → 403 "Forbidden — not a member of this organization"
B, A's org directly in the path         → 403 (same — path param is authoritative, immune to forgery)
```
Real, composed, cross-OS data (connectors + AI usage + knowledge graph + agent tasks + automation),
genuinely tenant-isolated, genuinely reachable by a real org owner (not operator-only), with a real
frontend consumer (`OrgAdminCenter.jsx`). This is the real, working completion of the Executive flow
for regular org owners that C10-006 left as an open question.

---

## AI Workspace → Mission → Runtime — failure honesty re-confirmed

```
POST /jarvis {"input":"test ecosystem flow D"}
→ 500 {"success":false,"reply":"Something went wrong. Please try again.",
        "error":"AI backend unavailable. Check provider API keys in your .env file."}
```
Same honest credential-blocked failure pattern already established across every prior pass this
session — real `success:false`, real error text, no fabricated completion.

---

## Persistence — verified across a real restart

```
Before restart: A's fresh plan pp_1786776711049_s6pb — full pipeline complete (plan→arch→
                 assembly→validation→release), all real orgId
[server confirmed stopped via TaskStop, Audit Track's port 5050 confirmed untouched throughout,
 restarted clean]
After restart:  identical data confirmed intact via re-login + re-verification of all 3 fixes
                (Product OS, /dev/*, /customer-org/*) — all still correctly blocking forged headers,
                all still correctly allowing legitimate own-org access
```

---

## Cleanup

```
A's test repos (2, including the secret-labeled one) → archived via POST /dev/repos/:id/archive
B's test repo (1) → archived
Product OS plans/CRM leads: no delete/archive endpoint exists — left as evidence, matching
  precedent established across every prior OS pass this session for append-only stores
```

---

## Build

```
CI=false npm run build:frontend → succeeds
```
No frontend file modified this pass.

## Regression

| Suite | Result |
|---|---|
| `npm run test:runtime` | **200/200** (before and after every fix) |
| `tests/security/113-ecosystem-os-tenant-isolation-recovery.cjs` (new) | **21/21** |
| `tests/runtime/10-c10-cross-system-closure.test.cjs` (updated: 1 stale literal-string assertion corrected to match the new, strictly-more-secure `/dev/*` gate; 1 new assertion added) | **21/21** |

Negative-test discipline: reverted all 9 modified files via `git stash`, confirmed 18/21 new-test
assertions genuinely fail against the pre-fix code, restored the fixes, confirmed 21/21 pass. The
one pre-existing test whose literal string assertion became stale due to this pass's own
strictly-more-secure fix was corrected (not weakened — its assertion now requires the new,
additional `requireOrgMember` gate to be present, a stronger check than before) and documented in
its own file header.
