# BROWSER CONTROLLER COMMAND-INJECTION & DOWNLOAD SAFETY AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-20 · **Branch:** `security/reality-completion`

---

## Scope

A narrow, deep audit of `backend/services/browserController.cjs`'s `downloadFile()` — previously flagged
and explicitly deferred during the Timeout/Cancellation Safety Audit as a shell-interpolated `curl`
surface, not assumed exploitable, to be proven.

## Method

Read the full file (402 lines). Traced every real caller of `downloadFile()` via exhaustive grep. Proved
each candidate vulnerability with a safe, isolated, non-destructive live reproduction before fixing
anything, per the mission's explicit "do not assume it is exploitable; prove it" instruction.

## Callers Traced

`POST /computer/browser/download` (`backend/routes/computerController.js:124`) → `req.body` passed
**directly and unfiltered** into `downloadFile({ url, destination, browser })` — both `url` and
`destination` are fully caller-controlled. `backend/services/computerController.cjs`'s `browser.download`
facade member is a pure passthrough with zero other callers anywhere in the codebase — dead code for that
specific path, not independently exploitable. The route is gated `requireAuth + operatorOnly` at
`routes/index.js:297` (`router.use("/computer", requireAuth, operatorOnly)`) — confirmed correctly
enforced, live, before and after this mission's fix (an ordinary customer account correctly receives 403
from the real route both before and after).

## Genuine Vulnerabilities Found — 3, all proven live

**1. Shell command injection (both `url` and `destination`).** The original code:
```js
execSync(`curl -L -o "${dest}" "${url}"`, { timeout: 60000, stdio: "ignore" });
```
Live-reproduced, safely and non-destructively: a `url` of `http://x"; touch /tmp/PROOF; echo "` broke out
of the intended double-quoted argument and executed an arbitrary second shell command — confirmed via a
marker file created outside the intended `curl` invocation, then removed. Identically reproduced via
`destination`.

**2. No SSRF protection.** Every other real navigation entry point in this codebase (`openTab()` two
functions above `downloadFile()` in this exact file, plus the entire ODI browser-automation family) calls
`assertSafeNavigationTarget()` — `downloadFile()` called nothing. Live-reproduced: pre-fix, nothing would
have stopped `url` from pointing at `169.254.169.254` (cloud metadata), `localhost`, or an internal
service — confirmed post-fix that all three are now correctly blocked before `curl` is ever invoked.
`file://` scheme access was tested and found blocked, but only incidentally by curl 8.7.1's own default
protocol restrictions (disabled since curl 7.69 unless `--proto` explicitly grants it) — not something
this code intentionally enforced, so not relied upon as a defense.

**3. Arbitrary path write via `destination`.** No containment check existed at all. Live-reproduced: a
`destination` of `/tmp/sandbox/../../etc_passwd_copy_test` correctly shell/path-normalized to a location
one directory level outside the intended sandbox, proving `downloadFile()` could write to any filesystem
path the process has permission for — not merely somewhere under an intended downloads directory.

## Checklist items investigated and found not applicable

**Cookie/credential exposure**: `downloadFile()` is a bare, stateless `curl` invocation entirely
disconnected from `browserSessionManager`'s cookie/profile state — no session data is threaded into it at
all, so this vector doesn't exist in either direction.

**Concurrent download races**: the original `execSync` call is fully synchronous; Node's single-threaded
execution model means two calls cannot interleave mid-invocation within this process (same reasoning
already established and verified in the Persistence Bucket-C Sweep for this codebase's other
`instances:1, exec_mode:fork` deployment). The fix (`spawn` via a `Promise`) preserves this — each
download's own promise resolves independently, with no shared mutable state between concurrent calls.

**Timeout/cleanup**: the original 60s `execSync` timeout was real and already correctly `SIGTERM`'d the
child on expiry — not a defect, carried forward in the fix (`spawn` + a `setTimeout` that
`SIGKILL`s the process group, matching the `backend/core/safe-exec.js` precedent already established
elsewhere in this codebase, closing the residual gap that a raw `SIGTERM` alone can be caught/ignored by
a misbehaving child while `SIGKILL` cannot).

**Redirects**: `-L` (follow redirects) was already present and preserved — `--max-redirs 5` was added as
a bound (curl's own unbounded-redirect-chain default was the only pre-existing gap here), matching the
same reasoning as the destination-containment fix: real behavior preserved, an unbounded edge closed.
Redirect *targets* are not individually re-validated against the SSRF blocklist mid-chain (curl handles
the actual HTTP negotiation, not this code) — noted as a residual limitation, not fixed, since doing so
would require intercepting curl's redirect handling, a materially larger change than this mission's scope
calls for.

## Fixes

Rewrote `downloadFile()` (`backend/services/browserController.cjs`) with 3 independent, minimal changes,
reusing existing patterns already established in this exact codebase — no new framework:

1. **`spawn(cmd, args, { shell: false })` with an argument array** instead of a shell command string —
   the same principle `backend/core/safe-exec.js` already establishes. Not routed through `safe-exec.js`
   itself, since that module hard-blocks `curl` in its `BLOCKED_COMMANDS` set and restricts `cwd` to the
   project root, neither of which fits this function's real job (downloading to an arbitrary user-chosen
   destination, typically `~/Downloads`, outside the project tree).
2. **`assertSafeNavigationTarget(url)`** — the exact, already-proven SSRF guard shared by every other real
   navigation path in this codebase (`backend/utils/urlSafety.cjs`), reused as-is, called before `curl` is
   ever invoked.
3. **Destination containment** — the resolved `destination` (or the function's own existing default) must
   stay inside `~/Downloads`; anything that resolves outside is rejected outright, not silently
   redirected or truncated.

The unused `browser` parameter (never referenced anywhere in the original function body) was dropped as
dead code — not a functional change.

`backend/routes/computerController.js`'s `/computer/browser/download` handler was updated to `await` the
now-async `downloadFile()`, matching the identical async-handler pattern already used two lines above it
in the same file for `captureScreenshot`/`executeWorkflow`.

## Live Verification

All 3 vulnerabilities re-run against the fixed code with the identical payloads: injection via both `url`
and `destination` confirmed inert (curl treats the malicious string as a single literal, invalid
argument — no shell metacharacter interpretation); path traversal confirmed rejected before any write is
attempted; SSRF confirmed blocked for the cloud metadata IP, `localhost`, and `127.0.0.1`. A real,
legitimate download to a real public URL (`https://httpbin.org/robots.txt`) confirmed still succeeds
end-to-end, both with an explicit destination and with the function's own default naming — proving the
safety changes preserve normal use. The real HTTP route confirmed still correctly rejects an ordinary,
freshly-registered customer account with 403 (the pre-existing `operatorOnly` gate, unaffected by this
fix). Operator-tier "should succeed via the real HTTP route" verification remains
CREDENTIAL-BLOCKED — no operator test account exists anywhere in this session's history, consistent with
every prior `operatorOnly` mission — but the underlying function `downloadFile()` (the exact code path the
route invokes, with identical logic) was verified directly and exhaustively, satisfying the substance of
the requirement.

## Limitations

Redirect-chain targets are not individually re-checked against the SSRF blocklist mid-redirect (only the
initial `url`) — curl handles the HTTP-level redirect negotiation itself; intercepting and re-validating
each hop would require a materially larger change than this mission's narrow scope. `--max-redirs 5`
bounds the chain length as a mitigating factor.

## Regression

**Before:** 379/379. **After:** 388/388 (clean run; 2 transient flakes seen during one run under
concurrent load — both pre-existing `recoverStaleMissions()`-related live tests already documented as
environment-load-sensitive in prior missions this session, confirmed passing cleanly on isolated re-run,
unrelated to `browserController.cjs`).
**New tests:** 9 (block 158) — 3 structural + 6 live, including direct reproductions of all 3
vulnerabilities against both the fixed and (during negative-testing) reverted code, an SSRF-block proof,
a real end-to-end legitimate-download proof, and a real-HTTP-route 403 proof. **Negative-tested**:
reverted `browserController.cjs`, confirmed 7 of 9 targeted tests failed for the exact expected reasons
(the 2 that still passed test invariants the vulnerability never touched — the legitimate-download and
403-gate behaviors), restored, confirmed all 9 passed again. Production build: PASS.
`tests/security/97-enterprise-isolation-integrity.cjs`: 8/8 PASS. `.env` untouched. Server restarted once
(required to load the route-file change), confirmed healthy immediately after.

**No OS-track record altered.**
