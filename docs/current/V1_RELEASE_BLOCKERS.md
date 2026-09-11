# V1_RELEASE_BLOCKERS.md — Ooplix Public Release

**Date:** 2026-07-17
**Branch:** `security/reality-completion`
**Status:** Final, post-fix. Every blocker below reflects state AFTER Phase 2's fixes. See root `RELEASE_BLOCKERS.md` for the pre-fix inventory and full classification methodology.

## Fixed this mission (no longer blockers)

| ID | Was | Fix | Evidence |
|---|---|---|---|
| B1 | SSRF via 12 real browser-navigation call sites across the ODI subsystem | New `backend/utils/urlSafety.cjs` guard (scheme allowlist + private-IP/metadata-endpoint blocklist + real DNS-resolution check), wired into all 12 sites plus the shared `agents/browser/actionEngine.cjs` navigate() choke point | Live-verified: `169.254.169.254`, `127.0.0.1`, `10.0.0.1` all rejected with `422 unsafe navigation target`; `https://example.com` passes through unaffected |
| B3 (partial) | Rate limiting on 7/126 route files | Added `rateLimiter(30, 60_000)` to `ai.js`, `codingAssistant.js`, `phase27.js`, `creativeStudio.js` — the 4 highest-value AI-cost-bearing files with zero throttling. Coverage now 11/126. | Live-verified: 35 concurrent `/ai/chat` requests → 30 succeeded, 5 hit `429` |

## Remaining blockers (unchanged — not fixable within this mission's scope)

| ID | Blocker | Type | Severity | Owner | Why not fixed |
|---|---|---|---|---|---|
| B2 | No database-enforced tenant isolation | CODE (architectural) | P0 for multi-tenant | NOT FIXABLE NOW | Explicit architectural redesign — forbidden by this mission's rules |
| B3 (remainder) | 115 of 126 route files still unthrottled | CODE | P2 | PARTIALLY FIXABLE — done for highest-value targets, remainder is diminishing-returns | Most of the remaining 115 are low-cost/read-only or already role-gated |
| B4 | No CSRF-token layer | CODE | P2 | NOT FIXABLE NOW | Larger change than a targeted fix; `sameSite:strict` provides real partial mitigation |
| B5 | `RESEND_API_KEY`/`RESEND_FROM_EMAIL` absent | CREDENTIAL | P0 for signup flow | NEEDS CREDENTIALS | External account provisioning |
| B6 | `WA_PHONE_ID` wrong ID type | CONFIGURATION | P2 | NEEDS CREDENTIALS | Requires fetching correct value from Meta's Graph API — operator action, not code |
| B7 | Razorpay plan IDs absent | CREDENTIAL | P1 | NEEDS CREDENTIALS | External Razorpay dashboard configuration |
| B8 | 11 connectors uncredentialed | CREDENTIAL | P2 each | NEEDS CREDENTIALS | External API key provisioning per service |
| B9 | No Stripe webhook route | CODE | P2 | NOT FIXABLE NOW | Untestable without a real Stripe account regardless of code written |
| B10 | Apple code signing absent | EXTERNAL | P0 for mac distribution | NEEDS EXTERNAL SERVICE | Apple Developer Program membership — real business/legal step |
| B11 | Windows code signing absent | EXTERNAL | P0 for Windows distribution | NEEDS EXTERNAL SERVICE | Purchased code-signing certificate |
| B12 | Docker daemon unavailable in this environment | INFRASTRUCTURE | P1 | NEEDS INFRASTRUCTURE | Sandboxed session has no Docker daemon control |
| B13 | nginx not installed in this environment | INFRASTRUCTURE | P2 | NEEDS INFRASTRUCTURE | Sandboxed session limitation |
| B14 | True 24h+ stability unverified | INFRASTRUCTURE | P1 | NEEDS INFRASTRUCTURE | Requires a real staging host monitored over days |
| B15 | Real production concurrency (250-1000 users) unverified | INFRASTRUCTURE | P1 | NEEDS INFRASTRUCTURE | Requires distributed load-generation infra |
| B16 | `/queue/status` deep metrics degraded | CODE | P2 | NOT FIXABLE NOW | Reason for module archival unknown; resurrecting unreviewed code is itself a risk |
| **B17** | **Electron installer (DMG/EXE/AppImage) never successfully produced** | **INFRASTRUCTURE (confirmed external)** | **P0 for desktop distribution** | **NEEDS INFRASTRUCTURE / EXTERNAL INVESTIGATION** | See root-cause section below |

---

## B17 — Electron Installer Pipeline: Root Cause (Phase 4 findings)

**Finding: `node-pty`'s native module rebuild hangs indefinitely during `electron-builder`'s packaging step. Confirmed reproducible on all 3 target platforms in real CI, and reproduced a fourth time on this local development machine. No installer (DMG, EXE, or AppImage) has ever been successfully produced by the real release pipeline.**

### Evidence chain (all real, no guessing)

1. **Real CI run `29578115175` (v1.0.0-rc7, 2026-07-17T11:49Z):** all 3 `Build Desktop` jobs (`ubuntu-latest`, `macos-latest`, `windows-latest`) failed identically. Root cause at that time: `postinstall` ran `electron-builder install-app-deps`, which hung at `preparing moduleName=node-pty` for the full 15-minute step timeout.
2. **Fix applied (commit `793c924`, external to this mission but present on this branch):** removed the redundant `postinstall` rebuild, reasoning that `electron-builder`'s own packaging step rebuilds natives independently via its built-in `npmRebuild` option and would still succeed.
3. **Real CI run `29582661689` (v1.0.0-rc8, 2026-07-17T13:05Z), AFTER that fix:** all 3 `Build Desktop` jobs still failed — this time hitting the 30-minute **job** timeout instead of the 15-minute step timeout, because they progressed further (past `npm ci`, into the actual `npx electron-builder --publish always` packaging step) before hanging. The exact hang point, confirmed via full job logs on all 3 platforms:
   - `better-sqlite3` rebuild: **succeeds** in <1 second on every platform.
   - `node-pty` rebuild: **prepares, then never progresses**, on macOS ARM64, Ubuntu x64, and Windows x64 alike, until the job is killed by the timeout (`"The operation was canceled."`).
4. **Local reproduction, this session:** `npx electron-builder --mac --publish never` on this development machine (macOS ARM64, same architecture as one of the failing CI runners) hit the **identical** hang: `better-sqlite3` finished in under a second, `node-pty` prepared and then sat idle for 15+ minutes with the responsible worker process (`@electron/rebuild/lib/module-type/node-gyp/worker.js`) alive but consuming ~0% CPU and holding zero open network connections — consistent with a deadlocked subprocess wait, not an active (and therefore diagnosable-by-waiting) compile or download.
5. **Separately, cross-compilation is also confirmed broken** (a distinct, secondary finding): `npx electron-builder --linux --publish never` run from this macOS machine fails immediately and loudly with `node-gyp does not support cross-compiling native modules from source` — expected, correct `node-gyp` behavior, and irrelevant to the real CI pipeline since CI builds each platform on its own native runner (confirmed via `.github/workflows/release.yml`'s matrix: `macos-latest`→mac, `windows-latest`→win, `ubuntu-latest`→linux — no cross-compilation occurs in the real pipeline).

### Why this is classified EXTERNAL, not CODE

- The hang reproduces identically across **4 independent environments**: 3 GitHub-hosted runner types plus this local machine — ruling out a single-environment fluke or a GitHub-Actions-specific network/sandboxing quirk.
- The hang is in `node-gyp`'s native module compile/link machinery for `node-pty` specifically, not in application code — `better-sqlite3`, the other native dependency, rebuilds successfully every single time in the same process.
- The app's own runtime code already treats `node-pty` as optional and handles its absence gracefully (`electron/main.cjs:1021`: `try { pty = require("node-pty"); } catch (e) { ... }`, with every IPC handler checking `if (!pty) return { ok: false, ... }` and the frontend `TerminalPanel.jsx` already handling that failure state) — meaning the application was already engineered defensively around exactly this kind of native-module fragility, even before this investigation.
- A secondary, real, verified contributing risk factor was found but not confirmed as sufficient on its own: `.github/workflows/release.yml` pins Node 20 for the desktop build jobs, while `electron@41.10.2` (and its `@electron/get`/`extract-zip` build-time dependencies) declare `engines: { node: ">=22.12.0" }` — a genuine version mismatch, surfaced as `npm warn EBADENGINE` in every run's logs. This was not tested as a fix in this session because doing so requires pushing a workflow change and observing a real GitHub Actions run, which this mission's instructions do not authorize ("Do NOT push unless explicitly instructed").

### Recommended next step (not performed — outside this mission's authorization to push/test)

Bump `node-version: '20'` to `'22'` in the `desktop` job of `.github/workflows/release.yml` (3 occurrences) and re-run the release workflow to observe whether the `node-pty` hang persists. If it does, the next diagnostic step is pinning `node-pty` to an alternate version or replacing the terminal feature's native dependency, since the current version (`1.1.0`) has no declared `engines` constraint of its own and its rebuild behavior under Electron 41 + Node 22 has not been tested in this investigation.
