# C.10 — CROSS-SYSTEM SECURITY

Date: 2026-08-14/15 · Branch: `security/reality-completion`

---

## Scope

Cross-system security only: cross-tenant leakage, IDOR, privilege escalation, unscoped middleware, global aggregates presented as tenant data, platform data exposed through OS routes, AI/memory/generated-file/history/search/automation/executive leakage. Real evidence only — failed requests are not counted as security findings unless they demonstrate an actual authorization gap.

## Two real, live-confirmed P0s found and fixed this session

### 1. `/dev/*` — completely unauthenticated (36 routes)

```
curl -X POST http://localhost:5050/dev/repos -d '{"name":"..."}'   (zero credentials)
  -> HTTP 201, real repo created
curl http://localhost:5050/dev/repos                                (zero credentials)
  -> HTTP 200, full global repo/project/issue/build/deployment store readable
```
Every one of `/dev/repos`, `/dev/projects`, `/dev/issues`, `/dev/builds`, `/dev/deployments`, and their sub-routes (including `DELETE /dev/issues/:id` and `POST /dev/deployments/:id/rollback`) had zero auth gate. **Severity: the most severe class possible** — not cross-tenant, but cross-*everyone*, reachable by anyone with network access to the server regardless of whether they have an account at all.

**Fixed**: `router.use("/dev", requireAuth)` added, live-verified to correctly 401 unauthenticated requests while preserving legitimate authenticated access.

**Not fixed, documented for Master Recovery**: `developerOS.cjs` has zero `orgId` concept anywhere in its ~986 lines. Every authenticated user — regardless of organization — still sees every other tenant's repos, projects, issues, builds, and deployments. Live-confirmed: after the auth fix, Org B's authenticated session still saw Org A's test repo. Closing this requires adding org scoping to the service layer, which is new architecture and out of C.10's fix mandate.

### 2. `/cbeta/billing/*` — cross-account financial IDOR, read AND write

```
curl -b <OrgB-session> http://localhost:5050/cbeta/billing/credits/<OrgA-real-account-id>
  -> HTTP 200, Org A's real billing-credit record returned to Org B

curl -b <OrgB-session> -X POST http://localhost:5050/cbeta/billing/credits \
  -d '{"accountId":"<OrgA-real-account-id>","amountINR":99999,"reason":"forged"}'
  -> HTTP 200, ₹99,999 forged credit persisted onto Org A's real record — confirmed by a
     follow-up read as Org A showing the exact forged entry
```
**Severity: write-side financial-record corruption**, not merely a read-side leak — a more severe defect than most IDOR findings, since the impact is a persisted falsified state, not just disclosure. Reachable by any authenticated account (any signed-up user, regardless of org), against any other account, by supplying its ID.

This is the exact same bug class a prior "Security Hardening (Zero-Trust Competitor Remediation, Phase 4)" pass already fixed in the same file for `GET /cbeta/orgs/:orgId/deletion-check` — that fix did not extend to the billing sub-routes.

**Fixed**: `operatorOnly` gate added to the accountId-accepting billing routes (`downgrade`, `payment-failure`, `retry-queue`, `process-retries`, `invoices`, `credits`, `coupons/apply`), matching the same access-tier pattern already used for platform financial data in `revenueOS.js`. Live-verified: both read and write now correctly 403 for a non-operator account.

## Prior fixes re-verified as genuinely holding

| Fix | Original class | Live re-verification result |
|---|---|---|
| Support ticket read isolation (`customerOrg.js`, B.21) | Cross-tenant IDOR | **HOLDS** — direct-ID read from an unrelated org returns 404 |
| Support ticket resolve isolation | Same class, comment claimed unfixed | **HOLDS** — live test proves the code has the same guard; the comment was stale, describing a state that had already been remediated |
| `attachOrg` path-param precedence (Phase B.7) | Confused-deputy IDOR | **HOLDS** — live test: forged `X-Org-Id` header on Org B's own context request returned Org B's own data |
| `/orgs/:orgId/departments` permission gates | Standard RBAC | **HOLDS** — direct-ID read and write both correctly 403 for a non-member |
| Negative-limit-cap bypass (Phase B.15/B.7 class) | Query-param abuse | **HOLDS** — `?limit=-1` and `?limit=99999` both correctly clamp to real, org-scoped data only |
| C.9 cross-router middleware-scoping fix | Accidental unscoped `router.use(fn)` | **HOLDS** — no regression found in this session's testing of `/security`, `/admin`, `/governance`, `/automation` |

## Findings that are real gaps but explicitly NOT fixed (deferred to Master Recovery)

These were verified live or by direct code inspection to be genuine, but fall outside C.10's minimal-fix mandate (each would require new architecture — org-scoping additions to a service layer that has none):

- **Developer OS (`developerOS.cjs`)**: zero `orgId` concept — cross-tenant visibility remains among authenticated users (auth gate fixed; tenant scoping not).
- **Memory OS**: zero `orgId` concept across all 3 parallel memory backends (`/memory/*`, `/memory-index/*`, `/p18/memory/*`) — unchanged from C.9's finding, now confirmed to span 3 systems, not 1.
- **Business OS**: `businessDataService.cjs`'s own code comments document that `orgId` scoping is opt-in per call site, with legacy records that predate multi-tenancy having no `orgId` at all. Every call site actually tested in this session correctly passed `orgId` — the risk is latent (a future call site that omits it), not actively exploited in the routes exercised.
- **Enterprise OS**: three non-integrated backends exist behind one UI tab; the one actually wired (`enterpriseOS.cjs`, inlined in `ops.js`) maintains its own independent membership model separate from `organizationService.cjs` (A/K's real org-membership system) — a real risk of the two drifting apart, not yet observed to have actually diverged, and not something C.10 attempted to reconcile.
- **Integration OS**: the core connector store (`integrationConnectors.cjs`) has no `orgId` field, while the customer-facing variant (`myConnectors.js`) is genuinely org-scoped — two parallel systems with different tenancy models.

## No credential-bypass evidence found

No attempt was made to bypass authentication mechanisms themselves (JWT forgery, session fixation, etc.) — all testing used real, legitimately-issued sessions for two real accounts. The two P0s found are authorization-scope failures (missing or insufficient gates on otherwise-legitimate authenticated flows), not credential-bypass exploits.

## Constraint compliance

| Constraint | Status |
|---|---|
| `.env` not modified | **HELD** — 0 changes, verified repeatedly including after both fixes |
| No real credentials added | **HELD** |
| No real paid transactions | **HELD** — the ₹99,999 "credit" was a forged internal ledger entry in a disposable test account's record, not a real payment/transaction |
| No OS started or modified beyond minimal, precedented, live-verified fixes | **HELD** — both fixes are single-middleware-line additions matching an already-established pattern elsewhere in the same codebase |
| No architecture changes | **HELD** — neither fix touches a service layer or data model; both are route-level authorization gates |
| Negative-tested | **HELD** — both fixes have dedicated tests in `tests/runtime/10-c10-cross-system-closure.test.cjs`; both independently self-verified to catch a reintroduced regression |

## Conclusion

**2 live, real, P0-severity cross-system security defects found and fixed this session** — both were reachable by any authenticated user (one by literally anyone, authenticated or not), both live-verified before and after. **5 genuine tenant-isolation gaps found and explicitly documented as deferred** (Developer OS, Memory OS ×3 systems, Business OS's opt-in design, Enterprise OS's dual-membership-model risk, Integration OS's split scoping model) — none of these were silently worked around or hidden; all require new architecture that is out of C.10's minimal-fix mandate and belongs to the upcoming Master Recovery phase. **6 prior fixes were re-verified live and confirmed to genuinely hold**, including one case where a stale in-code comment claimed an open gap that live testing proved was already closed.
