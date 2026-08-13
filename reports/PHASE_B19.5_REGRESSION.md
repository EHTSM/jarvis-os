# Phase B.19.5 — Regression

No test was modified, weakened, or deleted in this phase.

---

## Test integrity

`tests/security/89-cross-product-ux-consistency-sweep.cjs` is required to remain
byte-identical. Verified:

```
actual:   aa5b00dbf37d9c3200c763b282cfa6d75b1a67404027440fa72b59f499bfebcb
expected: aa5b00dbf37d9c3200c763b282cfa6d75b1a67404027440fa72b59f499bfebcb
```

`git status tests/` shows no test file modified by this phase. The one dirty
test file, `tests/security/45-distribution-tenant-isolation.cjs`, was last
changed by commit `4e063495` (Growth OS G3 cross-tenant leak fix) and predates
B.19.5.

---

## Accessibility suites

| Suite | Result | Note |
| --- | --- | --- |
| `25-accessibility-contrast` | **9 / 9** | |
| `26-accessibility-foundation` | **21 / 22** | The single failure is `G1-B193` — asserts 0 findings, gets 763. Held OPEN deliberately, not silenced. |
| `27-visual-accessibility` | **16 / 16** | |
| `28-keyboard-aria-recovery` | **14 / 14** | Guards the B.19.4 keyboard/ARIA recovery |
| `29-a11-ux-consistency` | **12 / 12** | Guards the A.11 series UX consistency recovery |
| `tests/security/89` | **PASS** | Byte-identical |

**Subtotal: 72 pass / 1 fail** — the failure being the recorded, evidenced
capability gap.

### Why suite 26 was not made to pass

The assertion is `Expected 0 findings, got 763`. Making it green would require
either editing the assertion or weakening the scanner's labelling contract.
Both are prohibited, and both would convert a real WCAG 3.3.2 failure into a
false green. Live measurement (0 visible labels, 6 placeholder-only across
reachable surfaces) confirms the scanner is correct. The suite stays red until
the labels genuinely exist.

---

## Wider runtime regression

`tests/runtime` contains **105 suites**. They were run in batches because the
full sweep exceeds the shell's execution ceiling.

| Batch | Suites | Result |
| --- | --- | --- |
| First 30 | 30 | **339 pass / 2 fail** |
| Middle (31 → 87) | 57 | **440 pass / 1 fail** |
| Final 18 | 18 | **146 pass / 0 fail** — re-run after every fix in this phase |

**Total: 925 pass / 3 fail across all 105 suites.**

### The three failures, each investigated

| Suite | Verdict |
| --- | --- |
| `10-recovery-certification` | **Pre-existing.** Fails identically at the pre-B.19.5 baseline; untracked by git; exercises runtime recovery, no frontend code. |
| `26-accessibility-foundation` | **`G1-B193`, deliberately open.** Asserts 0 findings, gets 763. Left red rather than silenced. |
| `mission-orchestrator-nodetypes` | **Pre-existing, name collision only.** |

The third deserved scrutiny, because this phase edited a file called
`MissionOrchestratorPanel.jsx`. It is not the cause:

- The test requires only `backend/services/autonomousExecutionRuntime.cjs`,
  `engineeringCapabilities.cjs` and `missionOrchestrator.cjs`. It never loads
  any frontend file.
- The failing assertion is `resolveBlockingStage() with outcome:rejected …` —
  `Error: waitFor timed out`, a backend orchestration timing check.
- **Verified by removing the change:** with the panel edit stashed, the suite
  fails identically twice in a row (7 pass / 1 fail each time).

A shared name is not a shared dependency, and the check was run rather than
assumed.

### Pre-existing failure, not attributed to this phase

`tests/runtime/10-recovery-certification.test.cjs` — 0 pass / 1 fail.

```
✖ fails closed during repeated prerequisite failures and recovers after restoration
  AssertionError: Expected values to be strictly equal:  actual: true, expected: false
```

It fails identically at the pre-B.19.5 baseline, is untracked by git, and
exercises runtime recovery — no accessibility, CSS, or frontend code. Recorded
for completeness; not caused by, and not fixed by, this phase.

---

## Instrument changes and their proof

One measurement instrument changed: `scripts/a11y-live-scan.cjs` gained
`settle()`, which waits for finite entrance animations before probing.

A change that *removes* findings must be proven not to blind the scanner. It was
negative-tested against an injected defect in the shipped build:

| Run | Result |
| --- | --- |
| Clean | dark 0 / light 0 failures |
| With injected 1.4:1 defect | **detected** — `1.4:1 (need 4.5) span.cmd-pulse-label` |

Detection intact. Build restored from backup.

Infinite animations (pulsing dots, spinners) never finish, so they are excluded
from the wait and the whole settle is bounded by a 4s budget — the scanner
cannot hang on a permanently animating page.

---

## Build verification

Every measurement in this phase ran against a production build compiled with
`REACT_APP_API_URL` set. A build without it silently breaks authentication and
invalidates all results — an error made and caught in an earlier phase. All
builds this phase reported `Compiled successfully.` and all scans reported
`authed=true`.

---

*Phase B.19.5 · Ooplix V1 · Confidential*
