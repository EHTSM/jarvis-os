# OS-3 DEAD PROTOTYPE REGISTER

Date: 2026-08-13
**Nothing deleted. Nothing wired. No `/dev/*` or `/enterprise/orgs` API created.**

---

## The OS-3.11 "build from zero" test, applied with live evidence

For each prototype I verified whether its intended capability **already exists and works** elsewhere. 9 probes, live, authenticated:

| Prototype wants | Working equivalent | Status |
|---|---|---|
| `/enterprise/orgs` | `GET /orgs` | **200 ✓** |
| `/enterprise/depts` | `GET /orgs/:orgId/departments` | **200 ✓** |
| `/enterprise/teams` | `GET /orgs/:orgId/teams` | **200 ✓** |
| `/enterprise/policies` | `GET /enterprise/policy/:orgId` | **200 ✓** |
| `/enterprise/audit` | `GET /enterprise/audit/:orgId/search` | **200 ✓** |
| `/dev/projects` | `GET /engineering/intelligence` | **200 ✓** |
| `/dev/repos` | `GET /coding/decisions` | **200 ✓** |
| `/personal/tasks` | `GET /planning/tasks` | **200 ✓** |
| `/personal/knowledge` | `GET /twin/profile`, `/assistant/briefing` | **200 ✓** |

**9 of 9 capabilities already exist.** Under OS-3.11, none of these may be classified as BUILD.

---

## EnterpriseOS.jsx — 1,384 LOC

| Question | Answer |
|---|---|
| Backend endpoints real? | **No — 0 of 9 exist** (all 404 after the OS-3 boundary fix) |
| API calls still valid? | No — `enterpriseApi.js` (35 fns) targets a contract that was never built |
| Equivalent exposed elsewhere? | **Yes** — `/orgs/*` hierarchy verified working in OS-2 (dept + team persisted) |
| Referenced anywhere? | No — unreferenced in the entire frontend |
| Mounting it creates broken calls? | **Yes — 9 immediate 404s** |
| Duplicate UX? | Yes — duplicates the live `orgadmin` surface |
| Safe to archive later? | Yes, with the caveat below |

**Classification: DEAD PROTOTYPE → DELETE CANDIDATE**

*Caveat:* `enterpriseApi.js` encodes a considered CRUD contract (roles, permissions, policies as first-class resources). Archive rather than delete outright, in case that shape informs a future Enterprise decision.

## DeveloperOS.jsx — 953 LOC

| Question | Answer |
|---|---|
| Backend endpoints real? | **No — 0 of 7** (`/dev/*` has no mounted routes at all) |
| API calls still valid? | No — `developerApi.js` (29 fns) |
| Equivalent exposed elsewhere? | **Yes** — `/engineering/*` + `/coding/*`, both returning real data |
| Referenced anywhere? | No |
| Mounting it creates broken calls? | **Yes — 7 immediate 404s** |
| Duplicate UX? | Yes — duplicates `engineering` and `copilot` tabs |
| Safe to archive later? | Yes |

**Classification: DEAD PROTOTYPE → DELETE CANDIDATE**

## PersonalOS.jsx — 715 LOC

| Question | Answer |
|---|---|
| Backend endpoints real? | **No — 0 of 6** |
| API calls still valid? | No — `personalApi.js` (19 fns) |
| Equivalent exposed elsewhere? | **Yes** — `/planning/tasks`, `/planning/agenda`, `/assistant/briefing`, `/twin/profile` all verified 200 |
| Referenced anywhere? | No |
| Mounting it creates broken calls? | **Yes — 6 immediate 404s** |
| Duplicate UX? | Yes — duplicates `planning` and `assistant` tabs |
| Safe to archive later? | Yes |

**Classification: DEAD PROTOTYPE → DELETE CANDIDATE**

---

## Why these were dangerous

Before the C.1.1/OS-3 boundary fixes, all 22 endpoints returned **HTTP 200 with SPA HTML**. Anyone spot-checking status codes would conclude the backends existed. That is precisely how a dead prototype can be mistaken for evidence that "Enterprise OS already exists".

They now return honest 404s.

## Ongoing cost

All three are still maintained by sweeping refactors — the a11y token migration edited `EnterpriseOS.jsx` on 2026-08-12 and overlay fixes touched `DeveloperOS.jsx` on 2026-08-13. **~3,052 LOC is paying lint and accessibility tax while being unable to execute.**

## Recommendation

**ARCHIVE** all three (move to `_archive/`, which exists at repo root). Not delete — git history is a weaker signal than an explicit archive directory for design intent that may be revisited.

**Requires explicit authorization. Not performed in OS-3.**

Other unreferenced components (26 more, ~8,500 LOC) were catalogued in `C1.1_DEAD_FRONTEND_REGISTER.md` and are unchanged.
