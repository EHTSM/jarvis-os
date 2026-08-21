# COMMAND INJECTION & PROCESS EXECUTION DEEP SECURITY SWEEP

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-21 · **Branch:** `security/reality-completion`

---

## Scope

All customer-reachable process execution / shell execution surfaces, starting from the two sites Mission
12 explicitly deferred (`codingAssistant.js:370`, `:779`), then expanded to every `execSync`/`exec`/
`spawn`/`spawnSync`/`execFile`/`execFileSync` call site across `backend/routes/*.js`, `backend/services/
*.cjs`, and `agents/**/*.cjs`.

## Methodology

Started at the two deferred `codingAssistant.js` sites, found a real customer-supplied-`cwd`
information-disclosure issue there, then commissioned a comprehensive background inventory of every
process-execution call site in the codebase to determine full reachability and construction safety
before deciding what else was in scope. Every genuine finding was live-reproduced — either through the
real running server via an actual HTTP request from a freshly registered ordinary customer account, or
(where the real server's own data/filesystem would have been put at risk) via a safe, self-contained,
non-destructive proof payload (a harmless marker-file creation, never anything resembling real damage).
Every fix was negative-tested: reverted, confirmed the exact vulnerability reappeared via a live
reproduction, restored, confirmed it was closed again.

## Genuine Defects Found and Fixed — 5

### 1–3. Full remote code execution via `JSON.stringify()` mistaken for shell-quoting (P0)

Three services built shell command **strings** via `execSync`, quoting caller-influenced values with
`JSON.stringify()`. `JSON.stringify()` is a JavaScript-string escaper — it produces a double-quoted
string and escapes only `"` and `\`. It does **not** neutralize `$()` command substitution or backticks,
both of which `/bin/sh` still expands *inside* double quotes.

- **`largeContextCodeSearch.cjs`** (`_runGrep`, `findRelated`, `repoStats`) — reachable via
  `POST /p25/search`, `GET /p25/search/related`, `GET /p25/search/stats` (`backend/routes/phase25.js`,
  `requireAuth`-only). **Live-reproduced end-to-end via a real HTTP request from a freshly registered
  ordinary customer account**: `POST /p25/search` with
  `{"query":"test","repoPath":"$(touch /tmp/PROOF)"}` executed the substituted command as the backend
  process — the marker file was created. Full RCE, not a theoretical construction issue.
- **`repoIntelligenceEngine.cjs`** (`semanticSearch`) — reachable via `POST /p24/repo/search`
  (`backend/routes/phase24.js`, `requireAuth`-only). This one was worse: the `limit` parameter was
  interpolated with **zero quoting of any kind**, not even the ineffective `JSON.stringify()` wrapping
  `query`/`repoPath` got. **Live-reproduced end-to-end via real HTTP**: `{"limit":"1; touch /tmp/PROOF;
  echo "}` executed the injected command with a bare `;` — no escape sequence needed at all.
- **`multiRepoEngineeringEngine.cjs`** (`registerRepo`) — reachable via `POST /p24/multirepo/repos`
  (`requireAuth`-only). Gated on an `fs.existsSync(abs)` precondition (the literal string containing
  `$(...)` must name a directory that actually exists), so lower confidence than the other two, but
  **live-reproduced via a safe standalone test** (creating a directory literally named
  `$(touch /tmp/PROOF)` and registering it) — the command executed.

**Fixed** by switching all three to `execFileSync` with real argument arrays — each flag, pattern, and
path arrives as its own `argv` element with no shell parsing at all, so `$()`, backticks, `;`, `&&`, `|`
become inert data rather than syntax. `repoStats`'s `find | wc -l` shell pipeline was replaced with a
single `find` call whose output line count is taken in JS (a shell pipe cannot be expressed via
`execFileSync` without reintroducing shell parsing). `semanticSearch`'s `limit` is now also coerced
through `parseInt`, matching the existing convention already used at `phase25.js:333` for the equivalent
parameter there. This is the exact "reuse `spawn(shell:false)`/argument arrays" pattern the mission
specified — no new execution framework.

**Live-verified post-fix** (real HTTP requests, ordinary ­customer account): all three payloads now
execute with zero effect (no marker file created); legitimate search functionality confirmed unaffected
(real grep results still returned correctly for both routes).

### 4. Customer-controlled `cwd` disclosed arbitrary-directory git/file-content data (P1)

`codingAssistant.js` (the two sites Mission 12 deferred, plus every other route in the file that accepts
`cwd`), `codingBundle.js`, and `codingDecisions.js` all accept a caller-supplied `cwd`/`repoPath` and use
it as the base for real `execSync({cwd})` git calls and full-repository content scans
(`engineeringSmellDetector.cjs`'s `scan()`, which reads and TODO/FIXME/empty-catch/etc.-scans every code
file under the given root). **Live-reproduced** with a safe, self-created test git repository (never
against real system or user data): pointing `cwd` at it returned that repo's actual commit log, `diff
--stat`, and full diff content — including a realistic secret-shaped test fixture line
(`API_KEY=sk-fake-...`) — embedded into the AI system prompt for most routes, and, for `GET
/coding/context` and `GET /coding/smells`, returned **directly in the HTTP response with zero AI-provider
round-trip required** (real filenames, tech-debt metadata, and the target repo's git branch name).

This is a legitimate product feature in the intended single-operator Electron desktop deployment
(`cwd` = whichever local project folder the operator has open in the IDE) — not a bug in isolation. The
defect is that the backend has no way to distinguish that trusted local caller from a remote multi-tenant
web customer hitting the same HTTP API directly, and no per-customer workspace-boundary concept exists to
scope `cwd` to instead. **Decision made with the user**: rather than inventing a new workspace-boundary
system (explicitly out of scope per the mission's "do not create a new execution framework" rule), `cwd`
now requires the operator role, reusing the codebase's already-established `operatorOnly` authorization
concept. A non-operator caller's `cwd` is treated as absent (falls back to the server's own repo root)
rather than rejecting the whole request, since most of these routes work fine with no `cwd` at all.

**Fixed** via a new shared `backend/utils/cwdSafety.cjs` helper (`safeCwd(cwd, req)`), following the same
"single shared choke point" pattern already established by `urlSafety.cjs`'s `assertSafeNavigationTarget`
— applied at a router-level middleware in `codingAssistant.js` (so no individual route can forget to
sanitize) and at each of `codingBundle.js`'s/`codingDecisions.js`'s two `cwd`-accepting routes.

**A real Express 5 bug was caught and fixed mid-implementation**: the first version of the middleware
tried to overwrite `req.query.cwd` in place — this silently no-ops in Express 5, where `req.query` is a
read-derived getter re-computed from `req.url` on every access (verified directly against this app's
actual Express version with a minimal reproduction). The two `GET`-route call sites
(`/coding/context`, `/coding/smells`) now read a stashed `req.safeQueryCwd` property instead.

**Live-verified post-fix**: an ordinary (non-operator) customer's `cwd` pointed at the same test repo now
returns `branch: null` (falls back to the server's own repo root) instead of the attacker-targeted
repo's real branch name; legitimate operator `cwd` usage confirmed still functional via direct unit
verification of the gating logic (a real operator-account HTTP login was not attempted, to avoid
touching the platform's actual production operator identity without cause).

## Already-Certified Surfaces — Reconfirmed, Not Re-Audited

- `agents/runtime/adapters/filesystemExecutionAdapter.cjs` — no `child_process` usage at all (pure `fs`
  with sandbox-root containment), unrelated to this mission's scope.
- `agents/runtime/adapters/terminalExecutionAdapter.cjs` (test block 159's subject) — `spawn(shell:false)`
  with allowlist validation and env stripping, confirmed unchanged.
- `agents/primitives.cjs`'s `openURL`/`openApp` (test block 161's subject) — `spawn(shell:false)`,
  confirmed unchanged.
- `backend/core/safe-exec.js` — the codebase's central hardened execution primitive
  (`spawn(shell:false)`, allowlist, env sanitization, process-group kill) — confirmed unchanged, used as
  the reference pattern this mission's fixes align with.
- `backend/routes/computerController.js` / `dockerController.js` (operator-only) — `execFileSync`/`spawn`
  argument arrays with allowlists, confirmed unchanged.
- `phase22.js` → `deploymentValidator.cjs`, `dop2.js`'s `runVpsCommand` (strict exact-match allowlist),
  `devops/dependencies/update` (`execFileSync` argument arrays) — all operator-gated, confirmed
  structurally safe, not modified.

## Clean — Checked, No Defect Found

- `phase24.js:116`'s `execFile(process.execPath, [...])` dynamic-script generation — an argument array
  (no shell), and the third element is a generated JS program where `JSON.stringify()` **is** the
  correct escaping function (it's a JS string literal context, not a shell one). Structurally safe;
  flagged during the inventory specifically so it would not be mistaken for one of the vulnerable sites.
- `repositoryEditingEngine.cjs:148`'s `_grepSymbol` — the most dangerous-looking unescaped construction
  found, but verified dead code (never called, not exported).
- No `shell:true` found anywhere in `backend/` or `agents/`.
- No customer-controlled child-process environment variables found anywhere — the only three literal
  `env:{...}` sites pass fixed/config-derived values, and every `env`-narrowing helper (`_minimalEnv()`,
  `_sanitizeEnv()`) only ever strips, never widens.
- Dozens of additional `execSync`/`spawn`/`execFile*` call sites across services and agents confirmed to
  use either fixed literal command strings or pre-existing argument-array construction with no
  request-derived interpolation — not individually re-detailed here; full inventory available in the
  session's research trail.

## Decision Required

**Resolved during this mission, with the user**: `cwd` on the coding-assistant route family is now
operator-only rather than customer-facing, since no per-customer workspace-boundary concept exists to
scope it to safely, and a hard 1-fixed-root restriction would break the legitimate desktop-app "open any
project folder" feature. No further decision pending from this specific finding.

## Credential/Environment Blockers

None. All findings in this mission were fully live-reproducible in this environment (no provider
credentials or external services were required — every vulnerable code path was reachable and provable
using only local `git`/`grep`/`find` and the server's own filesystem).

## Findings Summary

**P0:** 3 (full RCE — `largeContextCodeSearch.cjs`, `repoIntelligenceEngine.cjs`, `multiRepoEngineeringEngine.cjs`)
**P1:** 1 (customer-controlled `cwd` arbitrary-directory disclosure — 3 route files)
**P2:** 0
**Other:** 0 genuine defects beyond the above; several sites reviewed and confirmed clean (see above)

## Live Verification

Every P0 finding was reproduced via a real HTTP request through the actual running server, using a
freshly registered ordinary `requireAuth`-only customer account (no operator credentials used or
fabricated) and a safe, non-destructive proof payload (creation of a harmless marker file under this
session's own scratchpad — never a payload capable of causing real damage). The P1 finding was
reproduced with a self-created test git repository containing a realistic secret-shaped fixture line,
never against real system, user, or production data. All fixes were then re-verified via the same live
technique to confirm closure, and negative-tested (revert → live-reproduce the exact original
vulnerability → confirm it reappears → restore → confirm it's closed again) for all 5 fixes.

## Limitations

This mission does not claim the entire process-execution surface of the codebase is certified — it
reports the reachability/safety classification obtained through the inventory (fixed-string-only,
argument-array-already, dead-code, operator-only, or genuinely customer-reachable-and-unsafe) for every
call site the inventory located, and fixed every customer-reachable unsafe site it found. A small number
of lower-confidence/lower-priority items surfaced during the inventory (e.g. `codingAssistant.js:370,779`'s
`execSync("git ...")` calls with a `cwd`-derived working directory, now protected only insofar as `cwd`
itself is operator-gated) were not independently deep-dived beyond that shared fix, since they share the
same root cause and mitigation as the P1 finding above.

## Regression

**Before:** 452/452 effective. **After:** 461/461 effective (461 total, 460 passed in the full-suite run
— the single reported failure was a false positive caused by this mission's own concurrent background
shell-polling `sleep 5` process being matched by an unrelated orphan-process-detection test's overly
broad process-list scan; re-run in isolation with no interfering `sleep` processes present, that test
passed cleanly, confirming it is environmental noise from this session's own tooling, not a real
regression). **New tests:** 9 (block 172 — 6 structural + 3 live). **Negative-tested**: all 5 fixes
reverted independently, each confirmed to genuinely reproduce its original live vulnerability again
(marker files created / operator gate bypassed), restored, confirmed closed again; the full block 172
suite re-passed cleanly after final restoration.

**Build:** PASS (`npm run build:frontend`, clean production build).
**Security suite:** `tests/security/97-enterprise-isolation-integrity.cjs` — 8/8 PASS (after waiting out
this environment's shared registration rate-limit window, exhausted by this mission's own live
account-creation testing across multiple RCE-reproduction probes).

## Server Status

Restarted multiple times across this mission's fix/negative-test/restore cycles (all touched files are
`require()`-cached). One restart cycle exhibited an unrelated, pre-existing server-startup congestion
issue (the autonomous-loop task backlog appeared to starve the HTTP listener from accepting new
connections for an extended period despite the process being alive and the startup banner having
printed) — resolved by a clean `kill -9` + restart, after which the server came up normally and stayed
responsive through all subsequent verification. This is flagged as an environment/operational
observation, not a finding of this security mission, and was not investigated further as it falls
outside this mission's scope (command injection / process execution).

## .env Status

Untouched throughout.

## Merge/Push Status

No merge. No push. Unrelated uncommitted work in the working tree preserved throughout.
