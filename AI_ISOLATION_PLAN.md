# AI Isolation Plan

Status: design only. No code changed.

Scope: mission memory (`missionMemory.cjs`), the broader memory subsystem (`memoryPersistenceLayer.cjs`, `engineeringMemoryEngine.cjs`, `semanticMemorySearch.cjs`, `memoryIntelligenceEngine.cjs`), the knowledge subsystem (`knowledgeGraph.cjs`, `autonomousKnowledgeOrg.cjs`, and ~13 `data/knowledge-*.json` stores), and the agent registry (`agentRegistry.cjs`, `registerAgent()` pattern). This is the plan referenced by Gap Analysis §7-§8.

---

## Why this is treated as its own document, not folded into Connectors

Connector isolation is about credentials leaving the platform to third parties. AI isolation is about a different failure mode entirely: **one customer's AI agent recalling another customer's data during a conversation.** That's a trust failure a customer would experience directly and immediately, inside the product, with no external system involved — arguably the single fastest way to lose a multi-org SaaS customer base. It's treated separately because the fix pattern is different: this is about read-time filtering of shared stores, not credential vaulting.

## Current state (verified)

- `missionMemory.cjs` (756 lines): missions stored in `data/missions.json`, atomic writes, but the mission schema's `metadata` field is free-form — `createMission({objective, priority, metadata})` never validates or requires an `orgId`.
- `knowledgeGraph.cjs` reads `mission.metadata?.orgId` opportunistically (lines 213, 420, 477) — this is the **only** place in the entire memory/knowledge subsystem with any org-awareness, and it's a read-side convenience, not a write-side guarantee.
- `assertMissionOwnership(missionId, accountId, orgId)` in `organizationService.cjs` (lines 543-557) is the **only** enforced isolation check found anywhere in mission/memory data — and it only fires on routes that explicitly call it.
- `memoryPersistenceLayer.cjs`, `engineeringMemoryEngine.cjs`, `semanticMemorySearch.cjs`, `memoryIntelligenceEngine.cjs`: confirmed via grep, zero org/account/tenant references.
- Storage: `data/memory-store.json` (72,880 lines), `memory-index.json`, `unified-memory-index.json` — indexed by id/blueprint/type/namespace, with no tenant dimension in any index.
- Knowledge: ~13 global `data/knowledge-*.json` files, namespaced by topic/department (engineering, business, etc.), not by tenant.
- Agent registry: `agentRegistry.cjs`'s `register()`/`findForCapability()` and the widely-reused `registerAgent()` pattern (used across `businessOrg.cjs`, `executiveOrg.cjs`, `enterpriseOrg.cjs`, `civilizationOrg.cjs`, and others) has no `orgId` concept — an agent instance registered by one org-level service today is, in principle, addressable platform-wide by capability lookup, not scoped to the org that registered it.

**Bottom line**: today, nothing technical prevents cross-org memory or knowledge bleed except the accident that routes generally only fetch memory by a mission ID they already obtained through an org-scoped path. There is no enforced boundary if that assumption is ever violated by a new code path.

---

## Target model (per approved blueprint)

Four tiers, distinguished by who configures the behavior and how far its memory reaches:

| Tier | Configured by | Memory reach |
|---|---|---|
| **Global AI** | Platform | None persisted per-tenant — stateless reasoning/model access only |
| **Organization AI** | The org (`org_admin`+) | That org's memory, KB, mission history only |
| **Workspace AI / Project AI** | Narrower scope within an org | Subset of the org's memory, per Workspace/Project — deferred until Workspace/Org reconciliation lands (see below) |
| **Shared AI (Marketplace templates)** | Platform or publisher, instantiated per-org | Fresh instance per org — template is shared, running state is never shared |

The critical invariant carried from the blueprint: **"shared" describes the template, never the state.** Two orgs running the same Marketplace agent template must never read each other's conversation history, leads, or outputs.

---

## Design: enforced `orgId` at write time, filtered at read time

This is not a namespacing suggestion — it's a two-sided guarantee:

### Write side
Every mission created via `missionMemory.cjs`'s `createMission` must require (not optionally accept) an `orgId`, resolved from the same request context `orgMiddleware.cjs` already populates. Any code path that creates a mission without going through an org-attached request (background jobs, autonomous agent self-scheduling) must explicitly pass the org that owns the triggering context — there is no valid "orgless" mission once this lands, only the reserved sentinel used during migration (see `MIGRATION_PLAN.md` §4).

### Read side
Every memory/knowledge query function gains a **mandatory** `orgId` parameter, not an optional filter — the function signature itself should make it impossible to call a memory read without specifying whose memory you're reading. This is deliberately stricter than the connector pattern's three-tier fallback: a missing credential falls back safely to an env var, but a missing `orgId` on a memory read has no safe fallback — it should error, not default to "all memory."

### Index requirement
`unified-memory-index.json`'s existing dimensions (id/blueprint/type/namespace) gain `orgId` as a mandatory indexed dimension, enabling `WHERE orgId = ?` — style lookups to actually be fast rather than a full-file scan, once this store leaves flat JSON (Migration Plan §4 prioritizes this store early because of its size).

---

## Knowledge boundaries

Same enforced-write / mandatory-read-filter pattern as memory, applied per the blueprint's per-mode knowledge scoping:

- **Individual**: personal KB only, trivially satisfied (single implicit org).
- **Startup/Business**: org KB, optionally department-namespaced (an additional filter dimension inside the org boundary, not a tenancy boundary itself).
- **Enterprise**: org KB with per-child-org namespaces, plus an explicit opt-in enterprise rollup — meaning a query that spans multiple child orgs is a deliberate, logged, multi-query aggregation (fetch N org-scoped results, merge in the application layer), never a relaxed query that spans orgs by default. This mirrors the Grants pattern from the original architecture blueprint (cross-org visibility is always an explicit grant, never an implicit consequence of a shared parent).
- **Agency**: agency publishes a "template KB" that is *copied* into a new client org at creation time, then diverges independently — no live reference back to the agency's source KB, so an agency updating its template doesn't retroactively alter what a client org already has (matching the Marketplace copy-not-reference rule below).

## Shared AI templates: copy semantics

When a Marketplace agent or workflow template is installed into an org (see the original blueprint's Marketplace Architecture sheet), the install operation:
1. Reads the template definition (capability schema, default prompts/config) — this part is shared, read-only, global.
2. Creates a **new** agent registry entry scoped to the installing org (`registerAgent()` call carrying that org's `orgId`), with its own empty memory namespace.
3. Never carries over any prior runtime state, conversation history, or another org's data — there is no "instance" to share, only the template.

This requires `agentRegistry.cjs`'s `register()` to accept and store an `orgId` on each registered agent, and `findForCapability()` to filter by the calling context's `orgId` — today it has neither.

## Agent registry scoping

Beyond Marketplace-installed agents, the many `registerAgent()` calls scattered across `businessOrg.cjs`, `executiveOrg.cjs`, `enterpriseOrg.cjs`, `civilizationOrg.cjs`, etc. (the various "Org V2 through Ω" simulation/orchestration layers) register agents that are, as of today, addressable platform-wide by capability. These are largely internal orchestration agents rather than customer-facing per-tenant agents, so this plan does **not** propose retrofitting `orgId` onto every one of them — that would be scope creep into subsystems the blueprint doesn't ask this program to touch. The isolation requirement applies specifically to **customer-facing Organization AI and Shared AI (Marketplace) agents**; internal platform orchestration agents remain global, consistent with the blueprint's "Global AI" tier having no per-tenant memory to leak in the first place.

---

## Rollout shape

1. Add `orgId` as a required (not optional) field to `missionMemory.cjs`'s mission schema, with the migration sentinel absorbing existing missions (Migration Plan §4).
2. Add mandatory `orgId` parameters to the memory-read functions in `memoryPersistenceLayer.cjs`, `engineeringMemoryEngine.cjs`, `semanticMemorySearch.cjs`, `memoryIntelligenceEngine.cjs` — one service at a time, each independently testable.
3. Extend `knowledgeGraph.cjs`'s existing (partial) org-awareness into a full mandatory filter, since it's the furthest along already.
4. Apply the same mandatory-filter pattern to the remaining ~13 knowledge stores, sequenced by read frequency (hottest paths first).
5. Add `orgId` to `agentRegistry.cjs`'s `register()`/`findForCapability()`, scoped to customer-facing agents only, not internal orchestration agents.
6. Only after 1-5 are stable: build Marketplace install-time copy semantics on top.

## Backward compatibility

Steps 1-4 change function signatures from optional/absent `orgId` to mandatory `orgId` — this is **not** backward compatible at the call-site level by design (a missing `orgId` should be a loud error, not a silent global-scope fallback, because the whole point is that "forgot to scope this query" must fail closed). Every call site touching these functions needs to be updated in the same change as the signature change, which is why this rolls out service-by-service rather than as a single flag-day cutover — each service's call sites are enumerable and fixable together.

## Rollback

Each service's `orgId`-enforcement change is revertible independently (it's a function signature change contained to one file plus its call sites) as long as no destructive data operation has occurred — and per the Migration Plan's cross-cutting principles, none of this plan's steps delete or reassign existing data, only add a required filter dimension. A revert restores the prior (unsafe but functional) global-read behavior; it does not lose data.
