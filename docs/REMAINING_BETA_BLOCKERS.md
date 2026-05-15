# Remaining Beta Blockers
**Phase F — Daily Operator Mode**
**Generated:** 2026-05-15

---

## Severity Definitions

- **P0 — Launch blocker:** System is broken or insecure without this fix
- **P1 — Beta blocker:** Operators will hit this in first session; must fix before handing to non-engineer operators
- **P2 — Beta friction:** Painful but workable; fix before stable release
- **P3 — Polish:** Nice to have; doesn't block operator usage

---

## P0 — Launch Blockers

None. All P0 issues from Phase E were resolved.

---

## P1 — Beta Blockers

### 1. JWT_SECRET and OPERATOR_PASSWORD_HASH not set in production .env

**Impact:** All `/auth/*` routes return 503. Login is impossible. Operators cannot authenticate.

**Current state:** `NODE_ENV=production` is set in `.env` but `JWT_SECRET` and `OPERATOR_PASSWORD_HASH` are not. Dev passthrough is disabled in production mode. Server correctly returns 503.

**Fix required:** Operator must:
1. Generate a 64-char random secret: `openssl rand -hex 32`
2. Set `JWT_SECRET=<secret>` in `.env`
3. Hash the operator password: `node -e "const c=require('crypto'); const s=c.randomBytes(16).toString('hex'); console.log(s+':'+c.scryptSync('YOUR_PASSWORD',s,64).toString('hex'))"`
4. Set `OPERATOR_PASSWORD_HASH=<result>` in `.env`
5. Restart server

**Operator documentation:** See `docs/OPERATOR_ONBOARDING.md`

**Risk if unresolved:** Production deployment has no functional auth → operator console inaccessible in production.

---

### 2. SSE stream silently fails when session expires mid-session

**Impact:** If the 8-hour JWT cookie expires while an operator is active, the SSE stream closes. The EventSource auto-reconnects but the reconnect request will return 401. The operator sees no visual feedback — execution log goes silent with no indication why.

**Current state:** `_classifyAuthErr` in `OperatorConsole.jsx` catches auth errors on `_fetch` calls (ops polls, dispatch, queue). It does NOT catch SSE auth errors because EventSource error events don't carry HTTP status codes.

**Fix required:** On SSE `error` event, attempt a `checkHealth()` or `getAuthStatus()` call. If that returns 401, trigger the "session expired" banner.

**Workaround:** Operator can refresh the page and re-login.

---

### 3. Queue panel state lost on refresh

**Impact:** Operator dispatches 3 tasks to the queue and refreshes the page. The queue panel shows empty. Tasks are still queued in the backend but the panel doesn't re-poll queue state on mount.

**Current state:** `WorkflowPanel` only shows dispatch results from the current session. No initial queue state fetch on mount.

**Fix required:** On mount, call a new `/runtime/queue/list` endpoint (or extend `/runtime/status` to include pending queue items) and hydrate the panel.

---

## P2 — Beta Friction

### 4. Evolution endpoints return fallback data

**Impact:** The Evolution panel shows an optimization score and suggestions, but `/evolution/score` and `/evolution/suggestions` return static/fallback values. An operator acting on these suggestions is acting on fake data.

**Current state:** Evolution module is not connected to real scoring logic.

**Fix required:** Either wire up real evolution logic or clearly label the panel as "not active" / hide it until the feature is real.

---

### 5. No reconnect indicator on SSE disconnect

**Impact:** Backend restarts during a session. SSE disconnects. EventSource retries automatically (~3s). For those 3 seconds (and any longer reconnect delay), the operator sees a frozen execution log with no status indicator.

**Current state:** No visual "reconnecting…" state in the UI.

**Fix required:** On SSE `error` or `close`, show a "reconnecting" badge in the console header. Clear it on `open`.

---

### 6. Adapter panel shows static capability labels

**Impact:** Adapter cards show capabilities as text from the status response. If an adapter is degraded or overloaded, the card still looks healthy. Operators can't tell which adapters are actually available.

**Current state:** `AdapterPanel.jsx` renders adapter name, type, and capability list. No colour-coding by health state, no error count display.

**Fix required:** Add a green/amber/red health dot derived from the adapter's error rate or status field if available.

---

### 7. Execution log truncates task input at 40 characters

**Impact:** Operator dispatches a multi-step task with a long description. The execution log shows "run the full deployment pipeli…" — not enough context to identify the task.

**Current state:** `lastExec` in `OperatorConsole.jsx` truncates `d.input || d.task` to 40 chars.

**Fix required:** Show 80–100 chars with a tooltip or expandable row for the full input.

---

## P3 — Polish

### 8. No keyboard shortcut to focus the command input

Operator navigates away from the Workflow panel and back. There's no `Alt+W` or similar shortcut to immediately focus the task input textarea.

### 9. History time display shows "0m ago" for recent entries

Within 60 seconds of a dispatch, the history row shows "0m ago". Should show "just now" or seconds.

### 10. Mobile tab bar missing a badge for failures

On mobile, the Log tab has no indicator that there are new failures. Operator won't know to check unless they tab over.

### 11. Console "Clear" confirmation absent

Clicking "Clear" on the AI console immediately deletes all history with no undo. A confirmation or undo option would prevent accidental loss of context.

---

## Summary Table

| # | Severity | Title | Fix Effort |
|---|---|---|---|
| 1 | P1 | JWT_SECRET + OPERATOR_PASSWORD_HASH not configured | Docs + operator setup |
| 2 | P1 | SSE auth expiry silent failure | ~30 lines code |
| 3 | P1 | Queue state lost on refresh | New endpoint + mount fetch |
| 4 | P2 | Evolution panel shows fake data | Feature wire-up or label |
| 5 | P2 | No SSE reconnect indicator | ~20 lines code + CSS |
| 6 | P2 | Adapter health not colour-coded | ~15 lines code |
| 7 | P2 | Execution log input truncated too short | 1 line change |
| 8 | P3 | No keyboard shortcut for command input | ~5 lines |
| 9 | P3 | History shows "0m ago" | 2 line change |
| 10 | P3 | Mobile log tab missing failure badge | ~10 lines |
| 11 | P3 | Clear console has no confirmation | ~10 lines |

**P1 blockers:** 3 (auth setup, SSE expiry, queue state)
**P2 friction:** 4
**P3 polish:** 4
