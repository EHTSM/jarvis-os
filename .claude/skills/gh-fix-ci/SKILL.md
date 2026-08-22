---
name: gh-fix-ci
description: Diagnose why a GitHub Actions CI run failed on this repo, using gh CLI to pull real logs, before proposing any fix. Use when the user reports a failing CI check or asks why a build/regression run failed. Adapted from OpenAI's gh-fix-ci skill (openai/skills, Apache-2.0). Plan-then-approve only — never writes a fix without explicit approval.
metadata:
  source: "adapted from openai/skills (gh-fix-ci)"
  license-note: "Instructional pattern only; no vendor script copied. Original is Apache-2.0."
  requires: "gh CLI, authenticated (already used elsewhere in this repo's audit history via gh api)"
---

# CI Failure Diagnosis (JARVIS-adapted)

Diagnose failing checks in `.github/workflows/ci.yml` or `release.yml` using
real log data, not guessing from the workflow file alone.

## When to use this

- The user reports a CI failure, a red check on a PR, or asks "why did CI
  fail."
- Before proposing any fix to CI configuration or the code a failing check
  covers.

## Known repo-specific context (read CLAUDE.md §9 first)

- The `regression` job in `ci.yml` runs `npm run test:runtime`, which is
  **hardcoded to only 10 files** in `tests/runtime/`, not the full 115-file
  corpus. Its own verification step does `grep -E "pass 144"` against that
  narrow output. If a CI failure is in this job, check first whether the
  failure is a genuine regression in one of the 10 named files, or a symptom
  of the stale 144-count gate itself (e.g. a legitimately-added test changed
  the pass count without the grep being updated) — these require different
  fixes and CLAUDE.md §9 says not to silently correct the drift without
  flagging it to the user.
- The `audit` job runs `npm audit --audit-level=high` with `continue-on-error:
  true` — an audit failure here does not fail the pipeline; do not treat a red
  `npm audit` step as a blocking CI failure without checking whether it
  actually gated the job.

## Diagnosis steps

1. Pull the actual failing run's logs (`gh run view --log-failed` or
   equivalent) — never diagnose from the workflow YAML alone.
2. Identify which job and step failed, and the exact error output.
3. Determine whether the failure is: (a) a genuine code regression, (b) an
   environment/dependency issue (e.g. a CI-only env var like
   `OPERATOR_PASSWORD_HASH`/`GROQ_API_KEY` missing from secrets), (c) a
   flaky/pre-existing failure unrelated to recent changes (per this repo's own
   audit history, some backend tests are known to be flaky under concurrent
   load — check whether a solo re-run passes before assuming a real
   regression), or (d) the stale-144-count symptom described above.
4. Only after classifying the failure, propose a fix — and only apply it after
   explicit user approval, per CLAUDE.md §19's git-safety rules. This skill
   never commits or pushes on its own.

## What this must never do

- Never write or commit a fix without explicit user approval first — matches
  CLAUDE.md §19 exactly (this repo's `commit-commands`-style autonomous git
  behavior was explicitly rejected during Phase B classification for this
  reason).
- Never silently "fix" the CI script's stale 144-file scope or its `grep`
  target as a side effect of fixing an unrelated failure — surface it
  separately, per CLAUDE.md §9.
- Never push to `main` or any protected branch, and never use `--no-verify`
  or force-push to resolve a failing check.
