# 17 — Mobile (Phase 6 detail)

## Real, distinct app — not a thin wrapper

`mobile/` is a real Capacitor 6 app (`@capacitor/android`, `@capacitor/core`)
plus Firebase 10 and React Router 6 on CRA (react-scripts 5.0.1). 1,797 lines
across a real `AuthContext`, `BottomNav`, `ErrorBoundary`, and 8 pages
(Dashboard, Home, Login, Signup, Profile, Tools, PrivacyPolicy, Terms) — a
genuinely separate, smaller React app, not an iframe/webview shell around the
main frontend.

## Real tests beyond build verification

4 real test files exist: `api.getLeads.test.js`,
`BottomNav.roleGating.test.jsx` (role-gating — see `16_FRONTEND_UX.md`'s RBAC
section), `ErrorBoundary.test.jsx`, `Dashboard.forbidden.test.jsx`. These use
`react-dom/test-utils` directly rather than `@testing-library/react` — a
deliberate, documented choice. `ci.yml`'s `build-mobile` job runs these via
real Jest (`npm test --prefix mobile -- --watchAll=false`), not merely a build
check.

## Auth honesty — a strong positive example

`mobile/src/context/AuthContext.jsx` explicitly avoids CLAUDE.md §18's named
defect class: on a failed session establishment (e.g. `mfa_required`,
`provider_not_allowed`), it sets `sessionError` and does not assign a role,
with an in-code comment stating precisely: "must not be silently
swallowed... surface it via sessionError rather than pretending sign-in
succeeded."

## Real-device testing — confirmed still an open manual item

Mission 50's claim reconfirmed still true: `reports/C5-MOBILE-CERTIFICATION.md`
explicitly states its own testing was "Chromium viewport emulation
(Playwright)... No device certification is claimed... does not prove
real-hardware rendering or touch-event behavior" — and that report is about the
**web frontend at mobile viewport widths**, not the separate `mobile/`
Capacitor app at all. A repo-wide search for any mention of real/physical
device testing (iOS or Android) across all of `reports/` returned zero hits.
**Real-device testing remains a fully open, unaddressed manual item** — this
is a genuine gap, not documentation drift.

## CI coverage

`build-mobile` job (added under "Mission 57" per its own comment — mobile had
zero CI coverage before) runs real tests plus a separate build-verification
step with correctly-labeled CI-placeholder Firebase env vars. Release/Play
Store signing does not exist in CI (see `19_INFRASTRUCTURE.md`) — confirmed
absent by design, not an oversight (`ci.yml`'s own comment states this
explicitly).

## Summary

| Item | Status |
|---|---|
| App architecture | Real, distinct Capacitor app |
| Auth flow honesty | Correct, no false-success defect |
| CI test coverage | Real (4 Jest test files), added Mission 57 |
| Real-device testing | Open manual item, zero evidence anywhere in `reports/` |
| Release signing | Not implemented, confirmed absent by design |
