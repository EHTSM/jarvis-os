"use strict";
/**
 * PM2 Ecosystem Config — JARVIS OS production deployment.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs          — start with dev env
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 restart jarvis-os
 *   pm2 reload jarvis-os                    — graceful reload (NOT zero-downtime;
 *                                             fork mode has no second instance to
 *                                             shift traffic to. Measured Phase B.8:
 *                                             ~5.6 s outage, 56/200 health probes
 *                                             failed during a real reload.)
 *   pm2 logs jarvis-os
 *   pm2 monit
 *
 * NEVER add a second app entry — backend/server.js is the sole production
 * entrypoint. Two entries = EADDRINUSE on port 5050.
 *
 * NEVER run `node backend/server.js` manually while PM2 is active — it will
 * silently hold the port and block PM2 restarts without any error in PM2 logs.
 * Use `pm2 restart jarvis-os` instead.
 *
 * VPS deploy checklist:
 *   pm2 startup   — generate init script (run the command it prints as root)
 *   pm2 save      — persist current process list across reboots
 */

module.exports = {
    apps: [
        {
            name:        "jarvis-os",
            script:      "backend/server.js",
            cwd:         __dirname,

            // Single instance — in-process singletons (taskQueue, learningSystem,
            // contextEngine) are NOT cluster-safe. Never set instances > 1.
            instances:   1,
            exec_mode:   "fork",

            // Environment
            env: {
                NODE_ENV: "development",
                PORT:     5050,
            },
            env_production: {
                NODE_ENV: "production",
                PORT:     5050,
            },

            // Restart policy: treat < 10s uptime as a crash loop.
            // max_restarts:5 + min_uptime:15s = PM2 stops after 5 fast crashes,
            // preventing infinite crash loops that burn CPU and exhaust disk logs.
            // restart_delay escalates via PM2's built-in backoff so the process
            // doesn't thundering-herd against a broken dependency on each retry.
            // If you need more restarts, fix the crash — do not raise this limit.
            autorestart:    true,
            max_restarts:   5,
            min_uptime:     "15s",
            restart_delay:  5000,

            // Memory ceiling: restart before the OS kills the process.
            // Heap warn threshold in memoryTracker is 350 MB (WARN_HEAP_MB); this
            // hard limit sits above the measured steady state so PM2 only
            // intervenes on a genuine leak, not on normal operation.
            //
            // Phase B.8: was 512M while the app's real steady-state RSS is
            // 700-740 MB (measured from a fresh start: 459 MB at t+2s, 738 MB at
            // t+15s). Combined with node_args --max-old-space-size=400, V8 hit its
            // heap limit and aborted with
            //   "FATAL ERROR: Reached heap limit Allocation failed"
            // 223 times in the PM2 error log, earliest 2026-06-06. PM2 dutifully
            // restarted each time, and because each run survived ~25-30 s —
            // longer than min_uptime 15 s — the max_restarts:5 crash-loop guard
            // never tripped, so this ran as an unbounded OOM restart loop.
            // It went unnoticed because the process was not under PM2 supervision
            // (see Phase B.5 R1); running bare, nothing recorded or reacted to it.
            //
            // Sized from measurement, not guesswork: old-space 1024 MB gives
            // headroom over the 740 MB observed peak, and max_memory_restart
            // 1536 MB stays above that so PM2 is the backstop for a real leak
            // rather than a participant in normal churn. Host has 8 GB.
            // The underlying cause of the large heap is the whole-file JSON
            // persistence measured in Phase B.6 (data/repo-index.json alone is
            // 45 MB and is cached in-process) — reducing that is a separate,
            // architectural change and deliberately not attempted here.
            max_memory_restart: "1536M",

            // Logging: structured HTTP logs (method/path/status/ms) go to out_file.
            //
            // Phase B.8: max_size/retain below are pm2-logrotate MODULE options,
            // not core PM2 fields — core PM2 silently ignores them. No module is
            // installed here (`~/.pm2/modules` is empty), so nothing rotates:
            // measured logs/pm2-out.log at 45.7 MB against the "10 MB" this block
            // claimed, with zero rotated files on disk. Keys are kept so the
            // intent survives, but rotation must be enabled explicitly:
            //     pm2 install pm2-logrotate
            //     pm2 set pm2-logrotate:max_size 10M
            //     pm2 set pm2-logrotate:retain 5
            // Until then, treat PM2 log growth as unbounded (see also the
            // separate data/logs/ retention gap recorded in Phase B.5 R6).
            out_file:        "logs/pm2-out.log",
            error_file:      "logs/pm2-err.log",
            merge_logs:      true,
            log_date_format: "YYYY-MM-DD HH:mm:ss",
            max_size:        "10M",
            retain:          5,

            // Graceful shutdown: PM2 sends SIGTERM → server.js drains 5 s → exit 0.
            // kill_timeout must be > the 5 s drain window in _gracefulShutdown().
            kill_timeout:    8000,
            // listen_timeout: how long PM2 waits for the process to become ready.
            // 30 s covers 100+ agent registrations + async RCA bootstrap on cold VPS.
            listen_timeout:  30000,

            // wait_ready: true — server.js calls process.send("ready") after app.listen().
            // PM2 considers the restart complete only when this signal fires, so a
            // restart is never reported done before the port is actually accepting.
            // This bounds the reload gap; it does not eliminate it (fork mode has no
            // overlapping instance — see the downtime note in the header).
            wait_ready:      true,

            // Node.js flags: cap V8 old-space below the PM2 ceiling so PM2's
            // graceful restart wins over a hard V8 abort.
            // Phase B.8: was 400 MB, which the app exceeded within seconds of
            // boot (measured 459 MB RSS at t+2s), producing repeated
            // "Reached heap limit" fatal aborts. See max_memory_restart above.
            node_args:       "--max-old-space-size=1024",

            // Watch: disabled in production — use `pm2 restart` after deploys.
            // Enable in development with: watch: ["backend", "agents"]
            watch:           false,
            ignore_watch:    ["node_modules", "logs", "data", "_archive"],
        },
        {
            // Twice-daily backup job — runs safe-backup.cjs at 02:00 and 14:00 server
            // time (POST-ERA-1 finalization: RPO target is 12h; the prior once-daily
            // "0 2 * * *" schedule structurally allowed up to ~24h of unrecovered data
            // in the worst case — a change at 02:01 wasn't captured until the next
            // day's 02:00 run. 02:00/14:00 gives an exact 12h maximum interval between
            // runs, satisfying the 12h RPO target with no gap.
            // Creates a tar.gz snapshot in backups/ and prunes to 7 most recent.
            // Set BACKUP_OFFSITE_DIR in .env to rsync the archive to a remote path.
            name:        "ooplix-backup",
            script:      "scripts/safe-backup.cjs",
            cwd:         __dirname,
            cron_restart: "0 2,14 * * *",
            autorestart:  false,
            watch:        false,
            env: {
                NODE_ENV: "production",
            },
            env_production: {
                NODE_ENV: "production",
            },
            out_file:    "logs/backup-out.log",
            error_file:  "logs/backup-err.log",
            log_date_format: "YYYY-MM-DD HH:mm:ss",
        }
    ]
};
