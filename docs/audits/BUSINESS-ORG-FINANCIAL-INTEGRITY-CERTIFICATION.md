# BUSINESS ORG FINANCIAL INTEGRITY CERTIFICATION

Date: 2026-08-04
Scope: Every financial mutation owned by Business Organization (`backend/services/businessOrgState.cjs`, `businessOrgWorkflow.cjs`, `businessOrg.cjs`) — `advanceDeal()`, MRR, ARR, Revenue, Forecast, Pipeline, Deals, Invoices, Subscriptions, Renewals, Cancellations, Win Rate, Lost Deals, Customer Value. Checked for duplicate revenue, missing decrement, overflow, NaN, Infinity, recursive accumulation, replayed events, webhook retries, double processing, stale cache, duplicate aggregation.
Commits: `a622d316`, `ebc343fc`, `6b8df784`, `02b47c99` on `security/reality-completion`. No merge, no push.

This is the direct follow-up to the prior [Executive OS Numeric Integrity Certification](./EXECUTIVE-OS-NUMERIC-INTEGRITY-CERTIFICATION.md), which traced an astronomical MRR overflow to Business Org and explicitly deferred the fix to this mission.

---

## Method

Every financial mutation site in Business Org's 3 core service files was traced to its origin and read in full surrounding context. Each suspected bug was reproduced live against the real, running `data/bizorg/*.json` state via direct function calls — not assumed from reading code alone — with before/after values captured. All test mutations were precisely reverted afterward (verified via `git status --short data/`, which is gitignored and tracks nothing, so cleanliness was confirmed by direct value inspection instead).

## Verified Mutations (correct, no fix needed)

- **Budget-style deal value accumulation** (`createDeal`, `getPipelineStats`): deal values are summed directly from the live `deals` array on every read, not from a separately-maintained running total — no accumulator drift possible.
- **`salesAdvanceDeal()`** (`businessOrgWorkflow.cjs`): already correctly propagates `if (!r.ok) return r;` from `advanceDeal()` before applying any of its own side effects — once fix #1 (below) made `advanceDeal()` idempotent, this call site transitively inherited that protection with no separate change needed.
- **`runDealPipeline()`**: re-reads the deal's current stage from state before each pipeline step rather than trusting a stale local variable — confirmed safe against re-invocation on an already-closed deal.
- **`_salesTick()`**: reads its `qualified`/`demo`/`proposal` arrays once per tick (JS array snapshot semantics) — confirmed no within-tick double-processing of the same deal.
- **`_ceoTick()`**: reads revenue only to set a one-time quarterly target, correctly guarded by `if (existing.length === 0)` — no accumulation risk.
- **`revenueOS.cjs`'s MRR** (a separate, legitimate subscription-billing system billing real accounts, architecturally distinct from Business Org's deal-pipeline MRR): recomputed fresh from `data/billing.json` account state on every single call (`byPlan[p].mrr += _mrr(p,1)` inside `getRevenueDashboard()`) — a stateless recalculation, not a persisted accumulator. This is *why* cancellation correctly "reverses" here with no explicit decrement needed: a cancelled account simply stops contributing to the next recomputation. Confirmed no feedback loop into `businessOrgState.cjs`'s own KPIs from any of its 3 real call sites.
- **`revenueOS.cjs`'s subscription lifecycle** (`upgradeSubscription`, `pauseSubscription`, `reactivateSubscription`, `cancelSubscription`): each correctly logs an immutable lifecycle event with a correctly-signed `mrrDelta` (`_mrr(targetPlan,1) - _mrr(current.plan,1)`, negative on downgrade/cancel) — real, working subscription mutation tracking, separate from and not duplicating Business Org's own model.

## Fixed Mutations

**Fix #1 — Missing idempotency guard in `advanceDeal()`** (`businessOrgState.cjs`, commit `a622d316`).
No check of a deal's current stage before applying `closed_won`/`closed_lost` side effects (mrr increment, dealsWon++, dealValueWon +=). Root-caused to a real race: `businessOrg.cjs`'s interval-polling `_salesTick` and `businessOrgWorkflow.cjs`'s event-driven `setTimeout` chain can both independently advance the same deal. Fixed with a `TERMINAL_STAGES` guard rejecting any further transition once a deal reaches `closed_won`/`closed_lost`. Verified live: two consecutive `closed_won` calls on the same deal now produce `{ok:true}` then `{ok:false, nonRetriable:true}`, with mrr delta exactly 1x, not 2x.

**Fix #2 — Duplicate MRR accumulation across two independent accumulators** (`businessOrgWorkflow.cjs`, commit `ebc343fc`).
`advanceDeal()` incremented the deal's own department's `mrr`, while `billingProcessPayment()` — triggered by the same `closed_won` event via `bizorg:deal:won` — independently incremented a separate `bizorg_billing.mrr` for the identical deal. Confirmed live: a $12,000 deal added $1,000 to *two* KPIs, reporting $2,000 instead of $1,000, since `getDashboard()` summed both. Fixed by removing the redundant accumulator (confirmed via search that nothing else read `bizorg_billing.mrr` as an independent metric). Downstream display (`_billingTick`'s `s.v2Billing`) switched to read the real, correct `getDashboard().revenue.mrr`.

**Fix #3 — Recursive self-accumulation in `revenueOpsUpdate()`** (`businessOrgWorkflow.cjs`, commit `6b8df784`) — the dominant real-world bug.
Called every 240s forever by `_revopsTick`, this summed *all* department KPIs' `mrr` — including `bizorg_revops`'s own — and wrote the sum back into `bizorg_revops.mrr`. Each tick's output became the next tick's input: unbounded growth with zero real business activity required. Confirmed live: 3 consecutive calls with no deals created between them produced `7.677e+258 → 1.059e+259 → 1.351e+259`. Fixed by introducing `MRR_REPORTING_DEPTS` (departments that report/aggregate MRR but never originate deals themselves) and excluding them from `getDashboard()`'s own sum, then having `revenueOpsUpdate()` reuse that single corrected total instead of its own diverging reduce. Verified live: 3 consecutive post-fix calls all produced the identical `2.915829714793518e+258` — stable.

**Fix #4 — Second independent instance of the identical recursive bug, in `_financeTick()`** (`businessOrg.cjs` + `businessOrgState.cjs`, commit `02b47c99`).
Self-ticking every 300s forever, `_financeTick` had the exact same flaw as fix #3: a raw `kpis.reduce(...)` including `bizorg_finance`'s own KPI, written back into itself. Confirmed live: one simulated tick doubled `bizorg_finance.mrr` from `2.915829714793518e+258` to `5.831659429587036e+258`. Reverted immediately, then fixed by reusing `getDashboard()`'s corrected total (same pattern as fix #3) and adding `"bizorg_finance"` to `MRR_REPORTING_DEPTS`. Verified live: two consecutive simulated ticks both produced the identical, dashboard-derived value — stable, no recursion.

All four fixes share one root class: **no idempotency guard against replay (fix #1), no single source of truth for a derived total (fixes #2–4)**. All four were fixed by either guarding the mutation or consolidating onto the one already-correct computation (`getDashboard()`), never by inventing new accounting.

## False Positives

- **`_csTick`'s onboarding logic**: initially suspected of possible duplicate task creation across ticks; traced the `alreadyOnboarded` status check and confirmed it correctly dedupes. Not a bug.
- **`_marketingTick`'s campaign-launch loop**: suspected (during the prior Executive OS session, re-confirmed here) of possibly double-launching campaigns across its 180s interval; confirmed campaign state transitions are synchronous and cannot be re-read as `planned` within the same tick. Not a bug.
- **`upgradeSubscription` doc-comment reference** (`businessOrgWorkflow.cjs:33`): the file header claims this function is reused from `revenueOS`, but no call site for it exists anywhere in the file body — a stale/inaccurate comment, not a functional bug (nothing is actually double-invoked or broken). Left as-is since correcting a comment is documentation, not a financial-integrity fix, and touching it risks no functional change either way.

## Remaining Financial Risks

1. **Pre-existing corrupted historical MRR total remains frozen, not reset.** After all 4 fixes, the historical value (`~2.915829714793518e+258` across `bizorg_revops`/`bizorg_billing`/`bizorg_finance`) is stable and will no longer grow from these bugs — but it is not itself corrected, per the mission's explicit "never invent new accounting" instruction. At this magnitude, float64 precision loss means further real business activity (values in the $10²–10⁵ range) is completely unmeasurable against it — the number is effectively inert but still wrong. **Requires an explicit human operator decision**: reset the KPI baseline to a real value (e.g. re-derive from the live `deals` array, which is itself uncorrupted) or accept it as permanent historical drift. This is a data decision, not a code decision, and is deliberately left to the operator.
2. **No cancellation/refund/downgrade reversal path exists anywhere in Business Org's own pipeline model.** `PIPELINE_STAGES` has no stage after `closed_won` other than nothing — once a deal is won, Business Org has no mechanism to reduce `mrr`/`dealValueWon` if that customer later cancels or downgrades. This is consistent with fix #1's root cause (no idempotency guard existed because no reverse-transition concept existed at all). This is a real completeness gap, not a bug introduced by any code — building a genuine churn/cancellation pipeline would be new capability, which is out of this mission's scope ("never redesign Business Org").
3. **No invoice-generation logic exists anywhere in Business Org.** Confirmed via exhaustive grep — zero matches for "invoice" in any of the 3 core files. Business Org tracks deal value and MRR but never generates a billable invoice record. (Real invoice-adjacent data does exist in `revenueOS.cjs`'s separate `data/revenue-os.json.invoices` bucket, but nothing there is wired to Business Org.) Flagged as an honest completeness gap, not fixed, since building invoice generation is new capability.
4. **`churnRate`, `ltv`, `cac` KPI fields are permanently zero.** Declared in the KPI shape (`businessOrgState.cjs`) but never written by any code path in any of the 3 files. Not a bug (nothing miscalculates them — they're simply never calculated), but worth flagging as a completeness gap for any future dashboard or report that might display them expecting real data.

## Regression

`node --check` on every modified file after every edit. Full `npm run test:runtime` regression suite re-run after each of the 4 fixes: **144/144 pass**, 0 failures, throughout.

## Telemetry

`continuousRuntimeObserver.cjs`'s `orgLevels` telemetry source reads `getOrgSummary()`/`getDashboard()` — both of which are now fixed at the source, so this telemetry path automatically reflects corrected, non-recursive MRR going forward with no separate change needed. The frozen historical baseline (risk #1 above) will still surface in telemetry until an operator resets it, since telemetry reports state, not history.

## Documentation

This report. Commits `a622d316`, `ebc343fc`, `6b8df784`, `02b47c99` each carry a detailed inline explanation of their respective bug, root cause, live-verification evidence, and fix — committed module-by-module as instructed, no merge, no push.
