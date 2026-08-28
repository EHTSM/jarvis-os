# Evidence Index — Frontend/UX/Mobile/Electron (Phase 6)

Key files read directly this mission (via subagent): `frontend/src/App.jsx`
(routing, lines 331-368, 991-1184, RBAC gates at 843/1060/1473/1487/1542-1556),
`frontend/src/components/auth/SignupPage.jsx`, `frontend/src/contexts/AuthContext.jsx`,
`mobile/src/context/AuthContext.jsx`, `frontend/src/_client.js` (lines 190-238),
`frontend/src/authApi.js`, `frontend/src/components/WorkspaceSettings.jsx`,
`mobile/src/components/BottomNav.jsx` + `BottomNav.roleGating.test.jsx`,
`frontend/src/components/MemoryCenter.jsx` (171-176, 296),
`frontend/src/components/PluginMarketplace.jsx` (156-161),
`frontend/src/components/IntegrationCenter.jsx`, `DevOpsCenterV2.jsx`,
`WorkspaceSettingsL3.jsx`, `CommandCenter.jsx`, `WorkspaceSwitcher.jsx`,
`WorkflowOSV2.jsx`, `electron/main.cjs` (384-406, 1104-1129, 1310-1325,
817-878, 2002-2018), `electron/preload.cjs` (full), `package.json` (build
config, 51-120), `electron/entitlements.mac.plist`, `mobile/package.json`.

Reports cross-referenced: A11/A11.2 series, `PHASE_B19.5_WCAG_FINAL_CERTIFICATION.md`
(full read), `RBAC-ROLE-EXERCISE-AUDIT.md`, `WORKSPACE-SETTINGS-FRONTEND-FAILURE-HONESTY-AUDIT.md`,
`REMAINING-CRITICAL-FRONTEND-SCREENS-CERTIFICATION.md`,
`REPOSITORY-MAP-PANEL-404-AUDIT.md`, `MISSION-49-FRONTEND-A-Z-FINAL-GAP-CONSOLIDATION.md`,
`MISSION-50-ERA1-FINAL-AZ-CERTIFICATION-GAP-MAP.md`, `reports/C5-MOBILE-CERTIFICATION.md`.

Git commits inspected: `35d4daa2`, `f6855003`, `46946cc1`, and surrounding
history for "Mission 46/53/54/58/65" comment attributions.

No files modified, no build/test/server run, no `.env` values read.
