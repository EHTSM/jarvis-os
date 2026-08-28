# 21 — Testing Strategy (Phase 11)

## Headline finding: CLAUDE.md §9 is itself stale

CLAUDE.md §9 claims `npm run test:runtime` runs "10 specifically named files"
and CI's gate does `grep -E "pass 144"`. Both are **false as of current HEAD**,
confirmed by full reads of `.github/workflows/ci.yml` (354 lines) and
`scripts/run-test-suite.cjs` (161 lines):

- `test:runtime` = `node scripts/run-test-suite.cjs runtime`, which discovers
  **all** `tests/runtime/*.test.cjs` files at the top level (114 of them at
  audit time; 2 more exist under `tests/runtime/stream/` but are **not** picked
  up by the non-recursive glob — a separate, smaller finding, see below) and
  runs them via `node --test`, splitting 11 known shared-store writers into a
  serialized batch (`--test-concurrency=1`) to avoid a documented lost-update
  race, with the rest running in parallel.
- `test:security` = `node scripts/run-test-suite.cjs security`, discovering all
  `tests/security/*.cjs` files matching `/^\d/` (121 at audit time), same
  split pattern (9 files serialized).
- **No `grep -E "pass 144"` exists anywhere in `ci.yml`** (confirmed by full
  file read, not just a targeted grep). The actual gate is outcome-based: an
  "Enforce regression/security gate" step checks
  `steps.run_regression.outcome`/`steps.run_security.outcome` independently and
  fails the job if either suite's real exit code was non-success. This
  replacement is itself documented in-file as a "Mission 63" fix for a real
  incident: a prior CI run showed "Run security suite: skipped" because a
  runtime failure short-circuited the job under GitHub Actions' default
  behavior.

This drift is reported per this mission's Phase 17 rule and CLAUDE.md §9's own
instruction not to silently correct it.

## Real test corpus — exact current counts

| Directory | Files on disk | Git-tracked | Notes |
|---|---|---|---|
| `tests/runtime/` | 116 | mostly tracked | 114 top-level `.test.cjs` (all picked up by `test:runtime`) + 2 under `stream/` (`reconnectRecovery.test.cjs`, `streamStress.test.cjs`) **not** picked up by the current non-recursive glob — a real, small coverage gap in the invocation, not the file's existence |
| `tests/security/` | 121 | tracked | 117 numbered files matched by the suite glob + 4 deliberately-excluded scratch driver files (`.gitignore`'s own documented exclusion) |
| `tests/legacy/` | 74 | 1 of 74 tracked (`.removed` sentinel only) | 73 of 74 files are git-invisible |
| `tests/integration/` | 15 | 1 of 15 tracked | 14 git-invisible |
| `tests/stress/` | 14 | 5 tracked | 9 untracked files never committed at all (`git log --all` empty) — confirmed local-only scratch, not referenced by any `package.json` script, so no CI coverage gap results |
| `tests/burnin/` | 14 | 11 tracked | 3 untracked are `.md` report outputs, correctly excluded |
| `tests/workflows/` | 10 | all 10 tracked | — |
| `tests/smoke/` | 9 | 3 tracked | 6 git-invisible |
| `tests/operator/` | 4 | all tracked | — |
| `tests/stability/` | 2 | 0 tracked | both git-invisible |
| `tests/evaluation/` | 2 | all tracked | — |
| `tests/chaos/` | 1 | 0 tracked | git-invisible |
| `tests/profiling/` | 1 | 0 tracked | git-invisible |
| **Total** | **384** (incl. 1 `.DS_Store`) | **270** (`git ls-files tests/`) | |

This further updates CLAUDE.md §9's own numbers (already-acknowledged as
subject to drift): current runtime=116 (not 115), security=121 (not 116),
legacy=74 (matches), total=384 (not 373).

## A real, previously-undocumented disaster-recovery risk

`.gitignore` (self-dated "Mission 61") deliberately narrows a formerly-blanket
`tests/` ignore rule to exclude only `tests/runtime/` and `tests/security/`
(the two suites CI actually runs) from ignoring — its own comment states this
fixed a real prior defect where the blanket rule hid 77 legitimate
certification files from git/CI entirely. But because git ignore rules are not
retroactive, the emergent state today is that **`tests/legacy/` (73 of 74),
`tests/integration/` (14 of 15), and `tests/smoke/` (6 of 9) are majority
git-invisible** — most of this repo's own test corpus in those 3 categories
exists only on whichever local machine currently holds the working tree, with
zero git history to recover from if that machine were lost. This is not
currently a CI failure (CI never asks for these files), but it is a real
continuity risk distinct from the backup question in `19_INFRASTRUCTURE.md`,
not previously named in any located report.

## Test isolation / shared-state race handling

`scripts/run-test-suite.cjs`'s `MISSION_MUTATING` lists (11 runtime + 9
security files) were spot-checked for completeness against the three named
shared stores (`data/missions.json`, `data/organizations.json`,
`data/biz-leads.json`+siblings) by grepping every other file in both suites for
the same mutating service calls. **No gap found** — the lists are exhaustive
against those three stores as of this audit (does not rule out a similarly-shaped
race against a different, unchecked shared store, e.g. `data/vault.json`).

## False-green/red risk audit

All `continue-on-error` usages in `ci.yml` were read and traced:
1. `npm audit` — intentionally non-blocking (standard practice).
2. `run_regression`/`run_security` steps — the exact pair Mission 63
   re-engineered to prevent false-green; the enforcement step remains present
   and correctly ordered. No regression of that fix found.
3. `deploy/validate-production.sh || true` — intentionally, permanently
   warn-only, and correctly excluded from `ci-pass`'s required-checks list.

**No false-green risk found; the one historically-fixed instance remains
fixed.**

## Playwright/E2E — real, but structurally non-standard

Genuine headless-Chromium automation exists across dozens of
`tests/security/*.cjs` files (real `chromium.launch()`/`page.goto()` calls
verifying UX consistency, fake-data disclosure, cross-browser/offline guards).
`ci.yml` installs Chromium specifically for these. However, there is no
`playwright.config.*`, no `@playwright/test`-based spec files, and no `e2e/`
directory — this is the raw `playwright` library used manually inside
`node --test` custom-runner files, not the standard Playwright Test framework
convention. Real, not scaffold, but a future maintainer searching for "the E2E
suite" via the standard convention would not find it.

## Mobile CI test job

`build-mobile` genuinely runs `npm test --prefix mobile -- --watchAll=false`
(real Jest) against 4 real test files, including
`BottomNav.roleGating.test.jsx` (role-gating, security-relevant) and
`Dashboard.forbidden.test.jsx` — not merely a build-verification step, though
it also does that separately with correctly-labeled CI-placeholder Firebase
env vars.

## Summary

| Item | Classification |
|---|---|
| CLAUDE.md §9's "10 files"/"pass 144" claim | STALE DOCUMENTATION, fully superseded |
| Current test corpus counts | 384 total files, 270 git-tracked; further drifted from CLAUDE.md's already-acknowledged-stale numbers |
| `tests/runtime/stream/`'s 2 files | NOT covered by `test:runtime`'s current glob — small real gap |
| `tests/legacy/integration/smoke` majority git-invisible | Real, previously unnamed continuity risk |
| `MISSION_MUTATING` race-avoidance lists | CODE COMPLETE, exhaustive against 3 named stores on this audit's spot-check |
| CI false-green risk | None found; Mission 63 fix intact |
| Playwright/E2E | CODE COMPLETE, real, non-standard structure |
| Mobile CI test job | CODE COMPLETE, real tests + build check |
