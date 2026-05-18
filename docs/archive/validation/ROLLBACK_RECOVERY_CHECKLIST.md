# ROLLBACK RECOVERY CHECKLIST

## Immediate Actions
1. **Identify Issue**
   - Determine scope: individual task failure, complete system outage, data corruption.
   - Check logs for error codes (`/data/*.log`, `npm run test:stress`)
   - Verify if emergency stop was triggered (`status === "critical"`)

2. **Stop Live Operations**
   - If system running: execute `npm run pm2:stop` or kill processes manually.
   - Disable external access (firewall, reverse proxy).

3. **Preserve Evidence**
   - Archive current `data/` directory for forensic analysis.
   - Save console output from latest `npm start` run.
   - Record timestamp of failure and user actions leading to it.

## Rollback Procedure
1. **Revert Code**
   - `git checkout HEAD~1 -- frontend/src/ App.jsx Onboarding.jsx`
   - Or restore from previous release artifact.

2. **Rebuild**
   - `npm run build:frontend`
   - `npm start` to verify backend starts cleanly.

3. **Validate**
   - Run `npm run test:stress -- --quick`
   - Confirm health endpoint returns 200.
   - Check queue integrity: `node agents/taskQueue.cjs --check`

4. **Re‑deploy**
   - Push to production environment.
   - Restart services: `npm run pm2:start`
   - Monitor for 5 minutes post‑restart.

## Recovery for Data Issues
- **Task‑Queue Corruption**: Restore from last known good `data/task-queue.json.backup`
- **JWT Loss**: Re‑login required; no long‑running task recovery.
- **Telemetry Gap**: Recreate missing events manually (rare).

## Post‑Rollback Verification
- [ ] Health endpoint functional
- [ ] SSE connection stable
- [ ] Queue processing resumed
- [ ] No console errors in browser
- [ ] Emergency stop/resume cycle works
- [ ] Onboarding flow persists profile

## Escalation
- If rollback fails: contact oncall via Slack/Teams (link in `OPERATOR_BETA_GUIDE.md`).
- Document incident in `data/incidents/` with full timeline.