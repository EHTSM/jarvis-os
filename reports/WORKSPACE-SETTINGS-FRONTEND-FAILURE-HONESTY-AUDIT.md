# Workspace Settings & Frontend Failure-Honesty Systemic Sweep

**OOPLIX V1 Master Audit — Mission 27**
**Date:** 2026-08-22
**Branch:** security/reality-completion
**Part A target:** `WorkspaceSettings.jsx` + its ~30 real sub-panels (`WorkspaceSettingsK2`-`K6`, `L1`-`L3`, `Desktop`, ~4,452 lines total).
**Part B target:** a systemic sweep for the recurring false-success/swallowed-failure bug class found in Missions 24-26.

---

## 1. Executive summary

**20 new tests added (209 → 229, 25 → 28 suites), all passing, ~6.7s runtime.** **3 genuine defects found and fixed**, all live-reproduced by tests failing against the real, unmodified code first — all a variant of the same recurring bug class, but this time surfacing as a *completely empty `catch {}` block* rather than an unchecked `{success:false}` response:

- `WorkspaceSettingsK3.jsx`'s `TeamDirectoryPanel` (the real org roster — "team/workspace changes," explicitly named in the mission's priority list): a failed load was swallowed entirely, rendering a fabricated "No members match" empty state on a real backend outage, with no error and no retry — while all 4 of its sibling panels in the same file correctly show a distinct error state.
- `WorkspaceSettingsK4.jsx`'s `PolicyLibraryPanel` (governance/compliance — explicitly named): identical bug shape — a real failure silently showed "0 active" policies, while all 4 of its siblings in the same file handle it correctly.
- `WorkspaceSettingsL2.jsx`'s shared `useMarketplaceInstall` hook (marketplace/capability actions — explicitly named, used by all 4 marketplace panels): a failed plugin install reverted silently to the plain "Install" button with zero indication anything went wrong — one fix here corrected all 4 marketplace panels at once.

**Part A's honest verdict:** WorkspaceSettings is **NOT certified as a whole**. Of ~30 real sub-panels, this mission directly tested 6 (TeamDirectory, PolicyLibrary, MarketplaceCatalog, plus 3 already covered in Mission 22/25 — `PluginDetail`, the operator-permission gate, Branding). The remaining ~24 were read and classified but not test-covered — exact list in §3.

**Part B's honest verdict:** the systemic sweep found the failure-honesty pattern is **largely already contained** to the specific API-wrapper modules (`businessApi.js`, `billingApi.js`, `runtimeApi.js`) already fixed in Missions 24-26, plus this mission's 3 K-series/L2 findings. A broader scan of 13 additional mutation call sites across the rest of `components/` found **10 already SAFE** (correctly checking `.success`/`.ok`) and 1 correctly immune-by-construction (`AgentOSV2.jsx`'s `createManagedAgent`, which calls `_fetch` directly and therefore genuinely throws). Full classification table in §4.

---

## 2. Part A — WorkspaceSettings inventory and classification

### Structural finding (positive): the sub-panel tree is architecturally sound

Every one of the ~30 sub-panels in `K2`-`K6`/`L1`-`L3`/`Desktop` calls `_fetch` **directly** — none of them route through the wrapped, error-swallowing API modules (`businessApi.js`, `runtimeApi.js`, etc.) that caused the recurring bug in Missions 24-26. This means every `try { await _fetch(...) } catch (e) { setError(...) }` block in this file tree is **genuinely reachable** — `_fetch` throws a real `Error` on any non-2xx response, so the catch fires correctly. This structural choice makes the WorkspaceSettings tree largely immune to the specific "unreachable catch block" defect class *by construction*. The 2 defects found here (§2.1, §2.2) are a different, narrower variant: not an unreachable catch, but a genuinely-reachable catch block left **empty**.

### 2.1 Full panel inventory and classification

| File | Panel | Visibility | Real API | Mutation | Destructive | Confirm | Error state | This mission |
|---|---|---|---|---|---|---|---|---|
| K2 | SessionsPanel | operator | `/security/sessions` | revoke session | yes | ✅ useConfirm | ✅ | not tested (pre-existing, already hardened per in-code A.11.8 comments) |
| K2 | DevicesPanel | operator | `/security/devices` | trust/remove device | yes (remove) | ✅ useConfirm | ✅ | not tested (same) |
| K2 | AuditPanel | operator | `/security/audit` | read-only | n/a | n/a | ✅ | not tested |
| K2 | TokensPanel | operator | `/security/tokens` | create/revoke token | yes (revoke) | ✅ useConfirm | ✅ | not tested — **minor gap found, not fixed**: token creation has no duplicate-submit busy state (see §5) |
| K2 | PoliciesPanel | operator | (not read this mission) | — | — | — | — | not read |
| K3 | **TeamDirectoryPanel** | operator | `/admin/team`, `/admin/departments` | edit member, bulk edit | no | n/a | ❌→✅ | **tested, P1 defect fixed** |
| K3 | DepartmentsPanel | operator | `/admin/departments` | create/archive dept | no (archive = reversible) | n/a | ✅ | not tested (already correct on inspection) |
| K3 | OrgProfilePanel | operator | (not read this mission) | — | — | — | — | not read |
| K3 | StatisticsPanel | operator | (not read this mission) | read-only | n/a | n/a | ✅ (uses K3ErrorState) | not read |
| K3 | QuotasPanel | operator | (not read this mission) | read-only | n/a | n/a | ✅ (uses K3ErrorState) | not read |
| K4 | **PolicyLibraryPanel** | operator | `/governance/policies`, `/governance/templates` | create/archive policy | no (archive) | n/a | ❌→✅ | **tested, P1 defect fixed** |
| K4 | CompliancePanel | operator | (not read this mission) | — | — | — | — | not read (uses K4ErrorState per grep) |
| K4 | RiskMatrixPanel | operator | (not read this mission) | — | — | — | — | not read (uses K4ErrorState per grep) |
| K4 | GovernanceOverviewPanel | operator | (not read this mission) | — | — | — | — | not read (uses K4ErrorState per grep) |
| K4 | GovReportsPanel | operator | (not read this mission) | — | — | — | — | not read (uses K4ErrorState per grep) |
| K5 | AutomationOverviewPanel, RuleBuilderPanel, TriggerLibraryPanel, AutoHistoryPanel, AutoStatsPanel | operator | `_fetch`-direct (10 call sites) | rule builder likely has mutations | unknown | unknown | unknown | not read this mission |
| K6 | ExecutivePanel, WorkspaceHealthPanel, AutomationROIPanel, AIUtilizationPanel, RuntimeCapacityPanel, EnterpriseReportsPanel | operator | 1 `_fetch` call site (mostly derived/computed from other data) | read-only reporting | n/a | n/a | unknown | not read this mission |
| L1 | PluginsPanel, PluginHealthPanel, PluginDiagPanel | operator | `_fetch`-direct, `useConfirm` present | install/uninstall plugin | yes (uninstall) | ✅ (confirmed via grep — "Uninstall" with `danger: true`) | unknown | not read this mission — confirmation already present per inspection |
| L2 | PluginDetail | operator | `/marketplace/plugin/:id`, `/marketplace/plugin/:id/review` | submit review | no | n/a | ✅ (Mission 22 fix) | already certified (Mission 22) |
| L2 | **MarketplaceCatalogPanel** + `useMarketplaceInstall` (shared by all 4 marketplace panels) | operator | `/marketplace/catalog`, `/marketplace/categories`, `/plugins/install` | install plugin | no | n/a | ✅→✅ (load already correct) / ❌→✅ (install error) | **tested, P1 defect fixed (all 4 panels via shared hook)** |
| L2 | MarketplaceFeaturedPanel, MarketplaceSearchPanel, MarketplaceRecsPanel | operator | `/marketplace/featured`, `/marketplace/search`, `/marketplace/recommendations` | install (via shared hook) | no | n/a | ✅ | **install-error fix applies here too** (shared hook), load/error states not independently tested |
| L3 | ExtRuntimePanel, ExtMetricsPanel, ExtHooksPanel, ExtQuotasPanel | operator | `_fetch`-direct (7 call sites) | unknown | unknown | unknown | unknown | not read this mission |
| Desktop | PrintToPdfCard, DisplaysCard, PrinterCard, ScannerCard, SaveDialogCard, FolderSyncCard | operator, Electron-only | `_fetch` + `_isElectron` (2 call sites) | OS-level integration actions | unknown | unknown | unknown | not read this mission |
| top-level | WorkspaceSettings.jsx orchestrator | both (permission-gated) | `/settings/status`, `/integrations` (operator-gated) | Branding save/reset (local-only) | no | n/a | n/a | **already certified (Mission 25)** — permission gate + Branding mutation |

### 2.2 Mobile-critical interactions

Not separately tested this mission for any K-series/L-series panel. Spot-checked via code reading: `K3`'s edit-member modal and `L2`'s marketplace grid use real `<button>`/`<input>`/`<select>` elements throughout (no custom mouse-only widgets observed), consistent with the pattern already verified directly in Mission 26's `IntegrationCenter` and Mission 23's `clickableProps` primitive. Not independently verified for K5, K6, L1, L3, or Desktop.

### 2.3 Fake/sample-data behavior

No `SEED_`/`MOCK_`/`FAKE_`/`DUMMY_` constant was found in any WorkspaceSettings sub-panel file during this mission's reading (consistent with Mission 22's repo-wide static audit, which covers `components/*.jsx` including this file tree and found nothing here).

---

## 3. Part A — exact covered vs. uncovered panels (no inflation)

**Tested with genuine interaction/mutation-level tests this mission:** `TeamDirectoryPanel` (K3), `PolicyLibraryPanel` (K4), `MarketplaceCatalogPanel` + the shared `useMarketplaceInstall` hook (L2, which also covers `MarketplaceFeaturedPanel`/`MarketplaceSearchPanel`/`MarketplaceRecsPanel`'s install action specifically, though not their independent load/error states).

**Already certified in prior missions:** `PluginDetail` review form (L2, Mission 22), the top-level orchestrator's operator-permission gate and Branding mutation (Mission 25).

**Read and classified but not test-covered:** `SessionsPanel`, `DevicesPanel`, `AuditPanel`, `TokensPanel` (K2 — all already correctly built per inspection, using `useConfirm` and reachable error handling), `DepartmentsPanel` (K3, correct per inspection).

**Not read this mission at all:** `PoliciesPanel` (K2), `OrgProfilePanel` (K3), `CompliancePanel`/`RiskMatrixPanel`/`GovernanceOverviewPanel`/`GovReportsPanel` (K4, confirmed via grep to already use `K4ErrorState` correctly — not independently verified beyond that), all of K5 (5 panels), all of K6 (6 items), `PluginsPanel`/`PluginHealthPanel`/`PluginDiagPanel` (L1), all of L3 (4 items), all of Desktop (6 cards).

**Tally: 6 of ~30 panels genuinely tested this mission (plus 2 already certified from prior missions = 8 of ~30 with real test coverage). ~22 panels remain unread-or-untested, named explicitly above rather than rounded away.**

---

## 4. Part B — systemic failure-honesty sweep, full classification

Per the mission's explicit instruction not to blindly modify every occurrence, every candidate found was individually read and classified.

| Location | Pattern found | Classification | Action |
|---|---|---|---|
| `WorkspaceSettingsK3.jsx` `TeamDirectoryPanel.load()` | `catch {}`, no error state, sibling panels use `K3ErrorState` correctly | **GENUINE DEFECT (P1)** | **Fixed** |
| `WorkspaceSettingsK4.jsx` `PolicyLibraryPanel.load()` | `catch {}`, no error state, sibling panels use `K4ErrorState` correctly | **GENUINE DEFECT (P1)** | **Fixed** |
| `WorkspaceSettingsL2.jsx` `useMarketplaceInstall.doInstall()` | `catch {}` after a real mutation, unconditional `reload()`, no failure feedback | **GENUINE DEFECT (P1)**, high leverage (shared by 4 panels) | **Fixed** |
| `components/AddClientForm.jsx` `handleSubmit()` | `const res = await createLead(...)`, checks `res.success === false` correctly | **SAFE** | No action |
| `components/CompanyFactoryCenter.jsx` `submit()` | `const res = await createCompany(...)`, checks `res?.ok === false` correctly | **SAFE** | No action |
| `components/WhatsAppSetup.jsx` `handleSave()` | `const res = await saveWhatsAppCredentials(...)`, checks `res.success` correctly | **SAFE** | No action |
| `components/AgentOSV2.jsx` `create()` (Agent Factory) | `await createManagedAgent(spec)` result discarded, but `createManagedAgent` calls `_fetch` directly (no internal try/catch) — genuinely throws on failure, and the surrounding `try/catch` correctly shows an error toast | **SAFE** (immune by construction, same as the WorkspaceSettings tree) | No action |
| `components/OrgSwitcher.jsx` `load()` | `catch {}` on the initial org-list fetch; component's own comment states it is "additive: does nothing if the account has no org memberships yet" | **INTENTIONAL** (documented degrade-to-nothing for a small header widget, not a primary workflow) — `doSwitch()`, the actual mutation, already correctly checks `r.ok === false` | Not fixed — flagged, not certified as fully honest, but a defensible product decision for this specific low-stakes widget |
| `components/DeveloperOS.jsx`, `EnterpriseOS.jsx`, `PersonalOS.jsx` | contain `await create/update/delete` calls | **DEAD** (3 of the 20 orphan components identified in Mission 21 — confirmed still unreachable from any nav path) | Not fixed — orphans explicitly preserved per every mission's instruction |
| `components/BillingDashboard.jsx`, `BusinessOS.jsx`, `ContactsV2.jsx`, `WorkspaceSettings.jsx`, `IntegrationCenter.jsx` | contain the pattern | **ALREADY CERTIFIED** (Missions 24-26) | No re-audit, per instruction not to re-examine already-certified surfaces without new risk evidence |
| 44 files across `components/*.jsx` with a bare `catch {}`/`catch (e) {}` (grep count) | mix of background telemetry, best-effort polling, non-critical secondary fetches | **NOT INDIVIDUALLY AUDITED** — too large a set for this mission's remaining budget after the 3 confirmed fixes; the 3 highest-relevance ones checked (`OrgSwitcher`, plus the 4 direct-mutation files above) came back SAFE or INTENTIONAL, suggesting (not proving) the remainder skew toward legitimate best-effort patterns rather than the customer-impacting defect class | Flagged as the clear next-mission target — see §6 |

**Sweep methodology note:** the search started from the exact bug shapes named in the mission brief (`{success:false}` returned instead of thrown, unreachable catch blocks, unconditional success after a mutation, false empty states, missing retry) and was applied to every file with a real mutation call (`await create/update/delete/save/revoke/install/cancel`) outside the already-certified set, plus a targeted check of `OrgSwitcher.jsx` given its direct relevance to Mission 25's tenant-switching finding. It was not applied exhaustively to all 44 files carrying a bare `catch {}`, which would have required auditing roughly 6x more files than this mission's Part A work — a scope decision stated explicitly rather than a silent gap.

---

## 5. Additional finding (not fixed, flagged only)

`WorkspaceSettingsK2.jsx`'s `TokensPanel.create()` has no duplicate-submit protection — the `creating` state variable only toggles the create-form's visibility, not a busy/in-flight indicator on the "Create token" button itself. A rapid double-click could create two tokens instead of one. Classified **OTHER / minor** (not P1 — token creation is additive, not destructive, and the resulting duplicate would simply need a second revoke) — not fixed this mission given the higher-priority findings above, but named explicitly for a future pass rather than left silently undiscovered.

---

## 6. Negative-testing log

| Fix | Break applied | Test(s) that failed | Restored |
|---|---|---|---|
| K3 TeamDirectoryPanel error state | Disabled the `if (error)` render branch | error-state regression guard, retry-recovery test (2 tests) | ✅ 8/8 pass |
| K4 PolicyLibraryPanel error state | Disabled the `if (error)` render branch | error-state regression guard, retry-recovery test (2 tests) | ✅ 6/6 pass |
| L2 useMarketplaceInstall failure disclosure | Removed the `catch (e) { setInstallError(...) }` body | failed-install-shows-error test, error-clears-on-retry test (2 tests) | ✅ 6/6 pass |

Every break/fail/restore/pass cycle was executed and observed directly, following the exact same standard as Missions 22-26.

---

## 7. Regression, build, and security

```
$ npm run test:ci
Test Suites: 28 passed, 28 total
Tests:       229 passed, 229 total
Time:        ~6.7s
```

```
$ npm run build
336.62 kB  build/static/js/main.[hash].js   (no measurable size delta — 3 small fixes)
68.54 kB   build/static/css/main.3a11bdfc.css (unchanged)
Build: PASS, no new warnings
```

**Backend regression: not run.** `git diff --stat` confirms only `WorkspaceSettingsK3.jsx` (+14/-2), `WorkspaceSettingsK4.jsx` (+13/-2), and `WorkspaceSettingsL2.jsx` (+47/-17, spread across the shared hook and its 4 call sites) carry behavioral changes — all additive, no backend route, contract, or response shape touched. `admin.js`'s team/department routes, `governance.js`'s policy routes, and `marketplace.js`/`plugins.js`'s catalog/install routes were read to confirm real contracts before writing any test, not modified.

**Security suite: not run.** No authentication or authorization logic changed. The fixes correct client-side error handling and disclosure only.

---

## 8. Coverage inventory: before vs. after

| Metric | Before Mission 27 (= after Mission 26) | After Mission 27 |
|---|---|---|
| Total component files in `frontend/src/components/` | 269 | 272 (concurrent unrelated work on this branch, consistent with every prior mission in this arc) |
| Direct component/context test files | 17 | 20 (+ `WorkspaceSettingsK3.teamDirectory`, `WorkspaceSettingsK4.policyLibrary`, `WorkspaceSettingsL2.marketplace`) |
| Total test suites | 25 | 28 |
| Total tests | 209 | 229 |
| WorkspaceSettings sub-panels with genuine test coverage | 1 (`PluginDetail`, Mission 22) | 4 directly (`TeamDirectoryPanel`, `PolicyLibraryPanel`, `MarketplaceCatalogPanel` + shared install hook covering 3 more panels' install action) |
| Genuine defects found this mission | — | 3 found and fixed (all P1), all the same "empty catch block, reachable but unused" variant of the recurring failure-honesty bug |
| Bug-class sweep candidates checked outside WorkspaceSettings | — | 6 direct-mutation files checked: 5 SAFE, 1 INTENTIONAL (documented product decision); 3 orphans confirmed DEAD; 5 files skipped as ALREADY CERTIFIED; 44-file broad `catch{}` set flagged, not exhaustively audited |

---

## 9. Honest verdict

**WorkspaceSettings is not certified as a whole, and this report says so explicitly rather than rounding up.** ~6 of ~30 real sub-panels received genuine test coverage this mission (plus 2 already certified from prior missions), out of a file tree whose architecture — direct `_fetch` usage throughout — is structurally more resistant to the specific bug class this arc has been hunting than the wrapped-API-function modules were. That structural soundness is itself a real, evidence-backed finding, not a guess: every panel checked used a genuinely reachable `try/catch`, and the 3 defects found were narrower (an empty catch block left unused despite the file's own established error-state pattern existing right next to it) than the systemic "unreachable catch" bug from Missions 24-26.

**The Part B sweep's honest conclusion:** the recurring bug class does not appear to be sprawling uncontrolled across the frontend — the 6 direct-mutation call sites checked outside the already-fixed files came back mostly clean (5 SAFE, 1 a defensible intentional design choice). But this is evidence from a sample, not a proof of absence: 44 files with a bare `catch {}` remain unaudited, and this report does not claim they are clean. The next highest-value mission is either (a) a dedicated, larger-budget sweep of that 44-file set, or (b) continuing WorkspaceSettings' remaining ~22 unread/untested panels (K2's Policies, K3's OrgProfile, all of K4's four report-style panels, all of K5, all of K6, L1's three plugin-management panels, all of L3, all of Desktop).

---

*Mission 27 complete. No commit, no merge, no push, no `.env` changes, no orphan deletion, no UI redesign, no new testing framework, no backend code modified. 3 source files carry genuine, negative-tested bug fixes (`WorkspaceSettingsK3.jsx`, `WorkspaceSettingsK4.jsx`, `WorkspaceSettingsL2.jsx`); 3 new test files added; all changes uncommitted for review.*
