# MASTER FINAL GAP CLOSURE — PLAN

Date: 2026-08-15 · Branch: `security/reality-completion`
Source of truth: `reports/MASTER-OPEN-FINDINGS.md` (as it stood after Master Residual Closure)

---

## Method

Read `MASTER-OPEN-FINDINGS.md`, `MASTER-RESIDUAL-CLOSURE-FINAL.md`, `MASTER-RESIDUAL-CLOSURE-PLAN.md`,
`MASTER-RESIDUAL-CLOSURE-PROGRESS.md`, `MASTER-RESIDUAL-CLOSURE-SECURITY.md`,
`MASTER-RESIDUAL-CLOSURE-CROSS-OS.md`, `OS-PRODUCT-FINAL.md`, `OS-REGISTER.md` in full before any
change, per the mission's explicit instruction. No new findings list invented — every action below
traces to an existing ID.

## Important discovery mid-plan: a concurrent same-day pass

While reading the authoritative sources, found `reports/FINAL-V1-GAP-CLOSURE.md` — a same-day,
same-mission pass by the parallel Audit Track session (timestamped after my own Master Residual
Closure work), which reconciled the same remaining items via **reclassification only, no code
changes**. That pass:
- Correctly found **C10-009 already fixed** (by my own Master Residual Closure phase, which its own
  earlier Ecosystem OS snapshot had predated) — re-verified, no further action needed, consistent
  with my own record.
- Correctly diagnosed **C10-007's real shape**: `manual` and `schedule` triggers already worked
  (the `schedule` dispatcher, `orgAutomationScheduler.cjs`, was built by a *different* concurrent
  pass — the Ecosystem OS pass — some time after my Master Residual Closure phase but before this
  Final Gap Closure phase). It reclassified the remaining 4 non-dispatched trigger types
  (event/threshold/webhook/approval) as POST-V1/FOUNDER DECISION **without building any of them**.
- Left **C10-012 (Support OS frontend) and C10-026 (Enterprise CRM frontend) both unbuilt**,
  reasoning that C10-012's honest disclosure banner already satisfies the failure-honesty
  requirement, and that C10-026 wasn't named in that pass's specific investigation scope.
- Left **C10-008 (deleteRule/fire route) and C10-028 (Sentry wiring) both unbuilt**, same reasoning.

## Revised plan for this phase

Rather than duplicate that reconciliation work (already correctly done, no need to re-litigate),
this phase's plan is:

1. **Independently re-verify** the Product OS tenant-isolation fix and the customer-org forged-header
   fix with my own live two-tenant tests, not merely citing another report — per the mission's
   explicit "prove every closure with live evidence" discipline. (Found and fixed a real
   stale-server-process issue in the process — the running server was serving pre-fix code.)
2. **Go further than the concurrent pass on the items it left unbuilt but which are genuinely safe
   to close**, since this mission's Section 2 instructs executing every FIX NOW / BUILD NOW / VERIFY
   NOW item where safely possible, not merely reclassifying:
   - **C10-007's `event` trigger type**: the one of the 4 remaining types with an existing, reusable
     primitive (`runtimeEventBus.subscribe()`, already used platform-wide) — built it.
   - **C10-008**: `deleteRule` + manual `/fire` route — small, well-scoped, no dependency on the
     product decision blocking threshold/webhook/approval.
   - **C10-012**: Support OS frontend — same proven pattern as C10-009's fix, real backend already
     hardened and available.
   - **C10-028**: Sentry code-level wiring — does not require the DSN credential to implement
     correctly, only to verify end-to-end delivery (which remains honestly unverifiable and is
     disclosed as such).
   - **C10-026**: investigated rather than built — found genuinely different from C10-009/C10-012
     (a fully orphaned, unreachable component with a real, already-working replacement already
     serving the same function) — building it would violate the "never duplicate architecture"
     constraint, so reclassified instead of built.
3. **Leave every item the concurrent pass correctly identified as a genuine product/founder decision
   untouched** (C10-004b, C10-005, C10-006 evidence refreshed, C10-010, C10-017b, C10-024,
   threshold/webhook/approval trigger semantics) — no unilateral architecture invented.
4. **Reconcile the authoritative table** so it reflects the more complete picture (my additional
   fixes layered on top of the concurrent pass's correct reclassifications), without rewriting any
   historical row.

## Concurrency safety

- Port 5050 (shared dev/test server): PID-exact restarts only, 3 restarts this phase, each verified
  via `lsof` before touching, each followed by a health/regression re-check.
- Confirmed via `git status`/`git diff` before every edit that no file this phase touched was also
  mid-edit by the concurrent session at the moment of editing.
- No blanket process kills. No action targeting a PID not confirmed via `lsof` to be the exact
  server this session itself needed to restart.
