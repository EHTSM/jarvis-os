# 16 — Frontend UX (Phase 6)

## Headline finding: several Mission 49 "OPEN/UNFIXED" items are now stale

Mission 49 (2026-08-24) listed 4 P1s and several P2s as unfixed. Direct code
inspection (2026-08-28) shows **all checked items are now fixed**, attributed
via in-code comments to "Mission 46"/"Mission 58"/"Mission 65" — none of which
have a corresponding `reports/` file (consistent with this repo's known
mission-numbering drift, see `evidence/missions/`).

| Mission 49 item | Status now | Evidence |
|---|---|---|
| IntegrationCenter false-empty-state | **FIXED** | `IntegrationCenter.jsx:443-465`, explicit non-401/403 error branch |
| DevOpsCenterV2 TabPatches Apply/Rollback confirmation | **FIXED** | `useConfirm()` gates both actions |
| DevOpsCenterV2 TabAlerts false success | **FIXED** | catch now toasts failure instead of marking resolved |
| WorkspaceSettingsL3 Unload no confirm | **FIXED** | confirm dialog added |
| TabObservability/TabTelemetry/TabModels undisclosed fake data | **FIXED** | `SampleDataNotice` labels added ("illustrative...") |
| CommandCenter EngineeringTimeline no try/catch | **FIXED** | real error state + `CmdPanelError` |
| CommandCenter ProviderHealth empty catch | **FIXED** | branches on 401/403, sets real error state |
| WorkspaceSwitcher bare catch | **FIXED** | matches sibling error-handling pattern |

This means Mission 49's remediation backlog is substantially already executed;
the master register is out of date on this point — surfaced per CLAUDE.md §9's
"report drift, don't silently resolve it" instruction.

## Onboarding / auth flow — real, correctly gated

Traced `App.jsx`'s routing directly. Onboarding → Signup → App is real, calls
real backend routes (`registerAccount()`, `login()`), and correctly does NOT
call `onSuccess()` until the backend confirms. Google/Phone signup exchanges a
real Firebase ID token for a real backend session and only proceeds after
`sessionRes.success`. **No fake-success-before-confirmation defect found** in
either the web or mobile auth flow — mobile's `AuthContext.jsx` is explicitly
more careful, with an in-code comment naming the exact CLAUDE.md §18 concern it
avoids.

## Error-code passthrough (CLAUDE.md §12)

Confirmed present and intact: `frontend/src/_client.js`'s shared fetch wrapper
preserves the backend's `code` field onto the thrown Error (citing "Mission
33"), and `authApi.js` forwards it again. Not regressed.

## RBAC frontend visibility parity — confirmed real gap on web, partial exception on mobile

The main web frontend's role-based UI gating is a **binary operator/non-operator
split only** — not the real 6-role × 20-action matrix `organizationService.cjs`
enforces server-side. Every conditional-render gate found in `App.jsx` and
`WorkspaceSettings.jsx` checks `user?.role === "operator"`; the org-role
vocabulary (`org_admin`, `dept_lead`, `team_lead`, `viewer`, etc.) appears only
in **display** contexts (badges), not in show/hide/disable logic. A `viewer`
account sees the identical UI to an `org_admin` account; any denial surfaces as
a raw backend 403 with no prior UI signal.

**Partial, previously-uncredited exception**: `mobile/src/components/BottomNav.jsx`
does real, tested role-aware tab hiding (hides Insights for `role="user"`,
shows for `role="operator"`, fails closed on unresolved role) — a genuine,
single-surface instance of RBAC frontend parity added under "Mission 58,"
overlooked by the prior "zero coverage" framing. Overall verdict: RBAC
frontend visibility parity remains **uncertified** for the ~270+ component web
app, with one small, tested exception on mobile.

## Destructive-action confirmations — 2 new genuine gaps found

Most delete/remove/cancel flows are correctly gated (via `useConfirm`, a local
confirm-modal pattern, or a toggle-panel step). Two previously-unflagged real
gaps:

1. **`MemoryCenter.jsx:171-176`** — `handleDelete` fires immediately on click
   with zero confirmation of any kind (no dialog, no local are-you-sure state).
2. **`PluginMarketplace.jsx:156-161`** — `removePlugin` fires the real
   `POST /plugins/uninstall` immediately on click, no confirmation gate (failure
   path is honestly handled, but nothing gates the mutation itself).

Both are the same defect class as already-fixed Emergency Stop/ExtRuntimePanel
findings, on previously-unaudited sibling files.

## Empty/error/loading states — spot-checked, mostly sound

The majority of remaining bare `catch {}` blocks (`ElectronWorkspace.jsx`,
`GuidedTour.jsx`, `CommandPalette.jsx`, `RuntimeDebugger.jsx`) are legitimate
best-effort patterns (localStorage write guards, background telemetry that
should degrade silently) — not the customer-impacting silent-failure class
CLAUDE.md §18 warns against. No new P1-class silent-failure-on-a-real-mutation
was found in this spot-check.

**Fake-data disclosure — a positive finding.** `WorkflowOSV2.jsx`'s three
hardcoded top-level arrays are all correctly disclosed in the UI (a live
"⚠ Live workflow library unavailable — showing seed data" message, and
"(illustrative — not live...)" labels) — correct implementation of CLAUDE.md
§17, closing a blind spot in the existing static fake-data regex.

**Lower-severity, previously unnamed pattern**: several components use an
undisclosed hardcoded numeric fallback (e.g. `?? 94`, `?? 72`, `?? 100`) when a
live field is genuinely absent, rendering a specific, plausible-looking number
with no "estimate" label. Lower severity than a fabricated dataset, but the
same underlying honesty question. Flagged for a future fake-data sweep, not
fixed here.

## Accessibility (WCAG) — CONDITIONAL 9.0/10, one of two named gaps closed 2026-08-22

**Update (2026-08-28 verification):** the ARIA listbox-child gap below (#2)
was already fixed in commit `f45a146f` (2026-08-22), predating this
document's generation — verified directly against
`frontend/src/components/CommandPalette.jsx:474-518`: the pin-button row now
uses `role="presentation"` on its wrapper (comment tag `B25/G2-B195`),
correctly removing both the wrapper and the non-`option` pin button from the
listbox's ARIA child contract while keeping the actual `role="option"`
command button valid. This was a real doc/code drift, not a re-opened
defect. Gap #1 (763 form-labelling findings) is re-verified STILL GENUINELY
OPEN — confirmed via `reports/B19.3-SCREEN-READER-CERTIFICATION.md` and
`reports/B25-FINAL-EVIDENCE-MATRIX.md`, tracked as "OPEN — GENUINE
CAPABILITY GAP," a large content-authoring task (writing ~763 real
accessible labels across 258 files), not a mechanical fix.

One named, still-open reason prevents a full 10/10: 763 form-labelling
findings across 258 files that automated tooling doesn't catch (placeholder
accepted as a name, but WCAG 3.3.2 requires a real label) — scoped as a
content/design change, not a mechanical fix. **No screen-reader
(NVDA/JAWS/VoiceOver/TalkBack) pass has ever been executed** — the
certification report itself states fabricating one would be prohibited
under this repo's own honesty rules.

## Summary

| Item | Classification |
|---|---|
| Mission 49 P1/P2 backlog | Substantially already fixed under later, undocumented mission numbers |
| Onboarding/auth false-success | Not present — correctly implemented |
| Error-code passthrough | Present, intact |
| RBAC frontend parity | Uncertified on web (binary gate only); one tested exception on mobile |
| Destructive-action confirmation | 2 new genuine gaps found (MemoryCenter, PluginMarketplace) |
| Silent-failure catches | Mostly legitimate best-effort patterns, no new P1 found |
| Fake-data disclosure | One positive finding (WorkflowOSV2), one new lower-severity pattern (undisclosed numeric fallbacks) |
| WCAG certification | CONDITIONAL 9.0/10, unchanged, 2 named open gaps, no screen-reader pass ever run |

See `17_MOBILE.md`, `18_ELECTRON.md` for platform-specific detail and
`evidence/frontend/` for citations.
