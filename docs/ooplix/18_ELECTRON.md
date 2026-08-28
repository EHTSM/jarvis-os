# 18 — Electron (Phase 6 detail)

## Headline finding: Mission 50's "zero Electron audit" claim is now stale, but the fix has no report file

Mission 50 (2026-08-24) stated no Electron/IPC/preload/auto-update/signing
audit existed anywhere in 312 reports. Direct code inspection today shows
**substantial hardening has since landed**, dated by in-code comments to
"Mission 53"/"Mission 54" (2026-08-27) — but **no corresponding report file
exists in `reports/` for either mission number**, and a search of `reports/`
and `docs/` for "electron" + "IPC"/"contextIsolation"/"preload" together
returns zero hits. The code has been audited/hardened; the documentation trail
this repo's own convention requires (CLAUDE.md §14/§15) has not caught up.
This is itself a finding — a candidate for retroactively writing the missing
report from the in-code evidence (not done here, out of this mission's scope).

## What is actually in place — genuinely solid core posture

Confirmed via direct read of `electron/main.cjs`/`preload.cjs`:
- `contextIsolation: true`, `nodeIntegration: false`, `enableRemoteModule: false`,
  `webSecurity: true` uniformly across all `BrowserWindow` construction sites.
- `sandbox: true` added under "Mission 54," verified before enabling by
  confirming `preload.cjs` requires only `electron` itself (zero Node
  builtins/third-party modules) and the renderer bundle has zero direct
  `require()`/Node usage.
- `preload.cjs` exposes ~85 methods via `contextBridge.exposeInMainWorld`
  exclusively through `ipcRenderer.invoke`/`.on`, with input shape validation
  (type + length bounds) before forwarding to the main process.
- **CSP**: injected via `session.defaultSession.webRequest.onHeadersReceived`
  — `default-src 'self' http://localhost:5050`, no `unsafe-eval` in production.
- **Auto-update**: real `electron-updater` wiring, `autoDownload: false`
  (requires a user-confirmed dialog before downloading), checks every 4 hours,
  `quitAndInstall()` gated behind another confirm dialog. Non-silent, correct
  UX.

## Two asymmetric gaps found

1. **`fs-read-file`/`fs-write-file` are scoped** via `_isSafePath()` against
   an allowlist of roots (home directory, userData, downloads, temp) — blocks
   traversal to `/etc`, `/System`, etc., but the home-directory allowance is
   broad (includes e.g. `~/.ssh`, any other app's data).
2. **`shell-exec` has NO equivalent restriction** — runs the caller-supplied
   command string verbatim via `exec()`, bounded only by a 2048-char length
   cap, 30s timeout, and 64KB output buffer. No allowlist, no `cwd` gate, no
   confirmation dialog. Since this is only reachable from the already-trusted
   renderer (not directly from arbitrary web content, given
   contextIsolation/nodeIntegration block that), the practical risk is bounded
   to the standard Electron trust model ("a compromised renderer = full shell
   access") — but it is a real, asymmetric gap relative to the filesystem
   handlers' own allowlisting standard, worth naming precisely.

## Code signing

`package.json`'s `build.mac` sets `hardenedRuntime: true` with a minimal,
correctly-scoped `entitlements.mac.plist` (JIT, unsigned-executable-memory,
network client, user-selected file read-write — no
`disable-library-validation`, no `allow-dyld-environment-variables`). No
explicit certificate/identity reference exists in `package.json` for either
platform — signing depends on build-time secrets not checked in this pass
(credential-safety rule). `build.win` has no code-signing config at all;
electron-updater's default `verifyUpdateCodeSignature: true` means an unsigned
Windows auto-update would fail closed rather than silently install unsigned
code — the safe default, not a defect, but Windows builds are effectively
unsigned unless a build-time certificate is supplied.

## Summary

| Item | Classification |
|---|---|
| contextIsolation/nodeIntegration/sandbox | CODE COMPLETE, correctly hardened, verified before enabling |
| Preload IPC surface | CODE COMPLETE, input-validated, no Node leak to renderer |
| CSP | CODE COMPLETE, no unsafe-eval in production |
| Auto-update | CODE COMPLETE, non-silent, user-confirmed |
| `fs-read-file`/`fs-write-file` allowlisting | CODE COMPLETE, reasonably scoped |
| `shell-exec` allowlisting | NOT IMPLEMENTED — real asymmetric gap vs. fs handlers |
| Mac code signing | CODE COMPLETE, depends on build-time secrets (unconfirmed) |
| Windows code signing | NOT CONFIGURED in `package.json`; fails closed on missing cert (safe default) |
| Documentation trail for Mission 53/54 hardening | MISSING — no `reports/` file exists despite real code changes |

Recommend (not actioned, per this mission's read-only constraint): retroactively
document Mission 53/54's Electron hardening work as a proper report, and decide
whether `shell-exec` needs the same `_isSafePath`-style treatment as the
filesystem handlers.
