# Terminal Execution Safety

## Command Whitelisting
- **Risk:** Arbitrary shell commands can be entered.
- **Fix:** Only allow commands listed in `terminalWhitelist.json`.
- **Validation:** Enter `ls` – succeeds; `ps aux` – blocked with *Not permitted*.
- **Result:** Execution limited to safe commands.

## Environment Sanitization
- **Risk:** Full host env leaks secrets to terminal.
- **Fix:** Launch terminal with `env -i PATH=$PATH` and no other vars.
- **Validation:** `printenv` shows only `PATH`.
- **Result:** Secrets remain hidden.

## Session Isolation
- **Risk:** Terminal shares host PID namespace.
- **Fix:** Run terminal inside a Docker container with `--rm --network none`.
- **Validation:** Attempt network request – fails.
- **Result:** No host network access.

## Audit Logging
- **Risk:** Terminal actions are not recorded.
- **Fix:** Log every command, user, timestamp, and exit status to `terminal.log`.
- **Validation:** Execute `whoami`; entry appears in log.
- **Result:** Full traceability of terminal usage.

All changes are minimal, deterministic, and preserve operator authority.
