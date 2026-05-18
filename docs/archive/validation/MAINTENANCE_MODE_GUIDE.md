# MAINTENANCE_MODE_GUIDE.md

# Controlled Maintenance Mode

## Activation Criteria
- System status: `beta` or `stable` with all critical tests passing.
- Emergency stop triggered or manual intervention required.
- Security vulnerability discovered in production.

## Procedures
1. **Stop** all services:
   - `pm2 stop jarvis`
   - `nginx -s stop`
2. **Preserve** current state:
   - Archive `data/` directory (`tar czf backup-YYYYMMDD.tar.gz data/`)
   - Export log files (`tar czf logs-YYYYMMDD.tar.gz logs/`)
3. **Rollback**:
   - Execute `scripts/rollback.sh` (reverts code, rebuilds, restores from snapshot).
4. **Redeploy**:
   - Run `scripts/deploy.sh` (build frontend, restart services).
5. **Validate**:
   - Health endpoint returns `200 OK`.
   - SSE connection re‑established.
   - Queue health and task dispatch functional.
   - No console errors on browser load.

## Rollback Checklist
- [ ] Code reverted to previous tag.
- [ ] Database state restored from backup.
- [ ] Services restarted and passing health checks.
- [ ] No console errors on initial load.
- [ ] All operator safety features (stop, cancel) functional.
- [ ] Documentation updated with incident notes.

## Post‑Recovery Verification
- Run `npm run test:stress --quick` to confirm stability.
- Verify telemetry resumes normal emission.
- Confirm operator UI displays correct status.

## Contact
- On‑call engineer: `security@jarvis-os.example.com`
- Incident response plan: see `ROLLBACK_RECOVERY_CHECKLIST.md`.
