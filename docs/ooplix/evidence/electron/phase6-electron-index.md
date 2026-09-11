# Evidence Index — Electron (Phase 6)

Files read directly (via subagent): `electron/main.cjs` (webPrefs/sandbox
lines 384-406, fs allowlist 1104-1129, shell-exec 1310-1325, auto-update
817-878, CSP 2002-2018), `electron/preload.cjs` (full, ~85 exposed methods),
`package.json` (build config, lines 51-120), `electron/entitlements.mac.plist`.

Search performed across `reports/` and `docs/` for "electron" combined with
"IPC"/"contextIsolation"/"preload" — zero hits, confirming no dedicated report
file exists for the real hardening work found in code (attributed via in-code
comments to "Mission 53"/"Mission 54"/"Mission 58").

No files modified, no build/electron process run, no `.env` or certificate
values read.
