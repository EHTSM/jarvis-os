# MASTER RESIDUAL CLOSURE — SECURITY REPORT

Date: 2026-08-15 · Branch: `security/reality-completion`

---

## Scope

Security-relevant findings closed or newly discovered during this phase. Per the mission's explicit end-of-phase security requirement: **P0 findings = 0. P1 tenant/auth/data-integrity findings = 0**, unless genuinely blocked by credential/external-provider/major-product-decision, named explicitly below if any remain.

## Findings closed this phase

### C10-017 — `unifiedIntelligenceLayer.cjs` cross-tenant business-data leak (newly reproduced, P0/P1 escalated)

Not in the original 41-item C.10 inventory as a live exploit — the original C10-017 finding described only a *latent* risk in `businessDataService.cjs`'s opt-in scoping design. This phase's full call-site audit found the actual live leak sat one layer removed, in a consumer of that service.

**Vulnerability class 1 — missing tenant filter.**
`GET /intelligence/unified/executive` (and `correlate`, `events`, `recommendations`, `score`) called `unifiedIntelligenceLayer.cjs`'s `_readBizState()` with no `orgId`, which called `businessDataService.cjs`'s `listLeads/listOpportunities/listCampaigns/listContacts` unscoped — returning the platform's aggregate real business data (not the caller's own) to any authenticated user.

**Live reproduction (before fix):**
- Org B (real account, zero business data of its own) → `GET /intelligence/unified/executive` → received Org A's real `activeLeads: 31`, `revenueThisMonth`, `pipelineValue` in the response.

**Fix — two passes required:**
1. Threaded `orgId` through `_readBizState`, `correlate`, `scoreImpact`, `getExecutiveDashboard`, `detectCrossDomainEvents`, `getUnifiedRecommendations`; mounted `attachOrg` on `/intelligence/unified/*`; all 5 routes updated to pass `req.org?.id`.
2. **Re-tested live — leak persisted.** `bizKPIs` reads from `state.health`, populated by a *separate* `_bie()?.getHealthMetrics?.()` call that pass 1 missed. Fixed: `getHealthMetrics({ orgId: orgId || undefined })`.

**Live verification (after fix):** Org B → same endpoint → now receives its own (different, correct, smaller) data. Org A re-confirmed still receives its own correct data. Tested with REAL two-tenant data throughout — never empty-vs-empty.

### Vulnerability class 2 — forged-header membership bypass (found while re-verifying class 1's own gate)

While confirming the `attachOrg` mount was sufficient, live-tested Org B sending a **forged `X-Org-Id` header** naming Org A's real orgId. Result: 200, Org A's real data returned to Org B.

**Root cause:** `attachOrg` is deliberately non-blocking (its own source documents this) — it resolves `req.org` from a client-supplied header/query/body when no `:orgId` path param exists, but performs no membership check. That check lives in a separate middleware, `requireOrgMember`, which had not been composed into this route chain.

**Fix:** `router.use("/intelligence/unified", attachOrg, requireOrgMember);`

**Live verification (after fix):** Org B forging `X-Org-Id: <Org A's id>` → correctly 403 ("Not a member of this organization"). Legitimate same-org access re-confirmed working for both tenants on all 5 routes.

**Self-verified negative test:** Temporarily reverted the `requireOrgMember` addition (backup + restore via `/tmp/intel.bak`), ran the new regression test, confirmed it failed with the expected assertion message, restored the fix, confirmed `node -c` syntax check passed and `requireOrgMember` was present again.

## Findings surfaced but NOT fixed this phase (named explicitly, per the mission's requirement)

### C10-017b — `businessEventAdapter.cjs` external-ingestion has no `orgId` concept

`getEventLog({source, entityType, status, limit, offset})` has no `orgId` parameter in its signature at all. This is architecturally distinct from C10-017: every other leak this phase had a real `orgId` available at the call site that simply wasn't threaded through. Here, external events (webhook/email/form submissions) arrive with **no tenant context established at ingestion time** — there is nothing to thread without first deciding how inbound external events establish tenant identity (per-org webhook URL? API key → org mapping? something else?).

**Why not fixed:** Building tenant-identity resolution for external ingestion unilaterally, without a product decision on the mechanism, risks inventing a second, inconsistent tenant-identity model alongside the real one (`organizationService.cjs`/`attachOrg`/`requireOrgMember`) — directly against the mission's "never introduce a third model" instruction (stated for Enterprise/Organization, applied here by the same logic).

**Disposition:** VERIFY — requires a product/architecture decision before this can be safely fixed. Not a currently-exploitable read/write leak in the sense of C10-017 (no evidence external events currently carry or expose cross-tenant data through this path in a way a caller could exploit) but a genuine architectural gap that should be resolved before external integrations (the next programme) begins.

## Security items carried forward, unchanged (re-confirmed, not re-investigated)

- C10-001, C10-002 — ALREADY FIXED (P0, closed in C.10, unaffected by this phase's changes).
- C10-003, C10-004, C9-PATCH, C10-027, C10-029 — FIXED in Master Recovery, unaffected by this phase's changes, not re-tested from scratch (no code touched this phase overlaps these).
- C10-004b (13 engineering-memory engines, zero orgId) — re-confirmed via grep still 0 matches; classified PLATFORM-GLOBAL by design (holds engineering-process intelligence, not tenant business/customer data) — not a live leak, VERIFY for full canonicality decision.
- C10-010 (Enterprise OS dual membership models) — re-confirmed unchanged; `organizationService.cjs` is CANONICAL, `enterpriseOS.cjs` LEGACY, not consolidated this phase (migration-plan-required, not a code-only fix).

## Final security posture this phase

| Metric | Status |
|---|---|
| P0 findings remaining | **0** |
| P1 tenant/auth/data-integrity findings remaining | **0 exploitable** — C10-017b is a genuine gap but not a currently-exploitable leak; named explicitly above per the mission's requirement, not hidden |
| Cross-tenant leaks reproduced this phase | 2 vulnerability classes (missing filter, forged-header bypass) — both fixed and live-verified with real two-tenant data |
| Fake success introduced | None — all fixes either return real data correctly scoped, or correctly 403/404 when scope is violated |
| `.env` / credentials touched | None — confirmed via `git status --porcelain .env` (clean) |
