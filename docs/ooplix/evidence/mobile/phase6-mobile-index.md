# Evidence Index — Mobile (Phase 6)

Files read directly (via subagent): `mobile/package.json`,
`mobile/src/context/AuthContext.jsx`, `mobile/src/components/BottomNav.jsx`,
`mobile/src/components/BottomNav.roleGating.test.jsx`,
`mobile/src/components/ErrorBoundary.test.jsx`,
`mobile/src/pages/Dashboard.forbidden.test.jsx`, `mobile/src/api.getLeads.test.js`.

Reports cross-referenced: `reports/C5-MOBILE-CERTIFICATION.md` (real-device
testing claim verification — confirmed the report itself states only
Chromium-viewport emulation was performed, not real hardware).

Repo-wide search performed for any real/physical device testing evidence
across all of `reports/` — zero hits found for "real device," "physical
device," "iOS device," "Android device," or "on-device."

No files modified, no build/test run, no `.env` values read.
