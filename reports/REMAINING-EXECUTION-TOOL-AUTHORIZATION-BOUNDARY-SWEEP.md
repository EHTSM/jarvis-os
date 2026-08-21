# REMAINING EXECUTION & TOOL AUTHORIZATION BOUNDARY SWEEP

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-21 · **Branch:** `security/reality-completion`

---

## Scope

Sweep of remaining customer-reachable execution/tool capabilities not already covered by the four
prior completed audits (Browser Controller, Agent Runtime Execution-Boundary, Filesystem Execution
Adapter Sandbox, Founder/Ops Authorization Cluster, Endpoint Authorization). Inventoried the real,
current repository — not prior reports alone.

## Inventory & Reachability

Traced every remaining real execution-capable surface via grep + caller analysis:

| Surface | Reachable from customer? | Classification |
|---|---|---|
| `agents/primitives.cjs` (`openURL`/`openApp`) | Yes — `POST /jarvis` chat → `parser.js` raw-URL match → `toolAgent.cjs`'s `open_url` case | **GENUINELY VULNERABLE** (fixed) |
| `agents/runtime/adapters/browserExecutionAdapter.cjs` | No — `setDriver()` has zero real callers; `_driver` stays `null` forever; `toolAgent.cjs` never dispatches `adapterType:"browser"` | DEAD/CLEAN |
| `agents/runtime/adapters/processLifecycleAdapter.cjs` | No — `terminateProcess()` only accepts internal registration IDs, never a raw PID; zero callers found | CLEAN |
| `agents/runtime/adapters/gitExecutionAdapter.cjs` | No — well-designed (`spawn(shell:false)`, read/write split, `BLOCKED_ARGS` denylist), but `toolAgent.cjs` never dispatches `adapterType:"git"`, no direct route | CLEAN/unreachable |
| `backend/services/desktopController.cjs` | Operator-only — already uses safe `execFileSync(bin, argvArray)`, gated `operatorOnly` via `/computer/*` | CLEAN |
| `backend/routes/codingAssistant.js` (`_gitLog`) | Yes, but `n` parameter is never attacker-supplied — only call site is `_gitLog(cwd)`, always uses the hardcoded default `10` | CLEAN |

## Genuine Vulnerability Found — 1, proven live

**`agents/primitives.cjs`'s `openURL()`/`openApp()` — shell command-substitution injection (P0).**
Both built a shell command *string* (`open "${safe}"`, `xdg-open "${url}"`) passed to `exec()`.
`SAFE_URL_REGEX`'s allowed charset includes `$`, `(`, `)` individually (legitimate URL characters in
isolation), but in combination they spell out real shell command substitution (`$(...)`). Live-
reproduced, non-destructively: `https://example.com/$(touch$IFS/tmp/PROOF)` passed `SAFE_URL_REGEX`
(every individual character allowed) and genuinely executed `touch` via `/bin/sh`'s command
substitution — `$IFS` supplies the whitespace the payload needs without a literal space character,
bypassing any validator that only blocks literal spaces/semicolons/pipes/backticks.

**Reachable by any ordinary, authenticated customer** via a plain chat message: `backend/utils/
parser.js`'s raw-URL matcher (`/https?:\/\/[^\s]+/i`, line ~154) accepts any http(s) URL with no
whitespace and passes it straight through to `openURL()` with zero further validation —
`agents/toolAgent.cjs`'s `case "open_url"` calls it directly.

## Fix

`agents/primitives.cjs` — reused the identical, already-established pattern from every prior fix
this session (`safe-exec.js`, `terminalExecutionAdapter.cjs`, `browserController.cjs`'s
`downloadFile()`): added `_spawnExec(cmd, args, timeoutMs)` using `spawn(cmd, args, {shell:false})`
with an argument array. `openURL()`'s darwin/win32/linux branches and `openApp()`'s darwin/win32/
linux branches all now call `_spawnExec` instead of the shell-string `_exec()` helper. `openApp()`'s
own metacharacter-stripping sanitizer was retained as defense-in-depth even though no longer
required for safety. `webSearch`, `typeText`, `pressKey`, `pressKeyCombo` were unchanged (`webSearch`
calls the now-fixed `openURL` internally; the robotjs-based functions never touch a shell).

## Special Decision — filesystemExecutionAdapter customer-facing sandbox

**Recommendation: KEEP customer-facing, do NOT gate `operatorOnly`.**

Evidence:
- `frontend/src/components/EmptyState.jsx`'s own onboarding copy explicitly advertises this as a
  first-class product feature: *"Intelligence is a command interface — not just chat. You can ask
  questions, run shell commands, dispatch tasks, read files, and execute workflows directly."*
- `frontend/src/App.jsx`'s main chat input (`handleSend`) detects exec-shaped commands
  (`/^(run|execute|create file|read file|open |launch )/i`) with **no role-based gating anywhere in
  its dispatch path** — this is universally available to every authenticated tenant by design, not
  an accidental omission.

This is a genuine, intentional product boundary (a command-interface product, not a chat-only
assistant), not an authorization gap. The real risk this sweep and the prior Filesystem Adapter
Sandbox audit found was never "customers can use this feature" — it was that the underlying
mechanisms (protected-path enforcement, symlink escape, and now shell injection) didn't actually
hold up under that intentionally broad reachability. All three are now fixed. Encoded as a
regression-test "decision record" (block 161) so this determination is locked in, not silently
re-litigated by a future mission without new evidence.

## Live Verification

Full HTTP chain verified against the restarted, live production server using a freshly registered
ordinary customer account (`m15test_*@test.com`, role `user`):

- **A) Injection attempt correctly fails to execute**: `POST /jarvis` with
  `{"message":"open https://example.com/$(touch$IFS/tmp/rc_m15_HTTP_INJECTION_PROOF)"}` returned
  `200`/`success:true` (the chat reply itself succeeds — the URL is accepted and "opened"), but the
  injected `touch` command never executed — confirmed no marker file was created on the real
  filesystem.
- **B) Legitimate functionality still works**: `POST /jarvis` with
  `{"message":"open https://www.google.com"}` returned `200`/`success:true`, confirming zero
  regression on normal use of this feature.

## Limitations

- `desktopController.cjs` and `gitExecutionAdapter.cjs` were spot-verified as already-safe/unreachable
  rather than exhaustively re-audited line-by-line, consistent with the mission's instruction not to
  re-certify already-covered surfaces without new evidence of risk.
- No credential-blocked or environment-blocked findings this mission.

## Regression

**Before:** 407/407. **After:** 412/412 (clean run, 0 fail, 0 skipped). **New tests:** 5 (block 161)
— 1 structural + 4 live, covering the safe-helper usage, the exact injection payload now being inert,
legitimate URL-opening, the full real chat-message chain, and the special-decision record.
**Negative-tested**: reverted the fix, confirmed 3 of 5 targeted tests failed for the exact expected
reasons (2 unrelated — normal open success shape, and the decision-record test which doesn't depend
on the code fix — correctly still passed), restored, confirmed all 5 passed again cleanly.

**Build:** PASS (`npm run build:frontend`, clean production build).
**Security suite:** `tests/security/97-enterprise-isolation-integrity.cjs` — 8/8 PASS.
**Server:** restarted once (required to load the fix — `primitives.cjs` is `require()`-cached),
confirmed healthy (`/health` → 200) immediately after, then live-verified via real HTTP against the
restarted server.
**`.env`:** untouched (`git status --short .env` empty). **No merge. No push.** Unrelated
uncommitted work in the working tree preserved throughout.

**No OS-track record altered.**
