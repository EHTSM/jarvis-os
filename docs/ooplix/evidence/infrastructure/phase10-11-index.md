# Evidence Index — Infrastructure & CI/CD (Phase 10-11)

Files read in full this mission (via subagent): `deploy/setup-vps.sh`,
`start-production.sh`, `update.sh`, `rollback.sh`, `validate-production.sh`,
`healthcheck.sh`, `monitor.sh`, `https-setup.sh`; `ecosystem.config.cjs`;
`backup.sh`; `scripts/safe-backup.cjs`; `scripts/export-offsite.cjs`;
`backend/services/operationsAlertingLayer.cjs`; `backend/services/sentryService.cjs`;
`backend/services/dop1InfraValidation.cjs`; `.github/workflows/ci.yml` (354
lines); `.github/workflows/release.yml` (287 lines); `backend/routes/ops.js`
(`/health`); `deploy/nginx-jarvis.conf`; `.gitignore`; `scripts/run-test-suite.cjs`
(161 lines).

Live counts taken this session (not from any prior report):
`~/.pm2/modules` (empty), `logs/pm2-out.log` (85MB), `logs/pm2-err.log` (20MB),
`find tests -type f | wc -l` (384), `git ls-files tests/ | wc -l` (270),
per-directory tracked/untracked breakdowns for `tests/stress/`, `tests/legacy/`,
`tests/integration/`, `tests/smoke/`, `tests/burnin/`.

Cross-referenced against: `reports/MISSION-43C-...md` (last log-size
measurement), `docs/current/LOG_ROTATION_SETUP.md`, `docs/DISASTER-RECOVERY.md`,
`docs/archive/VPS_HARDENING_CHECKLIST.md`.

No `.env` values read anywhere in this domain's research.
