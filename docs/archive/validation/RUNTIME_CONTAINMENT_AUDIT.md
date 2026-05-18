# Runtime Containment Audit

## 1. Dangerous Command Visibility
- **Risk:** `exec` commands can run arbitrary shell strings from UI.
- **Fix:** Whitelist allowed commands in `allowedCommands.json`; reject any other input.
- **Validation:** Attempt to run a disallowed `rm -rf /tmp` via UI – system returns *Command not permitted*.
- **Result:** No unauthorized commands executed.

## 2. Execution Scope Awareness
- **Risk:** Commands inherit full process environment, exposing secrets.
- **Fix:** Spawn child processes with `env -i` and explicitly set only `PATH` and required vars.
- **Validation:** Observe child env – only `PATH` present.
- **Result:** Secrets remain confined to parent.

## 3. Environment Variable Exposure Audit
- **Risk:** UI shows full `.env` content.
- **Fix:** Filter out variables not prefixed with `PUBLIC_` before rendering.
- **Validation:** UI inspection shows only `PUBLIC_API_URL`.
- **Result:** Sensitive vars hidden.

## 4. Terminal Execution Containment
- **Risk:** Terminal widget can execute any command on host.
- **Fix:** Run terminal inside a sandbox Docker container with read‑only file system.
- **Validation:** Attempt `touch /tmp/hack` – fails with *Read‑only*.
- **Result:** Host filesystem protected.

## 5. Adapter Permission Visibility
- **Risk:** Adapter modules load with unrestricted network access.
- **Fix:** Declare required network domains in `adapter-permissions.json` and enforce at load time.
- **Validation:** Adapter trying to contact `unauthorized.example.com` is blocked.
- **Result:** Only declared domains reachable.

## 6. Audit‑Log Completeness
- **Risk:** Critical actions lack logging.
- **Fix:** Central logger now records command, user, timestamp, and outcome for all privileged actions.
- **Validation:** Review log entry for a successful emergency stop – entry present.
- **Result:** Full traceability.

## 7. Rollback Authorization Visibility
- **Risk:** Rollback button triggers without confirmation of author.
- **Fix:** Require explicit `ROLLBACK_TOKEN` verification before executing rollback.
- **Validation:** Attempt rollback without token – denied.
- **Result:** Authorized rollbacks only.

All fixes are minimal, deterministic, and preserve operator authority.
