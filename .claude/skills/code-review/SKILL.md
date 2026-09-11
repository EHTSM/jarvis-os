---
name: code-review
description: Multi-angle, confidence-scored review of a diff or PR for correctness bugs, security issues, and reuse/simplification opportunities. Use when reviewing changes to backend/routes, backend/services, agents/runtime, or frontend components before considering them done. Adapted from Anthropic's official code-review plugin pattern (anthropics/claude-plugins-official, Apache-2.0) for this repository's conventions.
metadata:
  source: "adapted from anthropics/claude-plugins-official (code-review plugin)"
  license-note: "Instructional pattern only; no vendor code copied. Original is Apache-2.0."
---

# Code Review (JARVIS-adapted)

Review the current diff (or a named PR/branch) for genuine defects and clear
simplification opportunities, at a confidence level matched to the size of the
change. This does not replace a full audit mission (see CLAUDE.md §14) — it is
a lighter-weight pass for day-to-day changes.

## When to use this

- Before marking any backend/frontend change "done" per CLAUDE.md §22's
  Definition of Done.
- After adding or modifying a route in `backend/routes/index.js` or its target
  router file — pair with a check against sibling routes' middleware (CLAUDE.md
  §6/§10; also see the `security-threat-model` skill for a deeper pass).
- After modifying `backend/services/*.cjs` or `agents/runtime/*.cjs` files.
- After modifying frontend components under `frontend/src/components/`.

## What to check, in priority order

1. **Correctness bugs** — logic errors, off-by-one, incorrect async handling,
   unhandled promise rejections, race conditions in the runtime dispatch chain
   (`agents/runtime/executionEngine.cjs`, `agentRegistry.cjs`).
2. **Silent failure / false success** — per CLAUDE.md §18, check for empty
   `catch {}` blocks and any code path that could report success before an
   operation actually completes. This is JARVIS's own most-repeated defect
   class in the frontend track.
3. **Auth/tenant-scoping consistency** — per CLAUDE.md §6, any new/modified
   route must be diffed against its sibling routes' middleware stack. This is
   JARVIS's own most-repeated defect class in the backend track.
4. **Fake/placeholder data presented as live** — per CLAUDE.md §17, flag any
   new hardcoded example value in a UI component that isn't clearly labeled
   as illustrative.
5. **Duplicate architecture** — per CLAUDE.md §16, check whether the change
   introduces a new engine/service/pattern that duplicates something already
   in `backend/services/` or `agents/runtime/` before approving it.
6. **Reuse/simplification** — unnecessary abstraction, dead code, or a new
   convention introduced where an existing one (see CLAUDE.md §11/§12) should
   have been followed instead.

## Output format

For each finding: file:line, a one-sentence description of the defect, and a
concrete before/after suggestion. Rank most-severe first. State confidence
(CONFIRMED — traced and verifiable from the diff alone; PLAUSIBLE — likely but
would need live verification to confirm) per finding, matching this repo's own
audit-mission confidence-labeling convention (CLAUDE.md §14).

## What this must never do

- Never approve a change solely because it "looks fine" without checking the
  specific items above — generic praise is not a review.
- Never fix findings automatically as part of a review pass unless explicitly
  asked to — report first, fix only when asked (matches CLAUDE.md §19's
  standing-authorization rule: review authority does not imply edit authority).
- Never expand scope into unrelated files — review only the actual diff/PR in
  question, consistent with CLAUDE.md §14's "stop after the scoped mission"
  principle.
