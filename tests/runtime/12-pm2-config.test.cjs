"use strict";
/**
 * Phase B.8 regression: PM2 process-supervision config invariants.
 *
 * The app ran as an unbounded OOM restart loop for ~2 months without anyone
 * noticing. Two independent problems combined:
 *
 *   1. node_args capped V8 old-space at 400 MB while the app's real steady-state
 *      RSS is 700-880 MB (measured from a fresh start). V8 aborted with
 *      "FATAL ERROR: Reached heap limit Allocation failed" — 223 occurrences in
 *      logs/pm2-err.log, earliest 2026-06-06.
 *   2. max_memory_restart (512M) sat BELOW that steady state, so PM2's own
 *      ceiling was inside the normal operating range.
 *
 * PM2 restarted after each abort, and because every run survived ~25-30 s —
 * longer than min_uptime (15 s) — the max_restarts crash-loop guard never
 * tripped. Nothing ever escalated.
 *
 * These tests pin the ordering that makes the limits coherent, so a future
 * edit cannot silently reintroduce a heap cap below the operating range.
 * Verified after the fix: restarts=0 and 0 new OOMs across 198 s of runtime.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const cfg = require("../../ecosystem.config.cjs");

/** "1536M" | "1G" -> megabytes */
function toMB(v) {
    const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*([KMG])?B?$/i);
    assert.ok(m, `unparseable memory value: ${v}`);
    const n = parseFloat(m[1]);
    const unit = (m[2] || "M").toUpperCase();
    return unit === "G" ? n * 1024 : unit === "K" ? n / 1024 : n;
}

function oldSpaceMB(app) {
    const args = Array.isArray(app.node_args) ? app.node_args.join(" ") : String(app.node_args || "");
    const m = args.match(/--max-old-space-size=(\d+)/);
    return m ? parseInt(m[1], 10) : null;
}

const server = cfg.apps.find(a => a.name === "jarvis-os");
const backup = cfg.apps.find(a => a.name === "ooplix-backup");

// Highest RSS observed in Phase B.8 across a 198 s steady-state observation.
const OBSERVED_PEAK_MB = 880;

describe("PM2 ecosystem config invariants (Phase B.8)", () => {
    it("defines exactly the two known apps", () => {
        assert.equal(cfg.apps.length, 2, "a third app entry would race for port 5050");
        assert.ok(server, "jarvis-os app entry must exist");
        assert.ok(backup, "ooplix-backup app entry must exist");
    });

    it("keeps the V8 heap cap above the observed steady-state peak", () => {
        const cap = oldSpaceMB(server);
        assert.ok(cap !== null, "--max-old-space-size must be set explicitly");
        assert.ok(cap >= OBSERVED_PEAK_MB,
            `old-space cap ${cap}MB must be >= observed peak ${OBSERVED_PEAK_MB}MB — ` +
            `a lower cap is what produced 223 "Reached heap limit" aborts`);
    });

    it("keeps PM2's memory ceiling above the V8 heap cap", () => {
        // If max_memory_restart <= the V8 cap, V8 aborts hard before PM2 can
        // restart gracefully — PM2 stops being the backstop.
        assert.ok(toMB(server.max_memory_restart) > oldSpaceMB(server),
            "max_memory_restart must exceed --max-old-space-size so PM2 restarts gracefully");
    });

    it("stays single-instance in fork mode (in-process singletons)", () => {
        assert.equal(server.instances, 1, "taskQueue/learningSystem/contextEngine are not cluster-safe");
        assert.equal(server.exec_mode, "fork");
    });

    it("allows the graceful drain to finish before SIGKILL", () => {
        // _gracefulShutdown() drains for 5 s; kill_timeout must exceed that.
        assert.ok(server.kill_timeout > 5000,
            "kill_timeout must be > the 5s drain window in _gracefulShutdown()");
    });

    it("keeps the crash-loop guard armed", () => {
        assert.equal(server.autorestart, true, "autorestart is what closed the Phase B.5 unbounded-RTO gap");
        assert.ok(server.max_restarts > 0, "max_restarts must bound a genuine crash loop");
        assert.ok(server.min_uptime, "min_uptime must be set for max_restarts to mean anything");
    });

    it("waits for the ready signal instead of assuming the port is up", () => {
        assert.equal(server.wait_ready, true);
        assert.ok(server.listen_timeout >= 30000, "cold-boot agent registration needs headroom");
    });

    it("runs the backup as a cron job that does not auto-restart", () => {
        assert.equal(backup.autorestart, false, "a scheduled job must not be restarted as a service");
        assert.ok(backup.cron_restart, "backup must carry a cron schedule");
    });
    it("keeps the Docker heap cap in step with the PM2 one", () => {
        // Both deployment paths shipped the same 400MB cap; fixing only PM2
        // would leave the container path still OOM-crashing.
        const fs = require("node:fs");
        const cmd = fs.readFileSync(require("node:path").join(__dirname, "../../Dockerfile.production"), "utf8")
            .split("\n").find(l => l.startsWith("CMD"));
        assert.ok(cmd, "Dockerfile.production must declare a CMD");
        const m = cmd.match(/--max-old-space-size=(\d+)/);
        assert.ok(m, "Docker CMD must set an explicit heap cap");
        assert.equal(parseInt(m[1], 10), oldSpaceMB(server),
            "Docker and PM2 heap caps must match, or one path silently OOMs");
    });

    it("keeps the container memory limit above the Docker heap cap", () => {
        const fs = require("node:fs");
        const compose = fs.readFileSync(require("node:path").join(__dirname, "../../docker-compose.prod.yml"), "utf8");
        const m = compose.match(/limits:\s*\n\s*memory:\s*(\d+)m/);
        assert.ok(m, "compose must declare a memory limit");
        assert.ok(parseInt(m[1], 10) > oldSpaceMB(server),
            "container memory limit must exceed the V8 heap cap");
    });

    it("sets memory warn/crit thresholds inside the heap budget", () => {
        // Thresholds below the normal operating range produce constant warnings
        // and therefore no signal (they sat at 350/450 MB against a 700-880 MB
        // steady state).
        const src = require("node:fs").readFileSync(
            require("node:path").join(__dirname, "../../backend/utils/memoryTracker.js"), "utf8");
        const warn = parseInt(src.match(/WARN_HEAP_MB\s*=\s*(\d+)/)[1], 10);
        const crit = parseInt(src.match(/CRIT_HEAP_MB\s*=\s*(\d+)/)[1], 10);
        const cap  = oldSpaceMB(server);
        assert.ok(warn < crit, "warn must trip before critical");
        assert.ok(crit <= cap, `critical (${crit}MB) must be at or under the heap cap (${cap}MB)`);
        assert.ok(warn > 500, `warn (${warn}MB) must sit above the normal operating range`);
    });
});
