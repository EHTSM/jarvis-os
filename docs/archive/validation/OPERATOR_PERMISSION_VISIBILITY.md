# Operator Permission Visibility

## Dangerous Command Visibility
- UI now masks any command not in `allowedCommands.json` with *Command hidden* label.
- Validation: Attempt to view `rm -rf /` – UI shows *Command hidden*.

## Execution Scope Awareness
- Each action displays a tooltip summarizing granted scopes (e.g., *Filesystem: read‑only, Network: allowed‑domains*).
- Validation: Hover over *Deploy* – tooltip shows exact scopes.

## Environment Variable Exposure
- UI only renders variables prefixed with `PUBLIC_`.
- Validation: Open Settings – only `PUBLIC_API_URL` displayed.

## Adapter Permission Visibility
- Adapter cards list permissible domains under *Permissions* section.
- Validation: Adapter X shows `api.trusted.com` only.

## Audit‑Log Access
- Operators can view a filtered log via *Logs* tab showing only their own actions.
- Validation: Filter by user – entries correspond.

All visibility changes are minimal, deterministic, and keep operator authority intact.
