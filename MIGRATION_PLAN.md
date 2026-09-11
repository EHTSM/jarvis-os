# Database & Data Migration Plan

Status: design only. No migration code included or implied to have been run.

This plan covers the storage evolution required to support the gaps identified in `MULTI_ORG_GAP_ANALYSIS.md`, across Organizations, Billing, Connectors, Memory, Knowledge, and Marketplace. It is deliberately incremental — no big-bang cutover, no ORM adoption mandated as a prerequisite.

---

## Guiding constraint

`ecosystem.config.cjs` currently runs one PM2 instance because of in-process singleton state (`taskQueue`, `learningSystem`, `contextEngine`). Any migration plan that assumes multiple backend processes writing concurrently to the same JSON files is unsafe until that singleton constraint is addressed (see roadmap M8+). Every step below is written to be safe under the current single-process assumption, and explicitly flags where it stops being safe if that assumption changes first.

## Threshold reasoning: when JSON stops being viable

Flat JSON is fine as long as (a) file size stays small enough that a whole-file read-modify-write completes faster than realistic request concurrency, and (b) there's exactly one process doing the writing. `data/organizations.json` today holds 2 test orgs — nowhere near the failure point. The practical trigger for migrating a given store off JSON is not a fixed row count, it's **whichever comes first**:
- Write latency measurably degrades (whole-file rewrite time becomes visible to users), or
- A second writer process is introduced (breaking assumption (b)), or
- A store needs a query pattern JSON can't serve cheaply (e.g., "all missions across 500 orgs updated in the last hour" without scanning `data/memory-store.json`'s 72,880 lines).

This is why the plan below migrates stores **one at a time, in the order they'll actually hit that trigger**, not all at once.

---

## 1. Organizations

**Current**: `data/organizations.json`, single array, whole-file `_read()`/`_write()` in `organizationService.cjs` (lines 73-80), no atomic rename.

**Future**: Relational tables — `organizations`, `org_members`, `departments`, `teams`, `team_members` — with `organizations.id` as the foreign key root. Given `better-sqlite3` is already a dependency (used today only for the task queue), the lowest-risk path is extending SQLite usage here rather than introducing a new database technology, deferring a heavier RDBMS (Postgres) decision to whenever horizontal scaling (multiple write processes) is actually undertaken.

**Path**:
1. Add atomic writes to the existing JSON store first (temp-file + rename, matching the pattern `integrationConnectors.cjs`/`secretVault.cjs` already use) — a same-day fix that removes the worst correctness risk without touching the schema.
2. Stand up the SQLite schema alongside the JSON store; write a one-time importer that reads `organizations.json` and populates the tables, run manually, verified by row-count and spot-check diff before cutover.
3. Switch `organizationService.cjs`'s internal `_read()`/`_write()` implementation to SQLite queries; the exported function signatures (`createOrg`, `addMember`, etc.) do not change, so every caller (routes, other services) is unaffected.
4. Keep `organizations.json` as a read-only export/backup artifact for one release cycle, then retire it.

**Reversibility**: Steps 1-3 are independently revertible — at any point, reverting to the JSON-backed implementation is a one-file code revert as long as step 4 hasn't happened yet.

## 2. Billing

**Current**: `data/billing.json`, `{ [accountId]: BillingRecord }`, no `orgId`.

**Future**: `billing_entities` table keyed by `(entity_type: account|organization|enterprise_account, entity_id)`, plus a `usage_ledger` table (one row per metered event, per the blueprint's ledger model) that plans and invoices become views over.

**Path**:
1. Add `orgId` as an optional field to the existing JSON `BillingRecord` shape first — additive, non-breaking, lets `checkUsageQuota` start accepting an optional org context without any schema migration.
2. Introduce the `usage_ledger` table in SQLite (new, not a migration of existing data — `usageMetering.cjs`'s history becomes the seed data via a one-time import, mirroring the Organizations path).
3. Once ledger-backed quota checks are verified against the old account-scoped logic in shadow mode (both run, results compared, discrepancies logged, not surfaced), cut `checkUsageQuota` over to reading the ledger.
4. Existing paying customers: every current `accountId` billing record gets a synthetic 1-member Organization created for it (a default org per legacy account) so no customer's plan or trial state changes meaning on migration day — this is the safe default called out as a risk in the Gap Analysis §5.

**Reversibility**: Ledger is additive; account-scoped billing keeps working throughout, so this can be paused at any step without breaking existing billing.

## 3. Connectors

**Current**: `secretVault.cjs` flat key-value, `` `${connectorId}::${type}` ``, one `data/vault.json`, one global encryption key.

**Future**: See `CONNECTOR_ISOLATION_PLAN.md` for the full design. Migration-specific summary: vault key becomes `` `${orgId}::${connectorId}::${type}` ``.

**Path**:
1. Extend `_vkey()` to accept an optional `orgId`, defaulting to a reserved sentinel (`"__platform__"`) when omitted — existing entries are re-keyed under this sentinel in place, zero behavior change for current single-tenant deployments.
2. New connector instances created after this point require an explicit `orgId`.
3. For any deployment that wants true per-org credentials, an explicit "claim this connector for org X" operation copies the sentinel-keyed secret into an org-keyed entry — a deliberate, auditable action, not an automatic migration, because only a human can correctly say which org a pre-existing shared credential should belong to.

**Reversibility**: The sentinel default means nothing breaks if this stalls partway — every existing self-hosted/Electron single-user deployment keeps functioning exactly as today, indefinitely, without ever performing step 3.

## 4. Memory

**Current**: `data/memory-store.json` (72,880 lines), `memory-index.json`, `unified-memory-index.json`, `missions.json` — all global, `orgId` only as an unenforced optional convention in `mission.metadata`.

**Future**: See `AI_ISOLATION_PLAN.md`. Migration-specific summary: every memory record needs an enforced `orgId` field, indexed.

**Path**:
1. This is the store most in need of leaving flat JSON, given its size (72,880 lines) and write frequency — prioritize the SQLite (or equivalent indexed store) migration here right after Organizations, ahead of Billing/Connectors if engineering capacity is constrained.
2. Backfill: existing memory records without a resolvable `orgId` (the common case today) are tagged with the same platform sentinel used for connectors, **not** silently assigned to whichever org happens to be active during backfill — an incorrect auto-assignment here is a customer-data-facing mistake, not a cosmetic one.
3. New writes require `orgId` going forward (enforced at the service layer, not just convention) once the index exists to support fast per-org queries.
4. Retroactive triage of sentinel-tagged records (deciding which pre-existing memory really belongs to which org, for deployments that had multiple orgs before enforcement existed) is a manual/assisted operator task per deployment — explicitly out of scope for an automated script, flagged in the Gap Analysis as a real cost.

**Reversibility**: Sentinel tagging is non-destructive; nothing is deleted or reassigned without an explicit operator action.

## 5. Knowledge

**Current**: ~13 global `data/knowledge-*.json` files, namespaced by topic/department, not tenant.

**Future**: Per-org KB namespace, per blueprint.

**Path**: Same shape as Memory (§4) — add enforced `orgId`, backfill to sentinel, index, manual triage for pre-existing multi-org deployments. Because Knowledge is fragmented across ~17 services rather than concentrated in one large file, this migrates service-by-service rather than as one cutover; sequence by which knowledge services are actually read on a hot path first (`knowledgeGraph.cjs`, being the only one with any existing org-awareness, goes first).

## 6. Marketplace

**Current**: No marketplace storage exists yet — this is new surface area, not a migration.

**Future**: `marketplace_listings` (publisher, type, capability manifest, review status), `marketplace_installs` (org_id, listing_id, installed_at, credential-remap status).

**Path**: Built directly against the target schema from day one (SQLite or whatever store Organizations lands on by the time Marketplace is scheduled) — there is no legacy data to migrate, so this is pure additive build, sequenced late in the roadmap (M10) specifically because it should inherit the storage decision made for Organizations rather than pre-empt it.

---

## Cross-cutting migration principles

1. **Every migration adds a field or a parallel store before it removes anything.** Nothing in this plan deletes or overwrites existing data as its first step.
2. **A sentinel/default value, never an inferred one, for ownership gaps.** Where existing data has no `orgId`, it gets a reserved placeholder, never a guess.
3. **Shadow-mode verification before cutover** wherever a new read path (ledger billing, indexed memory) replaces an old one — run both, compare, don't trust the new path until it's been observed agreeing with the old one in production traffic.
4. **One store migrates at a time.** No dependency in this plan requires Billing, Connectors, Memory, and Knowledge to move together — each can proceed, stall, or roll back independently once Organizations (the root identifier everything else keys off) is settled.
