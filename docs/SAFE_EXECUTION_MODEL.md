# Safe Execution Model
**Phase H — Production Hardening**
**Generated:** 2026-05-15

---

## Overview

JARVIS executes operator commands through a layered security model. Every command passes through multiple validation gates before any process is spawned.

```
Operator input (HTTP)
        │
        ▼
  Route layer (requireAuth + rateLimiter)
        │
        ▼
  Intent parser (parser.js) — classifies to action type
        │
        ▼
  Agent permission check (agent-permissions.js) — tier enforcement
        │
        ▼
  Tool agent dispatch (toolAgent.cjs)
        │
        ├── terminal intent → terminalExecutionAdapter.cjs (shell:false + allowlist)
        │                            or
        │                  → safe-exec.js (for backend-initiated commands)
        │
        └── other intents → filesystem/git/vscode adapters
```

---

## Layer 1: Route Authentication (`requireAuth`)

All `/runtime/*` routes require a valid JWT cookie. No unauthenticated request reaches execution.

In production (`NODE_ENV=production`): full JWT validation required.
In dev mode (no `JWT_SECRET`): passthrough allowed — never use in production.

---

## Layer 2: Agent Permission Model (`backend/security/agent-permissions.js`)

Every action is classified into one of four tiers:

| Tier | Examples | Behavior |
|---|---|---|
| `read` | `fs.read`, `git.status`, `runtime.history` | Always allowed, no logging overhead |
| `safe_write` | `fs.write`, `git.commit`, `runtime.dispatch` | Allowed, logged at INFO |
| `dangerous` | `git.push`, `npm.install`, `shell.exec` | Requires `operatorApproval: true` in request body or `x-operator-approval: true` header |
| `blocked` | `shell.sudo`, `git.force_push`, `agent.spawn_new`, `process.self_exec` | Always rejected, logged at ERROR, cannot be overridden |

### Blocked Actions — Never Permitted

These actions are permanently blocked regardless of any flag:

| Action | Reason |
|---|---|
| `shell.sudo` | Root privilege escalation |
| `shell.rm_recursive` | Destructive filesystem operation |
| `shell.curl_pipe` | Remote code execution vector |
| `shell.wget_pipe` | Remote code execution vector |
| `shell.eval` | Arbitrary code execution |
| `shell.chroot` | Escape containment |
| `process.self_exec` | Recursive agent spawning |
| `agent.spawn_new` | Autonomous agent proliferation |
| `env.read_secrets` | Credential exfiltration |
| `package.publish` | Supply chain attack vector |
| `git.force_push` | Irreversible history rewrite |
| `system.shutdown` | VPS availability attack |
| `system.reboot` | VPS availability attack |

---

## Layer 3: `safe-exec.js` — Process Execution Wrapper

`backend/core/safe-exec.js` is the canonical way to spawn any process from backend code.

### Key Properties

| Property | Implementation |
|---|---|
| No shell | `spawn(cmd, args, { shell: false })` — command string is never parsed by a shell |
| Command allowlist | Set of ~25 safe executables; anything else is rejected |
| Blocked commands | `rm`, `sudo`, `bash`, `sh`, `curl`, `wget`, `kill`, `chmod` + 20 more |
| Argument validation | Each argument checked against blocked patterns (path traversal, `$()`, backtick, `/etc/`, `/var/`, `-exec`) |
| CWD restriction | CWD must resolve to a path within the project root — no escaping to system dirs |
| Environment sanitization | Only `PATH`, `HOME`, `USER`, `LANG`, `TERM`, `TZ`, `NODE_ENV` passed to child; all `*TOKEN*`, `*SECRET*`, `*KEY*`, `*PASSWORD*`, `*HASH*`, `*CREDENTIAL*` vars stripped |
| Timeout enforcement | Hard kill (`SIGKILL`) after `timeoutMs` (max 60s); `process.kill(-pid)` targets the process group |
| Output cap | 128KB per stream; truncated if exceeded |
| Structured logging | Every execution logged: command, args (first 3), exit code, duration, timedOut |

### Usage

```js
const { run, validate } = require("../../core/safe-exec");

// Validate only (no spawn)
const v = validate("git", ["status"]);
// { ok: true }

const v2 = validate("rm", ["-rf", "/"]);
// { ok: false, reason: "blocked_command: rm" }

// Execute
const result = await run("git", ["log", "--oneline", "-10"]);
// { ok: true, stdout: "...", stderr: "", exitCode: 0, timedOut: false, blocked: false, durationMs: 45 }

const result2 = await run("cat", ["../../.env"]);
// { ok: false, blocked: true, reason: "blocked_argument_pattern: ../../.env", ... }
```

---

## Layer 4: Terminal Execution Adapter (`terminalExecutionAdapter.cjs`)

Used by the runtime adapter framework when operators dispatch `terminal` intent tasks.

| Property | Value |
|---|---|
| Shell | `spawn(shell: false)` |
| Allowlist | `adapterSandboxPolicyEngine.cjs` BASE_ALLOWLISTS["terminal"] |
| Global blocked patterns | `sudo`, `rm` chaining, `curl`, `wget`, `nc`, redirection to system paths |
| Timeout | 15s default, max 60s |
| Output cap | 512KB |
| CWD | Project root |

This is the production path for operator terminal commands dispatched via `/runtime/dispatch`.

---

## Legacy Path Warning: `terminalAgent.cjs`

`agents/terminalAgent.cjs` uses `child_process.exec()` — which invokes a shell (`sh -c command`).

**Status:** Still in codebase. Has its own BLOCKED patterns and ALLOWED_PREFIXES but uses a shell, which means the OS shell parser sees the command string. Shell metacharacters could potentially bypass the regex-based blocklist.

**Mitigation:** `terminalAgent.cjs` is not reachable from any authenticated operator route. It is only callable via the legacy route handler (`backend/routes/legacy.js`), which itself requires the deprecated non-runtime execution path.

**Recommendation (P1):** Migrate `terminalAgent.cjs` callers to use `safe-exec.js` or `terminalExecutionAdapter.cjs` and remove the legacy route.

---

## Environment Sanitization Detail

Before any child process is spawned via `safe-exec.js`, the environment is replaced with a minimal safe set:

**Always passed:**
- `PATH` — so executables can be found
- `HOME` — for git config lookup
- `USER` — for whoami/audit
- `LANG`, `TERM`, `TZ` — locale/display

**Always stripped (pattern matching):**
- `*TOKEN*` — API tokens
- `*SECRET*` — any secret
- `*KEY*` — API keys
- `*PASSWORD*` — passwords
- `*HASH*` — password hashes
- `*CREDENTIAL*` — credential strings
- `*AUTH*` — auth tokens
- `*JWT*` — JWT secrets
- `*COOKIE*` — session cookies

This ensures that even if a malicious command somehow executed, it could not read `JWT_SECRET`, `GROQ_API_KEY`, `RAZORPAY_KEY_SECRET`, `OPERATOR_PASSWORD_HASH`, etc. from the environment.

---

## Security Test Results

```
tests/security/05-injection-security.cjs — 103/103 PASS

Unit tests:
  ✓ rm, sudo, bash, curl, wget blocked at validate()
  ✓ echo, ls, git, node allowed
  ✓ Path traversal args (../../.env, /etc/shadow, /var/www) blocked
  ✓ $() and `` command substitution blocked in arguments
  ✓ find -exec injection blocked
  ✓ Empty/null/numeric command blocked
  ✓ run("rm", ["-rf", "/"]) blocked before spawn
  ✓ run("ls", {cwd: "/etc"}) blocked (outside project root)
  ✓ Timeout enforced: node -e "setTimeout(99999)" killed after 500ms
  ✓ run("cat", ["../../.env"]) blocked

HTTP tests:
  ✓ 10 injection payloads via /runtime/dispatch — no sensitive data leaked
  ✓ Path traversal attempts — no secrets leaked
  ✓ 7 malformed cookie variants — all handled, server stays alive
  ✓ Invalid origins (evil.com, null, file://) — handled, no secret leak
  ✓ 20 concurrent auth attempts — rate limiter fires (429)
  ✓ Oversized dispatch inputs — server responds, no secrets leaked
  ✓ x-request-id propagated on all routes
```
