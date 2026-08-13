# OOPLIX REAL PRODUCT ENDPOINT CENSUS
**Phase C.1 Part 2 — endpoint classification before execution**

Date: 2026-08-13 · Branch: `security/reality-completion`
Source: live Express router tree walk (`require("backend/routes/index")`), not source grep.

---

## TOTAL: 4,535 mounted endpoints

| Class | Count | % | Definition |
|---|---:|---:|---|
| **A. Product capability** | **2,586** | 57.0% | Customer-facing feature surface |
| B. Infrastructure/runtime | 1,201 | 26.5% | `/runtime`, `/tasks`, `/queue`, `/lifecycle`, `/execution` |
| C. Authentication/security | 15 | 0.3% | `/auth`, `/accounts`, `/mfa`, `/sso`, `/scim` |
| D. Internal/admin | 59 | 1.3% | `/admin`, `/ops`, `/settings`, `/governance`, `/security` |
| E. Certification/self-audit | 324 | 7.1% | `/rc1`–`/rc4`, `/dop`, `/pm7`, `/alpha`, `/beta`, `/cbeta`, `/pomena`, `/wiring`, `/credentials`, `/ext`, `/op1`, `/co2`, `/co3` |
| F. Legacy/versioned | 339 | 7.5% | `/p18`–`/p27` (deprecation middleware already attached) |
| G. Health/diagnostic | 11 | 0.2% | `/health`, `/status`, `/ping`, `/metrics` |
| H. Unknown after investigation | 0 | 0% | — |

**Excluded from functional verification: 1,949 endpoints (43%)** across classes B–G.

### Why the exclusions are justified

**Class E (324) — certification scaffolding.** These endpoints exist to measure and certify the product, not to serve customers. `/rc3/*` runs a stability audit; `/dop2/*` tracks a deployment rehearsal; `/pomena/*` self-reviews the platform. A founder never calls these. They inflate any raw endpoint count by ~7%.

**Class F (339) — legacy `/pNN/*`.** `backend/routes/index.js` already wraps these in `_deprecate()` middleware emitting `Deprecation: true` headers and pointing at canonical successors. The repository has already classified them; this census agrees.

**Class B (1,201) — infrastructure.** Dominated by `runtime.js` (1,165 endpoints, 11,682 LOC). Real and heavily used, but it is the execution substrate beneath the product rather than a customer capability. Counting it as "Business OS capability" would be double-counting.

---

## Class A breakdown — 2,586 product endpoints

| Method | Count | Verification approach |
|---|---:|---|
| GET, no path parameter | **1,010** | **Executed live** (Part 3) |
| GET, requires path parameter | 426 | Not executed — needs fixtures |
| POST/PUT/PATCH/DELETE | 1,150 | Not executed — mutation safety |

**Coverage: 1,010 of 2,586 product endpoints (39%) executed against a live authenticated server.**

The remaining 61% were deliberately not executed. Parameterised GETs need valid entity IDs per tenant; mutations would write real state into the running system. Both are legitimate follow-on work, but executing them blindly would have violated the "mutation safety" constraint in the brief.

### Top product prefixes by endpoint count

| Endpoints | Prefix | | Endpoints | Prefix |
|---:|---|---|---:|---|
| 115 | `/odi` | | 53 | `/growth` |
| 114 | `/business` | | 49 | `/research` |
| 80 | `/civ` | | 48 | `/enterprise` |
| 70 | `/ent` | | 43 | `/launch` |
| 67 | `/computer` | | 42 | `/content` |
| 65 | `/platform` | | 42 | `/distrib` |
| 64 | `/eco` | | 41 | `/workspace-mesh` |
| 62 | `/engineering` | | 38 | `/coding` |
| 61 | `/creative` | | 37 | `/aeo` |
| 59 | `/browser-platform` | | 36 | `/browser` |

---

## Census caveat

Endpoint count is **not** capability. `/civ/*` (80 endpoints, "Civilization OS") and `/eco/*` (64, "Ecosystem OS") are abstract organisational simulation layers, not features a founder operates. They are classified A because they are not infrastructure, auth, or certification — but their *product* value is materially lower per endpoint than `/growth/*` or `/business/*`.

The functional matrix (Part 3) is the authority on what actually works. This census only decides **what deserved to be tested**.
