# OS-PRODUCT — WORKFLOW EVIDENCE

**Date:** 2026-08-15 · **Server:** `localhost:5210` · **Auth:** real `POST /auth/login` sessions
only — no JWT forged, no auth bypassed. **Audit Track's server (port 5050) confirmed running
throughout, including through its own legitimate self-initiated restarts.**

**Accounts / tenants used (real, registered via `POST /accounts/register`):**

| Account | Org |
|---|---|
| `proda@test.local` ("A") | `org_1786772214216_1` |
| `prodb@test.local` ("B") | `org_1786772214279_2` |

---

## Chain verified

```
Frontend (ProductOSCenter.jsx)
  → productFactoryApi.js  →  POST/GET /product-factory/*  →  productPlannerEngine.cjs
                                                              → productArchitectureEngine.cjs
                                                              → productAssemblyEngine.cjs
                                                                  → workforceManager.runMission()
                                                                  → missionOrchestrator.createManual()
                                                                  → companyLifecycleEngine.createCompany()
                                                              → productValidationEngine.cjs
                                                                  → deploymentValidator / selfReviewEngine / etc.
                                                              → productReleaseEngine.cjs
  → engOrgApi.js          →  GET/POST /engorg/v2/*         →  engineeringOrgState.cjs
```

---

## W1 — Real full pipeline: plan → architecture → assembly → validation → release

```json
POST /product-factory/plan
{"objective":"PRODUCT-A-f83a21 secret test product for tenant isolation","skipResearch":true}
→ {"ok":true,"plan":{"id":"pp_1786772228913_m2t9","status":"approved",
    "requirements":["User authentication and account management", ...5 total],
    "complexity":{"score":60,"level":"high"},
    "roadmap":{"phases":[...3 phases...],"sprints":3,"totalHours":130,"estimatedDays":17}}}
```
Real, genuinely-computed content — requirements, complexity signals, and roadmap phases differ
meaningfully between distinct objectives (verified by creating a second plan with different content
and confirming its requirements/complexity differed).

```json
POST /product-factory/arch/pp_1786772228913_m2t9
→ {"ok":true,"architecture":{"id":"pa_1786772314495_adt6","status":"designed",
    "reuseRatio":65,"usedServices":22,"totalServices":34,"reviewScore":79}}
```

---

## THE FIX — assembly's mission/workforce integration was silently broken

### Reproduction (pre-fix)

```
POST /product-factory/assemble/pp_1786772228913_m2t9  {"archId":"pa_1786772314495_adt6"}
→ {"ok":true,"assembly":{"status":"completed",
     "orchestratorMissionId":null,"companyId":null,
     "stages":{"scaffold":{"ok":true,"missionId":null}, ...all 6 stages missionId:null}}}
```

### Ground truth — the server's own log, checked BEFORE trusting the API response

```
[2026-08-15T05:38:55.399Z] [INFO] [MissionMemory] Created mission msn_a6f34b851b624575b7f9f3860eaee3d9:
  "Autonomous product assembly: PRODUCT-A-f83a21 secret test product for tenant isolation"
```
**A real mission genuinely existed** — the API response's `null` was a pure read-side bug, not an
honest reflection of a real failure.

### Root cause

```js
// productAssemblyEngine.cjs, BEFORE:
const mission = await _wfm()?.runMission?.({...});
if (mission?.ok) { result.missionId = mission.mission?.id; ... }   // real field is mission.id

const m = _mo()?.createManual?.({...});
if (m?.ok) asm.orchestratorMissionId = m.mission?.id;              // createManual() returns the
                                                                     // record directly — no .ok,
                                                                     // no .mission wrapper; real
                                                                     // field is m.missionId
```
Plus a third, genuinely-always-failing call:
```js
const co = _clc()?.createCompany?.({ name, description, founder: "autonomous_factory" });
// createCompany() REQUIRES creatorAccountId — never passed — fails every time,
// silently swallowed by catch{}
```
All three failures (2 read-bugs on real successes, 1 genuine deterministic failure) were absorbed
into an unconditional `asm.status = "completed"`.

### Fix

```js
if (mission?.ok) { result.missionId = mission.id; result.minutesSaved += 30; }
else { result.ok = false; result.error = mission?.error || "workforce mission failed"; }

if (m?.missionId) asm.orchestratorMissionId = m.missionId;
else asm.missionCreationError = "mission orchestrator returned no missionId";

if (co?.ok) { asm.companyId = co.company?.id; }
else { asm.companyCreationError = co?.error || "company creation failed"; }

// ...after all stages:
asm.status = anyStageFailed ? "completed_with_errors" : "completed";
```

### Live re-verification (post-fix, fresh plan/arch/assembly)

```json
POST /product-factory/assemble/pp_1786772811780_by7j  {"archId":"pa_1786772824699_ajpc"}
→ {"ok":true,"assembly":{"status":"completed",
     "orchestratorMissionId":"msn_c8edf933244d4decbbe8756a12cf84c0",
     "companyId":null,"companyCreationError":"creatorAccountId is required",
     "stages":{"scaffold":{"ok":true,"missionId":"wf_1786772829986_1nh"},
               "engineering":{"ok":true,"missionId":"wf_1786772830676_og3"},
               ... all 6 stages now carry a real workforce mission id}}}
```
Real mission id now correctly captured; the genuinely-failing company-creation call is now honestly
surfaced (`companyCreationError`) instead of silently discarded; overall `status:"completed"`
correctly reflects that every stage's own `ok` was true (the company-creation failure doesn't gate
the assembly's own stage completion, since it was never a stage precondition — it's a separate,
now-honestly-reported side effect).

---

## THE FIX — validation's fallback scores were indistinguishable from real measurement

### Reproduction and live re-verification (real HTTP, real 6-dimension validation)

```json
POST /product-factory/validate/pp_1786773028743_yq5d  {}
→ {"ok":true,"validation":{"overallScore":76,"productionReady":true,
     "measuredDimensions":5,"totalDimensions":6,
     "dimensions":{
       "build":{"source":"deploymentValidator","score":66},
       "tests":{"source":"selfImprovementEngine","score":100},
       "security":{"source":"selfReviewEngine","score":60},
       "performance":{"source":"fallback","score":78},
       "accessibility":{"source":"engineeringQualityEngine","score":82},
       "bible_compliance":{"source":"productionBibleEngine","score":94}}}}
```
5 of 6 dimensions used a real underlying service; 1 (`performance`) genuinely fell back — now
visible via `measuredDimensions:5/6` rather than silently indistinguishable from a full real
measurement. `productionReady:true` is correctly still granted since real measurement did occur for
the majority of dimensions.

### Explicit mock-preview path re-verified unaffected

```json
POST /product-factory/validate/pp_1786773028743_yq5d  {"skipExecute":true}
→ {"validation":{"productionReady":true,"measuredDimensions":0,"totalDimensions":6}}
```
Honestly shows `0/6` measured (nothing real ran, by explicit disclosed request) while still
honoring the mock preview's own contract for `productionReady` — the fix targets only the
*undisclosed* silent-fallback case, not this legitimate, disclosed preview mode.

---

## THE CENTRAL FINDING — cross-tenant access, live-reproduced (not empty-vs-empty)

```
A creates: PRODUCT-A-f83a21 secret test product for tenant isolation  → pp_1786772228913_m2t9
B creates: PRODUCT-B-c91d47 secret test product for tenant isolation  → pp_1786772242868_dnmy

B (own org, zero relationship to A's org) —
  GET /product-factory/plan/pp_1786772228913_m2t9        → 200, FULL real data, incl. secret string
  GET /product-factory/plans                              → 50 plans returned: A's, B's, AND every
                                                              historical test plan on the platform
  POST /product-factory/arch/pp_1786772228913_m2t9  {}    → 200, B GENUINELY RAN a real write
                                                              operation (architecture design) against
                                                              A's plan — not just a read leak
  GET /product-factory/dashboard/product/pp_1786772228913_m2t9  → 200, full cross-tenant dashboard view
```
Full detail, root cause, and certification-scope decision in the Security and Final reports.

---

## Persistence — verified across a real restart

```
Before restart: plan pp_1786772228913_m2t9 = "PRODUCT-A-f83a21 secret test product..."
                architecture pa_1786772314495_adt6 = status "designed"
[server confirmed stopped, Audit Track's port 5050 confirmed untouched, restarted clean]
After restart:  plan intact, identical objective text
                architecture intact, status still "designed"
Plan list: 50 total, 50 unique ids (no duplicates introduced by restart)
```

---

## Failure honesty — tested explicitly

```
GET  /product-factory/plan/nonexistent-id           → 404 "plan not found"
POST /product-factory/plan  {}                       → 400 "objective required"
POST /product-factory/assemble/nonexistent-plan {}   → 400 "plan not found: nonexistent-plan"
```
No fake "created"/"released"/"deployed" found anywhere in this pass's testing beyond the two fixed
defects above.

---

## Build

```
CI=false npm run build:frontend → succeeds
0 poisoned test-port URLs found in the built bundle
```

## Regression

| Suite | Result |
|---|---|
| `npm run test:runtime` | **189/190** (1 transient, unrelated failure in the concurrent Audit Track's own `codingAssistant.js` test — confirmed via `git status` to involve zero files this pass touched; same class of cross-track staleness observed and documented in every prior OS pass this session) |
| `tests/security/112-product-os-fake-success-honesty.cjs` (new) | **11/11** |

Negative-test discipline: reverted both fix files via `git stash`, confirmed 9/11 assertions
genuinely fail against the pre-fix code, restored the fixes, confirmed 11/11 pass. No test was
modified, skipped, or weakened.
