"use strict";

const fs   = require("fs");
const net  = require("net");
const { spawnSync } = require("child_process");

// ── verifyFileChanged ─────────────────────────────────────────────────

function verifyFileChanged(filePath, beforeMtimeMs) {
    try {
        const stat = fs.statSync(filePath);
        const changed = stat.mtimeMs > beforeMtimeMs;
        return { verified: changed, filePath, beforeMtimeMs, currentMtimeMs: stat.mtimeMs };
    } catch (err) {
        return { verified: false, filePath, error: err.message };
    }
}

// ── verifyBuildSucceeded ──────────────────────────────────────────────

function verifyBuildSucceeded(artifactPath) {
    try {
        const stat = fs.statSync(artifactPath);
        const exists = stat.isFile() || stat.isDirectory();
        return { verified: exists, artifactPath, sizeBytes: stat.isFile() ? stat.size : null };
    } catch (err) {
        return { verified: false, artifactPath, error: err.message };
    }
}

// ── verifyPortOpen ────────────────────────────────────────────────────

function verifyPortOpen(port, opts = {}) {
    return new Promise(resolve => {
        const host    = opts.host ?? "127.0.0.1";
        const timeout = opts.timeout ?? 2000;
        const socket  = new net.Socket();

        let settled = false;
        function done(verified) {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve({ verified, port, host });
        }

        socket.setTimeout(timeout);
        socket.on("connect", ()  => done(true));
        socket.on("timeout", ()  => done(false));
        socket.on("error",   ()  => done(false));
        socket.connect(port, host);
    });
}

// ── verifyProcessRunning ──────────────────────────────────────────────

function verifyProcessRunning(processName) {
    try {
        const r = spawnSync("ps", ["aux"], { encoding: "utf8", timeout: 3000 });
        const lines = (r.stdout ?? "").split("\n");
        const found = lines.some(line =>
            line.includes(processName) && !line.includes("grep") && !line.includes("verifyProcessRunning")
        );
        return { verified: found, processName };
    } catch (err) {
        return { verified: false, processName, error: err.message };
    }
}

module.exports = { verifyFileChanged, verifyBuildSucceeded, verifyPortOpen, verifyProcessRunning };
