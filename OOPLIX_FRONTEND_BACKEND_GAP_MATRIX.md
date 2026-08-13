# OOPLIX FRONTEND ↔ BACKEND GAP MATRIX
**Phase C.1 Part 5 — first broken link per capability chain**

Date: 2026-08-13

Chain tested per surface:
```
BACKEND EXISTS → ROUTE WORKS → API CLIENT → COMPONENT → NAVIGATION
              → SEARCH DISCOVERABILITY → REAL DATA RENDERS → MUTATION WORKS
```

---

## Result across 82 navigable surfaces

| Verdict | Count |
|---|---:|
| **CHAIN OK** (backend → route → component → nav → search all present) | **65** |
| No GET endpoint detectable by static extraction | 16 |
| Permission blocked (403, operator-tier — correct behaviour) | 1 |
| **Genuinely broken chains** | **0** |

**No navigable surface in the application has a missing backend.**

---

## Correction — three reported breaks were false positives

An initial GET-only probe flagged three surfaces as "BACKEND MISSING (all SPA html)". All three were **wrong**, caused by probing POST-only routes with GET:

| Surface | Endpoint | Reality |
|---|---|---|
| `copilot` | `/jarvis` | Mounted as **POST** `/jarvis` |
| `supportos` | `/ai/chat` | Mounted as **POST** `/ai/chat` |
| `guardrails` | `/runtime/guard/regression-check` | Mounted as **POST** at [runtime.js:5798](backend/routes/runtime.js#L5798) |

All three chains are intact. This is recorded rather than quietly dropped because it is the same error class this phase exists to catch: **a probe method mismatched to the route produces a confident, wrong "missing capability" verdict.**

The 16 "no endpoint detected" surfaces are the same limitation — static string extraction cannot see endpoints built dynamically or reached through POST helpers. They are **unverified, not broken**.

---

## The one real frontend↔backend gap: three orphaned components

These are **not** in the 82 navigable surfaces — they are unreferenced by any navigation, which is why they don't appear above. Runtime-verified against the live server:

| Component | LOC | API module | Endpoints called | Exist? |
|---|---:|---|---:|---|
| `EnterpriseOS.jsx` | 1,384 | `enterpriseApi.js` (35 fns) | 9 | **0 / 9** |
| `DeveloperOS.jsx` | 953 | `developerApi.js` (29 fns) | 7 | **0 / 7** |
| `PersonalOS.jsx` | 715 | `personalApi.js` (19 fns) | 6 | **0 / 6** |

**Total: 0 of 22 endpoints exist.**

Every one returns **HTTP 200 with SPA HTML**:
```
200  MISSING (SPA html)  /enterprise/orgs      200  MISSING (SPA html)  /dev/projects
200  MISSING (SPA html)  /enterprise/depts     200  MISSING (SPA html)  /dev/repos
200  MISSING (SPA html)  /enterprise/roles     200  MISSING (SPA html)  /personal/tasks
```

**First broken link: BACKEND EXISTS — the very first stage.**

---

## Systemic finding: the SPA catch-all masks every missing API route

`backend/server.js` serves the SPA on unmatched paths. Consequence:

```
GET /definitely/not/a/route   → 200 HTML
GET /api/v99/nonsense         → 200 HTML
GET /enterprise/orgs          → 200 HTML   ← what EnterpriseOS.jsx calls
```

**A client cannot distinguish "route missing" from "route working" by status code alone.** A missing API returns 200, and the consumer fails later at JSON parse instead of at a clean 404.

This has three consequences worth acting on:

1. **It made the orphaned components look plausible.** They call endpoints that "return 200". Only inspecting the body reveals HTML.
2. **It corrupted this phase's own measurement.** An early cross-tenant test read 200 on three non-existent org paths and briefly looked like a data leak. It was not — the *owner* got the same 200 HTML. Testing status alone produced a false security finding.
3. **It will corrupt any future audit** that trusts status codes.

**Recommended (not applied — no build authorized this phase):** return JSON 404 for unmatched paths under known API prefixes, before the SPA fallback. This is a ~5-line ordering change in `server.js`, not new architecture.

---

## Navigation & search layers — verified complete

| Layer | Status |
|---|---|
| Navigation coverage | **100%** — all 86 render guards reachable (Phase C.0) |
| Search discoverability | **100%** — 82/82 aliased (Phase C.1 Part 1; was 22/82) |
| Exact-label search | Verified non-regressed, 82/82 |
| Founder-vocabulary probes | 16/16 resolve to correct surface |

The discoverability gap identified in C.0 is closed. Regression-locked by [tests/security/90-phase-c1-search-alias-coverage.cjs](tests/security/90-phase-c1-search-alias-coverage.cjs).

---

## Unverified stages

Two chain stages were **not** tested in this phase:

- **REAL DATA RENDERS** — requires browser automation. No component was rendered.
- **MUTATION WORKS** — 1,150 product mutation endpoints untested for write safety.

Any claim that a surface is "fully working" is therefore premature. This matrix proves the chain is *connected*, not that it *delivers*.
