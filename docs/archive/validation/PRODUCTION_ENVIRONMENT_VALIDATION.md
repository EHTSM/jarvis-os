# PRODUCTION ENVIRONMENT VALIDATION

## System Checks
- [ ] Backend starts without errors (`node backend/server.js`)
- [ ] Frontend bundles without warnings (`npm run build:frontend`)
- [ ] Health endpoint returns 200 with status `ok`
- [ ] Database (SQLite) writes to `data/` directory
- [ ] Log directory exists and is writable
- [ ] Environment variables match `production` profile

## Runtime Checks
- [ ] SSE connection established within 5 seconds of load
- [ ] Queue health visible after first task dispatch
- [ ] Emergency stop/resume cycle works (stop → red banner → resume button)
- [ ] Onboarding completes and persists profile to `localStorage`
- [ ] Mobile viewport renders without overflow or clipping
- [ ] Error toasts link to Logs tab and scroll to correct entry

## Security Baselines
- [ ] No raw SQL injection exposure (API uses parameterized queries)
- [ ] JWT stored in HTTP-only cookie (secure, httpOnly, maxAge)
- [ ] Passwords hashed before transmission (via API authentication)
- [ ] Admin controls behind password-protected routes

## Performance Benchmarks
- [ ] First paint < 2 seconds on fresh load
- [ ] SSE reconnect time < 8 seconds after 30s disconnect
- [ ] Task dispatch latency < 500ms under normal load
- [ ] Memory usage stable for 8-hour session (no growth >10%)

## Telemetry & Logging
- [ ] Telemetry events logged to `data/telemetry.log` with timestamps
- [ ] Error logs include request IDs for correlation
- [ ] Log rotation configured (no retention > 30 days)
- [ ] Logs retained on crash (WAL mode active)

## Rollback Readiness
- [ ] Rollback script exists (`scripts/rollback.sh`)
- [ ] Previous release artifacts available (`release-*.tar.gz`)
- [ ] Database migration reversible (no destructive changes)
- [ ] Cache cleared after redeploy

## Acceptance Criteria
All checks marked as `[x]` before beta launch. No open critical or high-severity issues.