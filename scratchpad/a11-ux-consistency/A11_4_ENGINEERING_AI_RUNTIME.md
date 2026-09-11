# Phase A.11.4 — Engineering + Mission Control + AI Workspace + Memory + Runtime UX Consistency Certification

**Product:** Ooplix (repo: `/Users/ehtsm/jarvis-os`, branch `security/reality-completion`)
**Method:** Real browser (Playwright/Chromium, `node <script>.js` from repo root), a real authenticated account, real clicks, real typing into real search boxes, real `getComputedStyle()` measurement, real network interception, real **SSE frame capture off the wire**, real screenshots. Code was read only after real, observed behavior prompted a consistency check, then cross-checked against a reference instance elsewhere in the codebase, per Reproduce→Measure→RootCause→Recover→Regression→Reverify. **The real backend route/service was read before anything was called a bug**, per A.11.2/A.11.3's explicit lesson.
**Session:** reused A.11.2/A.11.3's `crm_auth_state_a112.json` (`jarvis_auth` for `a112audit17861283563381@ooplixtest.com`, `exp` 2026-08-08T02:46:06Z), verified valid against the real backend via three consecutive `GET /auth/me` → `{"success":true,...}`. A post-first-run-tour copy was saved to `scratchpad/a11-ux-consistency/a114/a114_auth.json` for probe reuse. **No fresh signup was performed in this sub-phase, so the 5/15min/IP registration rate limiter was never touched.**
**Environment:** frontend `http://localhost:3000`, backend `http://localhost:5050`, both already running (verified via `lsof`). **No backend restart was performed by this sub-phase** — all four fixes are frontend-side, so none required one.
**Scope:** Engineering Workspace, Engineering Center / Test Results, Mission Control (+ inline `MissionOrchestratorPanel`), AI Chat / AI Workspace, Copilot, Memory OS, Agents (registry + runtime dashboards), Runtime Console / GuardrailsDashboard / Runtime Observer. All 10 destinations were reached and operated; the 21 sub-tabs of Memory OS (5), Agents (7) and Copilot (9) were each walked individually.

---

## Summary

**4 genuine inconsistencies found and fixed**, all four provable behavioral divergences measured live before and after. **3 real, measured findings documented but correctly left unfixed** (UNKNOWN / out of recovery scope).

Three of the four fixes share **one measured root cause**, established from the real wire rather than from reading source:

> `GET /runtime/history` really responds `{ success: true, entries: [...] }`, and each entry really is
> `{ agentId, taskType, taskId, success, durationMs, error, input, output, ts, seq }`.
> There is **no `status` field on any record**, and the array is **not** under a `history` key.
> Measured on **20/20 REST records and 30/30 live SSE `execution` frames captured off the wire**.

Every consumer in this scope classified those records by a `.status` string that matched nothing. The user-visible consequences were not cosmetic — they were **data-honesty failures in both directions**: one screen raised a red alarm over healthy data, another claimed nothing had happened while ten real things had.

Stated plainly because the mission asks for honesty over manufactured findings: the shared chrome, breadcrumbs, empty-state quality and ⌘K coverage across this scope are **largely consistent and were measured as such**, and A.10.4's and A.10.6's prior fixes in this same scope were re-verified live and all hold. The negative results are reported in their own section below as real results, not omitted.

---

## Finding 1 — Runtime Console raised a red "Many failures" alarm over real, genuinely healthy data, and left every real execution row unclassified

**Reproduce.** Opened Runtime Console as a real user (More menu → "Runtime Console"). Two genuinely different first-run tours exist and had to be dismissed (the customer `.cfr-*` one and the operator-console `.op-frs-*` `FirstRunSetup`); with both dismissed the real console rendered.

**Measure (real values, pre-fix).**

| | Real value measured live |
|---|---|
| Real `GET /runtime/history?n=20` top-level keys | **`["success","entries"]`** |
| Real records returned | 20 (and 60 over the wider window) |
| Records carrying a `status` field | **0 of 20** |
| Records with `success === true` (last 20) | **20** |
| Records with `success === false` (last 20) | **0** → **real success rate 100%** |
| Across the full 60-record window | **59 success / 1 failure** |
| **Rendered alarm banner** | **`🚨 Many failures — 0% success rate`** (`.op-emergency-banner--warn`, computed `color: rgb(247, 179, 79)`) |
| Rendered "Failed" tile on the same screen | **`0`** |
| Rendered health line on the same screen | **`✓ Everything is running well`** |
| **Rendered Execution Log row icons** | **60 × `·`** (the neutral "idle/unknown" glyph), **0 × `✓`**, **0 × `✗`** |

The same screen simultaneously asserted "Many failures / 0% success rate", "Failed: 0", and "Everything is running well". Live SSE capture confirmed the shape independently: **30/30 real `execution` frames** exposed exactly `[agentId, taskType, taskId, success, durationMs, error, input, output, ts, seq]` — `success`, never `status`.

**Root Cause.** `frontend/src/hooks/useRuntimeStream.js` passes backend entries through **unchanged** on both ingest paths (`queueExecEntry` for SSE, `fetchHistory` for the REST poll). Every consumer of the resulting `history` array then classifies by `e.status`:

- `frontend/src/components/operator/OperatorConsole.jsx` — `ratio: last20.length ? Math.round((success.length / last20.length) * 100) : 100`, where `success` is `last20.filter(e => e.status === "success" || e.status === "completed")`. With `status` always `undefined`, the numerator is 0 and the ratio is **0**, which trips `OperationalStatusBanner`'s `if (stats.ratio < 75)` branch and its `stats.ratio < 50 ? "Many failures" : "Elevated failures"` label.
- `frontend/src/components/operator/ExecLogPanel.jsx` — `const ok = entry.status === "success" || …; const icon = ok ? "✓" : failed ? "✗" : running ? "▶" : "·"`. All three flags false → every real row renders `·`.
- Also `widgets/RecentFailuresPanel.jsx` and `widgets/SessionContextCard.jsx`, which consume the same array.

Notably `stats.failCount` uses the same broken read, which is why the "Failed" tile honestly showed `0` — the contradiction is internal to one screen. `BrowserAutomationPanel.jsx` also reads `.status`, but was verified to consume a **genuinely different** data source (`listHistory()`, browser-automation steps that really do carry `status: done|retrying|recovering`) and was correctly left untouched.

**Recover.** One file, at the single point **both** ingest paths already flow through — `frontend/src/hooks/useRuntimeStream.js` gained `_normalizeExecEntry()`, applied in `queueExecEntry` and `fetchHistory`. It applies the convention this codebase **already establishes for the same class of record** in `frontend/src/components/SelfHealingCenter.jsx:97`:

```js
status:  h.status || (h.success ? "success" : "failed"),
```

A genuinely-present `status` still wins untouched; records carrying neither field pass through unchanged. **Zero consumer files changed, zero new components, zero backend changes.**

**Reverify (real values, post-fix).**

| | Pre-fix | Post-fix |
|---|---|---|
| Execution rows rendered `·` (unknown) | **60 of 60** | **0** |
| Rendered `✓` / `✗` | 0 / 0 | **54 / 5** |
| Alarm banner | `🚨 Many failures — 0% success rate` | **none rendered** (the correct healthy-state outcome — `OperationalStatusBanner` returns `null`) |
| `✓ Everything is running well` line | present | present (unchanged) |

The post-fix run rendering **5 genuine `✗` rows** is itself evidence the normalizer is not simply stamping everything "success" — real failures are still classified as failures.

---

## Finding 2 — Mission Control's Recent Activity claimed "No recent activity" while ten real executions existed

**Reproduce.** Opened Mission Control and read its Recent Activity section against the real endpoint from the real authenticated page context.

**Measure (real values, pre-fix).**

| | Real value measured live |
|---|---|
| Real response top-level keys | **`["success","entries"]`** — `hasHistoryField: false`, `hasEntriesField: true` |
| Real records available | **10** |
| What `hist.value?.history \|\| hist.value \|\| []` evaluates to | the **whole response object** — `componentValueIsArray: false`, keys `["success","entries"]` |
| `history.length > 0` (the render guard) | **`false`** (`.length` on a plain object is `undefined`) |
| **Rendered** | **`No recent activity`** |

**Root Cause.** `frontend/src/components/MissionControlV1.jsx` read `hist.value?.history` from `getRuntimeHistory()` (`runtimeApi.js` → `GET /runtime/history?n=`). That key does not exist on the real response, so the `||` chain fell through to `hist.value` — the response **object**, not an array — before the `[]` default could ever be reached. The guard `history.length > 0` was therefore permanently false. Additionally, had rows rendered, they classified by `item.status` (absent → empty status label, neutral "warn" dot for every row) and read `item.completedAt || item.startedAt || item.createdAt` for a timestamp, none of which the real record carries (it carries `ts`).

This is precisely the A.10.6 "response-shape guess that matches nothing real" class, and it is a **data-honesty** issue rather than a cosmetic one: the screen asserted that nothing had happened when ten real things had.

**Recover.** One file. Reads the real `.entries` (legacy `.history` still checked first for any other shape), coerces to an array so `.length`/`.slice()` stay meaningful, derives row status via the same `SelfHealingCenter` convention as Finding 1, and adds `item.ts` as the real timestamp fallback. **No new component, no backend change.**

**Reverify (real values, post-fix).**

| | Pre-fix | Post-fix |
|---|---|---|
| Rendered activity rows | **0** | **8** (against 10 real records; the panel slices to 8 by design) |
| Empty state shown | `No recent activity` | **none** (correctly suppressed) |
| Rows with a real status label | 0 | **8 / 8** (e.g. `"success"`) |
| Rows with the success dot (`mc-dot--ok`) | 0 | **8 / 8** |

---

## Finding 3 — Agents → Registry crashed on the first keystroke in its own search box

**Reproduce.** Opened Agents → Registry (42 real agent rows rendered) and typed `crm` into the panel's own search box at a realistic 130 ms/char.

**Measure (real values, pre-fix).**

| | Real value measured live |
|---|---|
| Real `GET /p18/agents` record keys | **`id, name, capabilities, totalRuns, succeeded, failed, successRate, lastRunAt, lastStatus`** |
| Agents carrying `description` | **0 of 42** |
| Agents carrying `type` | **0 of 42** |
| Agents carrying `status` | **0 of 42** |
| Rows before typing | **42** |
| **Rows after typing `crm`** | **0** |
| **Real page error** | **`TypeError: Cannot read properties of undefined (reading 'toLowerCase')`** (×2) |
| React error overlay | **shown** (`#webpack-dev-server-client-overlay`, `crashText: true`) |
| Console | `The above error occurred in the <TabRegistry> component` → `[ErrorBoundary]` |
| Rendered type-filter options | **exactly 2: `"all"` and one blank `<option value="">`** |

**Root Cause.** `frontend/src/components/AgentOSV2.jsx`'s `TabRegistry` filtered with `a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.type.includes(q)`. `a.description` is `undefined` on every real record, so the first keystroke threw and dropped the component into its `ErrorBoundary`. The same absent field made `["all", ...new Set(agents.map(a => a.type))]` yield `["all", undefined]`, rendering `<option key={undefined}>` — **the exact source of the React "unique key" warning A.10.6 recorded on this component as investigated-but-not-conclusively-root-caused**. This finding closes that open item with a measured cause.

**Recover.** One file, reading the fields the backend really sends and reusing this file's **own** established idioms — `(agent.capabilities || [])` (already at line ~169) and `StatusChip`'s own `lastStatus` vocabulary. Added `_agentType()` / `_agentStatus()` derivations, built the search haystack from genuine strings only (`.filter(v => typeof v === "string")`) so no absent field can throw, and dropped empty values from the option list. **No new component, no backend change, no restyle.**

**Reverify (real values, post-fix).**

| | Pre-fix | Post-fix |
|---|---|---|
| Rows after typing `crm` | **0** (crash) | **2** (real matches, from 42) |
| `toLowerCase` TypeError | **2 thrown** | **0** |
| React error overlay | **shown** | **none** |
| Type-filter options | **2** (one blank) | **43 real, non-empty** (`browser`, `terminal`, `automation`, …) |
| React unique-key warning | present | **gone** |

---

## Finding 4 — ⌘K could not find "Runtime Console" by the destination's own real display name

**Reproduce.** Opened the real ⌘K palette and typed the exact name the app itself shows for this destination in its nav button, its More-menu row and its breadcrumb (`Dashboard › Operations › Runtime Console`). Ran the identical term through the More menu as a control.

**Measure (real values, pre-fix).**

| Term typed | ⌘K result | More-menu result |
|---|---|---|
| `runtime console` | **`No commands found for "runtime console"`** | ✓ **"Runtime Console"** found, clickable |
| `execution engine` | ✓ found | — |

A static diff of `App.jsx`'s labels against `CommandPalette.jsx`'s `NAV_ACTIONS` across all 10 in-scope destinations found exactly **one genuine drift**: tab `runtime` is labeled **"Runtime Console"** in `App.jsx` but **"Execution Engine"** in the palette. (Tab `chat` differs too — `"AI"` vs `"AI Chat"` — but that is a benign superset: searching "AI" still matches, verified live, so it is **not** counted as a finding.)

**Root Cause.** Exactly A.11.1 Finding 1's bug class — `CommandPalette.jsx` maintains a hand-written registry parallel to `App.jsx`'s `TABS`/`MORE_TABS` source of truth, and it has drifted. A.11.1 fixed 12 *missing entries*; this is the same registry drifting on a *label*, which is invisible to an entry-count diff and so survived that pass.

**Recover.** One line, using the **additive `keywords` mechanism this same file already establishes** for `analyticscenter` (`"kpi kpis"`, A.10.7), `productos`, `launchplatform` and `logout` (A.4.3): `keywords: "runtime console operator console"`. **The label was deliberately left unchanged**, so nothing that already worked moves.

**Reverify.** `⌘K "runtime console"` → resolves to the real wired destination (`Runtime & Ops ⬡ Execution Engine`). Control: `⌘K "execution engine"` still resolves identically — the fix is genuinely additive.

---

## Negative findings — real results of the primary hunts, not padding

### The A.10.6 fixes in this scope are all still intact (re-verified live)

| A.10.6 fix | Re-measured this phase |
|---|---|
| AI Chat reconnect spam (`App.jsx` refs) | **1** "Connected to Ooplix." message over a clean 20-second window (was 3–4) |
| Memory OS "Untitled" entries (`.key`/`.value`/`.nodeId`) | **0** occurrences of "Untitled"; real titles render (`a1_timeout_error`) |
| Memory OS search reading `.nodes` | real query "timeout" → **"50 results for \"timeout\""**, resolves (not stuck on "Searching memory…") |
| Mission stage `task.result` → `task.executionLog` | all **5 stages** of a real completed mission carry **non-null** output |

### The A.10.4 fixes in this scope are still intact (re-verified live)

| A.10.4 fix | Re-measured this phase |
|---|---|
| `PreActionWarning` Rules-of-Hooks crash | clicked a real pending patch's **Run**: `hooksCrash: false`, `devOverlay: false`, guardrail modal renders correctly, **0** page errors |
| Guard-call debounce | typed a real 74-char task at 45 ms/char → **0 guard calls during typing**, settling to one pair after the pause (was up to ~78 per description) |

### The `operatorOnly` 403 on `/ops` is a deliberate security gate, correctly handled in this scope

`backend/routes/ops.js:74` gates `/ops` behind `requireAuth, operatorOnly` with the explicit comment that "a regular customer must never reach these". All three in-scope `getOpsData()` callers — `MissionControlV1.jsx`, `AgentOSV2.jsx`, `DeveloperCopilotV2.jsx` — **already carry the `user?.role === "operator"` gate** and were verified to do so. The residual 403 observed on Runtime Console originates in `OperatorConsole`, whose entire purpose is the operator console; the console degrades without fabricating data. **Not a defect, not fixed.**

### Destructive-action confirmation: correctly scoped, one real gap documented

`grep` across all 10 in-scope components found **zero `window.confirm` calls**. Real destructive affordances found and assessed:

| Action | Gating | Verdict |
|---|---|---|
| Mission Control **Emergency Stop** | own `.mc-stop-overlay` confirm panel | confirms, but diverges from `ConfirmDialog` — see UNKNOWN-A |
| Eng Workspace **patch Apply** / **incident Auto-Fix** | `PreActionWarning` guardrail modal (real risk check, real Proceed/Cancel) | genuinely gated |
| Eng Workspace **Requeue all** (DLQ) | none | **correctly not gated** — re-enqueuing tasks is reversible/idempotent, not an irreversible record deletion. Per A.11.3's explicit rule, gating it would be inventing new friction |

---

## Documented but NOT fixed (real, measured — listed separately, not silently dropped)

### UNKNOWN-A — Mission Control's Emergency Stop confirm does not close on Escape and is not an accessible dialog

**Measure (real values, all live in one session).**

| Property | `ConfirmDialog` (the app's reference, `ConfirmDialog.jsx`) | `.mc-stop-overlay` (Mission Control) |
|---|---|---|
| Closes on **Escape** | **Yes** (`if (e.key === "Escape") onCancel?.()`) | **No** — measured: overlay present before Escape (**1**), still present after (**1**) |
| Confirms on **Enter** | Yes | No |
| `role="dialog"` / `aria-modal` | **Yes / Yes** | **`null` / `null`** |
| Focus moved into the dialog | Yes (`confirmBtnRef.current?.focus()`) | **No** — measured `activeInsideOverlay: false`; focus stayed on `BUTTON.mc-btn mc-btn--danger` |
| Focus restored on close | Yes (`prev?.focus()`) | No |
| Closes on backdrop click / Cancel | Yes | **Yes** — measured, overlay 1 → 0 |
| Confirm button | `8px 20px`, `r8px`, `12px/600`, `#ef4444` when danger | `8px 16px`, `r7px`, `13px/400`, `rgba(239,68,68,.18)` on `rgb(248,113,113)` |

Control measured in the same session: the **Command Palette** closes on Escape correctly (`.cp-input` present → absent), confirming the reference pattern itself is live and unbroken.

**Why not fixed.** A.11.1 examined this same overlay and explicitly ruled — under the mission's own rule against merging genuinely different implementations — that Mission Control's confirm is "scoped, self-contained, and semantically appropriate for the specific 'halt all agents' action" and should not be unified. This sub-phase's contribution is to **replace that code-inspection judgement with live measurement**: it is now recorded as fact that Escape genuinely does not dismiss the app's single most destructive confirmation, and that it is not an accessible dialog. Converting it to `ConfirmDialog`/`useConfirm` means deleting a working bespoke overlay and its CSS and re-plumbing the handler through a promise-based API — a re-architecture of a functioning destructive-action flow, not an in-place recovery of a drifted value. Recorded with full measurements for a future deliberate decision. (Note this is *not* the same shape as A.11.1's own EOD-Escape fix, which added a listener to a modal that had **no** keyboard handling and **no** competing implementation; here a complete, deliberate, differently-designed confirm already exists.)

### UNKNOWN-B — Mission Control's theme-token coverage (carried forward from A.11.1, investigated further, still UNKNOWN)

A.11.1 flagged Mission Control as UNKNOWN for theme-token coverage (**29 `var(--…)` vs 124 hardcoded** color declarations in `MissionControlV1.css`; `ExecutiveLoop.css` 0 vs 119). Re-examined this phase as instructed. The finding is unchanged and the reason it cannot be recovered is unchanged: there is no single already-correct version of this pattern to point the file at, and re-theming ~124 hardcoded declarations is a wholesale restyle of the file's entire color system. **Per the mission's explicit instruction — "if the only fix is a wholesale restyle, keep it UNKNOWN" — it is kept UNKNOWN and was not touched.** Related measured data point: Eng Workspace styles its entire surface with **inline `style={{…}}` objects and a hardcoded `background: "#0d1117"`**, i.e. it has no stylesheet to theme at all; same conclusion, same reason.

### UNKNOWN-C — `aiService.js`'s "Check provider API keys in your .env file" is misleading in this environment

**Measure.** Real completed-mission stage outputs carry `"[ai] AI backend unavailable. Check provider API keys in your .env file."` — while real `GET /ai/status` measured live shows the active provider **groq** as `configured: true, health: {ok: true}`. The key is genuinely valid; the real cause is quota contention from the app's own autonomous background missions (the documented environmental constraint). The message names the wrong cause.

**Why not fixed.** A.10.6 found this exact wording issue and correctly deferred it as a pre-existing `backend/services/aiService.js` message-accuracy matter. It is a backend error-string change, not a UX-consistency drift between two surfaces of this app, and fixing it would expand this recovery-only pass beyond its scope. Recorded, unchanged. **Crucially, the surrounding behavior is honest**: the real error reaches the mission record and the UI verbatim rather than being swallowed or replaced with fabricated content — which is the property A.10.6 actually fixed and this phase re-verified.

**Additional measured notes (not counted as findings):**
- **Two separate first-run tours** exist and both modally block interaction: the customer `.cfr-*` tour (5 steps, on app entry) and the operator-console `.op-frs-*` `FirstRunSetup` (4 steps, on arriving at Runtime Console). Each is individually dismissible and each is intentional onboarding; recorded as a real navigation observation, not a defect.
- **Transient auth-bootstrap fallthrough.** Several probe runs landed on the signup screen despite a session verified valid by three consecutive real `GET /auth/me` calls; a plain reload always recovered it. This matches the environmental pattern documented in every A.10 sub-phase. Handled in probes and in the regression test with real reload retries + backoff — **not** counted as a product defect.
- **Copilot's Repo Intelligence uses a real skeleton** (9 skeletons at 150 ms → 0 settled), the only genuine skeleton loader measured in this scope.

---

## Matrix 1 — UX Consistency Matrix (per-surface, real measured values)

| Surface | H1 (size/weight/class) | Primary action button | Sub-tab bar | Breadcrumb | Loading | Empty state | Destructive confirm |
|---|---|---|---|---|---|---|---|
| **Eng Workspace** | 20px/700, no class (inline-styled) | `Pill` inline `4px 12px`, `r4px`, `10px/600` | none | PASS | inline stage states, no skeleton | honest — "No pipeline run yet.", "No patch yet", "No manual steps required." | `PreActionWarning` guardrail modal |
| **Engineering Center** | 20px/700, no class | inline | none | PASS | real skeletons on Test Results | honest — "No failure data yet" | n/a |
| **Mission Control** | 22.4px/700 `.mc-title` | `.mc-btn` `7px 16px`, `r6px`, `13.12px/600` | none | PASS | `.mc-skeleton` | honest — "No recent activity" (**correctly suppressed post-fix when activity exists**) | own `.mc-stop-overlay` (UNKNOWN-A) |
| **Copilot** | **24px**/700 `.dcv2-page-title` | `.dcv2-subnav-tab` `8px 16px`, `r0`, `13.12px/500` | **9** tabs | PASS | real skeleton (Repo Intelligence) | honest — "No issues found." | n/a |
| **Memory OS** | 22px/700 `.mov2-page-title` | `.mov2-subnav-tab` `10px 16px`, `r0`, `13px/500` | **5** tabs | PASS | plain text | honest | n/a |
| **Agents** | 22px/700 `.av2-page-title` | `.av2-btn` `5px 10px`, `r8px`, `12px/600` | **7** tabs, `10px 16px`, `r0`, `13px/500` | PASS | `.av2-skeleton` | honest — "No agents currently running" | n/a |
| **Runtime Console** | none (console layout) | `.op-*` console controls | mobile-only tab bar (hidden ≥ desktop) | PASS | live SSE + poll | honest zero tiles | Stop/Resume via Governor |
| **Guardrails** | **15px/800 `.ph-title`** (shared `PageHeader`) | shared chrome | none | PASS | `Skel` in guard modals | honest | n/a |
| **Runtime Observer** | none | shared chrome | filter selects | PASS | plain | honest | n/a |
| *(reference)* CRM (A.11.2) | — | `8px 16px`, `r10px`, `13px/600` | 9 | PASS | shared `<Skeleton/>` (8 of 9) | honest, all | `ConfirmDialog` |

**Empty-state quality across all 10 surfaces and 21 sub-tabs walked: PASS, no drift** — every empty state measured is truthful and names a real next action; none implies hidden data. The two that were *not* truthful pre-fix (Mission Control's "No recent activity" over 10 real records, and Runtime Console's unclassified rows) were Findings 2 and 1 and are fixed.

## Matrix 2 — Design System Matrix (this scope's real values vs the A.11.1–A.11.3 baselines)

| Token / property | A.11.1 baseline | A.11.2 / A.11.3 | A.11.4 measured | Drift? |
|---|---|---|---|---|
| Nav tab (shared chrome) | `5px 11px`, `r7px`, `13px/500` | identical | **`5px 11px`, `r7px`, `13px/500` — identical on all 10 surfaces** | **No** — shared chrome has zero drift, confirming A.11.1 |
| Breadcrumbs | shared `Breadcrumbs` | PASS everywhere | **PASS on 10 of 10**, correct group each time (`…›Engineering›`, `…›Operations›`, `…›Intelligence›`, `…›AI & Agents›`) | **No** |
| Page-title size | h1 hand-set per component; **no shared heading-scale token exists** | CRM `.bos-section-title` uniform | **15px/800, 20px/700, 22px/700, 22.4px/700, 24px/700** | Variance is real but there is **no shared token to have drifted from** (A.11.1's own finding). The 15px is `PageHeader`'s own `.ph-title`, i.e. correct for that shared component. **Not flagged** |
| Radius scale | `xs:6 sm:10 base:14 …` | CRM `10px` ✓; Payments/Growth hardcoded ✗ | `r6px`, `r7px`, `r8px`, `r0`, `r4px` — hardcoded per surface | **Yes**, but uniform per surface and matching the Payments/Growth situation; whole-file retheme, not a drifted site. Not fixed |
| Sub-tab bar | — | Growth family `r0` + accent underline | Copilot `8px 16px`, Memory OS / Agents `10px 16px`, all `r0`, all accent `rgb(124,111,255)` | Near-identical across the three multi-tab surfaces; 2px padding difference only. **Not flagged** |
| Theme-token coverage | Mission Control 29 `var()` / 124 hardcoded | — | unchanged; Eng Workspace fully inline-styled | **UNKNOWN-B**, per mission instruction |
| Destructive confirm | `ConfirmDialog` reference | CRM adopted it (A.11.2 fix) | Mission Control's own overlay: no Escape, no `role`, no focus move | **Yes** — **UNKNOWN-A**, now live-measured |
| `<label>` elements | — | 0 across CRM + Growth (A.11.2/A.11.3 UNKNOWN-C) | **0 on 9 of 10 surfaces** (Runtime Console: 1) | Consistent with the whole app; continuation of the same UNKNOWN, not an intra-scope drift |

## Matrix 3 — Navigation Matrix

| Element | Result |
|---|---|
| Breadcrumbs | **PASS** — 10 of 10, shared component, correct group each time |
| More-menu discovery | **PASS** — all 10 destinations found on their first natural term |
| ⌘K → in-scope destinations | **PASS for 10 of 10 tab ids** (A.11.1's registry fix genuinely covers this scope) — but see the label drift below |
| ⌘K → by real *display name* | **FIXED (Finding 4)** — "Runtime Console" returned "No commands found"; now resolves |
| Sub-tab bars (5 / 7 / 9) | **PASS** — each driven by one array → one map, consistent active treatment, no per-tab special-casing |
| Sub-tab walk | **21 of 21 sub-tabs** reached and rendered real content; **0 dead ends**, 0 never-resolving loaders |
| Mobile tab bar (Runtime Console) | Correctly hidden at desktop width (`op-mobile-only`) — not a defect |
| First-run tours | Two distinct intentional tours, both dismissible (see measured notes) |

## Matrix 4 — Loading Matrix

| Surface | Pattern | Measured |
|---|---|---|
| Mission Control | skeleton (`.mc-skeleton`) | real |
| Engineering Center | skeleton | real, on Test Results |
| Agents | skeleton (`.av2-skeleton`) | real |
| Copilot | skeleton on Repo Intelligence | **9 at 150 ms → 0 settled** (resolves correctly) |
| Memory OS | plain text | resolves |
| Eng Workspace | inline per-stage status, no skeleton | correct for a pipeline console |
| Guardrails | `Skel` inside the guard modals ("Checking safety…") | real |
| Runtime Console | live SSE + poll, no skeleton | real |

**No never-resolving loader was found anywhere in this scope.** An earlier probe appearing to show 33 permanent skeletons on "Copilot → Pipeline" was traced to **my own test navigating to the app's top-level "Pipeline" nav tab** instead of Copilot's sub-tab; corrected by scoping the selector to `.dcv2-subnav-tab`. Recorded as a test-tooling issue, **not** a product defect.

## Matrix 5 — Search Matrix

| Surface | Search present | Behavior |
|---|---|---|
| Agents → Registry | **Yes** (`.av2-search`) | **FIXED (Finding 3)** — crashed on the first keystroke; now filters 42 → 2 on a real query |
| Memory OS | **Yes** (Index filter + Search tab) | real server-side search; "timeout" → **50 real results** |
| Runtime Console | **Yes** (`Search… (status: error: agent: ts:)`) | real, with real field prefixes |
| Copilot / Eng Workspace / Mission Control | no free-text search | consistent with their console/pipeline nature |
| More menu | all 10 found on first natural term | **PASS** |
| ⌘K | all 10 tab ids present; one label gap | **FIXED (Finding 4)** |
| Empty results | ⌘K renders a real `No commands found for "…"` state | honest |

## Matrix 6 — Keyboard Matrix

| Interaction | Result |
|---|---|
| ⌘K opens / Escape closes the palette | **PASS** — live-verified from within this scope (`.cp-input` present → absent) |
| **⌘↵ "Run Full Loop"** (Eng Workspace) | **PASS, and genuinely discoverable** — the button's own label literally reads **`⟳ Run Full Loop ⌘↵`**, measured live. Real `onKeyDown` handler confirmed. The richest keyboard affordance in this scope, and it advertises itself |
| Escape closes an in-scope overlay | **FAIL for Mission Control's Emergency Stop confirm** — measured 1 → 1 (UNKNOWN-A). No in-scope component registers **any** `keydown` listener (verified by grep across all 10) |
| Enter confirms a destructive dialog | Not implemented in scope (`ConfirmDialog` does it; `.mc-stop-overlay` does not) — UNKNOWN-A |
| Focus moved into a modal on open | Not implemented in scope; `ConfirmDialog` does it — UNKNOWN-A |
| Shortcuts help discoverability | No in-scope surface exposes a shortcuts affordance; `PageHeader` has an unused `shortcuts` prop. Uniform across scope, not a drifted instance |

## Matrix 7 — Feedback Matrix

| Pattern | Where | Consistency |
|---|---|---|
| **False alarm over healthy data** | Runtime Console | **FIXED (Finding 1)** — `🚨 Many failures — 0% success rate` over a real 100% success rate |
| **Execution outcome legibility** | Runtime Console Execution Log | **FIXED (Finding 1)** — 60/60 rows `·` → 54 `✓` / 5 `✗` |
| **Activity feed truthfulness** | Mission Control | **FIXED (Finding 2)** — "No recent activity" over 10 real records → 8 real labelled rows |
| **Crash on user input** | Agents Registry | **FIXED (Finding 3)** — real `TypeError` + ErrorBoundary on the first keystroke |
| Guardrail confirmation | Eng Workspace Apply / Auto-Fix | **PASS** — real risk check, real Proceed/Cancel, no hooks crash (A.10.4 fix holds) |
| Destructive confirm | Mission Control Emergency Stop | confirms, but diverges from `ConfirmDialog` — **UNKNOWN-A** |
| Reversible bulk action | Eng Workspace "Requeue all" | correctly ungated (reversible) |
| Toast systems | Agents (`.av2-toast`), Copilot (`.dcv2-toast`) | two more local toast systems, neither the shared `ToastContainer` — the same shape as A.11.2's UNKNOWN-A and A.11.3's UNKNOWN-A, now confirmed to extend into this scope. Not fixed, for the identical reason |

## Matrix 8 — AI Honesty Matrix

| Surface | Honest? | Evidence (real, measured) |
|---|---|---|
| **Runtime Console — success rate + execution log** | **WAS NO → FIXED** | Asserted "Many failures — 0% success rate" against real data measuring **20/20 success (100%)**, and rendered all 60 real executions as unknown. This is the AI-honesty standard applied to operational state: the screen stated something about the user's system that was **false**. Post-fix: alarm gone, 54 ✓ / 5 ✗ |
| **Mission Control — Recent Activity** | **WAS NO → FIXED** | Asserted "No recent activity" while **10 real executions** existed. Post-fix: 8 real rows, 8/8 real status labels |
| **Agents — Registry** | **WAS NO → FIXED** | Searching collapsed 42 real agents to 0 rows via an uncaught crash — the user could reasonably conclude they had no matching agents. Post-fix: 2 real matches |
| **Mission stage output** | **YES** | A.10.6's fix holds: all 5 stages of a real completed mission carry **non-null** output, and that output is the **real** upstream error verbatim rather than a fabricated answer |
| **AI Chat / Copilot** | **YES** | Real send/receive against the real provider pipeline; real quota failures surfaced, never a fake success. **0** fabricated-success strings found |
| **Memory OS** | **YES** | Real `/p18/memory` data (100 real nodes), real search returning **50 real results**; A.10.6's field fixes hold, 0 "Untitled" |
| **Eng Workspace Observe/Heal/Learn** | **YES** | Real live tiles; honest "✓ No open incidents" and honest large real DLQ counts, no fabricated incidents |
| **AI error wording** | **PARTIAL — UNKNOWN-C** | The error *reaches* the user honestly and verbatim; its *text* names the wrong cause ("Check provider API keys") while the key measures `health: {ok:true}`. Pre-existing, deferred by A.10.6, out of this pass's scope |
| **Knowledge Base** (A.10.6's GENUINE CAPABILITY GAP) | **still a gap, correctly not fixed** | Re-confirmed unchanged. Building real document ingestion/indexing remains new architecture, correctly out of a recovery-only pass |

---

## Fix Summary

| # | File | Change | Sites |
|---|---|---|---|
| 1 | `frontend/src/hooks/useRuntimeStream.js` | added `_normalizeExecEntry()` deriving `status` from the real `success` boolean, applied on **both** the SSE and REST ingest paths | 3 (1 helper + 2 call sites) |
| 2 | `frontend/src/components/MissionControlV1.jsx` | read the real `.entries` field + coerce to array; derive row status from the real `success`; read the real `ts` | 2 blocks |
| 3 | `frontend/src/components/AgentOSV2.jsx` | `TabRegistry` reads the real `capabilities`/`lastStatus` fields, guards every string read, drops empty filter options | 1 block |
| 4 | `frontend/src/components/CommandPalette.jsx` | additive `keywords` alias so the destination's real display name is findable | 1 line |

**Four files touched, all frontend.** Zero new components, zero new backend routes, zero schema changes, zero backend restarts, zero restyled intentional differences. Every fix recovers a convention this codebase already establishes and uses elsewhere (`SelfHealingCenter.jsx`'s `status || (success ? …)`, `AgentOSV2.jsx`'s own `(agent.capabilities || [])`, `CommandPalette.jsx`'s own `keywords` mechanism).

## UNKNOWN / Documented-Not-Fixed Summary

| # | Area | Why not fixed |
|---|---|---|
| A | Mission Control's Emergency Stop confirm: no Escape, no Enter, no `role="dialog"`/`aria-modal`, no focus management (7 properties measured against `ConfirmDialog`) | A complete, deliberate, differently-designed confirm already exists; replacing it means deleting a working bespoke overlay + CSS and re-plumbing through `useConfirm` — a re-architecture, not an in-place recovery. A.11.1 reached the same conclusion by inspection; this phase upgrades it to live measurement |
| B | Mission Control theme-token coverage (29 `var()` / 124 hardcoded); Eng Workspace fully inline-styled | The only fix is a wholesale restyle — **kept UNKNOWN per the mission's explicit instruction** |
| C | `aiService.js`'s "Check provider API keys" names the wrong cause (key measures `health: {ok:true}`; real cause is quota contention) | A backend error-string accuracy issue already deferred by A.10.6, not a UX-consistency drift between two surfaces of this app |

---

## Regression

**New test:** `tests/security/85-engineering-ai-runtime-ux-consistency-exec-status-field-activity-feed-registry-crash-palette-label.cjs` — **43 passed, 0 failed, 0 skipped** on the certifying run, with **every live check genuinely exercised** (no skips were needed; the backend was responsive at the moment of the final run).

Breakdown: **24 static assertions** — including cross-checks that read the **real backend route source** to confirm the response envelope each fix depends on, and cross-checks that read **sibling component source** (`SelfHealingCenter.jsx`, `AgentOSV2.jsx`'s own capabilities idiom) to prove the conventions being applied genuinely pre-exist rather than being invented — and **19 browser-live assertions** driven through the real UI with real clicks, real typing, real network reads and real DOM measurement.

**Anti-soft-pass verification (performed, not merely claimed).** All four fixes were deliberately reverted, and the test re-run against the real app.

**Result: 15 passed, 28 failed, 0 skipped** (from 43/0/0).

Critically, **14 of the 28 failures came from the live sections**, driven by real interactions and reproducing the exact pre-fix values from the original investigation:
- all **60 of 60** real execution rows measured back at the unknown `·` glyph, 0 `✓`, 0 `✗`;
- the literal banner text **`🚨 Many failures — 0% success rate`** measured on screen, against a real, simultaneously-measured **20/20 (100%)** success rate;
- Mission Control measured rendering **0 rows and the "No recent activity" empty state against 10 real backend records**;
- the real **`TypeError: Cannot read properties of undefined (reading 'toLowerCase')`** thrown twice by real typing, with `devOverlay=true`, 42 → 0 rows;
- the type filter measured back at **1 blank option**;
- ⌘K measured returning **`No commands found for "runtime console"`**.

The remaining 14 failures were static assertions correctly detecting the reverted source. The fixes were then restored and the test returned to **43 passed, 0 failed, 0 skipped**. The live assertions therefore provably fail when the fix regresses; they are not try/catch shims. Every live check sits behind a real retry loop with exponential backoff, and every genuinely unreachable path calls `todo()` (incrementing a separate `skipped` counter, reported in its own section) rather than `ok()`.

*One assertion was strengthened as a direct result of the prove-it-can-fail run, recorded rather than hidden:* the check that Registry search "narrows the list" **passed at 42 → 0** while the bug was reintroduced, because a crash also narrows. It was rewritten to require `0 < rows < beforeRows`, so a crash can no longer satisfy it. This is exactly the class of weak assertion the prove-it-can-fail step exists to expose.

**Full suite:** `npm run test:runtime` → **tests 144, suites 50, pass 144, fail 0, cancelled 0, skipped 0, todo 0** — the established A.10/A.11 baseline exactly, verified both mid-phase and after the final restore. No regressions introduced.
