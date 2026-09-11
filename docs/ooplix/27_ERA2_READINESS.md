# 27 — ERA-2 Readiness (Phase 15 detail)

Items explicitly out of ERA-1 scope — not evaluated for production readiness
here, listed only so they are not confused with ERA-1 blockers.

## Deferred by explicit prior product decision, confirmed still deferred

- **Civilization OS** (`/civ/*`) — explicitly classified "POST-V1 / FOUNDER
  DECISION," not certified, not broken, not scored, since it has no tenant
  concept by design.
- **Product OS's cross-OS integration** with Developer/Knowledge/Memory/
  Business-Sales-Finance/Customer Success — named as an open gap at time of
  its own certification, not independently re-verified as closed by this
  mission.

## Architecturally large builds that would require an explicit "build this"
## decision before attempting (per CLAUDE.md §16's duplicate-architecture caution)

- A real document/page/wiki product (to make Ooplix a credible Notion
  replacement) — explicitly named in `KnowledgeCenter.jsx`'s own code comments
  as "new architecture (document storage, PDF parsing, web crawling,
  embeddings) explicitly out of scope."
- A real-time messaging/channel product (to make Ooplix a credible Slack
  replacement) — no WebSocket layer exists anywhere in the codebase; building
  one is new infrastructure, not an incremental feature.
- A visual, drag-and-drop workflow/node builder (to close n8n's remaining gap)
  — confirmed still "Coming Soon" since a 2026-06 spec document, no builder
  component found since.
- A general-purpose vector design canvas (to make Ooplix a credible
  Figma/Canva replacement) — the existing ODI design suite is a self-audit
  tool for Ooplix's own UI, not a general design product; building the latter
  is an entirely separate product.
- A board/backlog/sprint UI (to make Ooplix a credible Jira/Linear
  replacement) — the existing mission system solves an adjacent but different
  problem (AI-agent work orchestration, not human ticket triage).
- Real bidirectional sync for any of the 44 probe-only connectors (turning
  "can Ooplix reach this service" into "does Ooplix meaningfully use this
  service").

## Genuinely deferred infrastructure/verification work, not urgent for ERA-1

- Migrating ad-hoc Playwright test usage to a standard `playwright.config.js`/
  `e2e/` project structure.
- Deciding whether to commit the currently-untracked majority of
  `tests/legacy/`/`tests/integration/`/`tests/smoke/` to git.
- Consolidating the 3 non-integrated Enterprise backends.
- Extending the AI OS's prompt-injection policy (client-controlled `history`
  field) — session-scoped, no cross-tenant impact, but worth a considered
  policy rather than an ad-hoc patch.

## Not evaluated by this mission at all (explicitly out of Phase 0-18's touched
## scope, distinct from a "deferred" item)

- Internationalization.
- Performance benchmarking (re-running `tests/stress/`/`tests/burnin/` was
  out of scope per this mission's no-full-corpus-run constraint).
- Offline/cross-browser guard re-verification (real Playwright test files for
  both exist; this mission read their existence but did not re-execute them).
- `flutter/` and `vscode-extension/` platforms named in CLAUDE.md §2 — not
  independently audited by any of this mission's phases.
