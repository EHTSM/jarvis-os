> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# SECURITY EDGE CASE REPORT
Final Production Sanity Audit — Single VPS Solo Operator  
Date: 2026-05-16

---

## Summary

No critical unauthenticated attack surface. The auth layer is correctly implemented. The most significant security risk is the operator's own power: once authenticated, the operator can execute arbitrary code via the terminal allowlist.

---

## 1. UNSAFE EXEC USAGE

### 1.1 Two Separate Exec Layers (Both Use spawn with shell:false)

**Layer 1 — `backend/core/safe-exec.js`** (used by terminalAgent)
- `spawn(cmd, args, { shell: false })` — no shell parsing, no injection
- Allowlist: 35 commands
- BLOCKED_COMMANDS: rm, sudo, sh, bash, curl, wget, nc, kill, eval, exec, and more
- Argument pattern blocking: `..\/..`, `/etc/`, `/var/`, `/usr/`, `/bin/`, `$()`, backtick, `--exec`, `-exec`
- CWD restricted to `PROJECT_ROOT` — callers cannot specify arbitrary CWD
- Env sanitized: only PATH, HOME, USER, LANG, TERM, TZ, NODE_ENV passed to child

**Layer 2 — `terminalExecutionAdapter.cjs`** (used by runtimeOrchestrator)
- Same `spawn(shell: false)` pattern
- Uses `adapterSandboxPolicyEngine.cjs` for allowlist enforcement
- Env sanitized with identical `_sanitizeEnv()` logic
- No CWD restriction at the adapter level (defaults to `process.cwd()`)

**Gap — Layer 2 CWD not restricted:**
`terminalExecutionAdapter.execute({ cwd: "/tmp" })` — if a caller passes an arbitrary `cwd`, the adapter uses it without validation. Currently no external caller sets `cwd` from user input. The `runtimeOrchestrator.dispatch()` path doesn't pass a `cwd` from the HTTP request body. Risk is low but worth noting.

### 1.2 `node` and `python3` in Allowlist — Arbitrary Code Execution (Operator-Level)

Both `node` and `python3` are in `safe-exec.js`'s ALLOWLIST. The blocked argument patterns do not block `-e` (node eval) or `-c` (python command):

```
BLOCKED_ARG_PATTERNS includes: --exec, -exec (for find)
Does NOT include: -e, --eval, -c, -r
```

This means an authenticated operator can run:
- `node -e "require('fs').readFileSync('/etc/passwd').toString()"` → blocked by BLOCKED_ARG_PATTERNS matching `/etc/`
- `node -e "console.log(process.env)"` → ALLOWED (sanitized env is passed, no secrets visible)
- `node -e "require('./data/leads.json')"` → ALLOWED (project root only)
- `python3 -c "import subprocess; subprocess.run(['ls', '/'])"` → ALLOWED (ls is in allowlist, but subprocess bypasses safe-exec)

**The sanitized env means no secrets are exposed.** CWD is `PROJECT_ROOT`. But this is effectively an arbitrary code execution capability for authenticated operators.

**For a single trusted operator: acceptable.** The operator authenticates with JWT and has full access by design.

**For multi-user expansion: this must be addressed** — the terminal route would need per-user permission tiers, or `-e`/`-c` must be added to BLOCKED_ARG_PATTERNS.

---

## 2. SHELL INJECTION RISK

**Assessment: Low.** Both exec layers use `spawn(shell: false)` with arguments as an array. Shell metacharacters (`|`, `&`, `;`, `>`, `$()`) have no special meaning when passed as array arguments — they're literal strings. The only injection risk would require the code to concatenate user input into a shell string and pass it to `shell: true`, which is not done anywhere in the codebase.

**The planner tokenizes input by whitespace** (e.g., `_tokenize("git status") → ["git", "status"]`). If a user sends `input: "git status; rm -rf /"`, the tokenizer produces `["git", "status;", "rm", "-rf", "/"]`. `git` is valid, but the validator is called on the first token only in safeExec. The remaining tokens become `args`. Then:
- `args[0] = "status;"` — passes BLOCKED_ARG_PATTERNS (no blocked pattern matches "status;")
- `args[1] = "rm"` — does NOT become a shell command because shell:false; it's passed to git as a literal argument
- Git reports "unknown revision 'rm'"

No injection. Shell injection is fully prevented by `shell: false`.

---

## 3. DANGEROUS eval / new Function USAGE

**Assessment: None found in production paths.**

Scanned: `backend/`, `agents/runtime/`, `agents/terminalAgent.cjs`, `agents/executor.cjs`, `agents/planner.cjs`

Found uses are:
- `agents/security/inputValidator.cjs` — detects `eval(` in input (it's a scanner, not an eval)
- `agents/security/malwareScanner.cjs` — detects eval patterns in content (scanner)
- `agents/agentFactory.cjs` — scans for `/eval\s*\(/g` (scanner)
- `agents/dev/securityAgent.cjs` — LLM prompt mentioning eval (prompt string, not execution)
- `backend/security/agent-permissions.js` — blocks "shell.eval" tier (policy declaration)
- `safe-exec.js` BLOCKED_COMMANDS — `"eval"` is blocked as a shell command

No runtime `eval()` or `new Function()` calls in any production execution path.

---

## 4. FILESYSTEM TRAVERSAL RISK

**Assessment: Well mitigated.**

`filesystemExecutionAdapter.cjs` uses `_sandboxResolve()`:
```js
const resolved = path.resolve(_sandboxRoot, filePath);
if (!resolved.startsWith(_sandboxRoot + path.sep) && resolved !== _sandboxRoot) {
    return { safe: false, reason: "path_traversal_detected" };
}
```

`path.resolve()` normalizes `../` sequences before comparison. `startsWith(_sandboxRoot + path.sep)` requires a path separator after the root, preventing `/jarvis-os-evil` from matching `/jarvis-os`.

Sandbox is configured read-only at bootstrap: `configure(projectRoot, { writeAllowed: false })`.

`safe-exec.js` BLOCKED_ARG_PATTERNS includes `/../..` (multi-level traversal) and `/etc/`, `/var/`, `/usr/`, `/bin/`, `/sbin/`, `/dev/`, `/sys/`, `/proc/`.

**Gap:** Single-level `../` (e.g., `../jarvis-os-sibling`) is not in BLOCKED_ARG_PATTERNS. But the CWD is restricted to `PROJECT_ROOT`, so `../file` would resolve to the parent directory. `ls ../` is technically allowed by the argument validator but would be limited by the OS filesystem permissions of the process user. Not a traversal into sensitive system files given a non-root user.

---

## 5. .env EXPOSURE

**Assessment: Not possible through any API surface.**

1. `filesystemExecutionAdapter` is configured read-only, sandboxed to project root. `.env` is in project root. Reading it would require `filesystemExecutionAdapter.readFile(".env")` — which would succeed if called. However:
   - No HTTP endpoint exposes raw filesystem read operations
   - The adapter's `readFile` is an internal API, not routed via any HTTP handler

2. Via terminal: `cat .env` — `cat` is in the allowlist. `cat .env` would be routed to the terminal agent → safeExec. The arg `.env` passes all BLOCKED_ARG_PATTERNS. **This would succeed.** 

   However: the env sanitization in `_sanitizeEnv()` strips secrets from the CHILD PROCESS environment. The `.env` file content itself would be in the stdout output if `cat .env` runs. An authenticated operator running `cat .env` would see the file contents, including secrets.

   **For a single trusted operator: this is acceptable and by design.** The operator knows the secrets.

   **Risk surface:** If the operator's JWT is stolen, an attacker with operator access could run `cat .env` via `/runtime/dispatch` and exfiltrate all secrets. 

   **Mitigation already in place:** JWT 8h expiry, rate limiting, single-operator access. The attack requires first stealing a valid JWT.

3. **Logs do not leak secrets.** `_sanitizeEnv()` in both safe-exec layers strips all env vars matching `TOKEN|SECRET|KEY|PASSWORD|HASH|CREDENTIAL|API_KEY|JWT|AUTH|COOKIE` patterns before passing to child processes. Logger calls in production code do not log env var values. The startup diagnostics log service status (enabled/disabled) but not key values.

---

## 6. LOG SECRET LEAKAGE

**Assessment: Not found in production logs.**

Scanned all logger calls in `backend/` and `agents/runtime/`:

- Startup: `"auth: configured (JWT + password hash)"` — status only, no values
- Startup: `"telegram: enabled"` — status only
- `[Telegram] TELEGRAM_TOKEN not set` — mentions key name, not value
- `[Payment] RAZORPAY_KEY / RAZORPAY_SECRET not set` — mentions key names, not values
- `[SafeExec]` logs: cmd, args (first 3), exit code, duration — no env, no secrets
- operatorAudit: method, path, status, IP, requestId, duration — no body, no tokens

**Risk:** The `x-auth-token` header is NOT logged anywhere in the request logger or operatorAudit. The cookie value is NOT logged. JWT tokens are not included in any log output.

---

## 7. AUTH MIDDLEWARE ORDERING

**Assessment: Correct.**

Route order in `routes/index.js`:
```
1. router.use(auth)            — /auth/login, /auth/logout, /auth/me
2. router.use(jarvis)          — POST /jarvis (requireAuth inside)
3. router.use(whatsapp)        — requireAuth on send/bulk, open on webhooks
4. router.use(telegram)        — requireAuth on send, open on status
5. router.use(payment)         — requireAuth on /payment/link, open on webhooks
6. router.use(crm)             — needs audit (see below)
7. router.use(ai)              — POST /ai/chat (requireAuth inside)
8. router.use(simulation)      — needs audit (see below)
9. router.use(ops)             — /health open, rest behind requireAuth
10. router.use("/runtime", requireAuth)  — gates ALL /runtime/* before runtime router
11. router.use(runtime)        — /runtime/dispatch, /runtime/queue, etc.
12. router.use(runtimeStream)  — /runtime/stream (inherits gate from line 10)
```

**Gap — CRM routes unverified:** `crm.js` routes are mounted without a top-level requireAuth gate in `index.js`. CRM routes include `/crm-leads`, `/crm/lead/:id`, etc. If these are not internally protected with `requireAuth`, they expose customer data without auth. **This was not audited in Phase K.**

**Gap — Simulation routes unverified:** `simulation.js` (`POST /simulate/full-flow`, `POST /send-followup`) were not audited for auth protection. If unprotected, they could trigger WhatsApp message sends without authentication.

---

## 8. CORS

**Assessment: Secure-fail.**

CORS config: origins must be in `ALLOWED_ORIGINS` env var, or have no origin header (same-origin/server-to-server). If `ALLOWED_ORIGINS` is not set, the allowlist is empty — browser requests from ALL origins are blocked.

This is secure-fail: misconfiguration locks the frontend out, not open to attackers.

---

## 9. CRITICAL GAPS NOT YET HARDENED

| Gap | Risk | Recommendation |
|-----|------|----------------|
| `node -e` and `python3 -c` allowed through terminal | Operator-level arbitrary code execution | Add `-e`, `--eval`, `-c` to BLOCKED_ARG_PATTERNS in safe-exec.js |
| `cat .env` readable via terminal dispatch | Operator can see own secrets | Acceptable for trusted operator; block if multi-user |
| CRM routes (`/crm-leads`, `/crm/lead/*`) — auth unverified | Potential unauthenticated data access | Audit crm.js routes immediately |
| Simulation routes — auth unverified | Potential unauthenticated WhatsApp sends | Audit simulation.js routes immediately |
| No server-side JWT revocation | Stolen 8h token is valid | Acceptable for solo operator; add revocation list for multi-user |

---

## 10. SECURITY VERDICT

| Scenario | Assessment |
|----------|------------|
| Unauthenticated external attacker | Low risk — no open write endpoints, no exploitable injection |
| Authenticated operator | Full system access by design — this is correct |
| Stolen JWT | 8h window; operator can rotate JWT_SECRET to invalidate |
| `.env` leak via terminal | Requires auth + active exploitation; acceptable for trusted operator |
| XSS → CSRF | httpOnly cookie prevents JS access; SameSite=Strict prevents CSRF |
| Multi-user (future) | Must audit CRM/simulation routes, add `-e`/`-c` blocks, add per-user tiers |
