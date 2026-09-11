# OS-PLATFORM — DISCOVERY

**Track:** OOPLIX 25-OS Master Reconciliation — OS #25, Platform OS
**Date:** 2026-08-15 · **Branch:** `security/reality-completion` · **Verification port:** 5306
**Method:** DISCOVER → VERIFY → SECURITY TEST → COMPOSITION CHECK → REGRESSION → CERTIFY.
**PLATFORM OS ALREADY EXISTED. NO NEW PLATFORM LAYER WAS BUILT.**

---

## 1. What "Platform OS" actually is

Per the mission's own framing, Platform OS is not one file — it is the composite of:

| Layer | Real component | Status |
|---|---|---|
| Auth + Org + RBAC | `backend/services/organizationService.cjs` | Independently certified via Organization OS (not re-verified here — reused as-is) |
| Runtime / routing | `agents/runtime/*`, `backend/routes/index.js` barrel | Being separately verified as "Runtime OS" by another agent — not duplicated here, cited only |
| Org-as-a-product meta-layer | `backend/routes/platformOrg.js` + `backend/services/platformState.cjs` ("Level Ω" / "Artificial Organization Platform" / "Platform Omega") | **This pass's actual scope** |

This report focuses on the third layer — the one genuinely unique to "Platform OS" — and confirms its composition with the first two rather than re-certifying them.

---

## 2. `platformOrg.js` — real capabilities (verified against current code, not the old memory summary)

File: `backend/routes/platformOrg.js` (399 lines). Backing service: `backend/services/platformState.cjs` (959 lines). Mounted at `router.use(require("./platformOrg"))` in `backend/routes/index.js:170`, gated by `router.use("/platform", requireAuth)` at line 111 (barrel-level authentication only — authorization is per-route, see Security report).

Confirmed capability groups, each backed by real persisted JSON stores (`data/platform-*.json` via `_load`/`_save`, not in-memory-only):

1. **Organization Studio / Registry** — `POST/GET/PATCH /platform/v1/orgs[/:id]`, `/health`, `/policy`. Real CRUD over a JSON-backed registry.
2. **Blueprint Designer** — `POST/GET/PATCH /platform/v1/blueprints[/:id]`, `/publish`. Real draft→published lifecycle.
3. **Template Marketplace** — `/platform/v1/templates[/:id]`, `/install`, `/rate`. Publish, install (creates a blueprint from a template), rate.
4. **Deployment Center** — `POST /platform/v1/deploy`, `/deploy/quick`, `GET /deployments[/:id]`. Real blueprint→instantiated-org pipeline; `deployOrg` calls `registerOrg` and steps through each capability, recording per-capability status.
5. **Lifecycle Dashboard** — `GET /platform/v1/lifecycle`, `PATCH /platform/v1/lifecycle/:orgId` (active/paused/retired).
6. **Clone / Fork** — `POST /platform/v1/clone`, `/fork`, `GET /clones`. Reads a source org, writes a new org + new blueprint copy.
7. **Versioning** — `GET/POST /platform/v1/versions`, `POST /versions/rollback`.
8. **Upgrade / Migration engines** — `POST /platform/v1/upgrade`, `/migrate`.
9. **Export / Import (Backup & Restore)** — `GET /platform/v1/export/:orgId`, `POST /import`, `GET /packages`. Produces a real JSON package (org + blueprint + versions + deployments); `checksum` field is **not a real hash** — see Security report §4.
10. **Simulator** — `POST /platform/v1/simulate`. A declared, transparent heuristic formula (`healthScore = 60 + caps.length*4`, etc.) — not a real predictive model, not claimed to be one in the response shape.
11. **Digital Twin** — `GET /platform/v1/twin/:orgId`. Confirmed to call `getDigitalTwin()` — a real read-model over the org's own recorded state, not a separate simulation engine.
12. **Marketplace** (listings, distinct from Template Marketplace) — `/platform/v1/marketplace[/:id/purchase]`.
13. **Certification** — `GET /platform/v1/certifications`, `POST /certify`. **Real persistence, but the `score` and `level` are caller-supplied, not independently computed** — see Security report §4 for the honesty finding.
14. **SDK** — `GET /platform/v1/sdk[/manifest|/types]`. Returns a **static JSON manifest** of endpoint shapes and capability sets — this is a documentation manifest, not code generation. The "SDK generation" phrase in prior memory records is an overstatement of what the code does; corrected here.
15. **Analytics + Reports** — `GET /platform/v1/analytics`, `/reports`, `POST /reports`.
16. **CLI endpoints** — `/platform/v1/cli/deploy`, `/status`, `/clone`, `/templates` — same underlying functions, machine-friendly response shapes.
17. **Public Organization API** — `GET /platform/v1/registry[/:id]` — intentionally public, filtered server-side to `visibility:"public"` only.

All capability claims above were confirmed by direct source read of `platformState.cjs`, not assumed from route names or old prior-session summaries.

---

## 3. Prior security work already on this file (confirmed via `git log`, re-verified live this pass)

Two commits predate this pass and materially change the risk picture from what the mission brief anticipated:

- **`8dd77f6c` — "fix(security): close cross-tenant IDOR in platformOrg (Level Ω) routes"** (2026-08-05). Full commit message documents the exact P0 this mission's item 3 asked me to check for: every route previously resolved an org by client-supplied `:orgId`/body `orgId` with **zero ownership check**, gated only by barrel-level `requireAuth` (authenticates, does not authorize). Fixed via a `_requireOrgOwner` middleware (404 not 403, matching the IDOR-hardening convention used elsewhere in the codebase) applied to every route that resolves one specific org; `ownerId` is now always derived server-side from `req.user.sub`, never trusted from the request body; list endpoints scope to the caller's own orgs unless `enterprise_admin`. Added `tests/security/23-platform-org-idor.cjs` (15 assertions).
- **`09d5ee67` — "fix: platform org health score fabricated a 70 baseline for missing layers"** (2026-07-16). `getOrgHealth()` previously defaulted any unavailable sub-layer's score to a hardcoded `70` and folded it into the average — fabricating a plausible-looking health number for orgs with zero real signal. Fixed to omit unavailable layers and expose `layersReporting` so callers can tell how much real signal backs the number.

**This pass's job was therefore to re-verify these fixes are still real and complete, not to assume the mission brief's premise (an open P0) was still current.** It was not — the P0 is closed. Full live re-verification in `reports/OS-PLATFORM-SECURITY.md`.

---

## 4. Composition check — does this file reimplement a parallel org/RBAC model?

**No.** Confirmed by direct source read:

- `grep -n "password|bcrypt|jwt|login|register" backend/services/platformState.cjs` (excluding `registerOrg`/`registerTenant`/`registerMember`, which are platform-org registration, not auth) returns zero authentication primitives.
- All admin-privilege checks (`isEnterpriseAdmin`) call directly into `organizationService.cjs` — the canonical authority — rather than reimplementing an admin-role concept locally.
- `registerOrg()` optionally cross-registers the new platform-org into `ecosystemState.cjs` (`registerTenant`) and `civilizationState.cjs` (`registerMember`) for cross-Ω-level bookkeeping, but these are its own sibling Level-8/Level-9 org concepts (already separately audited under Ecosystem/Civilization OS), not a competing tenant-identity model.
- Real account registration (`POST /accounts/register`) independently creates a real `organizationService.cjs` org (`org_...`) for every new account — confirmed live this pass (see §6 of `OS-PLATFORM-SECURITY.md`). `platformOrg.js`'s "org" concept (a deployable org-as-a-product blueprint instance) is a distinct, additively-layered concept, not a substitute for the tenant Org/Dept/Team model.

This is the **opposite disease** from C10-010 (Enterprise OS's 3 non-integrated backends with independent membership models). Platform OS correctly composes on top of `organizationService.cjs` rather than duplicating it.

---

## 5. C10-011 re-confirmation

**C10-011 claim:** "Platform OS backend real, zero frontend consumer... DEFERRED."

Re-confirmed exactly as stated, unchanged:

```
grep -rln "platform/v1|platformOrg|/platform/status|/platform/summary" frontend/src/
```

returns zero matches. `frontend/src/components/OrgLevelStatus.jsx`'s `LEVELS` map (the generic status/summary dashboard reused across `ako`/`eos`/`ent`/`eco`/`civ`/`auto`) has no `plt`/`platform` entry, despite `/platform/status` and `/platform/summary` using the exact same generic envelope shape the component already renders for the other six levels. This is a **real, low-effort recoverable gap** (adding one entry to the `LEVELS` map would surface it with zero new code) but is out of this pass's scope per the mission's explicit instruction not to build anything new — and it carries no security or tenant dimension. **Still DEFERRED, correctly.**

---

## 6. Runtime OS boundary

Per the mission's explicit instruction, the runtime/routing layer is being separately verified as "Runtime OS" by another agent. This pass does not re-verify `agents/runtime/*` or the `routes/index.js` barrel's general mounting behavior beyond the one line relevant to Platform OS's own auth gate (`router.use("/platform", requireAuth)`, confirmed present at `backend/routes/index.js:111`). Findings about that barrel line's authorization semantics are cited, not re-derived independently.
