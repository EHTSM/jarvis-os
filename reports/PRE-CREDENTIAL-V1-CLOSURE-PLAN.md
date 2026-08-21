# PRE-CREDENTIAL V1 PERFECTION — Plan

**Date:** 2026-08-15 · **Branch:** `security/reality-completion` · **Verification port:** 5233
**Track:** Final internal perfection pass before credential provisioning. Not a new audit, not C.11,
not a new OS, not V6/V7 architecture.

---

## Method

1. Re-open `reports/MASTER-OPEN-FINDINGS.md` (the one authoritative table) plus
   `reports/FINAL-V1-GAP-CLOSURE.md`, `reports/MASTER-RESIDUAL-CLOSURE-FINAL.md`,
   `reports/MASTER-RECOVERY-FINAL.md`, and `reports/OS-REGISTER.md` as ground truth — never
   trust a report's own "fixed" claim without re-reading current source and, where feasible,
   live-reproducing.
2. **First priority: C10-026 (Enterprise CRM frontend).** Investigate whether it is a genuine
   wiring gap (like C10-009 was) or something structurally different, before assuming the same
   fix pattern applies.
3. **Second priority:** work every remaining open item in `MASTER-OPEN-FINDINGS.md`, classifying
   each into exactly one of the mission's 7 buckets (A. V1 required + recoverable → fix now;
   B. V1 required + build required → build now if safe; C. credential dependency; D. founder
   decision; E. post-V1; F. out of scope; G. already fixed → live re-verify).
4. Live-verify every security-sensitive claim with two real orgs and real secret-labeled data —
   never empty-vs-empty.
5. Re-check the mission's 12 named security priorities explicitly, not just the items that
   happen to already have open register rows.
6. Full regression before declaring done: `npm run test:runtime`, relevant security suites,
   production build.

## Known state entering this phase (from authoritative sources)

- P0: 0. Exploitable P1: 0 (established across C.10 → Master Recovery → Master Residual Closure
  → Final Gap Closure, re-confirmed each time via live two-tenant testing, not re-derived here).
- A **concurrent Audit Track session** is working the same authoritative table in parallel this
  same day — `MASTER-OPEN-FINDINGS.md` was found mid-edit more than once during this phase; each
  time, the file was re-read fresh immediately before any edit to avoid clobbering concurrent
  work, per the harness's own conflict detection.
- C10-007 (Automation execution loop) and C10-012 (Support OS frontend) were, at various points
  during this same day, independently touched by both this pass and the concurrent pass — see
  Progress report for exactly how each was reconciled without duplicate or contradictory work.

## What this plan explicitly rules out

- No self-serve external provider credentials added or requested (`.env` read-only this phase).
- No new automation scheduler, event bus, memory store, or runtime — every fix reuses an existing,
  already-proven primitive (`runtimeEventBus`, `attachOrg`/`requireOrgMember`, existing service
  file patterns).
- No blind wiring of a dead frontend component just because a live backend exists for it — C10-026
  is investigated on its own merits (see Progress report) rather than assumed to be "C10-009 again."
- No irreversible action without stating it first: process starts/stops are exact-PID only, `.env`
  is read-only, no merge/push.

## Server safety

Isolated port 5233 for all live testing this phase. Port 5050 (Audit Track) checked before every
process action and confirmed healthy throughout — never targeted by this session's stop/start
commands. No blanket `pkill`/`killall` used at any point.
