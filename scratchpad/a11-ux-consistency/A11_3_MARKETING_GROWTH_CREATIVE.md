# Phase A.11.3 — Marketing + Growth + Creative Studio UX Consistency Certification

**Product:** Ooplix (repo: `/Users/ehtsm/jarvis-os`, branch `security/reality-completion`)
**Method:** Real browser (Playwright/Chromium, `node <script>.js` from repo root), a real authenticated account (reused A.11.2's `crm_auth_state.json`-family session `crm_auth_state_a112.json` — `jarvis_auth` cookie for `a112audit17861283563381@ooplixtest.com`, org `org_1786128365893_o`, verified valid with `exp` at `2026-08-08T02:46:06Z`, so **no fresh signup was needed and the 5/15min/IP registration rate limiter was never touched in this sub-phase**), real clicks, real `getComputedStyle()` measurements, real network interception on every `/content/*`, `/distrib/*`, `/growth/*` and `/creative/*` request, real screenshots. Code was read only after real, observed behavior in the browser prompted a consistency check, then cross-checked against a reference instance elsewhere per Reproduce→Measure→RootCause→Recover→Regression→Reverify.
**Environment:** frontend `http://localhost:3000`, backend `http://localhost:5050`, both already running (verified via `lsof`). The backend was restarted three times **by this phase, deliberately**, purely to load the backend-side fix in Finding 2 and to run the prove-it-can-fail cycle — each restart was followed by a real `/health` 200 confirmation before continuing.
**Scope:** Content & SEO (`ContentSEO.jsx` — all 10 sub-tabs: Dashboard, Blog Studio, SEO Command, Repurpose, Landing Pages, Docs, Calendar, Keywords, Brand Voice, Benchmark), Distribution (`DistributionOS.jsx` — all 10 sub-tabs including Publisher and Analytics), Creative Studio (`CreativeStudio.jsx` — all 8 sub-tabs including Images), Growth OS (`GrowthOS.jsx` — all 10 sub-tabs), and Campaigns as it appears on the Marketing side (Distribution → Campaigns; **the CRM-side `CampaignsView` was A.10.3/A.11.2 scope and was not re-litigated**).

---

## Summary

**2 genuine inconsistency classes found and fixed**, both provable behavioral divergences from patterns this codebase already establishes, both live-measured before and after. **3 additional real, measured findings documented but correctly left unfixed** (UNKNOWN / out of recovery scope).

Equally important, and stated plainly because the mission asks for honesty over manufactured findings: **the systemic contract-drift class this sub-phase was specifically sent to hunt is NOT present in this scope.** A.10 fixed `.leadId`→`.id` and `.campaignId`→`.id`; A.11.2 found the same class still live in `.contactId` and `.oppId`. I checked every list key, every mutation handler and every response-shape check across all four in-scope components against the real backend services that produce each record. Both patterns came back clean here — details and evidence in the "Negative findings" section below, which is not padding but the actual result of the primary hunt.

The two real findings are instead a **feedback-honesty** divergence (a real backend failure rendered in the success green) and a **data-honesty** divergence (one account's screen showing another account's counts).

---

## Finding 1 — Growth OS rendered real backend ERROR text in the success green, making a genuine failure visually identical to a genuine success

**Reproduce.** Operated Growth OS as a real user. Went More menu → search "growth" → "Growth" → Email tab → "+ New" → created a real email campaign ("A113 Error Toast Probe" / "A113 probe subject") through the real form → the real campaign persisted (confirmed by direct `GET /growth/email/campaigns` from the page context: `id: "ecm-1786134885004-s8wtg"`, `status: "draft"`, real `orgId`) → clicked that campaign row's **Send** button. Network interception was active on every `/growth/*` request; a high-frequency (80 ms) DOM poll captured the toast's real computed style within its real 3 s lifetime.

**Measure (real values, pre-fix).**

| | Real value measured live |
|---|---|
| Request fired | `POST /growth/email/campaigns/ecm-1786134885004-s8wtg/send` |
| HTTP status | **400** |
| Real response body | `{"error":"Email campaign sending is not available: CRM leads in this deployment have no email address field (phone/WhatsApp-first CRM), so there is no real recipient list to send to. Configure a real audience with real email addresses via /growth/audiences to enable sending."}` |
| Toast text shown | that same real error message, verbatim |
| **Toast computed `color`** | **`rgb(34, 197, 94)`** |
| Toast appeared / duration | 124 ms after click / **3001 ms** |
| Toast has type icon | **No** |
| Toast has close button | **No** |

Control measured in the same session, same component, same toast element — a genuine **success** (Archive a campaign → real `PATCH /growth/email/campaigns/… → 200`):

| | Real value |
|---|---|
| Toast text | `Campaign archived` |
| **Toast computed `color`** | **`rgb(34, 197, 94)`** |
| Duration | 3009 ms |

**The two are byte-identical.** A real, blocking 400 failure and a real success were indistinguishable to the user by any visual property — same colour, same position, same duration, no icon, no prefix.

**Root Cause.** `frontend/src/components/GrowthOS.jsx` defines a local `useToast()` that renders every message through one `<span className="gos-toast">`, and `frontend/src/components/GrowthOS.css` hardcoded that class to `color: #22c55e` — the file's success green (the same value used by `.gos-title`, `.gos-tab.active`, `.gos-btn`). But **six handlers in that same file deliberately route real backend failures through the same toast**, and their code comments show this was intentional error-surfacing work from a prior phase:

| Line | Handler | Code |
|---|---|---|
| 199 | Email campaign send | `if (r?.error) { toast(r.error); return; }` |
| 371 | SMS campaign send | `if (r?.error) { toast(r.error); return; }` |
| 395 | OTP send | `if (r?.error) { toast(r.error); return; }` |
| 529 | WhatsApp broadcast send | `if (r?.error) { toast(r.error); return; }` |
| 1033 | CSV audience import (error branch) | `if (r?.error) { toast(r.error); }` |
| 1040 | CSV audience import (catch branch) | `catch (e) { toast(e.message \|\| "Import failed"); }` |

The error *plumbing* was correct and deliberate — the error *presentation* was not. The line-199 handler even carries the comment *"this was silently reporting 'Campaign sent!' for a call that failed"*, i.e. a previous phase fixed the message but never the styling, so the message became honest while still *looking* like a success.

This is a divergence from three conventions the codebase already establishes:
- **GrowthOS.css itself** already defines `#ef4444` as its error colour, in 6 places (`.gos-chip-red`, `.gos-btn-sm--danger`, `.gos-btn-sm--danger:hover`, `.gos-campaign-row.gos-row-fail`, …). The red existed; the toast just never used it.
- **The sibling `CreativeStudio.css`** already renders every failure through `.cs-error-inline` / `.cs-result-error` / `.cs-error` in `var(--danger, #ef4444)` — measured, red, clearly a failure.
- **The sibling `DistributionOS.jsx`** already makes its failure toasts read as failures by prefixing them: `toast(\`Error: ${r.error}\`)` (lines 173, 300) and `toast(\`Blocked: ${r.reason}\`)` (line 655), and its `.do-toast` is a type-neutral accent purple (`rgba(124,111,255,.18)` on `var(--do-accent)`) rather than a success green — so it never asserts success on a failure.

Growth OS was the single surface in this family where a real failure was styled as a real success.

**Recover.** Two files, minimal, no new component and no new toast system:
- `frontend/src/components/GrowthOS.jsx` — `useToast()` gained an **optional second argument** `type` defaulting to `"success"`, and its rendered span conditionally appends a `.gos-toast--error` modifier. Because the argument is defaulted, **every one of the existing single-argument success call sites is byte-unchanged**. The 6 error call sites above now pass `"error"`.
- `frontend/src/components/GrowthOS.css` — added one rule, `.gos-toast--error { color: #ef4444; }`, using **this file's own already-established error red**, and deliberately left the base `.gos-toast` success green untouched.

Zero new components, zero new backend routes, zero schema changes, zero restyle of the success path.

**Regression.** `tests/security/84-marketing-growth-creative-ux-consistency-error-toast-color-asset-stats-scoping.cjs`, Finding 1 sections. Static: asserts the premise still holds (≥6 genuinely error-carrying call sites exist — so if a future refactor removes them, the test says so loudly rather than asserting a meaningless colour), asserts every one of them is typed, asserts the defaulted argument shape, asserts the conditional modifier, asserts the CSS rule uses `#ef4444`, asserts the base success green was **not** changed, asserts `#ef4444` was already this file's convention (≥4 pre-existing uses) so the fix provably didn't invent a value, and cross-checks that `CreativeStudio.css` genuinely already renders failures in `var(--danger)`. Live: creates a real campaign through the real UI, clicks Send, asserts the real request genuinely returned ≥400, then asserts on the **real computed colour of the real rendered toast**. Plus a **control assertion** that a real success still measures `rgb(34, 197, 94)` — the assertion that would catch an over-eager fix reddening everything.

**Reverify (real values, post-fix).** Identical flow, identical real 400, same session:

| | Pre-fix | Post-fix |
|---|---|---|
| Toast class | `gos-toast` | `gos-toast gos-toast--error` |
| **Toast computed `color`** | **`rgb(34, 197, 94)`** | **`rgb(239, 68, 68)`** |
| Toast text | (identical real error) | (identical real error) |
| Duration | 3001 ms | 3027 ms (unchanged) |
| Success control (`Campaign archived`) | `rgb(34, 197, 94)` | **`rgb(34, 197, 94)`** (unchanged) |

---

## Finding 2 — Creative Studio showed OTHER accounts' asset counts directly above this account's own honest "No assets yet" empty state

**Reproduce.** More menu → "creative" → Creative Studio → **Assets** sub-tab. Screenshot and DOM capture showed the stat row reading **"32 Total assets · 0 Favorites · 20 image files · 1 audio files · 10 document files · 1 video files"** and the folder filter offering **"image (20), audio (1), exports (10), video (1)"** — while the list area directly below rendered the component's honest empty state, **"No assets yet. Generate something!"**, with zero rows.

**Measure (real values, pre-fix).** Fetched the real endpoint from the real page context with the real session cookie:

```
GET /creative/assets  →  { assets: [], stats: { total: 33, favorites: 0, folders: 6, tags: 18,
                                                byType: { image: 21, audio: 1, document: 10, video: 1 } } }
GET /creative/assets/folders → [ uncategorized:0, image:20, audio:1, exports:10, video:1, benchmark:1 ]
```

| | Real measured value |
|---|---|
| Assets actually returned for this account | **0** |
| `stats.total` returned alongside them | **33** |
| Rendered asset rows | 0 |
| Rendered empty state | "No assets yet. Generate something!" |
| Rendered stat card | "32 Total assets" |

The 33 assets belong to entirely different accounts — enumerated live from the real index: `7cb11ebe03c9036e8c19070d` (3 assets), `test-creative-race-1786094520954` (4), `test-creative-race-1785796031873`, `repro-creative-race-1785795973494`, `verify_zbc_roundtrip`, `verify_imgproc_user`, `verify_video_user`, `operator`, `test-user`, and 33 with a `null` owner.

**Root Cause.** `backend/services/creativeAssetLibrary.cjs` establishes account scoping in `listAssets()`:

```js
if (opts.accountId)  list = list.filter(a => a.accountId === opts.accountId);
```

But its three sibling read functions in the same file — `getStats()`, `getFolders()`, `getTags()` — took **no account argument at all** and counted every asset in the shared index (`Object.values(idx.assets)`, `Object.entries(idx.folders)`). `backend/routes/creativeStudio.js` then returned both shapes in one response:

```js
const list  = assets.listAssets(opts);   // account-scoped
const stats = assets.getStats();         // GLOBAL
res.json({ ok: true, assets: list, stats });
```

`GET /creative/workspace` had the identical mix: account-scoped `recentAssets`/`favoriteAssets` rendered beside global `assetStats`/`folders`/`tags`. Because `AssetsPanel` renders the stat row and the asset list on the same screen, the user saw one account's counts sitting on top of another account's (empty) list.

This is the same "the correct scoping convention exists in this very file, three sibling functions just never adopted it" shape as A.11.2's Finding 3, and it is a **data-honesty** issue rather than a purely cosmetic one — it is the AI Honesty matrix's own standard applied to counts: the screen asserted the user has 32 assets when the user has 0.

**Recover.** Two files, applying the file's own existing convention:
- `backend/services/creativeAssetLibrary.cjs` — `getStats(accountId)`, `getFolders(accountId)`, `getTags(accountId)` now take the **same optional `accountId` that `listAssets()` already accepts** and filter identically via a small shared `_scoped()` helper. Passing no `accountId` preserves the previous global behavior exactly, so no unscoped internal caller breaks.
- `backend/routes/creativeStudio.js` — the 5 call sites now pass the account each route **already computes for its list** (`opts.accountId` / `accountId` / `_account(req)`).

Zero new routes, zero new components, zero schema changes, zero frontend changes — the frontend was already rendering correctly; it was being handed dishonest numbers.

**Regression.** Test 84, Finding 2 sections. Static: asserts `listAssets()` still filters by `accountId` (the premise), asserts all three functions now take an `accountId`, asserts the `_scoped()` helper implements optional filtering (guarding the no-breaking-change property), asserts both routes pass it, and asserts **zero** unscoped `getStats()/getFolders()/getTags()` calls remain anywhere in `creativeStudio.js`. Service-level live: loads the **real** asset library and asserts `stats.total` genuinely equals the real per-account list length for **every real owning account** in the index (6 checked), asserts a never-seen account gets honest zeros, asserts its folder counts are all zero, and asserts the no-argument path still returns the real global total. Browser live: fetches the real endpoint from the real page and asserts `stats.total === assets.length`, `sum(byType) === assets.length`, `sum(folderCounts) <= assets.length`, plus an assertion on what the user actually **sees** on the rendered page.

**Reverify (real values, post-fix).** Same account, same endpoint, after a real backend restart:

| | Pre-fix | Post-fix |
|---|---|---|
| Assets returned | 0 | 0 |
| `stats.total` | **33** | **0** |
| `stats.byType` | `{image:21, audio:1, document:10, video:1}` | `{}` |
| Folder counts | `[0, 20, 1, 10, 1, 1]` | `[0, 0, 0, 0, 0, 0]` |
| Rendered UI | "32 Total assets" above "No assets yet" | honest empty state, **no contradicting stat card** |

Cross-checked that owning accounts are unharmed: `7cb11ebe03c9036e8c19070d` → list 3 / `stats.total` 3; `test-creative-race-1786094520954` → list 4 / `stats.total` 4. Unscoped `getStats()` still returns the real global 33.

---

## Negative findings — the systemic drift classes this sub-phase was sent to hunt are genuinely NOT present here

These are reported as real results, with the evidence that produced them, rather than omitted.

### The `.someEntityId` → `.id` field-mismatch class: **CLEAN in this scope**

Enumerated every React list key across all four in-scope components (`grep -ohE 'key=\{[a-z]+\.[a-zA-Z]+\}'`): **54 of 62 are `.id`**. Every one of the 8 non-`.id` keys was traced to the real backend service that produces that record and confirmed to be a genuinely existing field:

| Key | Where | Real backend source | Verdict |
|---|---|---|---|
| `p.jobId`, `r.jobId` (×3) | DistributionOS Executive + Performance | `snapshotPerformance()` genuinely writes `jobId` onto every snapshot; `getRepublishRecommendations()` genuinely returns `{ jobId, title, score, … }` | **real field** |
| `r.accountId` | DistributionOS Executive leaderboard | `referralEngine.getLeaderboard()` returns `{ accountId, invites, totalEarned }` | **real field** |
| `r.referrerId` | DistributionOS Referral leaderboard | `distributionEngine.getReferralLeaderboard()` builds `{ referrerId, invites, conversions }` | **real field** — and correctly a *different* field from the row above, because they come from two genuinely different services |
| `p.targetId` | ContentSEO Repurpose | `contentSEOEngine` maps over `targets` producing `targetId` | **real field** |
| `p.platform`, `o.platform`, `ch.channel`, `m.tag`, `f.name` | various | real natural keys on real records | **real** |

Crucially, `createPublishJob()` assigns `id: _id("pub")` and the frontend reads `j.id` for every job action — the exact shape that was broken in Leads/Campaigns/Contacts/Opportunities is **correct here**. No `/undefined/` URL was observed in any intercepted request across the entire audit.

### The `r.ok` vs `r.success` response-shape class: **NOT APPLICABLE in this scope, and verified rather than assumed**

`ContentSEO.jsx`, `DistributionOS.jsx` and `GrowthOS.jsx` all check `r.ok !== false`. In CRM that would have been the bug — but these are **different backend route files with a genuinely different envelope**, verified by reading each one:

```js
backend/routes/contentSEO.js:30    function _ok(res, data) { res.json({ ok: true, ...data }); }
backend/routes/distribution.js:30  function _ok(res, data) { res.json({ ok: true, ...data }); }
backend/routes/growthOS.js:34      function _ok(res, data) { res.json({ ok: true, ...data }); }
backend/routes/creativeStudio.js   res.json({ ok: true, … })   (inline, throughout)
```

versus `backend/routes/business.js`'s `res.json({ success: true, ...data })`. So `r.ok` is the **correct** check on all four in-scope surfaces. This is the same distinction A.11.2 correctly drew for `ReasoningView` against `graph.js`. Additionally, the `!== false` form is defensive: an error response (`{error: "..."}`) has `ok === undefined`, and `undefined !== false` is `true`, so it falls through — which is why these surfaces *also* check `r.error` explicitly where it matters. Verified: **zero** bare `if (r.ok)` truthiness bugs and zero false-error toasts observed live across ~40 real mutations in this audit.

### Destructive-action confirmation: **no unguarded irreversible delete exists in this scope**

`grep -n "DELETE\|apiDel\|method: \"DELETE\"" ` across all four components → **zero matches**. The only removal affordance is GrowthOS's **Archive** (5 sites: campaigns ×2, automations, audiences, templates), which is a reversible `PATCH { status: "archived" }` plus a list-view filter — the record is never destroyed. Per A.11.2's own explicit scoping rule (gate *irreversible record deletions*, do **not** gate reversible/state-transition actions, since gating those "would be inventing new friction"), these are correctly left unguarded. Adding a `ConfirmDialog` here would have been manufacturing a finding.

---

## Documented but NOT fixed (real, measured — listed separately, not silently dropped)

### UNKNOWN-A — The Growth family runs four parallel local toast systems, none of which is the shared `ToastContainer`

**Measure (real values, all measured live in one session).**

| Property | Shared `ToastContainer` (A.11.1/A.11.2 baseline) | `.cseo-toast` | `.do-toast` | `.gos-toast` | Creative Studio |
|---|---|---|---|---|---|
| Implementation | shared `Toast.jsx` + `Toast.css`, passed via `onToast` prop | local 5-line `useToast()` in `ContentSEO.jsx` | local `useToast()` in `DistributionOS.jsx` | local `useToast()` in `GrowthOS.jsx` | **no toast at all** — inline `.cs-error` / `.cs-error-inline` blocks |
| Position | `fixed; bottom: 24px; right: 20px; z-index: 9999` | **`static`** (inline in the section header) | `static` | **`static`** (measured at x=255, y=208 — mid-page) | inline, in document flow |
| Auto-dismiss | **3500 ms** | 3000 ms | 3000 ms | **3001–3027 ms** (measured) | persists until dismissed/replaced |
| Padding | `13px 16px` | `0px` (bare text span) | `4px 10px` | `0px` (bare text span) | `10px 14px` |
| Border radius | `var(--radius)` | none | `5px` | none | `var(--radius-sm, 6px)` |
| Type icon (`✓ ✕ ℹ ⚠`) | Yes | **No** | **No** | **No** | ⚠ on the no-connector block |
| Manual dismiss (✕) | Yes | **No** | **No** | **No** | Yes (on `.cs-error`) |
| Exit animation | Yes (`toast-out`) | **No** | **No** | **No** | **No** |
| Success/error distinction | Yes (4 typed variants) | n/a (never carries errors) | by text prefix ("Error:"/"Blocked:") | **FIXED this phase** | Yes (separate red blocks) |

**Why not fixed.** This is the identical shape as A.11.2's UNKNOWN-A (Payments' parallel toast), scaled to four components. Converting them would mean changing each component's call signature in `App.jsx` to accept `onToast`, threading a new prop through 30+ nested panel components, deleting four working local subsystems and their CSS — a re-architecture of four currently-functional surfaces, not an in-place recovery of a drifted value. Documented with full measurements. **Note that Finding 1 above was fixed precisely because it was *not* this**: it was a single hardcoded colour value inside one already-working local system, correctable in place using that system's own existing red, with no signature change and no component deleted.

### UNKNOWN-B — The whole Growth family uses plain-text loading, never the shared `<Skeleton/>` that CRM's 8-of-9 sub-tabs use

**Measure (real values).** Static scan of every loading branch in scope, plus live capture at 120 ms after each of 38 sub-tab clicks:

| Component | Loading treatment | CSS |
|---|---|---|
| `ContentSEO.jsx` | `if (!dash?.dashboard) return <div className="cseo-loading">Loading…</div>` | `.cseo-loading { font-size: 12px; color: var(--cseo-muted); padding: 20px; }` |
| `DistributionOS.jsx` | `<div className="do-loading">Loading…</div>` | `.do-loading { color: var(--do-muted); padding: 24px; text-align: center; }` |
| `GrowthOS.jsx` | `<div className="gos-loading">Loading dashboard…</div>` | `.gos-loading { font-size: 12px; color: #555; padding: 20px; }` |
| `CreativeStudio.jsx` | `<div className="cs-empty">Loading workspace…</div>` / `<div className="cs-empty">Loading…</div>` | reuses the **empty-state** class |
| *(reference)* CRM, 8 of 9 sub-tabs | shared `<Skeleton/>` | `.bos-skeleton-wrap` |

Creative Studio additionally reuses `.cs-empty` for both its loading and its genuine no-data state, making the two visually indistinguishable — the exact issue A.11.2 flagged in `ReasoningView`, here present in a whole component.

**Why not fixed.** Unlike a single drifted outlier, this is a **uniform convention across all four in-scope components** — there is nothing here that has drifted *from* its own neighbours. Every Growth surface loads the same way as every other Growth surface. Converting them to the shared `<Skeleton/>` would be introducing a new pattern to a self-consistent family, i.e. homogenizing an intentional cross-family difference, which the mission explicitly prohibits. Recorded with exact measurements as a real product-wide observation for a future deliberate decision.

### UNKNOWN-C — Every form in scope is placeholder-only; zero `<label>` elements across all 38 sub-tabs

**Measure (real values).** Live `document.querySelectorAll('label').length` across all 38 in-scope sub-tabs: **0**, on every one, with the single exception of GrowthOS's "Enable A/B Test" checkbox (a checkbox label, not a field label). Every field relies entirely on placeholder text with the required marker inlined into the placeholder string — measured examples: `"Title *"`, `"Campaign name *"`, `"Subject line *"`, `"Focus keyword"`, `"URL slug"`, `"Meta description (150-160 chars)"`, `"Article body (or leave blank and use AI prompt below)"`.

**Why not fixed.** This is the exact continuation of A.11.2's UNKNOWN-C. The convention is 100% internally consistent across this scope *and* matches CRM's six forms, so nothing here is a drifted outlier — the labelled convention exists only on the Payments page. Adding labels would mean adding new UI elements to 40+ inputs across four components, explicitly prohibited. (The real accessibility cost noted by A.11.2 — the placeholder disappears on focus and is not reliably announced as a field name — applies identically here, recorded as fact supporting a future deliberate decision, not as a unilateral fix.)

**Additional minor measured notes (not counted as findings):**
- **Silent validation no-op.** Submitting Blog Studio's "Create Article" with an empty Title, and Distribution's "Create Job" with empty Title/Content, produced **zero network requests and zero feedback of any kind** — measured live (`EMPTY-SUBMIT → toast: null, reqs: 0`). This is the guard `if (!form.title) return;` doing its job safely, and it is applied uniformly across all create handlers in scope, so it is internally consistent. A.10.3 already documented this on Distribution and correctly declined to fix it (adding a validation toast would be new UI). Re-confirmed unchanged, still consistent, still not fixed.
- **Duplicate initial fetches.** Every list endpoint fired exactly twice on mount across all four components (e.g. `GET /content/articles` ×2, `GET /creative/assets` ×2). Root-caused to React StrictMode's intentional dev-mode double-invocation of effects, not a product defect — `useContent`/`useGrowth`/`useDistrib` each have a correctly-memoized `useCallback` with a proper dependency array. Not a finding.

---

## Matrix 1 — UX Consistency Matrix (per-surface, real measured values)

| Surface | Sub-tabs | Sub-tab metrics | Primary button | Section title | Loading | Empty state | Destructive confirm |
|---|---|---|---|---|---|---|---|
| **Content & SEO** | 10 | `8px 12px`, `r0`, `11px/400`, active `rgb(124,111,255)` + `2px` bottom border | `.cseo-btn` `6px 14px`, `r4px`, `12px/600`, solid `rgb(124,111,255)`, white text | `.cseo-section-title` `13px/600`, none-transform (3 of 10 panels) | plain text `.cseo-loading` | honest, 5 of 10 tabs; "No articles yet. Create your first AI-powered post." | n/a (no delete) |
| **Distribution** | 10 | `6px 11px`, `r6px 6px 0 0`, `11px/500`, active `rgb(124,111,255)` + `2px` bottom border | `.do-btn-sm` `3px 8px`, `r4px`, `11px/500` | `.do-section-title` `13px/700` (3 of 10 panels) | plain text `.do-loading` | honest, 9 of 10 tabs; "No publish jobs. Create your first one-click multi-platform post." | n/a (no delete) |
| **Growth OS** | 10 | `4px 10px`, `r4px`, `11px/400`, active `rgb(34,197,94)` on `rgb(15,46,30)` | `.gos-btn` `7px 16px`, `r4px`, `11px/700`, solid `rgb(34,197,94)`, dark text | `.gos-section-title` `13px/700` | plain text `.gos-loading` | honest, 5 of 10 tabs; "No audiences. Create a list, segment, or dynamic audience." | n/a (Archive is reversible) |
| **Creative Studio** | 8 | `7px 14px`, `r0`, `12px/400`, active `rgb(124,111,255)` + `2px` bottom border | `.cs-btn-primary` `9px 20px`, `r10px`, `13px/600`, solid `rgb(124,111,255)`, white text | `.cs-section-title` `11px/700` **uppercase** | plain text, reuses `.cs-empty` | honest, 2 of 8 tabs; "No assets yet. Generate something!" | n/a (no delete) |
| *(reference)* CRM (A.11.2) | 9 | — | `8px 16px`, `r10px`, `13px/600`, tinted-ghost `rgba(78,205,196,.15)` | `.bos-section-title` uniform | shared `<Skeleton/>` (8 of 9) | honest, all | `ConfirmDialog` (fixed A.11.2) |

**Empty-state quality — measured across all 38 in-scope sub-tabs: PASS, no drift.** Every empty state found is truthful and names a real next action ("Create your first AI-powered post.", "Snapshot published jobs to see performance rankings.", "Add Discord, Telegram, Reddit, or GitHub Discussions to your hubs."). None implies hidden data. Tabs with no empty state are read-only dashboards/benchmarks that genuinely always have content. This matches A.11.2's CRM finding exactly.

**Primary-button treatment — measured, judged intentional.** Growth OS uses solid green, the other three use solid purple, CRM uses tinted-ghost teal. Each is 100% internally consistent within its own surface and each surface's accent is its identity colour throughout (Growth OS's `--gos` green appears in its title, active tab, focus ring and button alike). This is surface-level identity, not a drifted instance — same conclusion A.11.2 reached for Payments' purple vs CRM's teal. **Not flagged.**

## Matrix 2 — Design System Matrix (this scope's real values vs the A.11.1 / A.11.2 baselines)

| Token / property | A.11.1 baseline | A.11.2 (CRM / Payments) | A.11.3 measured (Growth family) | Drift? |
|---|---|---|---|---|
| Radius scale | `xs:6 sm:10 base:14 md:18 lg:22 xl:28 pill:999` (`index.css` `:root`) | CRM `10px` = `--radius-sm` ✓; Payments `8px`/`12px` hardcoded ✗ | ContentSEO `4px`, Distribution `4–6px`, GrowthOS `4px`, Creative `10px` — **all hardcoded except Creative's `10px`** | **Yes** — but uniform across the family, same situation as Payments; a whole-file retheme, not a drifted site. Not fixed |
| Primary button metrics | Nav tab `5px 11px` / `r7px` / `13px` / `500` | CRM `8px 16px` / `r10px` / `13px` / `600` (identical ×6) | `6px 14px`/`r4px`/`12px/600`; `7px 16px`/`r4px`/`11px/700`; `9px 20px`/`r10px`/`13px/600` | Three different metrics across three components; each internally consistent. **Creative Studio alone matches the design-token radius (`10px`)** |
| Primary button treatment | — | CRM tinted-ghost teal; Payments solid purple | solid purple ×3, solid green ×1 | Surface identity, not drift (see Matrix 1 note) |
| Section padding | — | CRM `20px 20px 32px` identical on all 9 | `.gos-content`/`.cseo-content` `16px`, `.do-content` `16px` — uniform within family | No intra-family drift |
| **Toast** | `bottom:24px right:20px`, 3500 ms, shared `Toast.jsx` | CRM shared ✓; Payments own `pv2-toast`, 3000 ms ✗ | **four** parallel local systems, all `position: static`, 3000 ms, no icon/close/exit-anim | **Yes** — UNKNOWN-A, fully measured |
| **Toast error colour** | typed variants (`--success`/`--error`/`--info`/`--warn`) | CRM shared typed ✓ | `.cseo-toast` green (never carries errors — correct); `.do-toast` neutral purple + text prefix; `.gos-toast` **green on real errors** → **FIXED**; Creative separate red blocks | **Was yes for GrowthOS — FIXED (Finding 1)** |
| Design-token usage | `ExecutiveDashboard.css` 56 `var(--…)` vs 40 hardcoded | `BusinessOS.css` majority-token; `PaymentsV2.css` partial | ContentSEO/Distribution use **file-local** `--cseo-*`/`--do-*` vars (a local palette, not the global scale); GrowthOS fully hardcoded hex; CreativeStudio uses global `var(--danger)`, `var(--radius-sm)`, `var(--accent2)` with fallbacks | Family is largely locally-tokenised; Creative Studio is the closest to the global system |
| Section title | heading sizes hand-set per component, no shared scale token | CRM `.bos-section-title` uniform | `13px/600`, `13px/700`, `13px/700`, `11px/700 uppercase` — Creative Studio is the outlier | Matches A.11.1's finding that there is no shared heading-scale token — nothing to have drifted *from*. Not flagged |
| Breadcrumbs | shared `Breadcrumbs` (App.jsx) | PASS on every CRM sub-tab | `Dashboard › Growth › <Module>` — **PASS on all four**, screenshot-confirmed | No drift |

## Matrix 3 — Navigation Matrix

| Element | Result |
|---|---|
| Breadcrumbs | **PASS** — shared `Breadcrumbs`; measured live as `Dashboard›Growth›Content & SEO`, `…›Distribution`, `…›Growth`, `…›Creative Studio`. All four correctly grouped under GROWTH |
| Sub-tab bars (10/10/10/8) | **PASS** — each driven by a single array → one `.{prefix}-tab` map; identical styling within each surface, consistent active-state treatment (accent colour + border), no per-tab special-casing anywhere |
| Sub-tab state on navigate-away/back | Local `useState`, returns to the first tab on remount — identical to CRM's behavior. Consistent; not flagged |
| More-menu discovery | **PASS** — all four found on the first natural term: "content"→Content & SEO, "distribution"→Distribution, "creative"→Creative Studio, "growth"→Growth. All tagged `Growth 📍` |
| ⌘K → in-scope destinations | **PASS** — live-verified through the real `.palette-trigger`: "content"→Content & SEO, "seo"→Content & SEO, "distribution"→Distribution, "creative"→Creative Studio, "growth"→Growth. A.11.1's registry fix genuinely covers this scope; static diff confirms `contentseo`/`distribution`/`creative`/`growth`/`referral` are all present in `NAV_ACTIONS` |
| ⌘K → *sub-tab* terms ("blog", "campaign") | Not indexed — **correctly consistent**: verified the More menu doesn't index them either (both return 0 for `campaign`/`blog`). Neither surface indexes any module's sub-tabs anywhere in the app. Not a gap, same conclusion as A.11.2 |
| Marketing-side Campaigns vs CRM-side Campaigns | Two genuinely distinct entities on distinct backends (`/distrib/campaigns` multi-channel launch orchestration vs `/business/campaigns` CRM marketing campaigns), each reachable from its own module. Not a duplication defect |
| Cross-module jump | No cross-module links exist in this scope; none are broken |

## Matrix 4 — Loading Matrix

| Surface | Pattern | Measured |
|---|---|---|
| Content & SEO | plain text `.cseo-loading "Loading…"` | 12px, `var(--cseo-muted)`, `padding: 20px` |
| Distribution | plain text `.do-loading "Loading…"` | `var(--do-muted)`, `padding: 24px`, centered |
| Growth OS | plain text `.gos-loading "Loading dashboard…"` | 12px, `#555`, `padding: 20px` |
| Creative Studio | plain text, **reusing `.cs-empty`** ("Loading workspace…" / "Loading…") | loading and no-data states visually indistinguishable |
| In-flight button state | Content & SEO Repurpose + GrowthOS Analytics + Creative Studio use a real `loading`/`busy` state; Creative's `.cs-btn-primary` disables during generation | real, consistent where present |
| *(reference)* CRM | shared `<Skeleton/>` on 8 of 9 | — |

**Family is 4/4 internally consistent** (plain text everywhere) but diverges wholesale from the CRM/Dashboard skeleton convention — UNKNOWN-B, deliberately not homogenized. Creative Studio's reuse of the empty-state class for loading is the one genuine intra-family wrinkle, noted in UNKNOWN-B.

## Matrix 5 — Search Matrix

| Surface | Search present | Behavior |
|---|---|---|
| Creative Studio — Assets | **Yes** — `.cs-search`, placeholder `"Search…"` | Real server-side `search` param on `GET /creative/assets`; filters prompt/tags/folder. Real type + folder filter selects alongside |
| Content & SEO | No text search; **8 real category filter pills** on Blog Studio, intent filter on Keywords | Consistent with CRM's filter-pill-only views |
| Distribution | No text search; real status filter pills per panel | Same convention |
| Growth OS | No text search; real status filters + archived-record filtering | Same convention |
| More menu | All 4 found on the first natural term | **PASS** |
| ⌘K | All 4 found on the first natural term | **PASS** — A.11.1's fix holds |
| Keyboard focus into search | ⌘K input (`.cp-input`) receives focus on open; Escape closes it — both live-verified | **PASS** |

Search availability tracks real backend capability (only the asset library exposes a `search` predicate), exactly as A.11.2 found for CRM Contacts vs Leads. Not a frontend divergence.

## Matrix 6 — Keyboard Matrix

| Interaction | Result |
|---|---|
| ⌘K from within any in-scope module | **PASS** — live-verified, global handler unaffected by module |
| Escape closes the Command Palette from within these modules | **PASS** — live-verified (`.cp-input` gone from the DOM after Escape) |
| Escape closes an in-scope inline form | **Not implemented** — every form in scope is an inline card in document flow, never an overlay. The app's Escape convention is scoped to overlays (`CommandPalette`, `ConfirmDialog`, post-A.11.1 `EndOfDayReview`). Identical to CRM's inline forms. Consistent; not flagged |
| Enter submits an in-scope form | **Not implemented** — no `<form>` element or `onKeyDown` submit handler in any of the four components. Uniformly absent, so internally consistent and consistent with CRM. Adding it would be new behaviour, not recovery |
| Create-form auto-focus | **Absent across all four** — unlike CRM's 5 forms which call `setTimeout(() => ref.current?.focus(), 50)`. Uniform within this family; a real cross-family difference, not an intra-family drift. Recorded, not fixed (adding it to 4 components is new behaviour) |
| Cmd/Ctrl+Enter submits the Creative Studio prompt textarea | **Present** — real `onKeyDown` handler confirmed in source (A.10.3 also found this). The only workflow hotkey in scope |
| Focus visible on inputs | **PASS** — every in-scope input defines a real `:focus` border-colour change to its surface accent (`.gos-input:focus { border-color: #22c55e }`, `.cseo-input`, `.do-input`) |

## Matrix 7 — Feedback Matrix

| Pattern | Where | Consistency |
|---|---|---|
| Success toast | all four surfaces | **PASS within each surface** — every create/update action produces a real confirmation ("Article created", "Publish job created", "Campaign archived", "Topic cluster created"). Live-measured at 3001–3027 ms |
| **Error toast styling** | Growth OS | **FIXED (Finding 1)** — real backend error text measured at `rgb(34,197,94)` (success green) → now `rgb(239,68,68)` |
| Error toast text quality | Distribution, Growth OS | **PASS** — real backend messages surfaced verbatim, prefixed "Error:"/"Blocked:" in Distribution. No `undefined` text observed anywhere in this scope |
| Error surfacing (non-toast) | Creative Studio | **PASS** — `.cs-error` (dismissible, red, `var(--danger)`), `.cs-error-inline`, `.cs-result-error` |
| **Stat/count honesty** | Creative Studio Assets + Workspace | **FIXED (Finding 2)** — showed 33 assets against a real 0 |
| Destructive confirmation | — | n/a — **no irreversible delete exists in this scope** (verified: zero DELETE call sites). Archive is a reversible `PATCH` and is correctly not gated |
| Silent validation no-op | Blog Studio, Publisher, all create forms | Uniform `if (!form.x) return;` guard with no message. Internally consistent across all 4 components; A.10.3 already declined to fix. Unchanged |
| Toast position/duration/icon/close | all four | **Divergent from the shared `ToastContainer`** — UNKNOWN-A, 10 properties measured |

## Matrix 8 — AI Honesty Matrix

| Surface | Honest? | Evidence (real, measured) |
|---|---|---|
| **Creative Studio — image/video/voice generation** | **YES** | A.10.3's fix is intact and verified in source: `ResultCard` reads `result.output.generationError` and renders the real upstream error verbatim ("⚠ Generation failed: {genError}. Credits were still charged (N). Check the connected provider's API key/quota — below is a text description only."), falling back to the generic no-connector message **only** when no real generator exists. The `.cs-badge--noroute` "no file" badge on asset rows carries the honest title *"No real file was generated for this asset — description only."* No fabricated media, no fake success |
| **Creative Studio — asset counts** | **WAS NO → FIXED** | Pre-fix the Assets tab asserted "32 Total assets · image 20 · exports 10" to an account owning **0** — measured live. This is the AI-honesty standard applied to counts: the screen stated something about the user's data that was not true. Post-fix, measured `stats.total: 0` matching the real `assets: []` |
| **Growth OS — send/broadcast/OTP** | **YES** (and now legibly so) | The real 400 body is surfaced verbatim, and it is itself unusually honest: *"Email campaign sending is not available: CRM leads in this deployment have no email address field (phone/WhatsApp-first CRM), so there is no real recipient list to send to."* The product declines to fake a send. Pre-fix that honest message merely *looked* like a success — Finding 1 fixed the presentation, not the content. WhatsApp broadcast correctly reports real partial failure (`"Broadcast sent — N delivered, M failed"`) |
| **Content & SEO — SEO Technical Audit** | **YES** | Re-confirmed A.10.3's finding: all 20 checklist items honestly render status `unknown` with *"Not yet verified — run audit against live site"* for a fresh account with no live URL to crawl. No invented scores |
| **Content & SEO — Dashboard / Traffic Projection** | **YES** | Real computed aggregates, and the forecast states its methodology inline: *"~120 organic visits/published article/month at average 1% CTR from search"* — a transparent, checkable assumption rather than an opaque number |
| **Distribution — Analytics / Performance AI** | **YES** | 11-platform comparison table renders honest zeros where nothing has really published; Performance AI says *"Snapshot published jobs to see performance rankings."* rather than inventing rankings. Republish recommendations derive from real snapshot scores |
| **All 38 sub-tabs — empty states** | **YES** | Every empty state measured is truthful and names a real next action; none implies hidden or pending data |
| **Benchmark panels (all 4)** | **YES** | Report real pass/fail per check with real detail strings (Creative Studio measured live: "88% Ready · 7/8 checks", with the failing check genuinely shown as failing, not rounded away) |

**One AI-honesty violation found in this scope (Creative Studio's asset counts) — fixed.** Every other AI-labelled or data-asserting surface showed real output, a real honest-failure message, or a real self-disclosure about its own limits.

---

## Fix Summary

| # | File | Change | Sites |
|---|---|---|---|
| 1 | `frontend/src/components/GrowthOS.jsx` | `useToast()` gained an optional defaulted `type`; 6 error call sites now pass `"error"` | 7 (1 hook + 6 calls) |
| 1 | `frontend/src/components/GrowthOS.css` | added `.gos-toast--error { color: #ef4444; }` using the file's own existing error red; base success green untouched | 1 |
| 2 | `backend/services/creativeAssetLibrary.cjs` | `getStats`/`getFolders`/`getTags` now accept the same optional `accountId` `listAssets()` already accepts, via a shared `_scoped()` helper | 4 (3 fns + 1 helper) |
| 2 | `backend/routes/creativeStudio.js` | 5 call sites now pass the account each route already computes | 5 |

**Four files touched.** Zero new components, zero new routes, zero schema changes, zero restyled intentional differences, zero changes to any success path. Both fixes recover a convention this codebase already establishes and uses elsewhere.

## UNKNOWN / Documented-Not-Fixed Summary

| # | Area | Why not fixed |
|---|---|---|
| A | Four parallel local toast systems, none the shared `ToastContainer` (10 measured property differences) | Requires re-wiring four components' prop signatures in `App.jsx` + threading through 30+ nested panels + deleting four working subsystems — a re-architecture, not an in-place recovery |
| B | Whole Growth family uses plain-text loading, never the shared `<Skeleton/>` | Uniform across all four in-scope components — nothing has drifted from its own neighbours. Converting would homogenize an intentional cross-family difference, explicitly prohibited |
| C | Zero `<label>` elements across all 38 sub-tabs; placeholder-only forms | 100% internally consistent and matches CRM. Adding labels to 40+ inputs is adding new UI, explicitly prohibited. Continuation of A.11.2's UNKNOWN-C |

Additional measured notes recorded but not counted as findings: uniform silent-validation no-ops on empty required fields (consistent, A.10.3 already declined); duplicate initial fetches (React StrictMode dev-mode double-invocation, not a product defect); absent create-form auto-focus across the family (a real cross-family difference from CRM, uniform within this family).

---

## Regression

**New test:** `tests/security/84-marketing-growth-creative-ux-consistency-error-toast-color-asset-stats-scoping.cjs` — **32 passed, 0 failed, 0 skipped** on the certifying run, with **all live checks genuinely exercised** (no skips were needed — the backend was responsive at the moment of the final run).

Breakdown: 15 static assertions (including cross-checks that read the **real backend source** to confirm the response envelope and record shape each fix depends on, and a cross-check that reads a **sibling component's CSS** to prove the convention being applied genuinely pre-exists), 4 service-level live assertions against the **real asset index** (asserting list/stats agreement for every real owning account), and 13 browser-live assertions driven through the real UI with real network interception and real `getComputedStyle()` measurement.

**Anti-soft-pass verification (performed, not merely claimed).** The test was validated by deliberately reintroducing **both** bugs — reverting `.gos-toast--error` to `#22c55e` (so error toasts fall back to the success green) and reverting `GET /creative/assets` to the unscoped `assets.getStats()` — restarting the real backend, and re-running.

**Result: 24 passed, 8 failed, 0 skipped.**

Critically, **5 of the 8 failures came from the live sections**, driven by real interactions:
- the real Send fired, really returned an error, and the real toast was measured at **`rgb(34, 197, 94)`** instead of `rgb(239, 68, 68)` — the exact pre-fix value from the original investigation, reproduced by the test itself;
- the failure toast was measured carrying class `"gos-toast"` without the error modifier;
- the real `/creative/assets` response was measured returning **`stats.total: 33` against `assets: []`** — again the exact pre-fix value;
- `byType` was measured summing to 33 against 0 returned assets.

The remaining 3 failures were static assertions correctly detecting the reverted source. The fixes were then restored, the backend restarted, and the test returned to **32 passed, 0 failed, 0 skipped**. The live assertions therefore provably fail when the fix regresses; they are not try/catch shims. Every live check sits behind a real retry loop with backoff, and every genuinely unreachable path calls `todo()` (which increments a separate `skipped` counter and is reported in its own section) rather than `ok()`.

*Note on an earlier failing run, recorded rather than hidden:* the test's first execution reported **25 passed, 1 failed, 2 skipped**. The failure was real and the test was right to raise it — but investigation showed it was a flaw in the **assertion**, not the fix: the regex counting error call sites was matching this phase's own explanatory code comment, which quotes the pre-fix `toast(r.error)` shape verbatim, producing 7 counted sites against 6 typed. The assertion was corrected to strip comment lines before counting. The two skips were also diagnosed rather than suppressed: one was a genuine test-navigation weakness (the campaign-creation retry could leave the form view open, where no Send button can exist — fixed by explicitly returning to the list view each attempt); the other was the test asking for a "Total" stat card that, **post-fix and correctly**, no longer renders for an account owning nothing — rewritten to assert that honest outcome directly, which is itself the user-visible result of Finding 2.

**Full suite:** `npm run test:runtime` → **tests 144, suites 50, pass 144, fail 0, cancelled 0, skipped 0, todo 0** — the established A.10/A.11 baseline exactly, no regressions introduced.
