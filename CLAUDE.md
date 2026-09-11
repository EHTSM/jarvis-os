# CLAUDE.md — Ooplix / JARVIS-OS

## 1. Project Identity and Purpose

Ooplix ("JARVIS-OS" internally) is a desktop AI operating system for solo founders —
Express backend + React (CRA) frontend + Electron shell, with a large multi-agent
automation runtime underneath. It is not a chatbot wrapper; it is a mature,
long-running production system (`package.json` version `1.0.0-rc1`; README/SECURITY.md
say `rc6`/`rc8` — this drift itself is a known, tracked issue, not a typo to silently
fix without noting it).

This file describes the repository **as it actually is**, verified by direct
inspection, not as documentation elsewhere claims it to be. Where this file and
another doc disagree, trust direct inspection of the code over either.

## 2. Authoritative Architecture Map

- `backend/` — Express 5 API, entrypoint `backend/server.js`. Central route barrel:
  `backend/routes/index.js`.
- `frontend/` — separate npm package (CRA/React 18), entrypoint `frontend/src/App.jsx`.
- `agents/` — legacy + domain agents, plus `agents/runtime/` (the real orchestration
  core: `runtimeOrchestrator.cjs`, `executionEngine.cjs`, `patchExecutionEngine.cjs`).
- `backend/services/` — 400+ files, flat directory, one level deep. This is where most
  business logic and "OS subsystem" (business/engineering/knowledge/evolution org,
  etc.) code lives, in `<name>State.cjs` / `<name>Workflow.cjs` / `<name>Org.cjs`
  triads.
- `electron/` — desktop shell (`electron/main.cjs` is the `package.json` main entry).
- `deploy/` — VPS setup/start/update/rollback scripts + nginx configs.
- `tests/` — 13 categories (`runtime/`, `security/`, `legacy/`, `stress/`, `burnin/`,
  etc.), 373+ files total. See §9 — do not trust `package.json`'s `test:runtime` script
  name as the full picture.
- `reports/` — per-mission audit/certification reports; `OOPLIX-V1-MASTER-AUDIT-REGISTER.md`
  is the running index. See §15.
- `mobile/`, `flutter/`, `vscode-extension/` — additional client platforms, each
  independently maintained. Do not assume changes to one propagate to the others.
- `_archive/`, `experimental/`, `generated/` — legacy/scratch content. `generated/`
  mixes live generated artifacts (`generated/companies/`) with stale one-off test
  scripts at its root — do not assume everything there is either fully live or fully
  dead without checking the specific file.

## 3. Frontend Architecture

- Create React App (`react-scripts` 5.0.1), React 18.2.0. **Not Vite.**
- No router library in dependencies — routing is hand-rolled inside `App.jsx`
  (92KB). Check `App.jsx` and `App.routing.test.js` before assuming standard
  react-router idioms apply.
- No Redux/Zustand/MobX — state via React Context (`frontend/src/contexts/`) and
  custom hooks (`frontend/src/hooks/`, ~156 files).
- API calls go through dozens of flat `*Api.js` files at `frontend/src/` root
  (e.g. `businessApi.js`, `runtimeApi.js`, sequential `phase18Api.js`…`phase27Api.js`
  matching backend route phases). Follow this existing pattern for new API calls —
  do not introduce a new fetch/axios wrapper convention.
- Build: `ESLINT_NO_DEV_ERRORS=true` is deliberately set on the build script — this
  is a pre-existing, intentional choice, not something to "fix" by removing it.

## 4. Backend Architecture

- Single Express app, `backend/server.js`. Manual security headers are set directly
  in this file — there is no `helmet` dependency to reach for.
- All routes are mounted through `backend/routes/index.js` in explicit priority
  order. **Never mount a new route file outside this barrel** unless there is a
  specific, already-established exception pattern for it.
- Legacy `/p18`–`/p27` phase-numbered routes remain live, wrapped in a
  `_deprecate()` middleware (logs + `Deprecation`/`Link` headers). Do not delete
  these without being explicitly asked — they are intentionally soft-deprecated,
  not dead code.
- `backend/services/` is flat by convention (~400+ files, no subdirectory nesting).
  Follow the existing `<name>State.cjs` / `<name>Workflow.cjs` / `<name>Org.cjs`
  naming triad when adding to an existing "OS" subsystem rather than inventing a
  new file-organization scheme.
- Database: `better-sqlite3` (`data/jarvis.db`) exists but most persistence is flat
  JSON under `data/` (600+ files). Do not assume SQL is the primary store for a
  given piece of data without checking.

## 5. Agent/Runtime Architecture

- There are **four separate "execution engine" files** with overlapping names and
  different scope — this is known, tracked drift, not something to unify
  unilaterally:
  - `agents/runtime/executionEngine.cjs` — capability-routed async executor with
    backoff/circuit-breaker.
  - `backend/services/autonomousExecutionEngine.cjs` — 11-step founder-workflow
    pipeline.
  - `backend/services/agentExecutionEngine.cjs` — per-agent dispatch/history/retry.
  - `backend/services/computerExecutionEngine.cjs` — NL command → controller
    routing (explicitly does not implement its own runtime).
- Before adding new orchestration logic, identify which of these four (or
  `agents/runtime/runtimeOrchestrator.cjs` itself) is the correct integration
  point — do not create a fifth.
- `agents/executor.cjs` (132.9KB, the largest file in the repo) is a legacy
  fallback executor still in the live path. Treat edits to it as high-blast-radius.
- Scheduling goes through `node-cron` (7+ call sites) or PM2's own
  `cron_restart` for the backup job — do not introduce a second scheduling
  library.

## 6. Authentication, Authorization, and Tenant-Isolation Rules

- Auth middleware: `backend/middleware/authMiddleware.js` — exports `requireAuth`,
  `operatorOnly`. Multi-tenant scoping: `backend/middleware/orgMiddleware.cjs` /
  `workspaceMiddleware.cjs`.
- **The single most-repeated real defect class found across this repo's own audit
  history is a new/sibling route missing the same auth/tenant-scoping middleware
  its neighbors already have** (confirmed multiple times: an unscoped SSE stream,
  an unscoped operator-only route, an unscoped Firebase/Google/Phone login route
  bypassing org MFA policy). **Any time a route is added or modified, explicitly
  compare it against every sibling route in the same functional family for
  consistent middleware.** This is not a hypothetical rule — it is the exact
  pattern that has caused real, live-verified authorization bypasses in this repo
  before.
- `primaryOrgId`/tenant context must always be server-resolved from the
  authenticated session (e.g. via `organizationService.resolveContext`), never
  taken from a client-supplied header or body field. This is the existing,
  correct pattern — do not introduce header-based org resolution anywhere.
- MFA enforcement (`policyService.cjs`'s `assertMfaSatisfied`/`assertProviderAllowed`)
  must be called, in that order, before any session/JWT is issued
  (`signJWT`/`res.cookie`) on any login-shaped route. SSO/SAML/OIDC routes
  intentionally delegate MFA to the org's own IdP — this is documented, accepted
  behavior, not a gap to "fix" by adding local MFA checks to those routes.

## 7. Production/Runtime Safety Rules

- **Never run `node backend/server.js` directly while PM2 is managing the
  process** — it silently holds port 5050 and blocks PM2 restarts with no error
  in PM2 logs. Use `pm2 restart jarvis-os`.
- **Never add a second app entry to `ecosystem.config.cjs`** — `backend/server.js`
  is the sole production entrypoint; a second entry causes `EADDRINUSE`.
- `pm2 reload` is NOT zero-downtime here (fork mode, no second instance) —
  measured ~5.6s outage on reload. Do not assume reload is safe for
  user-facing changes without accounting for that gap.
- Do not touch `.env`, `.env.production*`, credentials, the VPS, or deployment
  scripts as a side effect of an unrelated change. See §20.

## 8. Correct Test/Build/Validation Commands

- Backend tests use Node's built-in `node --test`, not Jest/Mocha.
- Frontend tests use CRA/Jest (`react-scripts test` / `react-scripts test --watchAll=false`
  via `frontend`'s own `npm run test:ci`).
- Build: `npm run build:frontend` (CRA) for the web bundle; `electron-builder`
  variants (`dist:mac`/`dist:win`/`dist:linux`) for desktop packaging.
- There is no `lint` or `typecheck` npm script anywhere in this repo (root or
  frontend). Do not assume one exists or invent one without being asked.

## 9. Real Test Corpus — Corrected 2026-08-29 (Mission 75)

- **This section previously claimed `test:runtime` only ran a narrow 10-file
  subset and that CI enforced a stale `grep -E "pass 144"` gate. That claim is
  no longer true and has been corrected here, not silently — Mission 42
  (2026-08-23) introduced `scripts/run-test-suite.cjs`, and Mission 63/71
  (2026-08-28) extended it; `package.json`'s `test:runtime`/`test:security`
  now both run `node scripts/run-test-suite.cjs <runtime|security>`, which
  recursively discovers every real test file under `tests/runtime/` /
  `tests/security/` (one subdirectory level deep) and runs known
  shared-store-mutating files serialized (`--test-concurrency=1`) to avoid a
  documented cross-process lost-update race, with everything else at normal
  parallelism. There is no `grep -E "pass 144"` gate anywhere in
  `.github/workflows/ci.yml`, and no "144" reference remains in `README.md` or
  `SECURITY.md` — verified by direct search, not assumed.**
- A separate, genuinely narrow script still exists and is intentionally narrow:
  `test:runtime:fast` runs exactly 4 named files as a quick smoke check. This
  is not a stale-vs-real-corpus problem — it is honestly named and not what
  CI's `regression` job invokes (CI runs the full `test:runtime`).
- **Current corpus size (verified 2026-08-29, do not assume this number stays
  fixed — re-count with `find tests/<dir> -type f | wc -l` if it matters for a
  specific task):** `tests/` totals **386 files** across the same 13
  categories: `security/` 123, `runtime/` 116, `legacy/` 74, `integration/` 15,
  `stress/` 14, `burnin/` 14, `workflows/` 10, `smoke/` 9, `operator/` 4,
  `stability/` 2, `evaluation/` 2, `chaos/` 1, `profiling/` 1. These counts grow
  over time as new test files are added — the corpus is not static.
- CI's actual gate (`.github/workflows/ci.yml`'s `regression` job) is
  outcome-based, not count-based: both `test:runtime` and `test:security` run
  unconditionally (`continue-on-error: true` each), and a separate
  "Enforce regression/security gate" step fails the job if either suite's real
  `outcome` was not `success` — verified by reading the step logic directly,
  not the surrounding comments.
- **When asked to "run the regression suite" or "run all tests," `npm run
  test:runtime` / `npm run test:security` (i.e. `scripts/run-test-suite.cjs`)
  now genuinely are the full corpus for their respective directories** — no
  need to reach for a raw `node --test tests/runtime/*.test.cjs` glob instead,
  since that would skip the script's shared-store serialization and can
  reintroduce the exact race it exists to prevent (reproduced live during
  Mission 75: two known-mutating files failed reproducibly when run via a raw
  parallel glob, then passed reliably when run through the script's serialized
  bucket). `tests/legacy/`, `tests/integration/`, `tests/smoke/`, `tests/stress/`,
  `tests/burnin/`, and the other smaller categories are **not** covered by
  either script and have their own separate `npm run test:*` entries or must be
  invoked directly — do not assume `test:runtime`/`test:security` cover them.

## 10. Route Registration Conventions

- All routes are mounted in `backend/routes/index.js`, in explicit priority
  order, with `router.use(...)`.
- New routes go through this barrel. Check the immediate neighbors of wherever
  a new route is mounted for their auth/rate-limit/tenant-scoping middleware and
  match it exactly, per §6.
- Deprecated routes are soft-deprecated via the existing `_deprecate()`
  middleware pattern (logs + `Deprecation`/`Link` headers) — follow this pattern
  rather than deleting old routes outright.

## 11. Service Conventions

- `backend/services/` is intentionally flat (no subdirectories) at ~400+ files.
  Do not introduce a new subdirectory layer as a "cleanup" — this is an existing,
  accepted (if debatable) convention.
- For an existing "OS" subsystem, follow its `State.cjs`/`Workflow.cjs`/`Org.cjs`
  triad naming. For genuinely new functionality, match the closest existing
  sibling's naming and structure rather than inventing a new pattern.

## 12. Frontend/Backend Contract Rules

- Frontend API calls go through the existing flat `*Api.js` files
  (`frontend/src/*Api.js`), which map to backend route "phases." When a backend
  route changes shape, the corresponding `*Api.js` file and any component
  consuming it must be updated in the same change — do not leave the contract
  half-updated.
- Error responses from the backend carry a machine-readable `code` field in
  addition to `.message`. Preserve and forward `code` through any client-layer
  fetch wrapper changes (this was previously found silently dropped in one real
  defect — see the MFA certification report) rather than only surfacing
  `.message`.

## 13. Security-First Development Rules

- Treat any new or modified route, service, or agent capability as
  security-relevant by default in a system with 57+ external connectors and a
  dedicated `secretVault.cjs` (AES-256-GCM, HKDF-derived key).
- Never log, print, or return raw secret/credential values. `secretVault.cjs`
  explicitly documents it does not store plaintext — new code touching
  credentials must preserve that guarantee.
- Rate limiting is a custom in-memory implementation
  (`backend/middleware/rateLimiter.js`), not a library — reuse it rather than
  adding a new rate-limiting dependency.

## 14. Audit/Mission Methodology

This repo has an established, repeated audit pattern (evidenced by 300+ files in
`reports/` and a running master register). When asked to audit or certify a
subsystem:
1. Trace the real code path end-to-end before claiming anything is broken or
   working.
2. Prove findings with live verification (a real running server, a fresh
   ordinary account) wherever safely possible, not just static reading.
3. Make the smallest existing-pattern fix — do not redesign architecture as
   part of an audit.
4. Negative-test every fix (revert it, confirm the defect reproduces, restore
   it, reconfirm the fix).
5. Keep findings unrelated to the mission's scope explicitly out of that
   mission's report.
6. Stop after the scoped mission — do not silently expand into adjacent
   subsystems.

## 15. Existing Report/Register Conventions

- Individual mission reports live in `reports/`, named descriptively
  (e.g. `MFA-END-TO-END-FRONTEND-BACKEND-CERTIFICATION.md`).
- `reports/OOPLIX-V1-MASTER-AUDIT-REGISTER.md` is the running index — each
  mission appends a summary section there linking back to its full report.
- Reports follow a consistent shape: STATUS, SCORE, CONFIDENCE, inventoried
  files/routes, findings (fixed/deferred/decision-required), live verification,
  regression before/after, build, security, server status, `.env` status,
  merge/push/commit status, limitations. Match this shape for new audit work
  rather than inventing a new report format.
- Do not create a new top-level "master" tracking document — extend the
  existing register.

## 16. Rules Preventing Duplicate Architecture

- Before adding a new engine, orchestrator, scheduler, or "OS" subsystem, search
  `backend/services/`, `agents/runtime/`, and `agents/` for an existing
  same-purpose file. This repo already has four overlapping "execution engine"
  implementations from past incremental work — do not create a fifth without an
  explicit decision that the existing four are insufficient.
- Prefer extending an existing service/route/component over creating a
  parallel one with a similar name, even if the existing one looks messy —
  flag the mess instead of duplicating around it.

## 17. Rules Preventing Fake/Illustrative Data From Being Presented as Live

- Several past audit reports in this repo (per `reports/` naming, e.g.
  "fake-success," "false-zeros," "synthetic-data-disclosure" entries) found and
  fixed cases where the UI displayed placeholder/mock data as if it were real.
  Do not introduce new mock/placeholder data in any component or route without
  clearly labeling it as such in the UI and code.
- When implementing a feature that doesn't yet have a real backend data source,
  say so explicitly rather than wiring in hardcoded example values that look
  real.

## 18. Rules Preventing Silent Failure / False Success

- This repo's own audit history repeatedly found UI code that swallowed errors
  silently (empty `catch` blocks, missing error branches) and backend flows
  that returned success before completing the actual operation (e.g. issuing a
  session before MFA was verified). Both are treated as genuine defects here,
  not style issues.
- Any new async operation must surface failure to the user/caller — no empty
  `catch {}` blocks, no returning `{success: true}` before the operation it
  describes has actually completed.
- Frontend must never indicate a completed/authenticated/successful state
  before the backend has actually confirmed it.

## 19. Git Safety Rules

- Never commit, push, or merge unless explicitly asked in that specific
  request. Prior authorization does not carry forward to future turns.
- Always create new commits rather than amending, unless explicitly asked to
  amend.
- Never use `--no-verify`, `--force` (without explicit request), or other
  safety-bypassing flags.
- Run `git status`/`git diff` before any command that could discard
  uncommitted work.

## 20. .env/Credential Safety Rules

- Never read, print, modify, or copy the contents of `.env`, `.env.production*`,
  or any credential/vault file as a side effect of unrelated work.
- Never rotate credentials.
- If understanding *why* code behaves a certain way requires knowing whether an
  env var is set, check for its presence only (e.g. via `grep -c` or existence
  check), never print its value.

## 21. PM2/Runtime Restart Rules

- Restart the backend only via `pm2 restart jarvis-os` (or the equivalent
  documented in `ecosystem.config.cjs`), never via a bare `node backend/server.js`
  invocation while PM2 is active.
- After any change requiring a restart, verify health via the existing
  `/health` endpoint before considering the change complete.
- Do not modify `ecosystem.config.cjs`'s app list or memory-restart thresholds
  without being explicitly asked — its current values reflect a real, documented
  past OOM incident.

## 22. Definition of Done for Production Changes

A change is done only when, at minimum:
1. The specific defect/feature is proven (before) and re-verified (after) —
   not assumed from reading code alone where live verification is safely
   possible.
2. The fix follows an existing pattern already used elsewhere in the same file
   family (see §16) rather than introducing a new one.
3. The relevant real test corpus (§9) has been run and its result reported
   honestly, including any pre-existing/unrelated failures kept separate from
   the change's own evaluation.
4. `.env`/credentials/git push state are exactly as they were before, unless
   explicitly authorized otherwise.
5. Any new defect discovered outside the requested scope is reported, not
   silently fixed or silently ignored.
