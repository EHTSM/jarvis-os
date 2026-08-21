# MASTER RECOVERY — SECURITY

Date: 2026-08-15 · Branch: `security/reality-completion`

---

## Security-relevant fixes this session (5)

### 1. Developer OS cross-tenant data exposure (C10-003)

**Before:** Any two authenticated users of different organizations saw each other's complete engineering data (repos, projects, issues, builds, deployments) — real company/project names, real remote URLs.
**After:** Full org-scoping added at the service layer (`orgId` required on every data-access function) and route layer (`attachOrg` + explicit 403 for unresolvable org). Live-verified: direct-ID access, search, list, stats, and dashboard all correctly isolated between two real tenants.

### 2. AI mission-context cross-tenant leak (C10-004 / originally a C.9 finding)

**Before:** `codingAssistant.js`'s `_missionContext()` injected the platform's 5 most-recent missions — regardless of owner — into any authenticated caller's AI prompt. C.9 proved live that Org A's mission objective text (including a marker described as "confidential OrgA rollout plan") appeared in the context available to Org B.
**After:** `missionMemory.cjs` gained an optional `orgId` filter (deliberately optional, not required, to avoid breaking 74 legitimate platform-internal consumers that treat missions as shared infrastructure); `_missionContext()` now passes the real caller `orgId`. Live-verified: Org B's scoped query returns empty for Org A's marker mission; Org A's own query returns it; the unscoped legacy path used by the 74 internal consumers is completely unchanged.

### 3. Coding patch-history / bundle storage cross-tenant IDOR, including a write-side file-reversion vector (C9-PATCH, named in the mission brief)

**Before:** `GET /coding/patch-history` returned byte-identical global data to any two tenants, including full file diffs. **More severely**, `POST /coding/undo-patch` could revert ANY tenant's applied patch by direct ID — a real write to files on disk, not just a data leak — or even the platform's globally most-recent non-undone patch with no ID supplied at all.
**After:** `orgId` recorded on every new patch; list/export both filter/404 on mismatch; undo's BOTH branches (direct-ID and no-ID-fallback) now check ownership. Live-verified with a real applied patch and a real file: Org B's direct-ID undo attempt correctly 404'd and left the actual file on disk untouched (independently confirmed by reading the file's contents); Org A's own undo of the same patch genuinely reverted it.

### 4. JWT logout — no server-side revocation (C10-027)

**Before:** Logout only cleared the client cookie. A token captured before logout (e.g. via XSS, a shared/compromised device, or a proxy log) remained fully valid and accepted by the server until its natural 8-hour expiry, regardless of the user explicitly signing out.
**After:** Every signed token now carries a `jti`; a revocation ledger (self-pruning, atomic-write, no new session-store architecture) is checked in `verifyJWT`. Both logout and refresh now revoke the token they're superseding. **Live-verified with the most rigorous possible test**: captured a real, valid, unexpired token before logout, then replayed that exact token directly (bypassing the cleared cookie) — correctly rejected with 401 despite being cryptographically valid.

### 5. `/cbeta/billing/*` cross-account financial IDOR (C10-002, closed in C.10, re-confirmed holding this session)

Already fixed and documented in C.10's own Security report; re-confirmed still correctly blocking cross-account billing access during this session's testing (no regression).

## Security-relevant findings identified but NOT fixed this session — explicitly escalated

- **13 of 14 engineering-memory source engines** (rule registry, RCA engine, pipeline coordinator, decision engine, smell detector, etc.) have zero org scoping. Not fixed because most legitimately hold platform-wide engineering-process intelligence, not tenant business data — no live cross-tenant leak of actual customer/business data was reproduced from these engines this session (unlike missionMemory and patch-history, where real leaks were reproduced). Escalated for a per-engine product decision, not blanket-scoped.
- **`businessDataService.cjs`'s opt-in-only `orgId` design** (C10-017) — every call site actually exercised this session correctly passed `orgId`, so no live exploit was reproduced, but the service's own code comments confirm the risk is real and latent. Recommended for the next recovery pass: make `orgId` required at the service boundary, following the exact C10-003 pattern, once every `business.js` call site is audited.
- **Sentry never wired to capture** (C10-028) — not a data-exposure risk, but an operational-security gap (no crash visibility). Code-level wiring is safe to do without the DSN credential; not completed this session due to time, escalated to the next pass.

## No credential bypass, no new auth architecture

Every fix in this session works within the existing authentication/authorization model:
- Org-scoping fixes (C10-003, C10-004, C9-PATCH) reuse the existing `attachOrg` middleware and `orgId`-based filtering pattern already proven in `growthOS.cjs`/`business.js`.
- JWT revocation reuses the existing stateless-JWT signing/verification functions, adding one field (`jti`) and one small file-backed ledger — no session store, no external dependency, no change to how tokens are issued or the cookie mechanism works.
- No credentials were added, `.env` was not modified (verified repeatedly throughout, including after every fix).

## Regression

`npm run test:runtime`: **192/192**, 0 fail, 0 skipped. Every fix has a dedicated negative test in `tests/runtime/10-c10-cross-system-closure.test.cjs` and `tests/runtime/09-c9-ai-experience-honesty.test.cjs`. The C10-003 and C10-002 fixes were independently self-verified this session (temporarily reverted, confirmed the regression suite catches the reintroduction, restored).
