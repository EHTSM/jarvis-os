# 06 — Data Architecture (Phase 4 baseline)

Per CLAUDE.md: `better-sqlite3` (`data/jarvis.db`) exists but most persistence
is flat JSON under `data/` (600+ files, per CLAUDE.md's own count — not
independently re-counted this session). SQLite is used for at least one
verified real workload: `safe-backup.cjs`'s `VACUUM INTO` consistent snapshot
mechanism (see `19_INFRASTRUCTURE.md`).

## Store → Service → Route → Auth → OrgContext chains

See `09_TENANT_ISOLATION.md` for the full 8-chain trace (organizations,
users/accounts, leads/CRM, billing, missions, credentials/vault, knowledge
graph, support/customer-org). Six of the eight are confirmed correctly
isolated after Mission 51's fixes; billing and knowledge graph were not
independently re-verified line-by-line this pass (no contradicting evidence
found in searched reports either).

## Known shared-store lost-update races (test-time, and one production-time)

- `data/missions.json`, `data/organizations.json`, `data/biz-leads.json` (+
  siblings) all have documented, real, reproducible lost-update races when
  written concurrently with no cross-process coordination. In the test corpus,
  this is mitigated via `scripts/run-test-suite.cjs`'s serialized-batch
  execution (see `21_TESTING_STRATEGY.md`) — a test-infrastructure
  workaround, not a fix to the underlying service files themselves.
  `organizationService.cjs`'s own code comments explicitly acknowledge this
  race as a known, deferred, "larger architectural change out of scope" item.
- In production, `agents/autonomousLoop.cjs` was found to write real,
  unattended data into these same stores on every server boot — this was the
  root cause of a whole cluster of CI test failures (fixed via an opt-in
  `DISABLE_AUTONOMOUS_LOOP=1` guard used only in CI), but the underlying
  concurrent-writer race in the production stores themselves (not the test
  interference) remains architecturally present and undeferred as a general
  concern — only the CI-specific symptom was addressed.

## Autonomous background writers

`agents/autonomousLoop.cjs` genuinely creates/updates missions and
organizations as part of its real 10-second poll cycle (see
`10_AGENT_RUNTIME.md`) — this is by design, not a bug, but it means "shared
state" in this codebase includes writes from a background process the
end-user did not directly trigger, a dimension that must be accounted for in
any data-integrity analysis.

## Corrupted-state / initialization behavior

Multiple services confirmed to use an atomic tmp+rename write pattern
(`secretVault.cjs`, `integrationConnectors.cjs`'s `_save()`, the JWT
revocation list in `authMiddleware.js`) and to fail closed/gracefully on a
missing or corrupt file (empty-store fallback) rather than crashing — a
consistent, good pattern across the sampled files. Not exhaustively verified
across all 600+ `data/*.json` files (out of this mission's practical budget).

## Verdict

The data architecture is real and functioning, with well-established
mitigation for its most consequential race conditions in the test
environment, but the underlying concurrent-write race in
`organizationService.cjs`/`missionMemory.cjs`/`businessDataService.cjs` remains
an acknowledged, deferred architectural gap in production, not merely a test
artifact.
