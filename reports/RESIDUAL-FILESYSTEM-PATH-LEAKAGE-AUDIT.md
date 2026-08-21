# RESIDUAL FILESYSTEM PATH & SENSITIVE ERROR LEAKAGE DEEP SWEEP

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-21 · **Branch:** `security/reality-completion`

---

## Scope

Filesystem/path disclosure surfaces deferred from Missions 11–12, not already covered by Missions 10
(`exportFiles.js`/`domAnalyzerService.cjs`), 13 (`cwd`-family fixes, `execSync`→`execFileSync` RCE fixes),
or 14 (module-loader error leaks). Raw Node `fs`-module errors (ENOENT/EACCES/EPERM — always embed an
absolute path), backup/export/storage path disclosure, credential/session/token store path disclosure,
directory-listing disclosure, and `path.resolve`/`join`/`normalize` error surfaces.

## Methodology

Commissioned a comprehensive background inventory covering ~118 candidate sites: every route file
scanned for fs+`.message` co-occurrence, all 4 real file-serving sites, all 8 backup/restore routes, all
6 credential/session/token stores, ~30 `agents/runtime` write helpers, and ~40 `readdirSync` call sites
triaged for HTTP reachability. Every genuine finding was live-reproduced — either against the real
running server via an actual HTTP request from a freshly registered ordinary customer account, or (where
touching the real server's shared filesystem state would be destructive) via a safe, fully isolated,
reversible scratch-directory technique, matching the pattern already established in Missions 11–13.

## Genuine Defects Found and Fixed — 8

### 1. `secretVault.cjs`'s `_save()` — credential-store path disclosure (P0)

Unlike its siblings `_appendHistory()`/`_appendAudit()`, the vault's core write function had **zero**
try/catch. Reachable via `POST /company-factory/companies/:id/connectors/:connectorId/:type`
(`requireAuth` + an org-permission check — an ordinary customer administering their own company, **not**
operator-only). **Live-reproduced via a safe isolated scratch directory** (never the real
`data/vault.json`): a real write failure threw `EACCES: permission denied, open
'.../vault.json.<pid>.<hex>.tmp'` — the absolute path of the encrypted credential store plus its
tmp-file naming scheme. **Fixed** by wrapping the write in try/catch, logging the real error, and
throwing a fixed safe message (`"Could not save credential vault"`) — matching the exact pattern already
established for `betaReadiness.cjs`'s token store in Mission 12.

### 2. `vscodeExecutionMaturity.cjs`'s `getLaunchConfigs()`/`getWorkspaceSettings()` — deterministic, zero-setup leak (P1)

**Live-reproduced via a real HTTP request** from a freshly registered ordinary customer: `GET
/runtime/vscode/launch-configs` returned a real `200` (not even an error status) with
`"ENOENT: no such file or directory, open '/Users/.../jarvis-os/.vscode/launch.json'"` embedded — firing
on **every single call** in this environment, since no `.vscode/launch.json` exists (the common case in
most deployments, not an edge case). `getWorkspaceSettings()` shares the identical pattern and was fixed
alongside it even though not currently routed, to prevent the identical leak on a future regression.
**Fixed** by returning a fixed safe message and only logging genuinely unexpected (non-`ENOENT`) errors
server-side.

### 3. `vsCodeOperations.cjs`'s `absPath`/`filePath` fields — designed-in absolute-path disclosure (P1, decision required and resolved)

Not an error path — a **designed-in field**, which is why prior error-message-sanitization sweeps
missed it. `validateFileTarget()`/`previewPatch()`/`applyPatch()`/`recordPatchApplication()` all return
the server's real absolute install path (derived from `process.cwd()`) directly in their success
response, reachable via 4 `/runtime/vscode/*` routes behind `requireAuth` only. No caller was found in
either the web frontend or the actual `vscode-extension/` client code — this field is unused by any real
product surface today. **Decision made with the user**: strip the field at the response boundary
(`_clientFacingPath()`, relative to `process.cwd()`) rather than gating the routes `operatorOnly` or
leaving as a theoretical exposure — `absPath` remains unchanged internally (still used for the real
`fs.readFileSync`/`writeFileSync` calls). **Fixed** across all 4 routes including `GET
/runtime/vscode/patch-history`, whose persisted history entries carried the same field.

### 4. `engineeringPipelineCoordinator.cjs`'s `_patchValidateGate` — real path traversal plus fs-error leak (P1)

`spec.targetFile` (fully customer-controlled via `POST /pipeline/run`, `requireAuth`-only, no org
scoping on the read side) was joined against `ROOT` with **zero containment check** — `path.join`
resolves `../` segments normally, so a `targetFile` of `../../../../tmp/x` genuinely escapes `ROOT`.
**Live-reproduced with a safe scratch fixture**: a `../`-traversal `targetFile` pointing at an
unreadable file elsewhere on disk returned `"File read error: EACCES: permission denied, open
'/tmp/.../blocked.txt'"` — the real absolute resolved path of an arbitrary probed location, usable as a
filesystem oracle (distinct errno per case). **Fixed** by containing the resolved path within `ROOT`
(reusing `exportFileService.cjs`'s established containment pattern) before use, and replacing the catch
block's raw error text with the already-safe, caller-relative `spec.targetFile` name.
**Live-verified post-fix** via real HTTP: `POST /pipeline/run` with `../../../../etc/passwd` now returns
`"Target file not found"` with zero path disclosure, and the traversal target is never actually read.

### 5. `codingAssistant.js`'s `POST /coding/undo-patch` — fs error passthrough (P1)

The stored patch record's `targetFile` (customer-chosen at patch-creation time, possibly absolute) is
re-resolved at undo time; a real restore failure leaked the resolved absolute path via `e.message` in
the 200-status `errors` array. Distinct from Mission 11's `_applyPatchSpecs()` fix — a different function
in the same file. **Live-reproduced with a safe scratch fixture**. **Fixed** by logging the real error
and keeping only the already-safe, caller-relative `targetFile` name in the response.

### 6–8. Three lower-value unguarded-write leaks (P2)

`codingAssistant.js`'s `_savePatchHistory()`/`_saveACP5Metrics()`, `engineeringSmellDetector.cjs`'s
`_saveDismissed()`, and `exportFileService.cjs`'s local-export-write branch (unlike the cloud-upload
branch immediately above it in the same function, which already catches its own failures) were all
unguarded `fs.writeFileSync` calls reachable from customer-facing routes — the export one specifically
via `GET /accounts/me/export`, a real customer-facing GDPR self-service route. All fixed with the same
established pattern: log the real error server-side, throw/return a fixed safe message.

## Backup/Restore Endpoints Reviewed — All Clean

`/runtime/rollback/{config-backup,config-restore,backup-integrity,startup-reset}` — confirmed already
sanitized to `"load_error"`/`"internal_error"`, only `path.basename()` values ever returned.
`/vault/backup`+`/vault/restore` — reconfirmed still `requireAuth, operatorOnly`, prior certification
holds. `/rc1/backup/*`, `/rc2/steps/backup-restore` — operator-gated, `e.message` passthrough present
but P2-informational only (no ordinary customer can reach it). No previously-unaudited customer-reachable
backup route found.

## Storage/File-Serving Endpoints Reviewed Beyond `exportFiles.js`/`creativeStudio.js`

Exhaustive grep for `res.sendFile`/`res.download`/`createReadStream`/`.pipe(res)` across the entire
codebase found **exactly the 4 sites already certified** in Mission 10 (`exportFiles.js:77`,
`creativeStudio.js:408,451,502`) — all confirmed still intact (`_fileOwnedOrDenied` fail-closed pattern,
`resolveLocal()`'s prefix-containment guard). No new file-serving route exists anywhere in the codebase.

## Directory-Listing Disclosure — All Clean

Every `fs.readdirSync` in the route layer (all in `runtime.js`) returns counts or basenames only, never
absolute paths, each wrapped in a local try/catch or sanitized to `"load_error"`/`"internal_error"`.

## Credential/Session/Token Store fs-Op Reachability

| Store | Verdict |
|---|---|
| `authMiddleware.js` revocation ledger | CLEAN — fully guarded, explicitly best-effort |
| `secretVault.cjs`'s `_appendHistory`/`_appendAudit`/`_kdfSalt` | CLEAN — all already guarded |
| `secretVault.cjs`'s `_save()` | **FIXED — see finding 1** |
| `missionMemory.cjs` | CLEAN — explicitly checks `err.code !== "ENOENT"`, guarded tmp+rename |
| `memoryPersistenceLayer.cjs` | CLEAN — guarded, no customer route reaches it raw |
| `betaReadiness.cjs` token store | Already fixed Mission 12 — reconfirmed, not re-touched |

## Decision Required

**Resolved during this mission, with the user**: finding 3 (`vsCodeOperations.cjs`'s designed-in
`absPath` field) — stripped from the client-facing response rather than gating the route family
`operatorOnly`, since no real caller consumes the field and stripping it cannot break anything while
also closing the disclosure with a smaller, more targeted change. No further decision pending.

## P0/P1/P2

**P0:** 1 (secretVault.cjs — credential-store path) **P1:** 4 (vscodeExecutionMaturity.cjs,
vsCodeOperations.cjs, engineeringPipelineCoordinator.cjs, codingAssistant.js's undo-patch) **P2:** 3
(codingAssistant.js's patch-history/metrics saves, engineeringSmellDetector.cjs, exportFileService.cjs)

## Live Verification

Finding 2 and 4 were reproduced via real HTTP requests through the actual running server as freshly
registered ordinary customer accounts — finding 2 required zero setup (fires on every call in this
environment); finding 4 used a real, safe `../`-traversal payload and confirmed both that no path leaked
and that `/etc/passwd` was never actually read. Findings 1, 3, 5–8 were reproduced via safe, fully
isolated, reversible scratch-directory/file techniques (never the real vault, real repo files, or real
customer data) since driving the exact failure condition against the shared live server's real state
would itself have been destructive — consistent with the mission's explicit "safe, reversible test
files/directories only" and "never expose or modify real credentials/tokens/accounts" rules. All 8 fixes
were then re-verified closed via the same technique used to prove them, and legitimate functionality
(real GDPR export, real smell scan, real VS Code file validation) was reconfirmed unaffected via live
HTTP requests.

## Negative Testing

All 8 fixes reverted independently and confirmed to fail the corresponding structural regression test
for the exact expected reason (missing safe-message pattern, missing containment check, or missing
`_clientFacingPath` sanitization call). For finding 1, additionally confirmed via the exact safe scratch-
directory reproduction that the reverted code genuinely throws the raw path-embedding error again.
Restored all 8; confirmed the full structural + live test suite (block 174, 9 tests) passed cleanly
against a freshly restarted server.

## Limitations

This mission does not claim the filesystem-leak category is closed for the entire codebase — it reports
the classification obtained for the ~118 candidate sites the inventory located (backup routes,
file-serving routes, directory listings, credential stores, and every fs+error-message co-occurrence in
the route layer) and fixed the 8 genuinely customer-reachable, unfixed sites it found. Lower-value,
operator-only-gated `e.message` passthroughs on `rc1.js`/`rc2.js`'s backup routes were reviewed and
explicitly left unfixed (P2-informational, no ordinary customer can trigger them) rather than expanded
into scope beyond what evidence justified.

## Regression

**Before:** 464/464 effective (Mission 14's baseline). **After:** 473/473 effective — the full-suite run
reported 468/473 with 5 failures (blocks 153, 155, 155b — none touching any file modified this mission),
all 5 confirmed pre-existing, load-dependent flakes by re-running each in complete isolation, where every
one passed cleanly. This matches the already-documented full-suite-load flakiness pattern recorded
throughout this multi-mission session (including recurring identically in Mission 14).

## New Tests

9 (block 174 — 6 structural + 3 live, covering all 8 fixed sites).

## Build

PASS (`npm run build:frontend`, clean production build).

## Security

`tests/security/97-enterprise-isolation-integrity.cjs` — 8/8 PASS (after waiting out this environment's
shared registration rate-limit window, exhausted by this mission's own live testing).

## Current Baseline

473/473 effective, Build PASS, Security 8/8 PASS, server healthy, `.env` untouched, no merge, no push.

## Server Status

Restarted three times across this mission's fix/negative-test/restore cycles (all touched files are
`require()`-cached), confirmed healthy after each restart.

## .env Status

Untouched throughout.

## Merge/Push Status

No merge. No push. Unrelated uncommitted work in the working tree preserved throughout.
