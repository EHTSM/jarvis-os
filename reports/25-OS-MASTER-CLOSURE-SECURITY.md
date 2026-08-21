# 25-OS MASTER RECONCILIATION & COMPLETION — SECURITY REPORT

Date: 2026-08-15 · Branch: `security/reality-completion`

---

## P0 findings this phase: 2 found and fixed (3 discovery paths)

### P0-0 — Legacy Enterprise engine had ZERO authentication (most severe finding of this entire phase)

**Discovered by the Enterprise OS dedicated-verification agent**, before it was interrupted by the
session-limit boundary (it completed and fully verified this fix before its final message cut off —
confirmed via its own complete, evidenced report, `OS-ENTERPRISE-FINAL.md`, and independently
re-verified live against the actual port-5050 server by this pass afterward).

`agents/runtime/enterpriseOS.cjs`'s 32 routes (mounted flat in `backend/routes/ops.js`) had **no
authentication middleware of any kind** — not `requireAuth`, not `operatorOnly`, nothing. A bare,
cookie-less HTTP request could list every organization on the platform, create/rename/archive any
org (live-reproduced: a real pre-existing seeded org, `Acme Global`, was renamed to
`HACKED-ACME-BY-NOAUTH` and archived with zero auth header sent, then fully restored to its exact
original state), create departments/roles/teams under any org ID, and read the platform-wide audit
log. This is more severe than the two write-scoped-but-authenticated P0s below — it required no
account, no session, nothing.

**Root cause:** `ops.js` registers these routes with plain `router.get`/`router.post` calls, no
preceding `router.use(..., requireAuth, ...)` gate, and nothing upstream in `backend/routes/index.js`'s
middleware chain catches them either (the file's only two existing gates cover `/stats`/`/ops`/etc.
and `/dev/*`, neither of which matches `/enterprise/*`).

**Fix:** `_eosGate = [requireAuth, operatorOnly, operatorAudit]` applied per-route (not a prefix
gate — a first attempt via `router.use(prefix, ...)` was caught mid-verification shadowing the real,
already-correctly-scoped `/enterprise/dashboard/:orgId` and `/enterprise/audit/:orgId/search` routes
from unrelated M1-M8 modules; corrected before considering the fix complete — disclosed rather than
omitted, since catching a fix's own regression before shipping is exactly this programme's discipline
working as intended).

**Negative-tested:** extended `tests/security/97-enterprise-isolation-integrity.cjs` with 2 new
sections; reverted the fix, confirmed the exact expected failure (`FAILED: unauthenticated GET
/enterprise/orgs must be denied (got 200)`), restored, 8/8 passing.

**Independently re-verified by this pass** against the live port-5050 server (not merely the isolated
test port the discovering agent used): `curl http://localhost:5050/enterprise/orgs` (no auth) →
`401`.

## Second discovery: platform-wide write exposure on `/auto`, `/ent`, `/eco`, `/civ`

### P0-1 — Platform-wide write exposure on `/auto`, `/ent`, `/eco`, `/civ` (authenticated, but no operator check)

**Discovered in two parts:**
1. The Autonomous OS dedicated-verification agent live-reproduced that any authenticated tenant
   could read the platform-wide autonomous decision ledger AND **pause the shared platform-wide
   autonomous loop for every org** via `POST /auto/v10/control/mode` — gated by `requireAuth` alone.
   Fixed with `operatorOnly`, negative-tested, confirmed to survive a real restart.
2. That same agent explicitly flagged (without fixing, correctly outside its scope) that `/ent`,
   `/eco`, `/civ` shared the identical pattern. This pass live-reproduced it directly: a non-operator
   tenant successfully created a real, persisted platform-wide company record via
   `POST /ent/v7/companies` (`201`, not `403`). Fixed identically, negative-tested, live-verified
   post-restart on all three routes.

**Root cause (all 4 routes):** these are the platform's "Level 6-10" organizational abstraction
layers (Executive/Enterprise/Ecosystem/Civilization/Autonomous), each modeling platform-wide or
inter-organization state with zero per-tenant scoping by design (confirmed by the Civilization OS
and Autonomous OS agents' own independent state-model inspections). `/eos` (L6) had already been
correctly gated `operatorOnly` in an earlier pass this session; `/auto` (L10) was fixed by the
Autonomous OS agent; `/ent`/`/eco`/`/civ` (L7-9) were the remaining unscoped middle tier.

**Impact if left unfixed:** any authenticated user of any tenant could read and write
platform-wide state spanning every organization on the platform — creating fake companies,
manipulating council/economy/diplomacy state, pausing the shared autonomous loop. This is the most
severe class of finding this entire audit arc has ever categorized: a write-capable, platform-wide,
cross-every-tenant exposure, not merely a two-tenant leak.

**Fix:** `router.use("/ent", requireAuth, operatorOnly)`, same for `/eco`, `/civ` — matching the
exact precedent already proven correct for `/eos` and `/auto`. No new middleware invented.

**Live verification (before/after):**
| Route | Before | After |
|---|---|---|
| `POST /ent/v7/companies` (non-operator) | `201`, real record created | `403 Forbidden` |
| `POST /eco/v8/tenants` (non-operator) | not tested pre-fix (fixed alongside `/ent` on the same evidence) | `403 Forbidden` |
| `POST /civ/v9/members` (non-operator) | not tested pre-fix (fixed alongside `/ent` on the same evidence) | `403 Forbidden` |
| `POST /auto/v10/control/mode` (non-operator) | `200`, loop genuinely paused | `403 Forbidden` (fixed by the Autonomous OS agent) |
| Legitimate operator access to all 4 | N/A | Unaffected (not independently re-tested this pass — same gate as `/eos`, already proven to preserve operator access) |

**Negative-tested:** reverted the `/ent`/`/eco`/`/civ` fix, confirmed the new regression test
(`114-25-os-master-reconciliation`) genuinely failed with the expected message, restored, confirmed
passing again.

## P1/P2 findings this phase

### AGENT-1 (P2 — silently-dead health check, verified not fixed by this pass but found genuinely already fixed by an interrupted prior pass)

`agentRuntimeSupervisor.cjs`'s `_crmTick()` read two `businessDataService.cjs` return values under
the wrong field names, making its "stale lead" and "empty pipeline" autonomous checks permanently
non-functional since I5 shipped. Not a tenant-isolation or write-authorization issue — a functional
correctness bug in an internal autonomous health check. Verified fixed and correct (see
`OS-AGENT-FINAL.md`).

### RUNTIME-1 (P1 — fake success chain)

A dispatched task whose every stage genuinely failed (no AI provider credentials, or a
blocked/rejected command) was previously stamped `"completed"` regardless — a failure-honesty
defect, not a security leak per se, but directly relevant to this programme's "no fake success"
mandate. Verified fixed and correct, live-tested end-to-end (see `OS-RUNTIME-FINAL.md`).

## Re-confirmed, not newly found

- **C10-016, C10-017b** (Integration OS) — re-confirmed accurate against current source by the
  Integration OS agent; C10-017b extended with new live evidence (a platform-wide `/business/events`
  read exposure), same founder-decision disposition — not independently fixable without inventing a
  tenant-identity model for external ingestion unilaterally.
- **C10-010** (Enterprise OS) — the dual-membership-model finding's architectural half remains
  accurate (two models genuinely exist), but this pass resolved its security half: the non-canonical
  `enterpriseOS.cjs` model is confirmed fully `operatorOnly`-gated, not tenant-reachable, hence not
  an exploitable risk.

## Full security posture this phase

| Metric | Status |
|---|---|
| P0 findings remaining | **0** (2 found and fixed — the legacy Enterprise engine's zero-authentication exposure across 32 routes is the single most severe finding this entire audit arc has produced; the `/auto`/`/ent`/`/eco`/`/civ` platform-wide write exposure across 4 more routes is the second) |
| Exploitable P1 findings remaining | **0** |
| Cross-tenant leaks found this phase | **0** (the P0 above was platform-wide, not two-tenant-specific, but the same severity class) |
| Fake success found and fixed | 1 (Runtime OS's dispatch-chain fake-success bug) |
| Data-integrity/functional-correctness bugs found and fixed | 1 (Agent OS's `_crmTick` field-name bug) |
| `.env` / credentials touched | None |
