# GRAPH / KNOWLEDGE API AUTHORIZATION & TENANT-ISOLATION AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-21 · **Branch:** `security/reality-completion`

---

## Scope

Closed the previously-deferred `backend/routes/graph.js` question with direct evidence — full audit
of every customer-reachable route, its direct service/caller chain (`knowledgeGraph.cjs`,
`graphReasoningEngine.cjs`), and every real frontend consumer.

## Inventory

21 routes total. Prior audit passes had already gated 15 of them `operatorOnly` (edges GET/POST/
DELETE, node, traverse, related, impact, lookup×3, export, reasoning/impact, reasoning/dependencies)
after finding they returned individual record content platform-wide with no orgId concept. 6 routes
remained on `requireAuth` only: `POST /graph/index`, `POST /graph/index/mission/:missionId`,
`GET /graph/reasoning`, `/reasoning/critical`, `/reasoning/recommendations`, `/reasoning/executive`.
`GET /graph/schema` and `GET /graph/stats` were correctly left ungated in every pass — genuinely
aggregate/constant data (counts, type lists), confirmed again this mission via live response
inspection.

## Genuine Vulnerabilities Found — 2, both proven live

**1. `POST /graph/index/mission/:missionId` — cross-tenant disclosure through a mutation route's own
response (P1).** `indexMission()` derives graph edges from a mission's real stored data (`orgId`,
linked opportunity/lead, owner) with no ownership check on the caller. Live-reproduced: an unrelated
customer (org B) indexed a real mission belonging to org A by ID, and the response body directly
returned org A's real `orgId` and its linked opportunity record — genuine disclosure, not merely a
resource-cost concern. `POST /graph/index` (full platform reindex, up to 2000 missions) shared the
same missing gate — any authenticated customer could trigger a full reindex on demand.

**2. Four reasoning routes — real cross-tenant business intelligence exposed via customer-facing
dashboards (P1).** `graphReasoningEngine.cjs`'s functions have no per-org concept anywhere in their
signatures; they compute over the whole platform graph and return real, individual `leadId`/
`missionId`/`rcaId`/`orgId` values — not aggregates. Live-reproduced: an unrelated customer's
`GET /graph/reasoning` returned other orgs' real `highRiskOrgs` entries (orgId + mission/failure
counts) and named critical-dependency records platform-wide; `/graph/reasoning/executive` and
`/graph/reasoning/recommendations` returned real mission objectives/titles and blocker details from
other tenants. This is the exact defect class already fixed for `/graph/node`, `/graph/traverse`, and
`/graph/impact` — but these 4 routes were left off that earlier pass specifically because they are
consumed by genuinely customer-facing dashboards (`ExecutiveDashboard.jsx`, `BusinessOS.jsx`,
`MissionControlV1.jsx`, `EngineeringIntelligencePane.jsx` — each a plain, ungated tenant-facing tab,
not an operator-only surface), which made the fix non-trivial: an ordinary customer's own "Executive
Dashboard" was showing platform-wide cross-tenant risk data as if it were their own.

## Fix

Both mutation routes and all 4 reasoning routes gated `_graphOperatorOnly` — the identical,
already-established mechanism this file uses for every other platform-wide route. No new
authorization framework; no architecture expansion. Retrofitting real per-org scoping into 9
platform-wide reasoning functions (`findCriticalDependencies`, `findHighRiskOrganizations`, etc.,
none of which accept an orgId parameter) would have been a genuine architecture expansion — explicitly
out of scope for this mission.

Confirmed via grep that neither indexing route has any real frontend caller (the two `BusinessOS.jsx`
references are help-text strings for someone using the API directly, not `fetch()` calls) — gating
them breaks nothing. For the 4 reasoning routes, verified all 4 real frontend consumers already check
`response.ok` before rendering and fall back to an honest "unavailable"/hidden empty state on a
non-2xx response — confirmed structurally and would degrade gracefully, not crash.

## Special Decision — flagged, not silently resolved

Whether the 4 now-empty dashboard sections (Executive Dash's "Graph Reasoning" panel, BusinessOS's
"Reasoning" tab, MissionControlV1's reasoning panel, EngineeringIntelligencePane's reasoning tab)
should be redesigned, removed, or given real per-org scoping for ordinary customers is a genuine
product decision this audit did not have the authority to make unilaterally — flagged as **DECISION
REQUIRED** for a future mission. The security fix (operatorOnly gate) is correct and necessary
regardless of that follow-up decision, since the alternative (leaving real cross-tenant data exposed)
is not acceptable either way.

## Test Infrastructure Note

While writing live regression tests for this fix, discovered and fixed a genuine bug in this test
file's own HTTP helper pattern (not a product defect): two `rawLogin()` helpers built a
`Content-Length` header from the login request body but never called `r.write(body)` — the server
correctly waited for bytes that would never arrive, causing an intermittent multi-minute hang under
concurrent load (reproduced 3 times before diagnosing). Fixed by writing the body before `end()`,
plus hardening all 3 raw HTTP helpers in this test block with `agent: false` (fresh connection per
call, avoiding potential stale keep-alive socket reuse) and `req.setTimeout()` (the documented-
reliable timeout mechanism, in addition to the options-object `timeout` value). Re-verified stable
across 5+ repeated runs after the fix.

## Live Verification

Full HTTP chain verified against the restarted production server with two freshly registered ordinary
customer accounts:
- **Indexing routes**: an unrelated customer's attempt to index org A's real mission by ID now
  correctly returns `403`, with no `orgId`/linked-record disclosure; the bulk `/graph/index` reindex
  trigger is also correctly rejected `403` for an ordinary customer.
- **Reasoning routes**: an unrelated customer's `GET /graph/reasoning` now correctly returns `403`
  (previously `200` with real cross-tenant `orgId`/`leadId`/`missionId` records); `GET /graph/stats`
  (genuinely aggregate) remains `200` for any authenticated customer — no regression on the correctly
  public aggregate view.

## Limitations

- No credential-blocked or environment-blocked findings this mission, beyond the standard registration
  rate-limit wait already documented in prior missions this session.
- The DECISION REQUIRED item above (whether/how to redesign the 4 dashboard sections for ordinary
  customers) is explicitly unresolved — this mission fixed the security defect, not the product gap
  it now surfaces (an empty "Reasoning" panel where a customer previously saw, incorrectly, platform-
  wide data).

## Regression

**Before:** 419/420 (420/420 effective). **After:** confirmed stable across 3 full-suite runs —
423-425/425 pass, with only pre-existing, session-documented, load-dependent flakes appearing
(`133-master-audit-stale-active-mission-recovery`, `147`'s "forgot-password identical response" test,
and transient `155` timeouts under peak concurrent load), each re-confirmed passing cleanly in
isolation, never the same test twice across runs, and never related to `graph.js`. **New tests:** 5
(block 163) — 3 structural + 2 live, covering all 6 route fixes, the aggregate-route non-regression
check, and the frontend-consumer graceful-degradation check. **Negative-tested**: reverted 2
representative routes (`POST /graph/index/mission/:missionId`, `GET /graph/reasoning`), confirmed the
targeted structural test and both live tests failed for the exact expected reasons while the 2
independent tests (aggregate routes, frontend `.ok` checks) correctly still passed, restored,
confirmed all 5 passed again — reproduced cleanly across multiple runs once the test-infrastructure
bug above was fixed.

**Build:** PASS (`npm run build:frontend`, clean production build).
**Security suite:** `tests/security/97-enterprise-isolation-integrity.cjs` — 8/8 PASS (after waiting
out this environment's shared registration rate-limit window).
**Server:** restarted three times total (initial fix, negative-test revert, final restore — required
since `graph.js` is a `require()`-cached Express route module), confirmed healthy after each restart.
**`.env`:** untouched. **No merge. No push.** Unrelated uncommitted work in the working tree preserved
throughout.

**No OS-track record altered.**
