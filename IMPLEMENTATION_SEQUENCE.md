# Implementation Sequence, Migration Safety & Effort Estimate

Status: planning document. No code written.

Covers Phase 7 (safest order), Phase 8 (migration safety per milestone), and Phase 9 (effort estimate) of the roadmap. Reads alongside `MULTI_ORG_IMPLEMENTATION_ROADMAP.md`.

---

## Phase 7 — Implementation Order

### One fix that should not wait for milestone sequencing

The `attachOrg` membership-check gap (Gap Analysis §3: `req.org` is set from a client-supplied `orgId` before verifying the requester belongs to it) is a present-day cross-tenant metadata leak, not a multi-org-readiness gap. It should be triaged and fixed as an independent, small patch to `orgMiddleware.cjs` **before or in parallel with M1**, on its own timeline, not bundled into a larger milestone where it would wait for M1's much longer review/rollout cycle. This is the one deviation from strict milestone ordering this plan recommends.

### Recommended order and why

1. **M1 — Organization Foundation + Workspace Reconciliation.** Must go first: every other milestone assumes one coherent tenant identifier, and today there are three (Org, Workspace, Billing's bare `accountId`). This is explicitly the highest-risk milestone in the program — sequencing it first, alone, with nothing else in flight, is what makes the rest of the program safe. Do not parallelize anything else against M1.

2. **M2, M3, M4, M5 in parallel.** Once M1 lands, Workspace Isolation, Org Billing, Org Connectors, and Org AI Memory have no dependencies on each other — each reads the now-settled `orgId` from M1 and applies it within its own service boundary. This is the highest-leverage parallelization point in the whole roadmap: four independent teams/workstreams can proceed simultaneously without coordination overhead, provided none of them touch `organizationService.cjs` itself again (they shouldn't need to after M1).

   Within this group, if forced to sequence rather than parallelize (limited engineering capacity), order by blast radius, smallest first: **M3 (Billing) → M4 (Connectors) → M2 (Workspace Isolation) → M5 (AI Memory)**. Billing's blast radius is bounded to one file plus its callers; AI Memory touches five-plus services and is the most labor-intensive, so it benefits most from being done last within this group, once the team has practice with the org-scoping pattern from the smaller wins.

3. **M6 — Cross-Organization Grants.** Depends on M1 (needs a settled org identifier) but not on M2-M5 — could technically run in parallel with the M2-M5 group. Recommended to start once M1 is stable rather than waiting for all of M2-M5, since M7/M8/M9 all depend on M6 and gating it behind four unrelated milestones would idle the mode-specific work unnecessarily.

4. **M7 — Portfolio Dashboard (Founder Mode).** First mode-specific milestone, chosen deliberately for smallest UX surface exercising the largest amount of new machinery (multi-org + Grants) — the original blueprint's own sequencing recommendation, preserved here because it's still correct: it's the cheapest way to find bugs in M1-M6 before Enterprise or Agency mode raise the stakes.

5. **M9 — Agency Mode.** Recommended before M8 (Enterprise), despite the milestone numbering — Agency depends only on M4 and M6 (both likely done by this point), while Enterprise (M8) is the highest-risk remaining milestone in the program (policy inheritance, potential production topology changes) and benefits from having Founder mode (M7) and Agency mode (M9) already validated in production as evidence the multi-org foundation holds under real usage before the riskiest mode is attempted.

6. **M8 — Enterprise Administration.** Last of the mode-specific milestones, deliberately, for the reason above. If a specific Enterprise customer's contract timeline forces this earlier, it can move up — but the risk profile doesn't change, only the amount of production validation available beforehand.

7. **M10 — Marketplace Integration.** Last overall. Depends on M4 and M5 both being solid in production (not just code-complete) — Marketplace is the first place a residual isolation bug in either would become visible at scale (many orgs installing the same template simultaneously), so it's the right thing to gate behind real-world validation of the harder milestones rather than shipping concurrently with them.

### Summary order

```
[attachOrg leak fix — independent, immediate]
M1
├── M2, M3, M4, M5 (parallel; if serialized: M3 → M4 → M2 → M5)
└── M6 (start once M1 stable, parallel to M2–M5 group)
     └── M7 → M9 → M8
          └── M10 (after M4 + M5 proven in production)
```

---

## Phase 8 — Migration Safety

For every milestone: can existing users continue, can existing organizations continue, will APIs break, will frontend break, can rollback happen.

| Milestone | Existing users continue? | Existing orgs continue? | APIs break? | Frontend breaks? | Rollback possible? |
|---|---|---|---|---|---|
| **attachOrg fix** | Yes, unaffected | Yes | No — tightens a check, doesn't remove a capability anyone legitimately used | No | Yes, trivial (single middleware function) |
| **M1** | Yes, via shim-org auto-creation for orphaned Workspaces | Yes, existing Org rows are untouched, only gain new sibling capability | No — external contracts preserved; internal resolution changes | No, if shim-org creation runs before new middleware activates | Yes, via feature flag; shim orgs are inert if rolled back |
| **M2** | Yes | Yes | No — only cross-org access (which shouldn't have worked) is newly blocked | Possible edge case if any UI accidentally relied on cross-org Workspace visibility — flagged for staging verification, not assumed safe | Yes, query-filter removal is trivial |
| **M3** | Yes, synthetic org is invisible to single-account customers | Yes | No | No — `billingApi.js` contract unchanged, only new optional fields | Yes, shadow mode allows disabling before cutover; legacy path stays intact |
| **M4** | Yes, sentinel default preserves all current connector behavior | Yes | No — three-tier fallback means unscoped calls keep working | No | Yes, parameter additions revert cleanly (with the one-way-door caveat only after real org-claiming begins) |
| **M5** | Yes for existing data (sentinel backfill), but **new code must update every call site in lockstep** — this is the one milestone where an incomplete rollout would break something (an un-updated call site hitting a now-mandatory parameter) | Yes | Internal service signatures change (mandatory `orgId`), but this is intentionally not silently absorbed — see note below | No, if rolled out service-by-service with call sites fixed together | Yes, per-service revert; no data loss since nothing is deleted |
| **M6** | Yes, fully additive | Yes | No — new endpoints only | No | Yes, grant-consulting path can short-circuit to "no grants" |
| **M7** | Yes, fully additive | Yes | No — new aggregation endpoints only | No — new components only, existing nav unaffected | Yes, frontend flag |
| **M8** | Yes for non-Enterprise customers, fully unaffected | Yes | No, for existing customers; new Enterprise-specific endpoints only | No | Yes, for everything except rare Deployment-tier infra changes, which follow standard infra rollback |
| **M9** | Yes, fully additive | Yes | No | No | Yes, frontend flag |
| **M10** | Yes, fully additive | Yes | No | No | Yes, new feature, flag-gated |

**Note on M5's "APIs break" answer**: this is the one place in the roadmap where "no silent breakage" is actually the *goal*, not a risk to avoid — a memory-read call site that forgets to pass `orgId` after this milestone should fail loudly at that call site during development/staging, not silently return cross-tenant data in production. The mitigation is process (enumerate and fix every call site in the same change, per service) rather than a compatibility shim, because a compatibility shim here would defeat the purpose of the milestone.

---

## Phase 9 — Estimate

Estimates are relative sizing (S/M/L/XL) plus qualitative dependency and testing notes, not calendar dates — actual duration depends on team size and this document doesn't assume a specific one.

| Milestone | Engineering effort | Complexity | Key dependencies | Testing effort | Migration effort |
|---|---|---|---|---|---|
| attachOrg fix | S | Low | None | S — unit test the membership check, regression-test all routes using `attachOrg` | None |
| M1 | XL | Very high | None | XL — this milestone alone likely needs its own staged rollout (flag, canary org subset, then general availability) given the eight downstream route files at risk | M — shim-org backfill, reversible |
| M2 | M | Medium | M1 | M — focused on the eight known consumer route files, plus a repo-wide grep to catch a ninth | None beyond M1's |
| M3 | M | Medium | M1 | M — shadow-mode comparison run is itself a testing phase, not just a QA pass | M — synthetic org backfill for every existing billing record |
| M4 | L | Medium-high | M1 | L — 40 functions to update, but mechanically repetitive once the pattern is proven on the first few; highest care needed on payment/messaging connectors specifically | S — sentinel re-keying is close to a no-op |
| M5 | XL | High | M1 | XL — five-plus services, each needing every call site enumerated and fixed; this is the most labor-intensive milestone after M1 | L — sentinel backfill plus explicitly-scoped-out manual triage for pre-existing multi-org deployments |
| M6 | M | Medium | M1 | M — new construct, but well-isolated; testing focuses on grant expiry/revocation edge cases | None (new data) |
| M7 | M | Low-medium | M1, M6 | M — mostly UI plus aggregation-query correctness (verify N-query merge never leaks) | S — one-time founder→org index built from existing `companyFactory.cjs` run log |
| M8 | XL | Very high | M1, M6 | XL — policy inheritance testing needs to cover over-grant and under-grant failure modes across simulated multi-child-org trees; Deployment-tier isolation (if triggered) adds infrastructure testing on top | Varies — none for most customers, potentially significant for the rare Deployment-tier case |
| M9 | L | Medium | M1, M4, M6 | L — mechanically similar to M7 but isolation testing (client A must never see client B) carries higher stakes per test case | None (new data) |
| M10 | L | Medium-high | M1, M4, M5 | L — install-time credential re-mapping and memory-copy-not-reference semantics both need dedicated isolation tests, not just functional tests | None (new data, built against settled schema) |

### Reading the estimate

The two outsized efforts are **M1** (reconciling two independently-evolved tenancy systems across eight route files with zero tolerance for silently changing anyone's effective permissions) and **M5** (retrofitting mandatory tenant scoping onto five-plus memory services with zero tolerance for a fail-open call site). Every other milestone is comparatively mechanical once those two land, because they establish the two patterns (a settled org identifier, and a mandatory-not-optional scoping discipline) that the rest of the roadmap just applies repeatedly. A team planning capacity should expect M1 and M5 to dominate the schedule, and should resist the temptation to compress them to hit a date — per the Gap Analysis, both are exactly the places where a shortcut becomes a customer-facing cross-tenant data incident rather than a bug.
