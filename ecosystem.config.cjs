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
            // Exponential backoff via restart_delay prevents thundering herd
            // against a broken dependency (DB, external API).
            autorestart:    true,
            max_restarts:   10,
            min_uptime:     "10s",
            restart_delay:  3000,

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
            // Set to 15 s to cover slow cold-disk executor loading.
            listen_timeout:  15000,

            // wait_ready: false — server.js does not call process.send("ready").
            // If you add process.send("ready") after app.listen(), set this to true
            // and PM2 will only consider the restart complete when that signal fires.
            wait_ready:      false,

            // Node.js flags: expose GC metrics and cap old-space to 400 MB.
            // Keeps the process below the 512 MB PM2 ceiling with headroom.
            node_args:       "--max-old-space-size=400",

            // Watch: disabled in production — use `pm2 restart` after deploys.
            // Enable in development with: watch: ["backend", "agents"]
            watch:           false,
            ignore_watch:    ["node_modules", "logs", "data", "_archive"],
        }
    ]
};
