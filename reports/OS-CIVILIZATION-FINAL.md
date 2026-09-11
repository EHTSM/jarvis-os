# OS-CIVILIZATION-FINAL — Classification

**Date:** 2026-08-15
**Companion report:** `OS-CIVILIZATION-DISCOVERY.md` (full evidence)

---

## Classification: **F — POST-V1 / ARCHITECTURAL SIMULATION LAYER, NOT V1 TENANT-FACING PRODUCT SURFACE**

(Using the mission's classification scheme: real+certified / fixed / absorbed-elsewhere / needs
verification / build required / **POST-V1 or FOUNDER DECISION** / out of scope. This lands in the
"honest non-V1" bucket the mission explicitly authorized as a valid outcome — not a failure to find
something, and not "D — needs dedicated verification" any longer, since the dedicated investigation
is now complete.)

---

## Reasoning

**1. The backend is real, not fake.** 62 live routes, a real 976-line state model, a real 6-step
workflow pipeline, 114/115 tests passing live in this pass. This is not a stub, not a placeholder,
not a mock. If the question were "does this code function as designed," the answer is clearly yes.

**2. But "as designed" is inter-org federation, not intra-tenant product functionality.** Every
concept in the domain model — Council, Constitution, Economy, Diplomacy, Innovation, Alliances,
Treaties, Reputation — describes relationships *between* organizations in a simulated confederation,
not anything a single tenant (a founder and their team, using the product to run their business) can
do for themselves. Compare directly against the certified OSs: Business OS manages *your* pipeline,
Finance OS manages *your* revenue, Knowledge OS manages *your* knowledge graph. Civilization OS
manages relationships between hypothetical member-orgs in a global simulation. There is no
mapping from "a JARVIS-OS tenant" to "a Civilization OS member" anywhere in the code, onboarding,
billing, or UI.

**3. The data model has no tenant concept at all — by design, not by defect.** This distinguishes it
from every cross-tenant-leak finding elsewhere in this reconciliation programme (Product OS, Customer
Org, `/dev/*`). Those were real tenant-scoped products with a broken isolation boundary — a P0/P1 bug
to fix. Civilization OS has no isolation boundary to break because it was never built with a tenant
boundary as a concept: one global dataset, `registerMember`'s `tenantId` is an optional free-text
field with no enforcement, and every authenticated user across every tenant reads and writes the
same global civilization. Retrofitting tenant isolation onto this would not be a bug fix — it would
be redesigning the product's premise (is "civilization" per-tenant, or is it genuinely meant to be
one shared cross-tenant simulation?), which is a founder-level product decision, not something to
infer from code.

**4. The accumulated data confirms zero real usage.** All 545 "members" and all 12,116 mission-route
records are traceable to (a) the original build's own 115-test verification suite re-run repeatedly
against the shared production data files with no cleanup, and (b) the `civ_director` background tick
(every 3 minutes, unconditionally running since server boot in every environment) auto-generating
mission churn against that synthetic data. There is no artifact anywhere — git history, mission
memory, or the data itself — of a real founder or tenant ever calling this API with real intent.

**5. The frontend confirms the builders' own read on this.** The one frontend touchpoint
(`OrgLevelStatus.jsx`) was added specifically as a "give this already-built backend infrastructure
*some* visibility" gesture — its own code comment says as much — not as a feature for tenants to use.
It is read-only: 20 rows of agent tick status and whatever scalar summary fields exist. No mutating
action (register, vote, trade, negotiate) has any UI. A founder using the product today cannot join
an alliance, propose a trade, or ratify a treaty — only a raw authenticated API client can.

**6. This is architecturally consistent with five sibling "OOPLIX Level" systems**, not an isolated
anomaly. Executive OS (L6), Enterprise OS (L7), and Ecosystem OS (L8) share the identical shape:
20-domain background tick registry + one shared dataset + `requireAuth`-only gate + the same generic
read-only status component. Of these, Ecosystem OS was investigated separately this same programme
and reached a *different* conclusion — because Ecosystem OS's certification was about the **existing
per-tenant OSs' own cross-OS integration** (a composition layer with real referents in real tenant
data), whereas Civilization OS is itself the primary/only referent for its own concepts. That
distinction is the reason this doesn't default to copying Ecosystem OS's "RECOVERED" verdict.

---

## What would change this classification

This becomes a real V1 candidate only if a founder-level product decision establishes one of:

- **(a)** Civilization OS is retired/mothballed as a real product plan — becomes explicit **OUT OF
  SCOPE**, background ticks disabled to stop the unbounded data growth (24 MB and growing, self-
  generated, no cap observed in `civilizationState.cjs`), and the read-only tab removed or clearly
  labeled internal/dev-only.
- **(b)** Civilization OS is intentionally a genuine multi-tenant cross-org marketplace/federation
  feature (tenants opt their own org in as a "civilization member," trade/negotiate with *other real
  tenants*) — in which case it needs: real tenant→member mapping, tenant-scoped read filtering on
  every list endpoint, a real UI for the ~50 mutating actions, a plan/tier gate, and a dedicated
  verification pass with two real tenant accounts (the same methodology used for Product OS/Ecosystem
  OS). This is a multi-week build, not a fix.
- **(c)** Civilization OS is kept purely as internal platform/ops tooling (e.g., an internal
  cross-organization dashboard for the founder's own multiple ventures) — in which case it should be
  `operatorOnly`-gated (like `/eos/*`), not `requireAuth`-only, and explicitly documented as internal.

None of these is this investigation's call to make — each is a product-scope decision, not a code
defect. This report deliberately does not force a certification score, a fabricated tenant-isolation
test, or a fake "CERTIFIED WITH LIMITATIONS" onto a system whose evidence points the other way.

---

## Evidence summary

| Item | Verified |
|---|---|
| Route file fully read | `backend/routes/civilizationOrg.js`, 151 lines, 62 handlers |
| Services fully read | `civilizationOrg.cjs` (352L), `civilizationState.cjs` (976L), `civilizationWorkflow.cjs` (314L) |
| Live test run | `tests/runtime/civ-v9.test.cjs` — 114/115 passed (1 fail = shared-data test-fixture collision, not a logic bug) |
| Mount point confirmed | `backend/routes/index.js:166-167`, gated `requireAuth` only |
| Frontend confirmed | `OrgLevelStatus.jsx` + `App.jsx` — real, wired, read-only only |
| Tenant isolation | None exists by design — no `orgId` derivation anywhere in the data model |
| Real usage evidence | None found — all 545 members / 12,116 mission routes traced to test-suite + background-tick self-generation |
| Code touched | **None** — `git status` clean on all 4 source files before/after |
| `.env` touched | **None** |
| Port 5050 | Confirmed untouched — same PID (45392) listening before and after, no other server started |

## Bottom line

**Civilization OS is real, working backend infrastructure with no genuine V1 tenant-facing product
purpose today.** Classify as **POST-V1 / FOUNDER DECISION REQUIRED** — not certified, not broken, not
a gap to fix, but a scope question sitting unresolved since the original June 2026 build. Recommend
the founder make an explicit (a)/(b)/(c) call above; until then, no further engineering time should
be spent building UI or "fixing" tenant isolation for a product surface whose intended tenant is
undefined.
