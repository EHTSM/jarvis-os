"use strict";
/**
 * PM2 ecosystem config — production process management.
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 save          # persist across reboots
 *   pm2 startup       # install startup script
 *   pm2 logs jarvis   # tail logs
 *   pm2 monit         # live monitoring
 */
module.exports = {
  apps: [
    {
      name:         "jarvis",
      script:       "./backend/server.js",
      cwd:          __dirname,

      // ── Restart policy ──────────────────────────────────────────
      watch:        false,                // disable in production — use rolling deploy
      max_restarts: 10,
      min_uptime:   "10s",               // don't count restarts under 10s as crash
      restart_delay: 4000,               // wait 4s between restarts

      // ── Environment ─────────────────────────────────────────────
      env_production: {
        NODE_ENV:  "production",
        PORT:      5050,
      },

      // ── Logging ─────────────────────────────────────────────────
      out_file:     "./data/logs/pm2-out.log",
      error_file:   "./data/logs/pm2-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs:   true,

      // ── Performance ──────────────────────────────────────────────
      // Single instance — app is not clustered (SQLite + single-process state).
      // For horizontal scale, migrate state to Redis/Postgres first.
      instances:    1,
      exec_mode:    "fork",

      // ── Memory guard ────────────────────────────────────────────
      max_memory_restart: "500M",
    },
  ],
};
