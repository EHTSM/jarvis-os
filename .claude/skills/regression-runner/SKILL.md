---
name: regression-runner
description: Run and honestly interpret JARVIS's actual regression/test corpus — backend node --test suites (runtime/security/legacy), frontend Jest tests, and the frontend build — correctly distinguishing the real test corpus from the stale npm/CI "144" claim. Use when asked to run tests, run the regression suite, verify nothing broke, or interpret a test failure. Repo-native, adapted from patterns studied in the Phase B multi-vendor skills audit (no single vendor skill covers this domain directly).
metadata:
  source: "repo-native — no direct vendor equivalent found in Phase B's audit; informed by general CI/regression-review patterns studied there (e.g. OpenAI's gh-fix-ci), not copied from any single skill"
  gap-closed: "Phase C validation (Part C, Scenario 3) found no installed skill matched 'run and interpret the repository's canonical regression validation' — this skill closes that confirmed gap"
  distinct-from: "gh-fix-ci (diagnoses a failing CI *run* using gh CLI/logs); this skill runs and interprets tests directly in the local working tree, with or without CI involved"
---

# Regression Runner & Interpreter (JARVIS-native)

Run the real, current JARVIS test corpus — not the stale, narrower
`npm run test:runtime` script — and interpret results honestly, distinguishing
genuine regressions from pre-existing/flaky/environment-caused failures with
evidence, never by assumption.

## When to use this

- The user asks to "run the tests," "run the regression suite," or "verify
  nothing broke" after a change.
- The user asks to interpret a specific test failure.
- As the verification step in CLAUDE.md §22's Definition of Done, or as the
  final regression check in an audit mission (CLAUDE.md §14).

## The corpus — know this before running anything (CLAUDE.md §9)

- `package.json`'s `test:runtime` script is **hardcoded to only 10 named
  files**. It is not the full corpus. Do not present its result as "the
  regression suite passed" without qualifying that it's the narrow CI-scoped
  subset.
- The real corpus, as of this repo's current state (re-verify the exact count
  live — file counts drift as the repo grows; do not trust a cached number
  from a prior report):
  - `tests/runtime/*.test.cjs` — backend runtime suite (113 files as of the
    last live count; confirm with `ls tests/runtime/*.test.cjs | wc -l`)
  - `tests/security/*.cjs` — security/tenant-isolation suite (116 files as of
    the last live count)
  - `tests/legacy/*.test.cjs` — older suite, still real (73 files as of the
    last live count)
  - `tests/stress/`, `tests/burnin/`, `tests/integration/`, `tests/workflows/`,
    `tests/smoke/`, `tests/operator/`, `tests/stability/`, `tests/evaluation/`,
    `tests/chaos/`, `tests/profiling/` — smaller specialized suites, not part
    of routine regression unless specifically relevant to the change.
- `README.md` and `.github/workflows/ci.yml` both still claim/enforce
  "144/144" — this is stale and does not reflect the real corpus size. Do not
  silently correct this claim in either file; just don't trust it as the
  definition of "the regression suite."
- Test runner: Node's built-in `node --test`, not Jest, for all backend
  suites. Frontend uses CRA/Jest (`react-scripts test`).

## How to run

- **Narrow/CI-scoped only** (matches what CI actually checks today):
  `npm run test:runtime`
- **Full backend runtime corpus:**
  `node --test tests/runtime/*.test.cjs`
- **Full security/tenant-isolation corpus:**
  `node --test tests/security/*.cjs`
- **Frontend tests (non-interactive):**
  `cd frontend && npm run test:ci` (or `CI=true react-scripts test --watchAll=false`)
- **Frontend build (verification, not a test, but part of Definition of
  Done per CLAUDE.md §22):** `npm run build:frontend`

Always state up front, before running anything, which of these you are about
to run and why — e.g., "running the full runtime corpus, not the CI-scoped
10-file script, because the change touched files outside the CI script's
coverage."

## Interpreting results — do this before concluding anything

1. **Read the actual `node --test` summary** (`pass`/`fail`/`cancelled`
   counts) — do not infer pass/fail from exit code alone; `node --test` can
   exit non-zero for reasons unrelated to test content (e.g. a syntax error
   in one file aborting the run).
2. **For any failure, read the actual failure output** (assertion message,
   stack trace) before classifying it as anything.
3. **Never classify a failure as "pre-existing" or "flaky" without evidence.**
   Acceptable evidence: (a) the failing file is unrelated to any file touched
   in the current change (confirm via `git diff --stat` or equivalent, not
   assumption), AND (b) either a prior report in `reports/` already documents
   this exact failure as pre-existing, or a clean re-run of just that file in
   isolation shows inconsistent results (a real flakiness signature). Absent
   both, treat the failure as a genuine, unexplained regression and say so.
4. **Never suppress, skip, or comment out a failing test to make a run "pass."**
   If a failure is real, report it; if it needs to be fixed, that is a
   separate, explicitly-authorized step, and the fix must follow CLAUDE.md
   §14's negative-testing discipline (revert → reproduce → restore →
   reconfirm) — not a source-code change made "because the test failed."
5. **Baseline comparison.** When asked to verify a specific change didn't
   break anything, run the relevant suite both conceptually before/after (or
   compare against the most recent clean run already on record in `reports/`
   if re-running the full "before" state isn't practical) and report the
   actual before/after numbers — not just "still passes."

## What this must NEVER do

- **Never blindly trust `npm run test:runtime`'s pass count or the "144"
  badge/CI-gate claim as the definition of "the regression suite passed."**
- **Never rewrite or loosen a test's assertions merely to make it pass.**
- **Never suppress a failure** (skip, `.only` on unrelated tests, deleting
  the failing assertion, catching and swallowing a test-runner error).
- **Never classify an unexplained failure as "pre-existing" or "flaky"
  without the specific evidence described above** — an assumption is not
  evidence.
- **Never modify source code just because a test fails.** Report the failure
  and its likely cause; changing code to fix it is a separate step requiring
  the same scrutiny as any other fix (CLAUDE.md §14/§22), never an automatic
  reflex of this skill.
