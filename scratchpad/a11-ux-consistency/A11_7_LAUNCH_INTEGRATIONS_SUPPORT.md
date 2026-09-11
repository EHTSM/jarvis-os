# Phase A.11.7 — Launch Platform + Integrations + Support + Customer Success UX Consistency Certification

**Product:** Ooplix (repo `/Users/ehtsm/jarvis-os`, branch `security/reality-completion`)
**Sub-phase:** A.11.7 — the FINAL per-area sub-phase of Phase A.11.
**Method:** Real browser (Playwright/Chromium, `node <script>.js` from repo root), a real authenticated founder account, real clicks, real `getComputedStyle()` measurement, real transport-layer failure injection (`page.route(...).abort("failed")`), real credential writes into the real org vault, real backend cross-checks, real screenshots. Code was read only **after** real observed behaviour prompted a consistency check, then cross-checked against a reference instance elsewhere in the codebase, per Reproduce → Measure → Root Cause → Recover → Regression → Reverify. **The real backend route file was read before anything was called a bug** — and in this phase that reading is what confirmed `ok` (not `success`) was the correct discriminator, and what proved that "Not connected" on the Integrations screen is *honest*, not a false claim.

**Session:** reused A.11.5's `scratchpad/a11-ux-consistency/a115/a115_auth.json` (`jarvis_auth` for `a115audit1786180626618@ooplixtest.com`, `exp` 2026-08-08T17:18:09Z, role `user`). JWT verified structurally unexpired **and** verified live against the real backend: `GET /auth/me` → `{"success":true,...}` (HTTP 200, 11.44 s round-trip on first probe). **No fresh signup was performed, so the 5/15min/IP registration rate limiter was never touched.**

**Environment:** frontend `http://localhost:3000`, backend `http://localhost:5050`, both already running (verified via `lsof -iTCP -sTCP:LISTEN -P`). **No backend restart was performed by this sub-phase** — all five fixes are frontend-side, so none required one. Background load was real and measured: `GET /health` round-trips ranged **0.0007 s – 23.20 s** across the phase (a 23.2 s `/health` was recorded at phase start), and aggregate `node` CPU measured **136.4 %** at phase end. One credential-save round-trip was slow enough to fail a first attempt and was recovered by real retry with exponential backoff — classified honestly as environmental, not a product defect.

**Scope operated:** Launch Platform (**all 14 sub-tabs**: Dashboard / Onboarding / Workspaces / Docs / Academy / Referral / Success / Feedback / Readiness / Benchmark / PCP Report / PIP Report / Deploy / Company), Integrations (which, for a non-operator, renders `ConnectorSetupWizard` — **all 9 connector cards**, real credential write + real delete), Support Center (Tickets / Knowledge Base / SLA Tracking / Analytics), Customer Success Center (Overview / Customer Health / Support Tickets), plus the adjacent reachable surfaces Referral Engine, Getting Started, Marketplace, Partners, Trust, Legal OS, Beta Checklist, Overview, Help & Guides, Ooplix Runs Ooplix, Companies.

---

## Summary

**5 genuine inconsistencies found and fixed. 4 UNKNOWNs documented and deliberately not "fixed". 3 out-of-scope non-conformers found and handed to A.11.8.**

The headline finding is the mission's named highest-value class, and it is **not** merely an unknown value rendered as zero — it is a **provably false statement of fact that the app contradicted on its own screen**:

> Under a genuine transport-layer failure of only `/customer-org/health` and
> `/customer-org/support/tickets` (with `/customer-org/dashboard` left working),
> Customer Success rendered:
>
> **Customer Health → "No health records yet."**
> **Support Tickets → "No support tickets yet."**
>
> …while the **Overview tab immediately beside them**, fed by the fetch that
> *did* succeed, simultaneously displayed **"147 OPEN TICKETS"** and
> **"27 AT RISK"** with five named at-risk customers.
>
> Real backend ground truth, probed in the same run with the same session:
> `GET /customer-org/health?limit=20` → `{ok:true}`, **20 records**
> `GET /customer-org/support/tickets?limit=20` → `{ok:true}`, **20 tickets**
>
> Both claims were therefore **not merely unknown — they were FALSE**, and the
> app stated them while displaying contradicting real data one tab away.

Second, a destructive-action gap with real blast radius: **clicking "Disconnect" on a connector permanently deleted the whole organization's stored third-party credentials with no confirmation of any kind.** Measured live by storing a real credential through the real UI and clicking once: `confirmDialog: false` **and** `nativeDialog: null` — no in-app dialog, no `window.confirm`, nothing. The card read "Not connected" on the very next paint.

Stated plainly, because the mission asks for honesty over manufactured findings: **a large part of this scope is genuinely consistent and was measured as such.** All 14 Launch Platform sub-tabs render with **zero page errors**. All 9 connector cards render from the real payload. 8 of the 11 adjacent surfaces swept conform to the page-header baseline exactly. `ConnectorSetupWizard` already uses the **shared** `ToastContainer` (not a local subsystem). Launch Platform's dashboard already degrades honestly. Customer Success under a *total* failure was already correct. Every one of the 63 `MORE_TABS` destinations already has a ⌘K entry. Negative results are reported in their own section as real results, not omitted.

---

## Finding 1 — Customer Success asserted "no records" as fact when the fetch had genuinely FAILED

**Class:** falsely-confident values (the mission's named highest-value class).
**Severity:** highest in this phase — a false claim, self-contradicted on the same screen.

**Reproduce.** Opened Customer Success as a real founder. Injected a genuine transport-layer failure on **only** the two list fetches — `page.route("**/customer-org/health*", r => r.abort("failed"))` and the same for `**/customer-org/support/tickets*`, not a mocked body — leaving `/customer-org/dashboard` untouched, so the surface was under a real **partial** failure. Then opened each sub-tab.

**Measure (real values, pre-fix).**

| Sub-tab | Rendered under a genuine partial failure | Reality |
|---|---|---|
| Overview (fetch **succeeded**) | `56 TOTAL CUSTOMERS`, `50.6 AVG HEALTH SCORE`, `27 AT RISK`, **`147 OPEN TICKETS`**, 5 named at-risk customers | real |
| **Customer Health** (fetch **failed**) | **`No health records yet.`** | **FALSE** — backend holds **20** records |
| **Support Tickets** (fetch **failed**) | **`No support tickets yet.`** | **FALSE** — backend holds **20** tickets |

Real backend ground truth, same run, same session cookie:

| Endpoint | Real result |
|---|---|
| `GET /customer-org/health?limit=20` | `{"ok":true}`, **20 records** |
| `GET /customer-org/support/tickets?limit=20` | `{"ok":true}`, **20 tickets** |

**Root Cause.** `frontend/src/components/CustomerSuccessCenter.jsx`'s `refresh()` collapsed *both* "the backend genuinely returned zero" and "the request failed" into the same `[]`:

```js
setHealth (h?.ok !== false ? (h.records || []) : []);
setTickets(t?.ok !== false ? (t.tickets || []) : []);
```

Both render sites then keyed off `.length === 0` and printed the confident copy. A failed load and a genuinely empty account produced **byte-identical output**.

Per the mission's explicit lesson, **the real backend route was read before choosing a discriminator**: `backend/routes/customerOrg.js` wraps every response in its `ok()` helper (`{ok:true,...}`), so **`ok === false` is the correct field here** — the mirror image of A.11.6, where `/business/leads` genuinely sends `success` and `success` was correct there. This was *not* blind-swapped.

**Recover.** `frontend/src/components/CustomerSuccessCenter.jsx` only. `null` now means "unknown" (fetch failed or has not run) and `[]` means "genuinely zero" — the same distinction A.11.5 used for TeamWorkspace's tiles and A.11.6 for ReportsV2's KPI cards. Initial state moved from `[]` to `null` (nothing fetched yet is *unknown*, not a claim of zero). Both render sites gained an explicit unknown branch. **No new component, no new state machine, no invented copy pattern.**

**Anti-over-correction, proven live in both directions.** The guard is conditional, never blanket:

| | Real successful load | Genuine injected partial failure |
|---|---|---|
| Customer Health | real rows render (`919000000002 D · 43 high`, …) | **`⚠ Couldn't load health records — the request failed. Use Refresh to retry.`** |
| Support Tickets | real rows render (`I can't finish onboarding setup`, `open`, `Resolve`) | **`⚠ Couldn't load support tickets — the request failed. Use Refresh to retry.`** |
| claims "No … yet." | **no** | **no** |
| claims "Couldn't load" | **no** | **yes** |

A genuinely-empty list still renders `No health records yet.` / `No support tickets yet.` — asserted in the regression, and left deliberately intact.

**Reverify.** Verified live post-fix (probe `p6_reverify.js`) and pinned by regression assertions that were **proven to fail** when reverted (see the prove-it-can-fail section: `FALSE CLAIM: health fetch genuinely failed but UI said 'No health records yet.' (backend really has 20)`).

---

## Finding 2 — Disconnecting a connector destroyed org-wide credentials with no confirmation

**Class:** destructive action without the app's established confirmation pattern.

**Reproduce.** Opened Integrations (which, for a non-operator, mounts `ConnectorSetupWizard`). Expanded the WhatsApp Business card, typed a **real** credential into the real form, clicked **Connect**, and confirmed the card flipped to `✓ Connected` — i.e. the credential was genuinely written to the real org vault. Then expanded the card again and clicked **Disconnect** exactly once, with a Playwright `dialog` listener attached to catch any native `window.confirm`.

**Measure (real values, pre-fix).**

| | Measured |
|---|---|
| In-app confirm dialog (`.cdialog-overlay`) | **`false`** |
| Native dialog (`page.on("dialog")`) | **`null`** |
| WhatsApp card status after one click | **`Not connected`** |
| `csw-card--connected` class | **`false`** |
| Shared toast | `✓ Disconnected` |

The credential was already gone. There was no gate of any kind.

**Blast radius (read from the real backend, not assumed).** `backend/routes/myConnectors.js`: `DELETE /my-connectors/:providerId` removes the credential from `secretVault` scoped to **`req.org.id`** — i.e. for the **entire organization**, every member, with no undo. The route is gated by `requireOrgPermission("manage_connectors")`, and the file's own docstring classes these as *"third-party secrets … the same sensitivity class as manage_billing/manage_sso"*.

**Root Cause.** `frontend/src/components/ConnectorSetupWizard.jsx` line 83 called `onRemove(provider.id)` directly from `onClick`. The app already has a shared destructive-confirm pattern used everywhere else — `useConfirm()` / `ConfirmDialog` (A.11.2 wired CRM's deletes; A.11.5 wired OrgAdminCenter's five sites, replacing raw `window.confirm`). This component simply never adopted it.

**Recover.** `frontend/src/components/ConnectorSetupWizard.jsx` only. Imported the **existing** `useConfirm`, gated `handleRemove` behind it with `danger: true`, passed the real `provider.label` through so the dialog names what is being destroyed, and rendered the existing `{ConfirmUI}`. **No new component.** The guard is placed **before** the `DELETE` is issued (asserted by source-order check in the regression, not just by presence).

**Reverify (real values, post-fix — live, all four paths exercised).**

| Action | Dialog | Credential afterwards |
|---|---|---|
| Click Disconnect | **`Disconnect WhatsApp Business?`**, `role="dialog"`, `aria-modal="true"`, `cdialog-danger`, focus on confirm | **still `✓ Connected`** — not deleted first |
| Press **ESC** | closes | **`✓ Connected`** (preserved) |
| Click **Cancel** | closes | **`✓ Connected`** (preserved) |
| Click **Disconnect** (confirm) | closes | **`Not connected`** — genuinely deleted |

**Anti-over-correction, asserted:** confirming still genuinely performs the disconnect — the gate blocks, it does not break the action. Cross-checked against the real backend: `GET /my-connectors` afterwards returned **zero** connected providers, so the audit credential was genuinely removed and the vault left clean.

Dialog message (real, as rendered): *"This permanently removes your organization's stored WhatsApp Business credentials. Anything Ooplix runs through WhatsApp Business will stop working until you connect it again."*

---

## Finding 3 — Launch Platform was the only surveyed surface with NO page header at all

**Class:** typography / page-header baseline conformance.

**Reproduce & Measure (real values, pre-fix).** Measured the first `h1`/`h2` in the rendered pane of every in-scope surface with `getComputedStyle()`.

| Surface | Title element | font-size | font-weight | letter-spacing | Subtitle | Conforms |
|---|---|---|---|---|---|---|
| Support Center | `h1.sc-title` | 22px | 800 | -0.3px | 13.5px | ✅ |
| Connectors (Integrations) | `h1.csw-title` | 22px | 800 | -0.3px | 13.5px | ✅ |
| Referral Engine | `h1.ref-title` | 22px | 800 | -0.3px | 13.5px | ✅ |
| Marketplace | `h1.mc-title` | 22px | 800 | -0.3px | 13.5px | ✅ |
| Partner Program | `h1.pp-title` | 22px | 800 | -0.3px | 13.5px | ✅ |
| Organization (ref) | `h1.oac-title` | 22px | 800 | -0.3px | 13.5px | ✅ |
| Team Workspace (ref) | `h1.tw-title` | 22px | 800 | -0.3px | 13.5px | ✅ |
| Reports (ref, fixed in A.11.6) | `h1.rv2-page-title` | 22px | 800 | -0.3px | 13.5px | ✅ |
| **Customer Success** | bare `h2` (no class) | **18px** | **700** | **normal** | **none** | ❌ |
| **Launch Platform** | **none — no `h1`, no `h2`** | — | — | — | — | ❌ |

Launch Platform opened as a **bare row of 14 tabs with nothing naming the screen**.

**Root Cause.** `LaunchPlatform.jsx`'s root render goes straight from `<div className="launch-platform">` to `<div className="launch-tabs">` — a header was simply never written. `CustomerSuccessCenter.jsx` is entirely inline-styled and its `h2` carried an ad-hoc `fontSize: 18` that predates the baseline.

**Recover.** Values **copied from the measured baseline**, not designed:
- `frontend/src/components/LaunchPlatform.jsx` + `.css` — added `.launch-header` / `.launch-title` / `.launch-subtitle`. The title is the destination's own existing name from `App.jsx`'s `MORE_TABS`; the subtitle names the real sub-tabs already rendered below.
- `frontend/src/components/CustomerSuccessCenter.jsx` — title to 22px/800/-0.3px/`var(--text)`, plus a 13.5px `var(--text-dim)` subtitle, in the same inline-style idiom the component already uses.

**A real trap avoided, and pinned by the regression.** `.launch-platform` sets `font-family: var(--font-mono)`, so a naive header would have inherited monospace and *not* matched the siblings. I initially reached for a `var(--font-ui)` token — **then checked `index.css` and found no such token exists**. Rather than invent one, the stack is copied verbatim from `index.css`'s own `body` rule. The regression asserts both that the header is non-monospace **and** that `--font-ui` genuinely does not exist in `index.css`.

**Reverify (real values, post-fix — live).**

| | Title | Subtitle |
|---|---|---|
| Launch Platform | **22px / 800 / -0.3px**, non-monospace | **13.5px** |
| Customer Success | **22px / 800 / -0.3px** | **13.5px** |

**Anti-regression, asserted live:** all **14** Launch Platform sub-tabs still render after the header was added — the header did not displace content.

---

## Finding 4 — ⌘K could not find "Support Center", the one name the screen shows itself

**Class:** two-search-surfaces registry drift / label mismatch (the A.11.4 `nav-runtime` class).

**Reproduce & Measure (real values, pre-fix).** One destination carries **three different names**:

| Where | Name shown |
|---|---|
| `CommandPalette.jsx` `NAV_ACTIONS` | `Support OS` |
| `App.jsx` `MORE_TABS` | `Support` |
| **The page's own `<h1>`** | **`Support Center`** |

Measured live in the real palette:

| ⌘K query | Pre-fix result |
|---|---|
| **`Support Center`** | **`No commands found`** (empty state) |
| `ticket` | `Product OS` only — **Support absent** |
| `sla` | `Self-Healing`, `Execution Engine`, `Trust & Compliance`, `Launch Platform`, `Product OS` — **Support absent** |
| `escalation` | `No commands found` |
| `helpdesk` | `No commands found` |

The one name the screen actually shows itself was the one name that could not find it.

**Root Cause.** `CommandPalette.jsx` maintains a `NAV_ACTIONS` registry parallel to `App.jsx`'s `MORE_TABS`; `nav-supportos` had no `keywords`. Same class as A.10.7's `kpi`, A.11.1's 12 destinations, A.11.4's label mismatch and A.11.6's `finance`.

**Recover.** `frontend/src/components/CommandPalette.jsx` only — added `keywords` to `nav-supportos`, using the surface's **own real vocabulary** (its tab bar literally reads Tickets / Knowledge Base / SLA Tracking / Analytics). **Label left unchanged** so nothing that already worked moves. **Verified in source that `keywords` is genuinely consumed by `_score()`** rather than assuming it — a field nothing reads would have made the fix inert and the test vacuous.

**Reverify (real values, post-fix — live).**

| ⌘K query | Post-fix |
|---|---|
| **`Support Center`** | **`["Support OS"]`** |
| `ticket` | **`["Support OS", "Product OS"]`** — Support now **first** |
| `sla` | **`["Support OS", …]`** — Support now **first** |
| `escalation` / `helpdesk` | **`["Support OS"]`** |

**Negative controls, asserted live — no over-broad capture:**

| ⌘K query | Result | Unchanged? |
|---|---|---|
| `knowledge base` | `["Knowledge Base", "Support OS"]` — real Knowledge Base still **first** | ✅ |
| `billing` | `["Billing", "Product OS"]` | ✅ |
| `crm` | `["CRM", …]` | ✅ |
| `engineering` | `["Engineering", …]` | ✅ |

**Scope discipline:** A.11.6 explicitly left further `MORE_TABS` alias/keyword drift out of scope and deliberately un-bulk-patched. I fixed **only my own scope's entry** and bulk-patched nothing. The remaining drift is enumerated below for A.11.8.

---

## Finding 5 — Support Center presented 8 fabricated tickets as a real queue

**Class:** fabricated data indistinguishable from real data (AI-honesty), and genuine drift from a structurally identical sibling.

**Reproduce & Measure (real values, pre-fix).** With `localStorage["ooplix_support_tickets"]` genuinely absent, Support Center rendered **8 tickets** with invented subjects, invented user ids (`u_1019`, `u_1022`, …) and invented wait times, plus **8 KB articles** with invented view/helpfulness counts. Its summary strip (Open / In progress / Escalated / Resolved / **SLA breached** / **Avg wait**) and its whole Analytics tab are **computed from those seeds**. There was **no disclosure that any of it was fabricated**.

The pre-existing `coming-soon-banner` reads *"Tickets are stored locally with full SLA tracking…"* — which honestly explains **where** tickets live, but implies they are *the operator's own*, and never says these particular 8 are examples.

**Root Cause — established as genuine drift, not a design choice.** `frontend/src/components/ExecutionOrchestratorCenter.jsx` is structurally the *same component* — same `_load(KEY, SEED)` idiom, same `section`/`toast`/`selected` shape — and **already discloses its seed data** via the shared `SampleDataNotice` plus an `isSample` flag derived from `localStorage.getItem(KEY) === null`. `DevOpsCenterV2.jsx` uses the same shared component in five places. SupportCenter is the sibling that drifted.

**Recover.** `frontend/src/components/SupportCenter.jsx` only. Reused the **existing** `SampleDataNotice` component and the **existing** `isSample` flag idiom, copied from its own sibling. **No new component, no new copy pattern, and the tickets themselves are untouched** — this is disclosure, not suppression.

**Reverify + anti-over-correction (real values, post-fix — live).**

| State | `localStorage` | Notice shown | Tickets rendered |
|---|---|---|---|
| Fresh install (untouched seeds) | `null` | **yes** — *"Showing sample tickets — the counts and SLA figures below are derived from them — no live records yet from your backend."* | **8** |
| After a real write (resolved a ticket) | written | **no** | **8** (preserved) |
| After leaving and remounting | written | **no** (stays cleared) | **8** |

The notice is cleared in `persist()` and nowhere else, so it cannot linger over genuinely operator-owned data.

---

## UNKNOWNs — measured, documented, deliberately NOT "fixed"

These are real observations that recovery-scope rules say must not be silently altered.

**UNKNOWN 1 — `SupportCenter` has a local toast subsystem (`.sc-toast`, 2400 ms).**
Measured in source: `const showToast = m => { setToast(m); setTimeout(()=>setToast(null),2400); }` with a local `.sc-toast` element, versus the app-wide shared `ToastContainer` (3500 ms) that `ConnectorSetupWizard` correctly receives via `onToast={addToast}`. This is the **5th+** confirmed local toast subsystem; A.11.2–A.11.6 already documented 4+ as UNKNOWN because converting them is **re-wiring, not in-place recovery**. Documented, not re-wired, consistent with prior sub-phases.

**UNKNOWN 2 — `CustomerSuccessCenter` is entirely inline-styled with hardcoded dark-mode colors.**
`rgba(255,255,255,0.03)` panels, `#e8ecf5` text, `#7c6fff`/`#52d68a`/`#f0b429` KPI colors — no CSS file, no design tokens for most values, so it does not participate in the light/dark theming the rest of the app uses. Converting it to a stylesheet + tokens is a **restyle of an entire component**, i.e. a redesign, explicitly out of scope. Only the **page header** — a targeted, measurable baseline conformance issue — was recovered. The rest is documented here.

**UNKNOWN 3 — `SupportCenter`'s Knowledge Base articles and SLA/Analytics tabs are static constants with no backend at all.**
`KB_ARTICLES` is a hardcoded array with invented `views`/`helpful` figures and no fetch anywhere. Unlike the tickets (which are at least localStorage-backed and now disclosed), there is no real data source to degrade to and no `isSample` transition that could ever occur. Surfacing this honestly would require either a backend or new copy asserting these are examples — the former is new engineering, the latter risks over-correcting a surface whose ticket-level disclosure now already fires. Documented for A.11.8 to rule on.

**UNKNOWN 4 — Launch Platform's `Success` / `Feedback` / `Readiness` / `Benchmark` sub-tabs render very little content.**
Measured live: `Success` 36 chars, `Benchmark` 70, `Readiness` 82, `Feedback` 99, against `Onboarding` 529 and `Docs` 460 — with **zero page errors** on every tab. Whether these are genuinely near-empty states, gated states, or under-populated panels could not be determined without operator-only data I do not have, and no observed behaviour proved a defect. Recorded as UNKNOWN rather than guessed at.

---

## Negative results — bug classes hunted hard and genuinely NOT found

Reported as real results, not padding. Each is pinned by a regression assertion so it cannot silently regress.

**N1 — Connector "Not connected" is HONEST, not a false claim.** This looked at first like an exact repeat of A.11.6's Service Health finding: the Integrations screen showed **all 9 providers "Not connected"** while `GET /health` on the same backend returned `{"whatsapp":true,"payments":true,"telegram":true}`. **Reading the real route resolved it as two different scopes, both truthful:** `/health` reports the **founder's platform-wide, env-var-backed** connectors, whereas `/my-connectors` reports **this organization's own vault-scoped** credentials (`backend/routes/myConnectors.js`'s own docstring makes this distinction explicit). The real payload for this org genuinely returns `connected:false` with per-field `present:false` for every provider. **This is the honest answer, and the screen states it correctly.** Had I trusted the surface resemblance to A.11.6 instead of reading the route, I would have manufactured a finding and made a truthful screen lie.

**N2 — Customer Success under a TOTAL failure was already correct.** Aborting *all* `/customer-org/**` requests produced `⚠ Failed to fetch` + a `Retry` button, with the tabs not rendered at all — no false zeros. Only the **partial** failure path (Finding 1) was broken. The distinction is real and was measured, not assumed.

**N3 — Launch Platform already degrades honestly for unknown values.** Its `fmt()` is `n => n === undefined || n === null ? "–" : n.toLocaleString()`, and a missing snapshot leaves `Loading dashboard…` rather than fabricating zeros; NPS renders `–` when `score === null`. **Its visible zeros are REAL**, confirmed against the live backend: `GET /launch/dashboard` genuinely returns `beta:0, activeWeek:0, activeMonth:0, totalAiRequests:0, day7:0, activation.rate:0` alongside the non-zero `mrrUsd:782` / `total:553` it also displays. No change made.

**N4 — `ConnectorSetupWizard` uses the SHARED `ToastContainer`.** Measured live: submitting the connector form empty produced a real `.toast-container > .toast.toast--error` with `Enter at least one credential`. `App.jsx` wires `<ConnectorSetupWizard onToast={addToast} />`. Not a local subsystem — unlike Finding-adjacent `SupportCenter` (UNKNOWN 1).

**N5 — `r.ok` is CORRECT here and was not "fixed".** Both `/my-connectors` (`_ok` → `{ok:true,...}`) and `/customer-org/*` (`ok()` → `{ok:true,...}`) genuinely send `ok`. Per the mission's rule, the route files were read first. The regression asserts these are **not** blind-swapped to `success`.

**N6 — the `.someEntityId` vs real `.id` class is genuinely ABSENT on these surfaces.** Checked every list render in scope: `CustomerSuccessCenter` keys on `h.customerId` / `t.id` / `r.customerId` and the real payloads genuinely carry those exact fields (verified against live responses); `ConnectorSetupWizard` keys on `p.id` and `f.key`, both real. No mismatch found.

**N7 — every one of the 63 `MORE_TABS` destinations already has a ⌘K `NAV_ACTIONS` entry.** Enumerated programmatically across both registries: **0 missing destinations**. A.11.1's 12-destination fix and the subsequent phases genuinely closed that gap. Only *keyword* drift remains (listed for A.11.8).

**N8 — all 14 Launch Platform sub-tabs render with zero page errors**, and all 9 connector cards render from the real payload with zero page errors.

---

## The 8 matrices

### 1. UX Consistency

| Surface | Layout | Typography | Buttons | Inputs | Loading | Empty states | Verdict |
|---|---|---|---|---|---|---|---|
| Launch Platform | tabs + content pane | **was: no header** → fixed | consistent `launch-tab` | NPS + feedback inputs real | `Loading dashboard…` (honest) | `–` placeholder (honest) | **fixed** |
| Connectors (Integrations) | header + grouped cards | conformant | `csw-btn primary/danger` | labelled, password/text | `Loading connectors…` | `csw-empty` w/ real error | **fixed** (confirm) |
| Support Center | header + strip + tabs | conformant | `sc-chip`/`sc-tab` | reply textarea | n/a (local) | n/a | **fixed** (disclosure) |
| Customer Success | inline-styled pane | **was 18px/700** → fixed | unstyled native buttons (UNKNOWN 2) | none | `Loading customer success dashboard…` | **was false** → fixed | **fixed** |
| Referral / Marketplace / Partners / Getting Started | conformant | conformant | consistent | — | — | honest | consistent |

### 2. Design System vs prior A.11.1–A.11.6 baselines (drift flagged)

| Token / rule | Baseline (A.11.1–A.11.6) | Launch Platform | Customer Success | Support / Connectors / Referral / Marketplace / Partners |
|---|---|---|---|---|
| Page title size | **22px** | ❌ absent → ✅ 22px | ❌ 18px → ✅ 22px | ✅ 22px |
| Page title weight | **800** | ❌ absent → ✅ 800 | ❌ 700 → ✅ 800 | ✅ 800 |
| Page title tracking | **-0.3px** | ❌ absent → ✅ -0.3px | ❌ normal → ✅ -0.3px | ✅ -0.3px |
| Page title color | `var(--text)` | ✅ | ✅ | ✅ |
| Subtitle size | **13.5px** | ❌ absent → ✅ 13.5px | ❌ absent → ✅ 13.5px | ✅ 13.5px |
| Subtitle color | `var(--text-dim)` | ✅ | ✅ | ✅ |
| Unknown placeholder | `—` / `–` | ✅ already (`fmt`) | ✅ (KPIs already used `—`) | ✅ |
| Destructive confirm | `ConfirmDialog`/`useConfirm` | n/a | n/a | ❌ absent → ✅ wired |
| Toast | shared `ToastContainer` 3500ms | n/a | n/a | ✅ Connectors; ⚠ Support local (UNKNOWN 1) |
| Sample-data disclosure | `SampleDataNotice` | n/a | n/a | ❌ absent → ✅ Support |

### 3. Navigation

| Check | Result |
|---|---|
| All in-scope destinations reachable via More menu | ✅ 8/8 on first survey |
| Breadcrumb / group assignment | ✅ all in `Enterprise` / `Growth` / `Account` groups, consistent |
| Launch Platform sub-tab navigation | ✅ all 14 switch correctly, 0 errors |
| Customer Success sub-tab navigation | ✅ 3/3 |
| Connector card expand/collapse | ✅ (also keyboard-operable, see matrix 6) |
| Back-nav / tab restore | ✅ leaving and returning re-fetches correctly |

### 4. Loading

| Surface | Pattern | Honest? |
|---|---|---|
| Launch Platform Dashboard | plain text `Loading dashboard…` | ✅ (a failed fetch stays in loading, never fabricates zeros) |
| Connectors | plain text `Loading connectors…` | ✅ |
| Customer Success | plain text `Loading customer success dashboard…` | ✅ |
| Customer Success (error) | `⚠ {error}` + `Retry` | ✅ |
| Support Center | none (local state, instant) | ✅ n/a |

Drift noted: the whole scope uses **plain-text loading**, no skeletons. This is internally consistent across all four surfaces, so it is recorded as a consistent choice, not a defect.

### 5. Search (⌘K coverage of MY destinations)

| Query | Pre-fix | Post-fix |
|---|---|---|
| `Launch Platform` | ✅ | ✅ |
| `roadmap` / `feedback` / `academy` / `onboarding` | ✅ | ✅ |
| `Customer Success` | ✅ | ✅ |
| `Integrations` | ✅ | ✅ |
| `Support` | ✅ (`Support OS`) | ✅ |
| **`Support Center`** | ❌ **`No commands found`** | ✅ `["Support OS"]` |
| `ticket` | ❌ Product OS only | ✅ Support **first** |
| `sla` | ❌ Support absent | ✅ Support **first** |
| `escalation` / `helpdesk` | ❌ empty | ✅ `["Support OS"]` |
| `knowledge base` (neg. control) | `Knowledge Base` first | ✅ unchanged |
| `billing` / `crm` / `engineering` (neg. controls) | correct | ✅ unchanged |
| `churn` / `customer health` | ❌ empty | ❌ empty — **left alone**, out of my fix scope; noted for A.11.8 |
| `whatsapp` / `razorpay` | ❌ empty | ❌ empty — see A.11.8 list |

### 6. Keyboard

| Check | Result |
|---|---|
| Connector card header operable by keyboard | ✅ `role="button"`, `tabIndex={0}`, `Enter`/`Space` handled (pre-existing) |
| ConfirmDialog focus management | ✅ focus moves to confirm button (`focusedIsConfirm: true`), restored on close |
| ConfirmDialog **ESC** cancels | ✅ measured live — dialog closes **and credential preserved** |
| ConfirmDialog **Enter** confirms | ✅ bound in `ConfirmDialog.jsx` |
| ConfirmDialog `role`/`aria-modal` | ✅ `dialog` / `true` |
| ⌘K open/close | ✅ `Meta+K` opens, `Escape` closes |
| Connector inputs | ⚠ labels are `<label>` without `for`/`id` and inputs are not wrapped — no programmatic association. **Pre-existing, not introduced here; a11y, not UX-consistency.** Noted for A.11.8. |

### 7. Feedback

| Check | Result |
|---|---|
| Connector save success | ✅ shared toast `Connector saved` |
| Connector validation (empty submit) | ✅ shared toast `.toast--error` `Enter at least one credential` — immediate, on submit |
| Connector disconnect | **was: silent destruction** → ✅ `ConfirmDialog` + shared toast `Disconnected` |
| Destructive styling | ✅ `cdialog-danger`, `csw-btn danger` |
| Support Center toasts | ⚠ local `.sc-toast` 2400 ms (UNKNOWN 1) |
| Customer Success feedback | ⚠ `Refresh` button shows `Refreshing…`; ticket resolve shows `…` — no toast at all (consistent within the component) |

### 8. AI Honesty

| Claim made by the UI | Traceable to real state? | Verdict |
|---|---|---|
| Connectors: "Not connected" ×9 | ✅ real `/my-connectors` per-provider payload, org-scoped | **honest** (N1) |
| Connectors: "✓ Connected" | ✅ flips only on a real vault write, verified against backend | **honest** |
| Launch Platform: `BETA USERS 0`, `AI REQUESTS 0`, `7-DAY RETENTION 0%` | ✅ real `/launch/dashboard` genuinely returns these zeros | **honest** (N3) |
| Launch Platform: NPS `–` | ✅ real `null` → placeholder | **honest** |
| Launch Platform: `Loading dashboard…` on failure | ✅ never fabricates | **honest** |
| **Customer Success: "No health records yet."** on a failed fetch | ❌ **backend held 20** | **FALSE → fixed** |
| **Customer Success: "No support tickets yet."** on a failed fetch | ❌ **backend held 20** | **FALSE → fixed** |
| Customer Success Overview KPIs | ✅ real `/customer-org/dashboard`; already used `?? "—"` | **honest** |
| Customer Success on total failure | ✅ `⚠ Failed to fetch` + Retry | **honest** (N2) |
| **Support Center: 8 tickets + SLA/Avg-wait/Analytics** | ❌ **fabricated seeds, undisclosed** | **→ fixed (disclosed)** |
| Support Center: KB article view/helpful counts | ❌ static constants, still undisclosed | **UNKNOWN 3** |

---

## Reachable surfaces NOT covered by any A.11 sub-phase — for the A.11.8 cross-product sweep

Swept live in this phase; each is **reachable and rendering**, but outside A.11.1–A.11.7's named scopes. Measured values included so A.11.8 does not have to re-derive them.

**Page-header baseline non-conformers (measured live, NOT fixed here — out of scope):**

| Surface | Tab id | Measured header | Baseline | Note |
|---|---|---|---|---|
| **Legal OS** | `legalos` | **no `h1`/`h2` at all**; pane rendered only **17 chars** total | 22px/800/-0.3px | Same "no page header" class as Finding 3. Also worth an honesty check: `LegalOSCenter.jsx` uses the same `{ok:true}` envelope and a similar `setDocuments(d.documents || [])`-on-failure collapse as Finding 1. |
| **Beta Checklist** | `betachecklist` | **no `h1`/`h2`**; 2841 chars rendered | 22px/800/-0.3px | Emitted **two real 403s** while rendering — check whether it asserts state it cannot fetch (the A.11.6 class). |
| **Overview** | `overview` | `h2.cap-title` **20px / 700 / -0.3px**, subtitle **13px** | 22px/800/-0.3px, 13.5px | Same class as A.11.6's Reports fix. |

**Other observations for A.11.8:**

- **Marketplace** emitted **three real HTTP 402 (Payment Required)** responses while rendering, yet displayed only `All0` / `0` with **155 chars** and no visible explanation. Header conforms; the question is whether a payment-gated empty state is disclosed honestly or silently rendered as "zero plugins".
- **12 `MORE_TABS` entries carry an `alias` with no matching ⌘K `keywords`** (registry drift, the A.10.7/A.11.6 class). Deliberately **not** bulk-patched, per A.11.6's explicit instruction: `settings`, `help`, `activity`, `reliability`, `copilot`, `devops`, `observer`, `creative`, `growth`, `contentseo`, `companies`, `team`.
- **⌘K has no coverage for connector/provider vocabulary** — `whatsapp`, `razorpay`, `stripe`, `notion`, `jira`, `linear` all return `No commands found`, though Integrations is the real destination for all of them. Also `churn` and `customer health` return nothing despite Customer Success being the real destination. Left alone here because widening those risks the over-broad capture the negative controls exist to prevent; A.11.8 should rule.
- **`IntegrationCenter.jsx`** (the operator-only Integrations surface, `user?.role === "operator"`) was **never rendered in this phase** — the audit account is role `user`, so it is genuinely unreachable without an operator session. **Untested, not passed.** A.11.8 should either obtain an operator session or record it as out of reach.
- **Connector form inputs lack programmatic label association** (`<label>` without `for`, inputs not wrapped). Pre-existing accessibility gap, not a UX-consistency drift; recorded rather than fixed.
- **Plain-text loading everywhere in this scope** (no skeletons) — internally consistent here, but A.11.8 may want to compare against the skeleton-using surfaces elsewhere in the app.

---

## Regression

**Test:** `tests/security/88-launch-integrations-support-customer-success-ux-consistency.cjs`

**Final clean run: `PASS 42  FAIL 0  SKIP 0`.**

`npm run test:runtime`: **`tests 144 / pass 144 / fail 0 / skipped 0 / todo 0`** (duration 4215 ms).

The test is split into PART A (static, source-level) and PART B (**live**, real browser + real backend). Live coverage includes: real `getComputedStyle()` header measurement on two surfaces, a real credential written to and deleted from the real org vault, real transport-layer abort injection, real ⌘K driving, and real backend cross-checks of ground truth.

**Honest SKIP policy.** `todo()` is used only for genuine environmental blocks after real retries with exponential backoff, tallied **separately** and explicitly **NOT counted as passes**. `ok()` is never called from a catch branch. The catch classifiers were deliberately **tightened during the prove-it-can-fail cycle** (see below) so that only "could not reach the surface" is environmental — a surface that rendered but failed a measurement now **fails loudly**.

### Tooling verification (the A.11.6 lesson, applied — and it caught two real bugs in my own test)

The test asserts several "must NOT contain X" properties. Those must run against real **code**, not against my own explanatory comments. Two assertions **genuinely failed on the first runs for exactly this reason**:

1. `must not fall back to raw window.confirm` — failed because the string `window.confirm` appeared in **my own new comment** explaining the fix.
2. `must not invent a --font-ui token` — failed because `--font-ui` appeared in **my own new CSS comment** explaining why I avoided it.

Both were fixed by adding a deliberately conservative comment stripper, and — critically — a **`verifyStrip()` guard that asserts known-present real code survived the strip** before any negative assertion is trusted. This is precisely the failure mode A.11.6 documented (its regex silently deleted ~13 KB of real JSX). A green result from an unverified stripper is not trusted here.

A third self-inflicted issue was caught and fixed: my test's `goTab` helper left the More-menu/palette open between steps, which made a later navigation silently no-op and reported **"Integrations never rendered"** — while a dedicated diagnostic probe (`p10_diag_integrations.js`) proved the surface rendered **9 cards reliably in every ordering, including the test's exact sequence, with zero page errors**. Diagnosed as a **harness bug, not a product finding**, and fixed by resetting menu state before each navigation. Had I accepted the first result, I would have filed a false defect.

### Prove-it-can-fail — both runs, with the exact LIVE assertions that failed

All five fixes were reverted in the working tree, the suite re-run, then all five restored and the suite re-run clean.

**Run 1 (all fixes reverted, full suite):** aborted immediately in PART A —
`AssertionError: health must be set to null (unknown) on a failed fetch, not []`.
This proved the statics fail, but **static failure alone is not the bar** — it prevented the LIVE assertions from ever executing. So:

**Run 2 (all fixes reverted, PART A statics disabled so PART B LIVE assertions actually execute):**

`PASS 3  FAIL 5  SKIP 0` — **all five LIVE assertion groups genuinely failed:**

| # | LIVE assertion that failed | Real failure message |
|---|---|---|
| 1 | Launch Platform header | `Launch Platform rendered but has NO page header (.launch-title) — the regression this fix closed` |
| 2 | Customer Success header | `CS title font-size 18px` → **`'18px' !== '22px'`** |
| 3 | Connector confirm gate | `clicking Disconnect must raise the in-app ConfirmDialog` |
| 4 | ⌘K | `⌘K 'Support Center' must not return the 'No commands found' empty state` |
| 5 | SupportCenter disclosure | `untouched seed tickets must carry the SampleDataNotice disclosure` |

**Run 3 (reverted; CS header asserts additionally disabled to reach the honesty asserts behind them):** the highest-value assertion was isolated and **failed with the real numbers**:

> **`FALSE CLAIM: health fetch genuinely failed but UI said 'No health records yet.' (backend really has 20)`**

Notably, in that same run the **anti-over-correction control passed even on reverted code** (`a real successful load renders real records, claims neither unknown nor empty`), which proves that control is a genuine independent check and not tautologically tied to the fix.

**An important correction made because of this exercise:** in the first reverted run, findings 1 and 2 were initially mis-reported as **environmental SKIPs** rather than failures, because my retry guards treated "the fixed element is missing" as "the surface hasn't loaded". That would have let two real regressions pass silently as skips. The guards were rewritten to gate on a **fix-independent** render signal (`button.launch-tab` presence, not `.launch-title`), after which the same reverted code produced **5 FAIL / 0 SKIP**. This is exactly the "do not trust a green result you haven't sanity-checked" requirement, applied to the skip tally.

**Run 4 (all fixes restored):** `PASS 42  FAIL 0  SKIP 0`, and `npm run test:runtime` **144/144**.

---

## Files changed

| File | Change |
|---|---|
| `frontend/src/components/CustomerSuccessCenter.jsx` | Finding 1 (unknown vs real zero) + Finding 3 (page header) |
| `frontend/src/components/ConnectorSetupWizard.jsx` | Finding 2 (destructive confirm via existing `useConfirm`) |
| `frontend/src/components/LaunchPlatform.jsx` | Finding 3 (page header markup) |
| `frontend/src/components/LaunchPlatform.css` | Finding 3 (page header rules, baseline values) |
| `frontend/src/components/CommandPalette.jsx` | Finding 4 (additive `keywords` on `nav-supportos` only) |
| `frontend/src/components/SupportCenter.jsx` | Finding 5 (existing `SampleDataNotice` + `isSample`) |
| `tests/security/88-launch-integrations-support-customer-success-ux-consistency.cjs` | New regression (42 assertions, 5 LIVE groups proven failable) |

**No new components were created. No backend file was modified. No backend restart was performed. Nothing was merged or pushed.**
