# OS-PLATFORM — SECURITY

**Track:** OOPLIX 25-OS Master Reconciliation — OS #25, Platform OS
**Date:** 2026-08-15 · **Branch:** `security/reality-completion` · **Verification port:** 5306
**Test accounts:** `platA_1786794118@test.local` / `platB_1786794118@test.local`, created live via `/accounts/register` + `/auth/login` (no mocking), each with a real `organizationService.cjs` org auto-created at registration.

---

## Mission item 3 — Authorization: who can call `/platform/v1/*`?

**Finding: NOT an open P0.** The mission brief flagged this as the highest-priority thing to check ("a bug here would be severe"). It was a real, severe bug — **and it was already found and fixed prior to this pass**, in commit `8dd77f6c` (2026-08-05), independently of this mission. This pass's job was to confirm that fix is real, complete, and still holds — not to assume the brief's premise (an open gap) was current.

### What was fixed (per the fix commit's own message, re-verified live this pass, not taken on faith)

Before the fix: every route in `platformOrg.js` resolved a platform-org by client-supplied `:orgId` (or body/query `orgId`) with **zero ownership check**, gated only by the barrel-level `router.use("/platform", requireAuth)` in `routes/index.js:111` — which authenticates the caller but never authorizes them against the specific resource. Any authenticated user could read, export, view the digital twin of, clone, or retire (a destructive mutation) any other account's private platform-org, purely by guessing/incrementing an ID. `ownerId`/`tenantId` on creation paths were also accepted verbatim from the request body — ownership itself was spoofable.

After the fix: a `_requireOrgOwner(resolveOrgId)` middleware resolves the org by ID and rejects with **404** (not 403 — avoids confirming existence to a non-owner, matching the IDOR-hardening convention already used by `requireOrgMember` elsewhere in the codebase) unless the requester is the recorded `ownerId` or a global `enterprise_admin` (via `organizationService.isEnterpriseAdmin` — reusing the existing admin-escape hatch, not a new privilege tier). Applied to every route that resolves one specific org: read, health, policy, lifecycle mutation, clone/fork (both the source-org check AND the resulting org's ownership), versions/rollback, upgrade, migrate, export, twin, certify. `ownerId` is now always derived server-side from `req.user.sub` on every create/import/clone/deploy path — never trusted from the request body. List endpoints (`/orgs`, `/deployments`, `/certifications`, `/clones`, `/packages`) scope to the caller's own orgs unless the caller is an `enterprise_admin`.

### Live re-verification this pass (real HTTP, two real accounts, port 5306)

| Attack | Route | Result |
|---|---|---|
| Read another tenant's org directly by ID | `GET /platform/v1/orgs/:id` | **404** `{"ok":false,"error":"Org not found"}` |
| Export another tenant's org (full data package) | `GET /platform/v1/export/:orgId` | **404** — no data returned |
| Clone another tenant's org (exfiltrate as new org under attacker's ownership) | `POST /platform/v1/clone` | **404** — no clone created |
| View another tenant's digital twin | `GET /platform/v1/twin/:orgId` | **404** |
| Retire another tenant's org (destructive mutation) | `PATCH /platform/v1/lifecycle/:orgId` `{"status":"retired"}` | **404** — status confirmed unchanged on re-read |
| Enumerate other accounts' orgs via own list | `GET /platform/v1/orgs` (as attacker) | Victim's org **not present** in the list |

All 6 live attack vectors blocked. Additionally ran the existing dedicated regression, `tests/security/23-platform-org-idor.cjs` (15 assertions, mounts the real router with real signed JWTs, no mocking): **15/15 pass**, covering the same vectors plus rollback-blocking and "no side effect occurred despite the attempt" (victim's org status genuinely unchanged, not just an error response with a silent mutation underneath).

### Composition with the canonical auth authority

The admin-escape check (`isEnterpriseAdmin`) is not reimplemented locally — `_requireOrgOwner` calls `_orgSvc().isEnterpriseAdmin(accountId)` directly into `organizationService.cjs`, the same authority `requireOrgMember` uses platform-wide. No parallel admin-role concept exists in `platformState.cjs`.

**Verdict: authorization is correctly enforced. Platform-level meta-operations on organizations require either resource ownership (the authenticated caller's own `req.user.sub` matching the recorded `ownerId`) or `enterprise_admin` — not mere authentication. No P0 open. Confirmed by live test, not just source read.**

---

## Mission item 4 — Tenant boundary / exfiltration via clone or export

Directly covered by the attack table above: both `clone` and `export` — the two capabilities explicitly named in the mission brief as exfiltration-risk — are correctly gated by `_requireOrgOwner` on the **source** side (`sourceOrgId` for clone, `:orgId` for export), and the **destination** side of clone (`ownerId` on the newly created clone) is always forced server-side to the caller's real account id, never taken from the request body. An attacker cannot use clone to (a) read a victim's org data by cloning it, or (b) plant a clone that claims to belong to the victim. Both ends verified live.

---

## Mission item 5 — Failure honesty

| Scenario | Result |
|---|---|
| Deploy with a non-existent `blueprintId` | `{"ok":false,"error":"Org not found or could not be created"}` — honest failure, no fake `deployment` object |
| Clone with a non-existent `sourceOrgId` | `{"ok":false,"error":"Org not found"}` |
| Import a malformed package (missing required `org` field) | `{"ok":false,"error":"Invalid package: missing org field"}` |

No fabricated-success response observed on any invalid-input path tested. Consistent with the codebase-wide `{ok:false, error}` envelope convention.

---

## Mission item 6 — Composition / duplicate-architecture check (the C10-010-class question)

**Result: Platform OS does NOT have C10-010's disease.**

C10-010 (Enterprise OS) found 3 non-integrated backends with independent membership models. `platformOrg.js`/`platformState.cjs` was checked for the same pattern:

- Zero password/JWT/session primitives found in `platformState.cjs` (`grep -n "password|bcrypt|jwt|login" backend/services/platformState.cjs` = 0 matches).
- The only "membership" concepts present (`registerTenant` into `ecosystemState.cjs`, `registerMember` into `civilizationState.cjs`) are the platform-org's own registration into **sibling Level-8/Level-9 systems** — already independently audited under Ecosystem OS and Civilization OS — not a competing model for the same tenant identity `organizationService.cjs` owns.
- Real account registration (`POST /accounts/register`) was observed live this pass to independently create a genuine `organizationService.cjs` org for every new account — confirmed by the registration response containing a real `org: {orgId, workspaceId}` field, using the canonical org-creation path, not a `platformOrg.js`-local substitute.
- The one place `platformOrg.js` **does** touch `organizationService.cjs` directly is the admin check (`isEnterpriseAdmin`) — correctly reused, not reimplemented.

Platform OS's "org" concept (a deployable blueprint-instantiated org-as-a-product) is additive, not a parallel tenant-identity system. **No duplicate-architecture finding here.**

---

## Mission item 7 — C10-011 re-confirmation

`grep -rln "platform/v1|platformOrg|/platform/status|/platform/summary" frontend/src/` → **0 matches.** `frontend/src/components/OrgLevelStatus.jsx`'s `LEVELS` map (lines 13–20) covers `ako/eos/ent/eco/civ/auto` but has no `plt` entry, despite `/platform/status` and `/platform/summary` sharing the exact same generic envelope shape the component already renders for the other six. **C10-011 is still accurate. Not re-litigated as a new finding — same disposition (DEFERRED, no security/tenant dimension) carried forward.**

---

## New findings surfaced this pass (both non-security, both documented, neither fixed — out of mandate)

1. **`exportOrg()`'s `checksum` field is not a real hash.** `checksum: \`sha256:${Date.now()}\`` — labeled as SHA-256 but is a millisecond timestamp. P3. No consumer was found verifying this checksum anywhere in the codebase (searched `grep -rn "checksum" backend/ frontend/src/` for any comparison/verification logic — found none), so this is a misleading label with no active integrity-verification bypass, not an exploitable defect. Not fixed this pass — out of the "genuinely recoverable P0/authorization defect" mandate; a correct fix would mean computing a real digest over the package contents, which is a small but real behavior change better done with its own test, not slipped into a verification pass.
2. **`certifyOrg()` accepts a caller-supplied `score` with zero validation or independent computation.** Live-verified: an org owner can self-certify their own org at `level:"platinum"` with `score:9999` (no upper bound, no relationship to the org's actual `getOrgHealth()` output). This is **not a tenant-boundary breach** (an owner can only fake-certify their own org, not another tenant's), so it does not meet the mission's "fix now" bar (that bar was reserved for the item-3-class authorization gap, which turned out to already be closed). Documented as a genuine capability-honesty gap: "certify" implies the platform assessed the org; in reality it just records whatever the caller claims.

---

## Port hygiene

- Verification server: port 5306 (chosen fresh, confirmed free via `lsof -i :5306` before starting).
- Port 5050 (the live app server, PID 45392, pre-existing and unrelated to this pass) checked via `curl http://localhost:5050/health` and `lsof -ti:5050` **before, during, and after** this pass — confirmed unchanged (`node backend/server.js`, uptime monotonically increasing, `status:"ok"` throughout) and untouched by any command in this pass.
- Verification server process (PID 72051) killed by exact PID at the end of this pass; confirmed port 5306 clean afterward.
