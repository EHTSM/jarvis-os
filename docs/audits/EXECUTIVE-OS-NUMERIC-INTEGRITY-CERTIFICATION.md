# EXECUTIVE OS NUMERIC INTEGRITY CERTIFICATION

Date: 2026-08-04
Scope: Every financial/numeric calculation owned by Executive OS (`backend/services/executiveState.cjs`, `executiveWorkflow.cjs`, `executiveOrg.cjs`) — MRR, ARR, revenue, growth, forecast, ROI, burn, runway, LTV, CAC, margins, profit, and the health-score aggregation. Checked for overflow, NaN, Infinity, exponential growth, double counting, recursive aggregation, duplicate accumulation, incorrect averages, currency conversion errors, stale caches, integer precision issues.
Commit: `e94df5a2` on `security/reality-completion`. No merge, no push.

---

## Method

Every numeric operation in Executive OS's 3 core service files was traced to its origin — division/multiplication/accumulation sites were read in full surrounding context, not assumed correct from a variable name. Where a value originated outside Executive OS (Business Org, Cost Analytics), the upstream computation was read far enough to establish the real units/shape of the value Executive OS receives, without expanding the fix scope past Executive OS's own files, per this mission's explicit boundary.

## Verified Calculations (correct, no fix needed)

- **Budget allocation** (`executiveState.cjs` `allocateBudget`/`createBudget`): real double-entry-style tracking (`spentUsd += amountUsd; remainingUsd -= amountUsd`), explicitly guarded against overspend (`if (amountUsd > b.remainingUsd) return {ok:false}` before any mutation) — cannot go negative or exceed the budget ceiling.
- **AI model cost per tick** (`executiveOrg.cjs` `_budgetTick`): `Math.min(profit.totalCost, 100)` — correctly bounded, no overflow risk.
- **Goal completion progress** (`executiveWorkflow.cjs:591`): `Math.round((done/total)*100)`, guarded by `if (total > 0)` immediately before — no division-by-zero/NaN risk.
- **Knowledge health ratio** (`executiveState.cjs:602`): `d.knowledge?.total > 0 ? validated/total : 1` — correctly guarded, genuine 0-1 fraction, correctly scaled by `*100` for its score.
- **Evolution health keep-rate** (`executiveState.cjs:608`): same pattern as knowledge, correctly guarded and correctly scaled.
- **Agent running-ratio score** (`executiveState.cjs:615`): `agents.length > 0 ? Math.round((running/agents.length)*100) : 100` — correctly guarded.
- **Overall health score denominator** (`executiveState.cjs:620-623`): `health.orgs` is populated by exactly 4 unconditional try/catch blocks (each with a `{score:50}` fallback on failure), so `scores.length` can never be 0 — no NaN risk in the final average.
- **Goal prioritization score** (`executiveWorkflow.cjs:506-519`): bounded integer weights (max 100) plus `goalRisks * 20` where `goalRisks` is a small critical-risk count — unitless, no currency/percentage semantics, no overflow risk in practice.
- **Goal/campaign/budget creation dedup**: `_goalEngineTick` only creates a new goal `if (!active.length)` for the current quarter; `createBudget` is only called `if (!budgets.length)` for the goal — both correctly bounded, no duplicate-accumulation risk from Executive OS's own tick loops.

## Fixed Calculations

**`executiveState.cjs:585` — double-percentage-scaling bug in business health score** (commit `e94df5a2`).

`getGlobalHealth()` computed `score: Math.round(winRate * 100)`, treating `winRate` as a 0-1 fraction needing scale-up — but `businessOrgState.cjs:349` already returns `winRate` as a real 0-100 percentage integer (`Math.round(won/closed * 100)`). This produced scores like `9500` instead of `95` whenever any deal had closed.

**Real, verified impact**: `health.score` (the overall aggregate) averages all 5 org scores, then clamps the result to `[0,100]`. With the bug present, the corrupted `9500` dragged the pre-clamp average far above 100, and the clamp masked this by always reporting a deceptively perfect `100` — hiding real problems in other orgs (e.g. this session's own live data: 19 real engineering blockers correctly forcing `engineering.score:0`, yet overall health still read `100`). Verified before/after with real live data via direct function call and the real `GET /eos/v6/health` HTTP route against a running backend: business score corrected `9500→95`, overall health score corrected `100→85` (the real, honest value reflecting the engineering blockers).

Fix reads `winRate` directly as the already-correct percentage, with a defensive `Math.min(100, ...)` retained since `winRate` originates from an external service Executive OS doesn't own — this guards Executive OS's own aggregation without requiring a fix outside its files.

## False Positives

- Knowledge/evolution/agent health scores were initially suspected of the same class of bug (all three multiply a rate by 100) — traced each to its source and confirmed all three genuinely start from a real 0-1 fraction (`validated/total`, `kept/total`, `running/total`), correctly needing the `*100` scale-up. Only the business score's input was already pre-scaled upstream. Not a bug.
- Initially suspected `businessOrg.cjs`'s `_marketingTick` self-ticking loop (180s interval, indefinite) might duplicate-launch the same campaign across ticks, compounding MRR growth from the Executive OS side. Traced `listCampaigns`/`updateCampaign`'s in-memory mutation ordering — confirmed a campaign transitioned to `active` within one tick cannot be re-read as `planned` within the same tick (synchronous, no race). This narrows the real accumulation cause to the specific site below, not the tick scheduler itself.

## Remaining External Blockers (with evidence)

**MRR/ARR unbounded accumulation — root cause identified, fix out of scope (lives entirely outside Executive OS).**

Traced the `mrr: 1e+257+`-magnitude value (first surfaced by a prior session's telemetry work) fully to its origin: Executive OS only ever reads `businessOrgState.cjs`'s `mrr` field and passes it through unchanged (`executiveState.cjs:500,585`) — it never recomputes, multiplies, or amplifies it. The real accumulation happens in `businessOrgState.cjs:313` (`advanceDeal`): `k.mrr += Math.round(deal.value / 12)` fires every time a deal transitions to `closed_won`, with **no idempotency guard** preventing the same deal (or a repeatedly-regenerated synthetic deal from `businessOrgWorkflow.cjs`'s event-chain simulation, lines 460-470) from re-triggering the addition, and **no corresponding decrement** anywhere (no churn/downgrade path reduces `mrr`). Confirmed still actively growing during this session: `2.9e+258 → 7.7e+258` across two live checks minutes apart via the real running backend.

This is a genuine, real, confirmed bug — but it lives in `businessOrgState.cjs`/`businessOrg.cjs`/`businessOrgWorkflow.cjs` (Business Org, one of Executive OS's 5 dispatch targets, not Executive OS itself). Per this mission's explicit "search only Executive OS" scope, it was traced and documented but not fixed here. Recommended as the next mission: **Business Org Numeric Integrity Certification**, targeting `advanceDeal`'s missing idempotency check and the missing MRR-decrement path for churn/downgrade.

## Regression / Verification

`node --check` on the modified file, direct `getGlobalHealth()` call against real live data (before/after comparison), real HTTP route verification (`GET /eos/v6/health` against a running backend with a real authenticated session), 144/144 regression suite. Test account/org/workspace/lesson/audit-log records cleaned from `data/*.json` afterward (gitignored, no tracked diff).
