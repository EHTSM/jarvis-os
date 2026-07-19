# Day 1 Operations — What You Actually Do After Launch

The concrete, chronological list of what to do on launch day and the days immediately after. This assumes [FOUNDER_CHECKLIST.md](FOUNDER_CHECKLIST.md) is fully checked off and you've just gone live.

---

## Launch day — before announcing

- [ ] Run `bash deploy/validate-production.sh` one final time
- [ ] Run `bash deploy/monitor.sh` — confirm PM2 online, health OK, no error spam
- [ ] Walk the full [CUSTOMER_ONBOARDING.md](CUSTOMER_ONBOARDING.md) journey yourself with a real email you control: register → verify → login → (payment if applicable)
- [ ] Confirm the healthcheck cron is installed:
  ```bash
  crontab -l | grep healthcheck
  ```
- [ ] Confirm `pm2 startup` and `pm2 save` are done — reboot the VPS once, deliberately, and confirm Ooplix comes back up on its own before you have real customers depending on it
- [ ] Have `deploy/rollback.sh --list` output in front of you (or memorized) so you're not looking it up for the first time mid-incident

## Launch day — first few hours

- [ ] Announce to your first invite batch (see [CUSTOMER_ONBOARDING.md](CUSTOMER_ONBOARDING.md) Step 0 for how invites work)
- [ ] Watch `pm2 monit` or `bash deploy/monitor.sh --live` during the first wave of real traffic — this is the only time load will be genuinely unpredictable
- [ ] Check `bash deploy/monitor.sh --errors` after the first hour, then every few hours
- [ ] If you set `TELEGRAM_OPERATOR_CHAT_ID`, keep that chat open — crash alerts land there in real time
- [ ] Respond to any support requests using the templates in [SUPPORT_RUNBOOK.md](SUPPORT_RUNBOOK.md)

## End of Day 1

- [ ] Run `npm run backup` manually once, even though the routine cadence should be automated going forward — confirm it actually produces a file in `backups/`
- [ ] Check `GET /cbeta/metrics/active-users` or the equivalent dashboard for real signup/activity numbers
- [ ] Skim every registered account for anything obviously wrong (bounced verification emails, stuck at unverified, etc.)
- [ ] Note anything that felt fragile or confusing while onboarding real users — this becomes input for the next release (see [RELEASE_PLAYBOOK.md](RELEASE_PLAYBOOK.md))
- [ ] Confirm disk usage is sane: `df -h` — logs and `data/` grow the fastest early on

## Daily cadence, starting Day 2

This becomes your new normal — see [SUPPORT_RUNBOOK.md](SUPPORT_RUNBOOK.md) for the full "daily checks" section. The short version:

```bash
bash deploy/monitor.sh              # full health snapshot
bash deploy/monitor.sh --errors     # anything new in the error log
```

Plus:
- Check your support channel (email/Telegram/wherever you decided — [SUPPORT_RUNBOOK.md](SUPPORT_RUNBOOK.md) has this as a launch-blocking decision)
- Check Razorpay Dashboard for any payment webhook failures if you're accepting payments
- Check `backups/` has a fresh file from the last 24 hours (cron should handle this — verify, don't assume)

## Weekly cadence

- [ ] Review `pm2 status` restart count — a healthy process should have a low, stable restart count. A climbing number across the week means something is crash-looping intermittently; investigate before it becomes a customer-visible outage.
- [ ] Confirm off-server backup replication is actually running, not just configured (see [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) — this is the gap most founders discover too late)
- [ ] Review any accumulated CHANGELOG-worthy fixes and decide if it's time to cut a release ([RELEASE_PLAYBOOK.md](RELEASE_PLAYBOOK.md))
- [ ] Re-run `node scripts/test-restore.cjs` — confirm your disaster recovery path still actually works as data volume grows

## First real incident

You will have one. When it happens:

1. Don't panic-debug in production if you're not confident — [SUPPORT_RUNBOOK.md's escalation section](SUPPORT_RUNBOOK.md#escalation-path) has the rollback-first heuristic
2. `pm2 logs jarvis-os --lines 100 --err` is always the first command
3. [docs/current/INCIDENT_RESPONSE.md](docs/current/INCIDENT_RESPONSE.md) has tested procedures for the common cases (crash loop, bad deploy, corrupted queue, memory exhaustion, auth lockout, webhook failure, SSE issues)
4. If it's genuinely novel, [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) has the harder scenarios (total data loss, dead VPS)
5. After it's resolved: post-incident note to yourself (what happened, root cause, what you changed) — this is how the incident response doc stays current instead of going stale

## The mindset shift

Before launch, everything is reversible — you can wipe `data/`, restart from scratch, experiment freely. **After launch, every piece of `data/` represents a real person's information**, and every deploy is a live change to something people depend on. The checklists in this document exist so that shift doesn't have to be relearned the hard way on Day 1.
