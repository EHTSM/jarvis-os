# CONTROLLED BETA DEPLOYMENT CHECKLIST

## Environment Variables
- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` set and matches backend
- [ ] `BASE_URL` points to correct API endpoint
- [ ] `PORT` configured (default 5050)
- [ ] `DB_PATH` points to writable directory
- [ ] `LOG_LEVEL` set to `info` or `warn`
- [ ] `ENABLE_TELEMETRY=true` (optional)

## Build & Artifacts
- [ ] `npm run build:frontend` succeeds without errors
- [ ] `npm start` starts backend and serves frontend
- [ ] Static assets served with correct cache headers
- [ ] No console errors in browser on initial load
- [ ] Production bundle size within expected range

## Runtime Verification
- [ ] Health endpoint `/jarvis` returns 200 with `{status:"ok"}`
- [ ] SSE connection establishes and maintains heartbeat
- [ ] Queue health updates visible in UI after task submission
- [ ] Emergency stop and resume functions work as expected
- [ ] Onboarding flow completes and persists profile
- [ ] Mobile viewport (320px width) renders without overflow

## Telemetry Sanity
- [ ] Telemetry events received at expected interval (~10s)
- [ ] No malformed JSON in SSE stream
- [ ] Error events include `success:false` and descriptive message
- [ ] Logs written to `data/` directory with correct permissions
- [ ] Log rotation does not drop active session logs

## Rollback Verification
- [ ] Rollback script (`scripts/rollback.sh`) present and executable
- [ ] Reverting to previous commit restores prior behavior
- [ ] Database migrations backward compatible (if any)
- [ ] Cache cleared after redeploy to avoid stale assets

## Operator Handoff Readiness
- [ ] `OPERATOR_BETA_GUIDE.md` accessible in `/docs` or startup screen
- [ ] Emergency contact information displayed in settings
- [ ] Feedback mechanism (e.g., issue template) communicated
- [ ] Known limitations list shared with beta testers
- [ ] Onboarding includes note about beta status and data usage