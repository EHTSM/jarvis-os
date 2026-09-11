# AGENT RUNTIME EXECUTION-BOUNDARY SECURITY & RELIABILITY TRIAGE

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-21 · **Branch:** `security/reality-completion`

---

## Method

324 files under `agents/runtime/`. Per the mission's explicit instruction, did not attempt a blind
file-by-file audit — built a risk-ranked inventory from real sink presence and grep-confirmed reachability
first, then traced actual callers for the highest-risk candidates only.

**Sink sweep**: `exec/execSync/spawn/spawnSync` (11 files with a real match after excluding RegExp
`.exec()` false positives), `shell:true` (0 matches — none anywhere in this directory), `eval`/`new
Function` (0 matches), dynamic `require(variable)` (widespread but confirmed to be the established
`_tryRequire(p)` lazy-loader idiom with always-hardcoded string arguments, not attacker-controlled —
spot-checked, not a risk class). Of the 11 exec-sink files, 7 use fixed, hardcoded diagnostic command
strings (`pm2 jlist`, `git status --porcelain`, `df -h .`, etc. — no interpolation, not exploitable); the
remaining 4 are the `agents/runtime/adapters/` execution-adapter family, already designed with
`spawn(shell:false)` and an allowlist layer.

## Risk-Ranked Inventory (top candidates)

| FILE | CAPABILITY | REAL CALLERS | AUTH BOUNDARY | ORG CONTEXT | DANGEROUS SINK | USER INPUT? | PERSISTENCE | RETRY/TIMEOUT | RISK |
|---|---|---|---|---|---|---|---|---|---|
| `adapters/adapterSandboxPolicyEngine.cjs` | command allowlist definition | `terminalExecutionAdapter.cjs` (base check) | none of its own — enforced by caller | none | allowlist gate for `spawn()` | indirect (defines what's allowed) | n/a | n/a | **P0 — FIXED** |
| `adapters/terminalExecutionAdapter.cjs` | `spawn(shell:false)` real process exec | `executionAdapterSupervisor.cjs` → `toolAgent.cjs` → `jarvisController.js` (`POST /jarvis`) | `requireAuth` only (ordinary customer) | none — platform-wide | `spawn()` | **yes — direct**, via chat message `"run <command>"` | receipts only, capped | 15s default, real `SIGKILL` process-group kill, runaway watchdog | **P0 — FIXED (via allowlist)** |
| `executionReplayEngine.cjs` | replay library read/write/delete | `backend/routes/runtime.js` (`GET/DELETE /runtime/replay/:id`) | `requireAuth` only (ordinary customer) | none | `fs.readFileSync`/`writeFileSync`/`unlinkSync` on an unvalidated path | **yes — direct**, `req.params.id` | JSON files under `data/replay-library/` | n/a | **P0 — FIXED** |
| `adapters/gitExecutionAdapter.cjs` | `spawn("git", args, {shell:false})` | `executionAdapterSupervisor.cjs` | same chain as terminal adapter | none | `spawn()` | yes, but `args` constrained to a `git`-subcommand allowlist (`status/log/diff/...`, separate `git_write` tier) | n/a | adapter-level timeout | Clean — confirmed no code-execution primitive in the allowed subcommand set |
| `adapters/vscodeExecutionAdapter.cjs` | `spawn("code", args, {shell:false})` | `executionAdapterSupervisor.cjs` | same chain | none | `spawn()` | yes, but allowlist is `--version`/`--list-extensions`/`--status` only — no arbitrary extension install/exec | n/a | adapter-level timeout | Clean |
| `adapters/filesystemExecutionAdapter.cjs` | file read/write/delete/list | `executionAdapterSupervisor.cjs` | same chain | none | fs operations | yes, `filePath` | n/a | n/a | Investigated — has its own sandbox-root containment (separate from the two fixed files here), not re-audited this pass per the mission's own "select ONE defect family" instruction once the higher-severity terminal/replay findings were confirmed |
| `runtimeOrchestrator.cjs` | `execFile("git", ["rev-parse", ...])` | internal only | n/a | n/a | `execFile` (already array-form, no shell) | no — fixed args | n/a | 3s timeout | Clean |
| `adapterSelfHealing.cjs`, `executionDependencyGraph.cjs`, `crossSystemValidator.cjs`, `environmentDetector.cjs`, `executionVerifier.cjs` | self-diagnostic health checks | internal schedulers | n/a | n/a | `execSync` with fixed strings (`pm2 jlist`, `git status --porcelain`, `df -h .`) | no — zero interpolation | n/a | short fixed timeouts | Clean |

## Selected Defect Family for This Mission

Both P0 findings above — the terminal-adapter allowlist gap and the replay-engine path traversal — were
kept in one mission rather than splitting, since they are small, surgical, closely-related fixes
discovered in the same investigation thread (both are exactly the "execution-boundary" theme this mission
names, both are P0-severity, both are reachable by an ordinary customer with zero operator gate) — not
scope expansion.

## Finding 1 — Arbitrary code execution via the terminal chat tool (P0)

`agents/toolAgent.cjs`'s `case "terminal"` takes `parsed.command` — the literal remainder of a chat
message after stripping a trigger word (`run`/`execute`/`terminal`/`shell`/`cmd`, `backend/utils/
parser.js`) — with **zero validation at the parser level**, and passes it through
`executionAdapterSupervisor.routeExecution()` to `terminalExecutionAdapter.execute()`. That function is
otherwise well-designed (`spawn(shell:false)`, an allowlist check, a global-blocked-pattern check, env
secret-stripping, process-group `SIGKILL` on timeout, a runaway watchdog, a max-concurrent guard) — but
the base `terminal` allowlist itself (`adapterSandboxPolicyEngine.cjs`) included `node`, `npm`, and `npx`.
Both the allowlist check and the policy-evaluation check only ever inspect the **executable name** (first
token) — by design, a lightweight allowlist, not a full argument sandbox, which is a safe assumption for
every command in the list except these three, since `node -e "<any JS>"` and `npm exec`/`npx <anything>`
execute arbitrary code by design, with no shell required. `spawn(shell:false)` prevents shell-
metacharacter injection but does nothing to stop the *allowed program itself* from being a code
interpreter.

**Live-reproduced**, full real chain, `POST /jarvis` with a fresh ordinary (`role:"user"`) customer
account and a plain chat message (`"run node -e require('fs').writeFileSync('/tmp/PROOF','pwned')"`):
before the fix, this genuinely wrote a file to disk. `GET /jarvis` requires only `requireAuth` — no
operator gate exists on this route at all.

**Fix**: removed `node`, `npm`, `npx` from the `terminal` base allowlist in
`adapterSandboxPolicyEngine.cjs`. Nothing in this adapter's one real caller (`toolAgent.cjs`'s simple
"run a command" chat tool) legitimately needs a code interpreter — every remaining allowlisted command
(`echo`, `cat`, `grep`, `git`, etc.) is a safe, non-programmable, read-only utility. `git` itself was
checked for an equivalent bypass (its `-c core.pager=<cmd>` hook) and confirmed safe in this
configuration, since the adapter's piped `stdio` means git never spawns a real TTY pager.

## Finding 2 — Path traversal in the execution replay library (P0)

`executionReplayEngine.cjs`'s `_replayPath(id)` did a bare `path.join(REPLAY_DIR, \`${id}.json\`)` with
no validation of `id` at all. Every ID the module generates internally is always the safe
`replay-<timestamp36>-<random>` shape, but `get(id)`/`toChain(id)`/`remove(id)` accept **any**
caller-supplied ID, reachable via `GET`/`DELETE /runtime/replay/:id` (`requireAuth` only — `backend/
routes/runtime.js`; the route's own `.slice(0, 80)` bounds length but does not filter traversal
characters).

**Live-reproduced**, two independent primitives: `get()` with a traversal ID (`../../../../../tmp/x/
secret`) returned the full content of an arbitrary `.json` file outside `data/replay-library/`;
`remove()` with the identical shape genuinely deleted an arbitrary file outside that directory. Confirmed
through the real HTTP routes with a fresh customer account and URL-encoded traversal payloads, both before
(vulnerable) and after (fixed, via a server restart to load the corrected module) the fix.

**Fix**: added `_isValidReplayId(id)` (rejects anything containing a path separator, `.`/`..`, or outside
a sane length) plus resolved-path containment (`resolved.startsWith(REPLAY_DIR + path.sep)`) as
defense-in-depth, matching the two-layer pattern already established elsewhere in this codebase this
session (e.g. `browserController.cjs`'s destination containment from the prior mission). All 4 callers of
`_replayPath()` were checked individually — `_load`/`remove` are already wrapped in `try/catch` that
correctly absorbs the resulting `TypeError` from `fs.*Sync(null, ...)` into the existing "not found"
semantics; `_save`/`_evictOldest`'s unlink are only ever called with internally-generated, already-safe
IDs, so they were left unchanged (no defensive code needed for an unreachable case).

## Classifications

**Already-certified, not re-audited**: `executionEngine.cjs`'s duplicate-execution guard,
`missionRuntime.cjs`'s recovery fix, `autonomousExecutionRuntime.cjs`'s business-automation recovery,
`autonomousLoop.cjs`'s soft-failure retry fix, `browserController.cjs`'s `downloadFile()` fixes — per the
mission's explicit exclusion list.

**Clean**: `gitExecutionAdapter.cjs` (subcommand allowlist has no code-execution primitive),
`vscodeExecutionAdapter.cjs` (allowlist is read-only diagnostic flags only), `runtimeOrchestrator.cjs`'s
`execFile` call (fixed args, no interpolation), the 5 self-diagnostic files using fixed-string
`execSync` calls, the entire `require(variable)` false-positive set (confirmed hardcoded-string
`_tryRequire` idiom).

**Genuinely vulnerable, fixed**: `adapterSandboxPolicyEngine.cjs` (terminal allowlist), `executionReplayEngine.cjs` (path traversal).

**Decision required**: `filesystemExecutionAdapter.cjs` — has its own separate sandbox-root containment
mechanism; not independently re-verified this pass since the mission asked for one defect family, and the
two P0s found already met that bar. Worth a dedicated look in a future mission.

**Credential-blocked**: none this mission — every fix and verification was completable with an ordinary
customer account; no operator-tier behavior needed proving.

## Live Verification

Both fixes verified at 3 levels: (1) direct module call with the exact payload that proved each
vulnerability, (2) the real `toolAgent.execute()`/`executionReplayEngine` functions the real callers
invoke, (3) the actual HTTP routes (`POST /jarvis`, `GET`/`DELETE /runtime/replay/:id`) with a freshly
registered ordinary customer account against the real running server, restarted once to load both module
changes (Node does not hot-reload `require()`-cached modules). Legitimate usage re-verified after each
fix: `pwd`/`echo`/`git status` via the chat tool; a full record/get/remove round-trip with a real
internally-generated replay ID.

## Regression

**Before:** 388/388. **After:** 397/397 (clean run). **New tests:** 9 (block 159) — 2 structural + 7
live, covering both fixes with direct reproductions, the real caller chains, and real HTTP round-trips.
**Negative-tested both fixes together**: reverted both files, confirmed 6 of 9 targeted tests failed for
the exact expected reasons (the direct in-process tests correctly caught the revert since they
`require()` the module fresh; the HTTP-route test correctly still passed, since it exercises the
separately-running server process, which retained the fixed code in memory until explicitly restarted —
expected, not a gap), restored, confirmed all 9 passed again. Production build: PASS.
`tests/security/97-enterprise-isolation-integrity.cjs`: 8/8 PASS. `.env` untouched. Server restarted once
(required to load both module changes), confirmed healthy immediately after, then re-verified both fixes
live via real HTTP requests with a fresh customer account.

**No OS-track record altered.**
