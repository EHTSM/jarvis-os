"use strict";
/**
 * PM2 Ecosystem Config — JARVIS OS production deployment.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs          — start with dev env
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 restart jarvis-os
 *   pm2 reload jarvis-os                    — zero-downtime reload (fork mode)
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
            // Heap warn threshold in memoryTracker is 350 MB — this hard limit
            // is set higher so PM2 only intervenes if the tracker's warning is
            // ignored for an extended period.
            max_memory_restart: "512M",

            // Logging: rotate at 10 MB, keep 5 files (~50 MB max).
            // Structured HTTP logs (method/path/status/ms) go to out_file.
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
            // PM2 considers the restart complete only when this signal fires,
            // enabling true zero-downtime reload validation.
            wait_ready:      true,

            // Node.js flags: expose GC metrics and cap old-space to 400 MB.
            // Keeps the process below the 512 MB PM2 ceiling with headroom.
            node_args:       "--max-old-space-size=400",

            // Watch: disabled in production — use `pm2 restart` after deploys.
            // Enable in development with: watch: ["backend", "agents"]
            watch:           false,
            ignore_watch:    ["node_modules", "logs", "data", "_archive"],
        },
        {
            // Daily backup job — runs safe-backup.cjs every day at 02:00 server time.
            // Creates a tar.gz snapshot in backups/ and prunes to 7 most recent.
            // Set BACKUP_OFFSITE_DIR in .env to rsync the archive to a remote path.
            name:        "ooplix-backup",
            script:      "scripts/safe-backup.cjs",
            cwd:         __dirname,
            cron_restart: "0 2 * * *",
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
